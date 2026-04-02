#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "[1/4] Installing backend dependencies..."
cd "$ROOT_DIR/backend"
npm install

echo "[2/4] Installing frontend dependencies..."
cd "$ROOT_DIR/frontend"
npm install

echo "[3/4] Building frontend..."
npm run build

echo "[4/4] Starting production server on ${HOST:-0.0.0.0}:${PORT:-3001}..."
cd "$ROOT_DIR/backend"
npm start
