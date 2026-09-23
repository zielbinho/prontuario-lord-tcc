import { validar } from "@lord/ficha";
import type { FastifyInstance } from "fastify";
import type { Sql } from "postgres";
import { auditar } from "../auditoria";
import { exigir, usuarioDe } from "../autenticacao";
import { comUsuario, type Transacao } from "../banco";
import type { Config } from "../config";
import { ErroHttp, naoEncontrado } from "../erros";

interface DadosPaciente {
  numero_prontuario?: string | null;
  nome: string;
  data_nascimento: string;
  sexo?: "M" | "F" | null;
  estado_civil?: string | null;
  profissao?: string | null;
  telefone?: string | null;
  telefone_recado?: string | null;
  endereco?: string | null;
  rg?: string | null;
  cpf?: string | null;
}

// Campos marcados com x-cifrado no esquema do paciente
const CIFRADOS = ["telefone", "telefone_recado", "endereco", "rg", "cpf"] as const;

export function rotasPacientes(app: FastifyInstance, sql: Sql, config: Config): void {
  const clinicos = { preHandler: exigir("aluno", "professor") };
  const chave = config.chaveCriptografia;

  const cifrar = (tx: Transacao, valor: string | null | undefined) =>
    tx`pgp_sym_encrypt(${valor ?? null}::text, ${chave})`;
  const decifrar = (tx: Transacao, coluna: string) =>
    tx`pgp_sym_decrypt(${tx(coluna)}, ${chave})`;
  const indiceCpf = (tx: Transacao, cpf: string | null | undefined) =>
    tx`hmac(${cpf ?? null}::text, ${config.chaveIndice}, 'sha256')`;

  function validarPaciente(dados: unknown): asserts dados is DadosPaciente {
    const r = validar("paciente", dados);
    if (!r.valido) throw new ErroHttp(400, "dados do paciente inválidos", r.erros);
  }

  async function lerPaciente(tx: Transacao, id: string) {
    const [p] = await tx`
      select id, numero_prontuario, nome, data_nascimento, sexo, estado_civil, profissao,
             ${decifrar(tx, "telefone_cifrado")} as telefone,
             ${decifrar(tx, "telefone_recado_cifrado")} as telefone_recado,
             ${decifrar(tx, "endereco_cifrado")} as endereco,
             ${decifrar(tx, "rg_cifrado")} as rg,
             ${decifrar(tx, "cpf_cifrado")} as cpf,
             criado_em
      from paciente where id = ${id}`;
    return p;
  }

  app.get<{ Querystring: { busca?: string } }>("/pacientes", clinicos, async (req) =>
    comUsuario(sql, usuarioDe(req).id, async (tx) => {
      const busca = req.query.busca?.trim();
      // Busca por CPF compara o índice HMAC; por nome ou prontuário, texto parcial
      const somenteDigitos = busca?.replace(/\D/g, "") ?? "";
      const filtro = !busca
        ? tx``
        : somenteDigitos.length === 11
          ? tx`where cpf_indice = ${indiceCpf(tx, somenteDigitos)}`
          : tx`where lower(nome) like ${"%" + busca.toLowerCase() + "%"} or numero_prontuario = ${busca}`;
      return tx`
        select id, numero_prontuario, nome, data_nascimento, sexo
        from paciente ${filtro}
        order by nome limit 100`;
    }),
  );

  app.post<{ Body: DadosPaciente }>("/pacientes", clinicos, async (req, resposta) => {
    validarPaciente(req.body);
    const d = req.body;
    const eu = usuarioDe(req);
    const paciente = await comUsuario(sql, eu.id, async (tx) => {
      const [{ id }] = await tx`
        insert into paciente (numero_prontuario, nome, data_nascimento, sexo, estado_civil, profissao,
                              telefone_cifrado, telefone_recado_cifrado, endereco_cifrado, rg_cifrado,
                              cpf_cifrado, cpf_indice, criado_por)
        values (${d.numero_prontuario ?? null}, ${d.nome}, ${d.data_nascimento}, ${d.sexo ?? null},
                ${d.estado_civil ?? null}, ${d.profissao ?? null},
                ${cifrar(tx, d.telefone)}, ${cifrar(tx, d.telefone_recado)}, ${cifrar(tx, d.endereco)},
                ${cifrar(tx, d.rg)}, ${cifrar(tx, d.cpf)}, ${indiceCpf(tx, d.cpf)}, ${eu.id})
        returning id`;
      await auditar(tx, { usuarioId: eu.id, acao: "criar_paciente", entidade: "paciente", entidadeId: id, ip: req.ip });
      return lerPaciente(tx, id);
    });
    return resposta.code(201).send(paciente);
  });

  app.get<{ Params: { id: string } }>("/pacientes/:id", clinicos, async (req) =>
    comUsuario(sql, usuarioDe(req).id, async (tx) => {
      const paciente = await lerPaciente(tx, req.params.id);
      if (!paciente) throw naoEncontrado("paciente não encontrado");
      const consentimentos = await tx`
        select id, tipo, versao_termo, aceito_em from consentimento
        where paciente_id = ${req.params.id} order by aceito_em`;
      const tratamentos = await tx`
        select id, categoria, inicio, fim from tratamento
        where paciente_id = ${req.params.id} order by inicio`;
      await auditar(tx, { usuarioId: usuarioDe(req).id, acao: "ler_paciente", entidade: "paciente", entidadeId: req.params.id, ip: req.ip });
      return { ...paciente, consentimentos, tratamentos };
    }),
  );

  app.put<{ Params: { id: string }; Body: DadosPaciente }>("/pacientes/:id", clinicos, async (req) => {
    validarPaciente(req.body);
    const d = req.body;
    return comUsuario(sql, usuarioDe(req).id, async (tx) => {
      const [alterado] = await tx`
        update paciente set
          numero_prontuario = ${d.numero_prontuario ?? null}, nome = ${d.nome},
          data_nascimento = ${d.data_nascimento}, sexo = ${d.sexo ?? null},
          estado_civil = ${d.estado_civil ?? null}, profissao = ${d.profissao ?? null},
          telefone_cifrado = ${cifrar(tx, d.telefone)}, telefone_recado_cifrado = ${cifrar(tx, d.telefone_recado)},
          endereco_cifrado = ${cifrar(tx, d.endereco)}, rg_cifrado = ${cifrar(tx, d.rg)},
          cpf_cifrado = ${cifrar(tx, d.cpf)}, cpf_indice = ${indiceCpf(tx, d.cpf)}
        where id = ${req.params.id}
        returning id`;
      if (!alterado) throw naoEncontrado("paciente não encontrado");
      await auditar(tx, {
        usuarioId: usuarioDe(req).id, acao: "alterar_paciente", entidade: "paciente", entidadeId: alterado.id,
        detalhes: { campos: Object.keys(d).filter((c) => !(CIFRADOS as readonly string[]).includes(c)).concat(
          CIFRADOS.filter((c) => c in d).map((c) => `${c} (cifrado)`)) },
        ip: req.ip,
      });
      return lerPaciente(tx, alterado.id);
    });
  });

  app.post<{ Params: { id: string }; Body: { tipo: string; versao_termo: string; aceito_em: string } }>(
    "/pacientes/:id/consentimentos",
    {
      ...clinicos,
      schema: {
        body: {
          type: "object",
          required: ["tipo", "versao_termo", "aceito_em"],
          additionalProperties: false,
          properties: {
            tipo: { enum: ["tcle", "gravacao_audio", "pesquisa"] },
            versao_termo: { type: "string", minLength: 1, maxLength: 50 },
            aceito_em: { type: "string", format: "date" },
          },
        },
      },
    },
    async (req, resposta) => {
      const eu = usuarioDe(req);
      const registro = await comUsuario(sql, eu.id, async (tx) => {
        const [c] = await tx`
          insert into consentimento (paciente_id, tipo, versao_termo, aceito_em, registrado_por)
          values (${req.params.id}, ${req.body.tipo}, ${req.body.versao_termo}, ${req.body.aceito_em}, ${eu.id})
          returning id, tipo, versao_termo, aceito_em`;
        await auditar(tx, { usuarioId: eu.id, acao: "registrar_consentimento", entidade: "paciente", entidadeId: req.params.id, detalhes: { tipo: c.tipo }, ip: req.ip });
        return c;
      });
      return resposta.code(201).send(registro);
    },
  );

  app.post<{ Params: { id: string }; Body: { categoria: string; inicio: string; fim?: string | null } }>(
    "/pacientes/:id/tratamentos",
    {
      ...clinicos,
      schema: {
        body: {
          type: "object",
          required: ["categoria", "inicio"],
          additionalProperties: false,
          properties: {
            categoria: { type: "string" },
            inicio: { type: "string", format: "date" },
            fim: { type: ["string", "null"], format: "date" },
          },
        },
      },
    },
    async (req, resposta) => {
      const eu = usuarioDe(req);
      const registro = await comUsuario(sql, eu.id, async (tx) => {
        const [t] = await tx`
          insert into tratamento (paciente_id, categoria, inicio, fim, registrado_por)
          values (${req.params.id}, ${req.body.categoria}, ${req.body.inicio}, ${req.body.fim ?? null}, ${eu.id})
          returning id, categoria, inicio, fim`;
        await auditar(tx, { usuarioId: eu.id, acao: "registrar_tratamento", entidade: "paciente", entidadeId: req.params.id, detalhes: { categoria: t.categoria }, ip: req.ip });
        return t;
      });
      return resposta.code(201).send(registro);
    },
  );
}
