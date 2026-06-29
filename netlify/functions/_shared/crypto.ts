/**
 * Chiffrement symétrique des secrets (tokens Garmin, sessions MFA) au repos
 * dans Supabase. AES-256-GCM via node:crypto.
 *
 * TOKEN_ENCRYPTION_KEY = 32 octets encodés en base64 (env Netlify, jamais côté client).
 * Génère-en une avec :  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const b64 = process.env.TOKEN_ENCRYPTION_KEY;
  if (!b64) throw new Error("TOKEN_ENCRYPTION_KEY manquant (env Netlify)");
  const k = Buffer.from(b64, "base64");
  if (k.length !== 32)
    throw new Error("TOKEN_ENCRYPTION_KEY doit faire 32 octets (base64)");
  return k;
}

/** Renvoie "ivB64.tagB64.cipherB64". */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64")).join(".");
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
