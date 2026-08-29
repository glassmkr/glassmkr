// Probe each public service over HTTP. Any 2xx or 3xx is operational; anything
// else (4xx/5xx/timeout/network error) is an outage. No database involved.

import { PUBLIC_SERVICES, type PublicService } from "../services";

export type ServiceStatus = "operational" | "outage";

export interface ServiceState {
  service: PublicService;
  status: ServiceStatus;
  checkedAtIso: string;
  responseMs: number | null;
}

const PROBE_TIMEOUT_MS = 5000;

export async function probeService(service: PublicService, signal?: AbortSignal): Promise<ServiceState> {
  const start = Date.now();
  const checkedAtIso = new Date(start).toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  if (signal) signal.addEventListener("abort", () => controller.abort(), { once: true });

  try {
    const res = await fetch(service.url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "Glassmkr-Status/1.0 (+https://status.glassmkr.com)" },
    });
    const responseMs = Date.now() - start;
    const status: ServiceStatus = res.status < 400 ? "operational" : "outage";
    return { service, status, checkedAtIso, responseMs };
  } catch {
    return { service, status: "outage", checkedAtIso, responseMs: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function getServiceStates(): Promise<ServiceState[]> {
  return Promise.all(PUBLIC_SERVICES.map((s) => probeService(s)));
}

export type OverallStatus = "operational" | "partial_outage" | "outage";

export function deriveOverall(states: ServiceState[]): OverallStatus {
  if (states.length === 0) return "outage";
  const outages = states.filter((s) => s.status === "outage").length;
  if (outages === 0) return "operational";
  if (outages === states.length) return "outage";
  return "partial_outage";
}
