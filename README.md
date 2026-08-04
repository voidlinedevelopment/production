# Production

**Production** is a professional live production management platform for streamers, content creators, esports teams, and broadcast teams.

Create production teams, connect OBS Studio, manage members and permissions, create live events, control broadcasts in real time, and integrate a full Discord bot.

## Architecture

Two Node.js apps on one server, sharing one SQLite database:

```
Node.js Hosting Server
        │
        ├── Production Website   (PORT 3000)  Express + EJS + Socket.IO
        ├── Production Bot       (PORT 4000)  discord.js v14 + HTTP API
        └── Production Tunnel    Cloudflare Tunnel → https://your.domain
                        │
                  Shared SQLite3 DB  (database/production.db)
```

## Tech Stack

| Layer    | Technology                                  |
| -------- | ------------------------------------------- |
| Backend  | Node.js, Express.js                         |
| Frontend | EJS, TailwindCSS (CDN), Vanilla JavaScript  |
| Realtime | Socket.IO                                   |
| Database | SQLite3 (npm `sqlite3`)                     |
| Auth     | Discord OAuth2 (passport-discord)           |
| OBS      | obs-websocket-js (OBS WebSocket v5)         |
| Bot      | discord.js v14                              |
| Deploy   | PM2 + Cloudflare Tunnel                     |

## Features

- **Discord-only login** — "Continue with Discord", no email/password
- **Teams** — create, edit, delete, invite members, remove members, upload logos
- **Roles & permissions** — OWNER / ADMIN / PRODUCER / OPERATOR / VIEWER defaults with granular permissions (`obs.view`, `members.manage`, `production.manage`, ...)
- **OBS integration** — WebSocket v5 connections, live scenes/sources, stream + recording control, FPS/stats
- **Production events** — schedules, rundown items, staff assignment, draft → live → completed states
- **Real-time updates** — Socket.IO room-based live UI (OBS status, scene switches, stream state)
- **Discord bot** — `/setup`, `/status`, `/production`, `/team`, `/stream` slash commands
- **Discord server connection** — connect a guild to a team, receive OBS/stream/scene notifications
- **Discord role sync** — map Discord roles to Production roles

## Project Structure

```
production/
├── website/
│   ├── server.js
│   ├── routes/          # auth, dashboard, teams, obs, production, api, members, roles, settings
│   ├── controllers/     # authController, teamController
│   ├── middleware/      # auth, permissions (checkPermission), teamAccess
│   ├── services/        # obsService (OBS WS v5), discordService (bot HTTP API)
│   ├── views/           # EJS templates (layout, login, dashboard, teams, obs, productions, ...)
│   └── public/          # css, js, img
├── bot/
│   ├── index.js         # discord.js client + HTTP API on port 4000
│   ├── commands/        # setup, status, production, team, stream
│   ├── events/          # ready, interactionCreate
│   ├── services/        # notificationService
│   └── register-commands.js
├── shared/
│   └── database.js      # SQLite3 module + schema
├── scripts/
│   ├── setup-cloudflare.js   # downloads cloudflared, creates tunnel
│   ├── start-tunnel.js       # starts the Cloudflare tunnel
│   ├── setup-vps.sh          # one-shot VPS deployment
│   └── checkdb.js
├── database/             # production.db (created at runtime)
├── ecosystem.config.js   # PM2 config (web + bot + tunnel)
├── package.json
└── .env
```

## Setup

### 1. Prerequisites

- Node.js 18+
- A Discord Application (https://discord.com/developers/applications)
  - OAuth2 → Redirects: add your callback URL (e.g. `http://localhost:3000/auth/discord/callback`)
  - Bot → create a bot, copy the token
  - Enable scopes: `identify`, `email`, `guilds`
- (Optional) OBS Studio with WebSocket enabled (Tools → WebSocket Server Settings)

### 2. Environment

```bash
cp .env.example .env
# or copy the .env values from the repository root
```

`.env`:

```ini
# Website
PORT=3000
SESSION_SECRET=change-this

# Discord OAuth2
DISCORD_CLIENT_ID=your-client-id
DISCORD_CLIENT_SECRET=your-client-secret
DISCORD_CALLBACK_URL=http://localhost:3000/auth/discord/callback

# Database
DATABASE_PATH=./database/production.db

# Discord Bot
BOT_PORT=4000
DISCORD_TOKEN=your-bot-token
WEBSITE_URL=http://localhost:3000

# Cloudflare Tunnel
CLOUDFLARE_HOSTNAME=production.yourdomain.com
TUNNEL_NAME=production
```

### 3. Install & run locally

```bash
npm install
npm start          # website on :3000
npm run dev:bot    # bot on :4000 (separate terminal)
```

Register bot slash commands once:

```bash
node bot/register-commands.js
```

### 4. Deploy on a VPS with PM2 + Cloudflare Tunnel

```bash
bash scripts/setup-vps.sh
```

This will:
1. Install dependencies
2. Check/create `.env`
3. Install PM2
4. Register Discord slash commands
5. Install the Cloudflare tunnel as a service using your token
6. Start `production-web`, `production-bot` with PM2

### 5. Cloudflare Tunnel (token based)

Create a tunnel in the Cloudflare Zero Trust dashboard:
`Zero Trust → Networks → Tunnels → Create a tunnel → Copy the token (starts with "eyJ...")`

Set the token in `.env`:

```ini
CLOUDFLARE_TUNNEL_TOKEN=eyJhIjo...
CLOUDFLARE_HOSTNAME=production.yourdomain.com
```

Install cloudflared as a system service (runs the tunnel on boot, auto-restarts):

```bash
node scripts/setup-cloudflare.js            # reads token from .env
node scripts/setup-cloudflare.js <TOKEN>    # or pass it directly
```

On Windows run as Administrator. On Linux run with sudo.

Result: `cloudflared service install <TOKEN>` registers the tunnel as a managed service.

Alternative (run in foreground / PM2 instead of a system service):

```bash
node scripts/start-tunnel.js
pm2 start scripts/start-tunnel.js --name production-tunnel
```

Manage the service:

| Platform | Command                                  |
| -------- | ---------------------------------------- |
| Windows  | `sc query cloudflared` / `sc stop cloudflared` / `sc start cloudflared` |
| Linux    | `systemctl status cloudflared` / `stop` / `start` |
| Uninstall| `cloudflared service uninstall`           |

Point DNS: create a CNAME `production` → your tunnel hostname in Cloudflare, then add the public hostname in the tunnel dashboard (`production.yourdomain.com` → `http://localhost:3000`).

### 5. Discord OAuth redirects

Set the callback in the Discord Developer Portal to match `DISCORD_CALLBACK_URL`:

- Local: `http://localhost:3000/auth/discord/callback`
- VPS via tunnel: `https://production.yourdomain.com/auth/discord/callback`

### 6. Discord Server connection

1. Invite the bot to your server
2. Create a team in the Production dashboard
3. In your server run `/setup team_id:<your team id>`
4. Add the server to the team in Team → Settings (or it auto-links)

## Usage

### OBS

1. OBS → Tools → WebSocket Server Settings → enable, note host/port/password
2. Dashboard → Team → OBS Control → Add Connection
3. Connect → see scenes, switch scenes, start/stop stream & recording live

### Productions

Create a production, set times, add rundown items (e.g. `7:00 PM — Starting Soon`), assign staff, then **Go Live**.

### Discord bot commands

| Command       | Description                              |
| ------------- | ---------------------------------------- |
| `/setup`      | Connect this server to a Production team |
| `/status`     | Show OBS connection status               |
| `/production` | Show live/upcoming productions           |
| `/team`       | Show team members and roles              |
| `/stream`     | Show stream status                       |

### Notifications

The bot posts to a `#production` channel (or any channel you specify):

- 🟢 OBS Connected
- 🔴 OBS Disconnected
- 🎬 Scene changed to *Gameplay*
- 🔴 Stream Started / ⚫ Stream Ended
- 👋 Member Joined

## Permissions

| Permission             | Description                       |
| ---------------------- | --------------------------------- |
| `obs.view`             | View OBS dashboard                |
| `obs.control`          | Send commands to OBS              |
| `obs.scene.change`     | Switch scenes                     |
| `obs.stream.start`     | Start stream                      |
| `obs.stream.stop`      | Stop stream                       |
| `obs.recording.start`  | Start recording                   |
| `obs.recording.stop`   | Stop recording                    |
| `members.manage`       | Manage team members               |
| `roles.manage`         | Manage roles & permissions        |
| `team.settings.manage` | Manage team settings              |
| `production.manage`    | Create/manage productions         |
| `production.view`      | View productions                  |

Default roles: **OWNER** (all), **ADMIN**, **PRODUCER**, **OPERATOR**, **VIEWER**.

## API (website → bot)

The bot exposes a small HTTP API on port 4000:

| Endpoint        | Method | Body                                     | Purpose                 |
| --------------- | ------ | ---------------------------------------- | ----------------------- |
| `/api/status`   | GET    | —                                        | Bot online, guild count |
| `/api/notify`   | POST   | `{ guildId, channelName, message }`      | Send a Discord message  |

## Security notes

- Change `SESSION_SECRET` in production.
- Keep `.env` out of version control.
- Use `HTTPS` (Cloudflare Tunnel provides it automatically).
- Rate limiting is enabled on all routes (`express-rate-limit`).

## License

Private / internal use.
