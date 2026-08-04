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
const { getDatabase, initializeDatabase, getOne, runQuery } = require('../shared/database');

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
const EventEmitter = require('events');
class SQLiteSessionStore extends EventEmitter {
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

app.use('/auth', authRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/teams', teamRoutes);
app.use('/obs', obsRoutes);
app.use('/productions', productionRoutes);
app.use('/api', apiRoutes);
app.use('/members', memberRoutes);
app.use('/roles', roleRoutes);
app.use('/settings', settingsRoutes);

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

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-team', (teamId) => {
    socket.join(`team-${teamId}`);
  });

  socket.on('leave-team', (teamId) => {
    socket.leave(`team-${teamId}`);
  });

  socket.on('obs-connect', async (data) => {
    const { teamId, connId, host, port, password } = data;
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
    }
  });

  socket.on('obs-disconnect', async (data) => {
    const { teamId, connId } = data;
    await obsService.disconnect(connId);
    await runQuery(
      "UPDATE obs_connections SET status = 'disconnected' WHERE id = ?",
      [connId]
    );
    io.to(`team-${teamId}`).emit('obs-status', { connId, connected: false });
  });

  socket.on('obs-command', async (data) => {
    const { teamId, connId, command, scene } = data;
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
    console.log('Client disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Production Website running on port ${PORT}`);
});

module.exports = { app, server, io };
