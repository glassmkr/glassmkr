import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// The races these pin, both reported in review:
//
//   1. The version a token is bound to was read off getServerForCustomer, whose
//      projection carries neither api_key_hash nor deleted_at, so a prior key
//      rotation did not invalidate a pending confirmation.
//   2. The commit read state, spent the token, and mutated as three separate
//      statements. Anything could change in between.
//
// A fake Postgres stands in for the real one. It is not a general emulator: it
// models exactly the three properties under test. Statement ORDER within a
// transaction, so "did the lock happen before the token was spent" is
// answerable; the ON CONFLICT contract for single use; and rollback, so a
// failed mutation is proven to un-spend the token.

type Row = Record<string, unknown>;

class FakeDb {
  servers = new Map<string, Row>();
  keys: Array<{ id: string; server_id: string; revoked_at: string | null; created_at: number; last_4: string }> = [];
  spent = new Set<string>();
  /** Every statement, in order, tagged with the transaction it ran in. */
  log: Array<{ tx: number; sql: string }> = [];
  /** Fires once, immediately after the next locking read, to simulate a racer. */
  onLock: (() => void) | null = null;
  /** Fault injection: the next statement containing this fragment throws once. */
  failOn: string | null = null;
  private txSeq = 0;

  private exec(txId: number, sql: string, params: unknown[]): { rows: Row[]; rowCount: number } {
    this.log.push({ tx: txId, sql: sql.trim().split("\n")[0].trim() });
    // Postgres rejects NUL (0x00) in text/varchar values with "unterminated
    // quoted string" / "invalid byte sequence". The first enroll token target
    // joined its parts with a NUL and was INSERTed into a TEXT column, so every
    // real enroll threw while this fake stored it silently and the suite passed.
    // Model the constraint so that class of bug fails here, not only in prod.
    for (const v of params) {
      if (typeof v === "string" && v.includes("\u0000")) {
        throw new Error('invalid byte sequence: NUL (0x00) is not allowed in a Postgres text value');
      }
    }
    if (this.failOn && sql.includes(this.failOn)) {
      this.failOn = null;
      throw new Error("injected statement failure");
    }

    if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 0 };

    // The version read. FOR UPDATE marks it as the locking variant.
    if (sql.includes("active_key_id")) {
      const locking = sql.includes("FOR UPDATE");
      const byName = sql.includes("s.name = $2");
      const srv = byName
        ? [...this.servers.values()].find((r) => r.name === params[1] && r.customer_id === params[0])
        : this.servers.get(String(params[0]));
      const owned = srv && srv.customer_id === (byName ? params[0] : params[1]);
      if (locking && this.onLock) { const f = this.onLock; this.onLock = null; f(); }
      if (!owned) return { rows: [], rowCount: 0 };
      // Honour what the STATEMENT actually asks for. An earlier version of this
      // fake computed active_key_id whenever the string "active_key_id" appeared
      // anywhere in the SQL, so replacing the whole subquery with
      // `NULL AS active_key_id` still returned the real key and every test
      // stayed green. The fake was answering for the query instead of running
      // it, which is the failure mode these tests exist to catch elsewhere.
      const selectsKey = sql.includes("FROM account_api_keys k") && sql.includes("revoked_at IS NULL");
      const active = selectsKey
        ? this.keys
            .filter((k) => k.server_id === srv!.id && k.revoked_at === null)
            .sort((a, b) => b.created_at - a.created_at)[0]
        : undefined;
      return { rows: [{ status: srv!.status, name: srv!.name, active_key_id: active?.id ?? null }], rowCount: 1 };
    }

    if (sql.includes("INSERT INTO mcp_confirm_tokens")) {
      const jti = String(params[0]);
      if (this.spent.has(jti)) return { rows: [], rowCount: 0 };
      this.spent.add(jti);
      return { rows: [{ jti }], rowCount: 1 };
    }

    if (sql.includes("UPDATE servers SET status = 'deleted'")) {
      const srv = this.servers.get(String(params[0]));
      if (!srv || srv.customer_id !== params[1] || srv.status !== "active") return { rows: [], rowCount: 0 };
      srv.status = "deleted";
      return { rows: [{ id: srv.id, name: srv.name }], rowCount: 1 };
    }

    // The enroll path's quota check and insert.
    if (sql.includes("SELECT plan_server_limit FROM customers")) {
      return { rows: [{ plan_server_limit: 10 }], rowCount: 1 };
    }
    if (sql.includes("SELECT COUNT(*) FROM servers")) {
      const active = [...this.servers.values()].filter((r) => r.customer_id === params[0] && r.status === "active");
      return { rows: [{ count: String(active.length) }], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO servers")) {
      const id = String(params[0]);
      this.servers.set(id, { id, customer_id: params[1], name: params[2], status: "active" });
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("SELECT id FROM servers")) {
      const srv = this.servers.get(String(params[0]));
      const owned = srv && srv.customer_id === params[1];
      return owned ? { rows: [{ id: srv!.id }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (sql.includes("SELECT last_4 FROM account_api_keys")) {
      const active = this.keys.filter((k) => k.server_id === params[0] && k.revoked_at === null);
      return { rows: active.map((k) => ({ last_4: k.last_4 })), rowCount: active.length };
    }
    if (sql.includes("UPDATE account_api_keys SET revoked_at")) {
      for (const k of this.keys) if (k.server_id === params[0] && k.revoked_at === null) k.revoked_at = "now";
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("INSERT INTO account_api_keys")) {
      this.keys.push({
        id: `key_${this.keys.length + 1}`, server_id: String(params[5]),
        revoked_at: null, created_at: this.keys.length + 1, last_4: String(params[3]),
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("UPDATE servers SET api_key_hash = NULL")) return { rows: [], rowCount: 1 };
    if (sql.includes("DELETE FROM mcp_confirm_tokens")) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 0 };
  }

  async withTransaction<T>(fn: (tx: { query: (s: string, p?: unknown[]) => Promise<unknown> }) => Promise<T>): Promise<T> {
    const txId = ++this.txSeq;
    const before = { servers: structuredClone([...this.servers]), keys: structuredClone(this.keys), spent: new Set(this.spent) };
    try {
      return await fn({ query: async (s: string, p: unknown[] = []) => this.exec(txId, s, p) });
    } catch (err) {
      // ROLLBACK: restore everything the transaction touched, including the
      // spent-token set. A commit that did not happen must not consume the
      // operator's one authorisation.
      this.servers = new Map(before.servers as Array<[string, Row]>);
      this.keys = before.keys;
      this.spent = before.spent;
      throw err;
    }
  }

  query = async (s: string, p: unknown[] = []) => this.exec(0, s, p);
}

const db = new FakeDb();
vi.mock("@glassmkr/db/pg", () => ({
  query: (s: string, p?: unknown[]) => db.query(s, p ?? []),
  withTransaction: (fn: never) => db.withTransaction(fn),
}));
vi.mock("$lib/server/billing/sync", () => ({ syncSubscriptionQuantitySafe: vi.fn(async () => {}) }));

import { issueConfirmToken, enrollTarget } from "../confirm.js";
import { confirmedEnroll, confirmedRotateKey, confirmedSoftDelete } from "../confirmed-actions.js";
import { readServerVersion, readServerVersionByName } from "../resource-version.js";

const CUST = "cust_a";
const SRV = "srv_1";

beforeEach(() => {
  process.env.MCP_OAUTH_TOKEN_PEPPER = "test-pepper-with-at-least-thirty-two-bytes";
  // Key generation hashes with its own pepper; rotation needs it.
  process.env.GLASSMKR_KEY_PEPPER = "test-key-pepper-with-at-least-thirty-two-chars";
  db.failOn = null;
  db.servers = new Map([[SRV, { id: SRV, customer_id: CUST, name: "web-1", status: "active" }]]);
  db.keys = [{ id: "key_1", server_id: SRV, revoked_at: null, created_at: 1, last_4: "aaaa" }];
  db.spent = new Set();
  db.log = [];
  db.onLock = null;
});

/** What prepare would issue right now. */
async function prepare(action: string, target = SRV) {
  const v = await readServerVersion(CUST, target);
  return issueConfirmToken(CUST, action, target, v.version);
}

describe("the version actually covers what it claims to", () => {
  it("changes when the collector key is rotated", async () => {
    // THE REPORTED BUG. The version was computed from a projection carrying
    // neither api_key_hash nor deleted_at, so this was stable across a
    // rotation and a stale token stayed valid.
    const before = (await readServerVersion(CUST, SRV)).version;
    db.keys[0].revoked_at = "now";
    db.keys.push({ id: "key_2", server_id: SRV, revoked_at: null, created_at: 2, last_4: "bbbb" });
    const after = (await readServerVersion(CUST, SRV)).version;
    expect(after).not.toBe(before);
  });

  it("changes when the server is renamed or trashed", async () => {
    const base = (await readServerVersion(CUST, SRV)).version;
    db.servers.get(SRV)!.name = "web-2";
    expect((await readServerVersion(CUST, SRV)).version).not.toBe(base);
    db.servers.get(SRV)!.name = "web-1";
    db.servers.get(SRV)!.status = "deleted";
    expect((await readServerVersion(CUST, SRV)).version).not.toBe(base);
  });

  it("reports a version for a target that does not exist, rather than throwing", async () => {
    const v = await readServerVersion(CUST, "srv_missing");
    expect(v.exists).toBe(false);
    expect(v.version).toBe("absent");
  });
});

describe("a rotation between prepare and commit invalidates the token", () => {
  it("refuses a delete prepared before someone else rotated the key", async () => {
    const token = await prepare("delete_server");
    // Someone else rotates in the meantime.
    await confirmedRotateKey({
      customerId: CUST, serverId: SRV, token: await prepare("rotate_key"), confirmName: "web-1",
    });
    const res = await confirmedSoftDelete({
      customerId: CUST, serverId: SRV, token, confirmName: "web-1",
    });
    expect(res).toEqual({ ok: false, reason: "invalid_token" });
    expect(db.servers.get(SRV)!.status).toBe("active");
  });

  it("refuses a second rotation prepared before the first one landed", async () => {
    const a = await prepare("rotate_key");
    const b = await prepare("rotate_key");
    expect((await confirmedRotateKey({ customerId: CUST, serverId: SRV, token: a, confirmName: "web-1" })).ok).toBe(true);
    // b was signed against the pre-rotation version.
    expect(await confirmedRotateKey({ customerId: CUST, serverId: SRV, token: b, confirmName: "web-1" }))
      .toEqual({ ok: false, reason: "invalid_token" });
    expect(db.keys.filter((k) => k.revoked_at === null)).toHaveLength(1);
  });
});

describe("check and mutation are one transaction", () => {
  it("locks the row before spending the token, and mutates in the same transaction", async () => {
    await confirmedSoftDelete({
      customerId: CUST, serverId: SRV, token: await prepare("delete_server"), confirmName: "web-1",
    });
    const tx = db.log.filter((e) => e.tx > 0);
    const lock = tx.findIndex((e) => e.sql.includes("SELECT") || e.sql.includes("active_key_id"));
    const spend = tx.findIndex((e) => e.sql.includes("INSERT INTO mcp_confirm_tokens"));
    const mutate = tx.findIndex((e) => e.sql.includes("UPDATE servers SET status = 'deleted'"));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(spend).toBeGreaterThan(lock);
    expect(mutate).toBeGreaterThan(spend);
    // All three in ONE transaction, which is the property that closes the race.
    const ids = new Set(tx.map((e) => e.tx));
    expect(ids.size).toBe(1);
  });

  it("does not mutate when the target changes at the moment of the lock", async () => {
    const token = await prepare("delete_server");
    // The racer commits between prepare and the locking read.
    db.onLock = () => { db.servers.get(SRV)!.name = "renamed-under-us"; };
    const res = await confirmedSoftDelete({
      customerId: CUST, serverId: SRV, token, confirmName: "web-1",
    });
    expect(res.ok).toBe(false);
    expect(db.servers.get(SRV)!.status).toBe("active");
  });

  it("un-spends the token when the mutation fails, so the operator can retry", async () => {
    const token = await prepare("rotate_key");
    // Blow up AFTER the token has been spent, inside the same transaction.
    db.failOn = "INSERT INTO account_api_keys";

    await expect(confirmedRotateKey({
      customerId: CUST, serverId: SRV, token, confirmName: "web-1",
    })).rejects.toThrow("injected statement failure");

    // The rotation did not happen...
    expect(db.keys.filter((k) => k.revoked_at === null)).toHaveLength(1);
    // ...so the token must still work. A commit that rolled back must not
    // consume the operator's one authorisation.
    const retry = await confirmedRotateKey({ customerId: CUST, serverId: SRV, token, confirmName: "web-1" });
    expect(retry.ok).toBe(true);
  });
});

describe("single use survives the move into a transaction", () => {
  it("refuses the second commit on one token", async () => {
    const token = await prepare("delete_server");
    expect((await confirmedSoftDelete({ customerId: CUST, serverId: SRV, token, confirmName: "web-1" })).ok).toBe(true);
    // Restore the server so only the token, not eligibility, can refuse it.
    // The version is then unchanged, so the signature still verifies and the
    // refusal comes from the spend: "already_used" is the accurate message,
    // and it tells the operator to prepare again rather than suspect the token.
    db.servers.get(SRV)!.status = "active";
    expect(await confirmedSoftDelete({ customerId: CUST, serverId: SRV, token, confirmName: "web-1" }))
      .toEqual({ ok: false, reason: "already_used" });
  });

  it("checks the echoed name against the locked row", async () => {
    const token = await prepare("delete_server");
    expect(await confirmedSoftDelete({ customerId: CUST, serverId: SRV, token, confirmName: "not-the-name" }))
      .toEqual({ ok: false, reason: "name_mismatch" });
  });

  it("refuses a target owned by someone else without disclosing it exists", async () => {
    const token = await prepare("delete_server");
    expect(await confirmedSoftDelete({ customerId: "cust_b", serverId: SRV, token, confirmName: "web-1" }))
      .toEqual({ ok: false, reason: "not_found" });
  });
});

describe("a refusal after the token is spent rolls the token back", () => {
  // Reported in review: returning { ok: false } from inside withTransaction
  // COMMITS, because the callback finished normally. The confirm-token row
  // inserted a few statements earlier committed with it, so the token was
  // spent for an action that never happened. Only a throw rolled it back.
  // Every refusal after the insert now aborts the transaction.

  it("a name mismatch does not consume the token", async () => {
    const token = await prepare("delete_server");
    expect(await confirmedSoftDelete({ customerId: CUST, serverId: SRV, token, confirmName: "wrong" }))
      .toEqual({ ok: false, reason: "name_mismatch" });
    expect(db.spent.size).toBe(0);
    // The operator corrects the echo and the SAME token still works.
    expect((await confirmedSoftDelete({ customerId: CUST, serverId: SRV, token, confirmName: "web-1" })).ok).toBe(true);
  });

  it("an ineligible target does not consume the token", async () => {
    // Suspended: owned and present, so the version check passes, but the soft
    // delete matches no row.
    db.servers.get(SRV)!.status = "suspended";
    const token = await prepare("delete_server");
    expect(await confirmedSoftDelete({ customerId: CUST, serverId: SRV, token, confirmName: "web-1" }))
      .toEqual({ ok: false, reason: "not_found" });
    expect(db.spent.size).toBe(0);
  });

  it("still consumes the token when the action actually happens", async () => {
    const token = await prepare("delete_server");
    expect((await confirmedSoftDelete({ customerId: CUST, serverId: SRV, token, confirmName: "web-1" })).ok).toBe(true);
    expect(db.spent.size).toBe(1);
  });
});

describe("enrollment cannot create a duplicate name", () => {
  // Reported in review: prepare signed the version of an ALREADY EXISTING
  // named server, and the commit never required the target to be absent. That
  // version is perfectly stable, so the token verified at commit time and a
  // second server was inserted under a name the operator believed was free.
  // A version that did not change is not evidence that nothing is there.

  it("refuses at commit when a server already holds the name", async () => {
    // A token signed against the existing server's version, which is exactly
    // what the old prepare would have handed out.
    const taken = await readServerVersionByName(CUST, "web-1");
    expect(taken.exists).toBe(true);
    const token = issueConfirmToken(CUST, "enroll_server", enrollTarget("web-1"), taken.version);

    expect(await confirmedEnroll({ customerId: CUST, name: "web-1", token, confirmName: "web-1" }))
      .toEqual({ ok: false, reason: "name_taken" });
    // Nothing inserted, and the token was not consumed either.
    expect(db.servers.size).toBe(1);
    expect(db.spent.size).toBe(0);
  });

  it("allows a free name", async () => {
    const v = await readServerVersionByName(CUST, "web-2");
    expect(v.exists).toBe(false);
    expect(v.version).toBe("absent");
    const token = issueConfirmToken(CUST, "enroll_server", enrollTarget("web-2"), v.version);
    const res = await confirmedEnroll({ customerId: CUST, name: "web-2", token, confirmName: "web-2" });
    expect(res.ok).toBe(true);
  });

  it("refuses when the name is claimed between prepare and commit", async () => {
    const v = await readServerVersionByName(CUST, "web-9");
    const token = issueConfirmToken(CUST, "enroll_server", enrollTarget("web-9"), v.version);
    // A racer creates it first.
    db.servers.set("srv_9", { id: "srv_9", customer_id: CUST, name: "web-9", status: "active" });
    const res = await confirmedEnroll({ customerId: CUST, name: "web-9", token, confirmName: "web-9" });
    expect(res).toEqual({ ok: false, reason: "name_taken" });
  });
});

describe("the enroll token target is Postgres-safe", () => {
  // Regression for the NUL-byte enroll bug (2026-08-30): the target is stored
  // in mcp_confirm_tokens.target (TEXT), and Postgres rejects NUL. The first
  // enrollTarget joined its parts with a NUL, so every real enroll threw a
  // caught INTERNAL_ERROR while prepare succeeded and this suite passed. The
  // fake now rejects NUL params too, so a regression fails here.
  const nul = String.fromCharCode(0);

  it("emits no NUL byte, for any combination of parts", () => {
    for (const t of [
      enrollTarget("web-1"),
      enrollTarget("web-1", "web-1.example.com"),
      enrollTarget("web-1", "web-1.example.com", ["prod", "eu"]),
      enrollTarget("a b c", null, []),
    ]) {
      expect(t.includes(nul)).toBe(false);
    }
  });

  it("stays injective across the parts (no cross-part collision)", () => {
    const seen = new Set([
      enrollTarget("a", "b", ["c"]),
      enrollTarget("a", "b", ["c", "d"]),
      enrollTarget("a", "bc", ["d"]),
      enrollTarget("ab", "c", ["d"]),
      enrollTarget("a", null, ["b", "c"]),
    ]);
    expect(seen.size).toBe(5);
  });

  it("the fake DB rejects a NUL param, matching Postgres", async () => {
    // Guards the guard: if this ever stops throwing, the fake has drifted from
    // Postgres and the NUL class stops being caught here.
    await expect(db.query("INSERT INTO t (x) VALUES ($1)", [`a${nul}b`])).rejects.toThrow(/NUL/);
  });
});

describe("the enroll token binds the whole mutation, not the name", () => {
  // Codex 2026-08-29 #8: prepare bound only (customer, action, name, absent),
  // so an agent could get human approval on "Enroll web-1" and then spend the
  // token with a hostname and tags the approver never saw. The token now
  // signs enrollTarget(name, hostname, tags); any deviation at commit is an
  // invalid token, not a silent unpreviewed persist.

  it("refuses a hostname the token was not prepared with", async () => {
    const v = await readServerVersionByName(CUST, "web-3");
    const token = issueConfirmToken(CUST, "enroll_server", enrollTarget("web-3", "a.example.com"), v.version);
    const res = await confirmedEnroll({ customerId: CUST, name: "web-3", hostname: "b.example.com", token, confirmName: "web-3" });
    expect(res.ok).toBe(false);
    expect(db.servers.size).toBe(1);
    expect(db.spent.size).toBe(0);
  });

  it("refuses tags the token was not prepared with", async () => {
    const v = await readServerVersionByName(CUST, "web-4");
    const token = issueConfirmToken(CUST, "enroll_server", enrollTarget("web-4"), v.version);
    const res = await confirmedEnroll({ customerId: CUST, name: "web-4", tags: ["prod"], token, confirmName: "web-4" });
    expect(res.ok).toBe(false);
    expect(db.servers.size).toBe(1);
  });

  it("refuses reordered tags: the approved list is the list", async () => {
    const v = await readServerVersionByName(CUST, "web-5");
    const token = issueConfirmToken(CUST, "enroll_server", enrollTarget("web-5", null, ["a", "b"]), v.version);
    const res = await confirmedEnroll({ customerId: CUST, name: "web-5", tags: ["b", "a"], token, confirmName: "web-5" });
    expect(res.ok).toBe(false);
  });

  it("accepts the exact prepared mutation and persists it", async () => {
    const v = await readServerVersionByName(CUST, "web-6");
    const token = issueConfirmToken(CUST, "enroll_server", enrollTarget("web-6", "web-6.example.com", ["prod", "eu"]), v.version);
    const res = await confirmedEnroll({
      customerId: CUST, name: "web-6", hostname: "web-6.example.com", tags: ["prod", "eu"],
      token, confirmName: "web-6",
    });
    expect(res.ok).toBe(true);
  });
});

describe("every collector-key writer locks the server row first", () => {
  // Reported in review: the version reads a child key row while locking only
  // the parent server row, and the REST rotate route plus machine-id
  // re-enrollment mutated account_api_keys BEFORE taking the server lock.
  // Opposite lock orders deadlock, and until one blocks, MCP can version
  // against a key row another transaction is replacing.
  const read = (rel: string) =>
    fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", "..", rel), "utf8");

  it("the shared rotate core takes the parent lock before any key write", () => {
    const src = read("src/lib/server/services/server-admin-actions.ts");
    const core = src.slice(src.indexOf("export async function rotateCollectorKeyTx"));
    const lock = core.indexOf("lockServerRowTx");
    const keyWrite = core.indexOf("account_api_keys");
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(keyWrite).toBeGreaterThan(lock);
  });

  it("the REST rotate route takes it before any key write", () => {
    const src = read("src/routes/api/v1/servers/[id]/rotate-key/+server.ts");
    const tx = src.slice(src.indexOf("await withTransaction"));
    expect(tx.indexOf("lockServerRowTx")).toBeGreaterThanOrEqual(0);
    expect(tx.indexOf("account_api_keys")).toBeGreaterThan(tx.indexOf("lockServerRowTx"));
  });

  it("machine-id re-enrollment takes it before any key write", () => {
    const src = read("src/routes/api/v1/servers/+server.ts");
    const tx = src.slice(src.indexOf("Active row -> re-enroll"));
    expect(tx.indexOf("lockServerRowTx")).toBeGreaterThanOrEqual(0);
    expect(tx.indexOf("account_api_keys")).toBeGreaterThan(tx.indexOf("lockServerRowTx"));
  });

  it("machine-id re-enrollment re-reads status under the lock, before any key write", () => {
    // Codex 2026-08-29 #6: the status checks ran before the transaction and
    // were never repeated under the lock, so a delete landing in between had
    // its keys revoked and a fresh key minted against a row ingest rejects.
    const src = read("src/routes/api/v1/servers/+server.ts");
    const tx = src.slice(src.indexOf("Active row -> re-enroll"));
    const lock = tx.indexOf("lockServerRowTx");
    const statusRead = tx.indexOf("SELECT status FROM servers");
    const keyWrite = tx.indexOf("account_api_keys");
    expect(statusRead).toBeGreaterThan(lock);
    expect(keyWrite).toBeGreaterThan(statusRead);
  });

  it("the lock is FOR UPDATE on servers, the same row the version locks", () => {
    const src = read("src/lib/server/services/server-admin-actions.ts");
    expect(src).toMatch(/SELECT id FROM servers WHERE id = \$1 AND customer_id = \$2 FOR UPDATE/);
  });
});
