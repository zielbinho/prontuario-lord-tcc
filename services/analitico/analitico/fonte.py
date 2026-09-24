"""Leitura do esquema pseudonimizado. A conexão usa o papel lord_analitico, que só enxerga as visões."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pandas as pd
import psycopg

CONSULTAS = {
    "pacientes": "select pseudo_id, faixa_etaria_inicio, sexo, dias_desde_ultima_consulta from analitico.paciente",
    "fichas": "select pseudo_id, dias_desde_inicio, tipo_ficha, dados_estruturados from analitico.ficha",
    "tratamentos": "select pseudo_id, categoria, inicio_dias, fim_dias from analitico.tratamento",
    "qualidade": "select tipo_ficha, status, completude from analitico.qualidade_ficha",
    "decisoes_ia": "select secao, modelo, versao_prompt, origem, campo, decisao from analitico.decisao_ia",
}


def url_padrao() -> str:
    """URL_BANCO_ANALITICO; no desenvolvimento, monta a URL a partir dos segredos do banco local."""
    if url := os.environ.get("URL_BANCO_ANALITICO"):
        return url
    segredos = Path(__file__).resolve().parents[3] / "apps" / "api" / ".dados-dev" / "segredos.json"
    if segredos.exists():
        senha = json.loads(segredos.read_text(encoding="utf-8"))["analitico"]
        return f"postgresql://lord_analitico:{senha}@127.0.0.1:54330/lord"
    raise RuntimeError("defina URL_BANCO_ANALITICO (papel lord_analitico, somente leitura)")


def carregar_visoes(url: str | None = None, nomes: tuple[str, ...] = tuple(CONSULTAS)) -> dict[str, pd.DataFrame]:
    with psycopg.connect(url or url_padrao()) as conexao:
        conexao.read_only = True
        saida = {}
        for nome in nomes:
            cursor = conexao.execute(CONSULTAS[nome])
            saida[nome] = pd.DataFrame(cursor.fetchall(), columns=[c.name for c in cursor.description])
        return saida
