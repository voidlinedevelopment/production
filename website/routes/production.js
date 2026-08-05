const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const { teamAccess } = require('../middleware/teamAccess');
const { checkPermission } = require('../middleware/permissions');
const { getAll, getOne, runQuery } = require('../../shared/database');
const { teamFlag } = require('../services/planService');
const { deliverWebhooks } = require('../services/webhookService');

router.get('/', isAuthenticated, async (req, res) => {
  try {
    const teams = await getAll(
      'SELECT t.id FROM teams t LEFT JOIN team_members tm ON tm.team_id = t.id WHERE t.owner_id = ? OR tm.user_id = ? GROUP BY t.id LIMIT 1',
      [req.user.id, req.user.id]
    );
    if (teams.length === 0) return res.redirect('/teams');
    res.redirect(`/productions/${teams[0].id}`);
  } catch (err) {
    res.redirect('/teams');
  }
});

router.get('/:teamId', isAuthenticated, teamAccess, checkPermission('production.view'), async (req, res) => {
  try {
    const productions = await getAll(
      'SELECT * FROM productions WHERE team_id = ? ORDER BY start_time DESC',
      [req.team.id]
    );

    const templates = await getAll(
      'SELECT id, name, created_at FROM production_templates WHERE team_id = ? ORDER BY created_at DESC',
      [req.team.id]
    );

    res.render('productions/index', {
      title: 'Productions',
      team: req.team,
      productions,
      templates,
      templatesOk: (await teamFlag(req.team.id, 'productionTemplates')).ok
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load productions.', user: req.user });
  }
});

router.get('/:teamId/create', isAuthenticated, teamAccess, checkPermission('production.manage'), async (req, res) => {
  const templates = await getAll(
    'SELECT id, name, created_at FROM production_templates WHERE team_id = ? ORDER BY created_at DESC',
    [req.team.id]
  );
  const templatesOk = (await teamFlag(req.team.id, 'productionTemplates')).ok;
  res.render('productions/create', { title: 'Create Production', team: req.team, templates, templatesOk });
});

router.post('/:teamId/create', isAuthenticated, teamAccess, checkPermission('production.manage'), async (req, res) => {
  try {
    const { name, description, start_time, end_time, template_id } = req.body;
    const result = await runQuery(
      'INSERT INTO productions (team_id, name, description, start_time, end_time) VALUES (?, ?, ?, ?, ?)',
      [req.team.id, name, description || '', start_time || null, end_time || null]
    );

    if (template_id) {
      const template = await getOne(
        'SELECT * FROM production_templates WHERE id = ? AND team_id = ?',
        [template_id, req.team.id]
      );
      if (template) {
        let items = [];
        try {
          items = JSON.parse(template.data || '[]');
        } catch (e) {}
        let pos = 0;
        for (const item of items) {
          await runQuery(
            'INSERT INTO rundown_items (production_id, title, description, start_time, duration, position) VALUES (?, ?, ?, ?, ?, ?)',
            [result.id, item.title, item.description || '', item.start_time || null, item.duration || 0, pos++]
          );
        }
      }
    }

    await runQuery(
      'INSERT INTO activity_logs (team_id, user_id, action) VALUES (?, ?, ?)',
      [req.team.id, req.user.id, `Created production: ${name}`]
    );

    res.redirect(`/productions/${req.team.id}/${result.id}`);
  } catch (err) {
    console.error(err);
    res.render('productions/create', { title: 'Create Production', team: req.team, error: 'Failed to create production.' });
  }
});

router.get('/:teamId/:prodId', isAuthenticated, teamAccess, checkPermission('production.view'), async (req, res) => {
  try {
    const production = await getOne(
      'SELECT * FROM productions WHERE id = ? AND team_id = ?',
      [req.params.prodId, req.team.id]
    );
    if (!production) {
      return res.status(404).render('error', { title: 'Not Found', message: 'Production not found.', user: req.user });
    }

    const rundown = await getAll(
      'SELECT * FROM rundown_items WHERE production_id = ? ORDER BY position',
      [production.id]
    );

    const assignedMembers = await getAll(
      `SELECT pm.*, u.username, u.global_name, u.avatar
       FROM production_members pm
       INNER JOIN users u ON u.id = pm.user_id
       WHERE pm.production_id = ?`,
      [production.id]
    );

    const allMembers = await getAll(
      `SELECT tm.user_id, u.username FROM team_members tm
       INNER JOIN users u ON u.id = tm.user_id
       WHERE tm.team_id = ?`,
      [req.team.id]
    );

    res.render('productions/view', {
      title: production.name,
      team: req.team,
      production,
      rundown,
      assignedMembers,
      allMembers,
      templatesOk: (await teamFlag(req.team.id, 'productionTemplates')).ok
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load production.', user: req.user });
  }
});

router.post('/:teamId/:prodId/template', isAuthenticated, teamAccess, checkPermission('production.manage'), async (req, res) => {
  try {
    const chk = await teamFlag(req.team.id, 'productionTemplates');
    if (!chk.ok) {
      return res.redirect(`/productions/${req.team.id}/${req.params.prodId}?error=${encodeURIComponent(`Production templates are a ${chk.plan.name} plan feature.`)}`);
    }
    const { name } = req.body;
    if (!name) return res.redirect(`/productions/${req.team.id}/${req.params.prodId}?error=${encodeURIComponent('Template name is required.')}`);
    const items = await getAll('SELECT title, description, start_time, duration FROM rundown_items WHERE production_id = ? ORDER BY position', [req.params.prodId]);
    await runQuery(
      'INSERT INTO production_templates (team_id, name, data) VALUES (?, ?, ?)',
      [req.team.id, name.trim(), JSON.stringify(items)]
    );
    res.redirect(`/productions/${req.team.id}/${req.params.prodId}?success=${encodeURIComponent(`Saved as template "${name}".`)}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/productions/${req.team.id}/${req.params.prodId}`);
  }
});

router.post('/:teamId/templates/:id/delete', isAuthenticated, teamAccess, checkPermission('production.manage'), async (req, res) => {
  try {
    await runQuery('DELETE FROM production_templates WHERE id = ? AND team_id = ?', [req.params.id, req.team.id]);
    res.redirect(`/productions/${req.team.id}`);
  } catch (err) {
    res.redirect(`/productions/${req.team.id}`);
  }
});

router.post('/:teamId/:prodId/status', isAuthenticated, teamAccess, checkPermission('production.manage'), async (req, res) => {
  try {
    const { status } = req.body;
    await runQuery('UPDATE productions SET status = ? WHERE id = ? AND team_id = ?', [status, req.params.prodId, req.team.id]);

    const io = req.app.get('io');
    io.to(`team-${req.team.id}`).emit('production-status-change', {
      productionId: req.params.prodId,
      status
    });

    const production = await getOne('SELECT name FROM productions WHERE id = ? AND team_id = ?', [req.params.prodId, req.team.id]);
    const eventMap = { live: 'production.live', completed: 'production.completed', draft: 'production.draft' };
    const webhookEvent = eventMap[status];
    if (webhookEvent) {
      await deliverWebhooks(req.team.id, webhookEvent, { productionId: req.params.prodId, productionName: production ? production.name : null });
    }

    res.redirect(`/productions/${req.team.id}/${req.params.prodId}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/productions/${req.team.id}/${req.params.prodId}`);
  }
});

router.post('/:teamId/:prodId/rundown', isAuthenticated, teamAccess, checkPermission('production.manage'), async (req, res) => {
  try {
    const { title, description, start_time, duration } = req.body;

    const maxPos = await getOne(
      'SELECT COALESCE(MAX(position), -1) as max_pos FROM rundown_items WHERE production_id = ?',
      [req.params.prodId]
    );

    await runQuery(
      'INSERT INTO rundown_items (production_id, title, description, start_time, duration, position) VALUES (?, ?, ?, ?, ?, ?)',
      [req.params.prodId, title, description || '', start_time || null, duration || 0, maxPos.max_pos + 1]
    );

    res.redirect(`/productions/${req.team.id}/${req.params.prodId}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/productions/${req.team.id}/${req.params.prodId}`);
  }
});

router.post('/:teamId/:prodId/rundown/:itemId/delete', isAuthenticated, teamAccess, checkPermission('production.manage'), async (req, res) => {
  try {
    await runQuery('DELETE FROM rundown_items WHERE id = ? AND production_id = ?', [req.params.itemId, req.params.prodId]);
    res.redirect(`/productions/${req.team.id}/${req.params.prodId}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/productions/${req.team.id}/${req.params.prodId}`);
  }
});

router.post('/:teamId/:prodId/assign', isAuthenticated, teamAccess, checkPermission('production.manage'), async (req, res) => {
  try {
    const { user_id } = req.body;
    await runQuery(
      'INSERT OR IGNORE INTO production_members (production_id, user_id) VALUES (?, ?)',
      [req.params.prodId, user_id]
    );
    res.redirect(`/productions/${req.team.id}/${req.params.prodId}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/productions/${req.team.id}/${req.params.prodId}`);
  }
});

router.post('/:teamId/:prodId/unassign/:userId', isAuthenticated, teamAccess, checkPermission('production.manage'), async (req, res) => {
  try {
    await runQuery(
      'DELETE FROM production_members WHERE production_id = ? AND user_id = ?',
      [req.params.prodId, req.params.userId]
    );
    res.redirect(`/productions/${req.team.id}/${req.params.prodId}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/productions/${req.team.id}/${req.params.prodId}`);
  }
});

module.exports = router;