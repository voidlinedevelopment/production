const express = require('express');
const router = express.Router();
const { getAll, getOne, runQuery } = require('../shared/database');

const PAGE_SIZE = 50;

function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  return res.redirect('/login?redirected=1');
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.is_admin) return next();
  res.status(403).render('error', {
    title: 'Access Denied',
    message: 'You must be an admin to access the database.'
  });
}

function quote(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

function isSelect(sql) {
  return /^(SELECT|EXPLAIN|PRAGMA|WITH)\b/i.test(sql.trim());
}

router.get('/login', (req, res) => {
  if (req.isAuthenticated() && req.user.is_admin) return res.redirect('/');
  res.render('login', { title: 'DB Admin', redirect: req.query.redirected === '1' });
});

router.use(isAuthenticated, requireAdmin);

router.get('/', async (req, res) => {
  try {
    const tables = await getAll(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    );
    const withCounts = await Promise.all(
      tables.map(async (t) => {
        const row = await getOne(`SELECT COUNT(*) AS c FROM ${quote(t.name)}`);
        return { name: t.name, count: row ? row.c : 0 };
      })
    );
    res.render('index', { title: 'Database', tables: withCounts });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to list tables.' });
  }
});

router.get('/table/:name', async (req, res) => {
  const table = req.params.name;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    return res.status(400).render('error', { title: 'Bad table', message: 'Invalid table name.' });
  }
  try {
    const columns = await getAll(`PRAGMA table_info(${quote(table)})`);
    const rows = await getAll(`SELECT rowid AS __rowid, * FROM ${quote(table)} LIMIT ${PAGE_SIZE + 1}`);
    const truncated = rows.length > PAGE_SIZE;
    const pageRows = truncated ? rows.slice(0, PAGE_SIZE) : rows;

    let editRow = null;
    let editRowId = null;
    if (req.query.edit) {
      const row = await getOne(`SELECT rowid AS __rowid, * FROM ${quote(table)} WHERE rowid = ?`, [req.query.edit]);
      if (row) {
        editRow = row;
        editRowId = row.__rowid;
      }
    }

    const formCols = columns.filter((c) => !(c.pk && /INT/i.test(c.type || '')));

    res.render('table', {
      title: table,
      table,
      columns,
      formCols,
      rows: pageRows,
      truncated,
      editRow,
      editRowId,
      error: req.query.error,
      success: req.query.success
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load table: ' + err.message });
  }
});

router.post('/table/:name/insert', async (req, res) => {
  const table = req.params.name;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    return res.redirect(`/table/${encodeURIComponent(table)}?error=Invalid table name`);
  }
  try {
    const columns = await getAll(`PRAGMA table_info(${quote(table)})`);
    const cols = [];
    const params = [];
    for (const c of columns) {
      if (c.pk && /INT/i.test(c.type || '')) continue;
      const val = req.body[c.name];
      if (val === undefined) continue;
      cols.push(quote(c.name));
      params.push(val === '' ? null : val);
    }
    await runQuery(`INSERT INTO ${quote(table)} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, params);
    res.redirect(`/table/${encodeURIComponent(table)}?success=Row inserted.`);
  } catch (err) {
    console.error(err);
    res.redirect(`/table/${encodeURIComponent(table)}?error=${encodeURIComponent('Insert failed: ' + err.message)}`);
  }
});

router.post('/table/:name/update', async (req, res) => {
  const table = req.params.name;
  const rowid = req.body.__rowid;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table) || !rowid) {
    return res.redirect(`/table/${encodeURIComponent(table)}?error=Invalid request`);
  }
  try {
    const columns = await getAll(`PRAGMA table_info(${quote(table)})`);
    const sets = [];
    const params = [];
    for (const c of columns) {
      if (c.pk && /INT/i.test(c.type || '')) continue;
      const val = req.body[c.name];
      if (val === undefined) continue;
      sets.push(`${quote(c.name)} = ?`);
      params.push(val === '' ? null : val);
    }
    params.push(rowid);
    await runQuery(`UPDATE ${quote(table)} SET ${sets.join(', ')} WHERE rowid = ?`, params);
    res.redirect(`/table/${encodeURIComponent(table)}?success=Row updated.`);
  } catch (err) {
    console.error(err);
    res.redirect(`/table/${encodeURIComponent(table)}?error=${encodeURIComponent('Update failed: ' + err.message)}`);
  }
});

router.post('/table/:name/delete', async (req, res) => {
  const table = req.params.name;
  const rowid = req.body.rowid;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table) || !rowid) {
    return res.redirect(`/table/${encodeURIComponent(table)}?error=Invalid request`);
  }
  try {
    await runQuery(`DELETE FROM ${quote(table)} WHERE rowid = ?`, [rowid]);
    res.redirect(`/table/${encodeURIComponent(table)}?success=Row deleted.`);
  } catch (err) {
    console.error(err);
    res.redirect(`/table/${encodeURIComponent(table)}?error=${encodeURIComponent('Delete failed: ' + err.message)}`);
  }
});

router.get('/query', (req, res) => {
  res.render('query', { title: 'Run Query', sql: '', columns: null, rows: null, message: null });
});

router.post('/query', async (req, res) => {
  const sql = String(req.body.sql || '').trim();
  if (!sql) {
    return res.render('query', { title: 'Run Query', sql, columns: null, rows: null, message: 'Enter a query.' });
  }
  try {
    if (isSelect(sql)) {
      const rows = await getAll(sql);
      const columns = rows.length ? Object.keys(rows[0]) : [];
      res.render('query', { title: 'Run Query', sql, columns, rows, message: `${rows.length} row(s) returned.` });
    } else {
      const result = await runQuery(sql);
      res.render('query', { title: 'Run Query', sql, columns: null, rows: null, message: `OK — ${result.changes} row(s) changed.` });
    }
  } catch (err) {
    console.error(err);
    res.render('query', { title: 'Run Query', sql, columns: null, rows: null, message: 'Error: ' + err.message });
  }
});

module.exports = router;
