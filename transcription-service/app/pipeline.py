"""Transcribe a recording of any length one window at a time.

Each window is cut out with ffmpeg and transcribed on its own, so memory and temp-disk use are
bounded by the window size, not by the length of the recording. Timestamps are shifted back to
the position in the original file.

A window boundary can cut a sentence in half. When the last segment of a window ends right at the
boundary, it is dropped and the next window starts at that segment's start instead, so the
sentence is transcribed whole in the next window.
"""
import os
from collections.abc import Iterator

from .audio import extract_audio

# A segment ending this close to the end of a window is assumed to have been cut off.
EDGE_SEC = 1.0
# Treat a window ending this close to the end of the file as the last one.
END_EPSILON_SEC = 0.05


def _shift(segment: dict, offset: float) -> dict:
    return {
        "start_sec": round(segment["start_sec"] + offset, 3),
        "end_sec": round(segment["end_sec"] + offset, 3),
        "text": segment["text"],
    }


def transcribe_windows(src: str, duration: float | None, start_offset: float, transcriber,
                       workdir: str, state: dict, bitrate: str = "32k") -> Iterator[dict]:
    """Yields segments of src from start_offset onwards, with timestamps relative to src.

    Sets state["language"] to the language detected in the first window. Later windows reuse it,
    which keeps the transcript consistent and skips per-window detection.
    """
    window = transcriber.window_sec
    language = state.get("language")
    t = max(0.0, start_offset)
    path = os.path.join(workdir, f"window.{transcriber.audio_format}")

    while True:
        if duration is not None and t >= duration - END_EPSILON_SEC:
            return
        # Without a known duration there is no way to window, so take the whole file in one go.
        length = None if duration is None else min(window, duration - t)
        is_last = length is None or t + length >= duration - END_EPSILON_SEC

        extract_audio(src, path, start_sec=t, length_sec=length, fmt=transcriber.audio_format, bitrate=bitrate)
        segments, detected = transcriber.transcribe(path, language)
        if language is None and detected:
            language = detected
            state["language"] = detected

        # Hold back one segment: only once the window is finished do we know whether the last one
        # was cut off by the boundary.
        held = None
        count = 0
        for seg in segments:
            if held is not None:
                yield _shift(held, t)
            held = seg
            count += 1

        next_t = None if length is None else t + length
        if held is not None:
            cut_off = (not is_last and count > 1
                       and held["end_sec"] >= length - EDGE_SEC
                       and held["start_sec"] > EDGE_SEC)  # guarantees the next window moves forward
            if cut_off:
                next_t = t + held["start_sec"]
            else:
                yield _shift(held, t)

        try:
            os.remove(path)
        except OSError:
            pass
        if is_last:
            return
        t = next_t
