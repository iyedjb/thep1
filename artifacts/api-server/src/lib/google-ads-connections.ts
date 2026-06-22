import crypto from "crypto";
import { getDb } from "./sqlite";

export type GoogleAdsConnection = {
  userId: number;
  refreshToken: string;
  customerId: string | null;
  loginCustomerId: string | null;
  accessibleCustomerIds: string[];
};

function encryptionKey() {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) throw new Error("SESSION_SECRET is required to protect Google Ads tokens");
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

function decrypt(value: string) {
  const [ivValue, tagValue, encryptedValue] = value.split(".");
  if (!ivValue || !tagValue || !encryptedValue) throw new Error("Invalid encrypted token");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export async function saveGoogleAdsConnection(
  userId: number,
  refreshToken: string,
  accessibleCustomerIds: string[],
) {
  const normalizedIds = accessibleCustomerIds.map((id) => id.replace(/-/g, ""));
  const preferredId = process.env["GOOGLE_ADS_CUSTOMER_ID"]?.replace(/-/g, "");
  const selectedId =
    normalizedIds.length === 1
      ? normalizedIds[0]
      : preferredId && normalizedIds.includes(preferredId)
        ? preferredId
        : null;

  const db = getDb();
  await db.prepare(`
    INSERT INTO google_ads_connections
      (user_id, refresh_token_encrypted, customer_id, login_customer_id, accessible_customer_ids, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (user_id) DO UPDATE SET
      refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
      customer_id = EXCLUDED.customer_id,
      login_customer_id = EXCLUDED.login_customer_id,
      accessible_customer_ids = EXCLUDED.accessible_customer_ids,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    userId,
    encrypt(refreshToken),
    selectedId,
    null,
    JSON.stringify(normalizedIds),
  );
}

export async function getGoogleAdsConnection(userId: number): Promise<GoogleAdsConnection | null> {
  const db = getDb();
  const row = await db.prepare("SELECT * FROM google_ads_connections WHERE user_id = ?").get(userId) as any;
  if (!row) return null;
  return {
    userId,
    refreshToken: decrypt(row.refresh_token_encrypted),
    customerId: row.customer_id || null,
    loginCustomerId: row.login_customer_id || row.customer_id || null,
    accessibleCustomerIds: JSON.parse(row.accessible_customer_ids || "[]"),
  };
}

export async function selectGoogleAdsCustomer(userId: number, customerId: string) {
  const connection = await getGoogleAdsConnection(userId);
  const normalizedId = customerId.replace(/-/g, "");
  if (!connection || !connection.accessibleCustomerIds.includes(normalizedId)) return false;
  const db = getDb();
  await db.prepare(`
    UPDATE google_ads_connections
    SET customer_id = ?, login_customer_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).run(normalizedId, null, userId);
  return true;
}

export async function deleteGoogleAdsConnection(userId: number) {
  const db = getDb();
  await db.prepare("DELETE FROM google_ads_connections WHERE user_id = ?").run(userId);
}
