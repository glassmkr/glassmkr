-- ClickHouse schema baseline for Glassmkr Forge.
-- Captured from production glassmkr database on 2026-04-13.
-- Apply with: clickhouse-client --multiquery < migrations/clickhouse/001_initial.sql

CREATE DATABASE IF NOT EXISTS glassmkr;

CREATE TABLE IF NOT EXISTS glassmkr.snapshots
(
    server_id String,
    timestamp DateTime64(3, 'UTC'),
    collector_version String,
    hostname String,
    ip String,
    os String,
    kernel String,
    uptime_seconds UInt32,
    cpu_user_percent Float32,
    cpu_system_percent Float32,
    cpu_iowait_percent Float32,
    cpu_idle_percent Float32,
    cpu_cores String DEFAULT '',
    load_1m Float32,
    load_5m Float32,
    load_15m Float32,
    ram_total_mb UInt32,
    ram_used_mb UInt32,
    ram_available_mb UInt32,
    swap_total_mb UInt32,
    swap_used_mb UInt32,
    disks String,
    smart String,
    network String,
    raid String,
    ipmi String,
    oom_kills_recent UInt16,
    zombie_processes UInt16,
    time_drift_ms Float32,
    security String DEFAULT '',
    zfs String DEFAULT '',
    io_errors String DEFAULT '',
    io_latency String DEFAULT '[]',
    conntrack String DEFAULT '{}',
    systemd String DEFAULT '{}',
    ntp String DEFAULT '{}',
    file_descriptors String DEFAULT '{}'
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (server_id, timestamp)
TTL toDateTime(timestamp) + toIntervalDay(90);

CREATE TABLE IF NOT EXISTS glassmkr.alert_history
(
    server_id String,
    timestamp DateTime64(3, 'UTC'),
    event_type Enum8('fired' = 1, 'resolved' = 2, 'acknowledged' = 3),
    alert_type String,
    severity String,
    title String,
    message String,
    evidence String,
    recommendation String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (server_id, timestamp)
TTL toDateTime(timestamp) + toIntervalDay(365);

CREATE TABLE IF NOT EXISTS glassmkr.analyses
(
    server_id String,
    timestamp DateTime64(3, 'UTC'),
    summary String,
    findings String,
    recommendations String,
    risk_level String,
    trigger String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (server_id, timestamp)
TTL toDateTime(timestamp) + toIntervalDay(90);

CREATE TABLE IF NOT EXISTS glassmkr.notification_log
(
    server_id String,
    timestamp DateTime64(3, 'UTC'),
    channel_type String,
    channel_name String,
    alert_type String,
    success UInt8,
    error String DEFAULT ''
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (server_id, timestamp)
TTL toDateTime(timestamp) + toIntervalDay(90);
