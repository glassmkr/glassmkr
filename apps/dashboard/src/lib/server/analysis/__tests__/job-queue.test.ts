import { describe, it, expect, beforeEach } from "vitest";
import {
  enqueueAnalysis,
  getAnalysisJob,
  AnalysisQueueRejectedError,
  __resetJobQueueForTests,
} from "../job-queue";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("analysis job-queue", () => {
  beforeEach(() => __resetJobQueueForTests());

  it("assigns increasing positions and drains FIFO, one at a time", async () => {
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const d3 = deferred<string>();
    const started: number[] = [];
    // Distinct serverIds: admission control rejects a duplicate (same
    // server+customer) in flight, but the FIFO chain is global, so three
    // different servers for one customer still drain one at a time.
    const h1 = enqueueAnalysis({ serverId: "s1", customerId: "c", work: async () => { started.push(1); return d1.promise; } });
    const h2 = enqueueAnalysis({ serverId: "s2", customerId: "c", work: async () => { started.push(2); return d2.promise; } });
    const h3 = enqueueAnalysis({ serverId: "s3", customerId: "c", work: async () => { started.push(3); return d3.promise; } });

    expect([h1.position, h2.position, h3.position]).toEqual([0, 1, 2]);

    await tick();
    // Only the first job has started; the rest wait behind it.
    expect(started).toEqual([1]);
    expect(getAnalysisJob(h1.id)!.status).toBe("running");
    expect(getAnalysisJob(h2.id)!.status).toBe("queued");

    d1.resolve("a");
    await h1.done;
    await tick();
    expect(started).toEqual([1, 2]);

    d2.resolve("b");
    await h2.done;
    await tick();
    expect(started).toEqual([1, 2, 3]);

    d3.resolve("c");
    await h3.done;
    expect(getAnalysisJob(h3.id)!.status).toBe("done");
  });

  it("a failing job does not stall the queue and its error is surfaced", async () => {
    const h1 = enqueueAnalysis({ serverId: "s1", customerId: "c", work: async () => { throw new Error("boom"); } });
    let ran2 = false;
    const h2 = enqueueAnalysis({ serverId: "s2", customerId: "c", work: async () => { ran2 = true; return "ok"; } });

    await expect(h1.done).rejects.toThrow("boom");
    await h2.done;

    expect(ran2).toBe(true);
    expect(getAnalysisJob(h1.id)!.status).toBe("error");
    expect(getAnalysisJob(h1.id)!.error).toBe("boom");
    expect(getAnalysisJob(h2.id)!.status).toBe("done");
  });

  it("reports a non-negative ETA while pending and 0 once terminal", async () => {
    const h1 = enqueueAnalysis({ serverId: "s", customerId: "c", work: async () => "x" });
    const pending = getAnalysisJob(h1.id)!;
    expect(typeof pending.estimatedSeconds).toBe("number");
    expect(pending.estimatedSeconds).toBeGreaterThanOrEqual(0);

    await h1.done;
    await tick();
    expect(getAnalysisJob(h1.id)!.estimatedSeconds).toBe(0);
  });

  it("live position shrinks as earlier jobs finish", async () => {
    const d1 = deferred<string>();
    const h1 = enqueueAnalysis({ serverId: "s1", customerId: "c", work: async () => d1.promise });
    const h2 = enqueueAnalysis({ serverId: "s2", customerId: "c", work: async () => "y" });

    await tick();
    expect(getAnalysisJob(h2.id)!.position).toBe(1);

    d1.resolve("x");
    await h1.done;
    await tick();
    expect(getAnalysisJob(h2.id)!.position).toBe(0);
  });

  it("returns null for an unknown job id", () => {
    expect(getAnalysisJob("does-not-exist")).toBeNull();
  });

  it("carries serverId + customerId for the ownership check", () => {
    const h = enqueueAnalysis({ serverId: "srv_1", customerId: "cus_1", work: async () => "z" });
    const v = getAnalysisJob(h.id)!;
    expect(v.serverId).toBe("srv_1");
    expect(v.customerId).toBe("cus_1");
  });

  describe("admission control (cross-tenant DoS guard)", () => {
    // Keep the jobs from settling so they stay queued/running for the checks.
    const hang = () => new Promise<string>(() => {});

    it("admits up to the per-customer cap, then rejects the next with reason 'cap'", () => {
      // Cap is 3. Three distinct servers for one customer are all admitted.
      enqueueAnalysis({ serverId: "a", customerId: "c", work: hang });
      enqueueAnalysis({ serverId: "b", customerId: "c", work: hang });
      enqueueAnalysis({ serverId: "d", customerId: "c", work: hang });

      let err: unknown;
      try {
        enqueueAnalysis({ serverId: "e", customerId: "c", work: hang });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(AnalysisQueueRejectedError);
      expect((err as AnalysisQueueRejectedError).reason).toBe("cap");
    });

    it("rejects a duplicate serverId+customerId with reason 'duplicate'", () => {
      enqueueAnalysis({ serverId: "srv", customerId: "c", work: hang });

      let err: unknown;
      try {
        enqueueAnalysis({ serverId: "srv", customerId: "c", work: hang });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(AnalysisQueueRejectedError);
      expect((err as AnalysisQueueRejectedError).reason).toBe("duplicate");
    });

    it("does not count another customer's jobs against the cap or dedupe", () => {
      // c1 is at the cap.
      enqueueAnalysis({ serverId: "a", customerId: "c1", work: hang });
      enqueueAnalysis({ serverId: "b", customerId: "c1", work: hang });
      enqueueAnalysis({ serverId: "d", customerId: "c1", work: hang });

      // A different customer is unaffected by c1 being at cap...
      expect(() =>
        enqueueAnalysis({ serverId: "x", customerId: "c2", work: hang }),
      ).not.toThrow();
      // ...and the same serverId under a different customer is not a duplicate.
      expect(() =>
        enqueueAnalysis({ serverId: "a", customerId: "c2", work: hang }),
      ).not.toThrow();
    });

    it("frees the slot once a job finishes (only in-flight jobs count)", async () => {
      const d1 = deferred<string>();
      const h1 = enqueueAnalysis({ serverId: "a", customerId: "c", work: async () => d1.promise });
      enqueueAnalysis({ serverId: "b", customerId: "c", work: hang });
      enqueueAnalysis({ serverId: "d", customerId: "c", work: hang });
      // At cap: a 4th is rejected.
      expect(() => enqueueAnalysis({ serverId: "e", customerId: "c", work: hang })).toThrow(
        AnalysisQueueRejectedError,
      );

      // Let "a" finish; its slot frees and re-analyzing "a" is no longer a duplicate.
      d1.resolve("done");
      await h1.done;
      await tick();
      expect(() =>
        enqueueAnalysis({ serverId: "a", customerId: "c", work: hang }),
      ).not.toThrow();
    });
  });

  it("bounds the queue GLOBALLY, not only per customer", async () => {
    // The per-customer cap alone was a multiplier, not a bound: with analysis
    // free on every account, each signup bought three more slots against one
    // shared GPU, so enough free accounts could grow the queue without limit
    // and starve everyone. Ten customers at their per-customer cap fill the
    // 30-slot global bound; customer eleven is refused outright.
    const gates: Array<() => void> = [];
    for (let c = 0; c < 10; c++) {
      for (let sv = 0; sv < 3; sv++) {
        const d = deferred<string>();
        gates.push(() => d.resolve("done"));
        enqueueAnalysis({ serverId: `s${c}-${sv}`, customerId: `cust-${c}`, work: async () => d.promise });
      }
    }
    expect(() =>
      enqueueAnalysis({ serverId: "s-over", customerId: "cust-fresh", work: async () => "x" }),
    ).toThrowError(AnalysisQueueRejectedError);
    try {
      enqueueAnalysis({ serverId: "s-over2", customerId: "cust-fresh2", work: async () => "x" });
    } catch (e: any) {
      expect(e.reason).toBe("cap");
      // The message must blame CAPACITY, not the fresh caller's own usage:
      // they have zero jobs in flight.
      expect(e.message).toMatch(/capacity/i);
    }
    // Draining one slot readmits.
    gates[0]();
    await tick();
    expect(() =>
      enqueueAnalysis({ serverId: "s-after", customerId: "cust-fresh", work: async () => "x" }),
    ).not.toThrow();
    for (const g of gates.slice(1)) g();
  });

});
