import { campoVisivel, type Esquema } from "@lord/ficha";
import { CampoEsquema } from "./CampoEsquema";
import { MapaPalpacao, type ValoresPalpacao } from "./MapaPalpacao";

export type ValoresSecao = Record<string, unknown>;

const CAMPOS_PALPACAO = ["q44_palpacao_muscular", "q45_palpacao_articular"];

/**
 * Aplica uma alteração e remove os valores de campos que deixaram de ser visíveis
 * (ex.: "quais medicamentos" quando a resposta muda para "não usa medicamento").
 */
export function aplicarAlteracao(esquemaSecao: Esquema, valores: ValoresSecao, campo: string, valor: unknown): ValoresSecao {
  const proximos: ValoresSecao = { ...valores, [campo]: valor };
  for (const [nome, esquemaCampo] of Object.entries(esquemaSecao.properties as Record<string, Esquema>)) {
    if (!campoVisivel(esquemaCampo, proximos)) delete proximos[nome];
  }
  return proximos;
}

interface Props {
  secao: string;
  esquemaSecao: Esquema;
  valores: ValoresSecao | undefined;
  aoMudar: (valores: ValoresSecao) => void;
  somenteLeitura?: boolean;
  /** erros de validação indexados pelo caminho com pontos (ex.: "questionario_dtm.q16_dor_atual") */
  erros: Record<string, string>;
}

export function RenderizadorSecao({ secao, esquemaSecao, valores = {}, aoMudar, somenteLeitura, erros }: Props) {
  const propriedades = esquemaSecao.properties as Record<string, Esquema>;
  const mudar = (campo: string, valor: unknown) => aoMudar(aplicarAlteracao(esquemaSecao, valores, campo, valor));

  return (
    <div className="divide-y divide-borda">
      {Object.entries(propriedades).map(([campo, esquemaCampo]) => {
        if (!campoVisivel(esquemaCampo, valores)) return null;

        if (CAMPOS_PALPACAO.includes(campo)) {
          if (campo !== CAMPOS_PALPACAO[0]) return null; // o mapa desenha as duas questões juntas
          return (
            <div key={campo} className="p-3">
              <h3 className="mb-3 text-sm font-medium">
                <span className="mr-2 rounded bg-fundo px-1.5 py-0.5 text-xs font-semibold text-suave">43–45</span>
                Dor à palpação muscular e articular
              </h3>
              <MapaPalpacao
                muscular={valores.q44_palpacao_muscular as ValoresPalpacao | undefined}
                articular={valores.q45_palpacao_articular as ValoresPalpacao | undefined}
                aoMudar={(nome, v) => mudar(nome, v)}
                somenteLeitura={somenteLeitura}
              />
            </div>
          );
        }

        const caminho = `${secao}.${campo}`;
        const erro = Object.entries(erros).find(([c]) => c === caminho || c.startsWith(`${caminho}.`))?.[1];
        return (
          <CampoEsquema key={campo} caminho={caminho} esquema={esquemaCampo} valor={valores[campo]}
            aoMudar={(v) => mudar(campo, v)} somenteLeitura={somenteLeitura} erro={erro} />
        );
      })}
    </div>
  );
}
