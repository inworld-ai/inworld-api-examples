# Testing Inworld TTS Plugin

## Dev Mode with Frontend UI

This connects to LiveKit Cloud and lets you test with a web UI.

### Step 1: Set up LiveKit Cloud (free tier available)

1. Go to https://cloud.livekit.io and create a free account
2. Create a new project
3. Go to Settings -> API keys
4. Create new API key
5. click reveal secret, you should see `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`

### Step 2: Create your `.env` file

```bash
cp .env.example .env
# edit .env with your keys
```

### Step 3: Setup

```bash
cd integrations/livekit/python/quickstart
uv sync
```

### Step 4: Download required models (first time only)

```bash
uv run python test_inworld_voice_agent.py download-files
```

### Step 5: Start the agent in dev mode

```bash
uv run python test_inworld_voice_agent.py dev
```

### Step 6: Use a Frontend

**Easiest option - LiveKit's hosted playground:**

1. Go to https://agents-playground.livekit.io
2. Select your project
3. Click "Connect"
