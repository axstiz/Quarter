"""Провайдер-агностичный LLM-клиент (change 027).

Провайдер выбирается настройкой POSTCODE_LLM_PROVIDER (gigachat|ollama|none).
Недоступность провайдера = LLMUnavailable → потребители уходят в шаблонный режим/
fallback-советы (спека onboarding).
"""
from __future__ import annotations

import os

import httpx

from src.core.config import settings


class LLMUnavailable(Exception):
    """Провайдер не задан или недоступен — деградация без hard-fail."""


# совместимость со старыми импортами (change 007/015)
GigaUnavailable = LLMUnavailable


class OllamaClient:
    """Локальный LLM через OpenAI-совместимый endpoint Ollama (/v1/chat/completions)."""

    def __init__(self, base_url: str | None = None, model: str | None = None, timeout: float = 120.0):
        self._base_url = (base_url or settings.ollama_base_url).rstrip("/")
        self._model = model or settings.ollama_model
        self._timeout = timeout
        self._http: httpx.Client | None = None

    @property
    def enabled(self) -> bool:
        return True

    def complete(self, system: str, user: str, temperature: float = 0.0) -> str:
        if self._http is None:
            self._http = httpx.Client(base_url=self._base_url, timeout=self._timeout)
        try:
            resp = self._http.post("/v1/chat/completions", json={
                "model": self._model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "temperature": temperature,
                "stream": False,
            })
            resp.raise_for_status()
        except Exception as e:
            raise LLMUnavailable(f"ollama недоступен: {e}") from e
        return resp.json()["choices"][0]["message"]["content"]


class _DisabledClient:
    """llm_provider=none: LLM отключён, потребители сразу в fallback."""

    enabled = False

    def complete(self, system: str, user: str, temperature: float = 0.0) -> str:
        raise LLMUnavailable("llm_provider=none")


_CLIENT = None


def get_client():
    """Синглтон провайдера по settings.llm_provider (gigachat|ollama|none)."""
    global _CLIENT
    if _CLIENT is None:
        provider = settings.llm_provider
        if provider == "ollama":
            _CLIENT = OllamaClient()
        elif provider == "none":
            _CLIENT = _DisabledClient()
        else:
            from src.ai.gigachat import GigaChatClient

            _CLIENT = GigaChatClient(
                client_id=os.environ.get("GIGACHAT_CLIENT_ID"),
                base_url=os.environ.get("GIGACHAT_BASE_URL"),
            )
    return _CLIENT
