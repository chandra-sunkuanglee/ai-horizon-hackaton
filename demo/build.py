"""Merge the recorded screen video with narration audio and burned-in captions.

Usage:  python demo/build.py            -> demo/demo_video.mp4 (narrated) + demo/demo_video_silent.mp4
Needs:  demo/timeline.json (from record.js), demo/audio/*.wav (from tts.ps1), imageio-ffmpeg
"""
from __future__ import annotations

import json
import re
import subprocess
import wave
from pathlib import Path

import imageio_ffmpeg

HERE = Path(__file__).resolve().parent
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
LEAD_TRIM = 1.0  # seconds cut from the start of the recording (static title card), to stay under 5:00


def wav_seconds(p: Path) -> float:
    with wave.open(str(p)) as w:
        return w.getnframes() / w.getframerate()


def srt_time(t: float) -> str:
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def chunks(text: str, max_len: int = 90) -> list[str]:
    """Split narration into caption-sized pieces at sentence/clause boundaries."""
    out: list[str] = []
    for sent in re.split(r"(?<=[.!?:])\s+", text.strip()):
        while len(sent) > max_len:
            cut = sent.rfind(", ", 0, max_len)
            cut = cut + 1 if cut > 30 else sent.rfind(" ", 0, max_len)
            out.append(sent[:cut].strip())
            sent = sent[cut:].strip()
        if sent:
            out.append(sent)
    return out


def main() -> None:
    timeline = json.loads((HERE / "timeline.json").read_text())
    narration = {n["id"]: n["text"] for n in json.loads((HERE / "narration.json").read_text(encoding="utf-8"))}
    video = Path(timeline["video"])
    scenes = [{**sc, "start": max(0.0, sc["start"] - LEAD_TRIM)} for sc in timeline["scenes"]]

    # Captions: spread each line's chunks across its audio, weighted by length.
    srt, idx = [], 1
    for sc in scenes:
        dur = wav_seconds(HERE / "audio" / f"{sc['id']}.wav")
        parts = chunks(narration[sc["id"]].replace("A.I.", "AI"))
        total = sum(len(p) for p in parts)
        t = sc["start"]
        for p in parts:
            d = dur * len(p) / total
            srt.append(f"{idx}\n{srt_time(t)} --> {srt_time(t + d)}\n{p}\n")
            idx, t = idx + 1, t + d
    srt_path = HERE / "captions.srt"
    srt_path.write_text("\n".join(srt), encoding="utf-8")

    # ffmpeg's subtitles filter wants a relative, escaped path; run from HERE.
    subs = ("subtitles=captions.srt:force_style='FontName=Segoe UI,FontSize=17,PrimaryColour=&H00FFFFFF,"
            "BackColour=&H99000000,BorderStyle=4,Outline=0,Shadow=0,MarginV=22'")
    vf = f"scale=1920:1080:flags=lanczos,{subs}"

    inputs = ["-ss", str(LEAD_TRIM), "-i", str(video)]
    delays = []
    for i, sc in enumerate(scenes, start=1):
        inputs += ["-i", str(HERE / "audio" / f"{sc['id']}.wav")]
        ms = int(sc["start"] * 1000) + 300
        delays.append(f"[{i}:a]aresample=48000,adelay={ms}|{ms}[a{i}]")
    mix = ";".join(delays) + ";" + "".join(f"[a{i}]" for i in range(1, len(scenes) + 1)) + \
        f"amix=inputs={len(scenes)}:normalize=0[aout]"

    common = ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30"]
    subprocess.run(
        [FFMPEG, "-y", *inputs, "-filter_complex", f"[0:v]{vf}[v];{mix}", "-map", "[v]", "-map", "[aout]",
         *common, "-c:a", "aac", "-b:a", "160k", "-shortest", "demo_video.mp4"],
        cwd=HERE, check=True,
    )
    subprocess.run(
        [FFMPEG, "-y", "-ss", str(LEAD_TRIM), "-i", str(video), "-vf", "scale=1920:1080:flags=lanczos", *common, "-an",
         "demo_video_silent.mp4"],
        cwd=HERE, check=True,
    )

    # A readable script with timestamps, for re-recording the voiceover yourself.
    lines = ["# Demo video script\n", "Timestamps match demo_video_silent.mp4.\n"]
    for sc in scenes:
        m, s = divmod(int(sc["start"]), 60)
        lines.append(f"\n**[{m}:{s:02}] {sc['id']}**\n\n{narration[sc['id']].replace('A.I.', 'AI')}\n")
    (HERE / "script.md").write_text("".join(lines), encoding="utf-8")
    print("wrote demo_video.mp4, demo_video_silent.mp4, captions.srt, script.md")


if __name__ == "__main__":
    main()
