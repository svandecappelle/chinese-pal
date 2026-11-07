from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://chinese:chinese@localhost:5432/chinese"
    db_connect_retries: int = 30
    tts_dir: str = "/opt/tts"
    cedict_path: str = "/opt/dict/cedict_ts.u8"
    # Hanzi Writer (hanzi-writer.min.js) et les tracés des caractères (data/<caractère>.json).
    strokes_dir: str = "/opt/strokes"
    # Premier administrateur (voir auth.bootstrap_admin) ; mot de passe vide : généré.
    admin_username: str = "admin"
    admin_password: str = ""


settings = Settings()
