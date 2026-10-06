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
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  grant usage on schema storage to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
  -- Like Supabase: client roles get full table privileges by default, so the migration must revoke them.
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
`;

const ALICE = "00000000-0000-0000-0000-00000000000a";
const BOB = "00000000-0000-0000-0000-00000000000b";

async function setup() {
  const db = new PGlite();
  await db.exec(STUBS);
  for (const f of migrations) await db.exec(readFileSync(new URL(f, dir), "utf8"));
  // Tests below start from a 200 balance; the real starter grant is checked in its own test.
  await db.exec(`insert into auth.users values ('${ALICE}'), ('${BOB}');
    insert into public.user_credits (user_id, balance) values ('${ALICE}', 200), ('${BOB}', 200);
`);
  return db;
}

const one = async <T>(db: PGlite, sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const balance = async (db: PGlite, user: string) =>
  (await one<{ b: number }>(db, "select public.get_balance($1) as b", [user])).b;
const start = (db: PGlite, user: string, cost: number) =>
  one<{ id: string; status: string; credit_state: string }>(db, "select * from public.start_generation($1, '[{}]'::jsonb, $2)", [user, cost]);

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

test("batch holds every output at once, all or nothing; outputs settle independently", async () => {
  const db = await setup();
  const intents = JSON.stringify([{ seed: 1 }, { seed: 2 }, { seed: 3 }]);
  const rows = (await db.query<{ id: string; batch_id: string; batch_index: number; credits_amount: number; intent: { seed: number } }>(
    "select * from public.start_generation($1, $2::jsonb, 4) order by batch_index", [ALICE, intents])).rows;
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map((r) => r.batch_id)).size, 1);
  assert.deepEqual(rows.map((r) => [r.batch_index, r.credits_amount, r.intent.seed]), [[0, 4, 1], [1, 4, 2], [2, 4, 3]]);
  assert.equal(await balance(db, ALICE), 188);

  await db.query("select * from public.fail_generation($1, 'capacity')", [rows[1].id]);
  assert.equal(await balance(db, ALICE), 192); // only that output's share comes back

  // 4 x 60 = 240 > 192: nothing held, no rows. More than 4 outputs or a non-array is refused.
  await assert.rejects(db.query("select * from public.start_generation($1, '[{},{},{},{}]'::jsonb, 60)", [ALICE]), /insufficient_credits/);
  await assert.rejects(db.query("select * from public.start_generation($1, '[{},{},{},{},{}]'::jsonb, 1)", [ALICE]), /invalid_count/);
  await assert.rejects(db.query("select * from public.start_generation($1, '{}'::jsonb, 1)", [ALICE]), /invalid_count/);
  assert.equal(await balance(db, ALICE), 192);
  assert.equal((await one<{ n: number }>(db, "select count(*)::int as n from public.generations")).n, 3);
});

test("new accounts start with 40; more than 3 active runs is refused under the balance lock", async () => {
  const db = await setup();
  const CAROL = "00000000-0000-0000-0000-00000000000c";
  await db.query("insert into auth.users values ($1)", [CAROL]);
  assert.equal(await balance(db, CAROL), 40);

  const first = await start(db, ALICE, 1);
  await db.query("select * from public.start_generation($1, '[{},{},{},{}]'::jsonb, 1)", [ALICE]); // a batch counts as one run
  await start(db, ALICE, 1);
  await assert.rejects(start(db, ALICE, 1), /too_many_active/);
  assert.equal(await balance(db, ALICE), 194); // the refused start held nothing
  await db.query("select * from public.complete_generation($1, 'a/b.png')", [first.id]);
  await start(db, ALICE, 1);
});

test("cancel only works on your own run", async () => {
  const db = await setup();
  const g = await start(db, ALICE, 30);
  const byBob = await one<{ id: string | null }>(db, "select id from public.cancel_generation($1, $2)", [g.id, BOB]);
  assert.equal(byBob.id, null);
  assert.equal(await balance(db, BOB), 200);
  assert.equal((await one<{ status: string }>(db, "select status from public.generations where id = $1", [g.id])).status, "queued");
  const byAlice = await one<{ status: string }>(db, "select * from public.cancel_generation($1, $2)", [g.id, ALICE]);
  assert.equal(byAlice.status, "failed");
  assert.equal(await balance(db, ALICE), 200);
});

test("rate limit: 15 hits per window per key, then refused", async () => {
  const db = await setup();
  const hit = async (key: string) => (await one<{ limited: boolean }>(db, "select public.rate_limit_hit($1, 15, interval '10 minutes') as limited", [key])).limited;
  for (let i = 0; i < 15; i++) assert.equal(await hit("ip:1.2.3.4"), false);
  assert.equal(await hit("ip:1.2.3.4"), true);
  assert.equal(await hit("ip:5.6.7.8"), false); // other keys unaffected
  await db.query("update public.rate_limit_hits set at = now() - interval '11 minutes'");
  assert.equal(await hit("ip:1.2.3.4"), false); // window slid
});

test("references bucket: private, and users only touch files in their own folder", async () => {
  const db = await setup();
  assert.equal((await one<{ public: boolean }>(db, "select public from storage.buckets where id = 'references'")).public, false);
  await db.exec(`insert into storage.objects (bucket_id, name) values ('references', '${BOB}/b.png')`); // as owner role
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${ALICE}';`);
  await db.query(`insert into storage.objects (bucket_id, name) values ('references', '${ALICE}/a.png')`);
  await assert.rejects(db.query(`insert into storage.objects (bucket_id, name) values ('references', '${BOB}/x.png')`), /row-level security/);
  await assert.rejects(db.query(`insert into storage.objects (bucket_id, name) values ('generations', '${ALICE}/x.png')`), /row-level security/);
  assert.deepEqual((await db.query<{ name: string }>("select name from storage.objects")).rows.map((r) => r.name), [`${ALICE}/a.png`]);
  assert.equal((await db.query(`delete from storage.objects where name = '${BOB}/b.png' returning 1`)).rows.length, 0);
  assert.equal((await db.query("update storage.objects set name = 'x' returning 1")).rows.length, 0);
  assert.equal((await db.query(`delete from storage.objects where name = '${ALICE}/a.png' returning 1`)).rows.length, 1);
});

test("RLS: users read only their own rows and cannot write or call functions", async () => {
  const db = await setup();
  await start(db, ALICE, 4);
  await start(db, BOB, 4);
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${ALICE}';`);
  const rows = (await db.query<{ user_id: string }>("select user_id from public.generations")).rows;
  assert.deepEqual(rows.map((r) => r.user_id), [ALICE]);
  assert.equal((await db.query("select * from public.user_credits")).rows.length, 1);
  await assert.rejects(db.query(`insert into public.generations (user_id, intent, credits_amount) values ('${ALICE}', '{}', 0)`), /permission denied/);
  await assert.rejects(db.query("update public.user_credits set balance = 99999"), /permission denied/);
  await assert.rejects(db.query(`select public.fail_generation(gen_random_uuid(), 'capacity')`), /permission denied/);
  await assert.rejects(db.query(`select public.cancel_generation(gen_random_uuid(), '${ALICE}')`), /permission denied/);
  await assert.rejects(db.query("delete from public.generations"), /permission denied/);
  await assert.rejects(db.query("select * from public.rate_limit_hits"), /permission denied/);
});
