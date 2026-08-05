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
const { initializeDatabase, getOne, getAll, runQuery } = require('../shared/database');
const { getPlan, PLAN_ORDER } = require('../shared/plans');

const app = express();
const PORT = process.env.SUPPORT_PORT || 3005;
const WEBSITE_URL = process.env.WEBSITE_URL || 'http://localhost:3000';
const SUPPORT_URL = process.env.SUPPORT_URL || `http://localhost:${PORT}`;
const ADMIN_IDS = (process.env.SUPPORT_ADMIN_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const CATEGORIES = ['Billing', 'Technical', 'Feature Request', 'Account', 'Other'];
const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
const TIER_NAMES = { free: 'Community', creator: 'Priority', studio: 'Priority', enterprise: 'Dedicated' };
const TIER_RESPONSE = {
  free: 'Community support is answered as soon as possible, usually within 2-3 days.',
  creator: 'Priority support is answered within 24 hours.',
  studio: 'Priority support is answered within 12 hours.',
  enterprise: 'Dedicated 1:1 support with a named account manager and 24/7 priority queue.'
};

initializeDatabase()
  .then(() => console.log('support: database ready'))
  .catch((err) => console.error('support: db init failed:', err.message));

// Security middleware
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

// SQLite session store shared with the website so logins carry across
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
    this.db.run('INSERT OR REPLACE INTO sessions (sid, expired, sess) VALUES (?, ?, ?)', [sid, expired, JSON.stringify(sess)], cb || function () {});
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

const cookieOpts = {
  maxAge: 7 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  secure: false
};
if (process.env.COOKIE_DOMAIN) cookieOpts.domain = process.env.COOKIE_DOMAIN;

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'production-dev-secret-change-me',
  name: 'connect.sid',
  resave: false,
  saveUninitialized: false,
  cookie: cookieOpts
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
  callbackURL: process.env.SUPPORT_DISCORD_CALLBACK_URL || `${SUPPORT_URL}/auth/discord/callback`,
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
  next();
});

function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  return res.redirect('/?login=1');
}

function isAdmin(user) {
  return user && ADMIN_IDS.includes(String(user.discord_id));
}

async function supportTier(userId) {
  const rows = await getAll(
    `SELECT s.plan FROM subscriptions s
     JOIN teams t ON t.id = s.team_id
     WHERE t.owner_id = ? AND s.status IN ('active', 'trialing')`,
    [userId]
  );
  let best = 'free';
  for (const row of rows) {
    if (PLAN_ORDER.indexOf(row.plan) > PLAN_ORDER.indexOf(best)) best = row.plan;
  }
  return {
    planKey: best,
    planName: getPlan(best).name,
    tier: TIER_NAMES[best],
    responseTime: TIER_RESPONSE[best]
  };
}

app.get('/', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.render('login', { title: 'Support', redirect: req.query.login === '1' });
  }
  try {
    const tier = await supportTier(req.user.id);
    const tickets = await getAll('SELECT * FROM support_tickets WHERE user_id = ? ORDER BY updated_at DESC', [req.user.id]);
    const openCount = tickets.filter((t) => t.status !== 'closed').length;
    res.render('index', { title: 'Support Portal', tier, tickets, openCount, isAdmin: isAdmin(req.user) });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load support portal.' });
  }
});

app.get('/tickets', isAuthenticated, async (req, res) => {
  try {
    const admin = isAdmin(req.user);
    const where = admin ? '1=1' : 'user_id = ?';
    const params = admin ? [] : [req.user.id];
    const tickets = await getAll(`SELECT st.*, u.discord_id, u.username, u.global_name, u.avatar FROM support_tickets st LEFT JOIN users u ON u.id = st.user_id WHERE ${where} ORDER BY st.updated_at DESC`, params);
    const tier = await supportTier(req.user.id);
    res.render('tickets', { title: 'My Tickets', tickets, isAdmin: admin, tier });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load tickets.' });
  }
});

app.get('/tickets/new', isAuthenticated, (req, res) => {
  res.render('new', { title: 'Open a Ticket', categories: CATEGORIES, priorities: req.query.enterprise === '1' ? PRIORITIES : PRIORITIES.slice(0, 3) });
});

app.post('/tickets/new', isAuthenticated, async (req, res) => {
  try {
    const { subject, category, priority, body } = req.body;
    if (!subject || !body) {
      return res.redirect('/tickets/new?error=Subject and message are required');
    }
    const ticket = await runQuery(
      'INSERT INTO support_tickets (user_id, subject, category, priority) VALUES (?, ?, ?, ?)',
      [req.user.id, subject.trim(), CATEGORIES.includes(category) ? category : 'Other', PRIORITIES.includes(priority) ? priority : 'Low']
    );
    await runQuery(
      'INSERT INTO support_ticket_messages (ticket_id, user_id, author_type, body) VALUES (?, ?, ?, ?)',
      [ticket.id, req.user.id, 'user', body.trim()]
    );
    res.redirect(`/tickets/${ticket.id}`);
  } catch (err) {
    console.error(err);
    res.redirect('/tickets/new?error=Failed to open ticket');
  }
});

async function loadTicket(ticketId) {
  return getOne('SELECT * FROM support_tickets WHERE id = ?', [ticketId]);
}

app.get('/tickets/:id', isAuthenticated, async (req, res) => {
  try {
    const ticket = await loadTicket(req.params.id);
    if (!ticket) return res.status(404).render('error', { title: 'Not Found', message: 'Ticket not found.' });
    const admin = isAdmin(req.user);
    if (!admin && ticket.user_id !== req.user.id) {
      return res.status(403).render('error', { title: 'Access Denied', message: 'You do not have access to this ticket.' });
    }
    const messages = await getAll(
      `SELECT stm.*, u.discord_id, u.username, u.global_name, u.avatar
       FROM support_ticket_messages stm LEFT JOIN users u ON u.id = stm.user_id
       WHERE stm.ticket_id = ? ORDER BY stm.created_at`,
      [ticket.id]
    );
    const owner = await getOne('SELECT * FROM users WHERE id = ?', [ticket.user_id]);
    const tier = await supportTier(ticket.user_id);
    res.render('ticket', { title: ticket.subject, ticket, messages, owner, ownerTier: tier, isAdmin: admin, canReply: admin || ticket.status !== 'closed' });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load ticket.' });
  }
});

app.post('/tickets/:id/reply', isAuthenticated, async (req, res) => {
  try {
    const ticket = await loadTicket(req.params.id);
    if (!ticket) return res.redirect('/tickets');
    const admin = isAdmin(req.user);
    if (!admin && (ticket.user_id !== req.user.id || ticket.status === 'closed')) {
      return res.status(403).render('error', { title: 'Access Denied', message: 'You cannot reply to this ticket.' });
    }
    const body = (req.body.body || '').trim();
    if (!body) return res.redirect(`/tickets/${ticket.id}?error=Message is required`);
    await runQuery(
      'INSERT INTO support_ticket_messages (ticket_id, user_id, author_type, body) VALUES (?, ?, ?, ?)',
      [ticket.id, req.user.id, admin ? 'staff' : 'user', body]
    );
    await runQuery("UPDATE support_tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [admin ? 'pending' : 'open', ticket.id]);
    res.redirect(`/tickets/${ticket.id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/tickets/${req.params.id}?error=Failed to send reply`);
  }
});

app.post('/tickets/:id/status', isAuthenticated, async (req, res) => {
  try {
    const ticket = await loadTicket(req.params.id);
    if (!ticket) return res.redirect('/tickets');
    const admin = isAdmin(req.user);
    if (!admin && ticket.user_id !== req.user.id) {
      return res.status(403).render('error', { title: 'Access Denied', message: 'You cannot change this ticket.' });
    }
    const next = req.body.status === 'closed' ? 'closed' : 'open';
    await runQuery('UPDATE support_tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [next, ticket.id]);
    res.redirect(`/tickets/${ticket.id}`);
  } catch (err) {
    console.error(err);
    res.redirect('/tickets');
  }
});

app.get('/auth/discord', passport.authenticate('discord', { scope: ['identify', 'email'] }));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/?login=1' }), (req, res) => {
  res.redirect('/');
});
app.get('/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) console.error(err);
    res.redirect('/');
  });
});

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not Found', message: 'Page not found.' });
});

app.listen(PORT, () => {
  console.log(`support app listening on port ${PORT}`);
  console.log(`Support portal: ${SUPPORT_URL}`);
});
