from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://postcode:postcode@localhost:5432/postcode"
    dataset_dir: Path = Path(__file__).resolve().parent.parent.parent / "dataset"

    class Config:
        env_prefix = "POSTCODE_"
        env_file = ".env"


settings = Settings()
