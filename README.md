# VANISH — Anonymous Stranger Chat/Call Web App

VANISH is a full-stack MVP for anonymous stranger matching, text chat, and WebRTC voice/video call signaling.

## What is implemented

- React + Vite frontend
- Node.js HTTP server
- WebSocket realtime backend using `ws`
- Anonymous onboarding fields:
  - Display name
  - Gender
  - Age group
  - Country
  - Interests
  - Chat preference: Text / Voice / Video
- Real stranger matchmaking
- Same-country-first matching, then global fallback with the same chat preference
- Realtime text relay
- Typing relay
- Skip stranger
- End chat
- Report user
- Server-side message rate limiting
- In-memory report evidence snapshot of only the current room's latest messages
- WebRTC signaling for voice/video:
  - offer
  - answer
  - ICE candidate relay
  - hangup
- Static production serving from the Node server after client build

## Important privacy model

VANISH separates account identity from anonymous chat profile.

The stranger only receives:

```js
{
  displayName,
  gender,
  ageGroup,
  country,
  chatPreference,
  interests
}
```

The stranger does not receive:

```text
email
real name
IP address
GPS/city/exact location
internal socket id
```

This MVP does not permanently store normal chat messages. It keeps a short in-memory room buffer only so that if a user reports abuse, the latest room messages can be attached to the report.

## Run locally

### 1. Install dependencies

```bash
cd vanish-fullstack
npm --prefix client install
npm --prefix server install
```

### 2. Start backend

Terminal 1:

```bash
npm run dev:server
```

Backend:

```text
http://localhost:3001
ws://localhost:3001
```

### 3. Start frontend

Terminal 2:

```bash
npm run dev:client
```

Frontend usually opens at:

```text
http://localhost:5173
```

## Test real matching

Open two browser tabs:

```text
Tab 1: http://localhost:5173
Tab 2: http://localhost:5173
```

In both tabs:

1. Continue anonymously
2. Fill different profiles
3. Use the same chat preference, such as Text
4. Click Find a stranger
5. The two tabs will match each other
6. Send messages between them

## Test voice/video

After two tabs are matched:

1. Click Start voice or Start video in one tab
2. Accept the incoming call in the other tab
3. Browser will ask for microphone/camera permission

For local testing, WebRTC works on `localhost` as a secure context. For production, use HTTPS/WSS.

## Production notes

Before production deployment, add:

- Real auth verification instead of guest-only demo auth
- Redis queue/pub-sub for multi-server matchmaking
- PostgreSQL for user, ban, and report records
- TURN server, preferably Coturn, for reliable voice/video and stronger IP privacy
- HTTPS + WSS
- Abuse moderation and ban dashboard
- Real logging/monitoring for server health, not message content

## Project structure

```text
vanish-fullstack/
├── client/
│   ├── index.html
│   ├── package.json
│   └── src/
│       ├── App.jsx
│       ├── main.jsx
│       └── styles.css
├── server/
│   ├── index.js
│   └── package.json
├── package.json
└── README.md
```

## Build and run as one production server

```bash
cd vanish-fullstack
npm --prefix client install
npm --prefix server install
npm run build
npm start
```

Then open:

```text
http://localhost:3001
```

