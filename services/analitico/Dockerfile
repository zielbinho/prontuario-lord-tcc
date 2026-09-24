# Serviço analítico (FastAPI + Pandas + SciPy). Construir a partir da RAIZ do repositório:
#   docker compose build analitico
# Conecta com o papel lord_analitico, que só enxerga o esquema pseudonimizado.
FROM python:3.11-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

COPY services/analitico/pyproject.toml .
COPY services/analitico/analitico analitico
RUN pip install --no-cache-dir --upgrade pip setuptools && pip install --no-cache-dir .

COPY services/analitico/app.py .
RUN useradd --create-home servico
USER servico
EXPOSE 8766
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8766"]
