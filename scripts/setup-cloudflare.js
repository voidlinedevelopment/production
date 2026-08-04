#!/usr/bin/env node
/**
 * Production - Cloudflare Tunnel Setup
 *
 * Downloads cloudflared for your platform and installs the tunnel
 * as a system service using a Cloudflare Zero Trust tunnel token.
 *
 * Usage:
 *   node scripts/setup-cloudflare.js
 *   node scripts/setup-cloudflare.js <TOKEN>
 *   CLOUDFLARE_TUNNEL_TOKEN=<TOKEN> node scripts/setup-cloudflare.js
 *
 * The token is created in the Cloudflare Zero Trust dashboard:
 *   Zero Trust → Networks → Tunnels → Create a tunnel → Token
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const TUNNEL_DIR = path.join(__dirname, '..', '.cloudflared');
const BIN_DIR = path.join(TUNNEL_DIR, 'bin');

function platform() {
  const plat = os.platform();
  const arch = os.arch();
  let p = '';
  let a = '';
  switch (plat) {
    case 'linux': p = 'linux'; break;
    case 'darwin': p = 'darwin'; break;
    case 'win32': p = 'windows'; break;
    default: throw new Error(`Unsupported platform: ${plat}`);
  }
  switch (arch) {
    case 'x64': a = 'amd64'; break;
    case 'arm64': a = 'arm64'; break;
    default: a = 'amd64';
  }
  return { p, a };
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close();
        fs.unlinkSync(dest);
        return resolve(download(res.headers.location, dest));
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`Download failed with status ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      file.close();
      fs.unlinkSync(dest, () => {});
      reject(err);
    });
  });
}

async function ensureCloudflared() {
  if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });

  const { p, a } = platform();
  const isWindows = p === 'windows';
  const binName = isWindows ? 'cloudflared.exe' : 'cloudflared';
  const binPath = path.join(BIN_DIR, binName);

  if (fs.existsSync(binPath)) {
    console.log(`cloudflared already installed at ${binPath}`);
    return binPath;
  }

  const release = await fetchLatestVersion();
  const version = release.tag_name.replace('v', '');
  console.log(`Downloading cloudflared v${version} for ${p}/${a}...`);

  const url = `https://github.com/cloudflare/cloudflared/releases/download/${release.tag_name}/cloudflared-${p}-${a}`;
  await download(url, binPath);

  if (!isWindows) {
    fs.chmodSync(binPath, 0o755);
  }

  console.log(`Installed cloudflared at ${binPath}`);
  return binPath;
}

function fetchLatestVersion() {
  return new Promise((resolve, reject) => {
    https.get('https://api.github.com/repos/cloudflare/cloudflared/releases/latest', {
      headers: { 'User-Agent': 'production-platform' }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const tag = json.tag_name.includes('-') ? '2024.10.0' : json.tag_name;
          resolve({ tag_name: tag });
        } catch (e) {
          resolve({ tag_name: '2024.10.0' });
        }
      });
    }).on('error', (err) => reject(err));
  });
}

function getToken() {
  const cliArg = process.argv[2];
  const envToken = process.env.CLOUDFLARE_TUNNEL_TOKEN;

  if (cliArg && cliArg.length > 20) return cliArg.trim();
  if (envToken && envToken.length > 20) return envToken.trim();

  console.error('\nNo tunnel token found.');
  console.error('\nCreate a tunnel in Cloudflare Zero Trust:');
  console.error('  Zero Trust → Networks → Tunnels → Create a tunnel');
  console.error('  Copy the token (starts with "eyJ...").\n');
  console.error('Then run one of:');
  console.error('  node scripts/setup-cloudflare.js <TOKEN>');
  console.error('  CLOUDFLARE_TUNNEL_TOKEN=<TOKEN> node scripts/setup-cloudflare.js');
  process.exit(1);
}

function run(binPath, args, opts = {}) {
  const cmd = `"${binPath}" ${args.join(' ')}`;
  console.log(`> ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit', ...opts });
    return true;
  } catch (err) {
    console.error(`Command failed: ${cmd}`);
    console.error(err.stderr ? err.stderr.toString() : err.message);
    return false;
  }
}

async function main() {
  console.log('\n=== Production Cloudflare Tunnel Setup ===\n');

  const binPath = await ensureCloudflared();
  const token = getToken();
  const isWindows = os.platform() === 'win32';

  // Save token for start-tunnel.js
  fs.writeFileSync(path.join(TUNNEL_DIR, 'token'), token);
  console.log('Token saved to .cloudflared/token\n');

  console.log('Step 1: Installing cloudflared as a system service...');
  if (isWindows) {
    console.log('Running (as Administrator): cloudflared service install <TOKEN>');
  } else {
    console.log('Running: cloudflared service install <TOKEN>');
  }

  const ok = run(binPath, ['service', 'install', token]);
  if (!ok) {
    console.error('\nService install failed.');
    if (isWindows) {
      console.error('  - Run this terminal as Administrator');
      console.error('  - Or install the Windows version manually:');
      console.error('    .cloudflared\\bin\\cloudflared.exe service install <TOKEN>');
    } else {
      console.error('  - Run with sudo: sudo node scripts/setup-cloudflare.js <TOKEN>');
    }
    process.exit(1);
  }

  console.log('\n=== Setup Complete ===');
  console.log('cloudflared is installed as a service and will:');
  console.log('  - Start automatically on boot');
  console.log('  - Keep the tunnel running in the background');
  console.log('  - Auto-restart if it crashes\n');
  console.log('To manage the service:');
  if (isWindows) {
    console.log('  - Status:  sc query cloudflared');
    console.log('  - Stop:    sc stop cloudflared');
    console.log('  - Start:   sc start cloudflared');
    console.log('  - Remove:  .cloudflared\\bin\\cloudflared.exe service uninstall');
  } else {
    console.log('  - Status:  systemctl status cloudflared');
    console.log('  - Stop:    systemctl stop cloudflared');
    console.log('  - Start:   systemctl start cloudflared');
    console.log('  - Remove:  sudo cloudflared service uninstall');
  }
  console.log('');
}

main().catch(err => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
