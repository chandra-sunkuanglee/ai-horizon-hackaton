"""Teleprompter + voice recorder for the demo narration.

Run in your own terminal (not through Claude Code), from the project folder:
    .venv\\Scripts\\python demo\\record_voice.py            record every scene not yet recorded
    .venv\\Scripts\\python demo\\record_voice.py s05_click  re-record just that scene
    .venv\\Scripts\\python demo\\record_voice.py --all      re-record everything
    .venv\\Scripts\\python demo\\record_voice.py --list     show microphones

For each scene: press Enter, read the text, press Enter again. Then keep it, play it back, or redo it.
Recordings go to demo/voice/<scene>.wav.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import textwrap
import time
from pathlib import Path

import numpy as np
import sounddevice as sd
import soundfile as sf

HERE = Path(__file__).resolve().parent
VOICE = HERE / "voice"
RATE = 48_000


def clear() -> None:
    os.system("cls" if os.name == "nt" else "clear")


def record() -> np.ndarray:
    chunks: list[np.ndarray] = []

    def cb(indata, frames, t, status):  # noqa: ARG001
        chunks.append(indata.copy())

    with sd.InputStream(samplerate=RATE, channels=1, dtype="float32", callback=cb):
        start = time.time()
        input("  \033[91m● RECORDING\033[0m  read the text, then press Enter to stop ")
        took = time.time() - start
    audio = np.concatenate(chunks)[:, 0] if chunks else np.zeros(0, dtype="float32")
    print(f"  recorded {took:.1f}s")
    return audio


def level_report(audio: np.ndarray) -> str:
    if not len(audio):
        return "  \033[93m(nothing recorded)\033[0m"
    peak = float(np.max(np.abs(audio)))
    db = 20 * np.log10(peak + 1e-9)
    if peak >= 0.99:
        return f"  \033[93mpeak {db:.0f} dBFS - clipping; move back a little from the mic\033[0m"
    if db < -30:
        return f"  \033[93mpeak {db:.0f} dBFS - very quiet; speak up or move closer\033[0m"
    return f"  level OK (peak {db:.0f} dBFS)"


def do_scene(i: int, n: int, scene: dict) -> bool:
    """Returns False if the user quits."""
    width = min(shutil.get_terminal_size((100, 20)).columns - 4, 96)
    while True:
        clear()
        print(f"\n  Scene {i}/{n}  ·  {scene['title']}  ({scene['id']})\n")
        for line in textwrap.wrap(scene["text"], width - 4):
            print(f"    \033[1m{line}\033[0m")
        print("\n  Tips: read at a relaxed pace, pause 1 second before you start and after you finish.\n")
        cmd = input("  Press Enter to START recording (s = skip, q = quit) ").strip().lower()
        if cmd == "q":
            return False
        if cmd == "s":
            return True
        audio = record()
        print(level_report(audio))
        while True:
            cmd = input("  [Enter] keep and continue   [p] play back   [r] redo   [q] quit: ").strip().lower()
            if cmd == "p":
                sd.play(audio, RATE)
                sd.wait()
                continue
            if cmd == "r":
                break
            if cmd == "q":
                return False
            VOICE.mkdir(exist_ok=True)
            sf.write(VOICE / f"{scene['id']}.wav", audio, RATE, subtype="PCM_16")
            return True


def main() -> None:
    args = sys.argv[1:]
    if "--list" in args:
        print(sd.query_devices())
        print(f"\nDefault input: {sd.query_devices(kind='input')['name']}")
        return
    scenes = json.loads((HERE / "narration.json").read_text(encoding="utf-8"))
    ids = [a for a in args if not a.startswith("--")]
    if ids:
        todo = [s for s in scenes if s["id"] in ids]
    elif "--all" in args:
        todo = scenes
    else:
        todo = [s for s in scenes if not (VOICE / f"{s['id']}.wav").exists()]
    if not todo:
        print("Every scene is already recorded. Pass a scene id (e.g. s05_click) or --all to redo.")
        return
    print(f"Microphone: {sd.query_devices(kind='input')['name']}")
    input(f"{len(todo)} scene(s) to record. Press Enter to begin... ")
    for i, scene in enumerate(todo, start=1):
        if not do_scene(i, len(todo), scene):
            break
    done = sorted(p.stem for p in VOICE.glob("*.wav")) if VOICE.exists() else []
    missing = [s["id"] for s in scenes if s["id"] not in done]
    clear()
    print(f"\nRecorded {len(done)}/{len(scenes)} scenes in {VOICE}")
    if missing:
        print("Still missing: " + ", ".join(missing))
    else:
        print("All scenes recorded. Tell Claude you're done.")


if __name__ == "__main__":
    main()
