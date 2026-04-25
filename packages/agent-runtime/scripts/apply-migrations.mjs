import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const packageRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const migrationsDir = join(packageRoot, "drizzle");
const dbPath = process.env.TEAMALIGNED_DB_PATH ?? join(homedir(), ".teamaligned", "app.db");

mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS __drizzle_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  );
`);

const applied = new Set(
  (db.prepare("SELECT hash FROM __drizzle_migrations ORDER BY id ASC").all() ?? []).map((row) => row.hash),
);

const migrationFiles = existsSync(migrationsDir)
  ? readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b))
  : [];

for (const fileName of migrationFiles) {
  if (applied.has(fileName)) continue;
  const sql = readFileSync(join(migrationsDir, fileName), "utf8");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(sql);
    db.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
      .run(fileName, Date.now());
    db.exec("COMMIT");
    console.log(`Applied migration: ${fileName}`);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

console.log(`Migrations complete. Database: ${dbPath}`);
