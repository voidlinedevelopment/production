require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const path = require('path');
const { initializeDatabase, getOne } = require('../shared/database');
const { PLANS, getPlan } = require('../shared/plans');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.CHECKOUT_PORT || 3002;
const BILLING_URL = process.env.BILLING_URL || `http://localhost:${process.env.BILLING_PORT || 3003}`;
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || '';

let stripe = null;
if (STRIPE_KEY) {
  try {
    stripe = require('stripe')(STRIPE_KEY, { apiVersion: '2025-03-31.basil' });
    console.log('checkout: Stripe configured');
  } catch (err) {
    console.error('checkout: could not load stripe:', err.message);
  }
}

initializeDatabase()
  .then(() => console.log('checkout: database ready'))
  .catch((err) => console.error('checkout: db init failed:', err.message));

app.get('/', async (req, res) => {
  const teamId = parseInt(req.query.team, 10);
  const plan = getPlan(req.query.plan);

  if (!teamId) {
    return res.status(400).render('error', {
      title: 'No team selected',
      message: 'Please pick a team first, then head back to billing to upgrade.',
      backUrl: BILLING_URL
    });
  }

  const team = await getOne('SELECT id, name FROM teams WHERE id = ?', [teamId]);
  if (!team) {
    return res.status(404).render('error', {
      title: 'Team not found',
      message: "We couldn't find that team. Please pick a team first, then head back to billing.",
      backUrl: BILLING_URL
    });
  }

  if (!stripe || !PUBLISHABLE_KEY) {
    return res.render('not-configured', { title: 'Checkout', team, plan, reason: 'Stripe is not configured on the server yet.' });
  }

  try {
    const priceId = plan.priceId();
    if (!priceId) {
      return res.render('not-configured', { title: 'Checkout', team, plan, reason: `No Stripe Price ID is configured for the ${plan.name} plan.` });
    }

    const owner = await getOne(
      'SELECT u.email FROM teams t JOIN users u ON u.id = t.owner_id WHERE t.id = ?',
      [teamId]
    );

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      ui_mode: 'custom',
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: String(teamId),
      metadata: { teamId: String(teamId), plan: plan.key },
      subscription_data: { metadata: { teamId: String(teamId), plan: plan.key } },
      allow_promotion_codes: true,
      return_url: `${BILLING_URL}/?team=${teamId}&success=1`
    });

    res.render('index', {
      title: `Checkout - ${plan.name}`,
      team,
      plan,
      allPlans: Object.values(PLANS),
      ownerEmail: (owner && owner.email) || '',
      clientSecret: session.client_secret,
      publishableKey: PUBLISHABLE_KEY,
      billingUrl: BILLING_URL
    });
  } catch (err) {
    console.error('checkout: session error:', err.message);
    res.render('not-configured', { title: 'Checkout', team, plan, reason: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`checkout app listening on port ${PORT}`);
});
