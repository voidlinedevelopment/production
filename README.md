# Production — Live Production Management Platform

**Production** is a web platform for streamers, content creators, esports teams, and broadcast crews to run live shows remotely. It manages teams and permissions, connects to OBS Studio (over the internet via a desktop agent), shows a live OBS preview, drives a lower-third text overlay, schedules productions, and notifies a Discord server through a bot.

> Production domain (deployed): `https://production.ocrp.cc`

---

## 1. What the system does

- **Discord-only login** — "Continue with Discord" (passport-discord OAuth2). No email/password accounts.
- **Teams** — organizations with owner, members, logos, and descriptions.
- **Roles & permissions** — per-team roles (OWNER / ADMIN / PRODUCER / OPERATOR / VIEWER by default) with granular permissions such as `obs.control`, `members.manage`, `production.manage`.
- **OBS Studio integration** — connect an OBS instance to a team and, from the dashboard:
  - See live OBS connection status, current scene, FPS, stream/recording state.
  - Switch scenes, start/stop streaming, start/stop recording.
  - View a **live video preview** of the OBS output (video captured on the streaming PC and relayed through the server).
  - Control a **lower-third text overlay** shown inside OBS (via a transparent browser source).
- **Two ways OBS is connected:**
  1. **Legacy direct LAN** — dashboard connects straight to `host:port` of an OBS WebSocket (only works if the server and OBS are on the same network). Deprecated; kept for compatibility.
  2. **OBS Agent (recommended)** — a Windows desktop app (`Production OBS Agent`) installed on the streaming PC. It authenticates to the server with a per-connection token and controls OBS locally, so it works from anywhere (no LAN needed).
- **Productions** — schedule live events with rundown items (timed segments) and assigned staff.
- **Discord bot** — slash commands (`/setup`, `/status`, `/production`, `/team`, `/stream`), links a Discord server to a team, and posts notifications (OBS connected/disconnected, scene changes, stream started/ended, member joined).

---

## 2. Architecture

Four cooperating components:

```
                     ┌────────────────────────────────────────────┐
                     │  VPS (Ubuntu, PM2, Cloudflare Tunnel)      │
                     │                                            │
  User browser ────► │  production-web   (Express + EJS + Socket.IO, port 3000)
  OBS Agent (PC) ──► │        │                 │                  │
                     │        ▼                 ▼                  │
                     │  production-bot   (discord.js v14, HTTP API port 4000)
                     │  production-tunnel (cloudflared → https://production.ocrp.cc)
                     │        │                                    │
                     │        ▼                                    │
                     │  Shared SQLite DB  (database/production.db) │
                     └────────────────────────────────────────────┘
```

- The **website** serves all UI and the realtime Socket.IO hub.
- The **bot** runs Discord integration and exposes a tiny HTTP API to the website.
- The **tunnel** exposes port 3000 to the internet via Cloudflare (provides HTTPS automatically).
- The **agent** is a separate Electron app the user runs on their streaming PC; it is NOT deployed to the VPS. It only talks to the website over Socket.IO.

PM2 apps (see `ecosystem.config.js`): `production-web`, `production-bot`, `production-tunnel`.

---

## 3. Tech stack

| Layer      | Technology |
| ---------- | ---------- |
| Backend    | Node.js, Express 4 |
| Frontend   | EJS templates + Tailwind CSS (CDN) + vanilla JS |
| Realtime   | Socket.IO (server + client served from `/socket.io/socket.io.js`) |
| Database   | SQLite3 (`sqlite3` npm package), WAL mode, foreign keys on |
| Auth       | Discord OAuth2 via `passport-discord` + express-session (SQLite-backed store) |
| OBS        | `obs-websocket-js` (OBS WebSocket **v5**) |
| Desktop    | Electron 30 + `electron-builder` (NSIS installer) + `electron-updater` |
| Bot        | discord.js v14 |
| Deploy     | PM2 + cloudflared tunnel |

---

## 4. Repository layout

```
production/
├── website/
│   ├── server.js              # Express app + Socket.IO hub + socket event handlers
│   ├── routes/                # auth, dashboard, teams, members, roles, settings,
│   │                          # obs, productions, api, agent
│   ├── controllers/           # authController, teamController
│   ├── middleware/            # auth.js, permissions.js (checkPermission), teamAccess.js
│   ├── services/              # obsService (OBS WS v5), discordService (bot HTTP client)
│   ├── views/                 # EJS templates (layout, login, dashboard, teams, obs/*, productions/*)
│   └── public/                # css, js (app.js), uploaded assets
├── agent/                     # Production OBS Agent (Electron desktop app)
│   ├── main.js                # main process: window, tray, IPC, update checker
│   ├── obs.js                 # OBSWebSocket v5 client: connect/reconnect, commands,
│   │                          # overlay browser source, virtual-cam preview capture
│   ├── socket.js              # socket.io-client wrapper (agent-auth, status, chunks, overlay)
│   ├── preload.js             # contextBridge IPC API
│   ├── renderer/              # tabbed UI (Status / Settings / Updates)
│   └── assets/                # icon etc.
├── bot/
│   ├── index.js               # discord.js client + HTTP API on port 4000
│   ├── commands/              # setup, status, production, team, stream
│   ├── events/                # ready, interactionCreate
│   └── services/              # notificationService
├── shared/
│   └── database.js            # SQLite connection + schema + migrations + helpers
├── scripts/                   # start-all, start-tunnel, setup-cloudflare, setup-vps, checkdb
├── database/                  # production.db, sessions.db (created at runtime)
├── ecosystem.config.js        # PM2 config
└── .env                       # secrets (never committed)
```

---

## 5. Database schema

SQLite database `database/production.db`, initialized + migrated by `shared/database.js`:

| Table | Purpose |
| ----- | ------- |
| `users` | Discord-identified users (discord_id, username, avatar, email) |
| `teams` | Organizations (owner_id, name, description, logo) |
| `roles` | Per-team roles |
| `permissions` | Global permission catalog (12 default perms) |
| `role_permissions` | role ↔ permission mapping |
| `team_members` | team ↔ user membership (with a role) |
| `discord_servers` | Discord guild ↔ team links |
| `discord_roles` | Discord role ↔ production role sync mapping |
| `obs_connections` | OBS endpoints per team (see below) |
| `productions` | Live events (name, start/end, status draft/live/completed) |
| `production_members` | staff assigned to a production |
| `rundown_items` | timed segments of a production (title, start_time, duration, position) |
| `activity_logs` | audit trail (team_id, user_id, action, details) |

**`obs_connections` fields:**
- `id`, `team_id`, `name`
- `host` (`'agent'` for agent-based connections) / `port` / `password` (for legacy direct LAN)
- `agent_token` — unique token the agent uses to authenticate as this connection (NULL = legacy direct connection)
- `status` — `'connected' | 'disconnected'`
- `overlay_text` — the current lower-third text for the overlay (migrated in automatically)

**Permissions seeded:** `obs.view`, `obs.control`, `obs.scene.change`, `obs.stream.start`, `obs.stream.stop`, `obs.recording.start`, `obs.recording.stop`, `members.manage`, `roles.manage`, `team.settings.manage`, `production.manage`, `production.view`.

---

## 6. HTTP routes (website)

Auth-gated unless noted. Middleware order: `isAuthenticated` → `teamAccess` → `checkPermission('...')`.

| Route | Purpose |
| ----- | ------- |
| `/` | Redirect to `/dashboard` or show login |
| `/auth/discord`, `/auth/discord/callback`, `/auth/logout` | Discord OAuth2 |
| `/dashboard` | Landing dashboard |
| `/teams`, `/teams/create`, `/teams/:teamId`, `/teams/:teamId/edit` | Team CRUD + view |
| `/teams/:teamId/invite`, `/teams/:teamId/remove/:userId` | Membership management |
| `/members/:teamId`, `/members/:teamId/:userId/role` | Manage members + roles |
| `/roles/:teamId`, `/roles/:teamId/create`, `/roles/:teamId/:roleId/permissions`, `/roles/:teamId/:roleId/delete` | Roles & permissions |
| `/settings/:teamId`, `/settings/:teamId/discord`, `/settings/:teamId/discord-role` | Team settings + Discord linking |
| `/obs`, `/obs/:teamId` | OBS control dashboard (viewer) |
| `/obs/:teamId/connections` | OBS connection CRUD (add/edit/delete) |
| `/obs/:teamId/connections/:connId/token` | Generate an agent token for a connection |
| `/obs/:teamId/connections/:connId/delete` | Delete connection |
| `/overlay/:connId` | **Public** transparent overlay page for an OBS browser source (no auth — it's a web page inside OBS) |
| `/productions`, `/productions/:teamId`, `.../create`, `.../:prodId`, `.../status`, `.../rundown`, `.../assign`, `.../unassign` | Production scheduling + rundown |
| `/api/teams`, `/api/teams/:teamId/members`, `/api/teams/:teamId/obs`, `/api/users/search`, `/api/obs/activity` | JSON API for the frontend |
| `/agent`, `/agent/download` | Agent download/info page |
| `/downloads/*` | Static files — hosts the agent installer, `.blockmap`, and `latest.yml` (used by auto-update) |
| `/socket.io/socket.io.js` | Socket.IO client bundle (served locally, not from a CDN) |

---

## 7. Realtime protocol (Socket.IO)

All realtime behavior lives in `website/server.js` (`io.on('connection', ...)`). Socket.io serves its own client at `/socket.io/socket.io.js`.

### Client → Server

| Event | Emitter | Payload | Effect |
| ----- | ------- | ------- | ------ |
| `join-team` | dashboard | `{ teamId }` | Joins room `team-<id>`, pushes to `socket.teamIds`, emits current `obs-agent-status` + agent OBS state to that socket, and notifies agents preview-on when it's the first viewer |
| `leave-team` | dashboard | `{ teamId }` | Leaves room |
| `agent-auth` | agent | `{ token }` | Authenticates agent; on success sets `socket.agentConnId`, joins `agent-<connId>`, emits `agent-auth-result {ok, connId, name}` and broadcasts `obs-agent-status {online:true}` to the team; on failure emits error + disconnects |
| `obs-connect` | dashboard | `{ teamId, connId, host, port, password }` | Agent connection → emits `agent-obs-command {command:'connect'}` to the agent. Non-agent connection → emits `obs-error` explaining only agent-based connections can be reached remotely |
| `obs-disconnect` | dashboard | `{ teamId, connId }` | Tells the agent to disconnect |
| `obs-command` | dashboard | `{ teamId, connId, command, scene }` | Forwards command to agent (`startStream`, `stopStream`, `startRecording`, `stopRecording`, `switchScene`) |
| `obs-preview-control` | dashboard | `{ connId, enabled }` | Tells the agent to start/stop streaming virtual-cam preview frames |
| `overlay-set` | dashboard | `{ connId, text, enabled }` | Saves `overlay_text`, broadcasts `overlay-text` to the overlay room, acks the team with `obs-overlay-result {stage:'saved'}`, and if `enabled` + agent online tells the agent to create/destroy the overlay browser source |
| `join-overlay` | overlay page | `{ connId }` | Joins room `overlay-<connId>` and immediately receives the current `overlay-text` |

### Agent → Server

| Event | Payload | Effect |
| ----- | ------- | ------ |
| `agent-obs-status` | `{ connected, info?, error? }` | Updates `obs_connections.status`, broadcasts `obs-status {connId, connected}` to the team, stores agent OBS state, and if `error` also emits `obs-error` to the team + logs `[agent-obs] conn <id> OBS error: ...` |
| `agent-obs-preview` | `{ enabled, error? }` | Broadcasts preview live state `obs-preview-live {connId, enabled, error}` |
| `agent-obs-preview-video` | `{ connId, chunk, stream }` | Relays webm preview chunk to team room as `obs-preview {connId, chunk, stream}` |
| `agent-obs-preview-live` | `{ enabled, error?, codec? }` | Sends live-status with the detected media codec |
| `agent-obs-overlay-result` | `{ success, error?, enabled }` | Relays overlay auto-add result to the team as `obs-overlay-result` |
| `agent-obs-event` | `{ event, ... }` | Relays OBS scene / stream / recording / stats events to the team (`obs-scene`, `obs-stream-status`, `obs-recording-status`, `obs-stats`) |
| `agent-obs-result` | `{ command, success, error?, ... }` | Result of a forwarded OBS command |

### Server → rooms

- `team-<teamId>` (dashboard): `obs-status`, `obs-error`, `obs-agent-status`, `obs-scene`, `obs-stream-status`, `obs-recording-status`, `obs-stats`, `obs-preview`, `obs-preview-live`, `obs-overlay-result`
- `agent-<connId>`: `agent-obs-command {connId, command}`, `agent-obs-preview {connId, enabled}`, `agent-obs-overlay {connId, enabled}`
- `overlay-<connId>`: `overlay-text {text}`

---

## 8. OBS integration — deep dive

### Connection model

- **Legacy direct**: connection row has a real `host`/`port`/`password`, no `agent_token`. The dashboard used to connect server-side to `obs://host:port` via `obsService`. Today the server refuses these remote connects (`obs-error`: "This OBS connection is not linked to an OBS Agent...") because the server can't reach a home PC's OBS.
- **Agent-based**: connection row has `host='agent'`, `port=0`, and an `agent_token` (generated in the Connections page). The token is pasted into the agent's **Settings** tab → Save → Connect. The agent opens a socket to the server and authenticates with `agent-auth`.

### The OBS Agent (`agent/`)

Electron desktop app (Windows NSIS installer, auto-updating via `electron-updater` from `https://production.ocrp.cc/downloads/`). Has a 3-tab UI: **Status** (server/agent/OBS dots, Reconnect button), **Settings** (token, OBS websocket port + password), **Updates** (version + auto-update).

Lifecycle:
1. Agent reads settings, connects to server socket, sends `agent-auth` with its token.
2. Server sets `socket.agentConnId`; agent is now "online" for that connection.
3. Agent connects to **local** OBS via `obs-websocket-js` v5 (`127.0.0.1:4455` + password). This is a LOCAL connection on the streaming PC — the server never talks to OBS directly for agent connections.
4. On OBS connect, agent reports scene list, stream/recording state, stats; subscribes to OBS events (scene changed, stream/record state, stats) and relays them via `agent-obs-event`.
5. Every 3s the agent auto-reconnects to OBS if the websocket drops (`CONNECT_TIMEOUT_MS = 10000` guards against a hung `connect()`; stale client is torn down before re-creating). It also auto-reconnects to the server socket.

Agent responsibilities:
- `connect` / `disconnect` / scene switch / stream / recording commands from the dashboard.
- **Live preview**: calls `startVirtualCam()` on OBS, captures frames, encodes webm chunks (detects codec: V_VP8 / V_VP9 / V_AV1 / H264), and uploads them over the socket. The dashboard plays them with MediaSource Extensions.
- **Overlay**: on `agent-obs-overlay {enabled:true}` it creates an OBS Browser Source named `ProductionOverlay` pointing at `https://production.ocrp.cc/overlay/<connId>`; on disable it removes it. Requires the OBS WebSocket to be reachable (if OBS websocket is down, `enableOverlay` fails → reports `agent-obs-overlay-result` with instructions to add the browser source manually).

### Dashboard OBS Control page (`/obs/:teamId`)

Cards per connection:
- Status dot + Agent online/offline badge + Connect/Disconnect button.
- Amber warning banner when the agent reports an OBS websocket error (ECONNREFUSED / timeout) with fix instructions (enable OBS → Tools → WebSocket Server Settings).
- **Preview** toggle (opens the MSE live preview; trims buffered data to avoid lag, caps chunk queue, auto-plays).
- **Text Overlay** input + Show/Hide buttons; status line gives green "saved" / amber agent-offline / agent-error feedback; shows the manual browser-source URL.
- When connected: scene grid, current scene, stream/recording state, FPS, and Stream/Record/Scene-switch controls.

### Text overlay (`/overlay/:connId`)

Public transparent web page (`views/obs/overlay.ejs`): a lower-third bar (`#bar`) + text. Joins the `overlay-<connId>` socket room and renders whatever `overlay-text` the server pushes (current `overlay_text` on join, live on every change). Shows a small "Overlay ready" badge top-right until text is set, to make setup verifiable. Displayed inside OBS via a **Browser** source:

> OBS → Sources → **+** → **Browser** → URL: `https://production.ocrp.cc/overlay/<connId>` → 1920×1080

The overlay works with NO OBS websocket and NO agent at all — it's pure web + socket relay. The agent only adds the auto-created browser source convenience.

### Why the dashboard "Connect" needs OBS WebSocket Server enabled

For agent connections, the *agent* must reach OBS's WebSocket Server locally. If it can't (usually: Tools → WebSocket Server Settings → "Enable WebSocket server" unchecked, or wrong port/password), the agent logs `connect ECONNREFUSED 127.0.0.1:4455`, auto-retries, the Connect button appears to do nothing, and overlay auto-add fails. Everything else (preview, manual overlay) keeps working.

---

## 9. Live preview flow (end to end)

1. Dashboard `obs-preview-control {enabled:true}` → server → agent `agent-obs-preview`.
2. Agent starts OBS virtual camera, encodes webm chunks (opus audio + VP8/VP9/AV1/H264 video).
3. Chunks stream up via `agent-obs-preview-video`; server relays to the team room as `obs-preview`.
4. Dashboard detects the real mime type from chunk signatures, creates an MSE `SourceBuffer` (tries the real codec, then vp8/vp9/plain webm fallbacks), appends chunks, trims old/future buffered data (`trimPreviewBuffer`) to prevent lag, and keeps the video playing.

---

## 10. Discord bot

Runs on port 4000 (`bot/index.js`). Slash commands registered with `node bot/register-commands.js`:

| Command | Description |
| ------- | ----------- |
| `/setup team_id:<id>` | Link this Discord server to a Production team |
| `/status` | Show OBS connection status |
| `/production` | Show live/upcoming productions |
| `/team` | Show team members + roles |
| `/stream` | Show stream status |

Notifications posted to a team-linked channel (via `notificationService`): OBS connected/disconnected, scene change, stream started/ended, recording state, member joined.

**HTTP API (website → bot), port 4000:**
- `GET /api/status` → bot online + guild count
- `POST /api/notify` `{ guildId, channelName, message }` → send a Discord message

The website calls this through `website/services/discordService.js`.

---

## 11. Environment variables (`.env`)

```ini
PORT=3000
SESSION_SECRET=change-this
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_CALLBACK_URL=https://production.ocrp.cc/auth/discord/callback
DATABASE_PATH=./database/production.db
BOT_PORT=4000
DISCORD_TOKEN=...
WEBSITE_URL=https://production.ocrp.cc
CLOUDFLARE_HOSTNAME=production.ocrp.cc
CLOUDFLARE_TUNNEL_TOKEN=eyJ...    # cloudflared service token
TUNNEL_NAME=production
```

---

## 12. Running / deploying

**Local:**
```bash
npm install
npm start          # web + bot (scripts/start-all.js)
node bot/register-commands.js   # once, after adding bot commands
```

**Production (VPS):** PM2 with `ecosystem.config.js` (`production-web`, `production-bot`, `production-tunnel`). The tunnel is a Cloudflare-managed service (`cloudflared service install <token>`); `scripts/setup-vps.sh` does a one-shot install.

**Deploying a code change (the routine used for this project):**
```bash
git push origin main
ssh ubuntu@<vps> "cd /home/ubuntu/production && git pull && pm2 restart production-web --update-env"
# also restart production-bot / production-tunnel if they show 'stopped' after a restart
```

**Shipping a new agent build (the routine used for this project):**
1. Bump `version` in `agent/package.json`.
2. `node --check` each agent JS file.
3. `$env:CSC_IDENTITY_AUTO_DISCOVERY="false"; npx electron-builder --win --publish never`
4. Copy the versioned exe to `dist\Production-Agent-Setup.exe` (the stable filename).
5. scp `Production OBS Agent Setup <v>.exe`, `.exe.blockmap`, `latest.yml`, and `Production-Agent-Setup.exe` to `/home/ubuntu/production/website/public/downloads/` on the VPS.
6. Remove older versioned exes from that folder. `latest.yml` is what drives `electron-updater`.

---

## 13. Operational notes

- **Live site:** `https://production.ocrp.cc` — web (production-web), bot (production-bot), tunnel (production-tunnel) run under PM2 on the VPS.
- **Agent downloads:** `https://production.ocrp.cc/downloads/` (installer + `latest.yml`).
- **SQLite has no CLI on the VPS** — to inspect the DB, write a small node script on the VPS that `require('/home/ubuntu/production/node_modules/sqlite3')` and opens `database/production.db` (scp the script to `/tmp` first; PowerShell mangles inline `node -e` quoting over ssh).
- **Logs:** `pm2 logs production-web` (server + agent socket activity). Watch for `[agent-obs] conn <id> OBS error:` lines — they mean the agent can't reach OBS locally.
- **Old connections:** connection rows with a real `host`/`port` and no `agent_token` are legacy LAN-only and can't be driven remotely; only agent connections (host `'agent'`, token set) can be.
- **Overlay gotcha:** the overlay page shows whenever `overlay_text` is non-empty. Clicking **Hide** on the dashboard destroys the auto-created OBS source but does not by itself blank a *manually* added browser source whose text is still saved; use the dashboard text box + Show/Hide consistently.
- **Auto-update:** `electron-updater` in the agent pulls from `/downloads/latest.yml`; bumping the version and uploading is all that's needed.

---

## 14. Security notes

- `SESSION_SECRET` must be strong in production; `.env` is never committed.
- HTTPS is provided by the Cloudflare tunnel.
- `express-rate-limit` is enabled globally.
- `/overlay/:connId` is intentionally public (it's rendered inside OBS, which has no cookies). The only data it exposes is `overlay_text`.
- Discord OAuth2 scopes: `identify`, `email`, `guilds`.

---

*Private / internal project. Version: agent `1.2.8`, deployed `production.ocrp.cc`.*
