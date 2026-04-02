#!/bin/bash

# Start backend
cd backend && npm install && npm start &
BACKEND_PID=$!

# Start frontend dev server
cd frontend && npm install && npm run dev

# Cleanup on exit
trap "kill $BACKEND_PID" EXIT
