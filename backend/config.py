from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Database
    database_url: str = "postgresql+asyncpg://nglip:dev_password_change_in_prod@localhost:5432/nglip"

    # Redis / Celery
    redis_url: str = "redis://localhost:6379/0"

    # Object storage
    object_store_path: str = "/data"

    # Ollama
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.1:8b"

    # Auth
    jwt_secret: str = "change_me_in_production"
    jwt_expiry_hours: int = 24

    # Feature flags
    forecast_enabled: bool = False

    # CORS
    cors_origins: list[str] = ["http://localhost:3000"]

    # Performance
    analysis_timeout_s: int = 120
    cache_ttl_s: int = 86400  # 24 hours


@lru_cache
def get_settings() -> Settings:
    return Settings()
