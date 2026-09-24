"""Serviço de transcrição de fala (seção 4.7 do TCC).

- Executa o Whisper localmente (faster-whisper); nenhum áudio sai da máquina/servidor.
- O áudio é processado apenas em memória e descartado ao fim da requisição: nunca é gravado em disco.
- Deve ficar acessível só à API (escuta em 127.0.0.1 ou na rede interna do Docker).

Uso:  uvicorn app:app --host 127.0.0.1 --port 8765     (na pasta services/transcricao)
Variáveis: MODELO_WHISPER (padrão "small"), DISPOSITIVO ("cpu"), TIPO_COMPUTACAO ("int8").
"""

from __future__ import annotations

import io
import os
import time
from functools import lru_cache
from typing import Protocol

from fastapi import FastAPI, HTTPException, Request

# Vocabulário da ficha: orienta o reconhecimento de termos que o Whisper erra com frequência
VOCABULARIO = (
    "Anamnese odontológica. Articulação temporomandibular, ATM, DTM, masseter, temporal, "
    "crepitação, estalido, bruxismo, apertamento, abertura bucal, prótese parcial removível, PPR, "
    "prótese total, dentadura, placa oclusal, losartana, dipirona."
)

TAMANHO_MAXIMO = 25 * 1024 * 1024  # 25 MB (cerca de 25 minutos de áudio comprimido)


class Transcritor(Protocol):
    def transcribe(self, audio, **opcoes): ...


@lru_cache
def modelo() -> Transcritor:
    from faster_whisper import WhisperModel  # importação tardia: os testes usam um transcritor falso

    return WhisperModel(
        os.environ.get("MODELO_WHISPER", "small"),
        device=os.environ.get("DISPOSITIVO", "cpu"),
        compute_type=os.environ.get("TIPO_COMPUTACAO", "int8"),
    )


app = FastAPI(title="Transcrição LORD-UEPG", docs_url=None, redoc_url=None)


@app.get("/saude")
def saude() -> dict:
    return {"ok": True, "modelo": os.environ.get("MODELO_WHISPER", "small")}


@app.post("/transcrever")
async def transcrever(requisicao: Request) -> dict:
    tipo = requisicao.headers.get("content-type", "")
    if not tipo.startswith("audio/"):
        raise HTTPException(415, "envie o áudio no corpo da requisição com Content-Type audio/*")
    audio = await requisicao.body()
    if not audio:
        raise HTTPException(400, "áudio vazio")
    if len(audio) > TAMANHO_MAXIMO:
        raise HTTPException(413, "áudio maior que o limite de 25 MB")

    inicio = time.perf_counter()
    try:
        segmentos, info = modelo().transcribe(
            io.BytesIO(audio),
            language="pt",
            initial_prompt=VOCABULARIO,
            vad_filter=True,
            beam_size=5,
        )
        texto = " ".join(s.text.strip() for s in segmentos).strip()
    except Exception as erro:  # áudio corrompido, formato não suportado etc.
        raise HTTPException(422, f"não foi possível transcrever o áudio: {erro}") from erro
    finally:
        del audio  # o áudio não é mantido em memória nem gravado

    return {
        "texto": texto,
        "duracao_audio_s": round(info.duration, 2),
        "tempo_processamento_s": round(time.perf_counter() - inicio, 2),
        "modelo": os.environ.get("MODELO_WHISPER", "small"),
    }
