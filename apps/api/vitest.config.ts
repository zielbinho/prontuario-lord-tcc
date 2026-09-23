import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/banco-de-teste.ts"],
    // todos os arquivos compartilham o mesmo banco; rodá-los em sequência evita interferência
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 120000,
  },
});
