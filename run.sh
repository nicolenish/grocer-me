#!/bin/bash
# Start both backend and frontend for grocer me

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Activate virtual env
source venv/bin/activate

# Load .env
set -a; source .env 2>/dev/null; set +a

# Kill any existing servers on our ports
lsof -ti:8000 | xargs kill -9 2>/dev/null
lsof -ti:5173 | xargs kill -9 2>/dev/null

echo "🥬 Starting grocer me..."
echo ""

# Start backend
echo "  Backend  → http://localhost:8000"
cd backend
python manage.py runserver 8000 2>&1 &
BACKEND_PID=$!
cd "$DIR"

# Start frontend
echo "  Frontend → http://localhost:5173"
cd frontend
npm run dev 2>&1 &
FRONTEND_PID=$!
cd "$DIR"

echo ""
echo "  Press Ctrl+C to stop both servers"
echo ""

cleanup() {
    echo ""
    echo "Shutting down..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    wait $BACKEND_PID $FRONTEND_PID 2>/dev/null
    echo "Done."
}

trap cleanup INT TERM
wait
