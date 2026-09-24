// Roda uma estruturação avulsa e mostra a saída bruta, as sugestões e os descartes.
// Uso (em packages/ia): npx tsx scripts/experimentar.ts historia_medica "relato..." [modelo]
import { clienteOllama, estruturar } from "../src";

const [secoes = "historia_medica", relato = "", modelo = "qwen2.5:3b"] = process.argv.slice(2);
const r = await estruturar(clienteOllama(), { secoes: secoes.split(","), relato, modelo });
console.log("SAÍDA BRUTA:", JSON.stringify(r.saida, null, 1));
console.log("SUGESTÕES:", r.sugestoes);
console.log("DESCARTADOS:", r.descartados);
console.log(`latência ${(r.latenciaMs / 1000).toFixed(1)} s, ${r.tokensGerados} tokens`);
