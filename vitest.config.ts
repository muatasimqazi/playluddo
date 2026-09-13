import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Parity tests need a live local Postgres (`supabase start`); the `test`
    // and `test:parity` npm scripts each pass an explicit directory filter
    // so the default, DB-free `npm test` never picks them up.
    include: ["tests/**/*.test.ts"],
  },
});
