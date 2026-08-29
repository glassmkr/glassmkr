import type { DriveFeatures, ServerFeatures } from "../types";

export function baseDrive(overrides: Partial<DriveFeatures> = {}): DriveFeatures {
  return {
    device: "/dev/sda",
    serial: "ZCH0ABCD",
    model: "ST12000NM0007",
    vendor: "Seagate",
    smart_5_raw: 0,
    smart_5_delta_1d: 0,
    smart_5_delta_7d: 0,
    smart_5_delta_30d: 0,
    smart_5_burst_max_7d: 0,
    smart_187_raw: 0,
    smart_187_delta_1d: 0,
    smart_187_delta_7d: 0,
    smart_187_delta_30d: 0,
    smart_187_burst_max_7d: 0,
    smart_188_raw: 0,
    smart_188_delta_1d: 0,
    smart_188_delta_7d: 0,
    smart_188_delta_30d: 0,
    smart_188_burst_max_7d: 0,
    smart_189_raw: 0,
    smart_189_delta_1d: 0,
    smart_189_delta_7d: 0,
    smart_189_delta_30d: 0,
    smart_189_burst_max_7d: 0,
    smart_197_raw: 0,
    smart_197_delta_1d: 0,
    smart_197_delta_7d: 0,
    smart_197_delta_30d: 0,
    smart_197_burst_max_7d: 0,
    smart_197_recurrence_count: 0,
    smart_199_raw: 0,
    smart_199_delta_1d: 0,
    smart_199_delta_7d: 0,
    smart_199_delta_30d: 0,
    smart_198_raw: 0,
    smart_198_delta_1d: 0,
    smart_198_delta_7d: 0,
    smart_198_delta_30d: 0,
    smart_198_burst_max_7d: 0,
    smart_198_recurrence_count: 0,
    drive_age_days: 0,
    health_passed: true,
    ...overrides,
  };
}

export function baseNvme(overrides: Partial<DriveFeatures> = {}): DriveFeatures {
  return baseDrive({
    device: "/dev/nvme0n1",
    serial: "NVME0001",
    model: "Samsung SSD 980",
    vendor: "Samsung",
    nvme_critical_warning: 0,
    nvme_available_spare: 100,
    nvme_available_spare_threshold: 10,
    nvme_media_errors: 0,
    nvme_media_errors_delta_7d: 0,
    nvme_percentage_used: 10,
    ...overrides,
  });
}

export function baseFeatures(overrides: Partial<ServerFeatures> = {}): ServerFeatures {
  return {
    server_id: "srv-1",
    hostname: "test-host",
    drives: [],
    partitions: [],
    ipmi: { fans: [], psu_rails: [], temps: [] },
    ecc: [],
    network: [],
    zfs: [],
    ...overrides,
  };
}
