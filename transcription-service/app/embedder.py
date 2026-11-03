"""Sentence embeddings and cross-encoder reranking. Vectors are L2-normalised so cosine distance
is well-behaved."""
import math
import threading

from .config import settings


class Embedder:
    def __init__(self) -> None:
        self._model = None
        self._lock = threading.Lock()

    def load(self):
        with self._lock:
            if self._model is None:
                from sentence_transformers import SentenceTransformer

                model = SentenceTransformer(settings.embedding_model, device="cpu")
                actual = model.get_sentence_embedding_dimension()
                # The DB column is vector(EMBEDDING_DIM); a mismatch would only fail at insert time,
                # so refuse to start instead.
                if actual != settings.embedding_dim:
                    raise RuntimeError(
                        f"EMBEDDING_MODEL '{settings.embedding_model}' produces {actual}-dim vectors "
                        f"but EMBEDDING_DIM={settings.embedding_dim}"
                    )
                self._model = model
        return self._model

    def embed(self, texts: list[str], kind: str = "passage") -> list[list[float]]:
        """kind is "query" (a search query) or "passage" (transcript text). Asymmetric models such
        as e5 are trained with a different prefix for each."""
        model = self.load()
        prefix = settings.embed_query_prefix if kind == "query" else settings.embed_passage_prefix
        inputs = [prefix + t for t in texts] if prefix else texts
        vectors = model.encode(inputs, batch_size=32, normalize_embeddings=True, convert_to_numpy=True)
        return vectors.tolist()


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x)) if x >= 0 else math.exp(x) / (1.0 + math.exp(x))


class Reranker:
    def __init__(self) -> None:
        self._model = None
        self._lock = threading.Lock()

    @property
    def enabled(self) -> bool:
        return bool(settings.rerank_model)

    def load(self):
        if not self.enabled:
            return None
        with self._lock:
            if self._model is None:
                from sentence_transformers import CrossEncoder

                self._model = CrossEncoder(settings.rerank_model, max_length=settings.rerank_max_length,
                                           device="cpu")
        return self._model

    def score(self, query: str, texts: list[str]) -> list[float]:
        """Relevance of each text to the query, 0..1 (higher is better)."""
        model = self.load()
        raw = model.predict([(query, t) for t in texts], batch_size=32, show_progress_bar=False)
        values = [float(v) for v in raw]
        # Some sentence-transformers versions apply the sigmoid already, others return logits.
        if any(v < 0.0 or v > 1.0 for v in values):
            values = [_sigmoid(v) for v in values]
        return values
