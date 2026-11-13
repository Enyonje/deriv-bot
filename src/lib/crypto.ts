import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { ConfigError } from "./config";

function key(): Buffer {
    const secret = process.env.SESSION_SECRET;
    if (!secret || secret.length < 32) {
        throw new ConfigError("SESSION_SECRET must be set to a random string of at least 32 characters");
    }
    return createHash("sha256").update(secret).digest();
}

/** AES-256-GCM: confidentiality + tamper detection. Output is base64url(iv | tag | ciphertext). */
export function seal(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key(), iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

export function unseal<T>(token: string): T | null {
    try {
        const buf = Buffer.from(token, "base64url");
        const decipher = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
        decipher.setAuthTag(buf.subarray(12, 28));
        const plain = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
        return JSON.parse(plain.toString("utf8")) as T;
    } catch (err) {
        if (err instanceof ConfigError) throw err;
        return null; // tampered, truncated or encrypted with an old secret
    }
}