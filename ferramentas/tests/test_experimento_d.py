"""O módulo analítico recupera os efeitos programados na coorte sintética (Experimento D em miniatura)."""

import numpy as np
import pytest

from analitico.coorte import evolucao, resumo_coorte, tabela_indicadores
from sinteticos.coorte import Parametros, gerar_coorte, para_visoes


@pytest.fixture(scope="module")
def cenario():
    p = Parametros(n=90, semente=3)
    coorte = gerar_coorte(p)
    visoes = para_visoes(coorte, p.data_referencia)
    return p, coorte, visoes, resumo_coorte(*visoes)


def test_reducao_estimada_proxima_do_efeito_sorteado(cenario):
    _, coorte, _, resumo = cenario
    estimada = {g["grupo"]: g["reducao_media_pct"] for g in resumo["tratamentos_concluintes"]["grupos"]}
    for grupo, valor in estimada.items():
        sorteado = np.mean([x.efeito_individual for x in coorte if x.grupo == grupo and x.abandona_apos is None]) * 100
        assert valor == pytest.approx(sorteado, abs=5), grupo


def test_abandono_detectado_igual_ao_programado(cenario):
    _, coorte, (pacientes, fichas, tratamentos), _ = cenario
    ev = evolucao(tabela_indicadores(fichas), tratamentos, pacientes).set_index("pseudo_id")
    for x in coorte:
        assert bool(ev.loc[x.codigo, "abandono"]) == (x.abandona_apos is not None), x.codigo


def test_ordem_dos_grupos_e_diferenca_entre_eles(cenario):
    _, _, _, resumo = cenario
    estimada = {g["grupo"]: g["reducao_media_pct"] for g in resumo["tratamentos_concluintes"]["grupos"]}
    assert estimada["placa_oclusal"] > estimada["laser_baixa_intensidade"] > estimada["orientacoes_autocuidado"]
    assert resumo["tratamentos_concluintes"]["entre_grupos"]["p"] < 0.05
