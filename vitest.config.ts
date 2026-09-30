import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Keep Vitest aligned with tsconfig's `@/*` path alias. Vite requires an
    // absolute replacement path instead of the relative TypeScript value.
    alias: {
      "@/": new URL("./", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    // Parity tests need a live local Postgres (`supabase start`); the `test`
    // and `test:parity` npm scripts each pass an explicit directory filter
    // so the default, DB-free `npm test` never picks them up.
    include: ["tests/**/*.test.ts"],
  },
});
