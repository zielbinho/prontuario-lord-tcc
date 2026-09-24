"""Experimento B (seção 4.9.3 do TCC): captação por áudio versus texto.

Sem voluntários para gravar as narrativas, o áudio é produzido por síntese de fala (voz pt-BR
Microsoft Maria, do Windows) e o ruído de clínica é simulado por ruído rosa com relação sinal-ruído
de 10 dB. As duas substituições são declaradas no texto como limitações.

Para cada narrativa do conjunto de teste:
  1. sintetiza o áudio (condição "silencio") e sobrepõe o ruído (condição "ruido");
  2. transcreve com os modelos Whisper indicados, com as mesmas opções do serviço de transcrição;
  3. calcula a taxa de erro de palavras (WER) e o fator de tempo real (tempo de transcrição / duração).

As transcrições ficam em dados/resultados/experimento-b/transcricoes/<modelo>-<condicao>/<caso>.txt,
prontas para o Experimento A (packages/ia: experimento-a.ts --narrativas <pasta>).

Uso (em ferramentas):  ..\\.venv\\Scripts\\python experimento_b.py --modelos small,base
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import statistics
import subprocess
import sys
import time
import unicodedata
import wave
from pathlib import Path

import numpy as np

RAIZ = Path(__file__).resolve().parent.parent
CASOS = RAIZ / "dados" / "sinteticos" / "casos"
SAIDA = RAIZ / "dados" / "resultados" / "experimento-b"
SNR_DB = 10.0
SEMENTE = 2026

sys.path.insert(0, str(RAIZ / "services" / "transcricao"))
from app import VOCABULARIO  # noqa: E402  mesmo vocabulário do serviço


# ------------------------------------------------------------------ texto e WER

UNIDADES = "zero um dois três quatro cinco seis sete oito nove dez onze doze treze catorze quinze dezesseis dezessete dezoito dezenove".split()
DEZENAS = "_ _ vinte trinta quarenta cinquenta sessenta setenta oitenta noventa".split()
CENTENAS = "_ cento duzentos trezentos quatrocentos quinhentos seiscentos setecentos oitocentos novecentos".split()


def por_extenso(n: int) -> str:
    """Número inteiro de 0 a 9999 por extenso, como a voz sintética o lê."""
    if n < 20:
        return UNIDADES[n]
    if n < 100:
        d, u = divmod(n, 10)
        return DEZENAS[d] + (f" e {UNIDADES[u]}" if u else "")
    if n == 100:
        return "cem"
    if n < 1000:
        c, r = divmod(n, 100)
        return CENTENAS[c] + (f" e {por_extenso(r)}" if r else "")
    m, r = divmod(n, 1000)
    inicio = "mil" if m == 1 else f"{por_extenso(m)} mil"
    if not r:
        return inicio
    return f"{inicio} e {por_extenso(r)}" if r < 100 or r % 100 == 0 else f"{inicio} {por_extenso(r)}"


def normalizar(texto: str) -> list[str]:
    """Minúsculas, números por extenso, sem pontuação: a WER compara palavras, não formatação."""
    texto = texto.lower()
    texto = re.sub(r"\d+", lambda m: por_extenso(int(m.group())) if int(m.group()) < 10000 else m.group(), texto)
    texto = "".join(c if c.isalnum() or c.isspace() or unicodedata.category(c) == "Mn" else " " for c in texto)
    return texto.split()


def wer(referencia: list[str], hipotese: list[str]) -> float:
    """(S + D + I) / N pela distância de edição entre as sequências de palavras."""
    anterior = list(range(len(hipotese) + 1))
    for i, r in enumerate(referencia, 1):
        atual = [i] + [0] * len(hipotese)
        for j, h in enumerate(hipotese, 1):
            atual[j] = min(anterior[j] + 1, atual[j - 1] + 1, anterior[j - 1] + (r != h))
        anterior = atual
    return anterior[-1] / len(referencia)


# ------------------------------------------------------------------ áudio

def ler_wav(caminho: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(caminho), "rb") as w:
        taxa = w.getframerate()
        dados = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
    return dados, taxa


def gravar_wav(caminho: Path, dados: np.ndarray, taxa: int) -> None:
    with wave.open(str(caminho), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(taxa)
        w.writeframes((np.clip(dados, -1, 1) * 32767).astype(np.int16).tobytes())


def ruido_rosa(n: int, gerador: np.random.Generator) -> np.ndarray:
    """Ruído com espectro 1/f, obtido filtrando ruído branco no domínio da frequência."""
    espectro = np.fft.rfft(gerador.standard_normal(n))
    f = np.arange(len(espectro))
    f[0] = 1
    return np.fft.irfft(espectro / np.sqrt(f), n)


def com_ruido(fala: np.ndarray, gerador: np.random.Generator) -> np.ndarray:
    ruido = ruido_rosa(len(fala), gerador)
    potencia_fala = np.mean(fala[np.abs(fala) > 1e-4] ** 2)  # ignora os silêncios
    ruido *= np.sqrt(potencia_fala / (np.mean(ruido**2) * 10 ** (SNR_DB / 10)))
    return fala + ruido


# ------------------------------------------------------------------ experimento

def casos_de_teste() -> list[str]:
    with open(CASOS / "indice.csv", encoding="utf-8") as f:
        return [l["caso"] for l in csv.DictReader(f) if l["divisao"] == "teste" and (CASOS / l["caso"] / "narrativa.txt").exists()]


def sintetizar(casos: list[str]) -> dict[str, float]:
    pasta = SAIDA / "audio"
    pasta.mkdir(parents=True, exist_ok=True)
    gerador = np.random.default_rng(SEMENTE)
    duracoes = {}
    for caso in casos:
        limpo, ruidoso = pasta / f"{caso}-silencio.wav", pasta / f"{caso}-ruido.wav"
        if not limpo.exists():
            subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                            str(Path(__file__).parent / "sintetizar_fala.ps1"),
                            "-Texto", str(CASOS / caso / "narrativa.txt"), "-Saida", str(limpo)], check=True)
        fala, taxa = ler_wav(limpo)
        ruido_caso = com_ruido(fala, gerador)  # sorteado sempre, para o ruído não depender do que já existe
        if not ruidoso.exists():
            gravar_wav(ruidoso, ruido_caso, taxa)
        duracoes[caso] = len(fala) / taxa
    return duracoes


def transcrever(casos: list[str], nomes_modelos: list[str], duracoes: dict[str, float]) -> list[dict]:
    """Cada transcrição é gravada em linhas.jsonl ao terminar; rodar de novo retoma de onde parou."""
    from faster_whisper import WhisperModel

    arquivo = SAIDA / "linhas.jsonl"
    feitas = {}
    if arquivo.exists():
        for texto in arquivo.read_text(encoding="utf-8").splitlines():
            l = json.loads(texto)
            feitas[(l["caso"], l["modelo"], l["condicao"])] = l
    linhas = []
    for nome in nomes_modelos:
        modelo = None
        for condicao in ("silencio", "ruido"):
            pasta = SAIDA / "transcricoes" / f"{nome}-{condicao}"
            pasta.mkdir(parents=True, exist_ok=True)
            for caso in casos:
                if (caso, nome, condicao) in feitas:
                    linhas.append(feitas[(caso, nome, condicao)])
                    continue
                modelo = modelo or WhisperModel(nome, device="cpu", compute_type="int8")
                inicio = time.perf_counter()
                segmentos, _ = modelo.transcribe(str(SAIDA / "audio" / f"{caso}-{condicao}.wav"), language="pt",
                                                 initial_prompt=VOCABULARIO, vad_filter=True, beam_size=5)
                texto = " ".join(s.text.strip() for s in segmentos).strip()
                segundos = time.perf_counter() - inicio
                (pasta / f"{caso}.txt").write_text(texto, encoding="utf-8")
                referencia = (CASOS / caso / "narrativa.txt").read_text(encoding="utf-8")
                linha = {"caso": caso, "modelo": nome, "condicao": condicao, "palavras": len(normalizar(referencia)),
                         "duracao_s": round(duracoes[caso], 1), "transcricao_s": round(segundos, 1),
                         "wer": round(wer(normalizar(referencia), normalizar(texto)), 4)}
                linhas.append(linha)
                with open(arquivo, "a", encoding="utf-8") as f:
                    f.write(json.dumps(linha) + "\n")
                print(f"{caso} {nome} {condicao}: WER {linha['wer']:.3f}, {segundos:.0f} s", flush=True)
    return linhas


def resumir(linhas: list[dict]) -> list[dict]:
    resumo = []
    for nome in dict.fromkeys(l["modelo"] for l in linhas):
        for condicao in ("silencio", "ruido"):
            g = [l for l in linhas if l["modelo"] == nome and l["condicao"] == condicao]
            wers = [l["wer"] for l in g]
            resumo.append({
                "modelo": nome, "condicao": condicao, "casos": len(g),
                "wer_media": round(statistics.mean(wers), 4), "wer_mediana": round(statistics.median(wers), 4),
                "wer_min": min(wers), "wer_max": max(wers),
                "fator_tempo_real": round(sum(l["transcricao_s"] for l in g) / sum(l["duracao_s"] for l in g), 3),
            })
    return resumo


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--modelos", default="small,base")
    args = p.parse_args()
    casos = casos_de_teste()
    duracoes = sintetizar(casos)
    linhas = transcrever(casos, args.modelos.split(","), duracoes)
    resumo = resumir(linhas)
    SAIDA.mkdir(parents=True, exist_ok=True)
    with open(SAIDA / "wer.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(linhas[0]))
        w.writeheader()
        w.writerows(linhas)
    fala = list(duracoes.values())
    resultado = {"snr_db": SNR_DB, "voz": "Microsoft Maria Desktop (pt-BR)", "casos": len(casos),
                 "fala_s": {"mediana": round(statistics.median(fala), 1), "min": round(min(fala), 1), "max": round(max(fala), 1)},
                 "resumo": resumo}
    (SAIDA / "resumo.json").write_text(json.dumps(resultado, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(resultado, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
