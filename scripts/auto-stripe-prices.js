#!/usr/bin/env node
/**
 * Production - Auto Stripe Prices
 *
 * Creates (or reuses) the Stripe products and monthly prices for the four
 * plans and writes the resulting STRIPE_PRICE_* values into .env.
 *
 * Safe to re-run: products are tagged with metadata production_app=production
 * so existing prices are reused instead of duplicated.
 *
 * Usage:
 *   node scripts/auto-stripe-prices.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');
const KEY = process.env.STRIPE_SECRET_KEY;

const PLANS = [
  { env: 'STRIPE_PRICE_FREE', name: 'Production Free', amount: 0 },
  { env: 'STRIPE_PRICE_CREATOR', name: 'Production Creator', amount: 999 },
  { env: 'STRIPE_PRICE_STUDIO', name: 'Production Studio', amount: 2499 },
  { env: 'STRIPE_PRICE_ENTERPRISE', name: 'Production Enterprise', amount: 7999 }
];

function writeEnv(values) {
  if (!fs.existsSync(ENV_PATH)) {
    fs.writeFileSync(ENV_PATH, Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
    return;
  }
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
  let written = {};
  const out = lines.map((line) => {
    const m = line.match(/^(STRIPE_PRICE_(?:FREE|CREATOR|STUDIO|ENTERPRISE))=(.*)$/);
    if (m && values[m[1]]) {
      written[m[1]] = true;
      return `${m[1]}=${values[m[1]]}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(values)) {
    if (!written[k] && v) out.push(`${k}=${v}`);
  }
  fs.writeFileSync(ENV_PATH, out.join('\n') + '\n');
}

async function main() {
  if (!KEY) {
    console.error('STRIPE_SECRET_KEY is not set in .env.');
    console.error('Add STRIPE_SECRET_KEY=sk_... to .env, then re-run this script.');
    process.exit(1);
  }

  const stripe = require('stripe')(KEY);
  const results = {};
  const prefix = '[auto-stripe]';

  for (const plan of PLANS) {
    let product;
    const existing = await stripe.products.list({ active: true, limit: 100 });
    const found = existing.data.find((p) => p.metadata && p.metadata.production_app === plan.name);
    if (found) {
      product = found;
      console.log(`${prefix} reusing product ${plan.name} (${product.id})`);
    } else {
      product = await stripe.products.create({
        name: plan.name,
        metadata: { production_app: plan.name, plan: plan.env.replace('STRIPE_PRICE_', '').toLowerCase() }
      });
      console.log(`${prefix} created product ${plan.name} (${product.id})`);
    }

    const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
    const price = prices.data.find((p) => p.recurring && p.recurring.interval === 'month' && p.unit_amount === plan.amount);
    if (price) {
      results[plan.env] = price.id;
      console.log(`${prefix} reusing price ${plan.env}=${price.id}`);
    } else {
      const created = await stripe.prices.create({
        product: product.id,
        unit_amount: plan.amount,
        currency: 'usd',
        recurring: { interval: 'month' },
        metadata: { production_app: plan.name }
      });
      results[plan.env] = created.id;
      console.log(`${prefix} created price ${plan.env}=${created.id}`);
    }
  }

  writeEnv(results);
  console.log('\nDone! STRIPE_PRICE_* values written to .env:');
  for (const [k, v] of Object.entries(results)) console.log(`  ${k}=${v}`);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
