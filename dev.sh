#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

cleanup() {
  if [ -n "${BACKEND_PID:-}" ]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT

echo "[1/4] Installing backend dependencies..."
cd "$ROOT_DIR/backend"
npm install

echo "[2/4] Installing frontend dependencies..."
cd "$ROOT_DIR/frontend"
npm install

echo "[3/4] Starting backend dev server..."
cd "$ROOT_DIR/backend"
npm run dev &
BACKEND_PID=$!

echo "[4/4] Starting frontend dev server on 5173..."
cd "$ROOT_DIR/frontend"
npm run dev
