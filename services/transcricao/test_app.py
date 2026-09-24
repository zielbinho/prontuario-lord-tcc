from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import app as servico


class TranscritorFalso:
    def __init__(self):
        self.chamadas = []

    def transcribe(self, audio, **opcoes):
        self.chamadas.append((audio.read(), opcoes))
        segmentos = [SimpleNamespace(text=" Paciente relata estalido "), SimpleNamespace(text="na ATM direita. ")]
        return iter(segmentos), SimpleNamespace(duration=4.5)


@pytest.fixture
def cliente(monkeypatch, tmp_path):
    falso = TranscritorFalso()
    monkeypatch.setattr(servico, "modelo", lambda: falso)
    monkeypatch.chdir(tmp_path)  # para verificar que nada é gravado em disco
    return TestClient(servico.app), falso, tmp_path


def test_transcreve_em_portugues_com_vocabulario_clinico(cliente):
    http, falso, _ = cliente
    r = http.post("/transcrever", content=b"bytes-de-audio", headers={"Content-Type": "audio/webm"})
    assert r.status_code == 200
    assert r.json()["texto"] == "Paciente relata estalido na ATM direita."
    assert r.json()["duracao_audio_s"] == 4.5
    audio, opcoes = falso.chamadas[0]
    assert audio == b"bytes-de-audio"
    assert opcoes["language"] == "pt"
    assert "masseter" in opcoes["initial_prompt"]


def test_nao_grava_o_audio_em_disco(cliente):
    http, _, pasta = cliente
    http.post("/transcrever", content=b"x" * 1000, headers={"Content-Type": "audio/wav"})
    assert list(pasta.iterdir()) == []


@pytest.mark.parametrize(
    ("corpo", "tipo", "status"),
    [(b"abc", "application/json", 415), (b"", "audio/webm", 400), (b"x" * (25 * 1024 * 1024 + 1), "audio/webm", 413)],
    ids=["tipo-nao-audio", "vazio", "grande-demais"],
)
def test_rejeita_pedidos_invalidos(cliente, corpo, tipo, status):
    http, _, _ = cliente
    assert http.post("/transcrever", content=corpo, headers={"Content-Type": tipo}).status_code == status


def test_audio_ilegivel_vira_422(cliente, monkeypatch):
    http, _, _ = cliente

    class Quebrado:
        def transcribe(self, audio, **opcoes):
            raise ValueError("formato desconhecido")

    monkeypatch.setattr(servico, "modelo", lambda: Quebrado())
    assert http.post("/transcrever", content=b"lixo", headers={"Content-Type": "audio/ogg"}).status_code == 422
