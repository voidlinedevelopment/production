const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

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
    db.all('PRAGMA table_info(obs_connections)', (err, cols) => {
      if (err) return reject(err);
      if (!cols.some((c) => c.name === 'agent_token')) {
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
}

function addOverlayText(resolve, reject) {
  db.all('PRAGMA table_info(obs_connections)', (err, cols) => {
    if (err) return reject(err);
    if (cols.some((c) => c.name === 'overlay_text')) return resolve();
    db.run("ALTER TABLE obs_connections ADD COLUMN overlay_text TEXT DEFAULT ''", (migrateErr) => {
      if (migrateErr) {
        console.error('Migration error:', migrateErr.message);
      }
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

module.exports = {
  getDatabase,
  initializeDatabase,
  migrate,
  runQuery,
  getOne,
  getAll
};
