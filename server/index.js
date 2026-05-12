const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 3001);
const CLIENT_DIST = path.resolve(__dirname, "../client/dist");
const MAX_MESSAGE_LENGTH = 1500;
const MESSAGE_RATE_LIMIT = { max: 12, windowMs: 10_000 };
const QUEUE_TIMEOUT_MS = 5 * 60 * 1000;

const clients = new Map(); // ws -> client
const rooms = new Map(); // roomId -> room
const waiting = []; // client[]
const reports = [];

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function now() {
  return Date.now();
}

function safeProfile(profile = {}) {
  return {
    displayName: String(profile.displayName || profile.name || "Anonymous").slice(0, 24),
    gender: String(profile.gender || "Prefer not to say").slice(0, 32),
    ageGroup: String(profile.ageGroup || "18-24").slice(0, 16),
    country: String(profile.country || "Hidden").slice(0, 56),
    chatPreference: String(profile.chatPreference || "Text").slice(0, 16),
    interests: Array.isArray(profile.interests)
      ? profile.interests.map((x) => String(x).slice(0, 24)).slice(0, 8)
      : []
  };
}

function send(ws, type, payload = {}) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type, payload, ts: Date.now() }));
  }
}

function sendError(ws, message) {
  send(ws, "error", { message });
}

function otherClient(room, client) {
  if (!room) return null;
  return room.a === client ? room.b : room.a;
}

function removeFromQueue(client) {
  const idx = waiting.indexOf(client);
  if (idx >= 0) waiting.splice(idx, 1);
  client.state = client.roomId ? "chatting" : "idle";
}

function cleanQueue() {
  const cutoff = now() - QUEUE_TIMEOUT_MS;
  for (let i = waiting.length - 1; i >= 0; i--) {
    const c = waiting[i];
    if (!c || c.ws.readyState !== c.ws.OPEN || c.roomId || c.queuedAt < cutoff) {
      waiting.splice(i, 1);
      if (c && !c.roomId) c.state = "idle";
    }
  }
}

function profileCompatible(a, b, requireSameCountry) {
  if (!a.profile || !b.profile) return false;
  if (a === b) return false;
  if (a.roomId || b.roomId) return false;
  if (a.ws.readyState !== a.ws.OPEN || b.ws.readyState !== b.ws.OPEN) return false;
  if (a.profile.chatPreference !== b.profile.chatPreference) return false;
  if (requireSameCountry && a.profile.country !== b.profile.country) return false;
  return true;
}

function findPartner(client) {
  cleanQueue();
  let partner = waiting.find((candidate) => profileCompatible(client, candidate, true));
  if (!partner) partner = waiting.find((candidate) => profileCompatible(client, candidate, false));
  return partner || null;
}

function createRoom(a, b) {
  removeFromQueue(a);
  removeFromQueue(b);

  const roomId = id("room");
  const room = {
    id: roomId,
    a,
    b,
    mode: a.profile.chatPreference,
    createdAt: now(),
    buffer: []
  };
  rooms.set(roomId, room);

  a.roomId = roomId;
  b.roomId = roomId;
  a.state = "chatting";
  b.state = "chatting";

  send(a.ws, "match:found", {
    roomId,
    stranger: safeProfile(b.profile),
    initiator: true
  });
  send(b.ws, "match:found", {
    roomId,
    stranger: safeProfile(a.profile),
    initiator: false
  });
}

function joinQueue(client, profile) {
  if (client.roomId) leaveRoom(client, "left");
  removeFromQueue(client);

  client.profile = safeProfile(profile);
  const partner = findPartner(client);
  if (partner) {
    createRoom(client, partner);
    return;
  }

  client.state = "waiting";
  client.queuedAt = now();
  waiting.push(client);
  send(client.ws, "queue:waiting", {
    position: waiting.length,
    online: clients.size,
    message: "Waiting for a stranger..."
  });
}

function leaveRoom(client, reason = "left") {
  const room = rooms.get(client.roomId);
  if (!room) {
    client.roomId = null;
    client.state = "idle";
    return;
  }

  const other = otherClient(room, client);
  rooms.delete(room.id);

  client.roomId = null;
  client.state = "idle";

  if (other) {
    other.roomId = null;
    other.state = "idle";
    send(other.ws, "stranger:left", { reason });
    send(other.ws, "webrtc:hangup", { reason });
  }
}

function rateLimited(client) {
  const current = now();
  client.messageHits = client.messageHits.filter((t) => current - t < MESSAGE_RATE_LIMIT.windowMs);
  if (client.messageHits.length >= MESSAGE_RATE_LIMIT.max) return true;
  client.messageHits.push(current);
  return false;
}

function relayChat(client, rawText) {
  const room = rooms.get(client.roomId);
  if (!room) return sendError(client.ws, "You are not connected to a stranger.");
  if (rateLimited(client)) return sendError(client.ws, "You are sending messages too fast.");

  const text = String(rawText || "").trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!text) return;

  const other = otherClient(room, client);
  if (!other) return;

  room.buffer.push({ from: client.id, text, ts: now() });
  if (room.buffer.length > 20) room.buffer.shift();

  send(other.ws, "chat:message", { text });
}

function relayToRoom(client, type, payload = {}) {
  const room = rooms.get(client.roomId);
  if (!room) return sendError(client.ws, "You are not connected to a stranger.");
  const other = otherClient(room, client);
  if (!other) return;
  send(other.ws, type, payload);
}

function reportUser(client, reason) {
  const room = rooms.get(client.roomId);
  if (!room) return sendError(client.ws, "There is no active room to report.");
  const other = otherClient(room, client);

  reports.push({
    id: id("report"),
    roomId: room.id,
    reason: String(reason || "No reason provided").slice(0, 280),
    reporterProfile: safeProfile(client.profile),
    reportedProfile: safeProfile(other?.profile),
    evidenceSnapshot: room.buffer.slice(-20),
    createdAt: new Date().toISOString()
  });

  send(client.ws, "report:received", {
    message: "Report received. You can skip or end this chat now."
  });
}

function handleMessage(client, raw) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return sendError(client.ws, "Invalid message format.");
  }

  const type = msg.type;
  const payload = msg.payload || msg;

  switch (type) {
    case "profile:set":
      client.profile = safeProfile(payload.profile || payload);
      send(client.ws, "profile:ready", { profile: client.profile });
      break;

    case "match:find":
    case "join_queue":
      joinQueue(client, payload.profile || payload);
      break;

    case "queue:cancel":
      removeFromQueue(client);
      send(client.ws, "queue:cancelled", { message: "Matching cancelled." });
      break;

    case "chat:message":
    case "message":
      relayChat(client, payload.text);
      break;

    case "chat:typing":
    case "typing":
      relayToRoom(client, "chat:typing", { isTyping: Boolean(payload.isTyping ?? payload.typing) });
      break;

    case "match:skip":
    case "skip":
      leaveRoom(client, "skipped");
      if (payload.profile) joinQueue(client, payload.profile);
      break;

    case "chat:leave":
    case "leave":
      leaveRoom(client, "left");
      break;

    case "report:user":
      reportUser(client, payload.reason);
      break;

    case "webrtc:offer":
    case "webrtc:answer":
    case "webrtc:ice":
    case "webrtc:hangup":
      relayToRoom(client, type, payload);
      break;

    default:
      sendError(client.ws, `Unknown event: ${type}`);
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      service: "vanish-server",
      online: clients.size,
      waiting: waiting.length,
      rooms: rooms.size
    }));
    return;
  }

  if (url.pathname === "/auth/google" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({
        user: { id: id("user"), name: "Guest User", email: "hidden@vanish.local", picture: null },
        sessionToken: id("session")
      }));
    });
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization"
    });
    res.end();
    return;
  }

  let filePath = path.join(CLIENT_DIST, url.pathname === "/" ? "index.html" : url.pathname);
  if (!filePath.startsWith(CLIENT_DIST)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(CLIENT_DIST, "index.html");
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("VANISH backend is running. Build the client with `npm run build`, then start again to serve the web app.");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json"
  };
  res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const client = {
    id: id("socket"),
    ws,
    profile: null,
    roomId: null,
    state: "idle",
    queuedAt: null,
    messageHits: [],
    connectedAt: now(),
    ipHash: crypto.createHash("sha256").update(req.socket.remoteAddress || "unknown").digest("hex")
  };

  clients.set(ws, client);
  ws.isAlive = true;

  send(ws, "connected", {
    socketId: client.id,
    online: clients.size,
    message: "Connected to VANISH realtime server."
  });

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (raw) => handleMessage(client, raw));

  ws.on("close", () => {
    removeFromQueue(client);
    leaveRoom(client, "disconnected");
    clients.delete(ws);
  });

  ws.on("error", () => {
    removeFromQueue(client);
    leaveRoom(client, "connection_error");
    clients.delete(ws);
  });
});

setInterval(() => {
  cleanQueue();
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      const client = clients.get(ws);
      if (client) {
        removeFromQueue(client);
        leaveRoom(client, "timeout");
        clients.delete(ws);
      }
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

server.listen(PORT, () => {
  console.log(`VANISH server running on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
});
