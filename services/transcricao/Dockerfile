# Serviço de transcrição (faster-whisper em CPU). Construir a partir da RAIZ do repositório:
#   docker compose build transcricao
# O modelo Whisper é baixado na primeira transcrição e fica no volume modelos-whisper.
FROM python:3.11-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HOME=/modelos

RUN pip install --no-cache-dir --upgrade pip setuptools && pip install --no-cache-dir faster-whisper fastapi uvicorn python-multipart

COPY services/transcricao/app.py .
RUN useradd --create-home servico && mkdir -p /modelos && chown servico /modelos
USER servico
EXPOSE 8765
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8765"]
