import pandas as pd
import pytest
from fastapi.testclient import TestClient

import app as servico
from tests.test_coorte import coorte_conhecida


@pytest.fixture
def cliente(monkeypatch):
    pacientes, fichas, tratamentos = coorte_conhecida()
    visoes = {
        "pacientes": pacientes, "fichas": fichas, "tratamentos": tratamentos,
        "qualidade": pd.DataFrame([
            {"tipo_ficha": "ficha-inicial", "status": "aprovada", "completude": 0.9},
            {"tipo_ficha": "ficha-inicial", "status": "aprovada", "completude": 0.7},
            {"tipo_ficha": "ficha-retorno", "status": "rascunho", "completude": None},
        ]),
        "decisoes_ia": pd.DataFrame([
            {"secao": "historia_medica", "modelo": "m", "versao_prompt": "v4", "origem": "texto", "campo": "a", "decisao": "aceita"},
            {"secao": "historia_medica", "modelo": "m", "versao_prompt": "v4", "origem": "texto", "campo": "b", "decisao": "editada"},
            {"secao": "protese", "modelo": "m", "versao_prompt": "v4", "origem": "audio", "campo": "c", "decisao": "rejeitada"},
        ]),
    }
    monkeypatch.setattr(servico.fonte, "carregar_visoes", lambda url=None, nomes=(): {n: visoes[n] for n in nomes})
    return TestClient(servico.app)


def test_saude(cliente):
    assert cliente.get("/saude").json() == {"status": "ok"}


def test_coorte(cliente):
    r = cliente.get("/coorte").json()
    grupos = {g["grupo"]: g for g in r["tratamentos"]["grupos"]}
    assert r["pacientes"] == 16 and grupos["placa_oclusal"]["reducao_media_pct"] == 50.0
    assert {a["grupo"]: a["abandono_pct"] for a in r["abandono"]}["orientacoes_autocuidado"] == 12.5


def test_qualidade(cliente):
    r = cliente.get("/qualidade").json()
    assert {(c["tipo_ficha"], c["status"]): c["completude_media_pct"] for c in r["completude"]} == {
        ("ficha-inicial", "aprovada"): 80.0, ("ficha-retorno", "rascunho"): None}
    assert r["aceitacao_ia"]["total"][0]["taxa_aceitacao_pct"] == pytest.approx(66.7)  # aceita + editada
    assert {s["grupo"]: s["taxa_aceitacao_pct"] for s in r["aceitacao_ia"]["por_secao"]} == {"historia_medica": 100.0, "protese": 0.0}


def test_evolucao_nao_precisa_do_banco(cliente, monkeypatch):
    monkeypatch.setattr(servico.fonte, "carregar_visoes", lambda *a, **k: pytest.fail("não deveria acessar o banco"))
    r = cliente.post("/evolucao", json={"fichas": [
        {"dias": 30, "tipo_ficha": "ficha-retorno", "dados": {"dor": {"q16_dor_atual": 2, "q17_pior_dor": 2, "q18_dor_media": 2}}},
        {"dias": 0, "tipo_ficha": "ficha-inicial", "dados": {"questionario_dtm": {"q16_dor_atual": 6, "q17_pior_dor_6m": 6, "q18_dor_media_6m": 6}}},
    ]})
    assert r.status_code == 200
    assert [(c["dias"], c["icd"]) for c in r.json()["consultas"]] == [(0, 60.0), (30, 20.0)]


def test_evolucao_rejeita_pedido_invalido(cliente):
    assert cliente.post("/evolucao", json={"fichas": [{"dias": "x"}]}).status_code == 422
