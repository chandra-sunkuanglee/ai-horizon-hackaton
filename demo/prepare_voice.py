"""Clean up the recorded narration: demo/voice/*.wav -> demo/audio/*.wav + durations.json.

Removes low rumble, lightly denoises, trims silence at both ends, and normalizes loudness
so every scene sounds the same. Run after record_voice.py, before record.js.
"""
from __future__ import annotations

import json
import subprocess
import wave
from pathlib import Path

import imageio_ffmpeg

HERE = Path(__file__).resolve().parent
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

TRIM = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15"
CHAIN = ",".join(
    [
        "highpass=f=80",
        "afftdn=nf=-45",
        TRIM,
        "areverse",
        TRIM,
        "areverse",
        # Shorten long pauses inside the speech to 0.5 s (keeps the video under 5 minutes).
        "silenceremove=stop_periods=-1:stop_duration=0.7:stop_threshold=-45dB:stop_silence=0.5",
        "loudnorm=I=-16:TP=-1.5:LRA=11",
        "aresample=48000",
    ]
)


def main() -> None:
    scenes = json.loads((HERE / "narration.json").read_text(encoding="utf-8"))
    out_dir = HERE / "audio"
    out_dir.mkdir(exist_ok=True)
    durations = {}
    for s in scenes:
        src = HERE / "voice" / f"{s['id']}.wav"
        dst = out_dir / f"{s['id']}.wav"
        subprocess.run(
            [FFMPEG, "-y", "-loglevel", "error", "-i", str(src), "-af", CHAIN, "-ac", "1", str(dst)], check=True
        )
        with wave.open(str(dst)) as w:
            durations[s["id"]] = round(w.getnframes() / w.getframerate(), 2)
        print(f"{s['id']:14} {durations[s['id']]:5.1f}s")
    (HERE / "durations.json").write_text(json.dumps(durations, indent=1))
    print(f"total {sum(durations.values()):.1f}s")


if __name__ == "__main__":
    main()
