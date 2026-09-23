import json

import pytest

from sinteticos.esquemas import erros
from sinteticos.gerar_casos import PERFIS, gerar_casos, roteiro, salvar


@pytest.fixture(scope="module")
def casos():
    return gerar_casos(n=60, semente=7, casos_ajuste=15)


def test_todos_os_gabaritos_sao_validos_pelo_esquema(casos):
    for caso in casos:
        assert erros("ficha-inicial", caso.gabarito) == [], caso.identificador


def test_geracao_e_reprodutivel_pela_semente():
    a = gerar_casos(n=5, semente=123, casos_ajuste=1)
    b = gerar_casos(n=5, semente=123, casos_ajuste=1)
    assert [c.gabarito for c in a] == [c.gabarito for c in b]
    assert [c.gabarito for c in gerar_casos(n=5, semente=124, casos_ajuste=1)] != [c.gabarito for c in a]


def test_divisao_ajuste_teste_e_perfis_balanceados(casos):
    assert sum(c.divisao == "ajuste" for c in casos) == 15
    contagem = {p: sum(c.perfil == p for c in casos) for p in PERFIS}
    assert set(contagem.values()) == {12}


def test_escalas_de_dor_coerentes(casos):
    for c in casos:
        q = c.gabarito["questionario_dtm"]
        if q["q12_dor_face_4_semanas"]:
            assert q["q17_pior_dor_6m"] >= q["q16_dor_atual"]
            assert q["q17_pior_dor_6m"] >= q["q18_dor_media_6m"] >= 1
            assert (q["q13_inicio_dor_anos"] is None) != (q["q13_inicio_dor_meses"] is None)
        else:
            assert q["q16_dor_atual"] == q["q17_pior_dor_6m"] == q["q18_dor_media_6m"] == 0
            assert q["q14_padrao_dor"] is None
        assert (q["q24_travamento_interfere_mastigacao"] is None) == (not q["q23_travamento"])
        assert (q["q34_dor_antes_do_trauma"] is None) == (not q["q33_trauma_recente"])


def test_medidas_de_abertura_em_ordem(casos):
    for c in casos:
        e = c.gabarito["exame_dtm"]
        assert (e["q39a_abertura_sem_auxilio_sem_dor_mm"] <= e["q39b_abertura_maxima_sem_auxilio_mm"]
                < e["q39c_abertura_maxima_com_auxilio_mm"])


def test_dor_a_palpacao_coerente_com_lados_e_diagnostico(casos):
    for c in casos:
        e = c.gabarito["exame_dtm"]
        algum_musculo = any(v[l] > 0 for v in e["q44_palpacao_muscular"].values() for l in ("direito", "esquerdo"))
        assert (e["q41_dor_muscular"] != "nenhuma") == algum_musculo
        if c.gabarito["diagnostico_eixo1"]["grupo1_muscular"] != "sem_diagnostico":
            assert algum_musculo
        if c.perfil == "sem_dtm":
            assert set(c.gabarito["diagnostico_eixo1"].values()) == {"sem_diagnostico"}


def test_protese_coerente(casos):
    for c in casos:
        p = c.gabarito["protese"]
        if p["q47_usuario_protese"]:
            assert p["q47_tipos_protese"] and p["q48_gosta_e_nao_gosta"] and p["q49_expectativa_futura_protese"]
        else:
            assert p["q47_tipos_protese"] == [] and p["q48_gosta_e_nao_gosta"] is None
        desdentado = "pt_dupla" in p["q47_tipos_protese"]
        i = c.gabarito["exame_intraoral"]
        assert (i["q75_altura_rebordo"] is not None) == desdentado
        assert (i["q64_overjet_mm"] is None) == desdentado


def test_textos_flexionados_e_profissao_compativel_com_idade(casos):
    for c in casos:
        h = c.gabarito["historia_medica"]
        assert "(a)" not in json.dumps(h, ensure_ascii=False)
        if h["q5_trabalho"].startswith("Aposentad"):
            assert c.idade >= 55
        if h["q5_trabalho"].startswith("Estudante"):
            assert c.idade <= 30
        if c.sexo == "M":
            assert "Aposentada" not in h["q5_trabalho"] and "Operadora" not in h["q5_trabalho"]


def test_medicamentos_so_quando_usa(casos):
    for c in casos:
        h = c.gabarito["historia_medica"]
        assert (h["q4_medicamentos"] is not None) == h["q4_usa_medicamento"]


def test_roteiro_lista_fatos_e_nao_expoe_decisao_clinica(casos):
    caso = casos[0]
    texto = roteiro(caso)
    assert caso.gabarito["queixa_principal"]["texto"] in texto
    assert "Desafios de linguagem" in texto
    for proibido in ("diagnóstico", "Eixo", "plano de tratamento", "grupo1"):
        assert proibido.lower() not in texto.lower()


def test_salvar_grava_gabarito_roteiro_e_indice(tmp_path):
    casos = gerar_casos(n=3, semente=1, casos_ajuste=1)
    salvar(casos, tmp_path)
    assert (tmp_path / "indice.csv").read_text(encoding="utf-8").count("\n") == 4
    gabarito = json.loads((tmp_path / "caso_001" / "gabarito.json").read_text(encoding="utf-8"))
    assert gabarito == casos[0].gabarito
    assert (tmp_path / "caso_001" / "roteiro.md").exists()
