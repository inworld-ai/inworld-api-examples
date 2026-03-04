```
cd integrations/pipecat/benchmarks
```

# Setup venv
```
python3 -m venv .venv
source .venv/bin/activate
```

# Install dependencies
```
pip install -e '../pipecat/[inworld,elevenlabs,cartesia]'
pip install python-dotenv aiohttp
```

# Set your API keys
```
export INWORLD_API_KEY=your_key_here
export ELEVEN_API_KEY=your_key_here
export CARTESIA_API_KEY=your_key_here
```

# Run benchmark (just Inworld to compare)
```
python benchmark_streaming_ttfb.py --services inworld
python benchmark_websocket_ttfb.py --services inworld
```
