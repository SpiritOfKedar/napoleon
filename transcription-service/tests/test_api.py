"""API tests with the heavy models stubbed out. Run: PRELOAD_MODELS=false pytest"""
import os
import shutil

os.environ["PRELOAD_MODELS"] = "false"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import main  # noqa: E402


class FakeEmbedder:
    def embed(self, texts, kind="passage"):
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


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg (runs in the service image)")
def test_transcribe_rejects_non_media_file():
    with TestClient(main.app) as client:
        resp = client.post("/transcribe", files={"file": ("notes.mp3", b"definitely not audio", "audio/mpeg")})
    assert resp.status_code == 422


def test_embed_passes_query_kind(monkeypatch):
    seen = {}

    class Recorder:
        def embed(self, texts, kind="passage"):
            seen["kind"] = kind
            return [[0.0, 1.0] for _ in texts]

    monkeypatch.setattr(main, "embedder", Recorder())
    with TestClient(main.app) as client:
        assert client.post("/embed", json={"texts": ["q"], "kind": "query"}).status_code == 200
        assert client.post("/embed", json={"texts": ["q"], "kind": "nonsense"}).status_code == 422
    assert seen["kind"] == "query"


def test_embedder_applies_e5_prefixes(monkeypatch):
    from app import embedder as emb

    class FakeST:
        def __init__(self):
            self.inputs = None

        def encode(self, inputs, **kw):
            import numpy as np
            self.inputs = inputs
            return np.zeros((len(inputs), 2))

    e = emb.Embedder()
    fake = FakeST()
    e._model = fake
    e.embed(["hello"], "query")
    assert fake.inputs == ["query: hello"]
    e.embed(["hello"], "passage")
    assert fake.inputs == ["passage: hello"]


def test_rerank_returns_scores_in_unit_range(monkeypatch):
    from app import embedder as emb

    class FakeCE:
        def predict(self, pairs, **kw):
            return [3.0, -2.0][: len(pairs)]  # raw logits

    r = emb.Reranker()
    r._model = FakeCE()
    monkeypatch.setattr(main, "reranker", r)
    with TestClient(main.app) as client:
        resp = client.post("/rerank", json={"query": "elon", "texts": ["about elon", "weather"]})
    scores = resp.json()["scores"]
    assert resp.status_code == 200
    assert scores[0] > 0.9 and scores[1] < 0.2


def test_hosted_language_names_become_codes():
    from app.transcriber import _language_code

    assert _language_code("english") == "en"
    assert _language_code("Tamil") == "ta"
    assert _language_code("en") == "en"
    assert _language_code(None) is None
