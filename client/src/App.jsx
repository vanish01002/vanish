import { useEffect, useMemo, useRef, useState } from "react";

const AGE_GROUPS = ["18–24", "25–34", "35–44", "45+"];
const GENDERS = ["Male", "Female", "Non-binary", "Prefer not to say"];
const CHAT_PREFS = ["Text", "Voice", "Video"];
const INTERESTS = ["Music", "Gaming", "Movies", "Books", "Coding", "Travel", "Food", "Sports", "Art", "Anime", "Fitness", "Startups"];
const COUNTRIES = [
  "Bangladesh", "United States", "India", "Pakistan", "Nepal", "Sri Lanka", "United Kingdom", "Canada", "Australia",
  "Germany", "France", "Italy", "Spain", "Netherlands", "Sweden", "Norway", "Denmark", "Finland", "Ireland",
  "United Arab Emirates", "Saudi Arabia", "Qatar", "Kuwait", "Malaysia", "Singapore", "Indonesia", "Philippines",
  "Japan", "South Korea", "China", "Thailand", "Vietnam", "Turkey", "Egypt", "South Africa", "Nigeria", "Brazil",
  "Mexico", "Argentina", "Other"
];
const ALIASES = ["Cipher", "Ghost", "Nova", "Echo", "Raven", "Drift", "Myst", "Void", "Astra", "Pixel", "Orbit", "Frost"];

function randomAlias() {
  const base = ALIASES[Math.floor(Math.random() * ALIASES.length)];
  return `${base}#${Math.floor(1000 + Math.random() * 9000)}`;
}

function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function defaultWsUrl() {
  const fromEnv = import.meta.env.VITE_WS_URL;
  if (fromEnv) return fromEnv;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.hostname || "localhost";
  const port = window.location.port === "3001" ? "3001" : "3001";
  return `${protocol}//${host}:${port}`;
}

function sanitizeProfile(profile) {
  return {
    displayName: profile.displayName.trim() || randomAlias(),
    gender: profile.gender,
    ageGroup: profile.ageGroup,
    country: profile.country,
    chatPreference: profile.chatPreference,
    interests: profile.interests.slice(0, 8)
  };
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

function Landing({ status, onStart }) {
  return (
    <section className="screen center-screen">
      <div className="brand-mark">V</div>
      <p className="eyebrow">ANONYMOUS STRANGER CHAT</p>
      <h1>VANISH</h1>
      <p className="hero-copy">
        Meet strangers by display name, gender, age group, country, interests, and chat preference. No real names are shown.
      </p>
      <div className="feature-grid">
        <div><strong>Real matching</strong><span>WebSocket room relay</span></div>
        <div><strong>Anonymous profile</strong><span>Country only, no exact location</span></div>
        <div><strong>Calls included</strong><span>WebRTC voice/video signaling</span></div>
        <div><strong>Safety layer</strong><span>Rate limit, report, skip, end</span></div>
      </div>
      <button className="primary-btn wide" onClick={onStart}>Continue anonymously</button>
      <p className="connection-line"><StatusDot status={status} /> Realtime server: {status}</p>
    </section>
  );
}

function Onboarding({ profile, setProfile, status, online, onFind }) {
  const valid = profile.displayName.trim() && profile.gender && profile.ageGroup && profile.country && profile.chatPreference;

  const toggleInterest = (interest) => {
    setProfile((p) => ({
      ...p,
      interests: p.interests.includes(interest)
        ? p.interests.filter((x) => x !== interest)
        : [...p.interests, interest]
    }));
  };

  return (
    <section className="screen form-screen">
      <div className="topbar">
        <div>
          <p className="eyebrow">SETUP</p>
          <h2>Create your vanish profile</h2>
        </div>
        <p className="server-pill"><StatusDot status={status} /> {online} online</p>
      </div>

      <label className="field-label">Display name</label>
      <div className="input-row">
        <input
          value={profile.displayName}
          maxLength={24}
          onChange={(e) => setProfile((p) => ({ ...p, displayName: e.target.value }))}
          placeholder="Example: Ghost#1942"
        />
        <button className="small-btn" type="button" onClick={() => setProfile((p) => ({ ...p, displayName: randomAlias() }))}>↻</button>
      </div>
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
      <p className="hint">VANISH uses country only. It does not show city, GPS, IP, or exact location.</p>

      <label className="field-label">Chat preference</label>
      <div className="chip-wrap">{CHAT_PREFS.map((x) => <Chip key={x} label={x} active={profile.chatPreference === x} onClick={() => setProfile((p) => ({ ...p, chatPreference: x }))} />)}</div>

      <label className="field-label">Interests <span>optional</span></label>
      <div className="chip-wrap">{INTERESTS.map((x) => <Chip key={x} label={x} active={profile.interests.includes(x)} onClick={() => toggleInterest(x)} />)}</div>

      <button className="primary-btn wide" disabled={!valid || status !== "connected"} onClick={onFind}>
        {status !== "connected" ? "Waiting for backend..." : valid ? "Find a stranger" : "Complete profile first"}
      </button>
    </section>
  );
}

function Matching({ profile, status, onCancel }) {
  return (
    <section className="screen center-screen">
      <div className="scanner">
        <span />
        <span />
        <span />
        <div>⌁</div>
      </div>
      <p className="eyebrow">MATCHMAKING</p>
      <h2>Looking for a stranger</h2>
      <p className="hero-copy">Same country is preferred first, then global fallback with the same chat preference.</p>
      <div className="summary-card">
        {[profile.displayName, profile.gender, profile.ageGroup, profile.country, profile.chatPreference, ...profile.interests.slice(0, 4)].filter(Boolean).map((x) => (
          <span key={x}>{x}</span>
        ))}
      </div>
      <button className="secondary-btn" onClick={onCancel}>Cancel</button>
      <p className="connection-line"><StatusDot status={status} /> {status}</p>
    </section>
  );
}

function MessageBubble({ message }) {
  if (message.type === "system") return <p className="system-message">— {message.text} —</p>;
  const mine = message.type === "me";
  return (
    <div className={`message-row ${mine ? "mine" : "theirs"}`}>
      <div className="message-bubble">{message.text}</div>
    </div>
  );
}

function CallPanel({ callState, callKind, localStream, remoteStream, incomingKind, onStartCall, onAcceptCall, onRejectCall, onHangup, localVideoRef, remoteVideoRef, remoteAudioRef }) {
  const inCall = ["calling", "voice", "video", "connected"].includes(callState);
  return (
    <div className="call-panel">
      <audio ref={remoteAudioRef} autoPlay playsInline />
      {callState === "incoming" ? (
        <div className="incoming-call">
          <span>Incoming {incomingKind} call</span>
          <button className="small-btn green" onClick={onAcceptCall}>Accept</button>
          <button className="small-btn red" onClick={onRejectCall}>Decline</button>
        </div>
      ) : inCall ? (
        <div className="call-active">
          <div>
            <strong>{callState === "calling" ? "Calling..." : `${callKind} call active`}</strong>
            <span>{remoteStream ? "Remote media connected" : "Waiting for remote media"}</span>
          </div>
          <button className="small-btn red" onClick={onHangup}>Hang up</button>
        </div>
      ) : (
        <div className="call-buttons">
          <button className="secondary-btn compact" onClick={() => onStartCall("voice")}>Start voice</button>
          <button className="secondary-btn compact" onClick={() => onStartCall("video")}>Start video</button>
        </div>
      )}

      {(localStream || remoteStream) && (
        <div className="media-grid">
          <div className="media-box">
            <video ref={localVideoRef} autoPlay muted playsInline />
            <span>You</span>
          </div>
          <div className="media-box">
            <video ref={remoteVideoRef} autoPlay playsInline />
            <span>Stranger</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Chat({
  profile,
  stranger,
  messages,
  input,
  setInput,
  onSend,
  onTyping,
  onNext,
  onEnd,
  onReport,
  seconds,
  bottomRef,
  status,
  callProps
}) {
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const strangerLine = stranger
    ? [stranger.displayName, stranger.gender, stranger.ageGroup, stranger.country, stranger.chatPreference].filter(Boolean).join(" · ")
    : "No active stranger";

  return (
    <section className="chat-screen">
      <header className="chat-header">
        <div className="avatar">?</div>
        <div className="chat-title">
          <strong>Anonymous Stranger</strong>
          <span>{strangerLine}</span>
        </div>
        <span className="timer">{formatTime(seconds)}</span>
        <button className="secondary-btn compact" onClick={onNext}>Next</button>
        <button className="danger-btn compact" onClick={onEnd}>End</button>
      </header>

      <div className="privacy-strip"><StatusDot status={status} /> Real-time relay · Your real identity is hidden · Country only</div>

      <CallPanel {...callProps} />

      <main className="messages">
        {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
        <div ref={bottomRef} />
      </main>

      <footer className="composer">
        <textarea
          rows={1}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            onTyping(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={`Message as ${profile.displayName}`}
        />
        <button className="primary-btn send-btn" onClick={onSend}>Send</button>
        <button className="secondary-btn report-btn" onClick={onReport}>Report</button>
      </footer>
    </section>
  );
}

export default function App() {
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const eventHandlerRef = useRef(null);
  const bottomRef = useRef(null);
  const typingStopRef = useRef(null);
  const timerRef = useRef(null);
  const pcRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const callKindRef = useRef(null);

  const [screen, setScreen] = useState("landing");
  const [status, setStatus] = useState("disconnected");
  const [online, setOnline] = useState(0);
  const [profile, setProfile] = useState({
    displayName: randomAlias(),
    gender: "",
    ageGroup: "",
    country: "",
    chatPreference: "Text",
    interests: []
  });
  const [stranger, setStranger] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [incomingOffer, setIncomingOffer] = useState(null);
  const [incomingKind, setIncomingKind] = useState(null);
  const [callState, setCallState] = useState("idle");
  const [callKind, setCallKind] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);

  const wsUrl = useMemo(() => defaultWsUrl(), []);

  const addSystem = (text) => setMessages((m) => [...m, { id: crypto.randomUUID(), type: "system", text }]);
  const addMine = (text) => setMessages((m) => [...m, { id: crypto.randomUUID(), type: "me", text }]);
  const addTheirs = (text) => setMessages((m) => [...m, { id: crypto.randomUUID(), type: "them", text }]);

  const wsSend = (type, payload = {}) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
      return true;
    }
    return false;
  };

  const stopTracks = (stream) => {
    stream?.getTracks?.().forEach((track) => track.stop());
  };

  const cleanupCall = (notify = false) => {
    if (notify) wsSend("webrtc:hangup", { reason: "hangup" });
    pcRef.current?.close?.();
    pcRef.current = null;
    stopTracks(localStream);
    setLocalStream(null);
    setRemoteStream(null);
    setCallState("idle");
    setCallKind(null);
    callKindRef.current = null;
    setIncomingOffer(null);
    setIncomingKind(null);
  };

  const setupPeer = (kind) => {
    pcRef.current?.close?.();
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) wsSend("webrtc:ice", { candidate: event.candidate });
    };

    pc.ontrack = (event) => {
      const stream = event.streams?.[0];
      if (stream) setRemoteStream(stream);
    };

    pc.onconnectionstatechange = () => {
      if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
        if (pc.connectionState === "failed") addSystem("Call connection failed. Try again or use TURN in production.");
      }
      if (pc.connectionState === "connected") setCallState(kind);
    };

    pcRef.current = pc;
    return pc;
  };

  const getMedia = async (kind) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: kind === "video" ? { width: 640, height: 360 } : false
    });
    setLocalStream(stream);
    return stream;
  };

  const startCall = async (kind) => {
    if (!roomId) return addSystem("You need to be matched before starting a call.");
    if (!navigator.mediaDevices?.getUserMedia) return addSystem("Your browser does not support media devices.");
    try {
      callKindRef.current = kind;
      setCallKind(kind);
      setCallState("calling");
      const stream = await getMedia(kind);
      const pc = setupPeer(kind);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      wsSend("webrtc:offer", { offer, kind });
      addSystem(`${kind} call request sent.`);
    } catch (error) {
      cleanupCall(false);
      addSystem(`Could not start ${kind} call: ${error.message}`);
    }
  };

  const acceptCall = async () => {
    if (!incomingOffer || !incomingKind) return;
    try {
      callKindRef.current = incomingKind;
      setCallKind(incomingKind);
      const stream = await getMedia(incomingKind);
      const pc = setupPeer(incomingKind);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      await pc.setRemoteDescription(new RTCSessionDescription(incomingOffer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      wsSend("webrtc:answer", { answer });
      setCallState(incomingKind);
      setIncomingOffer(null);
      setIncomingKind(null);
      addSystem(`${incomingKind} call accepted.`);
    } catch (error) {
      cleanupCall(true);
      addSystem(`Could not accept call: ${error.message}`);
    }
  };

  const rejectCall = () => {
    wsSend("webrtc:hangup", { reason: "declined" });
    setIncomingOffer(null);
    setIncomingKind(null);
    setCallState("idle");
    addSystem("Call declined.");
  };

  const handleServerEvent = async (event) => {
    const { type, payload = {} } = event;

    if (type === "connected") {
      setOnline(payload.online || 0);
      return;
    }

    if (type === "queue:waiting") {
      setOnline(payload.online || 0);
      setScreen("matching");
      return;
    }

    if (type === "match:found") {
      cleanupCall(false);
      setRoomId(payload.roomId);
      setStranger(payload.stranger);
      setMessages([{ id: crypto.randomUUID(), type: "system", text: "Connected to a stranger. Say hi." }]);
      setInput("");
      setSeconds(0);
      setScreen("chat");
      return;
    }

    if (type === "chat:message") {
      addTheirs(payload.text);
      return;
    }

    if (type === "chat:typing") {
      if (payload.isTyping) addSystem("Stranger is typing...");
      return;
    }

    if (type === "stranger:left") {
      cleanupCall(false);
      setRoomId(null);
      setStranger(null);
      addSystem(`Stranger ${payload.reason || "left"}.`);
      return;
    }

    if (type === "report:received") {
      addSystem(payload.message || "Report received.");
      return;
    }

    if (type === "error") {
      addSystem(payload.message || "Something went wrong.");
      return;
    }

    if (type === "webrtc:offer") {
      setIncomingOffer(payload.offer);
      setIncomingKind(payload.kind || "voice");
      setCallState("incoming");
      addSystem(`Incoming ${payload.kind || "voice"} call.`);
      return;
    }

    if (type === "webrtc:answer") {
      if (pcRef.current && payload.answer) {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.answer));
        setCallState(callKindRef.current || "connected");
        addSystem("Call connected.");
      }
      return;
    }

    if (type === "webrtc:ice") {
      if (pcRef.current && payload.candidate) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch {
          // ICE candidates can arrive before remote description in edge cases; safe to ignore for MVP.
        }
      }
      return;
    }

    if (type === "webrtc:hangup") {
      cleanupCall(false);
      addSystem(`Call ended${payload.reason ? `: ${payload.reason}` : "."}`);
    }
  };

  eventHandlerRef.current = handleServerEvent;

  useEffect(() => {
    let manualClose = false;

    const connect = () => {
      setStatus("connecting");
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => setStatus("connected");
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          eventHandlerRef.current?.(data);
        } catch {
          console.warn("Invalid server event", event.data);
        }
      };
      ws.onerror = () => setStatus("disconnected");
      ws.onclose = () => {
        setStatus("disconnected");
        wsRef.current = null;
        if (!manualClose) reconnectRef.current = setTimeout(connect, 1500);
      };
    };

    connect();
    return () => {
      manualClose = true;
      clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [wsUrl]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (screen === "chat") {
      clearInterval(timerRef.current);
      timerRef.current = setInterval(() => setSeconds((x) => x + 1), 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [screen, roomId]);

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStream || null;
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream || null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remoteStream || null;
  }, [remoteStream]);

  const startOnboarding = () => setScreen("onboard");

  const findStranger = () => {
    if (status !== "connected") return;
    const clean = sanitizeProfile(profile);
    setProfile(clean);
    setMessages([]);
    setStranger(null);
    setRoomId(null);
    setSeconds(0);
    cleanupCall(false);
    wsSend("match:find", { profile: clean });
    setScreen("matching");
  };

  const cancelMatching = () => {
    wsSend("queue:cancel", {});
    setScreen("onboard");
  };

  const sendMessage = () => {
    const text = input.trim();
    if (!text || !roomId) return;
    if (wsSend("chat:message", { text })) {
      addMine(text);
      setInput("");
      wsSend("chat:typing", { isTyping: false });
    }
  };

  const sendTyping = () => {
    if (!roomId) return;
    wsSend("chat:typing", { isTyping: true });
    clearTimeout(typingStopRef.current);
    typingStopRef.current = setTimeout(() => wsSend("chat:typing", { isTyping: false }), 900);
  };

  const nextStranger = () => {
    cleanupCall(true);
    setMessages([]);
    setStranger(null);
    setRoomId(null);
    setSeconds(0);
    wsSend("match:skip", { profile: sanitizeProfile(profile) });
    setScreen("matching");
  };

  const endChat = () => {
    cleanupCall(true);
    wsSend("chat:leave", {});
    setMessages([]);
    setStranger(null);
    setRoomId(null);
    setSeconds(0);
    setScreen("onboard");
  };

  const reportUser = () => {
    const reason = window.prompt("Reason for report?", "Harassment or abusive behavior");
    if (!reason) return;
    wsSend("report:user", { reason });
  };

  const callProps = {
    callState,
    callKind,
    localStream,
    remoteStream,
    incomingKind,
    onStartCall: startCall,
    onAcceptCall: acceptCall,
    onRejectCall: rejectCall,
    onHangup: () => cleanupCall(true),
    localVideoRef,
    remoteVideoRef,
    remoteAudioRef
  };

  return (
    <div className="app-shell">
      <div className="grid-bg" />
      <div className="app-container">
        {screen === "landing" && <Landing status={status} onStart={startOnboarding} />}
        {screen === "onboard" && <Onboarding profile={profile} setProfile={setProfile} status={status} online={online} onFind={findStranger} />}
        {screen === "matching" && <Matching profile={profile} status={status} onCancel={cancelMatching} />}
        {screen === "chat" && (
          <Chat
            profile={profile}
            stranger={stranger}
            messages={messages}
            input={input}
            setInput={setInput}
            onSend={sendMessage}
            onTyping={sendTyping}
            onNext={nextStranger}
            onEnd={endChat}
            onReport={reportUser}
            seconds={seconds}
            bottomRef={bottomRef}
            status={status}
            callProps={callProps}
          />
        )}
      </div>
    </div>
  );
}
