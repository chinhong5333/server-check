import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes
} from "node:crypto";

const ENCRYPTION_VERSION = "v1";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const PLATFORM_SCOPE = "platform-telegram";

function deriveEncryptionKey(applicationSecret: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(applicationSecret, "utf8"),
      Buffer.from("server-check-platform-secrets", "utf8"),
      Buffer.from("telegram-bot-token-v1", "utf8"),
      32
    )
  );
}

export function encryptPlatformTelegramBotToken(
  applicationSecret: string,
  botToken: string
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", deriveEncryptionKey(applicationSecret), iv, {
    authTagLength: AUTH_TAG_BYTES
  });
  cipher.setAAD(Buffer.from(PLATFORM_SCOPE, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(botToken, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    ENCRYPTION_VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url")
  ].join(".");
}

export function decryptPlatformTelegramBotToken(
  applicationSecret: string,
  encryptedToken: string
): string {
  const [version, ivValue, authTagValue, ciphertextValue, ...unexpected] =
    encryptedToken.split(".");
  if (
    version !== ENCRYPTION_VERSION ||
    !ivValue ||
    !authTagValue ||
    !ciphertextValue ||
    unexpected.length > 0
  ) {
    throw new Error("Unsupported encrypted platform secret format.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveEncryptionKey(applicationSecret),
    Buffer.from(ivValue, "base64url"),
    { authTagLength: AUTH_TAG_BYTES }
  );
  decipher.setAAD(Buffer.from(PLATFORM_SCOPE, "utf8"));
  decipher.setAuthTag(Buffer.from(authTagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final()
  ]).toString("utf8");
}
