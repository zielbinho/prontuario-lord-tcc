"""Coorte sintética longitudinal com efeitos PROGRAMADOS (Experimento D, seção 4.9.5 do TCC).

Cada paciente tem uma ficha inicial coerente (gerada por gerar_casos, perfis com DTM e dor),
recebe um tratamento sorteado e retorna em dias fixos com a dor reduzida segundo o efeito
programado do seu grupo, mais variação individual, ruído de medida e abandono. Como o efeito é
conhecido, o módulo analítico deve recuperá-lo: é assim que o pipeline é validado.

Os dados são fictícios e servem apenas para validar o cálculo; não permitem conclusão clínica.

Uso (na pasta ferramentas):
    ..\\.venv\\Scripts\\python -m sinteticos.coorte --n 150 --semente 2026
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import random
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from pathlib import Path

from .gerar_casos import gerar_caso

#: redução média programada da intensidade da dor ao fim do tratamento, por grupo
EFEITOS = {"placa_oclusal": 0.40, "laser_baixa_intensidade": 0.25, "orientacoes_autocuidado": 0.10}
PERFIS_COM_DTM = ["dtm_muscular", "dtm_articular", "dtm_e_protese"]
DIAS_RETORNO = [30, 60, 90, 120, 180]


@dataclass
class Parametros:
    n: int = 150
    semente: int = 2026
    efeitos: dict[str, float] = field(default_factory=lambda: dict(EFEITOS))
    #: desvio-padrão da resposta individual em torno do efeito do grupo
    dp_resposta: float = 0.15
    #: o efeito cresce linearmente até este dia e depois se mantém
    dias_ate_efeito_pleno: int = 90
    #: desvio-padrão do ruído de medida nas escalas de 0 a 10
    dp_ruido: float = 0.7
    prob_abandono: float = 0.20
    variacao_data_retorno: int = 7
    data_referencia: str = "2026-09-24"


@dataclass
class Consulta:
    data: str
    tipo_ficha: str
    dados: dict


@dataclass
class PacienteCoorte:
    codigo: str
    perfil: str
    sexo: str
    idade: int
    grupo: str
    efeito_individual: float
    #: número de retornos antes de abandonar (None: conclui o tratamento)
    abandona_apos: int | None
    consultas: list[Consulta]
    tratamento: dict


def _limitar(x: float, minimo: float, maximo: float) -> float:
    return max(minimo, min(maximo, x))


def _reducao(p: Parametros, efeito: float, dia: int) -> float:
    return efeito * min(dia / p.dias_ate_efeito_pleno, 1.0)


def _escala(rng: random.Random, p: Parametros, base: int, reducao: float) -> int:
    return int(round(_limitar(base * (1 - reducao) + rng.gauss(0, p.dp_ruido), 0, 10)))


def _ficha_retorno(rng: random.Random, p: Parametros, inicial: dict, reducao: float, ultimo: bool, abandona: bool) -> dict:
    q = inicial["questionario_dtm"]
    e = inicial["exame_dtm"]
    mm = lambda x: int(round(_limitar(x, 0, 80)))  # noqa: E731
    melhora = lambda atual, alvo: atual + max(0, alvo - atual) * reducao + rng.gauss(0, 1.5)  # noqa: E731
    b = mm(melhora(e["q39b_abertura_maxima_sem_auxilio_mm"], 48))
    a = min(mm(melhora(e["q39a_abertura_sem_auxilio_sem_dor_mm"], 42)), b)
    c = max(mm(melhora(e["q39c_abertura_maxima_com_auxilio_mm"], 51)), b + 1)
    palpar = lambda grupo: {  # noqa: E731
        sitio: {lado: int(round(_limitar(v * (1 - reducao) + rng.gauss(0, 0.35), 0, 3))) for lado, v in lados.items()}
        for sitio, lados in e[grupo].items()
    }
    if abandona:
        adesao = rng.choice(["parcial", "nao_aderiu"])
    else:
        adesao = "total" if rng.random() < 0.8 else "parcial"
    return {
        "dor": {
            "q16_dor_atual": _escala(rng, p, q["q16_dor_atual"], reducao),
            "q17_pior_dor": _escala(rng, p, q["q17_pior_dor_6m"], reducao),
            "q18_dor_media": _escala(rng, p, q["q18_dor_media_6m"], reducao),
            "q19_dias_afastamento": int(round((q["q19_dias_afastamento_6m"] or 0) * (1 - reducao))),
            "q20_interferencia_atividades": _escala(rng, p, q["q20_interferencia_atividades"], reducao),
            "q21_mudanca_lazer_social": _escala(rng, p, q["q21_mudanca_lazer_social"], reducao),
            "q22_mudanca_trabalho": _escala(rng, p, q["q22_mudanca_trabalho"], reducao),
        },
        "exame": {
            "q39a_abertura_sem_auxilio_sem_dor_mm": a,
            "q39b_abertura_maxima_sem_auxilio_mm": b,
            "q39c_abertura_maxima_com_auxilio_mm": c,
            "q44_palpacao_muscular": palpar("q44_palpacao_muscular"),
            "q45_palpacao_articular": palpar("q45_palpacao_articular"),
        },
        "acompanhamento": {"adesao_tratamento": adesao, "intercorrencias": None, "relato_paciente": None},
        "conduta": {"texto": "Alta do tratamento." if ultimo else "Mantida a conduta; retorno agendado."},
    }


def _ficha_inicial_com_dor(rng: random.Random, numero: int) -> tuple[str, str, int, dict]:
    while True:
        caso = gerar_caso(rng, numero, rng.choice(PERFIS_COM_DTM))
        q = caso.gabarito["questionario_dtm"]
        if q["q12_dor_face_4_semanas"] and min(q["q16_dor_atual"], q["q17_pior_dor_6m"], q["q18_dor_media_6m"]) > 0:
            return caso.perfil, caso.sexo, caso.idade, caso.gabarito


def gerar_coorte(p: Parametros = Parametros()) -> list[PacienteCoorte]:
    rng = random.Random(p.semente)
    referencia = date.fromisoformat(p.data_referencia)
    grupos = [list(p.efeitos)[i % len(p.efeitos)] for i in range(p.n)]
    rng.shuffle(grupos)  # alocação equilibrada e aleatória
    coorte = []
    for i, grupo in enumerate(grupos, start=1):
        perfil, sexo, idade, inicial = _ficha_inicial_com_dor(rng, i)
        inicial["plano_tratamento"]["categorias"] = [grupo]
        efeito = _limitar(rng.gauss(p.efeitos[grupo], p.dp_resposta), -0.2, 0.95)
        abandona_apos = rng.randint(0, 3) if rng.random() < p.prob_abandono else None
        # todas as consultas previstas ficam no passado em relação à data de referência
        inicio = referencia - timedelta(days=rng.randint(200, 540))
        consultas = [Consulta(inicio.isoformat(), "ficha-inicial", inicial)]
        retornos = DIAS_RETORNO if abandona_apos is None else DIAS_RETORNO[:abandona_apos]
        for k, dia in enumerate(retornos):
            dia_real = dia + rng.randint(-p.variacao_data_retorno, p.variacao_data_retorno)
            ultimo = abandona_apos is None and k == len(retornos) - 1
            dados = _ficha_retorno(rng, p, inicial, _reducao(p, efeito, dia_real), ultimo, abandona_apos is not None)
            consultas.append(Consulta((inicio + timedelta(days=dia_real)).isoformat(), "ficha-retorno", dados))
        tratamento = {"categoria": grupo, "inicio": inicio.isoformat(),
                      "fim": consultas[-1].data if abandona_apos is None else None}
        coorte.append(PacienteCoorte(f"C{i:03d}", perfil, sexo, idade, grupo, round(efeito, 4), abandona_apos, consultas, tratamento))
    return coorte


# --- mesmas projeções das visões do esquema analítico (apps/api/migrations/003 e 004) -----------

def _sem_nulos(valor):
    """Equivalente ao jsonb_strip_nulls do PostgreSQL."""
    if isinstance(valor, dict):
        return {k: _sem_nulos(v) for k, v in valor.items() if v is not None}
    if isinstance(valor, list):
        return [_sem_nulos(v) for v in valor]
    return valor


def _estruturados(c: Consulta) -> dict:
    d = c.dados
    exame_dtm = {k: v for k, v in (d.get("exame_dtm") or {}).items() if k != "q38_padrao_abertura_outro"} or None
    return _sem_nulos({
        "questionario_dtm": d.get("questionario_dtm"),
        "exame_dtm": exame_dtm,
        "rdc_caracteristicas_relatadas": d.get("rdc_caracteristicas_relatadas"),
        "diagnostico_eixo1": d.get("diagnostico_eixo1"),
        "categorias_tratamento": (d.get("plano_tratamento") or {}).get("categorias"),
        "usuario_protese": (d.get("protese") or {}).get("q47_usuario_protese"),
        "tipos_protese": (d.get("protese") or {}).get("q47_tipos_protese"),
        "dor": d.get("dor"),
        "exame": d.get("exame"),
        "adesao_tratamento": (d.get("acompanhamento") or {}).get("adesao_tratamento"),
    })


def para_visoes(coorte: list[PacienteCoorte], referencia: str):
    """DataFrames com as colunas das visões analíticas, sem passar pelo banco."""
    import pandas as pd

    ref = date.fromisoformat(referencia)
    pacientes, fichas, tratamentos = [], [], []
    for pac in coorte:
        inicio = date.fromisoformat(pac.consultas[0].data)
        ultima = date.fromisoformat(pac.consultas[-1].data)
        pacientes.append({"pseudo_id": pac.codigo, "faixa_etaria_inicio": pac.idade // 10 * 10, "sexo": pac.sexo,
                          "dias_desde_ultima_consulta": (ref - ultima).days})
        for c in pac.consultas:
            fichas.append({"pseudo_id": pac.codigo, "dias_desde_inicio": (date.fromisoformat(c.data) - inicio).days,
                           "tipo_ficha": c.tipo_ficha, "dados_estruturados": _estruturados(c)})
        t = pac.tratamento
        tratamentos.append({"pseudo_id": pac.codigo, "categoria": t["categoria"],
                            "inicio_dias": (date.fromisoformat(t["inicio"]) - inicio).days,
                            "fim_dias": (date.fromisoformat(t["fim"]) - inicio).days if t["fim"] else None})
    return pd.DataFrame(pacientes), pd.DataFrame(fichas), pd.DataFrame(tratamentos)


def salvar(coorte: list[PacienteCoorte], p: Parametros, pasta: Path) -> None:
    pasta.mkdir(parents=True, exist_ok=True)
    (pasta / "coorte.json").write_text(json.dumps([asdict(x) for x in coorte], ensure_ascii=False), encoding="utf-8")
    (pasta / "parametros.json").write_text(json.dumps(asdict(p), ensure_ascii=False, indent=2), encoding="utf-8")
    with open(pasta / "indice.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["codigo", "grupo", "efeito_individual", "abandona_apos", "consultas"])
        for x in coorte:
            w.writerow([x.codigo, x.grupo, x.efeito_individual, "" if x.abandona_apos is None else x.abandona_apos, len(x.consultas)])


def carregar(pasta: Path) -> list[PacienteCoorte]:
    brutos = json.loads((pasta / "coorte.json").read_text(encoding="utf-8"))
    return [PacienteCoorte(**{**b, "consultas": [Consulta(**c) for c in b["consultas"]]}) for b in brutos]


def main() -> None:
    raiz = Path(__file__).resolve().parents[2]
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--n", type=int, default=Parametros.n)
    ap.add_argument("--semente", type=int, default=Parametros.semente)
    ap.add_argument("--saida", type=Path, default=raiz / "dados" / "sinteticos" / "coorte")
    args = ap.parse_args()
    p = Parametros(n=args.n, semente=args.semente)
    coorte = gerar_coorte(p)
    salvar(coorte, p, args.saida)
    consultas = sum(len(x.consultas) for x in coorte)
    print(f"{len(coorte)} pacientes, {consultas} consultas ({consultas / len(coorte):.1f} por paciente) em {args.saida}")


if __name__ == "__main__":
    main()
