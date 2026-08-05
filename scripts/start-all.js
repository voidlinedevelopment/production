#!/usr/bin/env node
/**
 * Production - Start Everything
 *
 * Starts the website (:3000), the Discord bot (:4000), and the
 * Cloudflare tunnel in one command.
 *
 * Uses PM2 when available (auto-restart, save on reboot), otherwise
 * falls back to spawning the processes directly.
 *
 * Usage:
 *   npm start
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const ECOSYSTEM = path.join(ROOT, 'ecosystem.config.js');

function hasPm2() {
  try {
    execSync('pm2 --version', { stdio: 'pipe' });
    return true;
  } catch (e) {
    return false;
  }
}

function startWithPm2() {
  console.log('\n=== Production - starting all services via PM2 ===\n');

  const run = (args) => {
    console.log(`> pm2 ${args.join(' ')}`);
    try {
      execSync(`pm2 ${args.join(' ')}`, { stdio: 'inherit', cwd: ROOT });
    } catch (err) {
      process.exit(1);
    }
  };

  run(['start', ECOSYSTEM]);
  run(['save']);
  run(['logs']);
}

function startDirect() {
  console.log('\n=== Production - starting all services ===\n');

  const processes = [
    { name: 'website', script: 'website/server.js', color: '36m' },
    { name: 'bot', script: 'bot/index.js', color: '32m' },
    { name: 'support', script: 'support/server.js', color: '35m' },
    { name: 'tunnel', script: 'scripts/start-tunnel.js', color: '33m' }
  ];

  const children = processes.map(({ name, script, color }) => {
    const child = spawn('node', [script], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    const tag = `\x1b[${color}[${name}]\x1b[0m`;

    child.stdout.on('data', d => d.toString().split('\n').forEach(l => l && console.log(`${tag} ${l}`)));
    child.stderr.on('data', d => d.toString().split('\n').forEach(l => l && console.error(`${tag} ${l}`)));

    child.on('exit', code => {
      console.error(`${tag} exited with code ${code}`);
      if (code !== 0 && !child.killed) {
        process.exit(code);
      }
    });

    return child;
  });

  const shutdown = () => {
    console.log('\nStopping all services...');
    children.forEach(c => c.kill('SIGTERM'));
    setTimeout(() => process.exit(0), 1000);
  };

  ['SIGINT', 'SIGTERM'].forEach(sig => process.on(sig, shutdown));
}

const usePm2 = process.argv.includes('--pm2') || (hasPm2() && !process.argv.includes('--direct'));

if (usePm2) {
  startWithPm2();
} else {
  startDirect();
}
