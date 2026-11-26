# FileConnect starter

A responsive browser-based peer-to-peer file transfer demo.

## Files
- `index.html` — page structure
- `style.css` — responsive design
- `app.js` — PeerJS connection and chunked transfer logic

## Run it
1. Put all three files in the same folder.
2. Open the folder using a local web server (recommended), or deploy the folder to a static HTTPS host.
3. Open the HTTPS website on device A and click **Generate connection code**.
4. Copy the full PeerJS code and enter it on device B, then click **Connect**.
5. Select files or a folder to send.

For local testing, a simple static server can be used:
`python -m http.server 8000`
Then visit `http://localhost:8000` on the computer.

## Important limitations
- The code shown is the full PeerJS ID, not a short numeric PIN.
- PeerJS's public signaling service is used by default. A production service should run its own signaling server.
- WebRTC attempts direct connectivity; some networks require a TURN relay. This starter does not configure TURN, so connections may fail on restrictive networks.
- Folder selection is supported in browsers that implement `webkitdirectory`. A selected folder is zipped and received as one ZIP file.
- Multi-file selections are received as individual downloads.
- This is a learning prototype, not a production-hardened file-sharing service. Add pairing approval, code expiry, rate limits, file-size limits, integrity checks, and abuse protection before public launch.
- Use HTTPS in deployment. Do not share your connection code publicly.
