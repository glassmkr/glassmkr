import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@glassmkr/db/pg", () => ({ query: vi.fn() }));
vi.mock("$lib/server/alerts/fix-workflow/loader.js", () => ({ getRuleMetadata: vi.fn() }));

import { query } from "@glassmkr/db/pg";
import { getRuleMetadata } from "$lib/server/alerts/fix-workflow/loader.js";
import {
  acknowledgeAlertForCustomer,
  resolveAlertForCustomer,
} from "../alert-actions.js";

beforeEach(() => {
  vi.mocked(query).mockReset();
  vi.mocked(getRuleMetadata).mockReset();
});

describe("acknowledgeAlertForCustomer", () => {
  it("scopes the update to the customer's own servers and returns the row", async () => {
    vi.mocked(query).mockResolvedValueOnce(
      { rows: [{ id: "a1", alert_type: "disk_io_errors", acknowledged: true }], rowCount: 1 } as never,
    );
    const row = await acknowledgeAlertForCustomer("cust-a", "a1");
    expect(row).toEqual({ id: "a1", alert_type: "disk_io_errors", acknowledged: true });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("server_id IN (SELECT id FROM servers WHERE customer_id = $2)");
    expect(params).toEqual(["a1", "cust-a"]);
  });

  it("returns null when the alert is not owned by the customer (tenant isolation)", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    expect(await acknowledgeAlertForCustomer("cust-a", "belongs-to-b")).toBeNull();
  });
});

describe("resolveAlertForCustomer", () => {
  it("not_found when no owned alert matches", async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    expect((await resolveAlertForCustomer("c", "a1")).status).toBe("not_found");
  });

  it("already_resolved (idempotent) when resolved_at is set", async () => {
    vi.mocked(query).mockResolvedValueOnce(
      { rows: [{ alert_type: "oom_kills", resolved_at: new Date() }], rowCount: 1 } as never,
    );
    expect((await resolveAlertForCustomer("c", "a1")).status).toBe("already_resolved");
    expect(vi.mocked(query).mock.calls).toHaveLength(1); // no UPDATE issued
  });

  it("not_manual_resolve for an auto-resolving rule (must acknowledge instead)", async () => {
    vi.mocked(query).mockResolvedValueOnce(
      { rows: [{ alert_type: "disk_space_high", resolved_at: null }], rowCount: 1 } as never,
    );
    vi.mocked(getRuleMetadata).mockReturnValueOnce({ manual_resolve: false } as never);
    const result = await resolveAlertForCustomer("c", "a1");
    expect(result.status).toBe("not_manual_resolve");
    if (result.status === "not_manual_resolve") expect(result.alertType).toBe("disk_space_high");
    expect(vi.mocked(query).mock.calls).toHaveLength(1); // gated before UPDATE
  });

  it("resolves a manual_resolve rule and persists the audit-discriminating reason prefix", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ alert_type: "oom_kills", resolved_at: null }], rowCount: 1 } as never)
      .mockResolvedValueOnce({
        rows: [{ id: "a1", alert_type: "oom_kills", resolved_at: new Date(), resolution_reason: "manual-after-investigation; checked" }],
        rowCount: 1,
      } as never);
    vi.mocked(getRuleMetadata).mockReturnValueOnce({ manual_resolve: true } as never);
    const result = await resolveAlertForCustomer("c", "a1", "checked");
    expect(result.status).toBe("resolved");
    const updateParams = vi.mocked(query).mock.calls[1][1] as unknown[];
    expect(updateParams[0]).toBe("manual-after-investigation; checked");
  });
});
