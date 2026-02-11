```
cd integrations/livekit/js/agents-js
```

# Prerequisites: build agents-js monorepo (needed once)
```
pnpm install
pnpm build

cd ../benchmarks
```

# Install benchmark dependencies
```
pnpm install
```

# Set your API keys (or add them to a .env file)
```
export INWORLD_API_KEY=your_key_here
# export ELEVEN_API_KEY=your_key_here
# export CARTESIA_API_KEY=your_key_here
```

# Run HTTP benchmark (just Inworld to compare)
```
npx tsx benchmark_http_ttfb.ts --services inworld
npx tsx benchmark_http_ttfb.ts --services inworld -n 5
```

# Run WebSocket benchmark (just Inworld to compare)
```
npx tsx benchmark_websocket_ttfb.ts --services inworld
npx tsx benchmark_websocket_ttfb.ts --services inworld -n 5
```
