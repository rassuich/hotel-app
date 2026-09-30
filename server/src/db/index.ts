import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type DB = Database.Database;

export function openDatabase(file: string): DB {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  return db;
}

function migrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Source layout: server/src/db/migrations. Bundled layout: dist/server/migrations.
  for (const candidate of [path.join(here, 'migrations'), path.join(here, 'db', 'migrations')]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Migrations directory not found near ${here}`);
}

/** Applies pending *.sql migrations in filename order, each inside a transaction. */
export function migrate(db: DB): string[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(db.prepare('SELECT id FROM schema_migrations').pluck().all() as string[]);
  const dir = migrationsDir();
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const ran: string[] = [];
  for (const file of files) {
    const id = file.replace(/\.sql$/, '');
    if (applied.has(id)) continue;
    const sql = readFileSync(path.join(dir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(id, new Date().toISOString());
    })();
    ran.push(id);
  }
  return ran;
}
