import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DatabaseSync as Database, SQLInputValue } from "node:sqlite";

// node:sqlite prints a one-off ExperimentalWarning when it loads; drop just that one, so test output stays clean
const emitWarning = process.emitWarning;
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  if (String(warning).includes("SQLite is an experimental feature")) return;
  (emitWarning as (...args: unknown[]) => void).call(process, warning, ...rest);
}) as typeof process.emitWarning;
const { DatabaseSync } = await import("node:sqlite");
process.emitWarning = emitWarning;

const WRITE = /^\s*(insert|update|delete|replace)\b/i;

// Relative to this file, so the tests run from any working directory
const MIGRATIONS = fileURLToPath(new URL("../../migrations/", import.meta.url));

// The slice of D1's prepared statement the app uses: bind, first, all, run (and batch, below)
class Statement {
  constructor(
    private readonly db: Database,
    private readonly sql: string,
    private readonly params: SQLInputValue[] = [],
  ) {}

  // D1 is stricter than SQLite here, so a mistake that passes in the tests can't fail in production
  bind(...values: unknown[]): Statement {
    const params = values.map((value) => {
      if (value === undefined) throw new Error("D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'");
      return typeof value === "boolean" ? Number(value) : (value as SQLInputValue);
    });
    return new Statement(this.db, this.sql, params);
  }

  /** Prepares the statement, refusing a bind count that doesn't match its placeholders, as D1 does (no SQL here has a literal ?) */
  private prepare() {
    const placeholders = this.sql.split("?").length - 1;
    if (placeholders !== this.params.length) throw new Error(`Wrong number of parameter bindings for SQL query: expected ${placeholders}, got ${this.params.length}`);
    return this.db.prepare(this.sql);
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.prepare().get(...this.params) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : { ...row }) as T;
  }

  async all() {
    return this.execute();
  }

  async run() {
    return this.execute();
  }

  /** Runs now and reports like D1: rows for reads, changes and the new row id for writes */
  execute(): D1Result {
    const statement = this.prepare();
    if (WRITE.test(this.sql)) {
      const { changes, lastInsertRowid } = statement.run(...this.params);
      return { results: [], success: true, meta: { changes: Number(changes), last_row_id: Number(lastInsertRowid) } } as unknown as D1Result;
    }
    const results = statement.all(...this.params).map((row) => ({ ...row }));
    return { results, success: true, meta: { changes: 0, last_row_id: 0 } } as unknown as D1Result;
  }
}

/** A D1 database in memory with every migration in migrations/ applied, so the seed is there too */
export function sqliteD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(`${MIGRATIONS}${file}`, "utf8"));
  }
  return {
    prepare: (sql: string) => new Statement(db, sql),
    // Like D1's batch: one transaction, all or nothing
    async batch(statements: Statement[]) {
      db.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.execute());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
}
