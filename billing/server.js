require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const path = require('path');
const { initializeDatabase, getAll, getOne, getSubscription, upsertSubscription } = require('../shared/database');
const { PLANS, PLAN_ORDER, getPlan, limit, exceedsLimit } = require('../shared/plans');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.BILLING_PORT || 3003;
const BILLING_URL = process.env.BILLING_URL || `http://localhost:${PORT}`;
const CHECKOUT_URL = process.env.CHECKOUT_URL || `http://localhost:${process.env.CHECKOUT_PORT || 3002}`;
const WEBSITE_URL = process.env.WEBSITE_URL || 'http://localhost:3000';
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

let stripe = null;
if (STRIPE_KEY) {
  try {
    stripe = require('stripe')(STRIPE_KEY);
    console.log('billing: Stripe configured');
  } catch (err) {
    console.error('billing: could not load stripe:', err.message);
  }
}

initializeDatabase()
  .then(() => console.log('billing: database ready'))
  .catch((err) => console.error('billing: db init failed:', err.message));

function priceToPlan(priceId) {
  for (const key of PLAN_ORDER) {
    if (PLANS[key].priceId() === priceId) return key;
  }
  return null;
}

async function usageFor(team) {
  const memberRow = await getOne('SELECT COUNT(*) AS c FROM team_members WHERE team_id = ?', [team.id]);
  const obsRow = await getOne('SELECT COUNT(*) AS c FROM obs_connections WHERE team_id = ?', [team.id]);
  const teamRow = await getOne('SELECT COUNT(*) AS c FROM teams WHERE owner_id = ?', [team.owner_id]);
  return {
    members: memberRow ? memberRow.c : 0,
    obsConnections: obsRow ? obsRow.c : 0,
    teams: teamRow ? teamRow.c : 0
  };
}

app.get('/', async (req, res) => {
  const teamId = parseInt(req.query.team, 10);
  const success = req.query.success === '1';

  if (!teamId) {
    const teams = await getAll('SELECT t.*, u.username AS owner_name FROM teams t JOIN users u ON u.id = t.owner_id ORDER BY t.created_at DESC');
    return res.render('chooser', {
      title: 'Plans & Billing',
      teams,
      plans: Object.values(PLANS),
      checkoutUrl: CHECKOUT_URL
    });
  }

  const team = await getOne('SELECT * FROM teams WHERE id = ?', [teamId]);
  if (!team) {
    return res.status(404).render('error', { title: 'Team not found', message: 'That team does not exist.' });
  }

  const sub = await getSubscription(teamId);
  const active = sub && ['active', 'trialing'].includes(sub.status);
  const planKey = active ? sub.plan : 'free';
  const plan = getPlan(planKey);
  const usage = await usageFor(team);

  res.render('index', {
    title: `Billing - ${team.name}`,
    team,
    sub,
    active,
    plan,
    planKey,
    usage,
    allPlans: Object.values(PLANS),
    checkoutUrl: CHECKOUT_URL,
    billingUrl: BILLING_URL,
    websiteUrl: WEBSITE_URL,
    success,
    hasPortal: !!stripe && !!sub && !!sub.stripe_customer_id
  });
});

app.get('/plans', (req, res) => {
  res.render('plans', {
    title: 'Pricing',
    plans: Object.values(PLANS),
    checkoutUrl: CHECKOUT_URL
  });
});

app.post('/api/portal', async (req, res) => {
  const teamId = parseInt(req.body.team || req.query.team, 10);
  if (!stripe) return res.status(503).json({ ok: false, error: 'Stripe not configured' });

  const sub = await getSubscription(teamId);
  if (!sub || !sub.stripe_customer_id) {
    return res.redirect(`${CHECKOUT_URL}/?team=${teamId}&plan=creator`);
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${BILLING_URL}/?team=${teamId}`
    });
    res.redirect(session.url);
  } catch (err) {
    console.error('billing: portal error:', err.message);
    res.status(500).redirect(`${BILLING_URL}/?team=${teamId}`);
  }
});

app.post('/stripe/webhook', async (req, res) => {
  if (!stripe) return res.status(503).json({ received: false, error: 'Stripe not configured' });

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], WEBHOOK_SECRET);
  } catch (err) {
    console.error('billing: webhook signature error:', err.message);
    return res.status(400).json({ received: false, error: err.message });
  }

  try {
    const type = event.type;

    if (type === 'checkout.session.completed') {
      const session = event.data.object;
      if (session.mode === 'subscription' && session.subscription) {
        const teamId = parseInt(session.client_reference_id || (session.metadata && session.metadata.teamId), 10);
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        const priceId = subscription.items && subscription.items.data && subscription.items.data[0]
          ? subscription.items.data[0].price.id
          : null;
        const planKey = priceToPlan(priceId) || 'free';
        await upsertSubscription({
          teamId,
          stripeCustomerId: session.customer,
          stripeSubscriptionId: session.subscription,
          plan: planKey,
          status: subscription.status,
          currentPeriodEnd: subscription.current_period_end
        });
        console.log(`billing: subscription active for team ${teamId} -> ${planKey}`);
      }
    }

    if (type === 'customer.subscription.updated') {
      const sub = event.data.object;
      const priceId = sub.items && sub.items.data && sub.items.data[0] ? sub.items.data[0].price.id : null;
      const planKey = priceToPlan(priceId);
      if (planKey) {
        const existing = await getOne('SELECT * FROM subscriptions WHERE stripe_subscription_id = ?', [sub.id]);
        if (existing) {
          await upsertSubscription({
            teamId: existing.team_id,
            stripeCustomerId: sub.customer,
            stripeSubscriptionId: sub.id,
            plan: planKey,
            status: sub.status,
            currentPeriodEnd: sub.current_period_end
          });
          console.log(`billing: team ${existing.team_id} subscription updated -> ${planKey} (${sub.status})`);
        }
      }
    }

    if (type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const existing = await getOne('SELECT * FROM subscriptions WHERE stripe_subscription_id = ?', [sub.id]);
      if (existing) {
        await upsertSubscription({
          teamId: existing.team_id,
          stripeCustomerId: sub.customer,
          stripeSubscriptionId: sub.id,
          plan: 'free',
          status: 'canceled',
          currentPeriodEnd: sub.current_period_end
        });
        console.log(`billing: team ${existing.team_id} subscription canceled`);
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('billing: webhook handler error:', err.message);
    res.status(500).json({ received: true, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`billing app listening on port ${PORT}`);
});
