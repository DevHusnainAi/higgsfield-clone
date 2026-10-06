import assert from "node:assert/strict";
import test from "node:test";
import { accountSwitched } from "./store.ts";

test("accountSwitched: cached history is kept only for the account that owns it", () => {
  assert.equal(accountSwitched(null, "a", null), false, "first visit: nothing cached yet");
  assert.equal(accountSwitched("a", "a", null), false, "same account (including a guest upgraded in place)");
  assert.equal(accountSwitched("a", "b", "a"), true, "signed in to another account");
  assert.equal(accountSwitched("a", "b", null), true, "page opened as another account than the cache");
  assert.equal(accountSwitched(null, null, "a"), true, "signed out");
  assert.equal(accountSwitched(null, null, null), false, "no session yet");
});
