import { useEffect, useMemo, useRef, useState } from "react";

const AGE_GROUPS = ["18–24", "25–34", "35–44", "45+"];
const GENDERS = ["Male", "Female", "Non-binary", "Prefer not to say"];
const INTERESTS = ["Music", "Gaming", "Movies", "Books", "Coding", "Travel", "Food", "Sports", "Art", "Anime", "Fitness", "Startups"];
const COUNTRIES = [
  "Bangladesh", "United States", "India", "Pakistan", "Nepal", "Sri Lanka", "United Kingdom", "Canada", "Australia",
  "Germany", "France", "Italy", "Spain", "Netherlands", "Sweden", "Norway", "Denmark", "Finland", "Ireland",
  "United Arab Emirates", "Saudi Arabia", "Qatar", "Kuwait", "Malaysia", "Singapore", "Indonesia", "Philippines",
  "Japan", "South Korea", "China", "Thailand", "Vietnam", "Turkey", "Egypt", "South Africa", "Nigeria", "Brazil",
  "Mexico", "Argentina", "Other"
];
const ALIASES = ["Cipher", "Ghost", "Nova", "Echo", "Raven", "Drift", "Myst", "Void", "Astra", "Pixel", "Orbit", "Frost"];
const STORAGE_KEY = "vanish_session_v2";
const MAX_MEDIA_BYTES = 1_000_000;
const ALLOWED_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

function randomAlias() {
  const base = ALIASES[Math.floor(Math.random() * ALIASES.length)];
  return `${base}#${Math.floor(1000 + Math.random() * 9000)}`;
}

function defaultWsUrl(sessionToken) {
  const fromEnv = import.meta.env.VITE_WS_URL;
  let base;

  if (fromEnv) {
    base = fromEnv;
  } else {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const isLocalhost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const host = isLocalhost && window.location.port !== "3001"
      ? `${window.location.hostname}:3001`
      : window.location.host;
    base = `${protocol}//${host}`;
  }

  if (!sessionToken) return base;
  const joiner = base.includes("?") ? "&" : "?";
  return `${base}${joiner}token=${encodeURIComponent(sessionToken)}`;
}

function apiUrl(path) {
  const base = import.meta.env.VITE_API_URL || "";
  return `${base}${path}`;
}

function getStoredSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function clearStoredSession() {
  localStorage.removeItem(STORAGE_KEY);
}

function sanitizeProfile(profile) {
  return {
    displayName: profile.displayName.trim() || randomAlias(),
    gender: profile.gender,
    ageGroup: profile.ageGroup,
    country: profile.country,
    chatPreference: "Text",
    interests: profile.interests.slice(0, 8)
  };
}

function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusDot({ status }) {
  return <span className={`status-dot ${status}`} />;
}

function Chip({ label, active, onClick }) {
  return (
    <button type="button" className={`chip ${active ? "active" : ""}`} onClick={onClick}>
      {label}
    </button>
  );
}

function GoogleButton({ onSuccess, onError }) {
  const ref = useRef(null);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

  useEffect(() => {
    if (!clientId || !ref.current) return;

    let cancelled = false;

    function renderButton() {
      if (cancelled || !window.google?.accounts?.id || !ref.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (response) => {
          try {
            const res = await fetch(apiUrl("/api/auth/google"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ credential: response.credential })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || "Google login failed");
            onSuccess(data);
          } catch (error) {
            onError(error.message || "Google login failed");
          }
        }
      });
      window.google.accounts.id.renderButton(ref.current, {
        theme: "filled_black",
        size: "large",
        shape: "pill",
        text: "continue_with",
        width: 320
      });
    }

    if (window.google?.accounts?.id) {
      renderButton();
      return () => { cancelled = true; };
    }

    const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener("load", renderButton, { once: true });
      return () => { cancelled = true; existing.removeEventListener("load", renderButton); };
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = renderButton;
    script.onerror = () => onError("Could not load Google sign-in script.");
    document.head.appendChild(script);

    return () => {
      cancelled = true;
    };
  }, [clientId, onError, onSuccess]);

  if (!clientId) {
    return (
      <div className="google-missing">
        <strong>Google login is not configured.</strong>
        <span>Add VITE_GOOGLE_CLIENT_ID in Render environment variables.</span>
      </div>
    );
  }

  return <div className="google-button" ref={ref} />;
}

function LoginScreen({ onLogin }) {
  const [error, setError] = useState("");

  const handleGoogleSuccess = (data) => {
    const session = {
      sessionToken: data.sessionToken,
      user: data.user
    };
    saveSession(session);
    onLogin(session);
  };

  const handleGuest = () => {
    const guest = {
      sessionToken: "",
      user: {
        name: "Guest User",
        email: "guest@vanish.local",
        picture: "",
        provider: "guest"
      }
    };
    onLogin(guest);
  };

  return (
    <section className="screen center-screen login-screen">
      <div className="brand-mark">V</div>
      <p className="eyebrow">ANONYMOUS STRANGER CHAT</p>
      <h1>VANISH</h1>
      <p className="hero-copy">
        Sign in to manage your account dashboard, then chat anonymously with strangers using only your VANISH profile.
      </p>

      <div className="login-card">
        <GoogleButton onSuccess={handleGoogleSuccess} onError={setError} />
        <button className="secondary-btn wide" onClick={handleGuest}>Continue as guest for testing</button>
        {error ? <p className="error-box">{error}</p> : null}
      </div>

      <div className="privacy-note">
        <strong>Privacy rule:</strong> your Google name and email stay in your account dashboard. Strangers only see your display name, gender, age group, country, interests, chat messages, game moves, and images you manually send.
      </div>
    </section>
  );
}

function Dashboard({ account, profile, setProfile, status, online, onFind, onLogout }) {
  const valid = profile.displayName.trim() && profile.gender && profile.ageGroup && profile.country;

  const toggleInterest = (interest) => {
    setProfile((p) => ({
      ...p,
      interests: p.interests.includes(interest)
        ? p.interests.filter((x) => x !== interest)
        : [...p.interests, interest]
    }));
  };

  return (
    <section className="screen dashboard-screen">
      <div className="dashboard-header">
        <div>
          <p className="eyebrow">DASHBOARD</p>
          <h2>Welcome to VANISH</h2>
          <p className="muted">Create your anonymous public profile before matching.</p>
        </div>
        <div className="account-card mini">
          {account.picture ? <img src={account.picture} alt="Google profile" /> : <div className="avatar-fallback">{(account.name || "G").slice(0, 1)}</div>}
          <div>
            <strong>{account.name || "Guest User"}</strong>
            <span>{account.email || "Guest mode"}</span>
          </div>
          <button className="small-btn" onClick={onLogout}>Logout</button>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="panel profile-panel">
          <div className="panel-title">
            <div>
              <p className="eyebrow">PROFILE</p>
              <h3>Anonymous public identity</h3>
            </div>
            <button className="small-btn" onClick={() => setProfile((p) => ({ ...p, displayName: randomAlias() }))}>Random name</button>
          </div>

          <label className="field-label">Display name</label>
          <input
            value={profile.displayName}
            maxLength={24}
            onChange={(e) => setProfile((p) => ({ ...p, displayName: e.target.value }))}
            placeholder="Example: Ghost#1942"
          />
          <p className="hint">Only this name appears to your stranger.</p>

          <label className="field-label">Gender</label>
          <div className="chip-wrap">{GENDERS.map((x) => <Chip key={x} label={x} active={profile.gender === x} onClick={() => setProfile((p) => ({ ...p, gender: x }))} />)}</div>

          <label className="field-label">Age group</label>
          <div className="chip-wrap">{AGE_GROUPS.map((x) => <Chip key={x} label={x} active={profile.ageGroup === x} onClick={() => setProfile((p) => ({ ...p, ageGroup: x }))} />)}</div>

          <label className="field-label">Country</label>
          <select value={profile.country} onChange={(e) => setProfile((p) => ({ ...p, country: e.target.value }))}>
            <option value="">Select country</option>
            {COUNTRIES.map((country) => <option key={country} value={country}>{country}</option>)}
          </select>
          <p className="hint">Country is used for matching. City, GPS, IP, and exact location are never shown.</p>

          <label className="field-label">Interests <span>optional</span></label>
          <div className="chip-wrap">{INTERESTS.map((x) => <Chip key={x} label={x} active={profile.interests.includes(x)} onClick={() => toggleInterest(x)} />)}</div>
        </div>

        <div className="panel stack-panel">
          <div className="stat-grid">
            <div className="stat-card">
              <span>Realtime server</span>
              <strong><StatusDot status={status} /> {status}</strong>
            </div>
            <div className="stat-card">
              <span>Online users</span>
              <strong>{online}</strong>
            </div>
            <div className="stat-card">
              <span>Mode</span>
              <strong>Text + Games</strong>
            </div>
          </div>

          <div className="summary-box">
            <p className="eyebrow">PUBLIC PREVIEW</p>
            <h3>{profile.displayName || "No display name"}</h3>
            <div className="summary-tags">
              {[profile.gender, profile.ageGroup, profile.country, "Text", ...profile.interests.slice(0, 5)].filter(Boolean).map((x) => <span key={x}>{x}</span>)}
            </div>
          </div>

          <div className="safety-box">
            <p className="eyebrow">FEATURES</p>
            <ul>
              <li>Text-only anonymous stranger chat.</li>
              <li>Image sharing with size and type checks.</li>
              <li>Interactive Tic-Tac-Toe and Rock Paper Scissors.</li>
              <li>Skip, end, and report controls are always available.</li>
            </ul>
          </div>

          <div className="drive-box">
            <p className="eyebrow">GOOGLE DRIVE</p>
            <h3>Not connected</h3>
            <p>
              VANISH does not request Drive access. Drive access must only be added later with a clear permission screen and a user-clicked consent button.
            </p>
          </div>

          <button className="primary-btn wide" disabled={!valid || status !== "connected"} onClick={onFind}>
            {status !== "connected" ? "Waiting for backend..." : valid ? "Find a stranger" : "Complete profile first"}
          </button>
        </div>
      </div>
    </section>
  );
}

function Matching({ profile, status, onCancel }) {
  return (
    <section className="screen center-screen">
      <div className="scanner"><span /><span /><span /><div>⌁</div></div>
      <p className="eyebrow">MATCHMAKING</p>
      <h2>Looking for a stranger</h2>
      <p className="hero-copy">Same country is preferred first, then VANISH falls back to global text matching.</p>
      <div className="summary-card">
        {[profile.displayName, profile.gender, profile.ageGroup, profile.country, "Text", ...profile.interests.slice(0, 4)].filter(Boolean).map((x) => <span key={x}>{x}</span>)}
      </div>
      <button className="secondary-btn" onClick={onCancel}>Cancel</button>
      <p className="connection-line"><StatusDot status={status} /> {status}</p>
    </section>
  );
}

function MessageBubble({ message }) {
  if (message.type === "system") return <p className="system-message">— {message.text} —</p>;
  const mine = message.type === "me";
  const isMedia = message.kind === "media";

  return (
    <div className={`message-row ${mine ? "mine" : "theirs"}`}>
      <div className={`message-bubble ${isMedia ? "media-bubble" : ""}`}>
        {isMedia ? (
          <div className="media-message">
            <img src={message.media.dataUrl} alt={message.media.name || "Shared image"} loading="lazy" />
            <span>{message.media.name || "Shared image"} • {formatBytes(message.media.size)}</span>
          </div>
        ) : message.text}
      </div>
    </div>
  );
}

function winnerLine(board) {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];
  return lines.find(([a, b, c]) => board[a] && board[a] === board[b] && board[a] === board[c]) || [];
}

function TicTacToe({ game, onStart, onMove, onReset }) {
  const board = game?.board || Array(9).fill(null);
  const active = Boolean(game?.active);
  const winning = winnerLine(board);

  let status = "Start a round with your stranger.";
  if (active) {
    if (game.winnerSymbol) status = game.winnerSymbol === game.yourSymbol ? "You won this round." : "Stranger won this round.";
    else if (game.draw) status = "Draw round.";
    else status = game.isYourTurn ? `Your turn (${game.yourSymbol})` : `Stranger's turn (${game.turnSymbol})`;
  }

  return (
    <div className="game-card">
      <div className="game-title">
        <div>
          <strong>Tic-Tac-Toe</strong>
          <span>{status}</span>
        </div>
        <button className="small-btn" onClick={active ? onReset : onStart}>{active ? "Restart" : "Start"}</button>
      </div>
      <div className="ttt-board">
        {board.map((cell, index) => (
          <button
            key={index}
            className={winning.includes(index) ? "winner" : ""}
            disabled={!active || !game?.isYourTurn || Boolean(cell) || Boolean(game?.winnerSymbol) || Boolean(game?.draw)}
            onClick={() => onMove(index)}
          >
            {cell || ""}
          </button>
        ))}
      </div>
    </div>
  );
}

function RockPaperScissors({ game, onChoose, onReset }) {
  const choices = ["rock", "paper", "scissors"];
  const emoji = { rock: "✊", paper: "✋", scissors: "✌️" };

  return (
    <div className="game-card">
      <div className="game-title">
        <div>
          <strong>Rock Paper Scissors</strong>
          <span>{game?.result || "Choose one. Result appears after both choose."}</span>
        </div>
        <button className="small-btn" onClick={onReset}>New round</button>
      </div>
      <div className="rps-grid">
        {choices.map((choice) => (
          <button key={choice} className={game?.yourChoice === choice ? "active" : ""} onClick={() => onChoose(choice)}>
            <span>{emoji[choice]}</span>
            {choice}
          </button>
        ))}
      </div>
      <div className="rps-result">
        <span>You: {game?.yourChoice ? `${emoji[game.yourChoice]} ${game.yourChoice}` : "waiting"}</span>
        <span>Stranger: {game?.strangerChoice ? `${emoji[game.strangerChoice]} ${game.strangerChoice}` : (game?.strangerReady ? "chosen" : "waiting")}</span>
      </div>
      <div className="score-line">Score — You {game?.yourScore || 0} : {game?.strangerScore || 0} Stranger</div>
    </div>
  );
}

function GamePanel({ tttGame, rpsGame, onStartTtt, onMoveTtt, onResetTtt, onRpsChoose, onRpsReset }) {
  return (
    <aside className="game-panel">
      <div className="panel-title compact">
        <div>
          <p className="eyebrow">GAMES</p>
          <h3>Play while chatting</h3>
        </div>
      </div>
      <TicTacToe game={tttGame} onStart={onStartTtt} onMove={onMoveTtt} onReset={onResetTtt} />
      <RockPaperScissors game={rpsGame} onChoose={onRpsChoose} onReset={onRpsReset} />
    </aside>
  );
}

function Chat({
  stranger,
  messages,
  input,
  setInput,
  onSend,
  onMediaSelect,
  onNext,
  onEnd,
  onReport,
  timer,
  messagesEndRef,
  typing,
  mediaError,
  tttGame,
  rpsGame,
  onStartTtt,
  onMoveTtt,
  onResetTtt,
  onRpsChoose,
  onRpsReset
}) {
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState("Harassment or abusive behavior");
  const fileRef = useRef(null);

  const submitReport = () => {
    onReport(reason);
    setReportOpen(false);
  };

  return (
    <section className="chat-shell with-games">
      <div className="chat-main">
        <header className="chat-header">
          <div>
            <p className="eyebrow">CONNECTED</p>
            <h2>{stranger?.displayName || "Stranger"}</h2>
            <p className="muted">
              {[stranger?.gender, stranger?.ageGroup, stranger?.country, "Text"].filter(Boolean).join(" • ")}
            </p>
          </div>
          <div className="chat-actions">
            <div className="timer">{formatTime(timer)}</div>
            <button className="secondary-btn" onClick={onNext}>Next</button>
            <button className="danger-btn" onClick={onEnd}>End</button>
          </div>
        </header>

        <main className="message-list">
          {messages.map((m) => <MessageBubble key={m.id} message={m} />)}
          {typing ? <p className="system-message typing-indicator">— Stranger is typing... —</p> : null}
          <div ref={messagesEndRef} />
        </main>

        <footer className="composer">
          <button className="report-btn" onClick={() => setReportOpen((x) => !x)}>Report</button>
          <button className="secondary-btn attach-btn" type="button" onClick={() => fileRef.current?.click()}>Image</button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onMediaSelect} />
          <form onSubmit={onSend} className="composer-form">
            <input value={input} maxLength={1500} onChange={(e) => setInput(e.target.value)} placeholder="Type a message..." autoFocus />
            <button className="primary-btn" type="submit">Send</button>
          </form>
        </footer>
        {mediaError ? <p className="media-error">{mediaError}</p> : null}
      </div>

      <GamePanel
        tttGame={tttGame}
        rpsGame={rpsGame}
        onStartTtt={onStartTtt}
        onMoveTtt={onMoveTtt}
        onResetTtt={onResetTtt}
        onRpsChoose={onRpsChoose}
        onRpsReset={onRpsReset}
      />

      {reportOpen ? (
        <div className="report-modal">
          <div className="report-card">
            <h3>Report stranger</h3>
            <p className="muted">A short temporary evidence snapshot will be saved for moderation.</p>
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              <option>Harassment or abusive behavior</option>
              <option>Spam or scam</option>
              <option>Sexual content</option>
              <option>Hate or threats</option>
              <option>Other safety issue</option>
            </select>
            <div className="modal-actions">
              <button className="secondary-btn" onClick={() => setReportOpen(false)}>Cancel</button>
              <button className="danger-btn" onClick={submitReport}>Submit report</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default function App() {
  const [session, setSession] = useState(() => getStoredSession());
  const [status, setStatus] = useState("disconnected");
  const [online, setOnline] = useState(0);
  const [screen, setScreen] = useState(() => getStoredSession() ? "dashboard" : "login");
  const [profile, setProfile] = useState(() => ({
    displayName: randomAlias(),
    gender: "",
    ageGroup: "",
    country: "",
    chatPreference: "Text",
    interests: []
  }));
  const [stranger, setStranger] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [timer, setTimer] = useState(0);
  const [typing, setTyping] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [tttGame, setTttGame] = useState(null);
  const [rpsGame, setRpsGame] = useState(null);

  const wsRef = useRef(null);
  const roomRef = useRef(null);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const lastTypingSentRef = useRef(false);

  const sanitizedProfile = useMemo(() => sanitizeProfile(profile), [profile]);

  const addSystem = (text) => {
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), type: "system", text }]);
  };

  const resetRoomState = () => {
    setTyping(false);
    setMediaError("");
    setTttGame(null);
    setRpsGame(null);
    lastTypingSentRef.current = false;
  };

  const sendWs = (type, payload = {}) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type, payload }));
    return true;
  };

  useEffect(() => {
    if (!session) return;

    let closedByEffect = false;
    let reconnectTimer;

    function connect() {
      setStatus("connecting");
      const ws = new WebSocket(defaultWsUrl(session.sessionToken));
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("connected");
      };

      ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        const payload = msg.payload || {};

        switch (msg.type) {
          case "server:hello":
          case "server:stats":
            setOnline(payload.online || 0);
            break;

          case "queue:waiting":
            setOnline(payload.online || online);
            setScreen("matching");
            break;

          case "queue:cancelled":
            setScreen("dashboard");
            break;

          case "match:found":
            roomRef.current = payload.roomId;
            setRoomId(payload.roomId);
            setStranger(payload.stranger);
            setMessages([{ id: crypto.randomUUID(), type: "system", text: `Matched with ${payload.stranger?.displayName || "a stranger"}` }]);
            resetRoomState();
            setTimer(0);
            setScreen("chat");
            break;

          case "chat:message":
            setTyping(false);
            setMessages((prev) => [...prev, { id: crypto.randomUUID(), type: "them", kind: "text", text: payload.text }]);
            break;

          case "chat:media":
            setTyping(false);
            setMessages((prev) => [...prev, { id: crypto.randomUUID(), type: "them", kind: "media", media: payload.media }]);
            break;

          case "chat:typing":
            setTyping(Boolean(payload.isTyping));
            break;

          case "game:tictactoe:state":
            setTttGame(payload.game || null);
            break;

          case "game:rps:state":
            setRpsGame(payload.game || null);
            break;

          case "stranger:left":
            resetRoomState();
            roomRef.current = null;
            setRoomId(null);
            setStranger(null);
            addSystem(payload.reason === "skipped" ? "Stranger skipped this chat." : "Stranger left the chat.");
            setScreen("dashboard");
            break;

          case "report:received":
            addSystem(payload.message || "Report received.");
            break;

          case "error":
            setMediaError(payload.message || "Something went wrong.");
            addSystem(payload.message || "Something went wrong.");
            break;

          default:
            break;
        }
      };

      ws.onclose = () => {
        setStatus("disconnected");
        if (!closedByEffect) reconnectTimer = setTimeout(connect, 1500);
      };

      ws.onerror = () => {
        setStatus("disconnected");
      };
    }

    connect();

    return () => {
      closedByEffect = true;
      clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, [session]);

  useEffect(() => {
    if (screen !== "chat") return;
    const interval = setInterval(() => setTimer((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [screen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  useEffect(() => {
    if (screen !== "chat" || !roomRef.current) return;
    const text = input.trim();

    clearTimeout(typingTimeoutRef.current);

    if (!text) {
      if (lastTypingSentRef.current) {
        sendWs("chat:typing", { roomId: roomRef.current, isTyping: false });
        lastTypingSentRef.current = false;
      }
      return;
    }

    if (!lastTypingSentRef.current) {
      sendWs("chat:typing", { roomId: roomRef.current, isTyping: true });
      lastTypingSentRef.current = true;
    }

    typingTimeoutRef.current = setTimeout(() => {
      sendWs("chat:typing", { roomId: roomRef.current, isTyping: false });
      lastTypingSentRef.current = false;
    }, 900);

    return () => clearTimeout(typingTimeoutRef.current);
  }, [input, screen]);

  const handleLogin = (nextSession) => {
    setSession(nextSession);
    setScreen("dashboard");
  };

  const handleLogout = () => {
    sendWs("queue:cancel");
    if (roomRef.current) sendWs("chat:leave", { roomId: roomRef.current });
    clearStoredSession();
    setSession(null);
    setScreen("login");
    setStatus("disconnected");
    setRoomId(null);
    setStranger(null);
    setMessages([]);
    resetRoomState();
    wsRef.current?.close();
  };

  const findStranger = () => {
    setMessages([]);
    resetRoomState();
    sendWs("match:find", { profile: sanitizedProfile });
    setScreen("matching");
  };

  const cancelMatching = () => {
    sendWs("queue:cancel");
    setScreen("dashboard");
  };

  const sendMessage = (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || !roomRef.current) return;

    sendWs("chat:typing", { roomId: roomRef.current, isTyping: false });
    lastTypingSentRef.current = false;
    sendWs("chat:message", { roomId: roomRef.current, text });
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), type: "me", kind: "text", text }]);
    setInput("");
  };

  const handleMediaSelect = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    setMediaError("");
    if (!file || !roomRef.current) return;

    if (!ALLOWED_MEDIA_TYPES.includes(file.type)) {
      setMediaError("Only PNG, JPG, WEBP, and GIF images are allowed.");
      return;
    }

    if (file.size > MAX_MEDIA_BYTES) {
      setMediaError(`Image is too large. Maximum size is ${formatBytes(MAX_MEDIA_BYTES)}.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const media = {
        dataUrl: String(reader.result || ""),
        name: file.name.slice(0, 80),
        mime: file.type,
        size: file.size
      };
      sendWs("chat:media", { roomId: roomRef.current, media });
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), type: "me", kind: "media", media }]);
    };
    reader.onerror = () => setMediaError("Could not read this image.");
    reader.readAsDataURL(file);
  };

  const nextStranger = () => {
    resetRoomState();
    sendWs("match:skip", { roomId });
    setStranger(null);
    setRoomId(null);
    roomRef.current = null;
    setMessages([]);
    setTimer(0);
    setScreen("matching");
    setTimeout(() => sendWs("match:find", { profile: sanitizedProfile }), 80);
  };

  const endChat = () => {
    resetRoomState();
    sendWs("chat:leave", { roomId });
    setStranger(null);
    setRoomId(null);
    roomRef.current = null;
    setMessages([]);
    setTimer(0);
    setScreen("dashboard");
  };

  const report = (reason) => {
    sendWs("report:user", { roomId, reason });
  };

  const startTtt = () => sendWs("game:tictactoe:start", { roomId: roomRef.current });
  const resetTtt = () => sendWs("game:tictactoe:reset", { roomId: roomRef.current });
  const moveTtt = (index) => sendWs("game:tictactoe:move", { roomId: roomRef.current, index });
  const chooseRps = (choice) => sendWs("game:rps:choose", { roomId: roomRef.current, choice });
  const resetRps = () => sendWs("game:rps:reset", { roomId: roomRef.current });

  if (!session || screen === "login") {
    return <LoginScreen onLogin={handleLogin} />;
  }

  if (screen === "matching") {
    return <Matching profile={sanitizedProfile} status={status} onCancel={cancelMatching} />;
  }

  if (screen === "chat") {
    return (
      <Chat
        stranger={stranger}
        messages={messages}
        input={input}
        setInput={setInput}
        onSend={sendMessage}
        onMediaSelect={handleMediaSelect}
        onNext={nextStranger}
        onEnd={endChat}
        onReport={report}
        timer={timer}
        messagesEndRef={messagesEndRef}
        typing={typing}
        mediaError={mediaError}
        tttGame={tttGame}
        rpsGame={rpsGame}
        onStartTtt={startTtt}
        onMoveTtt={moveTtt}
        onResetTtt={resetTtt}
        onRpsChoose={chooseRps}
        onRpsReset={resetRps}
      />
    );
  }

  return (
    <Dashboard
      account={session.user}
      profile={profile}
      setProfile={setProfile}
      status={status}
      online={online}
      onFind={findStranger}
      onLogout={handleLogout}
    />
  );
}
