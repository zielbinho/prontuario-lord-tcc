"""Serviço analítico (FastAPI). Lê somente o esquema pseudonimizado, com o papel lord_analitico.

Rotas usadas pela API principal, que controla quem pode ver cada painel:
  GET  /coorte       indicadores de coorte (prevalências, diagnósticos, tratamentos, abandono)
  GET  /qualidade    completude das fichas e taxa de aceitação das sugestões da IA
  GET  /exportacao   CSV pseudonimizado, uma linha por ficha, para análises externas
  POST /evolucao     indicadores de uma série de fichas de UM paciente; não acessa o banco:
                     a API envia só os dados estruturados das fichas, sem identificação

Uso: ..\\..\\.venv\\Scripts\\python -m uvicorn app:app --host 127.0.0.1 --port 8766
"""

from __future__ import annotations

from typing import Any

import pandas as pd
from fastapi import FastAPI
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from analitico import fonte
from analitico.coorte import resumo_coorte, tabela_indicadores
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


@app.get("/exportacao", response_class=PlainTextResponse)
def exportacao() -> PlainTextResponse:
    """Uma linha por ficha aprovada, pseudonimizada, com os indicadores já calculados (CSV)."""
    v = fonte.carregar_visoes(nomes=("pacientes", "fichas", "tratamentos"))
    ind = tabela_indicadores(v["fichas"]) if not v["fichas"].empty else pd.DataFrame(columns=["pseudo_id"])
    grupo = (v["tratamentos"].sort_values("inicio_dias").groupby("pseudo_id").first()[["categoria"]]
             .rename(columns={"categoria": "tratamento"}) if not v["tratamentos"].empty else pd.DataFrame(columns=["tratamento"]))
    pacientes = v["pacientes"].set_index("pseudo_id")[["faixa_etaria_inicio", "sexo"]] if not v["pacientes"].empty else pd.DataFrame()
    tabela = ind.join(pacientes, on="pseudo_id").join(grupo, on="pseudo_id")
    colunas = ["pseudo_id", "faixa_etaria_inicio", "sexo", "tratamento", "dias_desde_inicio", "tipo_ficha"]
    tabela = tabela[[c for c in colunas if c in tabela] + [c for c in tabela if c not in colunas]]
    return PlainTextResponse(tabela.to_csv(index=False, lineterminator="\n"), media_type="text/csv; charset=utf-8")


@app.post("/evolucao")
def evolucao(pedido: PedidoEvolucao) -> dict[str, Any]:
    serie = sorted(pedido.fichas, key=lambda f: f.dias)
    return {"consultas": [{"dias": f.dias, "tipo_ficha": f.tipo_ficha, **indicadores_ficha(f.dados)} for f in serie]}
