const express = require('express');
const router = express.Router();
const { getAll, getOne, runQuery } = require('../shared/database');
const { getPlan } = require('../shared/plans');

function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  return res.redirect('/login?redirected=1');
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.is_admin) {
    return next();
  }
  res.status(403).render('error', {
    title: 'Access Denied',
    message: 'You must be an admin to access this page.'
  });
}

router.get('/login', (req, res) => {
  if (req.isAuthenticated() && req.user.is_admin) return res.redirect('/');
  res.render('login', { title: 'Admin Login', redirect: req.query.redirected === '1' });
});

router.use(isAuthenticated, requireAdmin);

const PROMO_CATEGORIES = ['billing', 'support', 'users'];

router.get('/', async (req, res) => {
  try {
    const { c: userCount } = await getOne('SELECT COUNT(*) AS c FROM users');
    const { c: teamCount } = await getOne('SELECT COUNT(*) AS c FROM teams');
    const { c: prodCount } = await getOne('SELECT COUNT(*) AS c FROM productions');
    const { c: liveCount } = await getOne("SELECT COUNT(*) AS c FROM productions WHERE status = 'live'");
    const { c: subCount } = await getOne("SELECT COUNT(*) AS c FROM subscriptions WHERE status = 'active'");
    const { c: ticketCount } = await getOne("SELECT COUNT(*) AS c FROM support_tickets WHERE status != 'closed'");
    const recentUsers = await getAll('SELECT * FROM users ORDER BY created_at DESC LIMIT 8');
    const subscriptions = await getAll(
      `SELECT s.*, t.name AS team_name FROM subscriptions s
       LEFT JOIN teams t ON t.id = s.team_id
       ORDER BY s.updated_at DESC LIMIT 8`
    );

    res.render('index', {
      title: 'Admin Dashboard',
      counts: { userCount, teamCount, prodCount, liveCount, subCount, ticketCount },
      recentUsers,
      subscriptions,
      getPlan
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load admin dashboard.' });
  }
});

router.get('/promo-codes', async (req, res) => {
  try {
    const codes = await getAll(
      `SELECT pc.*, u.username AS created_by_name FROM promo_codes pc
       LEFT JOIN users u ON u.id = pc.created_by
       ORDER BY pc.created_at DESC`
    );
    res.render('promo-codes', { title: 'Promo Codes', codes });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load promo codes.' });
  }
});

router.post('/promo-codes', async (req, res) => {
  try {
    const { code, percent_off, max_uses } = req.body;
    const normalized = String(code || '').trim().toUpperCase();
    const percent = Math.min(Math.max(parseInt(percent_off, 10) || 0, 1), 100);

    if (!normalized || !/^[A-Z0-9_-]+$/.test(normalized)) {
      return res.redirect('/promo-codes?error=Invalid code. Use letters, numbers, dash or underscore.');
    }

    const existing = await getOne('SELECT id FROM promo_codes WHERE code = ?', [normalized]);
    if (existing) {
      return res.redirect('/promo-codes?error=That code already exists.');
    }

    let couponId = null;
    const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
    if (STRIPE_KEY) {
      try {
        const stripe = require('stripe')(STRIPE_KEY);
        const coupon = await stripe.coupons.create({
          percent_off: percent,
          duration: 'once',
          name: normalized
        });
        await stripe.promotionCodes.create({
          coupon: coupon.id,
          code: normalized,
          max_redemptions: max_uses ? parseInt(max_uses, 10) : undefined,
          active: true
        });
        couponId = coupon.id;
      } catch (stripeErr) {
        console.error('Failed to create Stripe coupon:', stripeErr.message);
      }
    }

    await runQuery(
      'INSERT INTO promo_codes (code, percent_off, max_uses, stripe_coupon_id, created_by) VALUES (?, ?, ?, ?, ?)',
      [normalized, percent, max_uses ? parseInt(max_uses, 10) : null, couponId, req.user.id]
    );
    res.redirect('/promo-codes?success=Promo code created.');
  } catch (err) {
    console.error(err);
    res.redirect('/promo-codes?error=Failed to create promo code.');
  }
});

router.post('/promo-codes/:id/toggle', async (req, res) => {
  try {
    await runQuery('UPDATE promo_codes SET active = NOT active WHERE id = ?', [req.params.id]);
    res.redirect('/promo-codes');
  } catch (err) {
    res.redirect('/promo-codes');
  }
});

router.post('/promo-codes/:id/delete', async (req, res) => {
  try {
    await runQuery('DELETE FROM promo_codes WHERE id = ?', [req.params.id]);
    res.redirect('/promo-codes');
  } catch (err) {
    res.redirect('/promo-codes');
  }
});

router.get('/admins', async (req, res) => {
  try {
    const admins = await getAll('SELECT id, discord_id, username, global_name, avatar, created_at FROM users WHERE is_admin = 1');
    res.render('admins', { title: 'Admins', admins });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load admins.' });
  }
});

router.post('/admins/promote', async (req, res) => {
  try {
    const { discord_id } = req.body;
    if (!discord_id) return res.redirect('/admins?error=Missing Discord ID');
    const result = await runQuery('UPDATE users SET is_admin = 1 WHERE discord_id = ?', [String(discord_id).trim()]);
    if (result.changes === 0) {
      return res.redirect('/admins?error=No user found with that Discord ID.');
    }
    res.redirect('/admins?success=User promoted to admin.');
  } catch (err) {
    console.error(err);
    res.redirect('/admins?error=Failed to promote user.');
  }
});

router.post('/admins/:id/demote', async (req, res) => {
  try {
    if (parseInt(req.params.id, 10) === req.user.id) {
      return res.redirect('/admins?error=You cannot demote yourself.');
    }
    await runQuery('UPDATE users SET is_admin = 0 WHERE id = ?', [req.params.id]);
    res.redirect('/admins');
  } catch (err) {
    res.redirect('/admins');
  }
});

router.get('/support', async (req, res) => {
  try {
    const tickets = await getAll(
      `SELECT st.*, u.username, u.global_name, u.discord_id
       FROM support_tickets st LEFT JOIN users u ON u.id = st.user_id
       ORDER BY st.status = 'closed', st.updated_at DESC`
    );
    res.render('support', { title: 'Support Queue', tickets });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { title: 'Error', message: 'Failed to load support queue.' });
  }
});

module.exports = router;
