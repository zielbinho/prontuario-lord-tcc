import numpy as np
import pandas as pd
import pytest

from analitico.coorte import (
    comparar_tratamentos,
    correlacoes,
    diagnosticos,
    evolucao,
    prevalencias,
    rank_biserial_pareado,
    resumo_coorte,
    tabela_indicadores,
)


def _inicial(dor, estalido=False, grupo1="Ia_dor_miofascial"):
    return {
        "questionario_dtm": {"q16_dor_atual": dor, "q17_pior_dor_6m": dor, "q18_dor_media_6m": dor,
                             "q19_dias_afastamento_6m": 0, "q20_interferencia_atividades": 0,
                             "q21_mudanca_lazer_social": 0, "q22_mudanca_trabalho": 0,
                             "q35_cefaleia_6m": True, "q36_atividades_limitadas": []},
        "rdc_caracteristicas_relatadas": {"estalido": estalido, "zumbido": None},
        "diagnostico_eixo1": {"grupo1_muscular": grupo1},
    }


def _retorno(dor):
    return {"dor": {"q16_dor_atual": dor, "q17_pior_dor": dor, "q18_dor_media": dor}}


def coorte_conhecida():
    """Grupo A reduz a dor à metade; grupo B não muda. B tem um paciente que abandonou."""
    pacientes, fichas, tratamentos = [], [], []
    for i in range(8):
        for grupo, fator in (("placa_oclusal", 0.5), ("orientacoes_autocuidado", 1.0)):
            pid = f"{grupo[:1]}{i}"
            base = 4 + i % 5
            abandonou = grupo == "orientacoes_autocuidado" and i == 0
            pacientes.append({"pseudo_id": pid, "faixa_etaria_inicio": 30, "sexo": "F",
                              "dias_desde_ultima_consulta": 200 if abandonou else 10})
            fichas.append({"pseudo_id": pid, "dias_desde_inicio": 0, "tipo_ficha": "ficha-inicial",
                           "dados_estruturados": _inicial(base, estalido=i % 2 == 0)})
            if not abandonou:
                fichas.append({"pseudo_id": pid, "dias_desde_inicio": 30, "tipo_ficha": "ficha-retorno",
                               "dados_estruturados": _retorno(base)})
                fichas.append({"pseudo_id": pid, "dias_desde_inicio": 90, "tipo_ficha": "ficha-retorno",
                               "dados_estruturados": _retorno(base * fator)})
            tratamentos.append({"pseudo_id": pid, "categoria": grupo, "inicio_dias": 0,
                                "fim_dias": None if abandonou else 90})
    return pd.DataFrame(pacientes), pd.DataFrame(fichas), pd.DataFrame(tratamentos)


def test_evolucao_usa_a_linha_de_base_e_o_ultimo_retorno():
    pacientes, fichas, tratamentos = coorte_conhecida()
    ev = evolucao(tabela_indicadores(fichas), tratamentos, pacientes).set_index("pseudo_id")
    assert ev.loc["p1", ["base", "final", "retornos"]].tolist() == [50.0, 25.0, 2]
    assert ev.loc["p1", "variacao_rel"] == pytest.approx(50.0)
    assert ev.loc["o1", "variacao_rel"] == pytest.approx(0.0)
    assert bool(ev.loc["o0", "abandono"]) and np.isnan(ev.loc["o0", "final"])
    assert not ev.loc["p1", "abandono"]


def test_comparacao_recupera_o_efeito_e_separa_os_grupos():
    pacientes, fichas, tratamentos = coorte_conhecida()
    ev = evolucao(tabela_indicadores(fichas), tratamentos, pacientes)
    r = comparar_tratamentos(ev)
    grupos = {g["grupo"]: g for g in r["grupos"]}
    placa, orientacoes = grupos["placa_oclusal"], grupos["orientacoes_autocuidado"]
    assert placa["n"] == 8 and orientacoes["n"] == 7  # o paciente sem retorno não entra
    assert placa["reducao_media_pct"] == pytest.approx(50.0)
    assert placa["respondedores_30_pct"] == 100.0 and placa["respondedores_50_pct"] == 100.0
    assert orientacoes["respondedores_30_pct"] == 0.0
    assert placa["wilcoxon_p"] < 0.05 and placa["efeito_rank_biserial"] == 1.0
    assert orientacoes["wilcoxon_p"] is None  # nenhuma diferença: não há o que testar
    assert r["entre_grupos"]["p"] < 0.05


def test_rank_biserial():
    assert rank_biserial_pareado(np.array([5, 6, 7]), np.array([1, 2, 3])) == 1.0
    assert rank_biserial_pareado(np.array([1, 2]), np.array([5, 6])) == -1.0
    assert rank_biserial_pareado(np.array([3, 3]), np.array([3, 3])) is None


def test_prevalencias_e_diagnosticos_ignoram_valores_ausentes():
    _, fichas, _ = coorte_conhecida()
    prev = {p["caracteristica"]: p for p in prevalencias(fichas)}
    assert prev["estalido"]["prevalencia_pct"] == 50.0 and prev["estalido"]["n"] == 16
    assert prev["zumbido"]["n"] == 0 and prev["zumbido"]["prevalencia_pct"] is None
    assert prev["cefaleia_6m"]["prevalencia_pct"] == 100.0
    assert diagnosticos(fichas)["grupo1_muscular"] == {"Ia_dor_miofascial": 16}


def test_correlacoes_com_amostra_pequena_nao_quebram():
    _, fichas, _ = coorte_conhecida()
    c = {(x["x"], x["y"]): x for x in correlacoes(tabela_indicadores(fichas))}
    assert c[("icd", "sitios_dolorosos")]["n"] == 0 and c[("icd", "sitios_dolorosos")]["rho"] is None


def test_resumo_e_serializavel_em_json():
    import json

    resumo = resumo_coorte(*coorte_conhecida())
    texto = json.dumps(resumo)
    assert "NaN" not in texto
    assert resumo["pacientes"] == 16 and resumo["fichas"] == {"ficha-retorno": 30, "ficha-inicial": 16}
