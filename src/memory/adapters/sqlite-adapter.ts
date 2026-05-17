import {
  type VectorEntry,
  type SearchResult,
  type VectorStoreAdapter,
  cosineSimilarity,
} from '../vector-store.js';

export interface SqliteAdapterOptions {
  dbPath: string;
  tableName?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Database = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Statement = any;

export class SqliteAdapter implements VectorStoreAdapter {
  private db: Database;
  private tableName: string;
  private stmtUpsert: Statement;
  private stmtDelete: Statement;
  private stmtGetAll: Statement;

  private constructor(db: Database, tableName: string) {
    this.db = db;
    this.tableName = tableName;

    this.db.exec(
      `CREATE TABLE IF NOT EXISTS ${this.tableName} (` +
        `id TEXT PRIMARY KEY, ` +
        `content TEXT NOT NULL, ` +
        `embedding TEXT NOT NULL, ` +
        `metadata TEXT` +
        `)`
    );
    this.db.pragma('journal_mode = WAL');

    this.stmtUpsert = this.db.prepare(
      `INSERT OR REPLACE INTO ${this.tableName} (id, content, embedding, metadata) VALUES (?, ?, ?, ?)`
    );
    this.stmtDelete = this.db.prepare(
      `DELETE FROM ${this.tableName} WHERE id = ?`
    );
    this.stmtGetAll = this.db.prepare(
      `SELECT id, content, embedding, metadata FROM ${this.tableName}`
    );
  }

  static async create(options: SqliteAdapterOptions): Promise<SqliteAdapter> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let betterSqlite3: any;
    try {
      // Dynamic import with string variable to avoid TypeScript module resolution
      const moduleName = 'better-sqlite3';
      betterSqlite3 = await import(/* @vite-ignore */ moduleName);
    } catch {
      throw new Error(
        "SqliteAdapter requires the 'better-sqlite3' package. Install it with: npm install better-sqlite3"
      );
    }

    const db = betterSqlite3.default(options.dbPath);
    const tableName = options.tableName ?? 'vectors';
    return new SqliteAdapter(db, tableName);
  }

  async add(entry: VectorEntry): Promise<void> {
    this.stmtUpsert.run(
      entry.id,
      entry.content,
      JSON.stringify(entry.embedding),
      entry.metadata ? JSON.stringify(entry.metadata) : null
    );
  }

  async addBatch(entries: VectorEntry[]): Promise<void> {
    const transaction = this.db.transaction((items: VectorEntry[]) => {
      for (const entry of items) {
        this.stmtUpsert.run(
          entry.id,
          entry.content,
          JSON.stringify(entry.embedding),
          entry.metadata ? JSON.stringify(entry.metadata) : null
        );
      }
    });
    transaction(entries);
  }

  async get(id: string): Promise<VectorEntry | undefined> {
    const row = this.db.prepare(
      `SELECT id, content, embedding, metadata FROM ${this.tableName} WHERE id = ?`
    ).get(id) as DbRow | undefined;
    if (!row) return undefined;
    return this.rowToEntry(row);
  }

  async remove(id: string): Promise<boolean> {
    const result = this.stmtDelete.run(id);
    return result.changes > 0;
  }

  async search(query: number[], topK: number, minScore: number): Promise<SearchResult[]> {
    const rows = this.stmtGetAll.all() as DbRow[];
    const results: SearchResult[] = [];

    for (const row of rows) {
      const embedding = JSON.parse(row.embedding) as number[];
      const score = cosineSimilarity(query, embedding);
      if (score >= minScore) {
        results.push({
          id: row.id,
          content: row.content,
          score,
          metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  async count(): Promise<number> {
    const row = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM ${this.tableName}`
    ).get() as { cnt: number };
    return row.cnt;
  }

  async clear(): Promise<void> {
    this.db.exec(`DELETE FROM ${this.tableName}`);
  }

  async save(): Promise<void> {
    // SQLite writes are immediate; nothing to flush.
  }

  async load(): Promise<VectorEntry[]> {
    const rows = this.stmtGetAll.all() as DbRow[];
    return rows.map((row) => this.rowToEntry(row));
  }

  close(): void {
    this.db.close();
  }

  private rowToEntry(row: DbRow): VectorEntry {
    return {
      id: row.id,
      content: row.content,
      embedding: JSON.parse(row.embedding) as number[],
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }
}

interface DbRow {
  id: string;
  content: string;
  embedding: string;
  metadata: string | null;
}
