import { describe, expect, it } from "vitest";
import { ESQUEMAS, ROTULOS, campoVisivel, esquemaResolvido, rotulo, type Esquema } from "../src";

function valoresEnumerados(no: unknown, acumulado = new Set<unknown>()): Set<unknown> {
  if (Array.isArray(no)) no.forEach((x) => valoresEnumerados(x, acumulado));
  else if (no !== null && typeof no === "object") {
    for (const [chave, valor] of Object.entries(no)) {
      if (chave === "enum" && Array.isArray(valor)) valor.forEach((v) => acumulado.add(v));
      else valoresEnumerados(valor, acumulado);
    }
  }
  return acumulado;
}

describe("rótulos", () => {
  it("todo valor textual enumerado em todos os esquemas tem rótulo", () => {
    const semRotulo = [...valoresEnumerados(Object.values(ESQUEMAS))]
      .filter((v): v is string => typeof v === "string")
      .filter((v) => !(v in ROTULOS));
    expect(semRotulo).toEqual([]);
  });

  it("formata booleanos, nulos e valores desconhecidos", () => {
    expect(rotulo(true)).toBe("Sim");
    expect(rotulo(null)).toBe("—");
    expect(rotulo("concavo")).toBe("Côncavo");
    expect(rotulo("valor_novo")).toBe("valor novo");
  });
});

describe("campos condicionais (x-mostrar-se)", () => {
  const secoes = esquemaResolvido("ficha-inicial").properties as Record<string, Esquema>;

  it("toda condição aponta para um campo existente da mesma seção", () => {
    let total = 0;
    for (const secao of Object.values(secoes)) {
      const props = secao.properties as Record<string, Esquema>;
      for (const campo of Object.values(props)) {
        const cond = campo["x-mostrar-se"] as { campo: string } | undefined;
        if (!cond) continue;
        total++;
        expect(props).toHaveProperty(cond.campo);
      }
    }
    expect(total).toBe(6);
  });

  it("exibe 'quais medicamentos' só para quem usa medicamento", () => {
    const campo = (secoes.historia_medica.properties as Record<string, Esquema>).q4_medicamentos;
    expect(campoVisivel(campo, { q4_usa_medicamento: true })).toBe(true);
    expect(campoVisivel(campo, { q4_usa_medicamento: false })).toBe(false);
    expect(campoVisivel(campo, {})).toBe(false);
    const semCondicao = (secoes.historia_medica.properties as Record<string, Esquema>).q3_alergias;
    expect(campoVisivel(semCondicao, undefined)).toBe(true);
  });
});
