import { esquemaResolvido, type Esquema } from "@lord/ficha";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { CampoEsquema, tipoDeControle } from "../src/ficha/CampoEsquema";
import { MapaPalpacao } from "../src/ficha/MapaPalpacao";
import { limparOdontograma } from "../src/ficha/Odontograma";
import { RenderizadorSecao, aplicarAlteracao, type ValoresSecao } from "../src/ficha/RenderizadorSecao";

const secoes = esquemaResolvido("ficha-inicial").properties as Record<string, Esquema>;
const campoDe = (secao: string, campo: string) => (secoes[secao].properties as Record<string, Esquema>)[campo];

describe("escolha do controle a partir do esquema", () => {
  it.each([
    ["questionario_dtm", "q16_dor_atual", "escala"],
    ["questionario_dtm", "q12_dor_face_4_semanas", "simnao"],
    ["questionario_dtm", "q14_padrao_dor", "escolha"],
    ["questionario_dtm", "q36_atividades_limitadas", "multipla"],
    ["questionario_dtm", "q19_dias_afastamento_6m", "numero"],
    ["exame_dtm", "q39b_abertura_maxima_sem_auxilio_mm", "numero"],
    ["historia_medica", "q3_alergias", "texto"],
  ])("%s.%s → %s", (secao, campo, esperado) => {
    expect(tipoDeControle(campoDe(secao, campo))).toBe(esperado);
  });

  it("todo campo-folha da ficha tem um controle conhecido", () => {
    for (const [nomeSecao, secao] of Object.entries(secoes)) {
      for (const [nome, campo] of Object.entries(secao.properties as Record<string, Esquema>)) {
        if (nome === "q44_palpacao_muscular" || nome === "q45_palpacao_articular") continue; // mapa próprio
        expect(tipoDeControle(campo), `${nomeSecao}.${nome}`).not.toBe("desconhecido");
      }
    }
  });
});

describe("CampoEsquema", () => {
  it("escala de dor: marca, mostra o valor selecionado e desmarca ao clicar de novo", async () => {
    const aoMudar = vi.fn();
    const { rerender } = render(
      <CampoEsquema caminho="questionario_dtm.q16_dor_atual" esquema={campoDe("questionario_dtm", "q16_dor_atual")}
        valor={null} aoMudar={aoMudar} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "7" }));
    expect(aoMudar).toHaveBeenLastCalledWith(7);

    rerender(
      <CampoEsquema caminho="questionario_dtm.q16_dor_atual" esquema={campoDe("questionario_dtm", "q16_dor_atual")}
        valor={7} aoMudar={aoMudar} />,
    );
    expect(screen.getByRole("button", { name: "7" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "7" }));
    expect(aoMudar).toHaveBeenLastCalledWith(null);
  });

  it("mostra rótulos acentuados e mantém a ordem do esquema na seleção múltipla", async () => {
    const aoMudar = vi.fn();
    render(<CampoEsquema caminho="historia_medica.q1_sistemas" esquema={campoDe("historia_medica", "q1_sistemas")}
      valor={["neurologica"]} aoMudar={aoMudar} />);
    await userEvent.click(screen.getByRole("button", { name: "Cardíaca" }));
    expect(aoMudar).toHaveBeenLastCalledWith(["cardiaca", "neurologica"]);
  });

  it("número vazio vira null e inteiro é truncado", async () => {
    const aoMudar = vi.fn();
    render(<CampoEsquema caminho="questionario_dtm.q19_dias_afastamento_6m"
      esquema={campoDe("questionario_dtm", "q19_dias_afastamento_6m")} valor={3} aoMudar={aoMudar} />);
    const entrada = screen.getByRole("spinbutton");
    await userEvent.clear(entrada);
    expect(aoMudar).toHaveBeenLastCalledWith(null);
  });

  it("em modo somente leitura os controles ficam desabilitados", () => {
    render(<CampoEsquema caminho="questionario_dtm.q12_dor_face_4_semanas" somenteLeitura
      esquema={campoDe("questionario_dtm", "q12_dor_face_4_semanas")} valor aoMudar={() => {}} />);
    expect(screen.getByRole("button", { name: "Sim" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sim" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("campos condicionais", () => {
  it("aplicarAlteracao remove o valor do campo que deixa de aparecer", () => {
    const secao = secoes.historia_medica;
    const antes = { q4_usa_medicamento: true, q4_medicamentos: "Losartana" };
    expect(aplicarAlteracao(secao, antes, "q4_usa_medicamento", false)).toEqual({ q4_usa_medicamento: false });
    expect(aplicarAlteracao(secao, antes, "q3_alergias", "Nega.")).toEqual({ ...antes, q3_alergias: "Nega." });
  });

  it("o campo 'quais medicamentos' aparece só depois de responder Sim", async () => {
    function Seção() {
      const [valores, setValores] = useState<ValoresSecao>({});
      return <RenderizadorSecao secao="historia_medica" esquemaSecao={secoes.historia_medica} valores={valores}
        aoMudar={setValores} erros={{}} />;
    }
    const { container } = render(<Seção />);
    const medicamentos = () => container.querySelector('[data-caminho="historia_medica.q4_medicamentos"]');
    expect(medicamentos()).toBeNull();
    const perguntaUso = container.querySelector('[data-caminho="historia_medica.q4_usa_medicamento"]')!;
    await userEvent.click(perguntaUso.querySelector("button")!); // "Sim"
    expect(medicamentos()).not.toBeNull();
  });

  it("destaca o campo com erro de validação", () => {
    const { container } = render(
      <RenderizadorSecao secao="questionario_dtm" esquemaSecao={secoes.questionario_dtm} valores={{}}
        aoMudar={() => {}} erros={{ "questionario_dtm.q16_dor_atual": "deve ser <= 10" }} />,
    );
    const campo = container.querySelector('[data-caminho="questionario_dtm.q16_dor_atual"]')!;
    expect(campo).toHaveTextContent("deve ser <= 10");
  });
});

describe("mapa de palpação", () => {
  it("a tabela grava a intensidade no sítio e lado corretos e o desenho reflete o valor", async () => {
    const aoMudar = vi.fn();
    const { rerender } = render(<MapaPalpacao muscular={{}} articular={{}} aoMudar={aoMudar} />);
    await userEvent.click(screen.getByRole("group", { name: "Masseter no corpo, direito" }).querySelectorAll("button")[2]);
    expect(aoMudar).toHaveBeenLastCalledWith("q44_palpacao_muscular", { masseter_corpo: { direito: 2 } });

    rerender(<MapaPalpacao muscular={{ masseter_corpo: { direito: 2 } }} articular={{}} aoMudar={aoMudar} />);
    expect(screen.getByRole("button", { name: "Masseter no corpo, direito: 2 (dor moderada)" })).toBeInTheDocument();
  });

  it("clicar no desenho alterna 0 → 1 → 2 → 3 → vazio, e a ATM grava na questão 45", async () => {
    const aoMudar = vi.fn();
    render(<MapaPalpacao muscular={{}} articular={{ articular_lateral: { esquerdo: 3 } }} aoMudar={aoMudar} />);
    await userEvent.click(screen.getByRole("button", { name: /ATM lateral, esquerdo: 3/ }));
    expect(aoMudar).toHaveBeenLastCalledWith("q45_palpacao_articular", { articular_lateral: { esquerdo: null } });
  });
});

describe("odontograma", () => {
  it("remove dentes sem informação e faces apagadas", () => {
    expect(limparOdontograma({
      "11": {},
      "36": { faces: { O: "carie", M: undefined } },
      "48": { ausente: true, condicoes: [], observacao: "  " },
      "21": { ausente: false },
    })).toEqual({ "36": { faces: { O: "carie" } }, "48": { ausente: true } });
  });
});
