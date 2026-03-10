# Pipecat Quickstart

based on https://github.com/pipecat-ai/pipecat-quickstart/tree/6bc0f652e28779db5f8d23f0d152feb7332f37bc

## Step 1: Local Development

### Prerequisites

#### Environment

- Python 3.10 or later
- [uv](https://docs.astral.sh/uv/getting-started/installation/) package manager installed

#### AI Service API keys

You'll need API keys from three services:

- [AssemblyAI](https://www.assemblyai.com/dashboard/signup) for Speech-to-Text
- [OpenAI](https://auth.openai.com/create-account) for LLM inference
- [Inworld](https://inworld.ai) for Text-to-Speech

> 💡 **Tip**: Get the keys for all three now. You'll need them soon.

### Setup

Navigate to the quickstart directory and set up your environment.

1. From repo root

   ```bash
   cd integrations/pipecat/pipecat-quickstart
   ```

2. Configure your API keys:

   Create a `.env` file:

   ```bash
   cp .env.example .env
   ```

   Then, add your API keys:

   ```ini
   ASSEMBLYAI_API_KEY=your_assemblyai_api_key
   OPENAI_API_KEY=your_openai_api_key
   INWORLD_API_KEY=your_inworld_api_key
   ```

3. Set up a virtual environment and install dependencies

   ```bash
   uv sync
   ```

### Run your bot locally with local pipecat package

```bash
uv pip uninstall pipecat-ai && uv sync && uv run bot.py
```

**Open http://localhost:7860 in your browser** and click `Connect` to start talking to your bot.

> 💡 First run note: The initial startup may take ~20 seconds as Pipecat downloads required models and imports.

🎉 **Success!** Your bot is running locally. Now let's deploy it to production so others can use it.

### Run your bot locally with remote up-to-date pipecat package

Will add instruction for this soon. stay tuned!
