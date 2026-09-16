"""Клиент GigaChat (Sber). Отсутствие ключей = деградация (см. спеку onboarding)."""
from __future__ import annotations


class GigaUnavailable(Exception):
    """Ключи не заданы или провайдер недоступен — пайплайн идёт в шаблонный режим."""


_CLIENT: "GigaChatClient | None" = None


class GigaChatClient:
    def __init__(self, client_id: str | None, base_url: str | None):
        self._client_id = client_id
        self._base_url = base_url or "https://gigachat.devices.sberbank.ru/api/v1"
        self._inner = None

    @property
    def enabled(self) -> bool:
        return bool(self._client_id)

    def _ensure(self):
        if self._inner is None:
            import os

            import gigachat

            creds = os.environ.get("GIGACHAT_CLIENT_SECRET", "")
            auth_url = os.environ.get("GIGACHAT_AUTH_URL", "")
            self._inner = gigachat.GigaChat(
                credentials=creds or None,
                base_url=self._base_url,
                auth_url=auth_url or "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
                scope=os.environ.get("GIGACHAT_SCOPE", "GIGACHAT_API"),
                verify_ssl_certs=True,
            )
            if not creds:
                raise GigaUnavailable("GIGACHAT_CLIENT_SECRET не задан")

    def complete(self, system: str, user: str, temperature: float = 0.0) -> str:
        """Возвращает текст ответа; при недоступности кидает GigaUnavailable."""
        self._ensure()
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        resp = self._inner.chat(messages, temperature=temperature)
        return resp.choices[0].message.content


def get_client() -> GigaChatClient:
    import os

    global _CLIENT
    if _CLIENT is None:
        _CLIENT = GigaChatClient(
            client_id=os.environ.get("GIGACHAT_CLIENT_ID"),
            base_url=os.environ.get("GIGACHAT_BASE_URL"),
        )
    return _CLIENT
