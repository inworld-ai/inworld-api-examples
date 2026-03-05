"""
Benchmark script for measuring TTFB with HTTP-based TTS (synthesize API).

Compares TTFB across TTS providers using LiveKit's synthesize() API:
- Inworld (HTTP)
- ElevenLabs (HTTP)
- Cartesia (HTTP)

For each sentence in the input text, calls synthesize() and measures
the time to first audio frame (TTFB).

Usage:
    cd integrations/livekit/python/agents
    uv run python ../benchmarks/benchmark_http_ttfb.py --services inworld -n 5
    uv run python ../benchmarks/benchmark_http_ttfb.py --services all -n 20
"""

import asyncio
import logging
import os
import re
import struct
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


def split_sentences(text: str) -> List[str]:
    """Split text into sentences on punctuation boundaries."""
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    return [s for s in sentences if s.strip()]


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
    """Create an Inworld TTS instance (HTTP path uses LINEAR16 for clean PCM)."""
    from livekit.plugins import inworld

    return inworld.TTS(
        api_key=api_key,
        voice="Ashley",
        model="inworld-tts-1.5-max",
        encoding="LINEAR16",
        sample_rate=24000,
        http_session=session,
        timestamp_type="TIMESTAMP_TYPE_UNSPECIFIED",
    )


def create_elevenlabs_tts(session: aiohttp.ClientSession, api_key: str):
    """Create an ElevenLabs TTS instance."""
    from livekit.plugins import elevenlabs

    return elevenlabs.TTS(
        api_key=api_key,
        voice_id="21m00Tcm4TlvDq8ikWAM",  # Rachel voice
        model="eleven_turbo_v2_5",
        http_session=session,
    )


def create_cartesia_tts(session: aiohttp.ClientSession, api_key: str):
    """Create a Cartesia TTS instance."""
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


async def benchmark_synthesize(
    tts,
    text: str,
    service_name: str,
    save_audio: bool = False,
    output_dir: str = "benchmark_audio",
) -> Dict:
    """
    Benchmark synthesize() for a single text.

    Splits the text into sentences and calls synthesize() for each,
    measuring TTFB per sentence via the built-in metrics system (same
    approach used by the WebSocket benchmark for apples-to-apples comparison).
    """
    from livekit.agents.metrics import TTSMetrics

    sentences = split_sentences(text)
    ttfb_values: List[float] = []
    all_audio = bytearray()
    first_chunk_bytes: bytes | None = None
    sample_rate = tts.sample_rate

    # Collect TTFB from the built-in metrics system (fires once per
    # synthesize() call, measuring time from task start to first audio frame).
    def _on_metrics(metrics: TTSMetrics) -> None:
        if metrics.ttfb > 0.01:  # Filter spurious near-zero values
            ttfb_values.append(metrics.ttfb)

    tts.on("metrics_collected", _on_metrics)

    try:
        for sentence in sentences:
            async with tts.synthesize(sentence) as stream:
                async for audio in stream:
                    frame_data = audio.frame.data.tobytes()
                    all_audio.extend(frame_data)

                    if first_chunk_bytes is None:
                        first_chunk_bytes = frame_data

            # Allow a moment for metrics events to fire
            await asyncio.sleep(0.1)

        # Save audio files on request
        if save_audio and all_audio:
            safe_name = service_name.lower().replace(" ", "_")
            save_wav(bytes(all_audio), f"{safe_name}_http_full.wav", sample_rate, output_dir)
            if first_chunk_bytes:
                save_wav(
                    first_chunk_bytes,
                    f"{safe_name}_http_first_chunk.wav",
                    sample_rate,
                    output_dir,
                )
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
            "audio_bytes": len(all_audio),
        }

    return {
        "service": service_name,
        "ttfb_count": 0,
        "ttfb_avg": None,
        "ttfb_min": None,
        "ttfb_max": None,
        "ttfb_values": [],
        "audio_bytes": len(all_audio),
    }


async def run_service_benchmark(
    service_name: str,
    create_tts_fn,
    api_key: str,
    text: str,
    save_audio: bool = True,
    output_dir: str = "benchmark_audio",
) -> Dict:
    """Run the HTTP TTFB benchmark for a specific TTS service."""
    async with aiohttp.ClientSession() as session:
        tts = create_tts_fn(session=session, api_key=api_key)
        try:
            return await benchmark_synthesize(
                tts,
                text,
                service_name,
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
    print("\n" + "=" * 70)
    print("HTTP TTS BENCHMARK RESULTS (synthesize API)")
    print("=" * 70)

    print(f"{'Service':<20} {'Avg TTFB':<12} {'Min TTFB':<12} {'Max TTFB':<12} {'Samples':<10}")
    print("-" * 70)

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

    print("=" * 70)

    if sorted_results and sorted_results[0]["ttfb_avg"] is not None:
        winner = sorted_results[0]
        print(f"\n🏆 Fastest average TTFB: {winner['service']} ({winner['ttfb_avg']:.3f}s)")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


async def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Benchmark TTFB for HTTP-based TTS providers (LiveKit synthesize API)"
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
        help="Number of benchmark iterations (default: 20)",
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
    args = parser.parse_args()

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
            "create_fn": create_inworld_tts,
            "api_key_env": "INWORLD_API_KEY",
        },
        "elevenlabs": {
            "name": "ElevenLabs HTTP",
            "create_fn": create_elevenlabs_tts,
            "api_key_env": "ELEVEN_API_KEY",
        },
        "cartesia": {
            "name": "Cartesia HTTP",
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
        f"\n🚀 Benchmarking {len(available_services)} HTTP TTS service(s): "
        f"{', '.join(c[1]['name'] for c in available_services)}"
    )
    print(f"📝 Text: {text[:50]}..." if len(text) > 50 else f"📝 Text: {text}")
    print(f"🔄 Iterations: {args.iterations}")
    print()

    all_results: Dict[str, List[Dict]] = {sid: [] for sid, _, _ in available_services}

    for iteration in range(args.iterations):
        print(f"\rProgress: {iteration + 1}/{args.iterations}", end="", flush=True)

        for service_id, config, api_key in available_services:
            try:
                result = await run_service_benchmark(
                    service_name=config["name"],
                    create_tts_fn=config["create_fn"],
                    api_key=api_key,
                    text=text,
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
            await asyncio.sleep(0.5)

    print()  # New line after progress

    # Aggregate results across iterations
    aggregated_results = []
    for service_id, results_list in all_results.items():
        all_ttfb: List[float] = []
        for r in results_list:
            all_ttfb.extend(r["ttfb_values"])

        if all_ttfb:
            aggregated_results.append(
                {
                    "service": results_list[0]["service"],
                    "ttfb_count": len(all_ttfb),
                    "ttfb_avg": sum(all_ttfb) / len(all_ttfb),
                    "ttfb_min": min(all_ttfb),
                    "ttfb_max": max(all_ttfb),
                    "ttfb_values": all_ttfb,
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
                }
            )

    print_comparison_table(aggregated_results)

    # Print aggregate stats if multiple iterations
    if args.iterations > 1:
        print("\n" + "=" * 70)
        print(f"AGGREGATE STATISTICS ({args.iterations} iterations)")
        print("=" * 70)
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
                print(f"  Total samples: {r['ttfb_count']}")
                print(f"  Average TTFB:  {r['ttfb_avg']:.3f}s")
                print(f"  Min TTFB:      {r['ttfb_min']:.3f}s")
                print(f"  Max TTFB:      {r['ttfb_max']:.3f}s")
                print(f"  Std Dev:       {std_dev:.3f}s")


if __name__ == "__main__":
    asyncio.run(main())
