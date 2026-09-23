import type { Sql } from "postgres";
import type { Transacao } from "./banco";

export interface EventoAuditoria {
  usuarioId: string | null;
  acao: string;
  entidade?: string;
  entidadeId?: string | null;
  /** Nunca incluir valores clínicos ou pessoais: apenas metadados (seções alteradas, status...). */
  detalhes?: Record<string, unknown>;
  ip?: string | null;
}

/** Registra um evento na trilha de auditoria, na mesma transação da operação auditada. */
export async function auditar(tx: Transacao | Sql, e: EventoAuditoria): Promise<void> {
  await tx`
    insert into auditoria (usuario_id, acao, entidade, entidade_id, detalhes, ip)
    values (${e.usuarioId}, ${e.acao}, ${e.entidade ?? null}, ${e.entidadeId ?? null},
            ${tx.json((e.detalhes ?? {}) as never)}, ${e.ip ?? null})`;
}
