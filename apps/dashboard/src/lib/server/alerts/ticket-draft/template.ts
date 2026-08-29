// Template prose: the no-LLM floor. Per-type connective prose written to read
// like a competent operator wrote it (target 90% of the Gemma version). This is
// the default path; Gemma only swaps these four segments. Facts are injected
// separately by the assembler, so this prose never contains identifiers.

import type { ProseSegments } from "./types";

const CLOSING = "Thank you for your help.";

const TEMPLATES: Record<string, ProseSegments> = {
  smart_failing: {
    opening: "Monitoring on the server identified below has detected SMART indicators of a failing drive.",
    impact: "Pending or reallocated sectors are an early sign of media failure; the drive is at elevated risk of data loss or sudden failure and should be inspected or replaced before it degrades further.",
    request: "Please inspect the drive listed above and replace it if confirmed failing, or dispatch a remote-hands technician to do so. Before the swap, please confirm whether the drive bay is hot-swappable in this chassis; if it is not, please coordinate a maintenance window with us before taking the host down.",
    closing: CLOSING,
  },
  nvme_critical_warning: {
    opening: "Monitoring on the server identified below has detected an NVMe Critical Warning on one of its drives.",
    impact: "The drive controller has raised a vendor-defined immediate-action flag, which indicates degraded reliability, exhausted spare blocks, over-temperature, or a protective read-only state depending on the flag. Drive failure is forecast.",
    request: "Please inspect the drive listed above and plan its replacement, or dispatch a remote-hands technician. Before the swap, please confirm whether the drive bay is hot-swappable in this chassis; if it is not, please coordinate a maintenance window with us before taking the host down.",
    closing: CLOSING,
  },
  nvme_wear_high: {
    opening: "Monitoring on the server identified below reports an SSD that has consumed most of its rated write endurance.",
    impact: "The drive is not yet reporting media errors, but flash wear is cumulative and irreversible, and failure rates rise sharply once rated endurance is exhausted. The wear figure quoted above is read directly from the drive's SMART data, and the model, serial, and firmware listed identify the specific unit, so the reading can be verified on-site.",
    request: "Please schedule a proactive replacement of the drive identified above, or dispatch a remote-hands technician. If the drive is under warranty, the SMART wear reading typically supports an RMA claim. Before the swap, please confirm whether the drive bay is hot-swappable in this chassis; if it is not, please coordinate a maintenance window with us before taking the host down.",
    closing: CLOSING,
  },
  raid_degraded: {
    opening: "Monitoring on the server identified below reports a degraded RAID array.",
    impact: "A degraded array has lost its redundancy; a further disk failure before the array rebuilds would cause data loss.",
    request: "Please identify and replace the failed member disk so the array can rebuild, or dispatch a remote-hands technician. Most RAID member bays are hot-swappable; if this chassis requires downtime for the swap, please coordinate a maintenance window with us first.",
    closing: CLOSING,
  },
  ecc_errors: {
    opening: "Monitoring on the server identified below reports memory (ECC) errors.",
    impact: "ECC errors point to a failing memory module: an uncorrectable error can crash the host or corrupt data, and a rising rate of correctable errors is an early warning of the same. The affected module should be replaced before it degrades further.",
    request: "Please inspect and replace the affected memory module, or dispatch a remote-hands technician. DIMM replacement requires powering the host down, so please coordinate a maintenance window with us before starting the work.",
    closing: CLOSING,
  },
  mce_uncorrected: {
    opening: "Monitoring on the server identified below reports an uncorrected memory error.",
    impact: "An uncorrected memory error means the CPU could not correct a bit flip; in-flight data may have been corrupted and the host is at risk of crashing. The affected module needs replacement.",
    request: "Please replace the affected memory module, or dispatch a remote-hands technician. DIMM replacement requires powering the host down, so please coordinate a maintenance window with us before starting the work.",
    closing: CLOSING,
  },
  psu_redundancy_loss: {
    opening: "Monitoring on the server identified below reports a loss of power-supply redundancy.",
    impact: "The server is running without PSU redundancy, so a single remaining supply or feed is now a single point of failure; a further fault would take the host offline.",
    request: "Please inspect the power supplies and restore redundancy (most enterprise PSUs are hot-swap), or dispatch a remote-hands technician. If this chassis does not support hot-swapping the supply, please coordinate a maintenance window with us first.",
    closing: CLOSING,
  },
  ipmi_fan_failure: {
    opening: "Monitoring on the server identified below reports a cooling fan failure.",
    impact: "A failed fan reduces cooling capacity and can drive components past their thermal limits, leading to throttling or thermal shutdown if not addressed.",
    request: "Please inspect and replace the affected fan, or dispatch a remote-hands technician. If the fan is not hot-swappable in this chassis, please coordinate a maintenance window with us before the replacement.",
    closing: CLOSING,
  },
  cpu_temperature_high: {
    opening: "Monitoring on the server identified below reports a sustained high CPU temperature consistent with a cooling fault.",
    impact: "Sustained over-temperature accelerates wear and can cause throttling or thermal shutdown. With workload ruled out as the cause, this points to a cooling problem: a fan, airflow, dust, or the thermal interface.",
    request: "Please inspect the cooling system (fans, airflow, dust, thermal paste), or dispatch a remote-hands technician. If the work requires taking the host down (heatsink reseating or thermal paste), please coordinate a maintenance window with us first.",
    closing: CLOSING,
  },
  disk_io_errors: {
    opening: "Monitoring on the server identified below reports disk I/O errors consistent with failing storage hardware.",
    impact: "Repeated I/O errors on the same device are a strong signal of impending disk failure and risk data loss if the device is not replaced.",
    request: "Please check the device's SMART status and replace it if confirmed failing, or dispatch a remote-hands technician. Before any swap, please confirm whether the drive bay is hot-swappable in this chassis; if it is not, please coordinate a maintenance window with us before taking the host down.",
    closing: CLOSING,
  },
};

const DEFAULT_PROSE: ProseSegments = {
  opening: "Monitoring on the server identified below has detected a hardware fault.",
  impact: "This is a physical-hardware fault that is unlikely to be resolved from within the operating system and risks an outage or data loss if left unaddressed.",
  request: "Please inspect the affected hardware listed above and remediate or replace it, or dispatch a remote-hands technician. If remediation requires taking the host down, please coordinate a maintenance window with us first.",
  closing: CLOSING,
};

export function templateProse(alertType: string): ProseSegments {
  return TEMPLATES[alertType] ?? DEFAULT_PROSE;
}
