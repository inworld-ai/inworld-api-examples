"""Quick test agent for Inworld TTS plugin development."""

import logging
from collections.abc import AsyncGenerator, AsyncIterable
from pathlib import Path
import os

from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).parent / ".env", override=True)

from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    cli,
)
from livekit.agents.voice.agent import ModelSettings
from livekit.agents.voice.io import TimedString
from livekit.plugins import assemblyai, inworld, openai, silero

logger = logging.getLogger("inworld-test-agent")


class TestAgent(Agent):
    def __init__(self) -> None:
        super().__init__(
            instructions=(
                "You are a helpful voice AI assistant for testing Inworld TTS. "
                "Keep your responses concise and to the point. "
                "Do not use emojis, asterisks, or markdown. "
                "You are friendly and have a sense of humor."
            ),
        )

    async def on_enter(self):
        self.session.generate_reply(allow_interruptions=False)

    async def transcription_node(
        self, text: AsyncIterable[str | TimedString], model_settings: ModelSettings
    ) -> AsyncGenerator[str | TimedString, None]:
        async for chunk in text:
            if isinstance(chunk, TimedString):
                logger.info(
                    "TimedString: '%s' (%.3fs - %.3fs)",
                    chunk,
                    chunk.start_time if chunk.start_time else 0,
                    chunk.end_time if chunk.end_time else 0,
                )
            yield chunk


server = AgentServer()


def prewarm(proc: JobProcess):
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


@server.rtc_session()
async def entrypoint(ctx: JobContext):
    ctx.log_context_fields = {"room": ctx.room.name}

    session = AgentSession(
        stt=assemblyai.STT(),
        llm=openai.LLM(model="gpt-4o-mini"),
        tts=inworld.TTS(
            voice="Alex", timestamp_type="WORD", model="inworld-tts-1.5-max",
            ws_url="wss://api.inworld.ai/",
            api_key=os.getenv("INWORLD_API_KEY"),
        ),
        vad=ctx.proc.userdata["vad"],
        use_tts_aligned_transcript=True,
    )

    await session.start(agent=TestAgent(), room=ctx.room)
    await ctx.connect()


if __name__ == "__main__":
    cli.run_app(server)
