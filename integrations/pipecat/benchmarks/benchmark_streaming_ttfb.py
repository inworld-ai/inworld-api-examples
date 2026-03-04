"""
Benchmark script for measuring TTFB with HTTP-based TTS services.

Compares TTFB across HTTP-based TTS providers:
- Inworld (HTTP)
- ElevenLabs (HTTP)
- Cartesia (HTTP)

Sends text through the pipecat pipeline with sentence aggregation enabled.
Each sentence triggers a separate HTTP request, and TTFB is measured per request.
"""

import asyncio
import os
import struct
import time
from pathlib import Path
from typing import Dict, List

import aiohttp
from dotenv import load_dotenv
from loguru import logger

from pipecat.frames.frames import (
    EndFrame,
    Frame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    MetricsFrame,
    StartFrame,
    TextFrame,
    TTSAudioRawFrame,
    TTSStartedFrame,
    TTSStoppedFrame,
    TTSTextFrame,
)
from pipecat.metrics.metrics import TTFBMetricsData
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

load_dotenv(override=True)


class TextSourceProcessor(FrameProcessor):
    """Sends text into the pipeline for TTS processing.

    Sends the full text as a single TextFrame. The TTS service's sentence
    aggregator splits it into sentences, each triggering a separate HTTP request.
    """

    def __init__(self, text: str, **kwargs):
        super().__init__(**kwargs)
        self._text = text
        self._started = False

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, StartFrame):
            await self.push_frame(frame, direction)
            if not self._started:
                self._started = True
                asyncio.create_task(self._emit_text())
        else:
            await self.push_frame(frame, direction)

    async def _emit_text(self):
        """Send the full text through the pipeline."""
        await asyncio.sleep(0.1)  # Small initial delay

        await self.push_frame(LLMFullResponseStartFrame())
        await self.push_frame(TextFrame(text=self._text))
        await self.push_frame(LLMFullResponseEndFrame())

        # Small delay then end
        await asyncio.sleep(0.5)
        await self.push_frame(EndFrame())


class TTFBCollector(FrameProcessor):
    """Collects TTFB metrics, word timestamps, and audio frames for analysis."""

    def __init__(
        self,
        service_name: str = "TTS",
        save_audio: bool = True,
        output_dir: str = "benchmark_audio",
        **kwargs,
    ):
        super().__init__(**kwargs)
        self.service_name = service_name
        self.save_audio = save_audio
        self.output_dir = output_dir
        self.ttfb_values = []
        self.ttft_values = []  # Time to first timestamp per TTS request
        self.tt700_values = []  # Time to first 700ms of audio per TTS request
        self.audio_frame_count = 0
        self.total_audio_bytes = 0
        self.first_audio_time = None
        self.first_chunk_bytes = None
        self.sample_rate = None
        self.all_audio_chunks = []  # Accumulate all audio
        self.start_time = None
        self.last_audio_time = None
        # Per-context_id tracking (keyed by context_id string)
        self._ctx_start: dict = {}       # context_id -> wall-clock start time
        self._ctx_got_ts: dict = {}      # context_id -> bool: first TTSTextFrame recorded
        self._ctx_audio_bytes: dict = {} # context_id -> bytes accumulated for TT700
        self._ctx_got_700ms: dict = {}   # context_id -> bool: 700ms threshold reached
        self._done_event = asyncio.Event()
        self._check_task = None

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, StartFrame):
            # Start a task to check for audio completion
            self._check_task = asyncio.create_task(self._check_audio_done())
        elif isinstance(frame, MetricsFrame):
            for data in frame.data:
                if isinstance(data, TTFBMetricsData):
                    # Filter out spurious near-zero TTFB values (< 10ms)
                    if data.value > 0.01:
                        self.ttfb_values.append(data.value)
        elif isinstance(frame, TTSStartedFrame):
            self.start_time = time.time()
            ctx = frame.context_id
            self._ctx_start[ctx] = time.time()
            self._ctx_got_ts[ctx] = False
            self._ctx_audio_bytes[ctx] = 0
            self._ctx_got_700ms[ctx] = False
        elif isinstance(frame, TTSStoppedFrame):
            # Don't clean up yet — TTSTextFrame may still arrive after stop (async words queue)
            pass
        elif isinstance(frame, TTSTextFrame):
            ctx = frame.context_id
            if ctx in self._ctx_start and not self._ctx_got_ts.get(ctx, True):
                self._ctx_got_ts[ctx] = True
                ttft = time.time() - self._ctx_start[ctx]
                if ttft > 0.01:
                    self.ttft_values.append(ttft)
        elif isinstance(frame, TTSAudioRawFrame):
            if self.first_audio_time is None:
                self.first_audio_time = time.time()
                self.first_chunk_bytes = frame.audio
                self.sample_rate = frame.sample_rate

            # Accumulate all audio chunks
            self.all_audio_chunks.append(frame.audio)
            self.audio_frame_count += 1
            self.total_audio_bytes += len(frame.audio)
            self.last_audio_time = time.time()

            # Track time to first 700ms of audio per context
            ctx = frame.context_id
            if ctx in self._ctx_start and not self._ctx_got_700ms.get(ctx, True):
                self._ctx_audio_bytes[ctx] = self._ctx_audio_bytes.get(ctx, 0) + len(frame.audio)
                sr = frame.sample_rate or self.sample_rate or 24000
                threshold = int(sr * 0.7 * 2)  # 700ms of 16-bit mono PCM
                if self._ctx_audio_bytes[ctx] >= threshold:
                    self._ctx_got_700ms[ctx] = True
                    tt700 = time.time() - self._ctx_start[ctx]
                    if tt700 > 0.01:
                        self.tt700_values.append(tt700)

        await self.push_frame(frame, direction)

    def _save_wav(self, audio_data: bytes, filename: str):
        """Save audio data to a WAV file."""
        # Create output directory if it doesn't exist
        Path(self.output_dir).mkdir(parents=True, exist_ok=True)

        # Write as WAV file (16-bit PCM)
        sample_rate = self.sample_rate or 24000
        num_channels = 1
        bits_per_sample = 16
        byte_rate = sample_rate * num_channels * bits_per_sample // 8
        block_align = num_channels * bits_per_sample // 8
        data_size = len(audio_data)

        filepath = f"{self.output_dir}/{filename}"
        with open(filepath, "wb") as f:
            # RIFF header
            f.write(b"RIFF")
            f.write(struct.pack("<I", 36 + data_size))  # File size - 8
            f.write(b"WAVE")

            # fmt chunk
            f.write(b"fmt ")
            f.write(struct.pack("<I", 16))  # Chunk size
            f.write(struct.pack("<H", 1))  # Audio format (PCM)
            f.write(struct.pack("<H", num_channels))
            f.write(struct.pack("<I", sample_rate))
            f.write(struct.pack("<I", byte_rate))
            f.write(struct.pack("<H", block_align))
            f.write(struct.pack("<H", bits_per_sample))

            # data chunk
            f.write(b"data")
            f.write(struct.pack("<I", data_size))
            f.write(audio_data)

        return filepath

    def save_audio_files(self):
        """Save first chunk and full audio to WAV files."""
        if not self.save_audio:
            return

        safe_name = self.service_name.lower().replace(" ", "_")

        # Save first chunk
        if self.first_chunk_bytes:
            filename = f"{safe_name}_http_first_chunk.wav"
            self._save_wav(self.first_chunk_bytes, filename)

        # Save full audio
        if self.all_audio_chunks:
            full_audio = b"".join(self.all_audio_chunks)
            filename = f"{safe_name}_http_full.wav"
            self._save_wav(full_audio, filename)

    async def _check_audio_done(self):
        """Check if audio has stopped arriving and signal completion."""
        # Wait for first audio to arrive
        while self.first_audio_time is None:
            await asyncio.sleep(0.1)

        # Now wait for audio to stop (no new audio for 2 seconds)
        while True:
            await asyncio.sleep(0.5)
            if self.last_audio_time and (time.time() - self.last_audio_time) > 2.0:
                # Save audio files when done
                self.save_audio_files()
                self._done_event.set()
                break

    async def wait_for_completion(self):
        """Wait for audio to finish arriving."""
        await self._done_event.wait()

    def get_results(self) -> Dict:
        """Return benchmark results as a dictionary."""
        first_chunk_size = len(self.first_chunk_bytes) if self.first_chunk_bytes else 0

        ttft_stats = (
            {
                "ttft_count": len(self.ttft_values),
                "ttft_avg": sum(self.ttft_values) / len(self.ttft_values),
                "ttft_min": min(self.ttft_values),
                "ttft_max": max(self.ttft_values),
                "ttft_values": self.ttft_values,
            }
            if self.ttft_values
            else {
                "ttft_count": 0,
                "ttft_avg": None,
                "ttft_min": None,
                "ttft_max": None,
                "ttft_values": [],
            }
        )

        tt700_stats = (
            {
                "tt700_count": len(self.tt700_values),
                "tt700_avg": sum(self.tt700_values) / len(self.tt700_values),
                "tt700_min": min(self.tt700_values),
                "tt700_max": max(self.tt700_values),
                "tt700_values": self.tt700_values,
            }
            if self.tt700_values
            else {
                "tt700_count": 0,
                "tt700_avg": None,
                "tt700_min": None,
                "tt700_max": None,
                "tt700_values": [],
            }
        )

        if self.ttfb_values:
            return {
                "service": self.service_name,
                "ttfb_count": len(self.ttfb_values),
                "ttfb_avg": sum(self.ttfb_values) / len(self.ttfb_values),
                "ttfb_min": min(self.ttfb_values),
                "ttfb_max": max(self.ttfb_values),
                "ttfb_values": self.ttfb_values,
                "audio_frames": self.audio_frame_count,
                "audio_bytes": self.total_audio_bytes,
                "first_chunk_size": first_chunk_size,
                **ttft_stats,
                **tt700_stats,
            }
        return {
            "service": self.service_name,
            "ttfb_count": 0,
            "ttfb_avg": None,
            "ttfb_min": None,
            "ttfb_max": None,
            "ttfb_values": [],
            "audio_frames": self.audio_frame_count,
            "audio_bytes": self.total_audio_bytes,
            "first_chunk_size": first_chunk_size,
            **ttft_stats,
            **tt700_stats,
        }


def create_inworld_http_tts(api_key: str, session: aiohttp.ClientSession):
    """Create an Inworld HTTP TTS service using the stock pipecat implementation."""
    from pipecat.services.inworld.tts import InworldHttpTTSService

    return InworldHttpTTSService(
        api_key=api_key,
        aiohttp_session=session,
        voice_id="Ashley",
        model="inworld-tts-1.5-mini",
        streaming=True,
        aggregate_sentences=True,
    )


def create_elevenlabs_http_tts(api_key: str, session: aiohttp.ClientSession):
    """Create an ElevenLabs HTTP TTS service using the stock pipecat implementation."""
    from pipecat.services.elevenlabs.tts import ElevenLabsHttpTTSService

    return ElevenLabsHttpTTSService(
        api_key=api_key,
        aiohttp_session=session,
        voice_id="21m00Tcm4TlvDq8ikWAM",  # Rachel voice
        model="eleven_turbo_v2_5",
        aggregate_sentences=True,
    )


def create_cartesia_http_tts(api_key: str, session: aiohttp.ClientSession):
    """Create a Cartesia HTTP TTS service using the stock pipecat implementation."""
    from pipecat.services.cartesia.tts import CartesiaHttpTTSService

    return CartesiaHttpTTSService(
        api_key=api_key,
        voice_id="79a125e8-cd45-4c13-8a67-188112f4dd22",  # British Lady voice
        model="sonic-3",
    )


async def _run_benchmark(text_source, tts, collector):
    """Run the actual benchmark pipeline."""
    pipeline = Pipeline([text_source, tts, collector])

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
    )

    runner = PipelineRunner(handle_sigint=False)

    # Run the pipeline in a task so we can cancel it when audio completes
    run_task = asyncio.create_task(runner.run(task))

    # Wait for audio to complete
    await collector.wait_for_completion()

    # Give a moment for final frames to process
    await asyncio.sleep(0.5)

    # Cancel the pipeline
    await task.cancel()

    # Wait for the runner to finish
    try:
        await asyncio.wait_for(run_task, timeout=5.0)
    except asyncio.TimeoutError:
        pass
    except asyncio.CancelledError:
        pass

    return collector.get_results()


async def benchmark_service(
    service_name: str,
    create_tts_fn,
    text: str,
    save_audio: bool = True,
    output_dir: str = "benchmark_audio",
    **create_kwargs,
) -> Dict:
    """
    Run the TTFB benchmark for a specific HTTP-based TTS service.

    Args:
        service_name: Name of the service for logging
        create_tts_fn: Function to create the TTS service
        text: The text to synthesize
        save_audio: Whether to save audio files (first chunk + full audio)
        output_dir: Directory to save audio files
        **create_kwargs: Additional keyword arguments for the TTS creation function

    Returns:
        Dictionary with benchmark results
    """
    text_source = TextSourceProcessor(text=text)
    collector = TTFBCollector(
        service_name=service_name,
        save_audio=save_audio,
        output_dir=output_dir,
    )

    async with aiohttp.ClientSession() as session:
        tts = create_tts_fn(session=session, **create_kwargs)
        return await _run_benchmark(text_source, tts, collector)


def print_comparison_table(results: List[Dict]):
    """Print a comparison table of benchmark results."""
    print("\n" + "=" * 90)
    print("HTTP TTS BENCHMARK RESULTS")
    print("=" * 90)

    # --- TTFB section ---
    print("\n📊 Time to First Audio Byte (TTFB)")
    print(f"{'Service':<20} {'Avg TTFB':<12} {'Min TTFB':<12} {'Max TTFB':<12} {'Runs':<10}")
    print("-" * 70)

    sorted_by_ttfb = sorted(results, key=lambda x: x.get("ttfb_avg") or float("inf"))
    for r in sorted_by_ttfb:
        if r.get("ttfb_avg") is not None:
            print(
                f"{r['service']:<20} {r['ttfb_avg']:.3f}s{'':<6} {r['ttfb_min']:.3f}s{'':<6} "
                f"{r['ttfb_max']:.3f}s{'':<6} {r['ttfb_count']:<10}"
            )
        else:
            print(f"{r['service']:<20} {'N/A':<12} {'N/A':<12} {'N/A':<12} {0:<10}")

    if sorted_by_ttfb and sorted_by_ttfb[0].get("ttfb_avg") is not None:
        winner = sorted_by_ttfb[0]
        print(f"\n🏆 Fastest avg TTFB: {winner['service']} ({winner['ttfb_avg']:.3f}s)")

    # --- TTFT section ---
    print("\n📊 Time to First Timestamp (TTFT)")
    print(f"{'Service':<20} {'Avg TTFT':<12} {'Min TTFT':<12} {'Max TTFT':<12} {'Runs':<10}")
    print("-" * 70)

    sorted_by_ttft = sorted(results, key=lambda x: x.get("ttft_avg") or float("inf"))
    has_ttft = any(r.get("ttft_avg") is not None for r in results)
    for r in sorted_by_ttft:
        if r.get("ttft_avg") is not None:
            print(
                f"{r['service']:<20} {r['ttft_avg']:.3f}s{'':<6} {r['ttft_min']:.3f}s{'':<6} "
                f"{r['ttft_max']:.3f}s{'':<6} {r['ttft_count']:<10}"
            )
        else:
            print(f"{r['service']:<20} {'N/A (no timestamps)':<12}")

    if has_ttft and sorted_by_ttft[0].get("ttft_avg") is not None:
        winner = sorted_by_ttft[0]
        print(f"\n🏆 Fastest avg TTFT: {winner['service']} ({winner['ttft_avg']:.3f}s)")

    # --- TT700 section ---
    print("\n📊 Time to First 700ms of Audio (TT700)")
    print(f"{'Service':<20} {'Avg TT700':<12} {'Min TT700':<12} {'Max TT700':<12} {'Runs':<10}")
    print("-" * 70)

    sorted_by_tt700 = sorted(results, key=lambda x: x.get("tt700_avg") or float("inf"))
    for r in sorted_by_tt700:
        if r.get("tt700_avg") is not None:
            print(
                f"{r['service']:<20} {r['tt700_avg']:.3f}s{'':<6} {r['tt700_min']:.3f}s{'':<6} "
                f"{r['tt700_max']:.3f}s{'':<6} {r['tt700_count']:<10}"
            )
        else:
            print(f"{r['service']:<20} {'N/A':<12} {'N/A':<12} {'N/A':<12} {0:<10}")

    if sorted_by_tt700 and sorted_by_tt700[0].get("tt700_avg") is not None:
        winner = sorted_by_tt700[0]
        print(f"\n🏆 Fastest avg TT700: {winner['service']} ({winner['tt700_avg']:.3f}s)")

    print("\n" + "=" * 90)


async def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Benchmark TTFB for HTTP-based TTS providers"
    )
    parser.add_argument(
        "--text",
        type=str,
        default=None,
        help="Custom text to synthesize",
    )
    parser.add_argument(
        "-n",
        "--iterations",
        type=int,
        default=20,
        help="Number of benchmark iterations to run (default: 50)",
    )
    parser.add_argument(
        "--services",
        type=str,
        default="all",
        help="Comma-separated list of services to benchmark: inworld,elevenlabs,cartesia or 'all' (default: all)",
    )
    parser.add_argument(
        "--no-save-audio",
        action="store_true",
        help="Disable saving audio files",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose logging from pipecat internals",
    )
    args = parser.parse_args()

    if not args.verbose:
        logger.remove()
        logger.add(lambda msg: None)  # Suppress all logging

    # Default text with multiple sentences
    if args.text is None:
        text = (
            "Hello! Welcome to the TTS benchmark. "
            "This is a test of the text-to-speech system. "
            "Each sentence should trigger a separate TTS request. "
            "Let's see how fast the first audio byte arrives!"
        )
    else:
        text = args.text

    # Parse services to benchmark
    if args.services.lower() == "all":
        services_to_run = ["inworld", "elevenlabs", "cartesia"]
    else:
        services_to_run = [s.strip().lower() for s in args.services.split(",")]

    # Service configurations
    service_configs = {
        "inworld": {
            "name": "Inworld HTTP",
            "create_fn": create_inworld_http_tts,
            "api_key_env": "BASE64_SECRET_KEY",
            "extra_env": {},
        },
        "elevenlabs": {
            "name": "ElevenLabs HTTP",
            "create_fn": create_elevenlabs_http_tts,
            "api_key_env": "ELEVEN_API_KEY",
            "extra_env": {},
        },
        "cartesia": {
            "name": "Cartesia HTTP",
            "create_fn": create_cartesia_http_tts,
            "api_key_env": "CARTESIA_API_KEY",
            "extra_env": {},
        },
    }

    # Check API keys and filter services
    available_services = []
    for service_id in services_to_run:
        if service_id not in service_configs:
            logger.warning(f"Unknown service: {service_id}")
            continue

        config = service_configs[service_id]
        api_key = os.getenv(config["api_key_env"])

        if not api_key:
            logger.warning(f"{config['name']}: {config['api_key_env']} not set, skipping")
            continue

        # Check extra environment variables
        extra_kwargs = {}
        missing_env = False
        for kwarg_name, env_var in config["extra_env"].items():
            value = os.getenv(env_var)
            if not value:
                logger.warning(f"{config['name']}: {env_var} not set, skipping")
                missing_env = True
                break
            extra_kwargs[kwarg_name] = value

        if missing_env:
            continue

        available_services.append((service_id, config, api_key, extra_kwargs))

    if not available_services:
        print("No services available to benchmark. Please set the required API keys:")
        print("  - INWORLD_API_KEY for Inworld HTTP")
        print("  - ELEVEN_API_KEY for ElevenLabs HTTP")
        print("  - CARTESIA_API_KEY for Cartesia HTTP")
        return

    print(
        f"\n🚀 Benchmarking {len(available_services)} HTTP TTS service(s): "
        f"{', '.join(c[1]['name'] for c in available_services)}"
    )
    print(f"📝 Text: {text[:50]}..." if len(text) > 50 else f"📝 Text: {text}")
    print(f"🔄 Runs: {args.iterations}")
    print()

    all_results = {service_id: [] for service_id, _, _, _ in available_services}

    for iteration in range(args.iterations):
        # Print progress
        print(f"\rProgress: {iteration + 1}/{args.iterations}", end="", flush=True)

        for service_id, config, api_key, extra_kwargs in available_services:
            try:
                result = await benchmark_service(
                    service_name=config["name"],
                    create_tts_fn=config["create_fn"],
                    text=text,
                    save_audio=not args.no_save_audio and iteration == 0,  # Only save audio on first run
                    api_key=api_key,
                    **extra_kwargs,
                )
                all_results[service_id].append(result)
            except Exception as e:
                all_results[service_id].append(
                    {
                        "service": config["name"],
                        "ttfb_count": 0,
                        "ttfb_avg": None,
                        "ttfb_min": None,
                        "ttfb_max": None,
                        "ttfb_values": [],
                        "audio_frames": 0,
                        "audio_bytes": 0,
                        "error": str(e),
                    }
                )

            # Small delay between services
            await asyncio.sleep(0.5)

    print()  # New line after progress

    # Aggregate results across iterations
    aggregated_results = []
    for service_id, results_list in all_results.items():
        all_ttfb = []
        all_ttft = []
        all_tt700 = []
        for r in results_list:
            all_ttfb.extend(r.get("ttfb_values", []))
            all_ttft.extend(r.get("ttft_values", []))
            all_tt700.extend(r.get("tt700_values", []))

        def _agg(values, prefix):
            if values:
                return {
                    f"{prefix}_count": len(values),
                    f"{prefix}_avg": sum(values) / len(values),
                    f"{prefix}_min": min(values),
                    f"{prefix}_max": max(values),
                    f"{prefix}_values": values,
                }
            return {
                f"{prefix}_count": 0,
                f"{prefix}_avg": None,
                f"{prefix}_min": None,
                f"{prefix}_max": None,
                f"{prefix}_values": [],
            }

        service_name = results_list[0]["service"] if results_list else service_configs[service_id]["name"]
        aggregated_results.append({
            "service": service_name,
            **_agg(all_ttfb, "ttfb"),
            **_agg(all_ttft, "ttft"),
            **_agg(all_tt700, "tt700"),
        })

    # Print comparison
    print_comparison_table(aggregated_results)


if __name__ == "__main__":
    asyncio.run(main())
