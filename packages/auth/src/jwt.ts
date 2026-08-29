import bcrypt from "bcrypt";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { query } from "@glassmkr/db/pg";
import type { CustomerPayload } from "@glassmkr/db/types";

const SALT_ROUNDS = 12;
const TOKEN_EXPIRY = "7d";
const EMAIL_VERIFICATION_EXPIRY_MS = 24 * 60 * 60 * 1000;

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("Missing JWT_SECRET");
  return secret;
}

function mapCustomer(row: any): CustomerPayload {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    emailVerified: Boolean(row.email_verified),
    status: row.status || "active",
    plan: row.plan || "free",
    isDemo: Boolean(row.is_demo),
    // Only some SELECTs load this column (getCustomerById does); leave it null
    // when absent so callers that never read it are unaffected.
    sessionEpoch: row.session_epoch ?? null,
  };
}

function generateEmailVerificationToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function hashOpaqueToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(customer: CustomerPayload): string {
  return jwt.sign(
    { id: customer.id, email: customer.email, plan: customer.plan },
    getJwtSecret(),
    { expiresIn: TOKEN_EXPIRY }
  );
}

// The session JWT carries only { id, email, plan } (see generateToken). It does
// NOT carry status / displayName / emailVerified, so we return only the real
// claims here. Callers that need the live customer (e.g. status for the
// suspension check) must load it from the DB via getCustomerById; a hardcoded
// "active" in this payload would be a footgun. (Codex review 2026-06-06, B.)
// `iat` is the JWT issued-at (whole seconds since epoch), stamped by
// jsonwebtoken at sign time. It is returned so the auth handle can enforce
// session invalidation on password reset (compare against customers.session_epoch).
export function verifyToken(
  token: string,
): (Pick<CustomerPayload, "id" | "email" | "plan"> & { iat?: number }) | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as {
      id: string;
      email: string;
      plan?: string;
      iat?: number;
    };
    return {
      id: decoded.id,
      email: decoded.email,
      plan: decoded.plan || "free",
      iat: decoded.iat,
    };
  } catch {
    return null;
  }
}

export async function createCustomer(
  email: string,
  password: string,
  displayName?: string
): Promise<{ customer: CustomerPayload; verificationToken: string; expiresAt: Date }> {
  const hash = await hashPassword(password);
  const verificationToken = generateEmailVerificationToken();
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_MS);
  const result = await query(
    `INSERT INTO customers (
      email, password_hash, display_name, email_verified,
      email_verification_token_hash, email_verification_expires_at
    ) VALUES ($1, $2, $3, false, $4, $5)
    RETURNING id, email, display_name, email_verified, status`,
    [email.toLowerCase(), hash, displayName || null, hashOpaqueToken(verificationToken), expiresAt.toISOString()]
  );
  return { customer: mapCustomer(result.rows[0]), verificationToken, expiresAt };
}

export async function authenticateCustomer(email: string, password: string): Promise<CustomerPayload | null> {
  const result = await query(
    `SELECT id, email, display_name, password_hash, email_verified, status, plan
     FROM customers WHERE email = $1`,
    [email.toLowerCase()]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) return null;
  return mapCustomer(row);
}

export async function getCustomerById(id: string): Promise<CustomerPayload | null> {
  const result = await query(
    `SELECT id, email, display_name, email_verified, status, plan, is_demo, session_epoch
     FROM customers WHERE id = $1`,
    [id]
  );
  if (result.rows.length === 0) return null;
  return mapCustomer(result.rows[0]);
}

export async function verifyCustomerEmailByToken(token: string): Promise<{
  status: "verified" | "invalid" | "expired";
  customer?: CustomerPayload;
}> {
  const result = await query(
    `SELECT id, email, display_name, email_verified, status, plan, email_verification_expires_at
     FROM customers WHERE email_verification_token_hash = $1`,
    [hashOpaqueToken(token)]
  );
  if (result.rows.length === 0) return { status: "invalid" };
  const customer = result.rows[0];
  if (customer.email_verified) return { status: "invalid" };
  if (!customer.email_verification_expires_at || customer.email_verification_expires_at.getTime() <= Date.now()) {
    await query(
      `UPDATE customers SET email_verification_token_hash = NULL, email_verification_expires_at = NULL WHERE id = $1`,
      [customer.id]
    );
    return { status: "expired" };
  }
  const updateResult = await query(
    `UPDATE customers SET email_verified = true, email_verification_token_hash = NULL, email_verification_expires_at = NULL
     WHERE id = $1 RETURNING id, email, display_name, email_verified, status`,
    [customer.id]
  );
  return { status: "verified", customer: mapCustomer(updateResult.rows[0]) };
}

const PASSWORD_RESET_EXPIRY_MS = 30 * 60 * 1000;

// Mint a single-use password-reset token for the account with this email.
// Mirrors the email-verification token shape: a random opaque token whose
// SHA-256 hash + expiry are stored on the customer row (the raw token is never
// persisted). Returns null when no account has this email, so the caller can
// respond identically whether or not the account exists (no existence leak).
export async function createPasswordResetToken(email: string): Promise<{
  token: string;
  expiresAt: Date;
  customer: { email: string; displayName: string | null };
} | null> {
  const result = await query(
    `SELECT id, email, display_name FROM customers WHERE email = $1`,
    [email.toLowerCase()],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRY_MS);
  await query(
    `UPDATE customers SET password_reset_token_hash = $1, password_reset_expires_at = $2 WHERE id = $3`,
    [hashOpaqueToken(token), expiresAt.toISOString(), row.id],
  );
  return { token, expiresAt, customer: { email: row.email, displayName: row.display_name } };
}

// Consume a password-reset token and set a new password. Single-use: the token
// columns are cleared on success AND on expiry. email_verified is set true
// because controlling the reset email proves ownership of the address.
// session_epoch is bumped to NOW() so any session JWT minted before the reset
// stops being honored (the auth handle rejects tokens whose iat predates it);
// this revokes a stolen guardian_token instead of letting it live out the
// stateless 7-day JWT lifetime.
export async function resetPasswordByToken(
  token: string,
  newPassword: string,
): Promise<{ status: "success"; customer: CustomerPayload } | { status: "invalid" | "expired" }> {
  const result = await query(
    `SELECT id, password_reset_expires_at
     FROM customers WHERE password_reset_token_hash = $1`,
    [hashOpaqueToken(token)],
  );
  if (result.rows.length === 0) return { status: "invalid" };
  const row = result.rows[0];
  const expiresAt: Date | null = row.password_reset_expires_at;
  if (!expiresAt || expiresAt.getTime() <= Date.now()) {
    await query(
      `UPDATE customers SET password_reset_token_hash = NULL, password_reset_expires_at = NULL WHERE id = $1`,
      [row.id],
    );
    return { status: "expired" };
  }
  const hash = await hashPassword(newPassword);
  const updateResult = await query(
    `UPDATE customers
     SET password_hash = $1, email_verified = true,
         password_reset_token_hash = NULL, password_reset_expires_at = NULL,
         session_epoch = NOW()
     WHERE id = $2
     RETURNING id, email, display_name, email_verified, status, plan`,
    [hash, row.id],
  );
  return { status: "success", customer: mapCustomer(updateResult.rows[0]) };
}

export { mapCustomer, hashOpaqueToken };
