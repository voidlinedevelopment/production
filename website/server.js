require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { Strategy: DiscordStrategy } = require('passport-discord');
const ejsLayouts = require('express-ejs-layouts');
const http = require('http');
const { Server: SocketIO } = require('socket.io');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const methodOverride = require('method-override');
const path = require('path');
const fs = require('fs');
const { getDatabase, initializeDatabase, getAll, getOne, runQuery } = require('../shared/database');

const app = express();
const server = http.createServer(app);
const io = new SocketIO(server);

const PORT = process.env.PORT || 3000;

// Make io accessible to routes
app.set('io', io);

// Initialize database
initializeDatabase().then(() => {
  console.log('Database initialized successfully.');
}).catch((err) => {
  console.error('Database initialization failed:', err);
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(morgan('combined'));

// Trust proxy (Cloudflare tunnel sends X-Forwarded-For)
app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Simple SQLite Session Store
class SQLiteSessionStore extends session.Store {
  constructor(dbPath) {
    super();
    const sqlite3 = require('sqlite3').verbose();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new sqlite3.Database(dbPath);
    this.db.serialize(() => {
      this.db.run(`CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        expired INTEGER,
        sess TEXT
      )`);
      this.db.run('CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired)');
    });
  }
  get(sid, cb) {
    this.db.get('SELECT sess FROM sessions WHERE sid = ? AND expired > ?', [sid, Date.now()], (err, row) => {
      if (err) return cb(err);
      if (!row) return cb(null, null);
      try { cb(null, JSON.parse(row.sess)); } catch (e) { cb(e); }
    });
  }
  set(sid, sess, cb) {
    const maxAge = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 86400000;
    const expired = Date.now() + maxAge;
    const sessStr = JSON.stringify(sess);
    this.db.run('INSERT OR REPLACE INTO sessions (sid, expired, sess) VALUES (?, ?, ?)', [sid, expired, sessStr], cb || function(){});
  }
  destroy(sid, cb) {
    this.db.run('DELETE FROM sessions WHERE sid = ?', [sid], cb || function(){});
  }
  touch(sid, sess, cb) {
    const maxAge = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 86400000;
    const expired = Date.now() + maxAge;
    this.db.run('UPDATE sessions SET expired = ? WHERE sid = ?', [expired, sid], cb || function(){});
  }
  all(cb) {
    this.db.all('SELECT sid FROM sessions WHERE expired > ?', [Date.now()], (err, rows) => {
      if (err) return cb(err);
      cb(null, (rows || []).map(r => r.sid));
    });
  }
  length(cb) {
    this.db.get('SELECT COUNT(*) as count FROM sessions WHERE expired > ?', [Date.now()], (err, row) => {
      if (err) return cb(err);
      cb(null, row ? row.count : 0);
    });
  }
  clear(cb) {
    this.db.run('DELETE FROM sessions', cb || function(){});
  }
}

const sessionStore = new SQLiteSessionStore(
  path.join(__dirname, '..', 'database', 'sessions.db')
);

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'production-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: false
  }
}));

// Passport setup
const db = getDatabase();

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await getOne('SELECT * FROM users WHERE id = ?', [id]);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: process.env.DISCORD_CALLBACK_URL,
  scope: ['identify', 'email', 'guilds']
}, async (accessToken, refreshToken, profile, done) => {
  try {
    let user = await getOne('SELECT * FROM users WHERE discord_id = ?', [profile.id]);

    if (user) {
      await runQuery(
        'UPDATE users SET username = ?, global_name = ?, avatar = ?, email = ?, updated_at = CURRENT_TIMESTAMP WHERE discord_id = ?',
        [profile.username, profile.global_name, profile.avatar, profile.email || null, profile.id]
      );
      user = await getOne('SELECT * FROM users WHERE discord_id = ?', [profile.id]);
    } else {
      const result = await runQuery(
        'INSERT INTO users (discord_id, username, global_name, avatar, email) VALUES (?, ?, ?, ?, ?)',
        [profile.id, profile.username, profile.global_name, profile.avatar, profile.email || null]
      );
      user = await getOne('SELECT * FROM users WHERE id = ?', [result.id]);
    }

    // Store guilds in session for server connection
    user.guilds = profile.guilds;
    done(null, user);
  } catch (err) {
    done(err, null);
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// Make user available to all views
app.use((req, res, next) => {
  res.locals.user = req.user || null;
  res.locals.currentPath = req.path;
  next();
});

// EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(ejsLayouts);
app.set('layout', 'partials/layout');

// Routes
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const teamRoutes = require('./routes/teams');
const obsRoutes = require('./routes/obs');
const productionRoutes = require('./routes/production');
const apiRoutes = require('./routes/api');
const memberRoutes = require('./routes/members');
const roleRoutes = require('./routes/roles');
const settingsRoutes = require('./routes/settings');
const agentRoutes = require('./routes/agent');

app.use('/auth', authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/teams', teamRoutes);
app.use('/obs', obsRoutes);
app.use('/productions', productionRoutes);
app.use('/api', apiRoutes);
app.use('/members', memberRoutes);
app.use('/roles', roleRoutes);
app.use('/settings', settingsRoutes);
app.use('/agent', agentRoutes);

// Home route
app.get('/', (req, res) => {
  if (req.user) {
    return res.redirect('/dashboard');
  }
  res.render('login', { layout: false });
});

// 404
app.use((req, res) => {
  res.status(404).render('error', {
    title: '404 - Not Found',
    message: 'The page you are looking for does not exist.',
    user: req.user
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', {
    title: '500 - Server Error',
    message: 'Something went wrong on our end.',
    user: req.user
  });
});

// Socket.IO + OBS Service
const obsService = require('./services/obsService');
obsService.setIO(io);

function agentOnline(connId) {
  const room = io.sockets.adapter.rooms.get(`agent-${connId}`);
  return room ? room.size > 0 : false;
}

const agentObsState = new Map();
const lastPreviewLog = new Map();

function emitAgentState(room, connId, state) {
  if (!state || !state.connected || !state.info) return;
  io.to(room).emit('obs-scene', { connId, scene: state.info.currentScene, scenes: state.info.scenes });
  io.to(room).emit('obs-stream-status', { connId, streaming: state.info.streaming });
  io.to(room).emit('obs-recording-status', { connId, recording: state.info.recording });
  io.to(room).emit('obs-stats', { connId, fps: state.info.fps });
}

function notifyAgentsPreview(teamId, enabled) {
  getAll('SELECT id FROM obs_connections WHERE team_id = ? AND agent_token IS NOT NULL', [teamId]).then((conns) => {
    conns.forEach((c) => {
      if (agentOnline(c.id)) {
        io.to(`agent-${c.id}`).emit('agent-obs-preview', { connId: c.id, enabled });
      }
    });
  });
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.teamIds = [];

  socket.on('join-team', async (teamId) => {
    socket.join(`team-${teamId}`);
    if (!socket.teamIds.includes(teamId)) socket.teamIds.push(teamId);

    const agentConns = await getAll(
      'SELECT id FROM obs_connections WHERE team_id = ? AND agent_token IS NOT NULL',
      [teamId]
    );

    const room = io.sockets.adapter.rooms.get(`team-${teamId}`);
    const isFirstViewer = room && room.size === 1;

    agentConns.forEach((c) => {
      socket.emit('obs-agent-status', { connId: c.id, online: agentOnline(c.id) });
      emitAgentState(`team-${teamId}`, c.id, agentObsState.get(c.id));
    });

    if (isFirstViewer) notifyAgentsPreview(teamId, true);
  });

  socket.on('leave-team', (teamId) => {
    socket.leave(`team-${teamId}`);
    socket.teamIds = socket.teamIds.filter((t) => t !== teamId);
  });

  socket.on('agent-auth', async (data) => {
    const { token } = data || {};
    const conn = await getOne('SELECT * FROM obs_connections WHERE agent_token = ?', [token]);
    if (!conn) {
      socket.emit('agent-auth-result', { ok: false, error: 'Invalid agent token' });
      socket.disconnect();
      return;
    }
    socket.agentConnId = conn.id;
    socket.join(`agent-${conn.id}`);
    socket.emit('agent-auth-result', { ok: true, connId: conn.id, name: conn.name });
    io.to(`team-${conn.team_id}`).emit('obs-agent-status', { connId: conn.id, online: true });
    console.log(`OBS Agent online for conn ${conn.id}`);
  });

  socket.on('agent-obs-status', async (data) => {
    const connId = socket.agentConnId;
    if (!connId) return;
    const conn = await getOne('SELECT team_id FROM obs_connections WHERE id = ?', [connId]);
    if (!conn) return;

    const status = data.connected ? 'connected' : 'disconnected';
    await runQuery('UPDATE obs_connections SET status = ? WHERE id = ?', [status, connId]);
    const room = `team-${conn.team_id}`;
    io.to(room).emit('obs-status', { connId, connected: data.connected });

    if (data.connected && data.info) {
      agentObsState.set(connId, { connected: true, info: data.info });
      emitAgentState(room, connId, { connected: true, info: data.info });
    } else {
      agentObsState.delete(connId);
    }
    if (data.error) {
      io.to(room).emit('obs-error', { connId, error: data.error });
    }
  });

  socket.on('agent-obs-preview', async (data) => {
    const connId = socket.agentConnId;
    if (!connId) return;
    const conn = await getOne('SELECT team_id FROM obs_connections WHERE id = ?', [connId]);
    if (!conn) return;
    if (data.image) {
      const now = Date.now();
      const last = lastPreviewLog.get(connId) || 0;
      if (now - last > 10000) {
        lastPreviewLog.set(connId, now);
        console.log(`[preview] relaying frame for conn ${connId}, ${data.image.length} chars`);
      }
    }
    io.to(`team-${conn.team_id}`).emit('obs-preview', {
      connId,
      image: data.image,
      width: data.width,
      height: data.height
    });
  });

  socket.on('obs-preview-control', async (data) => {
    const { connId, enabled } = data || {};
    if (!connId) return;
    const conn = await getOne('SELECT team_id FROM obs_connections WHERE id = ?', [connId]);
    if (!conn || !socket.teamIds.includes(conn.team_id)) return;
    if (agentOnline(connId)) {
      io.to(`agent-${connId}`).emit('agent-obs-preview', { connId, enabled: !!enabled });
    }
  });

  socket.on('agent-obs-event', async (data) => {
    const connId = socket.agentConnId;
    if (!connId) return;
    const conn = await getOne('SELECT team_id FROM obs_connections WHERE id = ?', [connId]);
    if (!conn) return;

    const room = `team-${conn.team_id}`;
    switch (data.event) {
      case 'CurrentProgramSceneChanged':
        io.to(room).emit('obs-scene', { connId, scene: data.data.sceneName });
        break;
      case 'StreamStateChanged':
        io.to(room).emit('obs-stream-status', { connId, streaming: data.data.outputActive });
        break;
      case 'RecordStateChanged':
        io.to(room).emit('obs-recording-status', { connId, recording: data.data.outputActive });
        break;
    }
  });

  socket.on('agent-obs-result', async (data) => {
    const connId = socket.agentConnId;
    if (!connId) return;
    const conn = await getOne('SELECT team_id FROM obs_connections WHERE id = ?', [connId]);
    if (!conn) return;

    const room = `team-${conn.team_id}`;
    if (data.success) {
      if (data.command === 'switchScene') {
        io.to(room).emit('obs-scene', { connId, scene: data.scene });
      } else if (data.command === 'startStream') {
        io.to(room).emit('obs-stream-status', { connId, streaming: true });
        await runQuery('INSERT INTO activity_logs (team_id, action) VALUES (?, ?)', [conn.team_id, 'Stream started']);
      } else if (data.command === 'stopStream') {
        io.to(room).emit('obs-stream-status', { connId, streaming: false });
        await runQuery('INSERT INTO activity_logs (team_id, action) VALUES (?, ?)', [conn.team_id, 'Stream stopped']);
      } else if (data.command === 'startRecording') {
        io.to(room).emit('obs-recording-status', { connId, recording: true });
      } else if (data.command === 'stopRecording') {
        io.to(room).emit('obs-recording-status', { connId, recording: false });
      }
    } else {
      io.to(room).emit('obs-error', { connId, error: data.error || 'OBS command failed' });
    }
  });

  socket.on('obs-connect', async (data) => {
    const { teamId, connId, host, port, password } = data;
    const conn = await getOne('SELECT * FROM obs_connections WHERE id = ?', [connId]);

    if (conn && conn.agent_token) {
      if (agentOnline(connId)) {
        io.to(`agent-${connId}`).emit('agent-obs-command', { connId, command: 'connect' });
      } else {
        io.to(`team-${teamId}`).emit('obs-status', { connId, connected: false });
        io.to(`team-${teamId}`).emit('obs-error', {
          connId,
          error: 'OBS agent is offline. Run the agent app on the streaming PC and keep it open.'
        });
      }
      return;
    }

    const result = await obsService.connect(connId, host, port, password);

    if (result.success) {
      await runQuery(
        "UPDATE obs_connections SET status = 'connected' WHERE id = ?",
        [connId]
      );
      io.to(`team-${teamId}`).emit('obs-status', { connId, connected: true });
      io.to(`team-${teamId}`).emit('obs-scene', {
        connId,
        scene: result.info.currentScene,
        scenes: result.info.scenes
      });
      io.to(`team-${teamId}`).emit('obs-stream-status', {
        connId,
        streaming: result.info.streaming
      });
      io.to(`team-${teamId}`).emit('obs-recording-status', {
        connId,
        recording: result.info.recording
      });
      io.to(`team-${teamId}`).emit('obs-stats', {
        connId,
        fps: result.info.fps
      });
    } else {
      await runQuery(
        "UPDATE obs_connections SET status = 'disconnected' WHERE id = ?",
        [connId]
      );
      io.to(`team-${teamId}`).emit('obs-status', { connId, connected: false });
      io.to(`team-${teamId}`).emit('obs-error', { connId, error: result.error });
    }
  });

  socket.on('obs-disconnect', async (data) => {
    const { teamId, connId } = data;
    const conn = await getOne('SELECT * FROM obs_connections WHERE id = ?', [connId]);

    if (conn && conn.agent_token) {
      if (agentOnline(connId)) {
        io.to(`agent-${connId}`).emit('agent-obs-command', { connId, command: 'disconnect' });
      } else {
        await runQuery(
          "UPDATE obs_connections SET status = 'disconnected' WHERE id = ?",
          [connId]
        );
        io.to(`team-${teamId}`).emit('obs-status', { connId, connected: false });
      }
      return;
    }

    await obsService.disconnect(connId);
    await runQuery(
      "UPDATE obs_connections SET status = 'disconnected' WHERE id = ?",
      [connId]
    );
    io.to(`team-${teamId}`).emit('obs-status', { connId, connected: false });
  });

  socket.on('obs-command', async (data) => {
    const { teamId, connId, command, scene } = data;
    const conn = await getOne('SELECT * FROM obs_connections WHERE id = ?', [connId]);

    if (conn && conn.agent_token) {
      if (!agentOnline(connId)) {
        io.to(`team-${teamId}`).emit('obs-error', {
          connId,
          error: 'OBS agent is offline. Run the agent app on the streaming PC and keep it open.'
        });
        return;
      }
      io.to(`agent-${connId}`).emit('agent-obs-command', { connId, command, scene });
      return;
    }

    let result;

    switch (command) {
      case 'switchScene':
        result = await obsService.switchScene(connId, scene);
        if (result.success) {
          io.to(`team-${teamId}`).emit('obs-scene', { connId, scene });
        }
        break;
      case 'startStream':
        result = await obsService.startStream(connId);
        if (result.success) {
          io.to(`team-${teamId}`).emit('obs-stream-status', { connId, streaming: true });
          await runQuery(
            'INSERT INTO activity_logs (team_id, action) VALUES (?, ?)',
            [teamId, 'Stream started']
          );
        }
        break;
      case 'stopStream':
        result = await obsService.stopStream(connId);
        if (result.success) {
          io.to(`team-${teamId}`).emit('obs-stream-status', { connId, streaming: false });
          await runQuery(
            'INSERT INTO activity_logs (team_id, action) VALUES (?, ?)',
            [teamId, 'Stream stopped']
          );
        }
        break;
      case 'startRecording':
        result = await obsService.startRecording(connId);
        if (result.success) {
          io.to(`team-${teamId}`).emit('obs-recording-status', { connId, recording: true });
        }
        break;
      case 'stopRecording':
        result = await obsService.stopRecording(connId);
        if (result.success) {
          io.to(`team-${teamId}`).emit('obs-recording-status', { connId, recording: false });
        }
        break;
    }
  });

  socket.on('disconnect', () => {
    socket.teamIds.forEach((teamId) => {
      const room = io.sockets.adapter.rooms.get(`team-${teamId}`);
      if (!room || room.size === 0) {
        notifyAgentsPreview(teamId, false);
      }
    });

    if (socket.agentConnId) {
      const connId = socket.agentConnId;
      agentObsState.delete(connId);
      getOne('SELECT team_id FROM obs_connections WHERE id = ?', [connId]).then((conn) => {
        if (conn) {
          runQuery("UPDATE obs_connections SET status = 'disconnected' WHERE id = ?", [connId]);
          io.to(`team-${conn.team_id}`).emit('obs-agent-status', { connId, online: false });
          io.to(`team-${conn.team_id}`).emit('obs-status', { connId, connected: false });
        }
      });
      console.log(`OBS Agent offline for conn ${connId}`);
    }
    console.log('Client disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Production Website running on port ${PORT}`);
});

module.exports = { app, server, io };
