// In-memory, per-process FIFO queue for AI-analysis jobs.
//
// There is one self-hosted Gemma instance on a single L4 GPU, so analyses must
// run one at a time (see the runSerialized note in analyzer.ts). Previously the
// HTTP request was held open through the entire wait, so a request sitting
// behind others just spun with no feedback and could hit the edge proxy's
// ~100s timeout, looking to the user like it "never ran." This queue makes the
// wait observable: enqueue returns immediately with a job id + position + ETA,
// the work runs in the background one at a time, and the client polls for
// status (queued / running / done / error).
//
// Per-process only, same caveat as the prompt cap: if the dashboard ever runs
// multiple workers, each has its own queue. That is acceptable here (a single
// GPU behind a single app instance) and the prompt cap guards the context
// window regardless.

import { randomUUID } from "node:crypto";

export type JobStatus = "queued" | "running" | "done" | "error";

interface Job {
  id: string;
  serverId: string;
  customerId: string;
  status: JobStatus;
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

export interface JobHandle<T> {
  id: string;
  /** Jobs ahead of this one at enqueue time (0 = runs immediately). */
  position: number;
  estimatedSeconds: number;
  /** Resolves/rejects when the job finishes; used by synchronous callers. */
  done: Promise<T>;
}

export interface JobView {
  status: JobStatus;
  position: number;
  estimatedSeconds: number;
  error: string | null;
  serverId: string;
  customerId: string;
}

/**
 * Thrown by enqueueAnalysis when admission control refuses a job. The single
 * shared GPU drains the queue one job at a time, so an unbounded per-tenant
 * enqueue lets one customer starve every other tenant (cross-tenant DoS). The
 * caller (analyze endpoint) maps this to HTTP 429 using `message`; `reason`
 * lets it record which limit tripped.
 */
export class AnalysisQueueRejectedError extends Error {
  constructor(
    public readonly reason: "duplicate" | "cap",
    message: string,
  ) {
    super(message);
    this.name = "AnalysisQueueRejectedError";
  }
}

// Most in-flight (queued or running) analyses one customer may hold at once.
// A duplicate for a server the customer already has in flight is rejected
// separately, before this cap is consulted.
const MAX_JOBS_PER_CUSTOMER = 3;

// Most in-flight analyses across ALL customers. The per-customer cap alone was
// a multiplier, not a bound: with analysis free on every account, N signups
// buy 3N queue slots against one shared GPU, so the queue could grow without
// limit and every tenant's wait with it. 30 slots is ten busy customers deep,
// roughly 12 minutes of work at the observed ~25s per run: far above organic
// concurrency, low enough that a signup farm hits a wall instead of a queue.
const MAX_JOBS_GLOBAL = 30;

// Ordered map: insertion order == enqueue order, which we rely on for position.
const jobs = new Map<string, Job>();
let chain: Promise<unknown> = Promise.resolve();

// Rolling average of the last few *run* durations, for the ETA. Seeded with a
// sane default so the first job still reports a plausible estimate.
const DEFAULT_RUN_MS = 25_000;
const recentDurations: number[] = [];
function avgRunMs(): number {
  if (recentDurations.length === 0) return DEFAULT_RUN_MS;
  return recentDurations.reduce((a, b) => a + b, 0) / recentDurations.length;
}

// Finished jobs linger briefly so a slow poll can still read the terminal
// state, then are pruned so the map does not grow unbounded.
const DONE_TTL_MS = 5 * 60_000;
function prune(now: number): void {
  for (const [id, j] of jobs) {
    if ((j.status === "done" || j.status === "error") && j.finishedAt && now - j.finishedAt > DONE_TTL_MS) {
      jobs.delete(id);
    }
  }
}

/** Number of not-yet-finished jobs currently in the queue. */
function pendingCount(): number {
  let n = 0;
  for (const j of jobs.values()) if (j.status === "queued" || j.status === "running") n++;
  return n;
}

/**
 * Enqueue an analysis. The work runs one at a time in FIFO order; a failure in
 * one job never stalls the ones behind it. Returns immediately with a handle
 * (id + position + ETA) plus a `done` promise for callers that want to await
 * the result synchronously (the programmatic API path).
 */
export function enqueueAnalysis<T>(opts: {
  serverId: string;
  customerId: string;
  work: () => Promise<T>;
}): JobHandle<T> {
  const now = Date.now();
  prune(now);

  // Admission control (cross-tenant DoS guard). The FIFO worker below is
  // unchanged; this only decides whether the job is admitted. Prune ran first
  // so finished jobs no longer count toward either check.
  //   1. Dedupe: reject a second job for a (server, customer) that already has
  //      one queued or running; re-clicking Analyze must not stack duplicates.
  //   2. Per-customer cap: reject once the customer already holds
  //      MAX_JOBS_PER_CUSTOMER in-flight jobs, so one tenant cannot flood the
  //      single shared GPU and starve the others.
  let ownInFlight = 0;
  let allInFlight = 0;
  for (const j of jobs.values()) {
    if (j.status !== "queued" && j.status !== "running") continue;
    allInFlight++;
    if (j.customerId !== opts.customerId) continue;
    if (j.serverId === opts.serverId) {
      throw new AnalysisQueueRejectedError(
        "duplicate",
        "An analysis for this server is already queued or running. Wait for it to finish before starting another.",
      );
    }
    ownInFlight++;
  }
  //   3. Global cap: checked AFTER the duplicate check so the caller still
  //      gets the more specific error, and BEFORE the per-customer cap so a
  //      full queue reads as "busy" rather than blaming the caller's own use.
  if (allInFlight >= MAX_JOBS_GLOBAL) {
    throw new AnalysisQueueRejectedError(
      "cap",
      "The analysis queue is at capacity. This bounds everyone's wait; try again in a few minutes.",
    );
  }
  if (ownInFlight >= MAX_JOBS_PER_CUSTOMER) {
    throw new AnalysisQueueRejectedError(
      "cap",
      `You already have ${MAX_JOBS_PER_CUSTOMER} analyses queued or running. Wait for one to finish before starting another.`,
    );
  }

  const position = pendingCount();
  const id = randomUUID();
  const job: Job = { id, serverId: opts.serverId, customerId: opts.customerId, status: "queued", enqueuedAt: now };
  jobs.set(id, job);

  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const done = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const runWorker = async () => {
    job.status = "running";
    job.startedAt = Date.now();
    try {
      const result = await opts.work();
      job.status = "done";
      resolve(result);
    } catch (e: unknown) {
      job.status = "error";
      job.error = e instanceof Error ? e.message : String(e);
      reject(e);
    } finally {
      job.finishedAt = Date.now();
      if (job.startedAt) {
        recentDurations.push(job.finishedAt - job.startedAt);
        if (recentDurations.length > 10) recentDurations.shift();
      }
    }
  };

  // Run after the previous job settles, regardless of its outcome (both
  // handlers), so one failure cannot block the rest of the queue. runWorker
  // catches internally, so the chain never actually rejects.
  const run = chain.then(runWorker, runWorker);
  chain = run.then(
    () => undefined,
    () => undefined,
  );

  const estimatedSeconds = Math.round(((position + 1) * avgRunMs()) / 1000);
  return { id, position, estimatedSeconds, done };
}

/** Live view of a job: recomputes position (jobs ahead shrink as they finish). */
export function getAnalysisJob(id: string): JobView | null {
  const job = jobs.get(id);
  if (!job) return null;

  let ahead = 0;
  for (const j of jobs.values()) {
    if (j.id === id) break; // insertion order == enqueue order
    if (j.status === "queued" || j.status === "running") ahead++;
  }

  const terminal = job.status === "done" || job.status === "error";
  return {
    status: job.status,
    position: ahead,
    estimatedSeconds: terminal ? 0 : Math.round(((ahead + 1) * avgRunMs()) / 1000),
    error: job.error ?? null,
    serverId: job.serverId,
    customerId: job.customerId,
  };
}

/** Test-only: reset module state between cases. */
export function __resetJobQueueForTests(): void {
  jobs.clear();
  chain = Promise.resolve();
  recentDurations.length = 0;
}
