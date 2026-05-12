# VANISH

Anonymous text-only stranger chat with a Google account dashboard, image sharing, and interactive games.

## Current features

- Google account login through Google Identity Services.
- Guest mode for testing.
- Account dashboard.
- Anonymous public profile: display name, gender, age group, country, interests.
- Real stranger matching through WebSocket.
- Text-only anonymous chat.
- Image sharing: PNG, JPG, WEBP, and GIF only; maximum 1 MB per image.
- Interactive games inside chat:
  - Tic-Tac-Toe
  - Rock Paper Scissors
- Typing indicator.
- Skip, end chat, and report controls.
- No audio/video calls.
- No Google Drive access.

## Render build command

```bash
npm --prefix client install --no-audit --no-fund && npm --prefix server install --no-audit --no-fund && npm run build
```

## Render start command

```bash
npm start
```

## Required environment variables

Set both values to the same OAuth 2.0 Web Client ID from Google Cloud Console:

```env
VITE_GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com
GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com
NODE_VERSION=20
NODE_ENV=production
```

If Google login is not configured, guest mode still works for testing.

## Local run

Terminal 1:

```bash
npm --prefix server install
npm run dev:server
```

Terminal 2:

```bash
npm --prefix client install
npm run dev:client
```

Open:

```text
http://localhost:5173
```

## GitHub/Render note

Do not commit these folders:

```text
node_modules/
client/node_modules/
server/node_modules/
client/dist/
```

They are ignored by `.gitignore`.
