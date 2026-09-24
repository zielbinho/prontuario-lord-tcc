"""Serviço analítico (FastAPI). Lê somente o esquema pseudonimizado, com o papel lord_analitico.

Rotas usadas pela API principal, que controla quem pode ver cada painel:
  GET  /coorte       indicadores de coorte (prevalências, diagnósticos, tratamentos, abandono)
  GET  /qualidade    completude das fichas e taxa de aceitação das sugestões da IA
  POST /evolucao     indicadores de uma série de fichas de UM paciente; não acessa o banco:
                     a API envia só os dados estruturados das fichas, sem identificação

Uso: ..\\..\\.venv\\Scripts\\python -m uvicorn app:app --host 127.0.0.1 --port 8766
"""

from __future__ import annotations

from typing import Any

import pandas as pd
from fastapi import FastAPI
from pydantic import BaseModel, Field

from analitico import fonte
from analitico.coorte import resumo_coorte
from analitico.indicadores import indicadores_ficha

app = FastAPI(title="Serviço analítico LORD-UEPG", docs_url=None, redoc_url=None)


class FichaSerie(BaseModel):
    dias: int = Field(description="dias desde a primeira consulta")
    tipo_ficha: str
    dados: dict[str, Any]


class PedidoEvolucao(BaseModel):
    fichas: list[FichaSerie] = Field(max_length=500)


@app.get("/saude")
def saude() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/coorte")
def coorte() -> dict[str, Any]:
    v = fonte.carregar_visoes(nomes=("pacientes", "fichas", "tratamentos"))
    return resumo_coorte(v["pacientes"], v["fichas"], v["tratamentos"])


def _aceitacao(decisoes: pd.DataFrame, por: str | None) -> list[dict[str, Any]]:
    if decisoes.empty:
        return []
    grupos = decisoes.groupby(por) if por else [("total", decisoes)]
    saida = []
    for chave, g in grupos:
        contagem = g["decisao"].value_counts()
        aceitas = int(contagem.get("aceita", 0) + contagem.get("editada", 0))
        saida.append({"grupo": chave, "decisoes": len(g), "aceitas": int(contagem.get("aceita", 0)),
                      "editadas": int(contagem.get("editada", 0)), "rejeitadas": int(contagem.get("rejeitada", 0)),
                      "taxa_aceitacao_pct": round(aceitas / len(g) * 100, 1)})
    return saida


@app.get("/qualidade")
def qualidade() -> dict[str, Any]:
    v = fonte.carregar_visoes(nomes=("qualidade", "decisoes_ia"))
    q = v["qualidade"]
    completude = [
        {"tipo_ficha": tipo, "status": status, "fichas": len(g),
         "completude_media_pct": None if g["completude"].isna().all() else round(g["completude"].mean() * 100, 1)}
        for (tipo, status), g in q.groupby(["tipo_ficha", "status"])
    ] if not q.empty else []
    d = v["decisoes_ia"]
    return {
        "completude": completude,
        "aceitacao_ia": {"total": _aceitacao(d, None), "por_secao": _aceitacao(d, "secao"),
                         "por_versao_prompt": _aceitacao(d, "versao_prompt")},
    }


@app.post("/evolucao")
def evolucao(pedido: PedidoEvolucao) -> dict[str, Any]:
    serie = sorted(pedido.fichas, key=lambda f: f.dias)
    return {"consultas": [{"dias": f.dias, "tipo_ficha": f.tipo_ficha, **indicadores_ficha(f.dados)} for f in serie]}
