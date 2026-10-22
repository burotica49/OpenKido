import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

const ROOT = path.join(process.cwd(), "prisma", "migrations");
const names = fs.readdirSync(ROOT).filter((n) => /^\d{14}_/.test(n)).sort();
let tmp: string;
const url = (n: string) => pathToFileURL(path.join(tmp, n)).href;
const tables = async (u: string) => {
  const c = createClient({ url: u });
  const r = await c.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name");
  c.close();
  return r.rows.map((x) => String(x.name));
};
function subset(count: number): string {
  const dir = path.join(tmp, `subset-${count}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const n of names.slice(0, count)) fs.cpSync(path.join(ROOT, n), path.join(dir, n), { recursive: true });
  return dir;
}

beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "openkido-migrate-")); });
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("applyMigrations", () => {
  it("applique tout sur une base vide, puis plus rien (idempotent)", async () => {
    const first = await applyMigrations({ databaseUrl: url("a.db"), migrationsDir: ROOT });
    expect(first.applied).toEqual(names);
    expect(await tables(url("a.db"))).toEqual(expect.arrayContaining(["Domain", "RepoAudit", "RepoPosture", "RepoQuality", "RepoScan", "ScanHistory", "UserPref", "_prisma_migrations"]));
    expect((await applyMigrations({ databaseUrl: url("a.db"), migrationsDir: ROOT })).applied).toEqual([]);
  });

  it("met à jour une ancienne base en conservant les données (redéfinition de table comprise)", async () => {
    await applyMigrations({ databaseUrl: url("b.db"), migrationsDir: subset(names.length - 1) });
    const c = createClient({ url: url("b.db") });
    await c.execute({ sql: 'insert into "RepoScan" (owner, repo, branch, total, vulnerable, critical, high, medium, low, components) values (?,?,?,?,?,?,?,?,?,?)', args: ["o", "r", "main", 5, 2, 1, 1, 0, 0, "[]"] });
    c.close();
    const r = await applyMigrations({ databaseUrl: url("b.db"), migrationsDir: ROOT });
    expect(r.applied).toEqual([names[names.length - 1]]);
    const c2 = createClient({ url: url("b.db") });
    const rows = (await c2.execute('select total, critical, status, note from "RepoScan"')).rows;
    c2.close();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].total)).toBe(5);
    expect(Number(rows[0].critical)).toBe(1);
  });

  it("ignore une base existante sans historique de migrations", async () => {
    const c = createClient({ url: url("c.db") });
    await c.execute("create table foo (id integer)");
    c.close();
    const r = await applyMigrations({ databaseUrl: url("c.db"), migrationsDir: ROOT });
    expect(r.applied).toEqual([]);
    expect(r.skipped).toMatch(/baseline/);
    expect(await tables(url("c.db"))).toEqual(["foo"]);
  });

  it("annule entièrement une migration défectueuse", async () => {
    const bad = path.join(tmp, "bad");
    fs.mkdirSync(path.join(bad, "20990101000000_broken"), { recursive: true });
    fs.writeFileSync(path.join(bad, "20990101000000_broken", "migration.sql"), 'CREATE TABLE "Half" (id integer);\nTHIS IS NOT SQL;');
    await expect(applyMigrations({ databaseUrl: url("d.db"), migrationsDir: bad })).rejects.toThrow(/20990101000000_broken/);
    expect(await tables(url("d.db"))).not.toContain("Half");
  });
});
