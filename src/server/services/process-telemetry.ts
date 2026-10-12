import { MAX_TOP_PROCESSES } from "../../shared/contracts.js";

/**
 * Removes optional process records with finite RAM percentages above 100 before strict telemetry validation.
 * Other malformed records, core metrics, and oversized process lists remain unchanged for validation.
 * @param {unknown} value Decoded canonical telemetry JSON; only top_processes[].memory_percent is inspected.
 * @returns {{payload: unknown, skipped: Array<{process_index: number, memory_percent: number}>}} Copied payload when records are skipped and credential-free diagnostics using original zero-based indexes.
 */
export function skipExcessProcessMemory(value: unknown): {
  payload: unknown;
  skipped: Array<{ process_index: number; memory_percent: number }>;
} {
  const skipped: Array<{ process_index: number; memory_percent: number }> = [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { payload: value, skipped };
  const report = value as Record<string, unknown>;
  if (!Array.isArray(report.top_processes) || report.top_processes.length > MAX_TOP_PROCESSES) return { payload: value, skipped };
  const processes = report.top_processes.filter((entry: unknown, processIndex: number) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return true;
    const memoryPercent = (entry as Record<string, unknown>).memory_percent;
    if (typeof memoryPercent !== "number" || !Number.isFinite(memoryPercent) || memoryPercent <= 100) return true;
    skipped.push({ process_index: processIndex, memory_percent: memoryPercent });
    return false;
  });
  return { payload: skipped.length ? { ...report, top_processes: processes } : value, skipped };
}
