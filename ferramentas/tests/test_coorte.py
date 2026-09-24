from datetime import date

import pytest

from sinteticos.coorte import EFEITOS, Parametros, carregar, gerar_coorte, para_visoes, salvar
from sinteticos.esquemas import erros


@pytest.fixture(scope="module")
def coorte():
    return gerar_coorte(Parametros(n=60, semente=11))


def test_fichas_validas_pelos_esquemas(coorte):
    for pac in coorte:
        for c in pac.consultas:
            assert erros(c.tipo_ficha, c.dados) == [], (pac.codigo, c.data)


def test_reprodutivel_pela_semente():
    a = gerar_coorte(Parametros(n=6, semente=5))
    b = gerar_coorte(Parametros(n=6, semente=5))
    assert [x.consultas[-1].dados for x in a] == [x.consultas[-1].dados for x in b]


def test_alocacao_equilibrada_e_plano_coerente(coorte):
    contagem = {g: sum(p.grupo == g for p in coorte) for g in EFEITOS}
    assert set(contagem.values()) == {20}
    for pac in coorte:
        assert pac.consultas[0].dados["plano_tratamento"]["categorias"] == [pac.grupo]
        assert pac.tratamento["categoria"] == pac.grupo


def test_linha_de_base_sempre_com_dor(coorte):
    for pac in coorte:
        q = pac.consultas[0].dados["questionario_dtm"]
        assert q["q12_dor_face_4_semanas"] and q["q16_dor_atual"] > 0


def test_consultas_em_ordem_no_passado_e_abandono_sem_fim_de_tratamento(coorte):
    ref = date.fromisoformat(Parametros.data_referencia)
    for pac in coorte:
        datas = [date.fromisoformat(c.data) for c in pac.consultas]
        assert datas == sorted(datas) and datas[-1] < ref
        if pac.abandona_apos is None:
            assert len(pac.consultas) == 6 and pac.tratamento["fim"] == pac.consultas[-1].data
        else:
            assert len(pac.consultas) == 1 + pac.abandona_apos and pac.tratamento["fim"] is None


def test_medidas_do_retorno_coerentes(coorte):
    for pac in coorte:
        for c in pac.consultas[1:]:
            e = c.dados["exame"]
            assert e["q39a_abertura_sem_auxilio_sem_dor_mm"] <= e["q39b_abertura_maxima_sem_auxilio_mm"] < e["q39c_abertura_maxima_com_auxilio_mm"]


def test_projecao_igual_as_visoes(coorte):
    pacientes, fichas, tratamentos = para_visoes(coorte, Parametros.data_referencia)
    assert list(pacientes.columns) == ["pseudo_id", "faixa_etaria_inicio", "sexo", "dias_desde_ultima_consulta"]
    assert set(fichas.tipo_ficha) == {"ficha-inicial", "ficha-retorno"}
    inicial = fichas[fichas.tipo_ficha == "ficha-inicial"].iloc[0].dados_estruturados
    assert "historia_medica" not in inicial and "q38_padrao_abertura_outro" not in inicial["exame_dtm"]
    assert (fichas.groupby("pseudo_id").dias_desde_inicio.min() == 0).all()
    assert tratamentos.inicio_dias.eq(0).all()


def test_salvar_e_carregar(tmp_path, coorte):
    salvar(coorte[:3], Parametros(n=3), tmp_path)
    assert carregar(tmp_path) == coorte[:3]
    assert (tmp_path / "indice.csv").read_text(encoding="utf-8").count("\n") == 4
