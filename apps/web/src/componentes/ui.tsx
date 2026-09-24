import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import type { StatusFicha } from "../api";

export function classes(...lista: (string | false | null | undefined)[]) {
  return lista.filter(Boolean).join(" ");
}

type VarianteBotao = "primario" | "secundario" | "perigo" | "fantasma";

const VARIANTES: Record<VarianteBotao, string> = {
  primario: "bg-marca-600 text-white hover:bg-marca-700 disabled:bg-marca-600/50",
  secundario: "bg-superficie text-texto border border-borda hover:bg-fundo disabled:opacity-50",
  perigo: "bg-perigo text-superficie hover:opacity-90 disabled:opacity-50",
  fantasma: "text-destaque hover:bg-marca-50 disabled:opacity-50",
};

export function Botao({
  variante = "primario",
  className,
  carregando,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: VarianteBotao; carregando?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || carregando}
      className={classes(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed",
        VARIANTES[variante],
        className,
      )}
    >
      {carregando && <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function Cartao({ titulo, acoes, children, className }: { titulo?: ReactNode; acoes?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={classes("rounded-xl border border-borda bg-superficie", className)}>
      {(titulo || acoes) && (
        <header className="flex items-center justify-between gap-3 border-b border-borda px-5 py-3">
          <h2 className="text-base font-semibold">{titulo}</h2>
          {acoes && <div className="flex gap-2">{acoes}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

const STATUS: Record<StatusFicha, { texto: string; cor: string }> = {
  rascunho: { texto: "Rascunho", cor: "bg-rascunho-fundo text-rascunho" },
  em_revisao: { texto: "Em revisão", cor: "bg-revisao-fundo text-revisao" },
  aprovada: { texto: "Aprovada", cor: "bg-aprovada-fundo text-aprovada" },
};

export function EtiquetaStatus({ status }: { status: StatusFicha }) {
  const s = STATUS[status];
  return <span className={classes("rounded-full px-2.5 py-0.5 text-xs font-semibold", s.cor)}>{s.texto}</span>;
}

export function BarraCompletude({ fracao, compacta }: { fracao: number | null; compacta?: boolean }) {
  const pct = Math.round((fracao ?? 0) * 100);
  return (
    <div className="flex items-center gap-2" title={`Completude: ${pct}% dos campos obrigatórios`}>
      <div className={classes("overflow-hidden rounded-full bg-borda", compacta ? "h-1.5 w-16" : "h-2 w-32")}>
        <div className={classes("h-full rounded-full", pct === 100 ? "bg-aprovada" : "bg-marca-500")} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-suave">{pct}%{!compacta && " dos obrigatórios"}</span>
    </div>
  );
}

export function Carregando({ texto = "Carregando…" }: { texto?: string }) {
  return (
    <div className="flex items-center gap-3 p-6 text-suave" role="status">
      <span className="size-5 animate-spin rounded-full border-2 border-marca-500 border-t-transparent" />
      {texto}
    </div>
  );
}

export function MensagemErro({ erro }: { erro: unknown }) {
  if (!erro) return null;
  const texto = erro instanceof Error ? erro.message : String(erro);
  return (
    <div role="alert" className="rounded-lg border border-perigo/30 bg-perigo-fundo px-4 py-3 text-sm text-perigo">
      {texto}
    </div>
  );
}

export function Rotulo({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium">
      {children}
    </label>
  );
}

export function Entrada(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={classes(
        "min-h-10 w-full rounded-lg border border-borda bg-superficie px-3 text-sm placeholder:text-suave/70 disabled:opacity-60",
        props.className,
      )}
    />
  );
}

export function Selecao(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={classes("min-h-10 w-full rounded-lg border border-borda bg-superficie px-3 text-sm", props.className)}
    />
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-suave">{children}</p>;
}

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

export function formatarData(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

export function idade(dataNascimento: string, referencia = new Date()): number {
  const [ano, mes, dia] = dataNascimento.split("-").map(Number);
  let anos = referencia.getFullYear() - ano;
  if (referencia.getMonth() + 1 < mes || (referencia.getMonth() + 1 === mes && referencia.getDate() < dia)) anos--;
  return anos;
}

/** (42) 99999-0003 para celular, (42) 3222-0000 para fixo; outros formatos ficam como vieram. */
export function formatarTelefone(tel: string | null): string {
  if (!tel) return "—";
  const d = tel.replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return tel;
}

export function formatarCpf(cpf: string | null): string {
  if (!cpf) return "—";
  return cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
}
