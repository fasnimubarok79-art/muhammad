#!/usr/bin/env python3
"""Transcribe an audio file with faster-whisper and print JSON with word timestamps.

Usage: transcribe.py <audio.wav> <model name or directory> [language]
Progress goes to stderr as "PROGRESS <0-100>". Only JSON goes to stdout.
"""
import json
import os
import sys


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: transcribe.py <audio> <model> [language]", file=sys.stderr)
        return 2
    audio, model_ref = sys.argv[1], sys.argv[2]
    language = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None
    if not os.path.isfile(audio):
        print("audio file not found", file=sys.stderr)
        return 2

    import wave

    import numpy as np
    from faster_whisper import WhisperModel

    # Read 16 kHz mono PCM WAV (produced by ffmpeg in the worker) directly, so we do not depend
    # on PyAV's decoder API, which changes between releases.
    with wave.open(audio, "rb") as wf:
        if wf.getframerate() != 16000 or wf.getnchannels() != 1 or wf.getsampwidth() != 2:
            print("expected 16 kHz mono 16-bit WAV", file=sys.stderr)
            return 2
        pcm = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0

    local = os.path.isdir(model_ref)
    threads = int(os.environ.get("WHISPER_THREADS", "0")) or max(1, (os.cpu_count() or 2) - 1)
    model = WhisperModel(model_ref, device="cpu", compute_type="int8", cpu_threads=threads, local_files_only=local)
    segments, info = model.transcribe(
        pcm,
        language=language,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
        beam_size=5,
        condition_on_previous_text=False,
    )
    words, texts = [], []
    total = info.duration or 1.0
    last = -1
    for seg in segments:
        texts.append(seg.text.strip())
        for w in seg.words or []:
            words.append({"w": w.word.strip(), "s": round(w.start, 3), "e": round(w.end, 3), "p": round(w.probability, 3)})
        pct = int(min(100, seg.end / total * 100))
        if pct != last:
            print(f"PROGRESS {pct}", file=sys.stderr, flush=True)
            last = pct
    json.dump(
        {
            "language": info.language,
            "language_probability": round(info.language_probability, 3),
            "duration": round(info.duration, 3),
            "text": " ".join(t for t in texts if t),
            "words": [w for w in words if w["w"]],
            "engine": f"faster-whisper:{os.path.basename(model_ref.rstrip('/'))}",
        },
        sys.stdout,
        ensure_ascii=False,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
