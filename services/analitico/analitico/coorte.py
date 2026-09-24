"""Indicadores de coorte (seção 4.8.2 do TCC).

As funções recebem DataFrames com as mesmas colunas das visões do esquema pseudonimizado:
  pacientes:    pseudo_id, faixa_etaria_inicio, sexo, dias_desde_ultima_consulta
  fichas:       pseudo_id, dias_desde_inicio, tipo_ficha, dados_estruturados (dict)
  tratamentos:  pseudo_id, categoria, inicio_dias, fim_dias
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats

from .indicadores import indicadores_ficha

#: sem retorno há mais que isso, com tratamento em aberto, o paciente é considerado em abandono
LIMIAR_ABANDONO_DIAS = 60
#: critérios IMMPACT (Dworkin et al., 2008) de melhora moderadamente importante e substancial
LIMIARES_RESPOSTA = (30, 50)
#: grupos com menos pacientes que isso não recebem teste estatístico
MINIMO_TESTE = 5

CARACTERISTICAS = {
    "estalido": ("rdc_caracteristicas_relatadas", "estalido"),
    "crepitacao": ("rdc_caracteristicas_relatadas", "crepitacao"),
    "apertamento_rangido_noturno": ("rdc_caracteristicas_relatadas", "apertamento_rangido_noturno"),
    "apertamento_rangido_diurno": ("rdc_caracteristicas_relatadas", "apertamento_rangido_diurno"),
    "mordida_desconfortavel": ("rdc_caracteristicas_relatadas", "mordida_desconfortavel"),
    "rigidez_pela_manha": ("rdc_caracteristicas_relatadas", "rigidez_pela_manha"),
    "zumbido": ("rdc_caracteristicas_relatadas", "zumbido"),
    "cefaleia_6m": ("questionario_dtm", "q35_cefaleia_6m"),
}
DIAGNOSTICOS = ["grupo1_muscular", "grupo2_disco_direita", "grupo2_disco_esquerda",
                "grupo3_articular_direita", "grupo3_articular_esquerda"]


def _num(x: Any) -> Any:
    """Converte para tipos serializáveis em JSON (NaN vira None)."""
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (float, np.floating)):
        # 4 algarismos significativos (e não casas decimais): valores-p muito pequenos não viram zero
        return None if math.isnan(x) else float(f"{float(x):.4g}")
    return x


def tabela_indicadores(fichas: pd.DataFrame) -> pd.DataFrame:
    """Uma linha por ficha, com os indicadores individuais."""
    linhas = [
        {"pseudo_id": f.pseudo_id, "dias_desde_inicio": f.dias_desde_inicio, "tipo_ficha": f.tipo_ficha,
         **indicadores_ficha(f.dados_estruturados or {})}
        for f in fichas.itertuples()
    ]
    return pd.DataFrame(linhas).sort_values(["pseudo_id", "dias_desde_inicio"], ignore_index=True)


def evolucao(indicadores: pd.DataFrame, tratamentos: pd.DataFrame, pacientes: pd.DataFrame,
             desfecho: str = "icd") -> pd.DataFrame:
    """Linha de base (ficha inicial) x última consulta de retorno, por paciente.

    O grupo de tratamento é a categoria do primeiro tratamento registrado. A variação relativa é
    positiva quando a dor diminui e só é calculada quando a linha de base é maior que zero.
    """
    base = (indicadores[indicadores.tipo_ficha == "ficha-inicial"]
            .sort_values("dias_desde_inicio").groupby("pseudo_id").first()[[desfecho]]
            .rename(columns={desfecho: "base"}))
    retornos = indicadores[indicadores.tipo_ficha == "ficha-retorno"].sort_values("dias_desde_inicio")
    final = retornos.groupby("pseudo_id").agg(final=(desfecho, "last"), dias_final=("dias_desde_inicio", "last"),
                                              retornos=("dias_desde_inicio", "size"))
    primeiro = tratamentos.sort_values("inicio_dias").groupby("pseudo_id").first()[["categoria", "fim_dias"]]
    ev = (base.join(final, how="left").join(primeiro, how="left")
          .join(pacientes.set_index("pseudo_id")[["dias_desde_ultima_consulta"]], how="left"))
    ev["retornos"] = ev["retornos"].fillna(0).astype(int)
    ev["variacao_rel"] = np.where(ev["base"] > 0, (ev["base"] - ev["final"]) / ev["base"] * 100, np.nan)
    ev["concluiu"] = ev["fim_dias"].notna()
    ev["abandono"] = ev["fim_dias"].isna() & (ev["dias_desde_ultima_consulta"] > LIMIAR_ABANDONO_DIAS)
    return ev.rename(columns={"categoria": "grupo"}).reset_index()


def rank_biserial_pareado(antes: np.ndarray, depois: np.ndarray) -> float | None:
    """Tamanho de efeito do teste de Wilcoxon pareado (correlação rank-bisserial, -1 a 1)."""
    d = np.asarray(antes, float) - np.asarray(depois, float)
    d = d[d != 0]
    if len(d) == 0:
        return None
    postos = stats.rankdata(np.abs(d))
    return float((postos[d > 0].sum() - postos[d < 0].sum()) / postos.sum())


def _intervalo_media(x: np.ndarray) -> tuple[float | None, float | None]:
    if len(x) < 2:
        return None, None
    meia = stats.t.ppf(0.975, len(x) - 1) * x.std(ddof=1) / math.sqrt(len(x))
    return x.mean() - meia, x.mean() + meia


def comparar_tratamentos(ev: pd.DataFrame, somente_concluintes: bool = False) -> dict[str, Any]:
    """Variação da dor por grupo (Wilcoxon pareado) e entre grupos (Kruskal-Wallis)."""
    dados = ev[ev["final"].notna() & ev["grupo"].notna()]
    if somente_concluintes:
        dados = dados[dados["concluiu"]]
    grupos = []
    for nome, g in dados.groupby("grupo"):
        rel = g["variacao_rel"].dropna().to_numpy()
        item: dict[str, Any] = {
            "grupo": nome, "n": len(g),
            "base_mediana": g["base"].median(), "final_mediana": g["final"].median(),
            "reducao_media_pct": rel.mean() if len(rel) else None,
            "reducao_ic95": list(_intervalo_media(rel)),
            "reducao_mediana_pct": np.median(rel) if len(rel) else None,
            **{f"respondedores_{l}_pct": (rel >= l).mean() * 100 if len(rel) else None for l in LIMIARES_RESPOSTA},
            "wilcoxon_p": None, "efeito_rank_biserial": rank_biserial_pareado(g["base"], g["final"]),
        }
        if len(g) >= MINIMO_TESTE and (g["base"] != g["final"]).any():
            item["wilcoxon_p"] = stats.wilcoxon(g["base"], g["final"]).pvalue
        grupos.append(item)

    entre: dict[str, Any] = {"teste": "kruskal_wallis", "h": None, "p": None, "epsilon2": None}
    amostras = [g["variacao_rel"].dropna().to_numpy() for _, g in dados.groupby("grupo")]
    amostras = [a for a in amostras if len(a) >= MINIMO_TESTE]
    if len(amostras) >= 2:
        h, p = stats.kruskal(*amostras)
        n = sum(len(a) for a in amostras)
        entre.update(h=h, p=p, epsilon2=h / (n - 1))
    return {
        "desfecho": "variacao relativa da intensidade caracteristica da dor",
        "somente_concluintes": somente_concluintes,
        "grupos": [{k: (_num(v) if not isinstance(v, list) else [_num(x) for x in v]) for k, v in g.items()} for g in grupos],
        "entre_grupos": {k: _num(v) for k, v in entre.items()},
    }


def _valor(dados: dict[str, Any] | None, caminho: tuple[str, str]) -> Any:
    return ((dados or {}).get(caminho[0]) or {}).get(caminho[1])


def prevalencias(fichas: pd.DataFrame) -> list[dict[str, Any]]:
    """Proporção de pacientes com cada característica relatada, na ficha inicial."""
    iniciais = fichas[fichas.tipo_ficha == "ficha-inicial"]
    saida = []
    for nome, caminho in CARACTERISTICAS.items():
        valores = [v for v in (_valor(d, caminho) for d in iniciais.dados_estruturados) if v is not None]
        saida.append({"caracteristica": nome, "n": len(valores),
                      "prevalencia_pct": _num(sum(valores) / len(valores) * 100) if valores else None})
    return saida


def diagnosticos(fichas: pd.DataFrame) -> dict[str, dict[str, int]]:
    """Distribuição dos diagnósticos do Eixo I registrados pelos professores."""
    iniciais = fichas[fichas.tipo_ficha == "ficha-inicial"]
    saida: dict[str, dict[str, int]] = {}
    for grupo in DIAGNOSTICOS:
        valores = [_valor(d, ("diagnostico_eixo1", grupo)) for d in iniciais.dados_estruturados]
        saida[grupo] = {str(k): int(v) for k, v in pd.Series([v for v in valores if v]).value_counts().items()}
    return saida


def correlacoes(indicadores: pd.DataFrame) -> list[dict[str, Any]]:
    """Correlações de Spearman na linha de base entre medidas estruturadas."""
    base = indicadores[indicadores.tipo_ficha == "ficha-inicial"]
    pares = [("icd", "sitios_dolorosos"), ("icd", "atividades_limitadas"), ("escore_incapacidade", "atividades_limitadas"),
             ("icd", "abertura_max_mm")]
    saida = []
    for x, y in pares:
        d = base[[x, y]].dropna()
        variam = d[x].nunique() > 1 and d[y].nunique() > 1  # série constante: correlação indefinida
        rho, p = stats.spearmanr(d[x], d[y]) if len(d) >= MINIMO_TESTE and variam else (np.nan, np.nan)
        saida.append({"x": x, "y": y, "n": len(d), "rho": _num(rho), "p": _num(p)})
    return saida


def abandono(ev: pd.DataFrame) -> list[dict[str, Any]]:
    return [{"grupo": nome, "n": len(g), "abandono_pct": _num(g["abandono"].mean() * 100),
             "sem_retorno": int((g["retornos"] == 0).sum())}
            for nome, g in ev[ev["grupo"].notna()].groupby("grupo")]


def resumo_coorte(pacientes: pd.DataFrame, fichas: pd.DataFrame, tratamentos: pd.DataFrame) -> dict[str, Any]:
    """Todos os indicadores de coorte, em formato serializável em JSON."""
    ind = tabela_indicadores(fichas)
    ev = evolucao(ind, tratamentos, pacientes)
    return {
        "pacientes": int(len(pacientes)),
        "fichas": {str(k): int(v) for k, v in fichas.tipo_ficha.value_counts().items()},
        "prevalencias": prevalencias(fichas),
        "diagnosticos": diagnosticos(fichas),
        "tratamentos": comparar_tratamentos(ev),
        "tratamentos_concluintes": comparar_tratamentos(ev, somente_concluintes=True),
        "abandono": abandono(ev),
        "correlacoes": correlacoes(ind),
        "variacoes": [{"grupo": r.grupo, "variacao_rel": _num(r.variacao_rel), "concluiu": bool(r.concluiu)}
                      for r in ev.itertuples() if r.grupo is not None and not pd.isna(r.variacao_rel)],
    }
