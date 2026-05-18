# Integrations — Agent Guide

## First-Time Setup (required for fresh clone)

```bash
# 1. Initialize git submodules (pipecat, livekit agents)
git submodule update --init --recursive

# 2. Build LiveKit JS agents monorepo (needed by JS benchmarks and quickstart)
cd integrations/livekit/js/agents-js
pnpm install && pnpm build
cd -
```

## Directory Structure

```
integrations/
├── pipecat/
│   ├── pipecat/                        # Submodule: pipecat-ai framework
│   ├── pipecat-quickstart/             # Voice bot (uv sync && uv run bot.py)
│   └── benchmarks/                     # TTFB benchmarks (uv sync && uv run python ...)
├── livekit/
│   ├── python/
│   │   ├── agents/                     # Submodule: livekit agents + Inworld plugin
│   │   ├── quickstart/                 # Voice agent (uv sync && uv run python ...)
│   │   └── benchmarks/                 # TTFB benchmarks (uv sync && uv run python ...)
│   └── js/
│       ├── agents-js/                  # Submodule: livekit agents-js + Inworld plugin
│       ├── quickstart/                 # Voice agent (pnpm install && pnpm start)
│       └── benchmarks/                 # TTFB benchmarks (pnpm install && npx tsx ...)
```

Each script directory has:
- `pyproject.toml` or `package.json` with editable/local deps on the plugin submodule
- `.env.example` listing required API keys
- `README.md` with setup and usage

## Prerequisites for Running Anything

1. Git submodules initialized (see above)
2. `.env` file in the target directory with valid API keys (copy from `.env.example`)
3. `uv` installed (Python dirs) or `pnpm` installed (JS dirs)

## Sanity Check — All Benchmarks

Verify `.env` files exist:
```bash
for dir in pipecat/benchmarks livekit/python/benchmarks livekit/js/benchmarks; do
  test -f "integrations/$dir/.env" && grep -q 'INWORLD_API_KEY=.\+' "integrations/$dir/.env" \
    && echo "✅ $dir" || echo "❌ $dir — missing .env or empty INWORLD_API_KEY"
done
```

Run each benchmark with minimal iterations:
```bash
# Pipecat (Python)
cd integrations/pipecat/benchmarks
uv sync
uv run python benchmark_http_ttfb.py --services inworld -n 1 --warmup 0 --no-save-audio
uv run python benchmark_websocket_ttfb.py --services inworld -n 1 --warmup 0 --no-save-audio

# LiveKit (Python)
cd integrations/livekit/python/benchmarks
uv sync
uv run python benchmark_http_ttfb.py --services inworld -n 1 --warmup 0 --no-save-audio
uv run python benchmark_websocket_ttfb.py --services inworld -n 1 --warmup 0 --no-save-audio

# LiveKit (JS) — requires agents-js built (see First-Time Setup)
cd integrations/livekit/js/benchmarks
pnpm install
npx tsx benchmark_http_ttfb.ts --services inworld -n 1 --warmup 0 --no-save-audio
npx tsx benchmark_websocket_ttfb.ts --services inworld -n 1 --warmup 0 --no-save-audio
```

## Sanity Check — Quickstarts (import only, full run needs LiveKit Cloud)

```bash
cd integrations/pipecat/pipecat-quickstart && uv sync && uv run python -c "import bot; print('ok')"
cd integrations/livekit/python/quickstart && uv sync && uv run python -c "import test_inworld_voice_agent; print('ok')"
cd integrations/livekit/js/quickstart && pnpm install  # import check: JS loads on pnpm start
```

## Expected Results

- Benchmark output shows a TTFB table with N matching the `-n` flag
- Inworld HTTP TTFB: ~0.2–0.4s, WS TTFB: ~0.2–0.5s
- If TTFB is N/A or audio_bytes=0: API key is invalid or expired
- LiveKit JS WS TTFB appears ~200ms higher than Python (framework measurement difference, not real latency — documented in JS benchmarks README)

## Key Conventions

- Python: always `uv sync && uv run` (never activate venvs manually)
- JS: always `pnpm` (not npm)
- Inworld base URLs are hardcoded in TTS factory functions — edit directly to point at a dev environment
- Pipecat `InworldHttpTTSService` does not accept a custom `base_url` parameter
- `-n` = number of TTFB samples, `--warmup` = throwaway iterations for connection warmup
