#!/usr/bin/env bash
# Quick sanity check for all benchmarks and quickstarts.
# Usage: cd integrations && ./sanity_check.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Ensure mise activates .tool-versions so uv/node use the pinned versions
if command -v mise &>/dev/null; then
  eval "$(mise activate bash 2>/dev/null)" || true
  mise install --yes 2>/dev/null || true
fi

cd "$SCRIPT_DIR"

pass=0; fail=0; skip=0

echo "=== Runtime versions ==="
printf "  %-45s %s\n" "Python" "$(python3 --version 2>&1)"
printf "  %-45s %s\n" "Node.js" "$(node --version 2>&1)"
printf "  %-45s %s\n" "uv" "$(uv --version 2>&1)"
printf "  %-45s %s\n" "pnpm" "$(pnpm --version 2>&1)"
echo ""

run() {
  local label="$1"; shift
  printf "  %-45s " "$label"
  if output=$("$@" 2>&1); then
    echo "✅"
    pass=$((pass + 1))
  else
    echo "❌"
    echo "$output" | tail -3 | sed 's/^/    /'
    fail=$((fail + 1))
  fi
}

check_env() {
  local dir="$1"
  if [[ -f "$dir/.env" ]] && grep -q 'INWORLD_API_KEY=.\+' "$dir/.env"; then
    return 0
  else
    printf "  %-45s ⏭️  (no .env or empty INWORLD_API_KEY)\n" "$dir"
    skip=$((skip + 1))
    return 1
  fi
}

echo "=== Checking .env files ==="
for dir in pipecat/benchmarks livekit/python/benchmarks livekit/js/benchmarks; do
  if check_env "$dir"; then
    printf "  %-45s ✅\n" "$dir/.env"
  fi
done

echo ""
echo "=== Pipecat Python ==="
cd "$SCRIPT_DIR/pipecat/benchmarks"
run "uv sync" uv sync --quiet
if check_env .; then
  run "HTTP benchmark" uv run python benchmark_http_ttfb.py --services inworld -n 1 --warmup 0 --no-save-audio
  run "WS benchmark" uv run python benchmark_websocket_ttfb.py --services inworld -n 1 --warmup 0 --no-save-audio
fi
cd "$SCRIPT_DIR/pipecat/pipecat-quickstart"
run "uv sync" uv sync --quiet
run "quickstart import" uv run python -c "import bot; print('ok')"

echo ""
echo "=== LiveKit Python ==="
cd "$SCRIPT_DIR/livekit/python/benchmarks"
run "uv sync" uv sync --quiet
if check_env .; then
  run "HTTP benchmark" uv run python benchmark_http_ttfb.py --services inworld -n 1 --warmup 0 --no-save-audio
  run "WS benchmark" uv run python benchmark_websocket_ttfb.py --services inworld -n 1 --warmup 0 --no-save-audio
fi
cd "$SCRIPT_DIR/livekit/python/quickstart"
run "uv sync" uv sync --quiet
run "quickstart import" uv run python -c "import test_inworld_voice_agent; print('ok')"

echo ""
echo "=== LiveKit JS ==="
cd "$SCRIPT_DIR/livekit/js/benchmarks"
run "pnpm install" pnpm install --silent
if check_env .; then
  run "HTTP benchmark" npx tsx benchmark_http_ttfb.ts --services inworld -n 1 --warmup 0 --no-save-audio
  run "WS benchmark" npx tsx benchmark_websocket_ttfb.ts --services inworld -n 1 --warmup 0 --no-save-audio
fi
cd "$SCRIPT_DIR/livekit/js/quickstart"
run "pnpm install" pnpm install --silent

echo ""
echo "=== Results ==="
echo "  ✅ $pass passed, ❌ $fail failed, ⏭️  $skip skipped"
[[ $fail -eq 0 ]] && exit 0 || exit 1
