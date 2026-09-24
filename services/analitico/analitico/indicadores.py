"""Indicadores individuais de uma ficha (seção 4.8.1 do TCC).

Funcionam com a ficha inicial (seções questionario_dtm e exame_dtm) e com a ficha de retorno
(seções dor e exame), que guardam as mesmas medidas em caminhos diferentes. Recebem apenas os
dados estruturados: nenhum texto livre é necessário para os cálculos.
"""

from __future__ import annotations

from typing import Any

# (caminho na ficha inicial, caminho na ficha de retorno)
CAMPOS_DOR = {
    "dor_atual": (("questionario_dtm", "q16_dor_atual"), ("dor", "q16_dor_atual")),
    "pior_dor": (("questionario_dtm", "q17_pior_dor_6m"), ("dor", "q17_pior_dor")),
    "dor_media": (("questionario_dtm", "q18_dor_media_6m"), ("dor", "q18_dor_media")),
    "dias_afastamento": (("questionario_dtm", "q19_dias_afastamento_6m"), ("dor", "q19_dias_afastamento")),
    "interferencia_atividades": (("questionario_dtm", "q20_interferencia_atividades"), ("dor", "q20_interferencia_atividades")),
    "mudanca_lazer_social": (("questionario_dtm", "q21_mudanca_lazer_social"), ("dor", "q21_mudanca_lazer_social")),
    "mudanca_trabalho": (("questionario_dtm", "q22_mudanca_trabalho"), ("dor", "q22_mudanca_trabalho")),
}
CAMPOS_ABERTURA = {
    "abertura_sem_dor_mm": "q39a_abertura_sem_auxilio_sem_dor_mm",
    "abertura_max_mm": "q39b_abertura_maxima_sem_auxilio_mm",
    "abertura_max_auxilio_mm": "q39c_abertura_maxima_com_auxilio_mm",
}


def _ler(dados: dict[str, Any], caminho: tuple[str, ...]) -> Any:
    no: Any = dados
    for chave in caminho:
        if not isinstance(no, dict):
            return None
        no = no.get(chave)
    return no


def _medida(dados: dict[str, Any], nome: str) -> Any:
    inicial, retorno = CAMPOS_DOR[nome]
    valor = _ler(dados, inicial)
    return valor if valor is not None else _ler(dados, retorno)


def _exame(dados: dict[str, Any]) -> dict[str, Any]:
    return dados.get("exame_dtm") or dados.get("exame") or {}


def pontos_dias_afastamento(dias: int) -> int:
    """Pontos de incapacidade pelos dias de afastamento nos últimos 6 meses (GCPS)."""
    if dias <= 6:
        return 0
    if dias <= 14:
        return 1
    if dias <= 30:
        return 2
    return 3


def pontos_escore_incapacidade(ei: float) -> int:
    """Pontos de incapacidade pelo escore de incapacidade (0 a 100) (GCPS)."""
    if ei < 30:
        return 0
    if ei < 50:
        return 1
    if ei < 70:
        return 2
    return 3


def grau_gcps(icd: float | None, ei: float | None, dias: int | None) -> int | None:
    """Grau da Escala Graduada de Dor Crônica (Von Korff et al., 1992): 0 a 4 (IV)."""
    if icd is None:
        return None
    if icd == 0:
        return 0
    if ei is None or dias is None:
        return None
    pontos = pontos_escore_incapacidade(ei) + pontos_dias_afastamento(dias)
    if pontos >= 5:
        return 4
    if pontos >= 3:
        return 3
    return 1 if icd < 50 else 2


def _media_x10(valores: list[Any]) -> float | None:
    if any(v is None for v in valores):
        return None
    return round(sum(valores) / len(valores) * 10, 2)


def palpacao(exame: dict[str, Any]) -> tuple[int | None, int | None]:
    """Número de sítios dolorosos (intensidade > 0) e soma das intensidades, questões 44 e 45."""
    valores = [
        lado
        for grupo in ("q44_palpacao_muscular", "q45_palpacao_articular")
        for sitio in (exame.get(grupo) or {}).values()
        for lado in (sitio or {}).values()
        if lado is not None
    ]
    if not valores:
        return None, None
    return sum(v > 0 for v in valores), sum(valores)


def indicadores_ficha(dados: dict[str, Any]) -> dict[str, Any]:
    """Todos os indicadores individuais de uma ficha; campos ausentes resultam em None."""
    medidas = {nome: _medida(dados, nome) for nome in CAMPOS_DOR}
    icd = _media_x10([medidas["dor_atual"], medidas["pior_dor"], medidas["dor_media"]])
    ei = _media_x10([medidas["interferencia_atividades"], medidas["mudanca_lazer_social"], medidas["mudanca_trabalho"]])
    exame = _exame(dados)
    sitios, soma = palpacao(exame)
    atividades = _ler(dados, ("questionario_dtm", "q36_atividades_limitadas"))
    return {
        "dor_atual": medidas["dor_atual"],
        "pior_dor": medidas["pior_dor"],
        "dor_media": medidas["dor_media"],
        "icd": icd,
        "escore_incapacidade": ei,
        "dias_afastamento": medidas["dias_afastamento"],
        "grau_gcps": grau_gcps(icd, ei, medidas["dias_afastamento"]),
        **{nome: exame.get(campo) for nome, campo in CAMPOS_ABERTURA.items()},
        "sitios_dolorosos": sitios,
        "soma_palpacao": soma,
        # a questão 36 só existe na ficha inicial
        "atividades_limitadas": len(atividades) if isinstance(atividades, list) else None,
    }
