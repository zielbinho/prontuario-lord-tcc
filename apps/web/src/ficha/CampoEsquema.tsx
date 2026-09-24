import { rotulo, type Esquema } from "@lord/ficha";
import { useId } from "react";
import { classes } from "../componentes/ui";

export interface PropsCampo {
  esquema: Esquema;
  valor: unknown;
  aoMudar: (valor: unknown) => void;
  somenteLeitura?: boolean;
  erro?: string;
  caminho: string;
}

const tipos = (esquema: Esquema): string[] =>
  Array.isArray(esquema.type) ? (esquema.type as string[]) : esquema.type ? [esquema.type as string] : [];

/** Qual controle usar para um nó do esquema. Exportado para teste. */
export function tipoDeControle(esquema: Esquema): "escolha" | "multipla" | "simnao" | "escala" | "numero" | "texto" | "desconhecido" {
  const t = tipos(esquema);
  if (Array.isArray(esquema.enum)) return "escolha";
  if (t.includes("array") && Array.isArray((esquema.items as Esquema | undefined)?.enum)) return "multipla";
  if (t.includes("boolean")) return "simnao";
  if (t.includes("integer") && esquema.minimum === 0 && esquema.maximum === 10) return "escala";
  if (t.includes("integer") || t.includes("number")) return "numero";
  if (t.includes("string")) return "texto";
  return "desconhecido";
}

function Pilula({
  ativa, aoClicar, desabilitada, children, cor,
}: { ativa: boolean; aoClicar: () => void; desabilitada?: boolean; children: React.ReactNode; cor?: string }) {
  return (
    <button
      type="button"
      aria-pressed={ativa}
      disabled={desabilitada}
      onClick={aoClicar}
      className={classes(
        "min-h-10 rounded-lg border px-3 text-sm transition-colors disabled:cursor-default",
        ativa
          ? cor ?? "border-marca-600 bg-marca-600 font-medium text-white"
          : "border-borda bg-superficie hover:border-marca-500 disabled:hover:border-borda",
        desabilitada && !ativa && "opacity-60",
      )}
    >
      {children}
    </button>
  );
}

const COR_ESCALA = (n: number) =>
  n === 0 ? "border-transparent bg-dor-0 font-semibold" : n <= 3 ? "border-transparent bg-dor-1 font-semibold" : n <= 6 ? "border-transparent bg-dor-2 font-semibold" : "border-transparent bg-dor-3 font-semibold text-white";

export function CampoEsquema({ esquema, valor, aoMudar, somenteLeitura, erro, caminho }: PropsCampo) {
  const id = useId();
  const idRotulo = `${id}-rotulo`;
  const titulo = (esquema.title as string | undefined) ?? caminho.split(".").pop();
  const questao = esquema["x-questao"] as string | undefined;
  const obrigatorio = esquema["x-obrigatorio"] === true;
  const descricao = esquema.description as string | undefined;
  const controle = tipoDeControle(esquema);

  let conteudo: React.ReactNode;
  switch (controle) {
    case "escolha": {
      const opcoes = (esquema.enum as unknown[]).filter((v) => v !== null);
      conteudo = (
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby={idRotulo}>
          {opcoes.map((opcao) => (
            <Pilula key={String(opcao)} ativa={valor === opcao} desabilitada={somenteLeitura}
              aoClicar={() => aoMudar(valor === opcao ? null : opcao)}>
              {rotulo(opcao)}
            </Pilula>
          ))}
        </div>
      );
      break;
    }
    case "multipla": {
      const opcoes = (esquema.items as Esquema).enum as string[];
      const marcados = Array.isArray(valor) ? (valor as string[]) : [];
      conteudo = (
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby={idRotulo}>
          {opcoes.map((opcao) => {
            const ativa = marcados.includes(opcao);
            return (
              <Pilula key={opcao} ativa={ativa} desabilitada={somenteLeitura}
                aoClicar={() => aoMudar(ativa ? marcados.filter((m) => m !== opcao) : opcoes.filter((o) => o === opcao || marcados.includes(o)))}>
                {ativa ? "✓ " : ""}{rotulo(opcao)}
              </Pilula>
            );
          })}
        </div>
      );
      break;
    }
    case "simnao":
      conteudo = (
        <div className="flex gap-2" role="group" aria-labelledby={idRotulo}>
          {[true, false].map((opcao) => (
            <Pilula key={String(opcao)} ativa={valor === opcao} desabilitada={somenteLeitura}
              aoClicar={() => aoMudar(valor === opcao ? null : opcao)}>
              {opcao ? "Sim" : "Não"}
            </Pilula>
          ))}
        </div>
      );
      break;
    case "escala":
      conteudo = (
        <div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={idRotulo}>
            {Array.from({ length: 11 }, (_, n) => (
              <Pilula key={n} ativa={valor === n} desabilitada={somenteLeitura} cor={COR_ESCALA(n)}
                aoClicar={() => aoMudar(valor === n ? null : n)}>
                <span className="inline-block w-4 tabular-nums">{n}</span>
              </Pilula>
            ))}
          </div>
          <div className="mt-1 flex max-w-[34rem] justify-between text-xs text-suave">
            <span>Nenhuma</span>
            <span>Pior possível</span>
          </div>
        </div>
      );
      break;
    case "numero": {
      const inteiro = tipos(esquema).includes("integer");
      const unidade = /\(mm\)/.test(titulo ?? "") ? "mm" : undefined;
      conteudo = (
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="number"
            inputMode={inteiro ? "numeric" : "decimal"}
            step={inteiro ? 1 : 0.5}
            min={esquema.minimum as number | undefined}
            max={esquema.maximum as number | undefined}
            value={valor === null || valor === undefined ? "" : String(valor)}
            disabled={somenteLeitura}
            onChange={(e) => {
              const texto = e.target.value;
              aoMudar(texto === "" ? null : inteiro ? Math.trunc(Number(texto)) : Number(texto));
            }}
            className="min-h-10 w-28 rounded-lg border border-borda bg-superficie px-3 text-sm tabular-nums disabled:opacity-70"
          />
          {unidade && <span className="text-sm text-suave">{unidade}</span>}
        </div>
      );
      break;
    }
    case "texto": {
      const texto = typeof valor === "string" ? valor : "";
      conteudo = (
        <textarea
          id={id}
          value={texto}
          disabled={somenteLeitura}
          rows={Math.min(8, Math.max(2, Math.ceil(texto.length / 90)))}
          maxLength={esquema.maxLength as number | undefined}
          onChange={(e) => aoMudar(e.target.value === "" ? null : e.target.value)}
          className="w-full rounded-lg border border-borda bg-superficie px-3 py-2 text-sm disabled:opacity-80"
        />
      );
      break;
    }
    default:
      conteudo = <p className="text-sm text-perigo">Tipo de campo não suportado.</p>;
  }

  return (
    <div className={classes("rounded-lg p-3", erro && "bg-perigo-fundo")} data-caminho={caminho}>
      <div className="mb-2 flex items-baseline gap-2">
        {questao && /^\d+$/.test(questao) && (
          <span className="shrink-0 rounded bg-fundo px-1.5 py-0.5 text-xs font-semibold tabular-nums text-suave">
            {questao}
          </span>
        )}
        <label id={idRotulo} htmlFor={controle === "numero" || controle === "texto" ? id : undefined} className="text-sm font-medium">
          {titulo}
          {obrigatorio && <span className="ml-0.5 text-perigo" title="Campo obrigatório">*</span>}
        </label>
      </div>
      {descricao && <p className="-mt-1 mb-2 text-xs text-suave">{descricao}</p>}
      {conteudo}
      {erro && <p className="mt-1 text-xs text-perigo">{erro}</p>}
    </div>
  );
}
