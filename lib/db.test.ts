// Runs the real migration in PGlite (Postgres in WASM) with stubbed Supabase schemas,
// then checks the money paths: hold, charge, refund-once, constraints, RLS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const dir = new URL("../supabase/migrations/", import.meta.url);
const migrations = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const STUBS = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated;
  grant execute on function auth.uid() to authenticated;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
`;

const ALICE = "00000000-0000-0000-0000-00000000000a";
const BOB = "00000000-0000-0000-0000-00000000000b";

async function setup() {
  const db = new PGlite();
  await db.exec(STUBS);
  for (const f of migrations) await db.exec(readFileSync(new URL(f, dir), "utf8"));
  await db.exec(`insert into auth.users values ('${ALICE}'), ('${BOB}');
    grant usage on schema public to authenticated;
    grant select, insert, update on public.generations, public.user_credits to authenticated;`);
  return db;
}

const one = async <T>(db: PGlite, sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const balance = async (db: PGlite, user: string) =>
  (await one<{ b: number }>(db, "select public.get_balance($1) as b", [user])).b;
const start = (db: PGlite, user: string, cost: number) =>
  one<{ id: string; status: string; credit_state: string }>(db, "select * from public.start_generation($1, '{}'::jsonb, $2)", [user, cost]);

test("start holds credits; insufficient balance is rejected without a row", async () => {
  const db = await setup();
  assert.equal(await balance(db, ALICE), 200);
  const g = await start(db, ALICE, 30);
  assert.equal(g.status, "queued");
  assert.equal(g.credit_state, "held");
  assert.equal(await balance(db, ALICE), 170);
  await assert.rejects(start(db, ALICE, 500), /insufficient_credits/);
  assert.equal(await balance(db, ALICE), 170);
  assert.equal((await one<{ n: number }>(db, "select count(*)::int as n from public.generations")).n, 1);
});

test("failure refunds exactly once; settled rows ignore later events", async () => {
  const db = await setup();
  const g = await start(db, ALICE, 30);
  await db.query("select public.mark_generating($1, 0.4)", [g.id]);
  const failed = await one<{ status: string; credit_state: string } | null>(db, "select * from public.fail_generation($1, 'capacity')", [g.id]);
  assert.equal(failed?.status, "failed");
  assert.equal(await balance(db, ALICE), 200);
  // Second fail and a late completion are both no-ops.
  assert.equal((await one<{ id: string | null }>(db, "select id from public.fail_generation($1, 'timeout')", [g.id])).id, null);
  assert.equal((await one<{ id: string | null }>(db, "select id from public.complete_generation($1, 'x.png')", [g.id])).id, null);
  assert.equal(await balance(db, ALICE), 200);
  const row = await one<{ status: string; failure_reason: string }>(db, "select status, failure_reason from public.generations where id = $1", [g.id]);
  assert.deepEqual(row, { status: "failed", failure_reason: "capacity" });
});

test("completion charges; credit state can't drift from status", async () => {
  const db = await setup();
  const g = await start(db, ALICE, 4);
  const done = await one<{ status: string; credit_state: string }>(db, "select * from public.complete_generation($1, 'a/b.png')", [g.id]);
  assert.deepEqual([done.status, done.credit_state], ["done", "charged"]);
  assert.equal(await balance(db, ALICE), 196);
  const g2 = await start(db, ALICE, 4);
  await assert.rejects(db.query("update public.generations set status = 'failed', failure_reason = 'capacity' where id = $1", [g2.id]), /credits_follow_status/);
});

test("stale sweep fails and refunds only old active rows", async () => {
  const db = await setup();
  const old = await start(db, ALICE, 30);
  await start(db, ALICE, 30);
  await db.query("update public.generations set created_at = now() - interval '1 hour' where id = $1", [old.id]);
  assert.equal((await one<{ n: number }>(db, "select public.fail_stale_generations($1, interval '10 minutes') as n", [ALICE])).n, 1);
  assert.equal(await balance(db, ALICE), 170);
});

test("RLS: users read only their own rows and cannot write or call functions", async () => {
  const db = await setup();
  await start(db, ALICE, 4);
  await start(db, BOB, 4);
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${ALICE}';`);
  const rows = (await db.query<{ user_id: string }>("select user_id from public.generations")).rows;
  assert.deepEqual(rows.map((r) => r.user_id), [ALICE]);
  assert.equal((await db.query("select * from public.user_credits")).rows.length, 1);
  await assert.rejects(db.query(`insert into public.generations (user_id, intent, credits_amount) values ('${ALICE}', '{}', 0)`), /row-level security/);
  assert.equal((await db.query("update public.user_credits set balance = 99999 returning 1")).rows.length, 0);
  await assert.rejects(db.query(`select public.fail_generation(gen_random_uuid(), 'capacity')`), /permission denied/);
});
