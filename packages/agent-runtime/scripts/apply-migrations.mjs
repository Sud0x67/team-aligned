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

const existingTables = new Set(
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() ?? []).map((row) => row.name),
);

const hasExistingRuntimeTables =
  existingTables.has("conversations") ||
  existingTables.has("messages") ||
  existingTables.has("runs");

if (applied.size === 0 && hasExistingRuntimeTables && migrationFiles.length > 0) {
  for (const fileName of migrationFiles) {
    db.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
      .run(fileName, Date.now());
  }
  console.log("Detected an existing runtime database. Marked baseline Drizzle migrations as applied.");
  console.log(`Migrations complete. Database: ${dbPath}`);
  process.exit(0);
}

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
