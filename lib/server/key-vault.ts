// Server-only: encrypts users' provider keys at rest (AES-256-GCM, node:crypto) and reads them back for renders.
// The encryption key lives only in BYOK_ENCRYPTION_KEY (no NEXT_PUBLIC_ prefix, so never in the browser bundle);
// the database holds ciphertext it can't decrypt, in a table the browser roles can't read at all.
// Each ciphertext is bound to its user and provider (GCM additional data), so a row copied onto another
// account or provider fails to decrypt instead of lending someone else's key.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { KeyStatus, Provider } from "../provider-keys.ts";
import { admin } from "./supabase.ts";

const VERSION = "v1";

/** The 32-byte key from BYOK_ENCRYPTION_KEY (base64), or null if unset or the wrong length. */
export function vaultKey(env = process.env.BYOK_ENCRYPTION_KEY): Buffer | null {
  if (!env) return null;
  const key = Buffer.from(env, "base64");
  if (key.length === 32) return key;
  console.error("[byok] BYOK_ENCRYPTION_KEY must be 32 bytes, base64 (openssl rand -base64 32). Custom keys disabled.");
  return null;
}

const KEY = vaultKey();
export const vaultEnabled = KEY !== null;

const aad = (userId: string, provider: Provider) => Buffer.from(`${userId}:${provider}`);

export function seal(plain: string, userId: string, provider: Provider, key = KEY!): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv).setAAD(aad(userId, provider));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), body].map((p) => (typeof p === "string" ? p : p.toString("base64"))).join(":");
}

/** Throws if the ciphertext was tampered with, moved to another user/provider, or sealed with another key. */
export function open(sealed: string, userId: string, provider: Provider, key = KEY!): string {
  const [version, iv, tag, body] = sealed.split(":");
  if (version !== VERSION) throw new Error(`unknown key format ${version}`);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64")).setAAD(aad(userId, provider));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}

export async function keyStatuses(userId: string): Promise<Record<Provider, KeyStatus | null>> {
  const { data, error } = await admin!.from("provider_keys").select("provider, hint, updated_at").eq("user_id", userId);
  if (error) throw new Error(`loading provider keys failed: ${error.message}`);
  const out: Record<Provider, KeyStatus | null> = { hf: null, fal: null };
  for (const r of data as { provider: Provider; hint: string; updated_at: string }[]) out[r.provider] = { hint: r.hint, updatedAt: r.updated_at };
  return out;
}

/** The user's decrypted keys, for a render. Only ever called server-side, never returned by an API route. */
export async function userKeys(userId: string): Promise<Partial<Record<Provider, string>>> {
  if (!KEY || !admin) return {};
  const { data, error } = await admin.from("provider_keys").select("provider, secret").eq("user_id", userId);
  if (error) throw new Error(`loading provider keys failed: ${error.message}`);
  return Object.fromEntries((data as { provider: Provider; secret: string }[]).map((r) => [r.provider, open(r.secret, userId, r.provider)]));
}
