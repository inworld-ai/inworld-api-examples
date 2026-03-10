"""Benchmark HTTP TTS TTFB across providers using Pipecat pipelines.

Sends text through the pipeline with sentence aggregation. Each sentence
triggers a separate HTTP request, and TTFB is measured per request.
"""

import asyncio
import logging
import os
import re
import struct
import time
from pathlib import Path
from typing import Dict, List

import aiohttp
from dotenv import load_dotenv
from loguru import logger as _loguru_logger

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

logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("benchmark")

DEFAULT_TEXT = (
    "Hello! Welcome to the TTS benchmark. "
    "This is a test of the text-to-speech system. "
    "Each sentence should trigger a separate TTS request. "
    "Let's see how fast the first audio byte arrives!"
)


def split_sentences(text: str) -> List[str]:
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    return [s for s in sentences if s.strip()]


def save_wav(audio_data: bytes, filename: str, sample_rate: int,
             output_dir: str = "benchmark_audio") -> str:
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    num_channels, bits_per_sample = 1, 16
    byte_rate = sample_rate * num_channels * bits_per_sample // 8
    block_align = num_channels * bits_per_sample // 8
    filepath = f"{output_dir}/{filename}"
    with open(filepath, "wb") as f:
        f.write(b"RIFF")
        f.write(struct.pack("<I", 36 + len(audio_data)))
        f.write(b"WAVE")
        f.write(b"fmt ")
        f.write(struct.pack("<IHHIIHH", 16, 1, num_channels, sample_rate,
                            byte_rate, block_align, bits_per_sample))
        f.write(b"data")
        f.write(struct.pack("<I", len(audio_data)))
        f.write(audio_data)
    return filepath


def _percentile(sorted_vals: List[float], p: float) -> float:
    idx = (p / 100) * (len(sorted_vals) - 1)
    low = int(idx)
    high = min(low + 1, len(sorted_vals) - 1)
    return sorted_vals[low] * (1 - (idx - low)) + sorted_vals[high] * (idx - low)


def compute_stats(values: List[float]) -> Dict:
    if not values:
        return {"count": 0, "avg": None, "std": None, "min": None,
                "max": None, "p50": None, "p95": None, "values": []}
    n = len(values)
    avg = sum(values) / n
    std = (sum((x - avg) ** 2 for x in values) / n) ** 0.5
    s = sorted(values)
    return {"count": n, "avg": avg, "std": std, "min": s[0], "max": s[-1],
            "p50": _percentile(s, 50), "p95": _percentile(s, 95), "values": values}


class TextSourceProcessor(FrameProcessor):
    """Sends full text into the pipeline. The TTS sentence aggregator splits it."""

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
        await asyncio.sleep(0.1)
        await self.push_frame(LLMFullResponseStartFrame())
        await self.push_frame(TextFrame(text=self._text))
        await self.push_frame(LLMFullResponseEndFrame())
        await asyncio.sleep(0.5)
        await self.push_frame(EndFrame())


class TTFBCollector(FrameProcessor):
    """Collects TTFB, TTFT, TT700 metrics and audio data from the pipeline."""

    def __init__(self, service_name: str = "TTS", save_audio: bool = True,
                 output_dir: str = "benchmark_audio", **kwargs):
        super().__init__(**kwargs)
        self.service_name = service_name
        self.save_audio = save_audio
        self.output_dir = output_dir
        self.ttfb_values: List[float] = []
        self.ttft_values: List[float] = []
        self.tt700_values: List[float] = []
        self.audio_frame_count = 0
        self.total_audio_bytes = 0
        self.first_audio_time = None
        self.first_chunk_bytes = None
        self.sample_rate = None
        self.all_audio_chunks: List[bytes] = []
        self.last_audio_time = None
        self._tts_start_time: float | None = None
        self._got_first_ts = False
        self._tts_audio_bytes = 0
        self._got_700ms = False
        self._done_event = asyncio.Event()
        self._check_task = None

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, StartFrame):
            self._check_task = asyncio.create_task(self._check_audio_done())
        elif isinstance(frame, MetricsFrame):
            for data in frame.data:
                if isinstance(data, TTFBMetricsData):
                    if data.value > 0.01:
                        self.ttfb_values.append(data.value)
                        logger.debug("[%s] TTFB: %.3fs", self.service_name, data.value)
        elif isinstance(frame, TTSStartedFrame):
            self._tts_start_time = time.time()
            self._got_first_ts = False
            self._tts_audio_bytes = 0
            self._got_700ms = False
        elif isinstance(frame, TTSStoppedFrame):
            pass  # TTSTextFrame may still arrive after stop (async words queue)
        elif isinstance(frame, TTSTextFrame):
            if self._tts_start_time and not self._got_first_ts:
                self._got_first_ts = True
                ttft = time.time() - self._tts_start_time
                if ttft > 0.01:
                    self.ttft_values.append(ttft)
        elif isinstance(frame, TTSAudioRawFrame):
            if self.first_audio_time is None:
                self.first_audio_time = time.time()
                self.first_chunk_bytes = frame.audio
                self.sample_rate = frame.sample_rate

            self.all_audio_chunks.append(frame.audio)
            self.audio_frame_count += 1
            self.total_audio_bytes += len(frame.audio)
            self.last_audio_time = time.time()

            if self._tts_start_time and not self._got_700ms:
                self._tts_audio_bytes += len(frame.audio)
                sr = frame.sample_rate or self.sample_rate or 24000
                if self._tts_audio_bytes >= int(sr * 0.7 * 2):
                    self._got_700ms = True
                    tt700 = time.time() - self._tts_start_time
                    if tt700 > 0.01:
                        self.tt700_values.append(tt700)

        await self.push_frame(frame, direction)

    async def _check_audio_done(self):
        while self.first_audio_time is None:
            await asyncio.sleep(0.1)
        while True:
            await asyncio.sleep(0.5)
            if self.last_audio_time and (time.time() - self.last_audio_time) > 2.0:
                if self.save_audio:
                    self._save_audio_files()
                self._done_event.set()
                break

    async def wait_for_completion(self):
        await self._done_event.wait()

    def _save_audio_files(self):
        safe_name = self.service_name.lower().replace(" ", "_")
        sr = self.sample_rate or 24000
        if self.first_chunk_bytes:
            save_wav(self.first_chunk_bytes, f"{safe_name}_http_first_chunk.wav", sr, self.output_dir)
        if self.all_audio_chunks:
            save_wav(b"".join(self.all_audio_chunks), f"{safe_name}_http_full.wav", sr, self.output_dir)

    def get_results(self) -> Dict:
        return {
            "service": self.service_name,
            "ttfb": compute_stats(self.ttfb_values),
            "ttft": compute_stats(self.ttft_values),
            "tt700": compute_stats(self.tt700_values),
            "audio_frames": self.audio_frame_count,
            "audio_bytes": self.total_audio_bytes,
        }


def create_inworld_tts(api_key: str, session: aiohttp.ClientSession):
    from pipecat.services.inworld.tts import InworldHttpTTSService
    return InworldHttpTTSService(
        api_key=api_key, aiohttp_session=session, voice_id="Ashley",
        model="inworld-tts-1.5-mini", streaming=True, aggregate_sentences=True,
    )


def create_elevenlabs_tts(api_key: str, session: aiohttp.ClientSession):
    from pipecat.services.elevenlabs.tts import ElevenLabsHttpTTSService
    return ElevenLabsHttpTTSService(
        api_key=api_key, aiohttp_session=session, voice_id="21m00Tcm4TlvDq8ikWAM",
        model="eleven_turbo_v2_5", aggregate_sentences=True,
    )


def create_cartesia_tts(api_key: str, session: aiohttp.ClientSession):
    from pipecat.services.cartesia.tts import CartesiaHttpTTSService
    return CartesiaHttpTTSService(
        api_key=api_key, voice_id="79a125e8-cd45-4c13-8a67-188112f4dd22",
        model="sonic-3", aggregate_sentences=True,
    )


async def _run_pipeline(text_source, tts, collector):
    pipeline = Pipeline([text_source, tts, collector])
    task = PipelineTask(pipeline, params=PipelineParams(
        enable_metrics=True, enable_usage_metrics=True))
    runner = PipelineRunner(handle_sigint=False)

    run_task = asyncio.create_task(runner.run(task))
    await collector.wait_for_completion()
    await asyncio.sleep(0.5)
    await task.cancel()

    try:
        await asyncio.wait_for(run_task, timeout=5.0)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        pass

    return collector.get_results()


async def run_service_benchmark(
    create_tts_fn, api_key: str, session: aiohttp.ClientSession,
    sentence: str, service_name: str,
    save_audio: bool = True, output_dir: str = "benchmark_audio",
) -> Dict:
    """Run one pipeline with one sentence. Creates a fresh TTS (pipecat
    FrameProcessors can't be reused across pipelines) but reuses the HTTP
    session so TCP connections stay warm."""
    text_source = TextSourceProcessor(text=sentence)
    collector = TTFBCollector(service_name=service_name, save_audio=save_audio,
                              output_dir=output_dir)
    tts = create_tts_fn(api_key=api_key, session=session)
    return await _run_pipeline(text_source, tts, collector)


def _fmt(val, suffix="s"):
    return f"{val:.3f}{suffix}" if val is not None else "N/A"


def print_results(results: List[Dict], title: str = "HTTP TTS BENCHMARK"):
    w = 90
    print(f"\n{'=' * w}")
    print(title)
    print("=" * w)

    for metric_key, metric_label in [("ttfb", "TTFB"), ("ttft", "TTFT"), ("tt700", "TT700")]:
        has_data = any(r[metric_key]["count"] > 0 for r in results)
        if not has_data:
            continue

        print(f"\n📊 {metric_label}")
        print(f"{'Service':<20} {'Avg':>8} {'StdDev':>8} {'Min':>8} "
              f"{'Max':>8} {'P50':>8} {'P95':>8} {'N':>5}")
        print("-" * w)

        sorted_r = sorted(results, key=lambda x: x[metric_key].get("avg") or float("inf"))
        for r in sorted_r:
            s = r[metric_key]
            if s["count"] > 0:
                print(f"{r['service']:<20} {_fmt(s['avg']):>8} {_fmt(s['std']):>8} "
                      f"{_fmt(s['min']):>8} {_fmt(s['max']):>8} "
                      f"{_fmt(s['p50']):>8} {_fmt(s['p95']):>8} {s['count']:>5}")
            else:
                print(f"{r['service']:<20} {'N/A':>8} {'N/A':>8} {'N/A':>8} "
                      f"{'N/A':>8} {'N/A':>8} {'N/A':>8} {'0':>5}")

        winner = sorted_r[0] if sorted_r and sorted_r[0][metric_key].get("avg") else None
        if winner:
            print(f"  🏆 Fastest: {winner['service']} ({_fmt(winner[metric_key]['avg'])})")

    print(f"\n{'=' * w}")


async def main():
    import argparse

    parser = argparse.ArgumentParser(description="Benchmark HTTP TTS TTFB (Pipecat)")
    parser.add_argument("--text", type=str, default=None, help="Custom text to synthesize")
    parser.add_argument("-n", "--iterations", type=int, default=5,
                        help="Number of benchmark iterations (default: 5)")
    parser.add_argument("--services", type=str, default="all",
                        help="Comma-separated services: inworld,elevenlabs,cartesia or 'all'")
    parser.add_argument("--no-save-audio", action="store_true", help="Disable saving audio files")
    parser.add_argument("--debug", action="store_true", help="Enable debug logging")
    parser.add_argument("--warmup", type=int, default=1,
                        help="Warmup iterations before timing (default: 1)")
    args = parser.parse_args()

    if args.debug:
        logging.basicConfig(level=logging.DEBUG, force=True)
    else:
        _loguru_logger.remove()
        _loguru_logger.add(lambda msg: None)

    text = args.text or DEFAULT_TEXT

    services_to_run = (
        ["inworld", "elevenlabs", "cartesia"]
        if args.services.lower() == "all"
        else [s.strip().lower() for s in args.services.split(",")]
    )

    service_configs = {
        "inworld": {"name": "Inworld HTTP", "create_fn": create_inworld_tts,
                     "api_key_env": "INWORLD_API_KEY"},
        "elevenlabs": {"name": "ElevenLabs HTTP", "create_fn": create_elevenlabs_tts,
                       "api_key_env": "ELEVEN_API_KEY"},
        "cartesia": {"name": "Cartesia HTTP", "create_fn": create_cartesia_tts,
                     "api_key_env": "CARTESIA_API_KEY"},
    }

    available = []
    for sid in services_to_run:
        cfg = service_configs.get(sid)
        if not cfg:
            print(f"⚠️  Unknown service: {sid}")
            continue
        api_key = os.getenv(cfg["api_key_env"])
        if not api_key:
            print(f"⚠️  {cfg['name']}: {cfg['api_key_env']} not set, skipping")
            continue
        available.append((sid, cfg, api_key))

    if not available:
        print("No services available. Set INWORLD_API_KEY, ELEVEN_API_KEY, or CARTESIA_API_KEY.")
        return

    print(f"\n🚀 Benchmarking {len(available)} service(s): {', '.join(c[1]['name'] for c in available)}")
    print(f"📝 Text: {text[:60]}..." if len(text) > 60 else f"📝 Text: {text}")
    print(f"🔄 Iterations: {args.iterations} (+ {args.warmup} warmup)\n")

    sentences = split_sentences(text)
    all_ttfb: Dict[str, List[float]] = {sid: [] for sid, _, _ in available}
    all_ttft: Dict[str, List[float]] = {sid: [] for sid, _, _ in available}
    all_tt700: Dict[str, List[float]] = {sid: [] for sid, _, _ in available}

    # Shared HTTP session keeps TCP connections warm across iterations
    session = aiohttp.ClientSession()

    total_iters = args.warmup + args.iterations
    try:
        for iteration in range(total_iters):
            is_warmup = iteration < args.warmup
            label = f"warmup {iteration + 1}/{args.warmup}" if is_warmup else \
                    f"{iteration - args.warmup + 1}/{args.iterations}"
            print(f"\r{'⏳' if is_warmup else '📊'} Progress: {label}", end="", flush=True)

            sentence = sentences[iteration % len(sentences)]

            for sid, cfg, api_key in available:
                try:
                    result = await run_service_benchmark(
                        create_tts_fn=cfg["create_fn"], api_key=api_key,
                        session=session, sentence=sentence,
                        service_name=cfg["name"],
                        save_audio=not args.no_save_audio and iteration == args.warmup,
                    )
                    if not is_warmup:
                        for key, store in [("ttfb", all_ttfb), ("ttft", all_ttft), ("tt700", all_tt700)]:
                            store[sid].extend(result[key].get("values", []))
                        if result["audio_bytes"] == 0:
                            print(f"\n⚠️  {cfg['name']}: No audio received!")
                except Exception as e:
                    print(f"\n❌ {cfg['name']}: {e}")

                await asyncio.sleep(1.0)

            if iteration < total_iters - 1:
                await asyncio.sleep(1.0)
    finally:
        await session.close()

    print()

    aggregated = []
    for sid, cfg, _ in available:
        aggregated.append({
            "service": cfg["name"],
            "ttfb": compute_stats(all_ttfb[sid]),
            "ttft": compute_stats(all_ttft[sid]),
            "tt700": compute_stats(all_tt700[sid]),
        })

    print_results(aggregated, "HTTP TTS BENCHMARK RESULTS (Pipecat)")


if __name__ == "__main__":
    asyncio.run(main())
