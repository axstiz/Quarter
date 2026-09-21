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
    jobs_timeout_sec: float = 120.0  # arq job_timeout
    jobs_max_tries: int = 2

    # sidecar-оптимизатор (change 018): база + таймаут HTTP-контракта solve
    optimizer_base_url: str = "http://localhost:8080"
    optimizer_solve_timeout_sec: float = 60.0

    # LLM-провайдер (change 027): gigachat (ключи GIGACHAT_CLIENT_*) | ollama | none
    llm_provider: Literal["gigachat", "ollama", "none"] = "gigachat"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:7b-instruct"

    class Config:
        env_prefix = "POSTCODE_"
        env_file = ".env"


settings = Settings()

