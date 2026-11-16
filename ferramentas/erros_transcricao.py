"""Experimento B: lista os erros de transcrição palavra a palavra.

Alinha cada transcrição do Whisper com a narrativa de referência (mesma normalização da WER)
e grava em dados/resultados/experimento-b/erros.csv cada trecho divergente: substituição,
remoção ou inserção, com o caso e a condição. Também imprime as substituições mais frequentes.

Uso: python ferramentas/erros_transcricao.py
"""
import csv
from collections import Counter
from difflib import SequenceMatcher

from experimento_b import CASOS, SAIDA, normalizar


def main() -> None:
    linhas = []
    for pasta in sorted((SAIDA / "transcricoes").glob("small-*")):
        condicao = pasta.name.removeprefix("small-")
        for arquivo in sorted(pasta.glob("caso_*.txt")):
            caso = arquivo.stem
            ref = normalizar((CASOS / caso / "narrativa.txt").read_text(encoding="utf-8"))
            hip = normalizar(arquivo.read_text(encoding="utf-8"))
            for op, i1, i2, j1, j2 in SequenceMatcher(a=ref, b=hip, autojunk=False).get_opcodes():
                if op != "equal":
                    linhas.append({"caso": caso, "condicao": condicao, "tipo": op,
                                   "referencia": " ".join(ref[i1:i2]), "transcricao": " ".join(hip[j1:j2])})
    destino = SAIDA / "erros.csv"
    with destino.open("w", newline="", encoding="utf-8") as f:
        escritor = csv.DictWriter(f, fieldnames=["caso", "condicao", "tipo", "referencia", "transcricao"])
        escritor.writeheader()
        escritor.writerows(linhas)
    print(f"{len(linhas)} trechos divergentes gravados em {destino}")
    for condicao in ("silencio", "ruido"):
        tipos = Counter(l["tipo"] for l in linhas if l["condicao"] == condicao)
        print(condicao, dict(tipos))
    trocas = Counter((l["referencia"], l["transcricao"]) for l in linhas if l["tipo"] == "replace")
    for (ref, hip), n in trocas.most_common(60):
        print(f"{n:3d}  {ref!r} -> {hip!r}")


if __name__ == "__main__":
    main()
