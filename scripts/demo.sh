#!/bin/sh
# Start the dev server and open the game with a seeded demo state.
# Usage: scripts/demo.sh [farm,mill,bakery,lounge]   (Ctrl-C to stop)
cd "$(dirname "$0")/.." || exit 1
(sleep 2 && open "http://localhost:5173/?demo=${1:-farm,mill,bakery,lounge}") &
exec npm run dev -- --port 5173
