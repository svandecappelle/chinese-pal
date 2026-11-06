from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://chinese:chinese@localhost:5432/chinese"
    db_connect_retries: int = 30
    tts_dir: str = "/opt/tts"


settings = Settings()
