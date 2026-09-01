export interface CustomerPayload {
  id: string;
  email: string;
  displayName: string | null;
  emailVerified: boolean;
  status: string;
  plan: string;
  // True for the public read-only demo tenant. Drives the hooks-level
  // mutation guard and the demo ribbon. Absent/false for real customers.
  isDemo?: boolean;
  // Sessions (JWTs) issued before this instant are no longer honored. Set to
  // NOW() on password reset (migration 034) so a stolen guardian_token stops
  // working once the owner resets. NULL/absent = no reset has invalidated
  // sessions, the default for every account. Only populated by getCustomerById.
  sessionEpoch?: Date | null;
  // Browser (guardian_token) sessions issued before this instant are no longer
  // honored. Set to NOW() on logout (migration 045). Kept SEPARATE from
  // sessionEpoch so a logout revokes browser sessions WITHOUT revoking MCP OAuth
  // grants (which bind sessionEpoch). NULL/absent = no logout has invalidated
  // browser sessions. Only populated by getCustomerById.
  browserSessionEpoch?: Date | null;
}

export interface Server {
  id: string;
  customer_id: string;
  name: string;
  hostname: string;
  ip: string;
  os_type: string;
  os_version: string;
  status: string;
  created_at: string;
  last_seen_at: string | null;
  collector_version: string | null;
  config_overrides: Record<string, unknown>;
}

export interface ActiveAlert {
  id: number;
  server_id: string;
  alert_type: string;
  severity: string;
  title: string;
  message: string;
  evidence: Record<string, unknown>;
  recommendation: string;
  first_seen: string;
  last_seen: string;
  resolved_at: string | null;
  acknowledged: boolean;
  acknowledged_at: string | null;
  notification_sent: boolean;
}

export interface AlertChannel {
  id: number;
  customer_id: string;
  channel_type: string;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
}

export interface Snapshot {
  server_id: string;
  timestamp: string;
  collector_version: string;
  hostname: string;
  ip: string;
  os: string;
  kernel: string;
  uptime_seconds: number;
  cpu_user_percent: number;
  cpu_system_percent: number;
  cpu_iowait_percent: number;
  cpu_idle_percent: number;
  load_1m: number;
  load_5m: number;
  load_15m: number;
  ram_total_mb: number;
  ram_used_mb: number;
  ram_available_mb: number;
  swap_total_mb: number;
  swap_used_mb: number;
  disks: string;
  smart: string;
  network: string;
  raid: string;
  ipmi: string;
  oom_kills_recent: number;
  zombie_processes: number;
  time_drift_ms: number;
}

export interface Analysis {
  server_id: string;
  timestamp: string;
  summary: string;
  findings: string;
  recommendations: string;
  risk_level: string;
  trigger: string;
}
