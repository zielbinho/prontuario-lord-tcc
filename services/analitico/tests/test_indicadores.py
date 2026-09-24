import pytest

from analitico.indicadores import (
    grau_gcps,
    indicadores_ficha,
    palpacao,
    pontos_dias_afastamento,
    pontos_escore_incapacidade,
)


@pytest.mark.parametrize(("dias", "pontos"), [(0, 0), (6, 0), (7, 1), (14, 1), (15, 2), (30, 2), (31, 3), (180, 3)])
def test_pontos_por_dias_de_afastamento(dias, pontos):
    assert pontos_dias_afastamento(dias) == pontos


@pytest.mark.parametrize(("ei", "pontos"), [(0, 0), (29.9, 0), (30, 1), (49.9, 1), (50, 2), (69.9, 2), (70, 3), (100, 3)])
def test_pontos_por_escore_de_incapacidade(ei, pontos):
    assert pontos_escore_incapacidade(ei) == pontos


@pytest.mark.parametrize(
    ("icd", "ei", "dias", "grau"),
    [
        (0, 0, 0, 0),  # sem dor
        (40, 20, 0, 1),  # baixa intensidade, baixa incapacidade
        (60, 20, 0, 2),  # alta intensidade, baixa incapacidade
        (60, 55, 10, 3),  # 2 + 1 = 3 pontos
        (30, 75, 20, 4),  # 3 + 2 = 5 pontos: a incapacidade manda, não a intensidade
        (50, None, 0, None),
    ],
)
def test_grau_gcps(icd, ei, dias, grau):
    assert grau_gcps(icd, ei, dias) == grau


def test_palpacao_conta_sitios_e_soma_intensidades():
    exame = {
        "q44_palpacao_muscular": {"masseter_corpo": {"direito": 2, "esquerdo": 0}, "temporal_medio": {"direito": 1, "esquerdo": 3}},
        "q45_palpacao_articular": {"articular_lateral": {"direito": 0, "esquerdo": None}},
    }
    assert palpacao(exame) == (3, 6)
    assert palpacao({}) == (None, None)


def test_indicadores_da_ficha_inicial():
    dados = {
        "questionario_dtm": {
            "q16_dor_atual": 6, "q17_pior_dor_6m": 8, "q18_dor_media_6m": 7, "q19_dias_afastamento_6m": 10,
            "q20_interferencia_atividades": 5, "q21_mudanca_lazer_social": 4, "q22_mudanca_trabalho": 6,
            "q36_atividades_limitadas": ["mastigar", "bocejar"],
        },
        "exame_dtm": {"q39a_abertura_sem_auxilio_sem_dor_mm": 30, "q39b_abertura_maxima_sem_auxilio_mm": 38,
                      "q39c_abertura_maxima_com_auxilio_mm": 42,
                      "q44_palpacao_muscular": {"masseter_corpo": {"direito": 2, "esquerdo": 1}}},
    }
    i = indicadores_ficha(dados)
    assert i["icd"] == 70.0  # (6 + 8 + 7) / 3 x 10
    assert i["escore_incapacidade"] == 50.0  # (5 + 4 + 6) / 3 x 10
    assert i["grau_gcps"] == 3  # EI 50 -> 2 pontos; 10 dias -> 1 ponto
    assert (i["abertura_max_mm"], i["sitios_dolorosos"], i["soma_palpacao"], i["atividades_limitadas"]) == (38, 2, 3, 2)


def test_indicadores_da_ficha_de_retorno_usam_os_caminhos_do_retorno():
    dados = {
        "dor": {"q16_dor_atual": 2, "q17_pior_dor": 4, "q18_dor_media": 3, "q19_dias_afastamento": 0,
                "q20_interferencia_atividades": 1, "q21_mudanca_lazer_social": 0, "q22_mudanca_trabalho": 2},
        "exame": {"q39b_abertura_maxima_sem_auxilio_mm": 45},
    }
    i = indicadores_ficha(dados)
    assert (i["icd"], i["escore_incapacidade"], i["grau_gcps"], i["abertura_max_mm"]) == (30.0, 10.0, 1, 45)
    assert i["atividades_limitadas"] is None


def test_campos_ausentes_viram_none_sem_erro():
    i = indicadores_ficha({"questionario_dtm": {"q16_dor_atual": 5}})
    assert i["icd"] is None and i["grau_gcps"] is None and i["sitios_dolorosos"] is None
