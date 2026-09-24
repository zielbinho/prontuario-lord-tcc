"""Gera casos clínicos sintéticos para os experimentos do TCC (seção 4.9.1).

Cada caso é composto por:
  - gabarito.json: a ficha inicial completa, válida pelo esquema, com respostas coerentes entre si;
  - roteiro.md: instruções para o membro da LORD que escreverá a narrativa da consulta,
    com os fatos que devem (e os que NÃO devem) aparecer e os desafios de linguagem do caso.

Uso (na pasta ferramentas/):
    python -m sinteticos.gerar_casos --n 40 --semente 2026
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import re
from dataclasses import dataclass, field
from pathlib import Path

from .esquemas import erros

PERFIS = ["dtm_muscular", "dtm_articular", "protese", "dtm_e_protese", "sem_dtm"]

SECOES_NARRATIVAS = ["queixa_principal", "historia_medica", "historia_odontologica", "protese", "observacoes"]

DESAFIOS = {
    "negacao": "Inclua ao menos uma negação explícita (ex.: \"não tem alergia a nada\", \"nunca fumou\").",
    "tempo_impreciso": "Expresse ao menos um tempo de forma imprecisa (ex.: \"faz uns dois anos\", \"desde o começo do ano passado\").",
    "autocorrecao": "Inclua uma autocorreção em algum fato; o valor FINAL, depois da correção, deve ser o do gabarito (ex.: \"toma omeprazol... não, na verdade é losartana\").",
    "termo_coloquial": "Use termos coloquiais em vez dos técnicos (ex.: \"dentadura\", \"remédio de pressão\", \"a boca trava\").",
    "informacao_irrelevante": "Inclua ao menos um comentário sem relação com a ficha (ex.: sobre o trânsito ou o tempo de espera).",
    "ordem_trocada": "Apresente as informações fora da ordem da ficha, como numa conversa real.",
}

QUEIXAS = {
    "dtm_muscular": [
        "Dor no rosto dos dois lados, pior ao acordar.",
        "Dor na região da bochecha direita ao mastigar.",
        "Cansaço na mandíbula e dor de cabeça frequente.",
    ],
    "dtm_articular": [
        "Estalo na mandíbula ao abrir a boca.",
        "A mandíbula trava às vezes e dói perto do ouvido.",
        "Barulho na articulação ao mastigar e dor do lado esquerdo.",
    ],
    "protese": [
        "Dentadura superior solta e machucando a gengiva.",
        "Quer fazer prótese nova porque a atual quebrou.",
        "Dificuldade para mastigar com a prótese parcial.",
    ],
    "dtm_e_protese": [
        "Dor na face e prótese desadaptada.",
        "Dor perto do ouvido desde que trocou a dentadura.",
    ],
    "sem_dtm": [
        "Avaliação para reabilitação dos dentes posteriores.",
        "Encaminhado para avaliação de rotina na Liga.",
    ],
}

MEDICAMENTOS = [
    "Losartana 50 mg", "Omeprazol 20 mg", "Sertralina 50 mg", "Levotiroxina 50 mcg",
    "Metformina 850 mg", "Anticoncepcional oral", "Clonazepam 2 mg", "Sinvastatina 20 mg",
]
DURACOES = ["há dois anos", "há seis meses", "há cerca de um ano", "há cinco anos", "há três meses"]
ALERGIAS = ["Dipirona.", "Penicilina.", "Ibuprofeno.", "Camarão.", "Látex."]
CIRURGIAS = [
    "Apendicectomia em 2015.", "Cesárea em 2018.", "Colecistectomia em 2020.",
    "Exodontia dos terceiros molares em 2012.", "Cirurgia de hérnia inguinal em 2019.",
]
SONO_RUIM = ["Dorme mal e acorda cansado(a).", "Acorda várias vezes à noite.", "Dorme cerca de cinco horas por noite."]
SONO_BOM = ["Dorme bem, cerca de oito horas por noite.", "Sono regular."]
SUBSTANCIAS = [
    "Nega álcool, drogas e cigarro.", "Bebe socialmente aos fins de semana; nega cigarro.",
    "Ex-fumante, parou há dez anos.", "Fuma cerca de dez cigarros por dia.",
]
# (profissão, idade mínima, idade máxima)
TRABALHOS = [
    ("Operador(a) de telemarketing.", 18, 60), ("Professor(a) do ensino fundamental.", 23, 65),
    ("Motorista de aplicativo.", 21, 70), ("Estudante universitário(a).", 18, 30),
    ("Aposentado(a).", 55, 90), ("Trabalha como caixa de supermercado.", 18, 60),
]
ANSIEDADE = [
    "Relata ansiedade em períodos de muito trabalho.", "Relata preocupação constante com a família.",
    "Faz acompanhamento psicológico para ansiedade.", "Nega ansiedade ou depressão.",
]
VIDA_PESSOAL = ["Mora com o cônjuge e dois filhos.", "Mora sozinho(a).", "Cuida da mãe idosa."]
TEMPO_PERDA_DENTES = ["Há cerca de 10 anos.", "Há 20 anos.", "Perdeu os posteriores há 5 anos."]
GOSTA_PROTESE = [
    "Gosta da estética, mas a prótese superior solta ao falar.",
    "Não gosta porque machuca ao mastigar alimentos duros.",
    "Gosta do conforto, mas os dentes estão desgastados.",
]
EXPECTATIVA_PROTESE = [
    "Espera conseguir mastigar carne sem a prótese sair do lugar.",
    "Quer uma prótese mais firme e com aparência natural.",
    "Espera parar de sentir dor na gengiva.",
]
PERIODONTAL = [
    "Gengivite localizada na região anterior inferior.", "Periodonto saudável.",
    "Recessões gengivais generalizadas leves.", "Presença de cálculo supragengival nos incisivos inferiores.",
]
OBSERVACOES = [
    "Paciente relata que prefere atendimento no período da tarde.",
    "Paciente trouxe radiografia panorâmica de 2024.",
]

SITIOS_MUSCULARES = [
    "temporal_posterior", "temporal_medio", "temporal_anterior",
    "masseter_origem", "masseter_corpo", "masseter_insercao", "cervical",
]
SITIOS_ARTICULARES = ["articular_lateral", "articular_posterior"]


@dataclass
class Caso:
    numero: int
    perfil: str
    sexo: str
    idade: int
    divisao: str = "teste"
    desafios: list[str] = field(default_factory=list)
    gabarito: dict = field(default_factory=dict)

    @property
    def identificador(self) -> str:
        return f"caso_{self.numero:03d}"


def _talvez(rng: random.Random, probabilidade: float, valor, senao=None):
    return valor if rng.random() < probabilidade else senao


def _flexionar(texto: str | None, sexo: str) -> str | None:
    """Resolve marcas de gênero: "cansado(a)" -> "cansada"/"cansado"; "Operador(a)" -> "Operadora"/"Operador"."""
    if texto is None:
        return None
    feminino = sexo == "F"
    texto = re.sub(r"o\(a\)", "a" if feminino else "o", texto)
    return re.sub(r"\(a\)", "a" if feminino else "", texto)


# Itens que só fazem sentido para o sexo feminino e o substituto usado para o masculino.
# A troca é feita DEPOIS do sorteio, sem consumir números aleatórios: assim os demais casos
# gerados com a mesma semente não mudam.
SUBSTITUTOS_MASCULINO = {
    "Anticoncepcional oral": "Omeprazol 20 mg",
    "Cesárea em 2018.": "Apendicectomia em 2015.",
}


# Itens que só fazem sentido para certas idades (em 2026): (idade mínima, idade máxima, substituto).
# Como a substituição acontece depois do sorteio, ela não altera os demais valores sorteados.
LIMITES_DE_IDADE = {
    "Anticoncepcional oral": (0, 50, "Omeprazol 20 mg"),
    "Cesárea em 2018.": (26, 53, "Apendicectomia em 2015."),  # 18 a 45 anos em 2018
    "Exodontia dos terceiros molares em 2012.": (29, 200, "Apendicectomia em 2015."),  # 15+ anos em 2012
    "Ex-fumante, parou há dez anos.": (28, 200, "Nega álcool, drogas e cigarro."),
}


def _compativel_com_sexo(item: str, sexo: str, idade: int | None = None) -> str:
    """Substitui itens incompatíveis com o sexo ou a idade do paciente (ex.: cesárea em homem)."""
    if sexo == "M":
        item = SUBSTITUTOS_MASCULINO.get(item, item)
    if idade is not None and item in LIMITES_DE_IDADE:
        minima, maxima, substituto = LIMITES_DE_IDADE[item]
        if not minima <= idade <= maxima:
            item = substituto
    return item


def _historia_medica(rng: random.Random, perfil: str, sexo: str, idade: int) -> dict:
    usa_medicamento = rng.random() < 0.55
    medicamentos = None
    if usa_medicamento:
        escolhidos = [_compativel_com_sexo(m, sexo, idade) for m in rng.sample(MEDICAMENTOS, rng.randint(1, 2))]
        medicamentos = "; ".join(f"{m}, {rng.choice(DURACOES)}" for m in escolhidos) + "."
    com_dor = perfil != "sem_dtm" and perfil != "protese"
    sistemas = rng.sample(["cardiaca", "respiratoria", "neurologica", "gastrointestinal"], rng.randint(0, 1))
    trabalhos = [t for t, minima, maxima in TRABALHOS if minima <= idade <= maxima]
    historia = {
        "q1_sistemas": sistemas or ["nenhuma"],
        "q1_outras": _talvez(rng, 0.15, "Hipotireoidismo."),
        "q2_historico_cirurgico": _compativel_com_sexo(rng.choice(CIRURGIAS), sexo, idade) if rng.random() < 0.5 else "Nega.",
        "q3_alergias": rng.choice(ALERGIAS) if rng.random() < 0.35 else "Nega.",
        "q4_usa_medicamento": usa_medicamento,
        "q4_medicamentos": medicamentos,
        "q5_sono": rng.choice(SONO_RUIM if com_dor and rng.random() < 0.7 else SONO_BOM),
        "q5_substancias": _compativel_com_sexo(rng.choice(SUBSTANCIAS), sexo, idade),
        "q5_trabalho": rng.choice(trabalhos),
        "q5_ansiedade": rng.choice(ANSIEDADE[:3] if com_dor and rng.random() < 0.7 else ANSIEDADE),
        "q5_vida_pessoal": _talvez(rng, 0.4, rng.choice(VIDA_PESSOAL)),
        "q6_tratamento_odontologico_6m": _talvez(rng, 0.3, "Restauração há quatro meses.", "Nega."),
    }
    return {campo: _flexionar(v, sexo) if isinstance(v, str) else v for campo, v in historia.items()}


def _historia_odontologica(rng: random.Random, desdentado_total: bool) -> dict:
    return {
        "q7_tratamentos_previos": sorted(rng.sample(
            ["periodontal", "ortodontico", "restaurador", "endodontico", "cirurgia_bucal"], rng.randint(0, 3))),
        "q8_alteracoes": [] if desdentado_total else sorted(rng.sample(
            ["sangramento_na_escovacao", "mau_halito", "dificuldade_para_mastigar", "dentes_amolecidos"], rng.randint(0, 2))),
        "q9_escovacoes_por_dia": rng.randint(1, 3),
        "q9_tipo_escova": rng.choice(["media", "macia", "macia", "dura"]),
        "q9_acessorios": [] if desdentado_total else sorted(rng.sample(["fio_dental", "bochecho", "escova_interdental"], rng.randint(0, 2))),
        "q10_respirador_bucal": rng.random() < 0.15,
        "q11_boca_seca": rng.random() < 0.2,
    }


def _questionario_dtm(rng: random.Random, perfil: str) -> dict:
    com_dor = perfil in ("dtm_muscular", "dtm_articular", "dtm_e_protese")
    articular = perfil == "dtm_articular"
    q = {
        "q12_dor_face_4_semanas": com_dor,
        "q13_inicio_dor_anos": None,
        "q13_inicio_dor_meses": None,
        "q14_padrao_dor": None,
        "q15_procurou_profissional": None,
        "q16_dor_atual": 0, "q17_pior_dor_6m": 0, "q18_dor_media_6m": 0,
        "q19_dias_afastamento_6m": 0,
        "q20_interferencia_atividades": 0, "q21_mudanca_lazer_social": 0, "q22_mudanca_trabalho": 0,
    }
    if com_dor:
        pior = rng.randint(5, 10)
        atual = rng.randint(0, min(7, pior))
        media = rng.randint(max(1, min(atual, pior) - 1), pior)
        if rng.random() < 0.5:
            q["q13_inicio_dor_anos"] = rng.randint(1, 6)
        else:
            q["q13_inicio_dor_meses"] = rng.randint(2, 11)
        q.update({
            "q14_padrao_dor": rng.choice(["o_tempo_todo", "aparece_e_desaparece", "aparece_e_desaparece"]),
            "q15_procurou_profissional": rng.choice(["nao", "sim_ultimos_6_meses", "sim_ha_mais_de_6_meses"]),
            "q16_dor_atual": atual, "q17_pior_dor_6m": pior, "q18_dor_media_6m": media,
            "q19_dias_afastamento_6m": rng.choice([0, 0, 0, 2, 5, 10, 20, 35]),
            "q20_interferencia_atividades": rng.randint(0, pior),
            "q21_mudanca_lazer_social": rng.randint(0, pior),
            "q22_mudanca_trabalho": rng.randint(0, pior),
        })
    travamento = articular and rng.random() < 0.5
    trauma = rng.random() < 0.08
    q.update({
        "q23_travamento": travamento,
        "q24_travamento_interfere_mastigacao": (rng.random() < 0.6) if travamento else None,
        "q25_estalos": articular or rng.random() < 0.2,
        "q26_crepitacao": rng.random() < (0.25 if articular else 0.05),
        "q27_bruxismo_noturno": rng.random() < (0.7 if com_dor else 0.2),
        "q28_bruxismo_diurno": rng.random() < (0.6 if com_dor else 0.15),
        "q29_mandibula_cansada_manha": com_dor and rng.random() < 0.6,
        "q30_doenca_articular_sistemica": rng.random() < 0.05,
        "q31_doenca_articular_familia": rng.random() < 0.15,
        "q32_outra_articulacao_dolorida": rng.random() < 0.15,
        "q33_trauma_recente": trauma,
        "q34_dor_antes_do_trauma": (rng.random() < 0.5) if trauma else None,
        "q35_cefaleia_6m": rng.random() < (0.6 if com_dor else 0.2),
        "q36_atividades_limitadas": sorted(rng.sample(
            ["mastigar", "comer_alimentos_duros", "bocejar", "conversar", "sorrir"], rng.randint(1, 3))) if com_dor else [],
    })
    return q


def _nivel_palpacao(rng: random.Random, chance_dor: float, maximo: int) -> int:
    return rng.randint(1, maximo) if rng.random() < chance_dor else 0


def _lado_de(direito: bool, esquerdo: bool) -> str:
    return {(True, True): "ambos", (True, False): "direito", (False, True): "esquerdo"}.get((direito, esquerdo), "nenhuma")


def _exame_dtm(rng: random.Random, perfil: str) -> tuple[dict, str]:
    muscular = perfil in ("dtm_muscular", "dtm_e_protese")
    articular = perfil == "dtm_articular"
    lado_afetado = rng.choice(["direito", "esquerdo"])

    palp_musc = {
        s: {lado: _nivel_palpacao(rng, 0.6 if muscular and s.startswith(("masseter", "temporal_a")) else (0.25 if muscular else 0.05), 3)
            for lado in ("direito", "esquerdo")}
        for s in SITIOS_MUSCULARES
    }
    palp_art = {
        s: {lado: _nivel_palpacao(rng, 0.7 if articular and lado == lado_afetado else 0.05, 3) for lado in ("direito", "esquerdo")}
        for s in SITIOS_ARTICULARES
    }
    dor_musc = {lado: any(v[lado] > 0 for v in palp_musc.values()) for lado in ("direito", "esquerdo")}
    dor_art = {lado: any(v[lado] > 0 for v in palp_art.values()) for lado in ("direito", "esquerdo")}

    def area(lado: str) -> str:
        return {(True, True): "ambos", (True, False): "musculos", (False, True): "articulacao"}.get(
            (dor_musc[lado], dor_art[lado]), "nenhuma")

    limitada = articular and rng.random() < 0.4
    maxima = rng.randint(28, 37) if limitada else rng.randint(38, 52)
    ruido = {lado: ("estalido" if articular and lado == lado_afetado else "nenhum") for lado in ("direito", "esquerdo")}

    exame = {
        "q37_areas_dor_direito": area("direito"),
        "q37_areas_dor_esquerdo": area("esquerdo"),
        "q38_padrao_abertura": (f"desvio_lateral_{lado_afetado}" if articular else rng.choice(["reto", "reto", "reto", "desvio_lateral_direito"])),
        "q38_padrao_abertura_outro": None,
        "q39a_abertura_sem_auxilio_sem_dor_mm": max(15, maxima - rng.randint(0, 10)),
        "q39b_abertura_maxima_sem_auxilio_mm": maxima,
        "q39c_abertura_maxima_com_auxilio_mm": maxima + rng.randint(1, 5),
        "q39d_trespasse_incisal_vertical_mm": rng.randint(1, 4),
        "q40a_ruido_abertura_direito": ruido["direito"],
        "q40a_ruido_abertura_esquerdo": ruido["esquerdo"],
        "q40a_estagio_abertura_mm": rng.randint(15, 30) if articular else None,
        "q40b_ruido_fechamento_direito": ruido["direito"],
        "q40b_ruido_fechamento_esquerdo": ruido["esquerdo"],
        "q40b_estagio_fechamento_mm": rng.randint(3, 15) if articular else None,
        "q41_dor_muscular": _lado_de(dor_musc["direito"], dor_musc["esquerdo"]),
        "q42_dor_articular": _lado_de(dor_art["direito"], dor_art["esquerdo"]),
        "q44_palpacao_muscular": palp_musc,
        "q45_palpacao_articular": palp_art,
    }
    return exame, lado_afetado


def _protese(rng: random.Random, perfil: str) -> tuple[dict, list[str]]:
    usuario = perfil in ("protese", "dtm_e_protese")
    if not usuario:
        return {
            "q46_tempo_perda_dentes": None, "q47_usuario_protese": False, "q47_tipos_protese": [],
            "q48_gosta_e_nao_gosta": None, "q49_expectativa_futura_protese": None,
        }, []
    tipos = rng.choice([["pt_dupla"], ["pt_unimaxilar"], ["ppr"], ["pt_unimaxilar", "ppr"]])
    return {
        "q46_tempo_perda_dentes": rng.choice(TEMPO_PERDA_DENTES),
        "q47_usuario_protese": True,
        "q47_tipos_protese": tipos,
        "q48_gosta_e_nao_gosta": rng.choice(GOSTA_PROTESE),
        "q49_expectativa_futura_protese": rng.choice(EXPECTATIVA_PROTESE),
    }, tipos


def _diagnostico(perfil: str, exame: dict, lado: str) -> dict:
    sem = "sem_diagnostico"
    d = {
        "grupo1_muscular": sem,
        "grupo2_disco_direita": sem, "grupo2_disco_esquerda": sem,
        "grupo3_articular_direita": sem, "grupo3_articular_esquerda": sem,
    }
    if perfil in ("dtm_muscular", "dtm_e_protese") and exame["q41_dor_muscular"] != "nenhuma":
        limitada = exame["q39a_abertura_sem_auxilio_sem_dor_mm"] < 40
        d["grupo1_muscular"] = "Ib_dor_miofascial_com_limitacao_abertura" if limitada else "Ia_dor_miofascial"
    if perfil == "dtm_articular":
        d[f"grupo2_disco_{'direita' if lado == 'direito' else 'esquerda'}"] = "IIa_com_reducao"
        if exame["q42_dor_articular"] in (lado, "ambos"):
            d[f"grupo3_articular_{'direita' if lado == 'direito' else 'esquerda'}"] = "IIIa_artralgia"
    return d


def _exame_extraoral(rng: random.Random, ruido: bool) -> dict:
    return {
        "q50_linha_sorriso": rng.choice(["alta", "media", "baixa"]),
        "q51_labios_competencia": rng.choice(["competente", "competente", "incompetente"]),
        "q51_labios_atividade": rng.choice(["ativos", "passivos"]),
        "q52_comprimento_labios": rng.choice(["longos", "medios", "curtos"]),
        "q53_largura_labios": rng.choice(["grossos", "medios", "finos"]),
        "q54_musculatura_facial": rng.choice(["normotonico", "hipertonico"]),
        "q55_proporcao_face": rng.choice(["mesofacial", "braquifacial", "dolicofacial"]),
        "q56_forma_face": rng.choice(["oval", "triangular", "quadrada"]),
        "q57_perfil_anteroposterior": rng.choice(["reto", "convexo", "concavo"]),
        "q58_perfil_vertical": rng.choice(["normodivergente", "hiperdivergente", "hipodivergente"]),
        "q59_abertura_bucal": None,
        "q60_ruido_articular": ["estalido"] if ruido else [],
    }


def _exame_intraoral(rng: random.Random, desdentado_total: bool) -> dict:
    dentado = not desdentado_total
    return {
        "q61_formato_lingua": rng.choice(["normal", "normal", "macroglossia"]),
        "q62_palato_duro": rng.choice(["normal", "profundo", "raso"]),
        "q63_saliva": rng.choice(["fluida", "fluida", "viscosa"]),
        "q64_overjet_mm": rng.randint(1, 5) if dentado else None,
        "q64_overbite_mm": rng.randint(1, 4) if dentado else None,
        "q65_oclusao_linha_media": rng.choice(["Coincidente.", "Desviada 2 mm para a direita."]) if dentado else None,
        "q66_relacao_posteriores_direito": rng.choice(["classe_I", "classe_I", "classe_II"]) if dentado else None,
        "q66_relacao_posteriores_esquerdo": rng.choice(["classe_I", "classe_I", "classe_II"]) if dentado else None,
        "q67_mordida": [],
        "q68_estabilidade_oclusal": ["suporte_oclusal"] if dentado else [],
        "q68_dvr_mm": rng.randint(62, 72) if desdentado_total else None,
        "q68_dvo_mm": rng.randint(58, 69) if desdentado_total else None,
        "q68_dimensao_vertical": rng.choice(["normal", "diminuida"]),
        "q69_contato_prematuro": None,
        "q70_lateralidade_esquerda": rng.choice(["guia_canino", "funcao_em_grupo_parcial"]) if dentado else None,
        "q71_lateralidade_direita": rng.choice(["guia_canino", "funcao_em_grupo_parcial"]) if dentado else None,
        "q72_protrusiva": rng.choice(["com_guia", "sem_guia"]) if dentado else None,
        "q73_interferencia": [],
        "q74_escovacao": sorted(rng.sample(["lingua", "mucosa", "labios"], rng.randint(0, 2))),
        "q75_formato_arco": rng.choice(["quadrado", "ovoide", "triangular"]) if desdentado_total else None,
        "q75_forma_rebordo": rng.choice(["vertentes_paralelas", "afiladas"]) if desdentado_total else None,
        "q75_altura_rebordo": rng.choice(["medio", "baixo", "reabsorvido"]) if desdentado_total else None,
        "q75_espessura_mucosa": rng.choice(["fina", "normal"]) if desdentado_total else None,
    }


CATEGORIAS_POR_PERFIL = {
    "dtm_muscular": ["orientacoes_autocuidado", "placa_oclusal"],
    "dtm_articular": ["orientacoes_autocuidado", "placa_oclusal", "exercicios_mandibulares"],
    "protese": ["protese_total"],
    "dtm_e_protese": ["orientacoes_autocuidado", "protese_total"],
    "sem_dtm": ["protese_parcial_removivel"],
}


def gerar_caso(rng: random.Random, numero: int, perfil: str) -> Caso:
    caso = Caso(numero=numero, perfil=perfil, sexo=rng.choice(["F", "F", "M"]),
                idade=rng.randint(45, 80) if "protese" in perfil else rng.randint(18, 60))
    protese, tipos = _protese(rng, perfil)
    desdentado_total = "pt_dupla" in tipos
    questionario = _questionario_dtm(rng, perfil)
    exame, lado = _exame_dtm(rng, perfil)
    categorias = CATEGORIAS_POR_PERFIL[perfil]

    caso.gabarito = {
        "queixa_principal": {"texto": rng.choice(QUEIXAS[perfil])},
        "historia_medica": _historia_medica(rng, perfil, caso.sexo, caso.idade),
        "historia_odontologica": _historia_odontologica(rng, desdentado_total),
        "questionario_dtm": questionario,
        "condicao_dtm": {"texto": None},
        "exame_dtm": exame,
        "protese": protese,
        "rdc_caracteristicas_relatadas": {
            "estalido": questionario["q25_estalos"],
            "crepitacao": questionario["q26_crepitacao"],
            "apertamento_rangido_noturno": questionario["q27_bruxismo_noturno"],
            "apertamento_rangido_diurno": questionario["q28_bruxismo_diurno"],
            "mordida_desconfortavel": rng.random() < 0.2,
            "rigidez_pela_manha": questionario["q29_mandibula_cansada_manha"],
            "zumbido": rng.random() < 0.1,
        },
        "diagnostico_eixo1": _diagnostico(perfil, exame, lado),
        "exame_extraoral": _exame_extraoral(rng, questionario["q25_estalos"]),
        "exame_intraoral": _exame_intraoral(rng, desdentado_total),
        "tecidos_moles": {
            "mucosa_jugal": _talvez(rng, 0.4, "Linha alba bilateral."),
            "mucosa_labial": None,
            "palato_duro_mole": None,
            "presenca_lesao": "Ausente.",
            "lingua": _talvez(rng, 0.3, "Língua endentada."),
            "assoalho_boca": None,
            "gengiva_rebordo": _talvez(rng, 0.5, "Rebordo com mucosa íntegra.") if tipos else None,
        },
        "condicao_periodontal": {"texto": None if desdentado_total else rng.choice(PERIODONTAL)},
        "observacoes": {"texto": _talvez(rng, 0.3, rng.choice(OBSERVACOES))},
        "plano_tratamento": {
            "texto": "Plano conforme categorias; reavaliação em 30 dias.",
            "categorias": categorias,
        },
    }
    caso.desafios = sorted(rng.sample(list(DESAFIOS), rng.randint(1, 3)))
    return caso


# ---------------------------------------------------------------------------
# Roteiro para quem escreve a narrativa
# ---------------------------------------------------------------------------

ROTULOS = {
    "cardiaca": "problema cardíaco", "respiratoria": "problema respiratório", "neurologica": "problema neurológico",
    "gastrointestinal": "problema gastrointestinal", "nenhuma": "nenhum problema de saúde sistêmico",
    "periodontal": "tratamento periodontal", "ortodontico": "tratamento ortodôntico", "restaurador": "restaurações",
    "endodontico": "tratamento de canal", "cirurgia_bucal": "cirurgia bucal",
    "sangramento_na_escovacao": "sangramento na escovação", "mau_halito": "mau hálito",
    "dificuldade_para_mastigar": "dificuldade para mastigar", "dentes_amolecidos": "dentes amolecidos",
    "media": "média", "macia": "macia", "dura": "dura",
    "fio_dental": "fio dental", "bochecho": "enxaguante bucal", "escova_interdental": "escova interdental",
    "pt_dupla": "dentadura superior e inferior", "pt_unimaxilar": "dentadura em uma arcada",
    "ppr": "prótese parcial removível",
}

TITULOS_CAMPOS = {
    "queixa_principal.texto": "Queixa principal",
    "historia_medica.q1_sistemas": "Problemas de saúde",
    "historia_medica.q1_outras": "Outras condições",
    "historia_medica.q2_historico_cirurgico": "Cirurgias",
    "historia_medica.q3_alergias": "Alergias",
    "historia_medica.q4_usa_medicamento": "Usa medicamento?",
    "historia_medica.q4_medicamentos": "Medicamentos e há quanto tempo",
    "historia_medica.q5_sono": "Sono",
    "historia_medica.q5_substancias": "Álcool, drogas, cigarro",
    "historia_medica.q5_trabalho": "Trabalho",
    "historia_medica.q5_ansiedade": "Ansiedade/depressão/preocupação",
    "historia_medica.q5_vida_pessoal": "Vida pessoal",
    "historia_medica.q6_tratamento_odontologico_6m": "Tratamento odontológico nos últimos 6 meses",
    "historia_odontologica.q7_tratamentos_previos": "Tratamentos odontológicos anteriores",
    "historia_odontologica.q8_alteracoes": "Alterações percebidas",
    "historia_odontologica.q9_escovacoes_por_dia": "Escovações por dia",
    "historia_odontologica.q9_tipo_escova": "Tipo de escova",
    "historia_odontologica.q9_acessorios": "Usa também",
    "historia_odontologica.q10_respirador_bucal": "Respira pela boca?",
    "historia_odontologica.q11_boca_seca": "Sente boca seca?",
    "protese.q46_tempo_perda_dentes": "Há quanto tempo perdeu os dentes",
    "protese.q47_usuario_protese": "Usa prótese?",
    "protese.q47_tipos_protese": "Tipo de prótese",
    "protese.q48_gosta_e_nao_gosta": "Do que gosta e não gosta na prótese",
    "protese.q49_expectativa_futura_protese": "O que espera da nova prótese",
    "observacoes.texto": "Observações",
}


def _descrever(valor) -> str:
    if isinstance(valor, bool):
        return "sim" if valor else "não"
    if isinstance(valor, list):
        return ", ".join(ROTULOS.get(v, v) for v in valor)
    return ROTULOS.get(valor, str(valor)) if isinstance(valor, str) else str(valor)


def roteiro(caso: Caso) -> str:
    g = caso.gabarito
    mencionar, nao_mencionar = [], []
    for caminho, titulo in TITULOS_CAMPOS.items():
        secao, campo = caminho.split(".")
        valor = g[secao][campo]
        if valor is None or valor == []:
            nao_mencionar.append(titulo)
        else:
            mencionar.append(f"- **{titulo}:** {_descrever(valor)}")

    sexo = "Paciente do sexo feminino" if caso.sexo == "F" else "Paciente do sexo masculino"
    linhas = [
        f"# Roteiro do {caso.identificador.replace('_', ' ')}",
        "",
        f"{sexo}, {caso.idade} anos. Conjunto: **{caso.divisao}**.",
        "",
        "Escreva, em até uma página, o relato que o acadêmico ditaria ao final da entrevista,",
        "em linguagem natural e em primeira pessoa do acadêmico (\"a paciente relata que...\").",
        "Não copie as frases abaixo literalmente: reformule como numa conversa real.",
        "",
        "## Fatos que devem aparecer",
        "",
        *mencionar,
        "",
        "## Não mencione",
        "",
        "Estes campos estão vazios no gabarito; se aparecerem no texto, o gabarito deixa de valer:",
        "",
        *[f"- {t}" for t in nao_mencionar],
        "",
        "## Desafios de linguagem deste caso",
        "",
        *[f"- {DESAFIOS[d]}" for d in caso.desafios],
        "",
        "Salve o texto em `narrativa.txt` nesta mesma pasta.",
        "",
    ]
    return "\n".join(linhas)


# ---------------------------------------------------------------------------

def gerar_casos(n: int, semente: int, casos_ajuste: int) -> list[Caso]:
    rng = random.Random(semente)
    perfis = [PERFIS[i % len(PERFIS)] for i in range(n)]
    rng.shuffle(perfis)
    casos = [gerar_caso(rng, i + 1, perfil) for i, perfil in enumerate(perfis)]
    for caso in rng.sample(casos, casos_ajuste):
        caso.divisao = "ajuste"
    for caso in casos:
        problemas = erros("ficha-inicial", caso.gabarito)
        if problemas:
            raise ValueError(f"{caso.identificador} inválido: {problemas[:3]}")
    return casos


def salvar(casos: list[Caso], pasta: Path) -> None:
    pasta.mkdir(parents=True, exist_ok=True)
    with (pasta / "indice.csv").open("w", newline="", encoding="utf-8") as f:
        escritor = csv.writer(f)
        escritor.writerow(["caso", "perfil", "sexo", "idade", "divisao", "desafios"])
        for c in casos:
            destino = pasta / c.identificador
            destino.mkdir(exist_ok=True)
            (destino / "gabarito.json").write_text(
                json.dumps(c.gabarito, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            (destino / "roteiro.md").write_text(roteiro(c), encoding="utf-8")
            escritor.writerow([c.identificador, c.perfil, c.sexo, c.idade, c.divisao, ";".join(c.desafios)])


def main() -> None:
    raiz = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--n", type=int, default=40, help="número de casos (padrão: 40)")
    parser.add_argument("--semente", type=int, default=2026, help="semente aleatória, para reprodutibilidade")
    parser.add_argument("--ajuste", type=int, default=10, help="casos reservados para ajuste de prompts (padrão: 10)")
    parser.add_argument("--saida", type=Path, default=raiz / "dados" / "sinteticos" / "casos")
    args = parser.parse_args()

    casos = gerar_casos(args.n, args.semente, args.ajuste)
    salvar(casos, args.saida)
    print(f"{len(casos)} casos válidos gerados em {args.saida}")


if __name__ == "__main__":
    main()
