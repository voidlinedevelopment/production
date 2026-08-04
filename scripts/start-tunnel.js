#!/usr/bin/env node
/**
 * Production - Cloudflare Tunnel Starter
 *
 * Starts the Cloudflare tunnel for the Production website.
 *
 * Modes:
 *   - Token mode (recommended): uses CLOUDFLARE_TUNNEL_TOKEN from .env
 *     or .cloudflared/token, runs: cloudflared tunnel run --token <TOKEN>
 *   - Named tunnel mode: uses .cloudflared/config.yml with TUNNEL_NAME
 *
 * Usage:
 *   node scripts/start-tunnel.js
 *   pm2 start scripts/start-tunnel.js --name production-tunnel
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TUNNEL_NAME = process.env.TUNNEL_NAME || 'production';
const TUNNEL_DIR = path.join(__dirname, '..', '.cloudflared');
const BIN_DIR = path.join(TUNNEL_DIR, 'bin');
const binPath = path.join(BIN_DIR, os.platform() === 'win32' ? 'cloudflared.exe' : 'cloudflared');

function getToken() {
  const envToken = process.env.CLOUDFLARE_TUNNEL_TOKEN;
  const tokenFile = path.join(TUNNEL_DIR, 'token');
  if (envToken && envToken.length > 20) return envToken.trim();
  if (fs.existsSync(tokenFile)) {
    const tok = fs.readFileSync(tokenFile, 'utf8').trim();
    if (tok.length > 20) return tok;
  }
  return null;
}

function startTokenMode(token) {
  console.log('Starting Cloudflare tunnel (token mode)...');
  const child = spawn(binPath, ['tunnel', 'run', '--token', token], {
    stdio: 'inherit'
  });
  return child;
}

function startNamedMode() {
  const configPath = path.join(TUNNEL_DIR, 'config.yml');

  if (!fs.existsSync(configPath)) {
    console.error('No config found. Run first:  node scripts/setup-cloudflare.js');
    process.exit(1);
  }

  console.log(`Starting Cloudflare tunnel "${TUNNEL_NAME}"...`);
  console.log(`Config: ${configPath}`);

  const child = spawn(binPath, ['tunnel', 'run', '--config', configPath, TUNNEL_NAME], {
    stdio: 'inherit'
  });
  return child;
}

function main() {
  if (!fs.existsSync(binPath)) {
    console.error('cloudflared not installed. Run first:  node scripts/setup-cloudflare.js');
    process.exit(1);
  }

  const token = getToken();
  const child = token ? startTokenMode(token) : startNamedMode();

  child.on('exit', (code, signal) => {
    if (signal) {
      console.log(`\nCloudflare tunnel stopped (${signal}).`);
    } else {
      console.log(`\nCloudflare tunnel exited with code ${code}.`);
    }
    process.exit(0);
  });

  ['SIGINT', 'SIGTERM'].forEach(sig => {
    process.on(sig, () => {
      console.log(`\nReceived ${sig}, stopping tunnel...`);
      child.kill(sig);
    });
  });
}

main();
