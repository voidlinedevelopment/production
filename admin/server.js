require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { Strategy: DiscordStrategy } = require('passport-discord');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const ejsLayouts = require('express-ejs-layouts');
const { initializeDatabase, getOne, runQuery } = require('../shared/database');

const app = express();
const PORT = process.env.ADMIN_PORT || 3007;
const WEBSITE_URL = process.env.WEBSITE_URL || 'http://localhost:3000';
const ADMIN_URL = process.env.ADMIN_URL || `http://localhost:${PORT}`;

initializeDatabase()
  .then(() => console.log('admin: database ready'))
  .catch((err) => console.error('admin: db init failed:', err.message));

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(morgan('combined'));
app.set('trust proxy', 1);

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, message: 'Too many requests from this IP, please try again later.' });
app.use(limiter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(ejsLayouts);
app.set('layout', 'partials/layout');

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
    });
    setInterval(() => {
      this.db.run('DELETE FROM sessions WHERE expired < ?', [Date.now()], function () {});
    }, 60 * 60 * 1000).unref();
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
    this.db.run('INSERT OR REPLACE INTO sessions (sid, expired, sess) VALUES (?, ?, ?)', [sid, expired, sessStr], cb || function () {});
  }
  destroy(sid, cb) {
    this.db.run('DELETE FROM sessions WHERE sid = ?', [sid], cb || function () {});
  }
  touch(sid, sess, cb) {
    const maxAge = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 86400000;
    const expired = Date.now() + maxAge;
    this.db.run('UPDATE sessions SET expired = ? WHERE sid = ?', [expired, sid], cb || function () {});
  }
  all(cb) {
    this.db.all('SELECT sid FROM sessions WHERE expired > ?', [Date.now()], (err, rows) => {
      if (err) return cb(err);
      cb(null, (rows || []).map((r) => r.sid));
    });
  }
  length(cb) {
    this.db.get('SELECT COUNT(*) as count FROM sessions WHERE expired > ?', [Date.now()], (err, row) => {
      if (err) return cb(err);
      cb(null, row ? row.count : 0);
    });
  }
  clear(cb) {
    this.db.run('DELETE FROM sessions', cb || function () {});
  }
}

const sessionStore = new SQLiteSessionStore(path.join(__dirname, '..', 'database', 'sessions.db'));

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'production-dev-secret-change-me',
  name: 'connect.sid',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: false
  }
}));

passport.serializeUser((user, done) => done(null, user.id));

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
  callbackURL: process.env.ADMIN_DISCORD_CALLBACK_URL || `${ADMIN_URL}/auth/discord/callback`,
  scope: ['identify', 'email']
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
    done(null, user);
  } catch (err) {
    done(err, null);
  }
}));

app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  res.locals.user = req.user || null;
  res.locals.currentPath = req.path;
  res.locals.websiteUrl = WEBSITE_URL;
  res.locals.supportUrl = process.env.SUPPORT_URL || '';
  if (req.query.error) res.locals.error = req.query.error;
  if (req.query.success) res.locals.success = req.query.success;
  next();
});

app.get('/auth/discord', passport.authenticate('discord', { scope: ['identify', 'email'] }));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/login?redirected=1' }), (req, res) => {
  res.redirect('/');
});
app.get('/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) console.error(err);
    res.redirect('/');
  });
});

const adminRoutes = require('./routes');
app.use(adminRoutes);

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not Found', message: 'Page not found.' });
});

app.listen(PORT, () => {
  console.log(`admin app listening on port ${PORT}`);
  console.log(`Admin panel: ${ADMIN_URL}`);
});
