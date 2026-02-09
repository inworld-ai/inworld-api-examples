"""Quick test agent for Inworld TTS plugin development"""
import logging
import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env from the same directory as this script
env_path = Path(__file__).parent / ".env"
loaded = load_dotenv(dotenv_path=env_path, override=True)

from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    cli,
)
from livekit.plugins import assemblyai, inworld, openai, silero

logger = logging.getLogger("inworld-test-agent")


class TestAgent(Agent):
    def __init__(self) -> None:
        super().__init__(
            instructions="""You are a helpful voice AI assistant for testing Inworld TTS.
            Keep your responses concise and to the point.
            Do not use emojis, asterisks, or markdown.
            You are friendly and have a sense of humor.""",
        )

    async def on_enter(self):
        self.session.generate_reply(allow_interruptions=False)


server = AgentServer()


def prewarm(proc: JobProcess):
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


@server.rtc_session()
async def entrypoint(ctx: JobContext):
    ctx.log_context_fields = {"room": ctx.room.name}

    session = AgentSession(
        # AssemblyAI for speech-to-text
        stt=assemblyai.STT(),
        # OpenAI for LLM
        llm=openai.LLM(model="gpt-4o-mini"),
        # Inworld for text-to-speech (using your local plugin!)
        tts=inworld.TTS(voice="Alex", timestamp_type="WORD", ws_url="wss://api.inworld.ai/"),
        vad=ctx.proc.userdata["vad"],
    )

    await session.start(agent=TestAgent(), room=ctx.room)
    await ctx.connect()


if __name__ == "__main__":
    cli.run_app(server)
