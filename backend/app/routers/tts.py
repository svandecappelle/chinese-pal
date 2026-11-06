from fastapi import APIRouter, HTTPException, Query, Response

from ..db import pool
from ..tts import VOICE, Unavailable, synthesizer

router = APIRouter(prefix="/api/tts", tags=["prononciation"])


@router.get("", response_class=Response)
def speak(
    text: str = Query(min_length=1, max_length=200),
    pinyin: str | None = Query(None, max_length=40, description="Lecture d'un caractère seul"),
):
    """Prononciation d'un mot ou d'une phrase en WAV, calculée une fois puis gardée en base."""
    text = text.strip()
    try:
        reading = synthesizer.reading(text, pinyin)
    except Unavailable as err:
        raise HTTPException(503, str(err))
    key = {"voice": VOICE, "text": text, "reading": reading}

    with pool.connection() as conn:
        row = conn.execute(
            """SELECT audio FROM tts_cache
               WHERE voice = %(voice)s AND text = %(text)s AND reading = %(reading)s""",
            key,
        ).fetchone()
    if row:
        audio = row["audio"]
    else:
        try:
            audio = synthesizer.synthesize(text, reading)
        except ValueError as err:
            raise HTTPException(422, str(err))
        with pool.connection() as conn:
            conn.execute(
                """INSERT INTO tts_cache (voice, text, reading, audio)
                   VALUES (%(voice)s, %(text)s, %(reading)s, %(audio)s)
                   ON CONFLICT DO NOTHING""",
                key | {"audio": audio},
            )

    return Response(audio, media_type="audio/wav", headers={"Cache-Control": "max-age=604800"})
