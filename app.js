const $ = (id) => document.getElementById(id);
const createBtn = $("createBtn"), connectBtn = $("connectBtn");
const API_BASE = (window.FILECONNECT_API_BASE || "").replace(/\/$/, "");
let peer = null, connection = null, myPeerId = null, sessionCode = null;
let incoming = null, sendQueue = [], sending = false;

function toast(message) {
  const el = $("toast"); el.textContent = message; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}
function setMessage(message) { $("connectionMessage").textContent = message; }
function setConnected(connected) {
  $("status").textContent = connected ? "Connected" : "Not connected";
  $("status").classList.toggle("connected", connected);
  $("dropZone").style.opacity = connected ? "1" : ".55";
}
async function apiPost(path, body) {
  if (!API_BASE) throw new Error("Pairing server URL is not configured.");
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch {
    throw new Error("Could not reach the pairing server. Check its URL and try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Pairing server error (${response.status}).`);
  return data;
}
function makePeer() {
  return new Promise((resolve, reject) => {
    const p = new Peer();
    let settled = false;
    p.on("open", id => {
      if (settled) return;
      settled = true;
      resolve({ peer: p, id });
    });
    p.on("error", err => {
      if (!settled) {
        settled = true;
        reject(err);
      } else {
        setMessage("Connection service error: " + err.message);
      }
    });
    p.on("connection", conn => attachConnection(conn));
  });
}
async function ensurePeer() {
  if (peer && !peer.destroyed && myPeerId) return;
  setMessage("Starting device connection…");
  const result = await makePeer();
  peer = result.peer;
  myPeerId = result.id;
}
function attachConnection(conn) {
  if (connection && connection.open) { conn.close(); return; }
  connection = conn;
  conn.on("open", () => {
    setConnected(true);
    setMessage("Connected. You can now send files in either direction.");
    toast("Devices connected!");
  });
  conn.on("data", handleData);
  conn.on("close", () => {
    connection = null;
    setConnected(false);
    setMessage("Connection closed. Generate or enter a code to reconnect.");
  });
  conn.on("error", err => setMessage("Connection error: " + err.message));
}
createBtn.addEventListener("click", async () => {
  createBtn.disabled = true;
  try {
    await ensurePeer();
    const result = await apiPost("/api/sessions", { peerId: myPeerId });
    sessionCode = result.code;
    $("myCode").textContent = sessionCode;
    $("myCodeWrap").classList.remove("hidden");
    setMessage(`Your code is ready. It expires in ${Math.floor(result.expiresInSeconds / 60)} minutes. Enter it on your second device.`);
    toast("6-digit connection code generated");
  } catch (err) {
    setMessage("Could not create a code: " + err.message);
  } finally {
    createBtn.disabled = false;
  }
});
$("copyBtn").addEventListener("click", async () => {
  if (!sessionCode) return toast("Generate a code first");
  try {
    await navigator.clipboard.writeText(sessionCode);
    toast("Code copied");
  } catch {
    toast("Select and copy the code manually");
  }
});
connectBtn.addEventListener("click", async () => {
  const code = $("remoteCode").value.trim();
  if (!/^\d{6}$/.test(code)) return toast("Enter a valid 6-digit code");
  connectBtn.disabled = true;
  try {
    await ensurePeer();
    setMessage("Checking code…");
    const result = await apiPost("/api/sessions/lookup", { code });
    setMessage("Code found. Connecting… keep both pages open.");
    const conn = peer.connect(result.peerId, { reliable: true });
    attachConnection(conn);
  } catch (err) {
    setMessage("Could not connect: " + err.message);
  } finally {
    connectBtn.disabled = false;
  }
});

function showProgress(name, percent, detail) {
  $("transferBox").classList.remove("hidden");
  $("transferName").textContent = name;
  $("transferPercent").textContent = percent + "%";
  $("progressBar").style.width = percent + "%";
  $("transferDetail").textContent = detail;
}
function handleData(data) {
  if (!data || typeof data !== "object") return;
  if (data.type === "file-start") {
    incoming = { name:data.name, mime:data.mime || "application/octet-stream", size:data.size, chunks:[], received:0 };
    showProgress("Receiving " + data.name, 0, "Receiving from connected device…");
    connection.send({ type:"file-ready" });
  } else if (data.type === "file-chunk" && incoming) {
    incoming.chunks.push(data.chunk);
    incoming.received += data.chunk.byteLength;
    const percent = incoming.size ? Math.min(100, Math.round(incoming.received / incoming.size * 100)) : 100;
    showProgress("Receiving " + incoming.name, percent, `${(incoming.received/1048576).toFixed(1)} MB received`);
    connection.send({ type:"chunk-ack" });
  } else if (data.type === "file-end" && incoming) {
    const blob = new Blob(incoming.chunks, { type:incoming.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = incoming.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    showProgress("Received " + incoming.name, 100, "Download started.");
    toast("File received — download started");
    incoming = null;
  } else if (data.type === "file-ready") {
    sendNextChunk();
  } else if (data.type === "chunk-ack") {
    sendNextChunk();
  }
}
function sendNextChunk() {
  if (!sending || !connection || !connection.open) return;
  const task = sendQueue[0];
  if (!task) { sending = false; return; }
  if (task.offset >= task.file.size) {
    connection.send({ type:"file-end" });
    sendQueue.shift(); sending = false;
    showProgress("Sent " + task.file.name, 100, "Transfer complete.");
    toast("File sent successfully");
    if (sendQueue.length) startNextFile();
    return;
  }
  const chunk = task.file.slice(task.offset, task.offset + 64 * 1024);
  chunk.arrayBuffer().then(buffer => {
    connection.send({ type:"file-chunk", chunk:buffer });
    task.offset += buffer.byteLength;
    const percent = task.file.size ? Math.round(task.offset / task.file.size * 100) : 100;
    showProgress("Sending " + task.file.name, percent, `${(task.offset/1048576).toFixed(1)} MB sent`);
  }).catch(err => { sending = false; toast("Could not read file: " + err.message); });
}
function startNextFile() {
  if (!connection || !connection.open || !sendQueue.length || sending) return;
  sending = true;
  const task = sendQueue[0]; task.offset = 0;
  showProgress("Preparing " + task.file.name, 0, "Waiting for receiver…");
  connection.send({ type:"file-start", name:task.file.name, mime:task.file.type, size:task.file.size });
}
async function prepareAndSend(fileList, isFolder) {
  if (!connection || !connection.open) return toast("Connect to the other device first");
  if (!fileList.length) return;
  let file;
  if (isFolder) {
    if (!window.JSZip) return toast("Folder support library did not load. Try selecting files.");
    const zip = new JSZip();
    for (const item of fileList) {
      const path = item.webkitRelativePath || item.name;
      zip.file(path, item);
    }
    showProgress("Creating folder ZIP…", 0, "Preparing folder for transfer");
    const blob = await zip.generateAsync({ type:"blob" }, metadata => {
      showProgress("Creating folder ZIP…", Math.round(metadata.percent), "Bundling folder contents");
    });
    const firstPath = fileList[0].webkitRelativePath || fileList[0].name;
    file = new File([blob], (firstPath.split("/")[0] || "folder") + ".zip", { type:"application/zip" });
  } else {
    for (const f of fileList) sendQueue.push({ file:f, offset:0 });
    startNextFile();
    return;
  }
  sendQueue.push({ file, offset:0 }); startNextFile();
}
$("fileInput").addEventListener("change", e => {
  prepareAndSend(Array.from(e.target.files), false); e.target.value = "";
});
$("folderInput").addEventListener("change", e => {
  prepareAndSend(Array.from(e.target.files), true); e.target.value = "";
});
$("dropZone").addEventListener("dragover", e => { e.preventDefault(); $("dropZone").style.borderColor = "#77e0bd"; });
$("dropZone").addEventListener("dragleave", () => { $("dropZone").style.borderColor = ""; });
$("dropZone").addEventListener("drop", e => {
  e.preventDefault(); $("dropZone").style.borderColor = "";
  if (e.dataTransfer.files.length) prepareAndSend(Array.from(e.dataTransfer.files), false);
});
setConnected(false);