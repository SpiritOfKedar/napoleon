"""Windowing and streaming tests. ffmpeg and Whisper are faked, so these run anywhere."""
import json
import os

os.environ["PRELOAD_MODELS"] = "false"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import main, pipeline  # noqa: E402


class FakeTranscriber:
    """Every window has one segment every 10 s of its own audio (window-relative timestamps)."""

    audio_format = "wav"

    def __init__(self, window_sec, seg_len=10.0, language="en"):
        self.window_sec = window_sec
        self.seg_len = seg_len
        self.language = language
        self.calls = []  # (start, length, language passed in)

    def transcribe(self, path, language=None):
        start, length = self._pending
        self.calls.append((start, length, language))
        segs = []
        t = 0.0
        while t + 1 < length:
            segs.append({"start_sec": t, "end_sec": min(t + self.seg_len, length), "text": f"at {start + t:.0f}"})
            t += self.seg_len
        return iter(segs), self.language


@pytest.fixture
def fake(monkeypatch, tmp_path):
    def make(window_sec, **kw):
        tr = FakeTranscriber(window_sec, **kw)

        def fake_extract(src, out, start_sec=None, length_sec=None, fmt="wav", bitrate="32k"):
            tr._pending = (start_sec or 0.0, length_sec)
            open(out, "wb").close()

        monkeypatch.setattr(pipeline, "extract_audio", fake_extract)
        return tr

    return make


def run(tr, duration, start=0.0, tmp="."):
    state = {}
    segs = list(pipeline.transcribe_windows("in.mp4", duration, start, tr, str(tmp), state))
    return segs, state


def test_single_window_keeps_all_segments(fake, tmp_path):
    tr = fake(window_sec=1800)
    segs, state = run(tr, 60.0, tmp=tmp_path)
    assert [s["start_sec"] for s in segs] == [0, 10, 20, 30, 40, 50]
    assert state["language"] == "en"
    assert len(tr.calls) == 1


def test_windows_shift_timestamps_and_restart_at_cut_segment(fake, tmp_path):
    # 25 s windows over 60 s: the segment at 20-25 s touches the boundary, so it is dropped and
    # the next window starts at 20 s instead of 25 s.
    tr = fake(window_sec=25)
    segs, _ = run(tr, 60.0, tmp=tmp_path)
    starts = [s["start_sec"] for s in segs]
    assert starts == sorted(starts)
    assert len(starts) == len(set(starts)), "no duplicated segments across windows"
    assert [c[0] for c in tr.calls] == [0.0, 20.0, 40.0]
    assert segs[-1]["end_sec"] <= 60.0
    # Later windows reuse the detected language.
    assert [c[2] for c in tr.calls] == [None, "en", "en"]


def test_start_offset_resumes_with_absolute_timestamps(fake, tmp_path):
    tr = fake(window_sec=1800)
    segs, _ = run(tr, 100.0, start=70.0, tmp=tmp_path)
    assert tr.calls[0][:2] == (70.0, 30.0)
    assert [s["start_sec"] for s in segs] == [70.0, 80.0, 90.0]


def test_offset_past_end_transcribes_nothing(fake, tmp_path):
    tr = fake(window_sec=1800)
    segs, _ = run(tr, 100.0, start=100.0, tmp=tmp_path)
    assert segs == [] and tr.calls == []


def test_unknown_duration_uses_one_pass(fake, tmp_path):
    tr = fake(window_sec=25)
    tr._pending = None
    # length None means the fake produces no segments, but it must be called exactly once.
    tr.transcribe = lambda path, language=None: (tr.calls.append(tr._pending) or iter([]), None)
    run(tr, None, tmp=tmp_path)
    assert tr.calls == [(0.0, None)]


def test_stream_endpoint_emits_meta_segments_done(fake, monkeypatch, tmp_path):
    media = tmp_path / "media"
    media.mkdir()
    (media / "abc.mp4").write_bytes(b"x")
    work = tmp_path / "work"
    work.mkdir()
    monkeypatch.setattr(main, "settings", main.settings.__class__(media_root=str(media), work_dir=str(work)))
    monkeypatch.setattr(main, "probe_duration", lambda p: 30.0)
    monkeypatch.setattr(main, "transcriber", fake(window_sec=1800))

    with TestClient(main.app) as client:
        resp = client.post("/transcribe/stream", json={"path": "abc.mp4", "start_offset_sec": 0})
    assert resp.status_code == 200
    lines = [json.loads(line) for line in resp.text.splitlines() if line]
    assert lines[0] == {"type": "meta", "duration_sec": 30.0}
    assert [ln["type"] for ln in lines[1:]] == ["segment", "segment", "segment", "done"]
    assert lines[-1]["language"] == "en"


def test_stream_endpoint_reports_decode_errors_in_stream(monkeypatch, tmp_path):
    media = tmp_path / "media"
    media.mkdir()
    (media / "bad.mp4").write_bytes(b"x")
    monkeypatch.setattr(main, "settings", main.settings.__class__(media_root=str(media), work_dir=str(tmp_path)))
    monkeypatch.setattr(main, "probe_duration", lambda p: 10.0)

    def boom(*a, **kw):
        raise main.MediaDecodeError("Invalid data found when processing input")

    monkeypatch.setattr(pipeline, "extract_audio", boom)
    with TestClient(main.app) as client:
        resp = client.post("/transcribe/stream", json={"path": "bad.mp4"})
    last = json.loads(resp.text.splitlines()[-1])
    assert last["type"] == "error" and "Could not decode media" in last["detail"]


@pytest.mark.parametrize("path, status", [("../etc/passwd", 400), ("missing.mp4", 404)])
def test_stream_endpoint_rejects_bad_paths(monkeypatch, tmp_path, path, status):
    monkeypatch.setattr(main, "settings", main.settings.__class__(media_root=str(tmp_path), work_dir=str(tmp_path)))
    with TestClient(main.app) as client:
        assert client.post("/transcribe/stream", json={"path": path}).status_code == status


def seg(start, end, text):
    return {"start_sec": start, "end_sec": end, "text": text}


def test_merge_joins_fragments_into_sentences():
    raw = [seg(0, 1.2, "I was like"), seg(1.2, 2.5, "a very nerdy"), seg(2.5, 4.0, "kid."),
           seg(4.1, 5.0, "Um"), seg(5.0, 7.5, "and then it changed?")]
    out = list(pipeline.merge_segments(raw, min_sec=3, max_sec=15, max_gap_sec=1.5))
    assert [s["text"] for s in out] == ["I was like a very nerdy kid.", "Um and then it changed?"]
    assert (out[0]["start_sec"], out[0]["end_sec"]) == (0, 4.0)


def test_merge_splits_on_long_pause_and_max_length():
    raw = [seg(0, 2, "one"), seg(10, 12, "two"), seg(12, 20, "three"), seg(20, 28, "four")]
    out = list(pipeline.merge_segments(raw, min_sec=3, max_sec=15, max_gap_sec=1.5))
    assert [s["text"] for s in out] == ["one", "two three", "four"]


def test_merge_short_sentence_keeps_growing_until_min_length():
    # "Yes." alone is under min_sec, so it is joined with what follows.
    raw = [seg(0, 0.8, "Yes."), seg(0.8, 4.0, "That is right.")]
    out = list(pipeline.merge_segments(raw, min_sec=3, max_sec=15, max_gap_sec=1.5))
    assert [s["text"] for s in out] == ["Yes. That is right."]
