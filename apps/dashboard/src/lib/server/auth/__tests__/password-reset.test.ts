// Covers the password-reset token functions in @glassmkr/auth. The DB layer
// (@glassmkr/db/pg query) is mocked, so these assert the security-relevant
// behavior without a live database: no account-existence signal, the raw token
// is never persisted (only its hash), and tokens are single-use + expiring.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@glassmkr/db/pg", () => ({ query: vi.fn() }));

import { query } from "@glassmkr/db/pg";
import {
  createPasswordResetToken,
  resetPasswordByToken,
  hashOpaqueToken,
  verifyPassword,
} from "@glassmkr/auth";

const q = query as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  q.mockReset();
});

describe("createPasswordResetToken", () => {
  it("returns null when no account has the email (and does no UPDATE)", async () => {
    q.mockResolvedValueOnce({ rows: [] }); // SELECT customer -> none
    const result = await createPasswordResetToken("nobody@example.com");
    expect(result).toBeNull();
    expect(q).toHaveBeenCalledTimes(1); // never writes when the account does not exist
  });

  it("lowercases the email, mints a token, and stores only its hash", async () => {
    q.mockResolvedValueOnce({ rows: [{ id: "cust_1", email: "a@b.com", display_name: "Ann" }] });
    q.mockResolvedValueOnce({ rows: [] }); // UPDATE
    const result = await createPasswordResetToken("A@B.com");
    expect(result).not.toBeNull();
    expect(result!.token).toMatch(/^[A-Za-z0-9_-]{20,}$/); // base64url opaque token
    expect(result!.customer).toEqual({ email: "a@b.com", displayName: "Ann" });
    expect(result!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(q.mock.calls[0][1]).toEqual(["a@b.com"]); // SELECT used the lowercased email
    const updateParams = q.mock.calls[1][1] as unknown[];
    expect(updateParams[0]).toBe(hashOpaqueToken(result!.token)); // stored the hash
    expect(updateParams[0]).not.toBe(result!.token); // NOT the raw token
  });
});

describe("resetPasswordByToken", () => {
  it("returns invalid for an unknown token", async () => {
    q.mockResolvedValueOnce({ rows: [] });
    const r = await resetPasswordByToken("does-not-exist", "longenough123");
    expect(r.status).toBe("invalid");
  });

  it("returns expired and clears the token once past its expiry", async () => {
    q.mockResolvedValueOnce({
      rows: [{ id: "cust_1", password_reset_expires_at: new Date(Date.now() - 1000) }],
    });
    q.mockResolvedValueOnce({ rows: [] }); // clear UPDATE
    const r = await resetPasswordByToken("expired-token", "longenough123");
    expect(r.status).toBe("expired");
    expect(q.mock.calls[1][0] as string).toMatch(/password_reset_token_hash = NULL/);
  });

  it("sets a new bcrypt hash, clears the token, and returns the customer on success", async () => {
    q.mockResolvedValueOnce({
      rows: [{ id: "cust_1", password_reset_expires_at: new Date(Date.now() + 60_000) }],
    });
    q.mockResolvedValueOnce({
      rows: [
        { id: "cust_1", email: "a@b.com", display_name: "Ann", email_verified: true, status: "active", plan: "free" },
      ],
    });
    const r = await resetPasswordByToken("good-token", "newpassword123");
    expect(r.status).toBe("success");
    if (r.status === "success") expect(r.customer.email).toBe("a@b.com");
    const updateParams = q.mock.calls[1][1] as unknown[];
    const storedHash = updateParams[0] as string;
    expect(storedHash).not.toBe("newpassword123"); // never stored plaintext
    expect(await verifyPassword("newpassword123", storedHash)).toBe(true); // real bcrypt round-trip
    const updateSql = q.mock.calls[1][0] as string;
    expect(updateSql).toMatch(/password_reset_token_hash = NULL/); // single-use: token cleared
    expect(updateSql).toMatch(/email_verified = true/); // reset proves email control
    expect(updateSql).toMatch(/session_epoch = NOW\(\)/); // revoke pre-reset sessions (#11)
  });
});
