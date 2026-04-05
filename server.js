const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });

// rooms: Map<roomId, Map<clientId, ws>>
const rooms = new Map();

function broadcast(roomId, msg, excludeId = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  const json = JSON.stringify(msg);
  for (const [id, ws] of room) {
    if (id !== excludeId && ws.readyState === WebSocket.OPEN) {
      ws.send(json);
    }
  }
}

function leave(ws) {
  const { clientId, roomId } = ws._meta || {};
  if (!roomId || !clientId) return;
  const room = rooms.get(roomId);
  if (!room) return;
  room.delete(clientId);
  broadcast(roomId, { type: "peer-left", clientId });
  if (room.size === 0) rooms.delete(roomId);
  console.log(`[${roomId}] ${clientId} left  (room size: ${room ? room.size : 0})`);
}

wss.on("connection", (ws) => {
  ws._meta = {};

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case "join": {
        // Validate
        if (!msg.roomId || !msg.clientId) return;
        const roomId  = String(msg.roomId).slice(0, 32).replace(/[^a-zA-Z0-9_-]/g, "");
        const clientId = String(msg.clientId).slice(0, 64);

        // Leave old room if re-joining
        leave(ws);

        if (!rooms.has(roomId)) rooms.set(roomId, new Map());
        const room = rooms.get(roomId);
        room.set(clientId, ws);
        ws._meta = { clientId, roomId };

        // Tell the joiner who's already in the room
        const peers = [...room.keys()].filter(k => k !== clientId);
        ws.send(JSON.stringify({ type: "peers", peers }));

        // Tell everyone else someone joined
        broadcast(roomId, { type: "peer-joined", clientId }, clientId);
        console.log(`[${roomId}] ${clientId} joined  (room size: ${room.size})`);
        break;
      }

      // WebRTC signalling — forward to the named target peer
      case "offer":
      case "answer":
      case "ice-candidate": {
        const { roomId, clientId } = ws._meta;
        if (!roomId) return;
        const target = rooms.get(roomId)?.get(msg.target);
        if (target && target.readyState === WebSocket.OPEN) {
          target.send(JSON.stringify({ ...msg, from: clientId }));
        }
        break;
      }

      case "speaking": {
        // Relay "who is talking" so overlay can show it
        const { roomId, clientId } = ws._meta;
        if (!roomId) return;
        broadcast(roomId, { type: "speaking", clientId, active: !!msg.active }, clientId);
        break;
      }

      case "ping":
        ws.send(JSON.stringify({ type: "pong" }));
        break;
    }
  });

  ws.on("close", () => leave(ws));
  ws.on("error", () => leave(ws));
});

console.log(`encrypteds VoiceChat signalling server listening on port ${PORT}`);
