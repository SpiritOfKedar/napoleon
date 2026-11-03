"""Sentence embeddings. Vectors are L2-normalised so cosine distance is well-behaved."""
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

    def embed(self, texts: list[str]) -> list[list[float]]:
        model = self.load()
        vectors = model.encode(texts, batch_size=32, normalize_embeddings=True, convert_to_numpy=True)
        return vectors.tolist()
