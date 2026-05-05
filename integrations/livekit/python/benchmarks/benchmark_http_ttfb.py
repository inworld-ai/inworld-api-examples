"""Benchmark HTTP TTS TTFB across providers using LiveKit synthesize() API.

For each sentence in the input text, calls synthesize() and measures
the time to first audio frame (TTFB) via the built-in metrics system.
"""

import asyncio
import logging
import os
import struct
from pathlib import Path
from typing import Dict, List

import aiohttp
from dotenv import load_dotenv

_benchmarks_dir = Path(__file__).parent
load_dotenv(dotenv_path=_benchmarks_dir / ".env", override=True)
load_dotenv(override=True)

logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("benchmark")

DEFAULT_SENTENCES = [
    "Hello! Welcome to the TTS benchmark.",
    "This is a test of the text-to-speech system.",
    "Each sentence should trigger a separate TTS request.",
    "Let's see how fast the first audio byte arrives!",
    "The quick brown fox jumps over the lazy dog.",
]


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


INWORLD_MODEL = "inworld-tts-1.5-mini"
ELEVENLABS_MODEL = "eleven_turbo_v2_5"
CARTESIA_MODEL = "sonic-3"


def create_inworld_tts(session: aiohttp.ClientSession, api_key: str):
    from livekit.plugins import inworld
    return inworld.TTS(
        api_key=api_key, voice="Ashley", model=INWORLD_MODEL,
        http_session=session, base_url="https://api.inworld.ai/",
    )


def create_elevenlabs_tts(session: aiohttp.ClientSession, api_key: str):
    from livekit.plugins import elevenlabs
    return elevenlabs.TTS(
        api_key=api_key, voice_id="hpp4J3VqNfWAUOO0d1Us",
        model=ELEVENLABS_MODEL, http_session=session,
    )


def create_cartesia_tts(session: aiohttp.ClientSession, api_key: str):
    from livekit.plugins import cartesia
    return cartesia.TTS(
        api_key=api_key, voice="79a125e8-cd45-4c13-8a67-188112f4dd22",
        model=CARTESIA_MODEL, http_session=session,
    )


def create_minimax_tts(session: aiohttp.ClientSession, api_key: str):
    from livekit.plugins import minimax
    return minimax.TTS(
        api_key=api_key, voice="English_expressive_narrator",
        model="speech-2.8-turbo", http_session=session,
    )


async def benchmark_one_sentence(
    tts, sentence: str, service_name: str,
    save_audio: bool = False, output_dir: str = "benchmark_audio",
) -> Dict:
    """Benchmark one synthesize() call, return TTFB."""
    from livekit.agents.metrics import TTSMetrics

    ttfb_value: float | None = None
    all_audio = bytearray()
    sample_rate = tts.sample_rate

    def _on_metrics(metrics: TTSMetrics) -> None:
        nonlocal ttfb_value
        if metrics.ttfb > 0.01:
            ttfb_value = metrics.ttfb
            logger.debug("[%s] TTFB: %.3fs", service_name, metrics.ttfb)

    tts.on("metrics_collected", _on_metrics)
    try:
        async with tts.synthesize(sentence) as stream:
            async for audio in stream:
                all_audio.extend(audio.frame.data.tobytes())
        await asyncio.sleep(0.1)

        if save_audio and all_audio:
            safe_name = service_name.lower().replace(" ", "_")
            save_wav(bytes(all_audio), f"{safe_name}_http.wav", sample_rate, output_dir)
    finally:
        tts.off("metrics_collected", _on_metrics)

    return {"ttfb": ttfb_value, "audio_bytes": len(all_audio)}


def _fmt(val, suffix="s"):
    return f"{val:.3f}{suffix}" if val is not None else "N/A"


def print_results(results: List[Dict], title: str):
    w = 95
    print(f"\n{'=' * w}")
    print(title)
    print("=" * w)

    print(f"\n📊 TTFB")
    print(f"{'Service':<25} {'Avg':>8} {'StdDev':>8} {'Min':>8} "
          f"{'Max':>8} {'P50':>8} {'P95':>8} {'N':>5}")
    print("-" * w)

    sorted_r = sorted(results, key=lambda x: x["ttfb"].get("avg") or float("inf"))
    for r in sorted_r:
        s = r["ttfb"]
        if s["count"] > 0:
            print(f"{r['service']:<25} {_fmt(s['avg']):>8} {_fmt(s['std']):>8} "
                  f"{_fmt(s['min']):>8} {_fmt(s['max']):>8} "
                  f"{_fmt(s['p50']):>8} {_fmt(s['p95']):>8} {s['count']:>5}")
        else:
            print(f"{r['service']:<25} {'N/A':>8} {'N/A':>8} {'N/A':>8} "
                  f"{'N/A':>8} {'N/A':>8} {'N/A':>8} {'0':>5}")


    print(f"\n{'=' * w}")


async def main():
    import argparse

    parser = argparse.ArgumentParser(description="Benchmark HTTP TTS TTFB (LiveKit Python)")
    parser.add_argument("--text", type=str, default=None, help="Custom text to synthesize")
    parser.add_argument("-n", "--iterations", type=int, default=5,
                        help="Number of benchmark iterations (default: 5)")
    parser.add_argument("--services", type=str, default="all",
                        help="Comma-separated services: inworld,elevenlabs,cartesia,minimax or 'all'")
    parser.add_argument("--no-save-audio", action="store_true", help="Disable saving audio files")
    parser.add_argument("--debug", action="store_true", help="Enable debug logging")
    parser.add_argument("--warmup", type=int, default=1,
                        help="Warmup iterations before timing (default: 1)")
    args = parser.parse_args()

    if args.debug:
        logging.basicConfig(level=logging.DEBUG, force=True)

    sentences = [args.text] if args.text else DEFAULT_SENTENCES

    services_to_run = (
        ["inworld", "elevenlabs", "cartesia", "minimax"]
        if args.services.lower() == "all"
        else [s.strip().lower() for s in args.services.split(",")]
    )

    service_configs = {
        "inworld": {"name": f"Inworld {INWORLD_MODEL}", "create_fn": create_inworld_tts,
                     "api_key_env": "INWORLD_API_KEY"},
        "elevenlabs": {"name": f"ElevenLabs {ELEVENLABS_MODEL}", "create_fn": create_elevenlabs_tts,
                       "api_key_env": "ELEVEN_API_KEY"},
        "cartesia": {"name": f"Cartesia {CARTESIA_MODEL}", "create_fn": create_cartesia_tts,
                     "api_key_env": "CARTESIA_API_KEY"},
        "minimax": {"name": "MiniMax HTTP", "create_fn": create_minimax_tts,
                    "api_key_env": "MINIMAX_API_KEY"},
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
        print("No services available. Set INWORLD_API_KEY, ELEVEN_API_KEY, "
              "CARTESIA_API_KEY, or MINIMAX_API_KEY.")
        return

    print(f"\n🚀 Benchmarking {len(available)} service(s): {', '.join(c[1]['name'] for c in available)}")
    print(f"📝 Sentences: {len(sentences)} (cycling per iteration)")
    print(f"🔄 Iterations: {args.iterations} (+ {args.warmup} warmup)\n")

    session = aiohttp.ClientSession()
    tts_instances: Dict[str, object] = {}
    for sid, cfg, api_key in available:
        tts_instances[sid] = cfg["create_fn"](session=session, api_key=api_key)

    total_iters = args.warmup + args.iterations

    async def _bench_service(sid, cfg, api_key):
        ttfb_vals = []
        for iteration in range(total_iters):
            is_warmup = iteration < args.warmup
            label = f"warmup {iteration + 1}/{args.warmup}" if is_warmup else \
                    f"{iteration - args.warmup + 1}/{args.iterations}"
            print(f"[{cfg['name']}] {'⏳' if is_warmup else '📊'} {label}", flush=True)

            sentence = sentences[iteration % len(sentences)]

            try:
                result = await benchmark_one_sentence(
                    tts=tts_instances[sid], sentence=sentence,
                    service_name=cfg["name"],
                    save_audio=not args.no_save_audio and iteration == args.warmup,
                )
                if not is_warmup and result["ttfb"] is not None:
                    ttfb_vals.append(result["ttfb"])
                if result["audio_bytes"] == 0:
                    print(f"[{cfg['name']}] ⚠️ No audio received!")
            except Exception as e:
                print(f"[{cfg['name']}] ❌ {e}")

            await asyncio.sleep(1.0)
        return {"service": cfg["name"], "ttfb": compute_stats(ttfb_vals)}

    try:
        aggregated = await asyncio.gather(*[
            _bench_service(sid, cfg, api_key) for sid, cfg, api_key in available
        ])
    finally:
        for tts_inst in tts_instances.values():
            await tts_inst.aclose()
        await session.close()

    print()

    print_results(aggregated, "HTTP TTS BENCHMARK RESULTS (LiveKit Python)")


if __name__ == "__main__":
    asyncio.run(main())
