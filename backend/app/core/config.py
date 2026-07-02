from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://juds:juds@localhost:5432/juds"
    djen_base_url: str = "https://comunicaapi.pje.jus.br"
    datajud_base_url: str = "https://api-publica.datajud.cnj.jus.br"
    datajud_api_key: str | None = None
    datajud_timeout_seconds: float = 30.0
    datajud_refresh_hours: int = 24
    search_window_days: int = 30
    process_enrichment_window_days: int = 3650
    rate_limit_sleep_seconds: int = 60
    api_cors_origins: str = "http://localhost:5173"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.api_cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
