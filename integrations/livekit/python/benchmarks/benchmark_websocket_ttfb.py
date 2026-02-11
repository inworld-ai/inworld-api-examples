"""
Benchmark script for measuring TTFB with WebSocket-based TTS (stream API).

Compares TTFB across TTS providers using LiveKit's stream() API:
- Inworld (WebSocket)
- ElevenLabs (WebSocket)
- Cartesia (WebSocket)

Simulates an LLM returning tokens one at a time. The TTS service's internal
sentence tokenizer aggregates tokens into complete sentences before sending
to the provider. TTFB is measured per-segment via the built-in metrics system.

Usage:
    cd integrations/livekit/python/agents
    uv run python ../benchmarks/benchmark_websocket_ttfb.py --services inworld -n 5
    uv run python ../benchmarks/benchmark_websocket_ttfb.py --services all --token-delay 50
"""

import asyncio
import logging
import os
import struct
import time
from pathlib import Path
from typing import Dict, List

import aiohttp
from dotenv import load_dotenv

# Load .env from the benchmarks directory, then fall back to agents directory
_benchmarks_dir = Path(__file__).parent
load_dotenv(dotenv_path=_benchmarks_dir / ".env", override=True)
load_dotenv(override=True)

# Suppress verbose logging for clean benchmark output
logging.basicConfig(level=logging.WARNING)


def save_wav(
    audio_data: bytes,
    filename: str,
    sample_rate: int,
    output_dir: str = "benchmark_audio",
) -> str:
    """Save raw PCM audio data (16-bit mono) to a WAV file."""
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    num_channels = 1
    bits_per_sample = 16
    byte_rate = sample_rate * num_channels * bits_per_sample // 8
    block_align = num_channels * bits_per_sample // 8
    data_size = len(audio_data)

    filepath = f"{output_dir}/{filename}"
    with open(filepath, "wb") as f:
        f.write(b"RIFF")
        f.write(struct.pack("<I", 36 + data_size))
        f.write(b"WAVE")
        f.write(b"fmt ")
        f.write(struct.pack("<I", 16))
        f.write(struct.pack("<H", 1))  # PCM
        f.write(struct.pack("<H", num_channels))
        f.write(struct.pack("<I", sample_rate))
        f.write(struct.pack("<I", byte_rate))
        f.write(struct.pack("<H", block_align))
        f.write(struct.pack("<H", bits_per_sample))
        f.write(b"data")
        f.write(struct.pack("<I", data_size))
        f.write(audio_data)

    return filepath


# ---------------------------------------------------------------------------
# TTS service factory functions
# ---------------------------------------------------------------------------


def create_inworld_tts(session: aiohttp.ClientSession, api_key: str):
    """Create an Inworld TTS instance for WebSocket streaming."""
    from livekit.plugins import inworld

    return inworld.TTS(
        api_key=api_key,
        voice="Ashley",
        model="inworld-tts-1.5-max",
        encoding="LINEAR16",
        sample_rate=24000,
        http_session=session,
        ws_url="wss://api.inworld.ai/tts/v1/voice:streamBidirectional",
    )


def create_elevenlabs_tts(session: aiohttp.ClientSession, api_key: str):
    """Create an ElevenLabs TTS instance for WebSocket streaming."""
    from livekit.plugins import elevenlabs

    return elevenlabs.TTS(
        api_key=api_key,
        voice_id="21m00Tcm4TlvDq8ikWAM",  # Rachel voice
        model="eleven_turbo_v2_5",
        http_session=session,
    )


def create_cartesia_tts(session: aiohttp.ClientSession, api_key: str):
    """Create a Cartesia TTS instance for WebSocket streaming."""
    from livekit.plugins import cartesia

    return cartesia.TTS(
        api_key=api_key,
        voice="79a125e8-cd45-4c13-8a67-188112f4dd22",  # British Lady voice
        model="sonic-3",
        http_session=session,
    )


# ---------------------------------------------------------------------------
# Benchmark runner
# ---------------------------------------------------------------------------


async def benchmark_stream(
    tts,
    text: str,
    service_name: str,
    token_delay_ms: float = 50,
    save_audio: bool = False,
    output_dir: str = "benchmark_audio",
) -> Dict:
    """
    Benchmark stream() for a single text, simulating LLM token-by-token output.

    Pushes words one at a time with a delay, letting the TTS service's internal
    sentence tokenizer aggregate into sentences. Measures TTFB two ways:

    1. **Provider TTFB** (via ``metrics_collected``): time from when text is sent
       over the WebSocket to when the first audio frame arrives. This excludes
       the simulated LLM token delay and is the truest measure of provider speed.

    2. **Wall-clock TTFB**: time from the first ``push_text`` call to the first
       audio frame received. Includes token delay + sentence tokenization +
       provider latency.

    The provider TTFB is used as the primary metric for comparison.
    """
    from livekit.agents.metrics import TTSMetrics

    token_delay_s = token_delay_ms / 1000.0
    ttfb_values: List[float] = []
    all_audio = bytearray()
    first_chunk_bytes: bytes | None = None
    sample_rate = tts.sample_rate

    # Collect TTFB from the built-in metrics system (fires once per segment,
    # measuring time from _mark_started to first audio — true provider TTFB).
    def _on_metrics(metrics: TTSMetrics) -> None:
        if metrics.ttfb > 0.01:  # Filter spurious near-zero values
            ttfb_values.append(metrics.ttfb)

    tts.on("metrics_collected", _on_metrics)

    wall_clock_ttfb: float | None = None

    try:
        stream = tts.stream()

        # Simulate LLM token-by-token output in background
        first_push_time: float | None = None

        async def _push_tokens():
            nonlocal first_push_time
            words = text.split()
            for i, word in enumerate(words):
                token = word if i == 0 else " " + word
                stream.push_text(token)
                if first_push_time is None:
                    first_push_time = time.perf_counter()
                await asyncio.sleep(token_delay_s)
            stream.end_input()

        push_task = asyncio.create_task(_push_tokens())

        # Consume audio from the stream with a timeout to avoid hanging
        # on broken connections (e.g. auth failures that don't surface errors)
        stream_timeout = 30.0  # seconds

        async def _consume_audio():
            nonlocal wall_clock_ttfb, first_chunk_bytes
            async for audio in stream:
                if wall_clock_ttfb is None and first_push_time is not None:
                    wall_clock_ttfb = time.perf_counter() - first_push_time

                frame_data = audio.frame.data.tobytes()
                all_audio.extend(frame_data)

                if first_chunk_bytes is None:
                    first_chunk_bytes = frame_data

        try:
            await asyncio.wait_for(_consume_audio(), timeout=stream_timeout)
        except asyncio.TimeoutError:
            print(f"\n⚠️  {service_name}: stream timed out after {stream_timeout}s (possible auth or connection issue)")

        push_task.cancel()
        try:
            await push_task
        except asyncio.CancelledError:
            pass
        await stream.aclose()

        # Save audio files on request
        if save_audio and all_audio:
            safe_name = service_name.lower().replace(" ", "_")
            save_wav(
                bytes(all_audio), f"{safe_name}_ws_full.wav", sample_rate, output_dir
            )
            if first_chunk_bytes:
                save_wav(
                    first_chunk_bytes,
                    f"{safe_name}_ws_first_chunk.wav",
                    sample_rate,
                    output_dir,
                )

        # Allow a moment for metrics events to fire
        await asyncio.sleep(0.2)

    finally:
        tts.off("metrics_collected", _on_metrics)

    if ttfb_values:
        return {
            "service": service_name,
            "ttfb_count": len(ttfb_values),
            "ttfb_avg": sum(ttfb_values) / len(ttfb_values),
            "ttfb_min": min(ttfb_values),
            "ttfb_max": max(ttfb_values),
            "ttfb_values": ttfb_values,
            "wall_clock_ttfb": wall_clock_ttfb,
            "audio_bytes": len(all_audio),
        }

    return {
        "service": service_name,
        "ttfb_count": 0,
        "ttfb_avg": None,
        "ttfb_min": None,
        "ttfb_max": None,
        "ttfb_values": [],
        "wall_clock_ttfb": wall_clock_ttfb,
        "audio_bytes": len(all_audio),
    }


async def run_service_benchmark(
    service_name: str,
    create_tts_fn,
    api_key: str,
    text: str,
    token_delay_ms: float = 50,
    save_audio: bool = True,
    output_dir: str = "benchmark_audio",
) -> Dict:
    """Run the WebSocket TTFB benchmark for a specific TTS service."""
    async with aiohttp.ClientSession() as session:
        tts = create_tts_fn(session=session, api_key=api_key)
        try:
            return await benchmark_stream(
                tts,
                text,
                service_name,
                token_delay_ms=token_delay_ms,
                save_audio=save_audio,
                output_dir=output_dir,
            )
        finally:
            await tts.aclose()


# ---------------------------------------------------------------------------
# Results display
# ---------------------------------------------------------------------------


def print_comparison_table(results: List[Dict]):
    """Print a comparison table of benchmark results."""
    print("\n" + "=" * 80)
    print("WEBSOCKET TTS BENCHMARK RESULTS (stream API)")
    print("=" * 80)

    print(
        f"{'Service':<20} {'Avg TTFB':<12} {'Min TTFB':<12} {'Max TTFB':<12} {'Samples':<10}"
    )
    print("-" * 80)

    sorted_results = sorted(results, key=lambda x: x.get("ttfb_avg") or float("inf"))

    for r in sorted_results:
        if r["ttfb_avg"] is not None:
            print(
                f"{r['service']:<20} {r['ttfb_avg']:.3f}s{'':<6} "
                f"{r['ttfb_min']:.3f}s{'':<6} "
                f"{r['ttfb_max']:.3f}s{'':<6} {r['ttfb_count']:<10}"
            )
        else:
            print(f"{r['service']:<20} {'N/A':<12} {'N/A':<12} {'N/A':<12} {0:<10}")

    print("=" * 80)

    if sorted_results and sorted_results[0]["ttfb_avg"] is not None:
        winner = sorted_results[0]
        print(
            f"\n🏆 Fastest average TTFB: {winner['service']} ({winner['ttfb_avg']:.3f}s)"
        )

    # Per-sentence breakdown (from last iteration's values if available)
    has_values = [r for r in results if r["ttfb_values"]]
    if has_values:
        max_sentences = max(len(r["ttfb_values"]) for r in has_values)
        if max_sentences > 1:
            print("\n" + "-" * 80)
            print("Per-Segment TTFB Breakdown:")
            print("-" * 80)

            for i in range(max_sentences):
                print(f"\nSegment {i + 1}:")
                sentence_results = []
                for r in results:
                    if i < len(r["ttfb_values"]):
                        sentence_results.append((r["service"], r["ttfb_values"][i]))

                sentence_results.sort(key=lambda x: x[1])
                for service, ttfb in sentence_results:
                    print(f"  {service:<20} {ttfb:.3f}s")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


async def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Benchmark TTFB for WebSocket-based TTS providers (LiveKit stream API)"
    )
    parser.add_argument(
        "--token-delay",
        type=float,
        default=50,
        help="Delay between tokens in milliseconds (default: 50)",
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
        default=1,
        help="Number of benchmark iterations (default: 1)",
    )
    parser.add_argument(
        "--services",
        type=str,
        default="all",
        help="Comma-separated list of services: inworld,elevenlabs,cartesia or 'all' (default: all)",
    )
    parser.add_argument(
        "--no-save-audio",
        action="store_true",
        help="Disable saving audio files",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable debug logging for troubleshooting connection issues",
    )
    args = parser.parse_args()

    if args.debug:
        logging.basicConfig(level=logging.DEBUG, force=True)

    # Default text with multiple sentences
    if args.text is None:
        text = (
            "Hello Ian, this is Livekit! Welcome to the TTS benchmark. "
            # "This is a test of the text-to-speech system. "
            # "Each sentence should trigger a separate TTS request. "
            # "Let's see how fast the first audio byte arrives!"
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
            "name": "Inworld WS",
            "create_fn": create_inworld_tts,
            "api_key_env": "INWORLD_API_KEY",
        },
        "elevenlabs": {
            "name": "ElevenLabs WS",
            "create_fn": create_elevenlabs_tts,
            "api_key_env": "ELEVEN_API_KEY",
        },
        "cartesia": {
            "name": "Cartesia WS",
            "create_fn": create_cartesia_tts,
            "api_key_env": "CARTESIA_API_KEY",
        },
    }

    # Check API keys and filter available services
    available_services = []
    for service_id in services_to_run:
        if service_id not in service_configs:
            print(f"⚠️  Unknown service: {service_id}")
            continue

        config = service_configs[service_id]
        api_key = os.getenv(config["api_key_env"])

        if not api_key:
            print(f"⚠️  {config['name']}: {config['api_key_env']} not set, skipping")
            continue

        available_services.append((service_id, config, api_key))

    if not available_services:
        print("No services available to benchmark. Please set the required API keys:")
        print("  - INWORLD_API_KEY for Inworld")
        print("  - ELEVEN_API_KEY for ElevenLabs")
        print("  - CARTESIA_API_KEY for Cartesia")
        return

    print(
        f"\n🚀 Benchmarking {len(available_services)} WebSocket TTS service(s): "
        f"{', '.join(c[1]['name'] for c in available_services)}"
    )
    print(f"📝 Text: {text[:50]}..." if len(text) > 50 else f"📝 Text: {text}")
    print(f"⏱️  Token delay: {args.token_delay}ms")
    print(f"🔄 Iterations: {args.iterations}")
    print()

    all_results: Dict[str, List[Dict]] = {sid: [] for sid, _, _ in available_services}

    for iteration in range(args.iterations):
        if args.iterations > 1:
            print(f"\n{'=' * 60}")
            print(f"ITERATION {iteration + 1} of {args.iterations}")
            print(f"{'=' * 60}")
        else:
            print(f"\rProgress: running...", end="", flush=True)

        for service_id, config, api_key in available_services:
            try:
                result = await run_service_benchmark(
                    service_name=config["name"],
                    create_tts_fn=config["create_fn"],
                    api_key=api_key,
                    text=text,
                    token_delay_ms=args.token_delay,
                    save_audio=not args.no_save_audio and iteration == 0,
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
                        "audio_bytes": 0,
                        "error": str(e),
                    }
                )

            # Small delay between services
            await asyncio.sleep(1.0)

        # Small delay between iterations
        if iteration < args.iterations - 1:
            await asyncio.sleep(2.0)

    if args.iterations == 1:
        print()  # New line after progress

    # Aggregate results across iterations
    aggregated_results = []
    for service_id, results_list in all_results.items():
        all_ttfb: List[float] = []
        wall_clock_ttfbs: List[float] = []
        for r in results_list:
            all_ttfb.extend(r["ttfb_values"])
            wc = r.get("wall_clock_ttfb")
            if wc is not None:
                wall_clock_ttfbs.append(wc)

        if all_ttfb:
            aggregated_results.append(
                {
                    "service": results_list[0]["service"],
                    "ttfb_count": len(all_ttfb),
                    "ttfb_avg": sum(all_ttfb) / len(all_ttfb),
                    "ttfb_min": min(all_ttfb),
                    "ttfb_max": max(all_ttfb),
                    "ttfb_values": all_ttfb,
                    "wall_clock_ttfb_avg": (
                        sum(wall_clock_ttfbs) / len(wall_clock_ttfbs)
                        if wall_clock_ttfbs
                        else None
                    ),
                }
            )
        else:
            aggregated_results.append(
                {
                    "service": service_configs[service_id]["name"],
                    "ttfb_count": 0,
                    "ttfb_avg": None,
                    "ttfb_min": None,
                    "ttfb_max": None,
                    "ttfb_values": [],
                    "wall_clock_ttfb_avg": None,
                }
            )

    print_comparison_table(aggregated_results)

    # Print aggregate stats if multiple iterations
    if args.iterations > 1:
        print("\n" + "=" * 80)
        print(f"AGGREGATE STATISTICS ({args.iterations} iterations)")
        print("=" * 80)
        for r in sorted(
            aggregated_results, key=lambda x: x.get("ttfb_avg") or float("inf")
        ):
            if r["ttfb_avg"] is not None:
                mean = r["ttfb_avg"]
                variance = sum((x - mean) ** 2 for x in r["ttfb_values"]) / len(
                    r["ttfb_values"]
                )
                std_dev = variance**0.5
                print(f"\n{r['service']}:")
                print(f"  Total samples:     {r['ttfb_count']}")
                print(f"  Avg provider TTFB: {r['ttfb_avg']:.3f}s")
                print(f"  Min provider TTFB: {r['ttfb_min']:.3f}s")
                print(f"  Max provider TTFB: {r['ttfb_max']:.3f}s")
                print(f"  Std Dev:           {std_dev:.3f}s")
                wc = r.get("wall_clock_ttfb_avg")
                if wc is not None:
                    print(f"  Avg wall-clock:    {wc:.3f}s (includes token delay)")


if __name__ == "__main__":
    asyncio.run(main())
