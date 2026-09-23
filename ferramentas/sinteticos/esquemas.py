"""Carrega os esquemas JSON da ficha (fonte única em packages/ficha/schemas) e valida documentos."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

PASTA_ESQUEMAS = Path(__file__).resolve().parents[2] / "packages" / "ficha" / "schemas"

TIPOS = {
    "ficha-inicial": "ficha-inicial.v1.schema.json",
    "ficha-retorno": "ficha-retorno.v1.schema.json",
    "odontograma": "odontograma.v1.schema.json",
    "paciente": "paciente.v1.schema.json",
}


@lru_cache
def _registro() -> Registry:
    recursos = []
    for arquivo in PASTA_ESQUEMAS.glob("*.schema.json"):
        conteudo = json.loads(arquivo.read_text(encoding="utf-8"))
        recursos.append((conteudo["$id"], Resource.from_contents(conteudo)))
    return Registry().with_resources(recursos)


@lru_cache
def esquema(tipo: str) -> dict:
    return json.loads((PASTA_ESQUEMAS / TIPOS[tipo]).read_text(encoding="utf-8"))


@lru_cache
def _validador(tipo: str) -> Draft202012Validator:
    return Draft202012Validator(esquema(tipo), registry=_registro())


def erros(tipo: str, documento: dict) -> list[str]:
    """Lista de mensagens de erro; vazia se o documento for válido."""
    return [
        f"/{'/'.join(map(str, e.absolute_path))}: {e.message}"
        for e in _validador(tipo).iter_errors(documento)
    ]
