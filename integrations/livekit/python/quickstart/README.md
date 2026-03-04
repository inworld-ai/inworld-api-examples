# Testing Inworld TTS Plugin

## Dev Mode with Frontend UI

This connects to LiveKit Cloud and lets you test with a web UI.

### Step 1: Set up LiveKit Cloud (free tier available)

1. Go to https://cloud.livekit.io and create a free account
2. Create a new project
3. Go to Settings -> API keys
4. Create new API key
5. click reveal secret, you should see `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`

### Step 2: Create your `.env` file from `.env-example`

Add the following to your `.env`
```bash
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret
OPENAI_API_KEY=your-openai-key
ASSEMBLYAI_API_KEY=your-assemblyai-key
INWORLD_API_KEY=your-inworld-key
```

### Step 3: Download required models (first time only)

```bash
cd integrations/livekit/python/agents
uv run python ../quickstart/test_inworld_voice_agent.py download-files
```

### Step 4: Start the agent in dev mode

```bash
cd integrations/livekit/python/agents
uv sync
uv run python ../quickstart/test_inworld_voice_agent.py dev
```

### Step 5: Use a Frontend

**Easiest option - LiveKit's hosted playground:**

1. Go to https://agents-playground.livekit.io
2. Select your project
3. Click "Connect"
