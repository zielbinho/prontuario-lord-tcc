"""Experimento D (seção 4.9.5 do TCC): o módulo analítico recupera os efeitos programados?

Aplica o módulo analítico à coorte sintética e compara, por grupo, a redução da dor estimada com
a redução programada no gerador. Duas fontes, que devem dar o mesmo resultado:
  --fonte offline  DataFrames montados direto da coorte, com as colunas das visões analíticas;
  --fonte banco    as próprias visões do esquema pseudonimizado, lidas com o papel lord_analitico
                   (exige a API de desenvolvimento ter carregado a coorte: COORTE=1 npm run dev -w @lord/api).

Uso (na pasta ferramentas):
    ..\\.venv\\Scripts\\python experimento_d.py --fonte offline
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from analitico.coorte import LIMIAR_ABANDONO_DIAS, evolucao, resumo_coorte, tabela_indicadores
from sinteticos.coorte import Parametros, carregar, para_visoes

RAIZ = Path(__file__).resolve().parents[1]
ROTULOS = {"placa_oclusal": "Placa oclusal", "laser_baixa_intensidade": "Laser de baixa intensidade",
           "orientacoes_autocuidado": "Orientações de autocuidado"}
ROTULOS_DUAS_LINHAS = {"placa_oclusal": "Placa\noclusal", "laser_baixa_intensidade": "Laser de\nbaixa intensidade",
                       "orientacoes_autocuidado": "Orientações de\nautocuidado"}


def visoes(fonte: str, pasta_coorte: Path, parametros: Parametros):
    if fonte == "offline":
        return para_visoes(carregar(pasta_coorte), parametros.data_referencia)
    from analitico.fonte import carregar_visoes

    v = carregar_visoes(nomes=("pacientes", "fichas", "tratamentos"))
    return v["pacientes"], v["fichas"], v["tratamentos"]


def comparar(resumo: dict, coorte, parametros: Parametros) -> list[dict]:
    """Efeito programado x efeito recuperado, por grupo, entre os pacientes que concluíram."""
    concl = {g["grupo"]: g for g in resumo["tratamentos_concluintes"]["grupos"]}
    todos = {g["grupo"]: g for g in resumo["tratamentos"]["grupos"]}
    aband = {a["grupo"]: a for a in resumo["abandono"]}
    linhas = []
    for grupo, efeito in parametros.efeitos.items():
        membros = [p for p in coorte if p.grupo == grupo]
        realizado = np.mean([p.efeito_individual for p in membros if p.abandona_apos is None]) * 100
        c = concl[grupo]
        ic = c["reducao_ic95"]
        linhas.append({
            "grupo": grupo,
            "reducao_programada_pct": efeito * 100,
            # média dos efeitos individuais sorteados: o alvo exato da amostra, sem erro de medida
            "reducao_sorteada_pct": round(realizado, 2),
            "n_concluintes": c["n"],
            "reducao_estimada_pct": c["reducao_media_pct"],
            "ic95": ic,
            "ic95_contem_programada": ic[0] <= efeito * 100 <= ic[1],
            "reducao_estimada_todos_pct": todos[grupo]["reducao_media_pct"],
            "n_com_retorno": todos[grupo]["n"],
            "wilcoxon_p": c["wilcoxon_p"],
            "efeito_rank_biserial": c["efeito_rank_biserial"],
            "respondedores_30_pct": c["respondedores_30_pct"],
            "respondedores_50_pct": c["respondedores_50_pct"],
            "abandono_programado_pct": round(np.mean([p.abandona_apos is not None for p in membros]) * 100, 2),
            "abandono_detectado_pct": aband[grupo]["abandono_pct"],
        })
    return linhas


def figuras(pacientes, fichas, tratamentos, resumo: dict, parametros: Parametros, pasta: Path) -> list[str]:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False})
    grupos = list(parametros.efeitos)
    cores = {"placa_oclusal": "#0f766e", "laser_baixa_intensidade": "#b45309", "orientacoes_autocuidado": "#6b7280"}
    geradas = []

    # 1. variação relativa da dor por tratamento (concluintes), com o efeito programado
    ev = evolucao(tabela_indicadores(fichas), tratamentos, pacientes)
    ev = ev[ev.concluiu & ev.variacao_rel.notna()]
    fig, ax = plt.subplots(figsize=(6.4, 3.8))
    dados = [ev[ev.grupo == g].variacao_rel for g in grupos]
    caixa = ax.boxplot(dados, patch_artist=True, widths=0.5, medianprops={"color": "black"})
    for patch, g in zip(caixa["boxes"], grupos):
        patch.set_facecolor(cores[g])
        patch.set_alpha(0.35)
    for i, g in enumerate(grupos, start=1):
        ax.hlines(parametros.efeitos[g] * 100, i - 0.3, i + 0.3, colors="crimson", linestyles="--", linewidth=1.5,
                  label="Redução programada" if i == 1 else None)
        ax.plot(i, ev[ev.grupo == g].variacao_rel.mean(), "D", color="black", markersize=5,
                label="Média estimada" if i == 1 else None)
    ax.set_xticks(range(1, len(grupos) + 1), [ROTULOS_DUAS_LINHAS[g] for g in grupos])
    ax.set_ylabel("Redução da intensidade da dor (%)")
    ax.axhline(30, color="gray", linewidth=0.8, linestyle=":")
    ax.text(1.5, 31, "melhora de 30%", ha="center", va="bottom", fontsize=7, color="gray")
    ax.legend(loc="upper right", fontsize=8, frameon=False)
    fig.tight_layout()
    fig.savefig(pasta / "variacao-dor-por-tratamento.png", dpi=200)
    geradas.append("variacao-dor-por-tratamento.png")
    plt.close(fig)

    # 2. trajetória média da intensidade da dor por grupo, nas consultas previstas
    ind = tabela_indicadores(fichas).merge(tratamentos[["pseudo_id", "categoria"]], on="pseudo_id")
    ind["consulta"] = (ind.dias_desde_inicio / 30).round().clip(upper=6) * 30
    fig, ax = plt.subplots(figsize=(6.4, 3.6))
    for deslocamento, g in zip((-3, 0, 3), grupos):  # afasta as barras de erro dos grupos
        t = ind[ind.categoria == g].groupby("consulta").icd.agg(["mean", "sem", "size"])
        ax.errorbar(t.index + deslocamento, t["mean"], yerr=1.96 * t["sem"], marker="o", capsize=3, color=cores[g], label=ROTULOS[g])
    ax.set_xlabel("Dias desde a primeira consulta")
    ax.set_ylabel("Intensidade característica da dor")
    ax.set_xticks([0, 30, 60, 90, 120, 180])
    ax.legend(fontsize=8, frameon=False)
    fig.tight_layout()
    fig.savefig(pasta / "trajetoria-dor.png", dpi=200)
    geradas.append("trajetoria-dor.png")
    plt.close(fig)

    # 3. prevalência das características relatadas na linha de base
    prev = [p for p in resumo["prevalencias"] if p["prevalencia_pct"] is not None]
    nomes = {"estalido": "Estalido", "crepitacao": "Crepitação", "apertamento_rangido_noturno": "Apertamento noturno",
             "apertamento_rangido_diurno": "Apertamento diurno", "mordida_desconfortavel": "Mordida desconfortável",
             "rigidez_pela_manha": "Rigidez matinal", "zumbido": "Zumbido", "cefaleia_6m": "Cefaleia (6 meses)"}
    prev.sort(key=lambda p: p["prevalencia_pct"])
    fig, ax = plt.subplots(figsize=(6.4, 3.4))
    ax.barh([nomes[p["caracteristica"]] for p in prev], [p["prevalencia_pct"] for p in prev], color="#0f766e", alpha=0.8)
    for i, p in enumerate(prev):
        ax.text(p["prevalencia_pct"] + 1, i, f"{p['prevalencia_pct']:.0f}%", va="center", fontsize=8)
    ax.set_xlabel("Pacientes (%)")
    ax.set_xlim(0, 100)
    fig.tight_layout()
    fig.savefig(pasta / "prevalencia-caracteristicas.png", dpi=200)
    geradas.append("prevalencia-caracteristicas.png")
    plt.close(fig)
    return geradas


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fonte", choices=["offline", "banco"], default="offline")
    ap.add_argument("--coorte", type=Path, default=RAIZ / "dados" / "sinteticos" / "coorte")
    ap.add_argument("--saida", type=Path)
    ap.add_argument("--sem-figuras", action="store_true")
    args = ap.parse_args()
    pasta = args.saida or RAIZ / "dados" / "resultados" / "experimento-d" / args.fonte
    pasta.mkdir(parents=True, exist_ok=True)

    parametros = Parametros(**json.loads((args.coorte / "parametros.json").read_text(encoding="utf-8")))
    coorte = carregar(args.coorte)
    pacientes, fichas, tratamentos = visoes(args.fonte, args.coorte, parametros)
    resumo = resumo_coorte(pacientes, fichas, tratamentos)
    tabela = comparar(resumo, coorte, parametros)
    entre = resumo["tratamentos_concluintes"]["entre_grupos"]

    (pasta / "resumo.json").write_text(json.dumps({"fonte": args.fonte, "parametros": parametros.__dict__,
                                                    "comparacao": tabela, "resumo": resumo},
                                                   ensure_ascii=False, indent=2), encoding="utf-8")
    fmt = lambda x, d=1: "--" if x is None else f"{x:.{d}f}"  # noqa: E731
    linhas = [
        "| Grupo | Programada | Sorteada | n | Estimada (IC 95%) | IC contém? | p (Wilcoxon) | r | ≥30% | ≥50% | Abandono prog./det. |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
        *[f"| {ROTULOS[t['grupo']]} | {fmt(t['reducao_programada_pct'], 0)}% | {fmt(t['reducao_sorteada_pct'])}% | {t['n_concluintes']} | "
          f"{fmt(t['reducao_estimada_pct'])}% ({fmt(t['ic95'][0])} a {fmt(t['ic95'][1])}) | {'sim' if t['ic95_contem_programada'] else 'NÃO'} | "
          f"{t['wilcoxon_p']:.2g} | {fmt(t['efeito_rank_biserial'], 2)} | {fmt(t['respondedores_30_pct'], 0)}% | "
          f"{fmt(t['respondedores_50_pct'], 0)}% | {fmt(t['abandono_programado_pct'], 0)}% / {fmt(t['abandono_detectado_pct'], 0)}% |"
          for t in tabela],
    ]
    texto = (f"# Experimento D (fonte: {args.fonte})\n\n"
             f"{resumo['pacientes']} pacientes; fichas: {resumo['fichas']}. Abandono: sem retorno há mais de "
             f"{LIMIAR_ABANDONO_DIAS} dias com tratamento em aberto.\n\n" + "\n".join(linhas) +
             f"\n\nEntre grupos (Kruskal-Wallis, concluintes): H = {fmt(entre['h'], 2)}, p = {entre['p']:.2g}, "
             f"ε² = {fmt(entre['epsilon2'], 3)}.\n")
    if not args.sem_figuras:
        geradas = figuras(pacientes, fichas, tratamentos, resumo, parametros, pasta)
        texto += "\nFiguras: " + ", ".join(geradas) + "\n"
    (pasta / "resumo.md").write_text(texto, encoding="utf-8")
    print(texto)


if __name__ == "__main__":
    main()
