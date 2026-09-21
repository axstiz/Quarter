from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://postcode:postcode@127.0.0.1:5432/postcode"
    dataset_dir: Path = Path(__file__).resolve().parent.parent.parent / "dataset"
    secret_key: str = "postcode-secret-key-change-in-production"
    cors_origins: str = Field(
        "*",
        validation_alias=AliasChoices("CORS_ORIGINS", "POSTCODE_CORS_ORIGINS"),
    )
    redis_url: str = "redis://localhost:6379/0"  # arq-воркер (change 007); пусто = только обработка в процессе
    jobs_mode: str = Field(
        "auto",  # auto | queue | sync
        validation_alias=AliasChoices("JOBS_MODE", "POSTCODE_JOBS_MODE"),
    )
    jobs_timeout_sec: float = 300.0  # arq job_timeout > HTTP-таймаута solve (change 029)
    jobs_max_tries: int = 2

    # sidecar-оптимизатор (change 018): база + таймаут HTTP-контракта solve
    # (change 029: таймаут > solve budget 180 с, чтобы не обрывать чужие фазы)
    optimizer_base_url: str = "http://localhost:8080"
    optimizer_solve_timeout_sec: float = 200.0

    # LLM-провайдер (change 027): gigachat (ключи GIGACHAT_CLIENT_*) | ollama | none
    llm_provider: Literal["gigachat", "ollama", "none"] = "gigachat"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:7b-instruct"
    # лимит одновременных LLM-вызовов (change 028): семофор поверх sync-клиента
    llm_max_concurrency: int = 2

    class Config:
        env_prefix = "POSTCODE_"
        env_file = ".env"


settings = Settings()

