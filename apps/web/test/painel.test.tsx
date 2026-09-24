import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GrupoTratamento, ResumoCoorte } from "../src/api";
import { resumoCaixa } from "../src/componentes/graficos";

const usuario = vi.hoisted(() => ({ atual: { id: "u", nome: "Rita", email: "r@x", papel: "pesquisador" as string } }));
vi.mock("../src/autenticacao", () => ({ useUsuario: () => usuario.atual }));
const { default: Painel } = await import("../src/paginas/Painel");

const grupo = (grupo: string, reducao: number): GrupoTratamento => ({
  grupo, n: 40, base_mediana: 55, final_mediana: 55 * (1 - reducao / 100), reducao_media_pct: reducao,
  reducao_ic95: [reducao - 5, reducao + 5], reducao_mediana_pct: reducao, respondedores_30_pct: 60, respondedores_50_pct: 20,
  wilcoxon_p: 0.00001, efeito_rank_biserial: 0.9,
});
const comparacao = (grupos: GrupoTratamento[]) => ({ somente_concluintes: true, grupos, entre_grupos: { h: 40, p: 1e-9, epsilon2: 0.35 } });
const COORTE: ResumoCoorte = {
  pacientes: 150, fichas: { "ficha-inicial": 150, "ficha-retorno": 600 },
  prevalencias: [{ caracteristica: "estalido", n: 150, prevalencia_pct: 44 }, { caracteristica: "zumbido", n: 0, prevalencia_pct: null }],
  diagnosticos: { grupo1_muscular: { Ia_dor_miofascial: 50 } },
  // a API devolve em ordem alfabética; a tela mostra na ordem fixa dos tratamentos
  tratamentos: comparacao([grupo("laser_baixa_intensidade", 24), grupo("placa_oclusal", 38)]),
  tratamentos_concluintes: comparacao([grupo("laser_baixa_intensidade", 25), grupo("placa_oclusal", 40)]),
  abandono: [{ grupo: "placa_oclusal", n: 50, abandono_pct: 18, sem_retorno: 2 }],
  correlacoes: [{ x: "icd", y: "sitios_dolorosos", n: 150, rho: 0.2, p: 0.01 }],
  variacoes: [{ grupo: "placa_oclusal", variacao_rel: 40, concluiu: true }, { grupo: "laser_baixa_intensidade", variacao_rel: 20, concluiu: false }],
};
const QUALIDADE = {
  completude: [{ tipo_ficha: "ficha-inicial", status: "aprovada", fichas: 150, completude_media_pct: 98.8 }],
  aceitacao_ia: { total: [{ grupo: "total", decisoes: 10, aceitas: 7, editadas: 1, rejeitadas: 2, taxa_aceitacao_pct: 80 }],
    por_secao: [{ grupo: "historia_medica", decisoes: 10, aceitas: 7, editadas: 1, rejeitadas: 2, taxa_aceitacao_pct: 80 }], por_versao_prompt: [] },
};

let urls: string[];
beforeEach(() => {
  urls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(url.endsWith("/coorte") ? COORTE : QUALIDADE), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

function montar(): ReturnType<typeof render> {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const envolver = ({ children }: { children: ReactNode }) => <QueryClientProvider client={cliente}>{children}</QueryClientProvider>;
  return render(<Painel />, { wrapper: envolver });
}

describe("painel da coorte", () => {
  it("mostra a tabela de tratamentos na ordem fixa, com números formatados em português", async () => {
    usuario.atual.papel = "pesquisador";
    montar();
    const tabela = await screen.findByRole("table", { name: "Variação da intensidade da dor por tratamento" });
    const linhas = within(tabela).getAllByRole("row").slice(1) as HTMLTableRowElement[];
    expect(linhas.map((l) => l.cells[0].textContent)).toEqual(["Placa oclusal", "Laser de baixa intensidade"]);
    expect(linhas[0]).toHaveTextContent("40,0% (35,0 a 45,0)");
    expect(linhas[0]).toHaveTextContent("< 0,001");
    expect(screen.getByText("Estalido")).toBeInTheDocument();
    expect(screen.queryByText("Zumbido")).not.toBeInTheDocument(); // sem respostas: não entra no gráfico
    expect(await screen.findByText("História médica")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Exportar dados (CSV)" })).toHaveAttribute("href", "/api/analise/exportacao.csv");
  });

  it("o filtro troca o conjunto de pacientes sem recolorir os grupos", async () => {
    usuario.atual.papel = "professor";
    montar();
    await screen.findByText("40,0% (35,0 a 45,0)");
    await userEvent.click(screen.getByRole("radio", { name: "Todos com retorno" }));
    expect(screen.getByText("38,0% (33,0 a 43,0)")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Todos com retorno" })).toHaveAttribute("aria-checked", "true");
  });

  it("administrador vê só a qualidade dos dados, sem pedir a coorte", async () => {
    usuario.atual.papel = "admin";
    montar();
    expect(await screen.findByRole("heading", { name: "Qualidade dos dados" })).toBeInTheDocument();
    expect(await screen.findByText(/7 sem alteração, 1 editadas, 2 rejeitadas de 10/)).toBeInTheDocument();
    expect(urls).toEqual(["/api/analise/qualidade"]);
    expect(screen.queryByRole("link", { name: "Exportar dados (CSV)" })).not.toBeInTheDocument();
  });
});

describe("resumo do diagrama de caixa", () => {
  it("quartis por interpolação e valores atípicos pela regra de 1,5 IIQ", () => {
    const r = resumoCaixa([1, 2, 3, 4, 5, 6, 7, 8, 100]);
    expect([r.q1, r.mediana, r.q3]).toEqual([3, 5, 7]);
    expect(r.atipicos).toEqual([100]);
    expect(r.bigodeMax).toBe(8);
  });
});
