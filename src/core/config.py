from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://postcode:postcode@localhost:5432/postcode"
    dataset_dir: Path = Path(__file__).resolve().parent.parent.parent / "dataset"
    secret_key: str = "postcode-secret-key-change-in-production"
    cors_origins: str = Field(
        "*",
        validation_alias=AliasChoices("CORS_ORIGINS", "POSTCODE_CORS_ORIGINS"),
    )

    class Config:
        env_prefix = "POSTCODE_"
        env_file = ".env"


settings = Settings()

