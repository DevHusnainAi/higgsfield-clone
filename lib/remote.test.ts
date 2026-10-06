import assert from "node:assert/strict";
import test from "node:test";
import { isAccountConflict } from "./remote.ts";

test("isAccountConflict: every 'that account already exists' answer from an OAuth link is recognised", () => {
  assert.ok(isAccountConflict("email_exists", ""));
  assert.ok(isAccountConflict("identity_already_exists", ""));
  assert.ok(isAccountConflict("user_already_exists", ""));
  assert.ok(isAccountConflict(null, "A user with this email address has already been registered"));
  assert.ok(!isAccountConflict("access_denied", "The user denied access"));
  assert.ok(!isAccountConflict("manual_linking_disabled", "Manual linking is disabled"));
});
