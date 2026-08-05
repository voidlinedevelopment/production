require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const path = require('path');
const { initializeDatabase, getOne } = require('../shared/database');

const app = express();
const PORT = process.env.STATUS_PORT || 3006;
const WEBSITE_URL = process.env.WEBSITE_URL || 'http://localhost:3000';

initializeDatabase()
  .then(() => console.log('status: database ready'))
  .catch((err) => console.error('status: db init failed:', err.message));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const PROBE_TIMEOUT = 4000;
const CACHE_TTL = 15000;

let cache = { at: 0, results: null };

function probe(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT);
  const start = Date.now();
  return fetch(url, { method: opts.method || 'GET', signal: controller.signal, redirect: 'follow' })
    .then((res) => ({ up: res.status < 500, status: res.status, ms: Date.now() - start }))
    .catch((err) => ({ up: false, status: 0, ms: Date.now() - start, error: err.message }))
    .finally(() => clearTimeout(timer));
}

const SERVICES = [
  { key: 'website', name: 'Website', desc: 'Main app & dashboard', url: 'http://localhost:3000' },
  { key: 'tunnel', name: 'Cloudflare Tunnel', desc: 'Public HTTPS access', url: WEBSITE_URL },
  { key: 'bot', name: 'Discord Bot', desc: 'Discord integration', url: 'http://localhost:4000/api/status', json: true },
  { key: 'support', name: 'Support Portal', desc: 'Support tickets', url: 'http://localhost:3005' },
  { key: 'billing', name: 'Billing', desc: 'Billing & plans', url: 'http://localhost:3003' },
  { key: 'checkout', name: 'Checkout', desc: 'Stripe checkout', url: 'http://localhost:3002' },
  { key: 'admin', name: 'Admin Panel', desc: 'Admin dashboard', url: 'http://localhost:3007/login' }
];

async function checkDatabase() {
  try {
    const start = Date.now();
    await getOne('SELECT 1 AS ok');
    return { up: true, ms: Date.now() - start };
  } catch (err) {
    return { up: false, ms: 0, error: err.message };
  }
}

async function checkService(service) {
  const result = await probe(service.url);
  if (service.json && result.up && result.status === 200) {
    try {
      const res = await fetch(service.url, { signal: AbortSignal.timeout(PROBE_TIMEOUT) });
      const data = await res.json();
      result.detail = `Guilds: ${data.guilds} · Uptime: ${Math.floor((data.uptime || 0) / 60000)}m`;
      if (!data.online) result.up = false;
    } catch (err) {
      result.detail = 'Bot not responding';
    }
  } else if (!result.up) {
    result.detail = result.status === 0 ? 'Unreachable' : `HTTP ${result.status}`;
  } else if (result.status === 200) {
    result.detail = `HTTP ${result.status}`;
  }
  return { ...service, ...result };
}

async function runChecks() {
  const [services, db] = await Promise.all([
    Promise.all(SERVICES.map(checkService)),
    checkDatabase()
  ]);
  return {
    generatedAt: new Date().toISOString(),
    overall: services.every((s) => s.up) && db.up ? 'operational' : 'degraded',
    database: db,
    services
  };
}

async function getResults() {
  if (cache.results && Date.now() - cache.at < CACHE_TTL) return cache.results;
  const results = await runChecks();
  cache = { at: Date.now(), results };
  return results;
}

app.get('/api/status', async (req, res) => {
  try {
    res.json(await getResults());
  } catch (err) {
    console.error('status: check failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', async (req, res) => {
  try {
    const data = await getResults();
    res.render('index', { title: 'Status', data });
  } catch (err) {
    console.error('status: render failed:', err.message);
    res.status(500).send('Status check failed: ' + err.message);
  }
});

app.listen(PORT, () => {
  console.log(`status app listening on port ${PORT}`);
  console.log(`Status page: ${process.env.STATUS_URL || `http://localhost:${PORT}`}`);
});
