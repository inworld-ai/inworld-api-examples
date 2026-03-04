```
cd integrations/livekit/python/agents
```

# Setup (uses uv workspace — no separate venv needed)
```
uv sync
```

# Set your API keys
```
export INWORLD_API_KEY=your_key_here
export ELEVEN_API_KEY=your_key_here
export CARTESIA_API_KEY=your_key_here
```

# Run HTTP benchmark (just Inworld to compare)
```
uv run python ../benchmarks/benchmark_http_ttfb.py --services inworld
uv run python ../benchmarks/benchmark_http_ttfb.py --services inworld -n 5
```

# Run WebSocket benchmark (just Inworld to compare)
```
uv run python ../benchmarks/benchmark_websocket_ttfb.py --services inworld
uv run python ../benchmarks/benchmark_websocket_ttfb.py --services inworld -n 5
```
