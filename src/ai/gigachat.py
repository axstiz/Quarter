"""Клиент GigaChat (Sber). Отсутствие ключей = деградация (см. спеку onboarding)."""
from __future__ import annotations

import os

from src.ai.llm import LLMUnavailable

# единый класс исключения с llm.py (change 026)
GigaUnavailable = LLMUnavailable


_CLIENT: "GigaChatClient | None" = None


class GigaChatClient:
    def __init__(self, client_id: str | None, base_url: str | None):
        self._client_id = client_id
        self._base_url = base_url or "https://gigachat.devices.sberbank.ru/api/v1"
        self._inner = None

    @property
    def enabled(self) -> bool:
        # change 027/029: личный ключ физлица — без CLIENT_ID; включённость
        # определяем по наличии секретных данных (secret/CREDENTIALS-ключа)
        return bool(self._client_id or os.environ.get("GIGACHAT_CLIENT_SECRET"))

    def _ensure(self):
        if self._inner is None:
            import os

            import gigachat

            creds = os.environ.get("GIGACHAT_CLIENT_SECRET", "")
            auth_url = os.environ.get("GIGACHAT_AUTH_URL", "")
            # SDK сам читает окружение с префиксом GIGACHAT_ (pydantic-settings,
            # extra=forbid): наши GIGACHAT_CLIENT_* для него лишние переменные —
            # временно прячем, credentials передаём явно kwarg'ом (change 027)
            popped = {}
            for key in ("GIGACHAT_CLIENT_ID", "GIGACHAT_CLIENT_SECRET"):
                if key in os.environ:
                    popped[key] = os.environ.pop(key)
            try:
                self._inner = gigachat.GigaChat(
                    credentials=creds or None,
                    base_url=self._base_url,
                    auth_url=auth_url or "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
                    scope=os.environ.get("GIGACHAT_SCOPE", "GIGACHAT_API"),
                    verify_ssl_certs=True,
                    # change 029-деградации не нужно: русский CA Минцифры
                    # (система на NixOS доверяет, но certifi/httpx — нет:
                    # SDK принимает ca_bundle_file; путь задаётся в .env
                    ca_bundle_file=os.environ.get("GIGACHAT_CA_BUNDLE") or None,
                )
            except (FileNotFoundError, OSError) as e:
                # change 030: кривой/отсутствующий CA-бандл внутри контейнера —
                # штатная деградация fallback, а не 500 (specs api, change 030)
                raise GigaUnavailable(f"инициализация SDK невозможна: {e}") from e
            finally:
                os.environ.update(popped)
            if not creds:
                raise GigaUnavailable("GIGACHAT_CLIENT_SECRET не задан")

    def complete(self, system: str, user: str, temperature: float = 0.0) -> str:
        """Возвращает текст ответа; при недоступности кидает GigaUnavailable.

        change 055: до 3 попыток с backoff (1с, 2с) — API GigaChat периодически
        отвечает 429/5xx/обрывом; одиночный вызов делал советник «мёртвым»."""
        self._ensure()
        payload = {
            # model обязателен у GigaChat API (change 027: default GigaChat)
            "model": os.environ.get("GIGACHAT_MODEL", "GigaChat"),
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        if temperature:
            payload["temperature"] = temperature
        import logging
        import time
        log = logging.getLogger(__name__)
        last: Exception | None = None
        for attempt in (1, 2, 3):
            try:
                resp = self._inner.chat(payload)
                return resp.choices[0].message.content
            except GigaUnavailable:
                raise
            except Exception as e:
                last = e
                log.warning("gigachat попытка %s/3 не удалась: %s", attempt, e)
                if attempt < 3:
                    time.sleep(float(attempt))
        # change 030: любые ошибки транспорта/верификации/конфигурации SDK
        # (в т.ч. FileNotFoundError по кривому CA-бандлу) — деградация
        # GigaUnavailable, а не 500 (наш советник ловит её штатно)
        raise GigaUnavailable(f"LLM недоступен после 3 попыток: {last}") from last


def get_client() -> GigaChatClient:
    import os

    global _CLIENT
    if _CLIENT is None:
        _CLIENT = GigaChatClient(
            client_id=os.environ.get("GIGACHAT_CLIENT_ID"),
            base_url=os.environ.get("GIGACHAT_BASE_URL"),
        )
    return _CLIENT
