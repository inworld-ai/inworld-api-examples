#
# Copyright (c) 2024-2026, Daily
#
# SPDX-License-Identifier: BSD 2-Clause License
#

"""Pipecat Quickstart Example.

The example runs a simple voice AI bot that you can connect to using your
browser and speak with it. You can also deploy this bot to Pipecat Cloud.

Required AI services:
- AssemblyAI (Speech-to-Text)
- OpenAI (LLM)
- Inworld (Text-to-Speech)

Run the bot using::

    uv run bot.py
"""

import os

from dotenv import load_dotenv
from loguru import logger

from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import (
    CancelFrame,
    EndFrame,
    InterruptionFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMRunFrame,
    TTSStoppedFrame,
    TTSTextFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.runner.types import RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.services.assemblyai.stt import AssemblyAISTTService
from pipecat.services.inworld.tts import InworldTTSService, InworldTTSSettings
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transports.base_transport import BaseTransport, TransportParams
from pipecat.transports.daily.transport import DailyParams
from pipecat.turns.user_stop.turn_analyzer_user_turn_stop_strategy import (
    TurnAnalyzerUserTurnStopStrategy,
)
from pipecat.turns.user_turn_strategies import UserTurnStrategies

load_dotenv(override=True)


class TTSTimestampDebugProcessor(FrameProcessor):
    """Logs TTSTextFrame PTS to verify monotonicity per assistant turn."""

    def __init__(self, **kwargs):
        super().__init__(name="tts_timestamp_debug", **kwargs)
        self._turn_index = 0
        self._in_turn = False
        self._last_pts = None

    async def process_frame(self, frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, LLMFullResponseStartFrame):
            self._turn_index += 1
            self._in_turn = True
            self._last_pts = None
            logger.info(f"[tts-ts] turn={self._turn_index} start")
        elif isinstance(frame, (LLMFullResponseEndFrame, TTSStoppedFrame, InterruptionFrame)):
            if self._in_turn:
                logger.info(f"[tts-ts] turn={self._turn_index} end")
            self._in_turn = False
            self._last_pts = None
        elif isinstance(frame, (EndFrame, CancelFrame)):
            self._in_turn = False
            self._last_pts = None

        if isinstance(frame, TTSTextFrame):
            pts = getattr(frame, "pts", None)
            text = frame.text.strip()
            if self._in_turn and self._last_pts is not None and pts is not None:
                if pts < self._last_pts:
                    logger.warning(
                        f"[tts-ts] NON-MONOTONIC turn={self._turn_index} pts={pts} < {self._last_pts} text={text!r}"
                    )
            if self._in_turn:
                logger.trace(
                    f"[tts-ts] turn={self._turn_index} word={text!r} pts={pts}"
                )
            self._last_pts = pts

        await self.push_frame(frame, direction)


async def run_bot(transport: BaseTransport, runner_args: RunnerArguments):
    logger.info("Starting bot")

    stt = AssemblyAISTTService(api_key=os.getenv("ASSEMBLYAI_API_KEY"))

    tts = InworldTTSService(
        api_key=os.getenv("INWORLD_API_KEY"),
        url="wss://api.inworld.ai/tts/v1/voice:streamBidirectional",
        timestamp_transport_strategy="ASYNC",
        settings=InworldTTSSettings(voice="Ashley"),
    )

    llm = OpenAILLMService(api_key=os.getenv("OPENAI_API_KEY"))

    messages = [
        {
            "role": "system",
            "content": "You are a friendly AI assistant. Respond naturally and keep your answers conversational.",
        },
    ]

    context = LLMContext(messages)
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            user_turn_strategies=UserTurnStrategies(
                stop=[TurnAnalyzerUserTurnStopStrategy(turn_analyzer=LocalSmartTurnAnalyzerV3())]
            ),
            vad_analyzer=SileroVADAnalyzer(params=VADParams(stop_secs=0.2)),
        ),
    )

    pipeline = Pipeline(
        [
            transport.input(),  # Transport user input
            stt,
            user_aggregator,  # User responses
            llm,  # LLM
            tts,  # TTS
            TTSTimestampDebugProcessor(),
            transport.output(),  # Transport bot output
            assistant_aggregator,  # Assistant spoken responses
        ]
    )

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
    )

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        logger.info("Client connected")
        # Kick off the conversation.
        messages.append({"role": "system", "content": "Say hello and briefly introduce yourself."})
        await task.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info("Client disconnected")
        await task.cancel()

    runner = PipelineRunner(handle_sigint=runner_args.handle_sigint)

    await runner.run(task)


async def bot(runner_args: RunnerArguments):
    """Main bot entry point for the bot starter."""

    transport_params = {
        "daily": lambda: DailyParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
        ),
        "webrtc": lambda: TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
        ),
    }

    transport = await create_transport(runner_args, transport_params)

    await run_bot(transport, runner_args)


if __name__ == "__main__":
    from pipecat.runner.run import main

    main()
