// Minimal typings for the part of better-sqlite3 we use.
declare module 'better-sqlite3' {
  interface Statement {
    run(...params: unknown[]): { changes: number };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }
  class Database {
    constructor(path: string);
    exec(sql: string): this;
    prepare(sql: string): Statement;
    pragma(sql: string): unknown;
    close(): void;
  }
  export default Database;
}
