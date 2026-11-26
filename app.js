const $ = (id) => document.getElementById(id);
const createBtn = $("createBtn"), connectBtn = $("connectBtn");
let peer = null, connection = null, myPeerId = null;
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
//function randomCode() {
  // A short display code is easier to type; PeerJS uses the full generated ID internally.
//  return Math.random().toString(36).slice(2, 8).toUpperCase();
//}

function randomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}



function makePeer() {
  return new Promise((resolve, reject) => {
    const p = new Peer(randomCode());
    p.on("open", id => resolve({ peer:p, id }));
    p.on("error", err => reject(err));
    p.on("connection", conn => attachConnection(conn));
  });
}
async function ensurePeer() {
  if (peer && !peer.destroyed) return;
  setMessage("Starting secure connection service…");
  const result = await makePeer();
  peer = result.peer; myPeerId = result.id;
}
function attachConnection(conn) {
  if (connection && connection.open) { conn.close(); return; }
  connection = conn;
  conn.on("open", () => {
    setConnected(true); setMessage("Connected. You can now send files in either direction.");
    toast("Devices connected!");
  });
  conn.on("data", handleData);
  conn.on("close", () => {
    connection = null; setConnected(false); setMessage("Connection closed. Generate or enter a code to reconnect.");
  });
  conn.on("error", err => setMessage("Connection error: " + err.message));
}
createBtn.addEventListener("click", async () => {
  createBtn.disabled = true;
  try {
    await ensurePeer();
    $("myCode").textContent = myPeerId;
    $("myCodeWrap").classList.remove("hidden");
    setMessage("Your code is ready. Enter this full code on your second device.");
    toast("Connection code generated");
  } catch (err) {
    setMessage("Could not start connection: " + err.message);
  } finally { createBtn.disabled = false; }
});
$("copyBtn").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(myPeerId); toast("Code copied"); }
  catch { toast("Select and copy the code manually"); }
});
connectBtn.addEventListener("click", async () => {
  const remoteId = $("remoteCode").value.trim();
  if (!remoteId) return toast("Enter the other device's code first");
  connectBtn.disabled = true;
  try {
    await ensurePeer();
    setMessage("Connecting… keep both pages open.");
    const conn = peer.connect(remoteId, { reliable:true });
    attachConnection(conn);
  } catch (err) { setMessage("Could not connect: " + err.message); }
  finally { connectBtn.disabled = false; }
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
    file = new File([blob], (fileList[0].webkitRelativePath.split("/")[0] || "folder") + ".zip", { type:"application/zip" });
  } else {
    // Queue each selected file separately.
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
