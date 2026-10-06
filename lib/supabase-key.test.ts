import assert from "node:assert/strict";
import test from "node:test";
import { keyRole } from "./server/supabase.ts";

const jwt = (role: string) => `x.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.sig`;

test("keyRole: only a secret / service_role key passes as the server key", () => {
  assert.equal(keyRole("sb_secret_abc"), "service_role");
  assert.equal(keyRole("sb_publishable_abc"), "anon");
  assert.equal(keyRole(jwt("service_role")), "service_role");
  assert.equal(keyRole(jwt("anon")), "anon");
  assert.equal(keyRole("garbage"), null);
});
