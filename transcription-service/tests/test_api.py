"""API tests with the heavy models stubbed out. Run: PRELOAD_MODELS=false pytest"""
import os

os.environ["PRELOAD_MODELS"] = "false"

from fastapi.testclient import TestClient  # noqa: E402

from app import main  # noqa: E402


class FakeEmbedder:
    def embed(self, texts):
        return [[float(len(t)), 0.0] for t in texts]


def test_health():
    with TestClient(main.app) as client:
        assert client.get("/health").json()["status"] == "ok"


def test_embed_returns_one_vector_per_text(monkeypatch):
    monkeypatch.setattr(main, "embedder", FakeEmbedder())
    with TestClient(main.app) as client:
        resp = client.post("/embed", json={"texts": ["a", "bbb"]})
    assert resp.status_code == 200
    assert resp.json()["vectors"] == [[1.0, 0.0], [3.0, 0.0]]


def test_embed_rejects_empty_list():
    with TestClient(main.app) as client:
        assert client.post("/embed", json={"texts": []}).status_code == 422


def test_transcribe_rejects_non_media_file():
    with TestClient(main.app) as client:
        resp = client.post("/transcribe", files={"file": ("notes.mp3", b"definitely not audio", "audio/mpeg")})
    assert resp.status_code == 422
