// Every paste-triage parser, in the order analyze.ts runs them. Order matters
// only where two domains share a snapshot container (kernel_log and nvidia_gpu
// both write `gpu`): the earlier parser's scalar values win the merge.

import type { TriageParser } from "./types.js";
import { smartctlParser } from "./parsers/smartctl.js";
import { zpoolParser } from "./parsers/zpool.js";
import { mdraidParser } from "./parsers/mdraid.js";
import { kernelLogParser } from "./parsers/kernel-log.js";
import { ipmiSelParser } from "./parsers/ipmi-sel.js";
import { nvidiaSmiParser } from "./parsers/nvidia-smi.js";

export const TRIAGE_PARSERS: readonly TriageParser[] = [
  smartctlParser,
  zpoolParser,
  mdraidParser,
  kernelLogParser,
  ipmiSelParser,
  nvidiaSmiParser,
];
