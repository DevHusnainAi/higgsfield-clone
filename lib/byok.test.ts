import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { keyFormatError } from "./provider-keys.ts";
import { open, seal, vaultKey } from "./server/key-vault.ts";
import { pickToken } from "./server/run-generation.ts";

const KEY = randomBytes(32);
const HF = "hf_" + "a1B2c3D4e5".repeat(3) + "xyzw";
const FAL = "0f8e1d2c-3b4a-4596-8a7b-6c5d4e3f2a1b:" + "9".repeat(32);
const ALICE = "00000000-0000-0000-0000-00000000000a";
const BOB = "00000000-0000-0000-0000-00000000000b";

test("vault: round-trips, with a fresh IV every time", () => {
  const a = seal(HF, ALICE, "hf", KEY);
  assert.notEqual(a, seal(HF, ALICE, "hf", KEY));
  assert.ok(!a.includes(HF));
  assert.equal(open(a, ALICE, "hf", KEY), HF);
});

test("vault: a ciphertext only opens for its own user, provider and key, and untampered", () => {
  const sealed = seal(HF, ALICE, "hf", KEY);
  assert.throws(() => open(sealed, BOB, "hf", KEY), "copied onto another account");
  assert.throws(() => open(sealed, ALICE, "fal", KEY), "moved to another provider");
  assert.throws(() => open(sealed, ALICE, "hf", randomBytes(32)), "different encryption key");
  const [v, iv, tag, body] = sealed.split(":");
  const flipped = Buffer.from(body, "base64");
  flipped[0] ^= 1;
  assert.throws(() => open([v, iv, tag, flipped.toString("base64")].join(":"), ALICE, "hf", KEY), "tampered");
});

test("vault: the encryption key must be exactly 32 bytes", () => {
  assert.equal(vaultKey(undefined), null);
  assert.equal(vaultKey(randomBytes(16).toString("base64")), null);
  assert.equal(vaultKey(KEY.toString("base64"))?.length, 32);
});

test("key formats: real shapes pass, near misses get a specific reason", () => {
  assert.equal(keyFormatError("hf", HF), null);
  assert.equal(keyFormatError("hf", `  ${HF}\n`), null, "copy-paste whitespace is trimmed");
  assert.equal(keyFormatError("fal", FAL), null);
  assert.match(keyFormatError("hf", "")!, /Paste/);
  assert.match(keyFormatError("hf", FAL)!, /start with hf_/);
  assert.match(keyFormatError("fal", HF)!, /key-id:key-secret/);
  assert.match(keyFormatError("hf", "hf_short")!, /doesn't look like/);
  assert.match(keyFormatError("fal", "not-a-uuid:" + "9".repeat(32))!, /doesn't look like/);
});

test("token choice: own keys first, then shared; only shared tokens may fall back to stock assets", () => {
  const env = { FAL_KEY: "shared-fal", HF_TOKEN: "shared-hf" };
  assert.deepEqual(pickToken("fal-ai", { fal: "my-fal", hf: "my-hf" }, env), { token: "my-fal", shared: false });
  assert.deepEqual(pickToken("fal-ai", { hf: "my-hf" }, env), { token: "my-hf", shared: false });
  assert.deepEqual(pickToken("hf-inference", { fal: "my-fal" }, env), { token: "shared-hf", shared: true }, "a fal key can't run hf-inference models");
  assert.deepEqual(pickToken("fal-ai", {}, env), { token: "shared-fal", shared: true });
  assert.deepEqual(pickToken("fal-ai", {}, { HF_TOKEN: "shared-hf" }), { token: "shared-hf", shared: true });
  assert.equal(pickToken("hf-inference", {}, {}), null);
});
