import crypto from "crypto";

/**
 * Field-level encryption for sensitive PII (currently: cedula).
 * Uses AES-256-GCM with a key from PROFILE_ENCRYPTION_KEY (base64, 32 bytes).
 *
 * If the key isn't configured yet, fields are stored/read as plain text so
 * the app keeps working during rollout - but this should be set in
 * production. Values encrypted before the key existed (or written while it
 * was missing) are still readable: decryptField only decrypts values that
 * carry the "v1:" envelope, and passes anything else through unchanged.
 */

const KEY = process.env.PROFILE_ENCRYPTION_KEY ? Buffer.from(process.env.PROFILE_ENCRYPTION_KEY, "base64") : null;

export function encryptField(value: string): string {
  if (!KEY) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptField(stored: string): string {
  if (!KEY) return stored;
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") return stored;
  try {
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const data = Buffer.from(parts[3], "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return stored;
  }
}
