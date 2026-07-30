import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./kernel/src/storage/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: "./.local/shrimp-roll.db",
  },
});
