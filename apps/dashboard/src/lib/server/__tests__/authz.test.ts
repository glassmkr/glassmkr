import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @glassmkr/db/pg.query so we can observe the SQL and params the
// ownership helpers emit. This locks in (a) that the customer_id filter
// is on the WHERE clause, not applied in application code, and (b) that
// missing rows throw SvelteKit's 404.
vi.mock("@glassmkr/db/pg", () => ({
  query: vi.fn(),
}));

import { query } from "@glassmkr/db/pg";
import {
  requireServerOwnership,
  requireChannelOwnership,
  requireAlertOwnership,
  requireTrendWarningOwnership,
} from "../authz";

beforeEach(() => {
  (query as any).mockReset();
});

// A helper that asserts a thrown SvelteKit error has status 404. The
// @sveltejs/kit error() function returns an HttpError-shaped object.
function expect404(err: unknown) {
  expect((err as any)?.status).toBe(404);
}

describe("requireServerOwnership", () => {
  it("emits WHERE id = $1 AND customer_id = $2 and returns the row", async () => {
    (query as any).mockResolvedValue({ rows: [{ id: "srv_1", name: "web-01" }] });
    const row = await requireServerOwnership("srv_1", "cust_A", "id, name");
    expect(row).toEqual({ id: "srv_1", name: "web-01" });
    expect((query as any).mock.calls[0][0]).toMatch(/WHERE id = \$1 AND customer_id = \$2/);
    expect((query as any).mock.calls[0][1]).toEqual(["srv_1", "cust_A"]);
  });

  it("throws 404 when the server is not owned by this customer", async () => {
    (query as any).mockResolvedValue({ rows: [] });
    try {
      await requireServerOwnership("srv_A", "cust_B");
      throw new Error("should have thrown");
    } catch (e) { expect404(e); }
  });

  it("throws 404 when serverId is falsy (no DB call)", async () => {
    try {
      await requireServerOwnership("", "cust_X");
      throw new Error("should have thrown");
    } catch (e) { expect404(e); }
    expect(query).not.toHaveBeenCalled();
  });

  it("throws 404 when customerId is falsy (no DB call)", async () => {
    try {
      await requireServerOwnership("srv_1", "");
      throw new Error("should have thrown");
    } catch (e) { expect404(e); }
    expect(query).not.toHaveBeenCalled();
  });
});

describe("requireChannelOwnership", () => {
  it("filters by customer_id on alert_channels", async () => {
    (query as any).mockResolvedValue({ rows: [{ id: 42 }] });
    await requireChannelOwnership(42, "cust_A");
    expect((query as any).mock.calls[0][0]).toMatch(/FROM alert_channels WHERE id = \$1 AND customer_id = \$2/);
  });
  it("throws 404 when channel is another customer's", async () => {
    (query as any).mockResolvedValue({ rows: [] });
    try {
      await requireChannelOwnership(42, "cust_B");
      throw new Error("should have thrown");
    } catch (e) { expect404(e); }
  });
});

describe("requireAlertOwnership", () => {
  it("joins active_alerts -> servers and filters on server.customer_id", async () => {
    (query as any).mockResolvedValue({ rows: [{ id: 100, server_id: "srv_1", alert_type: "x" }] });
    await requireAlertOwnership(100, "cust_A");
    const sql = (query as any).mock.calls[0][0];
    expect(sql).toMatch(/JOIN servers s/);
    expect(sql).toMatch(/a\.id = \$1 AND s\.customer_id = \$2/);
  });
  it("throws 404 on foreign alert", async () => {
    (query as any).mockResolvedValue({ rows: [] });
    try {
      await requireAlertOwnership(100, "cust_B");
      throw new Error("should have thrown");
    } catch (e) { expect404(e); }
  });
});

describe("requireTrendWarningOwnership", () => {
  it("joins trend_warnings -> servers and filters customer_id", async () => {
    (query as any).mockResolvedValue({ rows: [{ id: 7 }] });
    await requireTrendWarningOwnership(7, "cust_A");
    const sql = (query as any).mock.calls[0][0];
    expect(sql).toMatch(/JOIN servers s/);
    expect(sql).toMatch(/tw\.id = \$1 AND s\.customer_id = \$2/);
  });
  it("throws 404 on non-numeric id", async () => {
    try {
      await requireTrendWarningOwnership(NaN, "cust_A");
      throw new Error("should have thrown");
    } catch (e) { expect404(e); }
    expect(query).not.toHaveBeenCalled();
  });
});
