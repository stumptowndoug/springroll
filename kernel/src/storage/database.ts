import { Database } from "bun:sqlite";
import { chmodSync } from "node:fs";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema.ts";

export type AppDatabase = BunSQLiteDatabase<typeof schema>;

export interface LocalDatabase {
  readonly sqlite: Database;
  readonly db: AppDatabase;
  close(): void;
}

export interface OpenLocalDatabaseOptions {
  readonly filename: string;
  readonly migrationsFolder?: string;
}

export function openLocalDatabase(
  options: OpenLocalDatabaseOptions,
): LocalDatabase {
  const sqlite = new Database(options.filename, {
    create: true,
    readwrite: true,
  });
  if (options.filename !== ":memory:") chmodSync(options.filename, 0o600);
  sqlite.run("PRAGMA foreign_keys = ON");
  sqlite.run("PRAGMA busy_timeout = 5000");

  if (options.filename !== ":memory:") {
    sqlite.run("PRAGMA journal_mode = WAL");
  }

  const db = drizzle(sqlite, { schema });
  migrate(db, {
    migrationsFolder:
      options.migrationsFolder ??
      new URL("../../../drizzle", import.meta.url).pathname,
  });

  return {
    sqlite,
    db,
    close: () => sqlite.close(),
  };
}
