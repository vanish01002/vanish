# VANISH

Anonymous text-only stranger chat with a Google account dashboard.

## Changes in this version

- Removed audio and video calls.
- Added account login using Google Identity Services.
- Added a dashboard with account info, anonymous profile editor, server status, safety notes, and match button.
- Google account details are never shown to strangers.
- Google Drive access is not requested.

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

## Google OAuth setup

In Google Cloud Console:

1. Create OAuth consent screen.
2. Create OAuth Client ID, type Web application.
3. Add authorized JavaScript origin:

```text
https://your-render-service.onrender.com
```

4. Add authorized redirect URI if Google asks for one:

```text
https://your-render-service.onrender.com
```

## Run locally

```bash
npm --prefix client install
npm --prefix server install
npm run dev:server
```

In another terminal:

```bash
npm run dev:client
```

For local Google auth, set `VITE_API_URL=http://localhost:3001` and `VITE_GOOGLE_CLIENT_ID` in `client/.env`.
