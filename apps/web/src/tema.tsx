import { useState } from "react";

// Preferência de tema: "automatico" segue o sistema operacional. Fica só neste navegador.
export type PreferenciaTema = "automatico" | "claro" | "escuro";
const CHAVE = "lord-tema";
const ORDEM: PreferenciaTema[] = ["automatico", "claro", "escuro"];
const NOMES: Record<PreferenciaTema, string> = { automatico: "Automático", claro: "Claro", escuro: "Escuro" };

export function lerTema(): PreferenciaTema {
  try {
    const valor = localStorage.getItem(CHAVE);
    return valor === "claro" || valor === "escuro" ? valor : "automatico";
  } catch {
    return "automatico";
  }
}

export function aplicarTema(tema: PreferenciaTema): void {
  const raiz = document.documentElement;
  if (tema === "automatico") delete raiz.dataset.tema;
  else raiz.dataset.tema = tema;
  try {
    if (tema === "automatico") localStorage.removeItem(CHAVE);
    else localStorage.setItem(CHAVE, tema);
  } catch {
    // armazenamento indisponível: o tema vale só até recarregar a página
  }
}

function Icone({ tema }: { tema: PreferenciaTema }) {
  const comum = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (tema === "claro") {
    return <svg {...comum}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
  }
  if (tema === "escuro") return <svg {...comum}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>;
  return <svg {...comum}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>;
}

/** Botão que alterna automático → claro → escuro. */
export function AlternarTema({ className = "" }: { className?: string }) {
  const [tema, setTema] = useState<PreferenciaTema>(lerTema);
  const proximo = ORDEM[(ORDEM.indexOf(tema) + 1) % ORDEM.length];
  return (
    <button type="button"
      onClick={() => { aplicarTema(proximo); setTema(proximo); }}
      aria-label={`Tema: ${NOMES[tema]}. Mudar para ${NOMES[proximo].toLowerCase()}`}
      title={`Tema: ${NOMES[tema]}`}
      className={`flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-suave hover:bg-fundo hover:text-texto ${className}`}>
      <Icone tema={tema} />
      <span className="text-xs">{NOMES[tema]}</span>
    </button>
  );
}
