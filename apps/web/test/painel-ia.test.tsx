import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PainelIA } from "../src/ficha/PainelIA";
import { definirCaminho } from "../src/paginas/Ficha";

const RESPOSTA = {
  id: "sug-1",
  secao: "historia_medica",
  sugestoes: [
    { caminho: "historia_medica.q3_alergias", valor: "Dipirona.", evidencia: "alergia a dipirona" },
    { caminho: "historia_medica.q4_usa_medicamento", valor: true, evidencia: "toma losartana" },
    { caminho: "historia_medica.q1_sistemas", valor: ["cardiaca"], evidencia: "tem problema de coração" },
  ],
  descartados: [{ caminho: "historia_medica.q1_outras", valor: "Nenhuma", evidencia: "não tem outras doenças", motivo: "evidencia_nao_encontrada" }],
  modelo: "qwen2.5:3b",
  versao_prompt: "v2",
  latencia_ms: 30000,
};

let chamadas: { url: string; corpo: unknown }[];

beforeEach(() => {
  chamadas = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const corpo = init?.body ? JSON.parse(String(init.body)) : undefined;
    chamadas.push({ url, corpo });
    const resposta = url.endsWith("/sugestoes") ? RESPOSTA : { id: "sug-1", decisoes: corpo?.decisoes };
    return new Response(JSON.stringify(resposta), { status: url.endsWith("/sugestoes") ? 201 : 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

function montar(dados: Record<string, unknown> = {}, aoAplicar = vi.fn()) {
  const cliente = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const utilidades = render(
    <QueryClientProvider client={cliente}>
      <PainelIA fichaId="ficha-1" secao="historia_medica" dados={dados} aoAplicar={aoAplicar} />
    </QueryClientProvider>,
  );
  return { ...utilidades, aoAplicar, cliente };
}

async function gerarSugestoes() {
  await userEvent.click(screen.getByRole("button", { name: "Ditado com IA" }));
  await userEvent.type(screen.getByLabelText(/Relato/), "Relata alergia a dipirona e toma losartana.");
  await userEvent.click(screen.getByRole("button", { name: "Gerar sugestões" }));
  await screen.findByText("Dipirona.");
}

describe("painel de ditado com IA", () => {
  it("envia o relato e mostra cada sugestão com a evidência e o rótulo do valor", async () => {
    montar();
    await gerarSugestoes();
    expect(chamadas[0]).toEqual({
      url: "/api/fichas/ficha-1/sugestoes",
      corpo: { secao: "historia_medica", relato: "Relata alergia a dipirona e toma losartana.", origem: "texto" },
    });
    expect(screen.getByText("“alergia a dipirona”")).toBeInTheDocument();
    expect(screen.getByText("Cardíaca")).toBeInTheDocument(); // rótulo, não o código
    expect(screen.getByText("Histórico de alergias")).toBeInTheDocument();
    expect(screen.getByText(/1 descartada\(s\) automaticamente/)).toBeInTheDocument();
    expect(screen.getByText(/trecho citado: “não tem outras doenças”/)).toBeInTheDocument();
  });

  it("aceitar aplica o valor na ficha e registra a decisão; rejeitar não aplica", async () => {
    const { aoAplicar } = montar();
    await gerarSugestoes();
    const alergia = document.querySelector('[data-sugestao="historia_medica.q3_alergias"]') as HTMLElement;
    await userEvent.click(within(alergia).getByRole("button", { name: "Aceitar" }));
    expect(aoAplicar).toHaveBeenCalledWith("historia_medica.q3_alergias", "Dipirona.");
    await waitFor(() => expect(chamadas.at(-1)).toEqual({
      url: "/api/sugestoes/sug-1/decisoes", corpo: { decisoes: { "historia_medica.q3_alergias": "aceita" } },
    }));

    const sistemas = document.querySelector('[data-sugestao="historia_medica.q1_sistemas"]') as HTMLElement;
    await userEvent.click(within(sistemas).getByRole("button", { name: "Rejeitar" }));
    expect(aoAplicar).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(chamadas.at(-1)?.corpo).toEqual({ decisoes: { "historia_medica.q1_sistemas": "rejeitada" } }));
    expect(within(sistemas).getByText("Rejeitada")).toBeInTheDocument();
  });

  it("aceitar as pendentes aplica todas em ordem numa só decisão", async () => {
    const { aoAplicar } = montar();
    await gerarSugestoes();
    await userEvent.click(screen.getByRole("button", { name: "Aceitar as 3 pendentes" }));
    expect(aoAplicar.mock.calls.map((c) => c[0])).toEqual([
      "historia_medica.q3_alergias", "historia_medica.q4_usa_medicamento", "historia_medica.q1_sistemas",
    ]);
    await waitFor(() => expect(Object.keys((chamadas.at(-1)?.corpo as { decisoes: object }).decisoes)).toHaveLength(3));
  });

  it("valor aceito e depois alterado no formulário vira 'editada'", async () => {
    const { rerender, cliente, aoAplicar } = montar({});
    await gerarSugestoes();
    const alergia = document.querySelector('[data-sugestao="historia_medica.q3_alergias"]') as HTMLElement;
    await userEvent.click(within(alergia).getByRole("button", { name: "Aceitar" }));

    rerender(
      <QueryClientProvider client={cliente}>
        <PainelIA fichaId="ficha-1" secao="historia_medica" aoAplicar={aoAplicar}
          dados={{ historia_medica: { q3_alergias: "Dipirona (urticária)." } }} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(chamadas.at(-1)?.corpo).toEqual({ decisoes: { "historia_medica.q3_alergias": "editada" } }));
    expect(within(alergia).getByText("Aceita e editada")).toBeInTheDocument();
  });

  it("avisa quando a sugestão substituiria um valor já preenchido", async () => {
    montar({ historia_medica: { q3_alergias: "Nega." } });
    await gerarSugestoes();
    expect(screen.getByText("Substitui o valor atual: Nega.")).toBeInTheDocument();
  });
});

describe("definirCaminho", () => {
  it("grava em caminhos aninhados sem alterar o original", () => {
    const original = { exame_dtm: { q41_dor_muscular: "ambos" } };
    const novo = definirCaminho(original, "exame_dtm.q44_palpacao_muscular.cervical.direito", 2);
    expect(novo).toEqual({ exame_dtm: { q41_dor_muscular: "ambos", q44_palpacao_muscular: { cervical: { direito: 2 } } } });
    expect(original).toEqual({ exame_dtm: { q41_dor_muscular: "ambos" } });
  });
});
