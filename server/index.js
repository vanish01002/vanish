const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { URL } = require("url");
const { WebSocketServer } = require("ws");
const { OAuth2Client } = require("google-auth-library");

const PORT = Number(process.env.PORT || 3001);
const CLIENT_DIST = path.resolve(__dirname, "../client/dist");
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || "";
const MAX_MESSAGE_LENGTH = 1500;
const MAX_MEDIA_BYTES = 1_000_000;
const MESSAGE_RATE_LIMIT = { max: 12, windowMs: 10_000 };
const MEDIA_RATE_LIMIT = { max: 4, windowMs: 30_000 };
const QUEUE_TIMEOUT_MS = 5 * 60 * 1000;

const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const accounts = new Map(); // googleSub -> account
const sessions = new Map(); // sessionToken -> account
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

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function publicUser(account) {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    picture: account.picture,
    provider: account.provider
  };
}

async function handleGoogleAuth(req, res) {
  if (!googleClient || !GOOGLE_CLIENT_ID) {
    return json(res, 503, {
      message: "Google login is not configured. Add GOOGLE_CLIENT_ID and VITE_GOOGLE_CLIENT_ID in Render."
    });
  }

  try {
    const body = await readBody(req);
    const credential = String(body.credential || "");
    if (!credential) return json(res, 400, { message: "Missing Google credential." });

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload?.email) return json(res, 401, { message: "Invalid Google account." });

    const account = {
      id: `google_${payload.sub}`,
      googleSub: payload.sub,
      email: payload.email,
      name: payload.name || payload.email.split("@")[0],
      picture: payload.picture || "",
      provider: "google",
      createdAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString()
    };

    accounts.set(payload.sub, account);
    const sessionToken = crypto.randomBytes(32).toString("hex");
    sessions.set(sessionToken, account);

    return json(res, 200, {
      sessionToken,
      user: publicUser(account)
    });
  } catch (error) {
    return json(res, 401, { message: "Google login verification failed." });
  }
}

function safeProfile(profile = {}) {
  return {
    displayName: String(profile.displayName || profile.name || "Anonymous").slice(0, 24),
    gender: String(profile.gender || "Prefer not to say").slice(0, 32),
    ageGroup: String(profile.ageGroup || "18–24").slice(0, 16),
    country: String(profile.country || "Hidden").slice(0, 56),
    chatPreference: "Text",
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
    mode: "Text",
    createdAt: now(),
    buffer: [],
    games: {
      tictactoe: null,
      rps: {
        choices: {},
        scores: { [a.id]: 0, [b.id]: 0 },
        lastResult: null
      }
    }
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

  sendRpsState(room);
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
    client.typingState = false;
    return;
  }

  const other = otherClient(room, client);
  rooms.delete(room.id);

  client.roomId = null;
  client.state = "idle";
  client.typingState = false;

  if (other) {
    other.roomId = null;
    other.state = "idle";
    other.typingState = false;
    send(other.ws, "stranger:left", { reason });
  }
}

function limited(client, key, limit) {
  const current = now();
  client[key] = client[key].filter((t) => current - t < limit.windowMs);
  if (client[key].length >= limit.max) return true;
  client[key].push(current);
  return false;
}

function rateLimited(client) {
  return limited(client, "messageHits", MESSAGE_RATE_LIMIT);
}

function mediaRateLimited(client) {
  return limited(client, "mediaHits", MEDIA_RATE_LIMIT);
}

function relayChat(client, rawText) {
  const room = rooms.get(client.roomId);
  if (!room) return sendError(client.ws, "You are not connected to a stranger.");
  if (rateLimited(client)) return sendError(client.ws, "You are sending messages too fast.");

  const text = String(rawText || "").trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!text) return;

  const other = otherClient(room, client);
  if (!other) return;

  room.buffer.push({ kind: "text", from: client.id, text, ts: now() });
  if (room.buffer.length > 20) room.buffer.shift();

  client.typingState = false;
  send(other.ws, "chat:typing", { isTyping: false });
  send(other.ws, "chat:message", { text });
}

function validateMedia(rawMedia = {}) {
  const dataUrl = String(rawMedia.dataUrl || "");
  const mime = String(rawMedia.mime || "").toLowerCase();
  const name = String(rawMedia.name || "shared-image").replace(/[<>]/g, "").slice(0, 80);
  const size = Number(rawMedia.size || 0);
  const allowed = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

  if (!allowed.has(mime)) return { error: "Only PNG, JPG, WEBP, and GIF images are allowed." };
  if (!dataUrl.startsWith(`data:${mime};base64,`)) return { error: "Invalid image data." };

  const base64 = dataUrl.split(",")[1] || "";
  if (!/^[a-z0-9+/=]+$/i.test(base64)) return { error: "Invalid image encoding." };

  const bytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  if (bytes <= 0 || bytes > MAX_MEDIA_BYTES || size > MAX_MEDIA_BYTES) {
    return { error: "Image is too large. Maximum size is 1 MB." };
  }

  return { media: { dataUrl, mime, name, size: bytes } };
}

function relayMedia(client, rawMedia) {
  const room = rooms.get(client.roomId);
  if (!room) return sendError(client.ws, "You are not connected to a stranger.");
  if (mediaRateLimited(client)) return sendError(client.ws, "You are sending images too fast.");

  const result = validateMedia(rawMedia);
  if (result.error) return sendError(client.ws, result.error);

  const other = otherClient(room, client);
  if (!other) return;

  const media = result.media;
  room.buffer.push({
    kind: "media",
    from: client.id,
    media: { name: media.name, mime: media.mime, size: media.size },
    ts: now()
  });
  if (room.buffer.length > 20) room.buffer.shift();

  client.typingState = false;
  send(other.ws, "chat:typing", { isTyping: false });
  send(other.ws, "chat:media", { media });
}

function relayTyping(client, isTyping) {
  const room = rooms.get(client.roomId);
  if (!room) return;

  const nextState = Boolean(isTyping);
  if (client.typingState === nextState) return;

  client.typingState = nextState;
  const other = otherClient(room, client);
  if (!other) return;
  send(other.ws, "chat:typing", { isTyping: nextState });
}

function reportUser(client, reason) {
  const room = rooms.get(client.roomId);
  if (!room) return sendError(client.ws, "There is no active room to report.");
  const other = otherClient(room, client);

  reports.push({
    id: id("report"),
    roomId: room.id,
    reason: String(reason || "No reason provided").slice(0, 280),
    reporterAccountId: client.account?.id || null,
    reportedAccountId: other?.account?.id || null,
    reporterProfile: safeProfile(client.profile),
    reportedProfile: safeProfile(other?.profile),
    evidenceSnapshot: room.buffer.slice(-20),
    createdAt: new Date().toISOString()
  });

  send(client.ws, "report:received", {
    message: "Report received. You can skip or end this chat now."
  });
}

function checkTicTacToeWinner(board) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return null;
}

function tttView(room, client) {
  const game = room.games.tictactoe;
  if (!game) return null;
  const yourSymbol = game.symbols[client.id];
  const stranger = otherClient(room, client);
  const strangerSymbol = stranger ? game.symbols[stranger.id] : null;
  const turnSymbol = game.turn ? game.symbols[game.turn] : null;
  return {
    active: true,
    board: game.board,
    yourSymbol,
    strangerSymbol,
    turnSymbol,
    isYourTurn: game.turn === client.id && !game.winnerSymbol && !game.draw,
    winnerSymbol: game.winnerSymbol,
    draw: game.draw
  };
}

function sendTttState(room) {
  send(room.a.ws, "game:tictactoe:state", { game: tttView(room, room.a) });
  send(room.b.ws, "game:tictactoe:state", { game: tttView(room, room.b) });
}

function startTicTacToe(client) {
  const room = rooms.get(client.roomId);
  if (!room) return sendError(client.ws, "There is no active room.");
  const other = otherClient(room, client);
  if (!other) return sendError(client.ws, "There is no stranger in this room.");

  room.games.tictactoe = {
    board: Array(9).fill(null),
    turn: client.id,
    symbols: { [client.id]: "X", [other.id]: "O" },
    winnerSymbol: null,
    draw: false,
    startedAt: now()
  };

  room.buffer.push({ kind: "game", from: client.id, text: "Started Tic-Tac-Toe.", ts: now() });
  if (room.buffer.length > 20) room.buffer.shift();
  sendTttState(room);
}

function moveTicTacToe(client, rawIndex) {
  const room = rooms.get(client.roomId);
  if (!room?.games?.tictactoe) return sendError(client.ws, "Start Tic-Tac-Toe first.");
  const game = room.games.tictactoe;
  const index = Number(rawIndex);

  if (!Number.isInteger(index) || index < 0 || index > 8) return sendError(client.ws, "Invalid move.");
  if (game.winnerSymbol || game.draw) return sendError(client.ws, "This round is already over.");
  if (game.turn !== client.id) return sendError(client.ws, "It is not your turn.");
  if (game.board[index]) return sendError(client.ws, "That box is already taken.");

  game.board[index] = game.symbols[client.id];
  game.winnerSymbol = checkTicTacToeWinner(game.board);
  game.draw = !game.winnerSymbol && game.board.every(Boolean);

  if (!game.winnerSymbol && !game.draw) {
    const other = otherClient(room, client);
    game.turn = other.id;
  }

  sendTttState(room);
}

function resetTicTacToe(client) {
  startTicTacToe(client);
}

function rpsWinner(a, b) {
  if (a === b) return "draw";
  if ((a === "rock" && b === "scissors") || (a === "paper" && b === "rock") || (a === "scissors" && b === "paper")) return "a";
  return "b";
}

function rpsView(room, client) {
  if (!room.games.rps) {
    room.games.rps = { choices: {}, scores: { [room.a.id]: 0, [room.b.id]: 0 }, lastResult: null };
  }
  const game = room.games.rps;
  const other = otherClient(room, client);
  const bothChosen = Boolean(game.choices[client.id] && other && game.choices[other.id]);
  const result = bothChosen ? game.lastResult?.[client.id] || "Round complete." : "Choose one. Result appears after both choose.";
  return {
    yourChoice: game.choices[client.id] || "",
    strangerChoice: bothChosen && other ? game.choices[other.id] || "" : "",
    strangerReady: Boolean(other && game.choices[other.id]),
    result,
    yourScore: game.scores[client.id] || 0,
    strangerScore: other ? game.scores[other.id] || 0 : 0
  };
}

function sendRpsState(room) {
  send(room.a.ws, "game:rps:state", { game: rpsView(room, room.a) });
  send(room.b.ws, "game:rps:state", { game: rpsView(room, room.b) });
}

function chooseRps(client, choice) {
  const room = rooms.get(client.roomId);
  if (!room) return sendError(client.ws, "There is no active room.");

  const safeChoice = String(choice || "").toLowerCase();
  if (!["rock", "paper", "scissors"].includes(safeChoice)) return sendError(client.ws, "Invalid choice.");

  if (!room.games.rps) {
    room.games.rps = { choices: {}, scores: { [room.a.id]: 0, [room.b.id]: 0 }, lastResult: null };
  }

  const game = room.games.rps;
  const other = otherClient(room, client);
  if (!other) return sendError(client.ws, "There is no stranger in this room.");

  game.choices[client.id] = safeChoice;

  if (game.choices[room.a.id] && game.choices[room.b.id]) {
    const outcome = rpsWinner(game.choices[room.a.id], game.choices[room.b.id]);
    if (outcome === "draw") {
      game.lastResult = { [room.a.id]: "Draw round.", [room.b.id]: "Draw round." };
    } else {
      const winner = outcome === "a" ? room.a : room.b;
      const loser = outcome === "a" ? room.b : room.a;
      game.scores[winner.id] = (game.scores[winner.id] || 0) + 1;
      game.lastResult = { [winner.id]: "You won this round.", [loser.id]: "Stranger won this round." };
    }
  } else {
    game.lastResult = null;
  }

  sendRpsState(room);
}

function resetRps(client) {
  const room = rooms.get(client.roomId);
  if (!room) return sendError(client.ws, "There is no active room.");
  const scores = room.games.rps?.scores || { [room.a.id]: 0, [room.b.id]: 0 };
  room.games.rps = { choices: {}, scores, lastResult: null };
  sendRpsState(room);
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
      relayChat(client, payload.text);
      break;

    case "chat:media":
      relayMedia(client, payload.media);
      break;

    case "chat:typing":
      relayTyping(client, payload.isTyping);
      break;

    case "chat:leave":
      leaveRoom(client, "left");
      break;

    case "match:skip":
      leaveRoom(client, "skipped");
      break;

    case "report:user":
      reportUser(client, payload.reason);
      break;

    case "game:tictactoe:start":
      startTicTacToe(client);
      break;

    case "game:tictactoe:reset":
      resetTicTacToe(client);
      break;

    case "game:tictactoe:move":
      moveTicTacToe(client, payload.index);
      break;

    case "game:rps:choose":
      chooseRps(client, payload.choice);
      break;

    case "game:rps:reset":
      resetRps(client);
      break;

    default:
      sendError(client.ws, `Unknown event: ${type}`);
  }
}

function serveStatic(req, res) {
  if (req.method === "OPTIONS") {
    return json(res, 200, { ok: true });
  }

  const parsed = new URL(req.url, `http://${req.headers.host}`);

  if (parsed.pathname === "/api/health" && req.method === "GET") {
    return json(res, 200, {
      ok: true,
      online: clients.size,
      rooms: rooms.size,
      waiting: waiting.length,
      reports: reports.length,
      googleAuthConfigured: Boolean(GOOGLE_CLIENT_ID),
      features: ["text-chat", "image-sharing", "tic-tac-toe", "rock-paper-scissors"]
    });
  }

  if (parsed.pathname === "/api/auth/google" && req.method === "POST") {
    return handleGoogleAuth(req, res);
  }

  let requested = decodeURIComponent(parsed.pathname);
  if (requested === "/") requested = "/index.html";

  const filePath = path.join(CLIENT_DIST, requested);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(CLIENT_DIST)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  const target = fs.existsSync(resolved) && fs.statSync(resolved).isFile()
    ? resolved
    : path.join(CLIENT_DIST, "index.html");

  if (!fs.existsSync(target)) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("VANISH backend is running. Build the frontend with npm run build.");
  }

  const ext = path.extname(target).toLowerCase();
  const contentType = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon"
  }[ext] || "application/octet-stream";

  res.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(target).pipe(res);
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server, maxPayload: 2 * 1024 * 1024 });

wss.on("connection", (ws, req) => {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  const token = parsed.searchParams.get("token") || "";
  const account = token ? sessions.get(token) || null : null;

  const client = {
    id: id("client"),
    ws,
    account,
    profile: null,
    roomId: null,
    state: "idle",
    queuedAt: null,
    messageHits: [],
    mediaHits: [],
    typingState: false,
    connectedAt: now()
  };

  clients.set(ws, client);
  send(ws, "server:hello", {
    clientId: client.id,
    online: clients.size,
    account: account ? publicUser(account) : null
  });

  ws.on("message", (raw) => handleMessage(client, raw));

  ws.on("close", () => {
    removeFromQueue(client);
    leaveRoom(client, "disconnected");
    clients.delete(ws);
  });
});

setInterval(() => {
  cleanQueue();
  for (const ws of clients.keys()) {
    send(ws, "server:stats", {
      online: clients.size,
      waiting: waiting.length,
      rooms: rooms.size
    });
  }
}, 15_000);

server.listen(PORT, () => {
  console.log(`VANISH server running on port ${PORT}`);
  console.log(`Google login configured: ${Boolean(GOOGLE_CLIENT_ID)}`);
});
