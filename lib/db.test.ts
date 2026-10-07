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
  create table auth.users (id uuid primary key, is_anonymous boolean not null default false);
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
  grant usage on schema public to anon, authenticated, service_role;
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
  assert.equal((await one<{ demo_fallback: boolean }>(db, "select demo_fallback from public.generations where id = $1", [g.id])).demo_fallback, false);
  const fb = await start(db, ALICE, 4);
  assert.equal(await balance(db, ALICE), 192);
  const fbDone = await one<{ demo_fallback: boolean; credit_state: string; result_path: string }>(db, "select * from public.complete_generation($1, 'https://picsum.photos/x', true)", [fb.id]);
  assert.deepEqual([fbDone.demo_fallback, fbDone.credit_state, fbDone.result_path], [true, "refunded", "https://picsum.photos/x"]);
  assert.equal(await balance(db, ALICE), 196); // fallback is free
  assert.equal((await one<{ id: string | null }>(db, "select id from public.complete_generation($1, 'y', true)", [fb.id])).id, null);
  assert.equal(await balance(db, ALICE), 196); // and refunded only once
  await assert.rejects(db.query("update public.generations set credit_state = 'charged', refunded_at = null where id = $1", [fb.id]), /credits_follow_status/);
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

test("new accounts start with the anonymous taster grant; more than 3 active runs is refused under the balance lock", async () => {
  const db = await setup();
  const CAROL = "00000000-0000-0000-0000-00000000000c";
  await db.query("insert into auth.users values ($1)", [CAROL]);
  assert.equal(await balance(db, CAROL), 8);

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

test("references quota: the 11th file in a folder is rejected; other folders and buckets are unaffected", async () => {
  const db = await setup();
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${ALICE}';`);
  const put = (user: string, n: number, bucket = "references") =>
    db.query(`insert into storage.objects (bucket_id, name) values ($1, $2)`, [bucket, `${user}/${n}.png`]);
  for (let i = 0; i < 10; i++) await put(ALICE, i);
  await assert.rejects(put(ALICE, 10), /reference_quota_exceeded/);
  await db.query(`delete from storage.objects where name = '${ALICE}/0.png'`);
  await put(ALICE, 10); // deleting frees a slot
  await db.exec(`set request.jwt.claim.sub = '${BOB}';`);
  await put(BOB, 0);
  await db.exec("reset role");
  await put(ALICE, 99, "generations");
});

test("fallback_refund migration refunds fallbacks charged before it, once", async () => {
  const db = new PGlite();
  await db.exec(STUBS);
  const later = migrations.filter((f) => f >= "20261006180000");
  for (const f of migrations.filter((f) => !later.includes(f))) await db.exec(readFileSync(new URL(f, dir), "utf8"));
  await db.exec(`insert into auth.users values ('${ALICE}'); insert into public.user_credits (user_id, balance) values ('${ALICE}', 100);`);
  // Legacy rows: a fallback charged by the old complete_generation, and an ordinary charged render.
  const legacy = await start(db, ALICE, 8);
  await db.query("select * from public.complete_generation($1, 'https://picsum.photos/x', true)", [legacy.id]);
  const real = await start(db, ALICE, 4);
  await db.query("select * from public.complete_generation($1, 'a/b.png')", [real.id]);
  assert.equal(await balance(db, ALICE), 88);

  for (const f of later) await db.exec(readFileSync(new URL(f, dir), "utf8"));
  assert.equal(await balance(db, ALICE), 96); // the fallback's 8 came back; the real render stays charged
  const rows = (await db.query<{ id: string; credit_state: string }>("select id, credit_state from public.generations")).rows;
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.id, r.credit_state])), { [legacy.id]: "refunded", [real.id]: "charged" });
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

const settle = async (db: PGlite, user: string, permanent: boolean) =>
  (await one<{ b: number }>(db, "select public.settle_account($1, $2) as b", [user, permanent])).b;

test("accounts: anonymous gets 8; a permanent account gets 40 exactly once, including on upgrade", async () => {
  const db = await setup();
  const ANON = "00000000-0000-0000-0000-0000000000a1";
  const DIRECT = "00000000-0000-0000-0000-0000000000a2";
  await db.query("insert into auth.users values ($1, true), ($2, false)", [ANON, DIRECT]);

  assert.equal(await settle(db, ANON, false), 8);
  await start(db, ANON, 3); // spends part of the taster
  assert.equal(await settle(db, ANON, false), 5);
  // Upgrade keeps the user id: leftover taster + the one-time grant.
  assert.equal(await settle(db, ANON, true), 45);
  assert.equal(await settle(db, ANON, true), 45, "grant is paid once");
  // Signing up directly: exactly 40, never 8 + 40.
  assert.equal(await settle(db, DIRECT, true), 40);
  assert.equal(await settle(db, DIRECT, true), 40);
});

test("merge: moves only settled history from an anonymous user to a permanent one, never credits", async () => {
  const db = await setup();
  const ANON = "00000000-0000-0000-0000-0000000000b1";
  const ANON2 = "00000000-0000-0000-0000-0000000000b2";
  await db.query("insert into auth.users values ($1, true), ($2, true)", [ANON, ANON2]);
  await db.query("update auth.users set is_anonymous = false where id = $1", [ALICE]);
  await settle(db, ANON, false);
  const done = await start(db, ANON, 2);
  await db.query("select * from public.complete_generation($1, 'x/y.png')", [done.id]);
  const failed = await start(db, ANON, 2);
  await db.query("select * from public.fail_generation($1, 'provider_error')", [failed.id]);
  const running = await start(db, ANON, 2);
  const anonBefore = await balance(db, ANON); // 8 - 2 charged - 2 held = 4
  const aliceBefore = await balance(db, ALICE);

  const moved = await one<{ n: number }>(db, "select public.merge_anonymous_history($1, $2) as n", [ANON, ALICE]);
  assert.equal(moved.n, 2);
  const owners = (await db.query<{ id: string; user_id: string }>("select id, user_id from public.generations")).rows;
  const owner = (id: string) => owners.find((r) => r.id === id)!.user_id;
  assert.equal(owner(done.id), ALICE);
  assert.equal(owner(failed.id), ALICE);
  assert.equal(owner(running.id), ANON, "a run still holding credits stays put");
  assert.equal(await balance(db, ALICE), aliceBefore, "no credits move");
  assert.equal(await balance(db, ANON), anonBefore);

  // The held run's refund goes back to the anonymous user, not the account it merged into.
  await db.query("select * from public.fail_generation($1, 'cancelled')", [running.id]);
  assert.equal(await balance(db, ALICE), aliceBefore);

  // Once settled (refund already paid to the anonymous user), a later merge brings that run across too; then nothing is left.
  assert.equal((await one<{ n: number }>(db, "select public.merge_anonymous_history($1, $2) as n", [ANON, ALICE])).n, 1);
  assert.equal((await one<{ n: number }>(db, "select public.merge_anonymous_history($1, $2) as n", [ANON, ALICE])).n, 0);
  assert.equal(await balance(db, ALICE), aliceBefore, "still no credits moved");
  await assert.rejects(db.query("select public.merge_anonymous_history($1, $2)", [BOB, ALICE]), /source_not_anonymous/);
  await assert.rejects(db.query("select public.merge_anonymous_history($1, $2)", [ANON, ANON2]), /target_not_permanent/);
});

test("merge runs as service_role, which (like hosted Supabase) cannot read auth.users", async () => {
  const db = await setup();
  const ANON = "00000000-0000-0000-0000-0000000000b1";
  await db.query("insert into auth.users values ($1, true)", [ANON]);
  await db.exec("set role service_role");
  assert.equal((await one<{ n: number }>(db, "select public.merge_anonymous_history($1, $2) as n", [ANON, ALICE])).n, 0);
});

test("accounts: browser roles cannot settle grants or merge", async () => {
  const db = await setup();
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${ALICE}', false);`);
  await assert.rejects(db.query("select public.settle_account($1, true)", [ALICE]), /permission denied/);
  await assert.rejects(db.query("select public.merge_anonymous_history($1, $2)", [BOB, ALICE]), /permission denied/);
});

test("settings: provider keys are invisible to browser roles, even the owner's", async () => {
  const db = await setup();
  await db.query("insert into public.provider_keys (user_id, provider, secret, hint) values ($1, 'hf', 'v1:x:y:z', 'abcd')", [ALICE]);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${ALICE}', false);`);
  await assert.rejects(db.query("select * from public.provider_keys"), /permission denied/);
  await assert.rejects(db.query("insert into public.provider_keys (user_id, provider, secret, hint) values ($1, 'fal', 's', 'abcd')", [ALICE]), /permission denied/);
  await assert.rejects(db.query("select * from public.account_stats($1)", [ALICE]), /permission denied/);
  await db.exec("reset role");
  await assert.rejects(db.query("insert into public.provider_keys (user_id, provider, secret, hint) values ($1, 'openai', 's', 'abcd')", [BOB]), /check/);
});

test("settings: account_stats counts every run and settles credits by state", async () => {
  const db = await setup();
  const done = await start(db, ALICE, 4);
  await db.query("select * from public.complete_generation($1, 'a/b.png')", [done.id]);
  const failed = await start(db, ALICE, 6);
  await db.query("select * from public.fail_generation($1, 'capacity')", [failed.id]);
  await start(db, ALICE, 2); // still held: counted as a run, not as used or refunded
  await start(db, BOB, 9);
  const s = await one(db, "select * from public.account_stats($1)", [ALICE]);
  assert.deepEqual(s, { runs: 3, done: 1, failed: 1, credits_used: 4, credits_refunded: 6 });
});
