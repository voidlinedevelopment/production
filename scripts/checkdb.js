const { getDatabase, getAll } = require('../shared/database');

(async () => {
  const db = getDatabase();
  db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
    if (err) return console.error(err);
    console.log('Tables:', rows.map(r => r.name).join(', '));

    getAll('SELECT * FROM permissions', []).then(perms => {
      console.log('Permissions:', perms.map(p => p.name).join(', '));
      db.close();
    });
  });
})();
