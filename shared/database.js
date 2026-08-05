const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_DB_PATH = path.join(PROJECT_ROOT, 'database', 'production.db');

function resolveDbPath() {
  let p = process.env.DATABASE_PATH;
  if (!p) return DEFAULT_DB_PATH;

  if (!path.isAbsolute(p)) {
    p = path.join(PROJECT_ROOT, p);
  }

  fs.mkdirSync(path.dirname(p), { recursive: true });
  return p;
}

const DB_PATH = resolveDbPath();

let db = null;

function getDatabase() {
  if (db) return db;

  db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
      console.error('Error opening database:', err.message);
    } else {
      console.log('Connected to SQLite database.');
    }
  });

  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');

  return db;
}

function initializeDatabase() {
  const db = getDatabase();

  const tables = [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT UNIQUE NOT NULL,
      username TEXT NOT NULL,
      global_name TEXT,
      avatar TEXT,
      email TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      logo TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    )`,

    `CREATE TABLE IF NOT EXISTS role_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role_id INTEGER NOT NULL,
      permission_id INTEGER NOT NULL,
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
      FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
      UNIQUE(role_id, permission_id)
    )`,

    `CREATE TABLE IF NOT EXISTS team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role_id INTEGER,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE SET NULL,
      UNIQUE(team_id, user_id)
    )`,

    `CREATE TABLE IF NOT EXISTS discord_servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      guild_id TEXT UNIQUE NOT NULL,
      guild_name TEXT NOT NULL,
      icon TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS discord_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      discord_role_id TEXT NOT NULL,
      production_role_id INTEGER NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (production_role_id) REFERENCES roles(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS obs_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      host TEXT NOT NULL DEFAULT '127.0.0.1',
      port INTEGER NOT NULL DEFAULT 4455,
      password TEXT,
      agent_token TEXT,
      status TEXT DEFAULT 'disconnected',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS productions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      start_time DATETIME,
      end_time DATETIME,
      status TEXT DEFAULT 'draft',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS production_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      production_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(production_id, user_id)
    )`,

    `CREATE TABLE IF NOT EXISTS rundown_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      production_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      start_time DATETIME,
      duration INTEGER DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (production_id) REFERENCES productions(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER,
      user_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )`,

    `CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL UNIQUE,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      plan TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'inactive',
      current_period_end INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS support_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      subject TEXT NOT NULL,
      category TEXT DEFAULT 'Other',
      priority TEXT DEFAULT 'Low',
      status TEXT DEFAULT 'open',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS support_ticket_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      author_type TEXT DEFAULT 'user',
      body TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS promo_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      percent_off INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      max_uses INTEGER,
      used_count INTEGER NOT NULL DEFAULT 0,
      stripe_coupon_id TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )`,

    `CREATE TABLE IF NOT EXISTS overlay_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS scene_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conn_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      scene_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conn_id) REFERENCES obs_connections(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS production_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      secret TEXT NOT NULL DEFAULT '',
      events TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS api_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      last_used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS role_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      permissions TEXT NOT NULL DEFAULT '[]',
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    )`
  ];

  return new Promise((resolve, reject) => {
    db.serialize(() => {
      tables.forEach((sql) => {
        db.run(sql, (err) => {
          if (err) {
            console.error('Error creating table:', err.message);
          }
        });
      });

      // Seed default permissions
      const defaultPermissions = [
        'obs.view', 'obs.control', 'obs.scene.change',
        'obs.stream.start', 'obs.stream.stop', 'obs.recording.start',
        'obs.recording.stop', 'members.manage', 'roles.manage',
        'team.settings.manage', 'production.manage', 'production.view'
      ];

      const insertPerm = db.prepare('INSERT OR IGNORE INTO permissions (name) VALUES (?)');
      defaultPermissions.forEach((perm) => {
        insertPerm.run(perm);
      });
      insertPerm.finalize(() => {
        migrate().then(resolve).catch(reject);
      });
    });
  });
}

function migrate() {
  return new Promise((resolve, reject) => {
    db.all('PRAGMA table_info(users)', (err, cols) => {
      if (err) return reject(err);
      const addAdmin = (cb) => {
        if (cols.some((c) => c.name === 'is_admin')) return cb();
        db.run('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0', (migrateErr) => {
          if (migrateErr) console.error('Migration error:', migrateErr.message);
          syncAdminIds().then(cb).catch(cb);
        });
      };
      addAdmin(() => {
        db.all('PRAGMA table_info(obs_connections)', (obsErr, obsCols) => {
          if (obsErr) return reject(obsErr);
          if (!obsCols.some((c) => c.name === 'agent_token')) {
            db.run('ALTER TABLE obs_connections ADD COLUMN agent_token TEXT', (migrateErr) => {
              if (migrateErr) {
                console.error('Migration error:', migrateErr.message);
                return resolve();
              }
              addOverlayText(resolve, reject);
            });
          } else {
            addOverlayText(resolve, reject);
          }
        });
      });
    });
  });
}

function syncAdminIds() {
  return new Promise((resolve) => {
    const ids = (process.env.ADMIN_DISCORD_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) return resolve();
    const placeholders = ids.map(() => '?').join(',');
    db.run(`UPDATE users SET is_admin = 1 WHERE discord_id IN (${placeholders})`, ids, (err) => {
      if (err) console.error('Error syncing admin IDs:', err.message);
      resolve();
    });
  });
}

function addOverlayText(resolve, reject) {
  db.all('PRAGMA table_info(obs_connections)', (err, cols) => {
    if (err) return reject(err);
    if (cols.some((c) => c.name === 'overlay_text')) return addPublicIds(resolve, reject);
    db.run("ALTER TABLE obs_connections ADD COLUMN overlay_text TEXT DEFAULT ''", (migrateErr) => {
      if (migrateErr) {
        console.error('Migration error:', migrateErr.message);
      }
      addPublicIds(resolve, reject);
    });
  });
}

function addPublicIds(resolve, reject) {
  const genId = (prefix) => `${prefix}${crypto.randomBytes(8).toString('hex')}`;

  const ensure = (table, col, prefix, cb) => {
    db.all(`PRAGMA table_info(${table})`, (err, cols) => {
      if (err) return cb(err);
      if (cols.some((c) => c.name === col)) return cb();
      db.run(`ALTER TABLE ${table} ADD COLUMN ${col} TEXT`, (migrateErr) => {
        if (migrateErr) {
          console.error('Migration error:', migrateErr.message);
          return cb();
        }
        db.all(`SELECT id FROM ${table} WHERE ${col} IS NULL`, (err2, rows) => {
          if (err2) return cb(err2);
          const rowsArr = rows || [];
          let done = 0;
          if (rowsArr.length === 0) return cb();
          for (const row of rowsArr) {
            db.run(`UPDATE ${table} SET ${col} = ? WHERE id = ?`, [genId(prefix), row.id], (updateErr) => {
              if (updateErr) console.error('Migration error:', updateErr.message);
              done += 1;
              if (done >= rowsArr.length) cb();
            });
          }
        });
      });
    });
  };

  ensure('teams', 'public_id', 'tm_', (err1) => {
    if (err1) return reject(err1);
    ensure('obs_connections', 'public_id', 'conn_', (err2) => {
      if (err2) return reject(err2);
      resolve();
    });
  });
}

function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function getOne(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

function getAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function getSubscription(teamId) {
  return getOne('SELECT * FROM subscriptions WHERE team_id = ?', [teamId]);
}

function getTeamPlan(teamId) {
  return getSubscription(teamId).then((sub) => {
    if (sub && ['active', 'trialing'].includes(sub.status) && sub.plan) return sub.plan;
    return 'free';
  });
}

function upsertSubscription({ teamId, stripeCustomerId, stripeSubscriptionId, plan, status, currentPeriodEnd }) {
  return runQuery(
    `INSERT INTO subscriptions (team_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_end)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(team_id) DO UPDATE SET
       stripe_customer_id = excluded.stripe_customer_id,
       stripe_subscription_id = excluded.stripe_subscription_id,
       plan = excluded.plan,
       status = excluded.status,
       current_period_end = excluded.current_period_end,
       updated_at = CURRENT_TIMESTAMP`,
    [teamId, stripeCustomerId || null, stripeSubscriptionId || null, plan || 'free', status || 'inactive', currentPeriodEnd || null]
  );
}

module.exports = {
  getDatabase,
  initializeDatabase,
  migrate,
  syncAdminIds,
  runQuery,
  getOne,
  getAll,
  getSubscription,
  getTeamPlan,
  upsertSubscription
};
