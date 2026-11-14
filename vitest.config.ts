import path from "node:path";
import { defineConfig } from "vitest/config";

const web = path.resolve(__dirname, "apps/web");

export default defineConfig({
  resolve: {
    alias: [
      // "server-only" só existe para o bundler do Next barrar imports no navegador: nos testes é um módulo vazio.
      { find: "server-only", replacement: path.join(web, "test/server-only.ts") },
      { find: /^@\//, replacement: `${path.join(web, "src")}/` },
    ],
  },
  test: {
    // Os testes de servidor compartilham um banco: um arquivo por vez.
    fileParallelism: false,
  },
});
