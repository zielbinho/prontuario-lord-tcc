// Ponto de entrada em produção (servidor da UEPG): aplica as migrações e inicia a API.
import { criarApp } from "./app";
import { conectar, configurarPapeis, migrar } from "./banco";
import { carregarConfig } from "./config";

const config = carregarConfig();

const admin = conectar(config.urlBancoAdmin, { max: 1 });
const aplicadas = await migrar(admin);
await configurarPapeis(admin, config);
await admin.end();
console.log(aplicadas.length ? `Migrações aplicadas: ${aplicadas.join(", ")}` : "Banco já atualizado");

if (!process.argv.includes("--somente-migrar")) {
  const sql = conectar(config.urlBanco);
  const app = await criarApp({ sql, config, log: true });
  await app.listen({ port: config.porta, host: "0.0.0.0" });
}
