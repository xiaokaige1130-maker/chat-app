#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

cleanup() {
  if [ -n "$BACKEND_PID" ]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT

# Start backend
(
  cd "$ROOT_DIR/backend"
  npm install
  npm start
) &
BACKEND_PID=$!

# Start frontend dev server
cd "$ROOT_DIR/frontend"
npm install
npm run dev
