#!/usr/bin/env bash
#
# Production - VPS Deployment Script
#
# Installs dependencies, registers Discord bot commands,
# sets up the Cloudflare tunnel, and starts everything with PM2.
#
# Usage:
#   bash scripts/setup-vps.sh
#
set -e

echo ""
echo "=== Production VPS Setup ==="
echo ""

# 1. Install dependencies
echo "[1/6] Installing npm dependencies..."
npm install --omit=dev || npm install

# 2. Create .env if missing
if [ ! -f .env ]; then
  echo "[2/6] Creating .env from template..."
  cp .env.example .env 2>/dev/null || true
  echo "  Edit .env with your Discord credentials before continuing."
  exit 1
fi

# 3. Install PM2
echo "[3/6] Checking PM2..."
if ! command -v pm2 &> /dev/null; then
  echo "  Installing PM2 globally..."
  npm install -g pm2
fi

# 4. Register Discord bot commands
echo "[4/6] Registering Discord bot slash commands..."
node bot/register-commands.js

# 5. Setup Cloudflare tunnel (token-based service install)
echo "[5/6] Setting up Cloudflare tunnel..."
node scripts/setup-cloudflare.js

# 6. Start web + bot with PM2
echo "[6/6] Starting services with PM2..."
pm2 delete production-web production-bot 2>/dev/null || true
pm2 start ecosystem.config.js --only production-web,production-bot
pm2 save
pm2 status

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Website:    $(node -e "console.log(process.env.WEBSITE_URL || 'http://localhost:3000')")"
echo "OAuth callback must match:"
echo "  DISCORD_CALLBACK_URL = $(node -e "console.log(process.env.DISCORD_CALLBACK_URL || '(set in .env)')")"
echo ""
echo "Commands:"
echo "  pm2 logs production-web      # Website logs"
echo "  pm2 logs production-bot      # Bot logs"
echo "  pm2 logs production-tunnel   # Tunnel logs"
echo "  pm2 restart production-web   # Restart website"
echo ""
