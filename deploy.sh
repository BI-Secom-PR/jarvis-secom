#!/usr/bin/env bash
set -euo pipefail

export PATH="/home/linuxbrew/.linuxbrew/bin:$PATH"

APP_DIR="/opt/jarvis_ui"
cd "$APP_DIR"

git pull origin master
npm ci
.venv/bin/pip install -r requirements.txt --quiet
npm run build
sudo systemctl restart jarvis

echo "Deploy complete — $(date)"
