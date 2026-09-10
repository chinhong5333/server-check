import type { AreaData, UTCTimestamp, WhitespaceData } from "lightweight-charts";

/** Normalize millisecond samples to ordered unique UTC seconds; missing values remain whitespace. */
export function tradingViewData(points: { at: number; value: number | null | undefined }[]): (AreaData | WhitespaceData)[] {
  const unique = new Map<number, AreaData | WhitespaceData>();
  for (const point of points) {
    if (!Number.isFinite(point.at) || point.at < 0) continue;
    const time = Math.floor(point.at / 1000) as UTCTimestamp;
    unique.set(time, Number.isFinite(point.value) && point.value != null ? { time, value: point.value } : { time });
  }
  return [...unique.entries()].sort(([a], [b]) => a - b).map(([, value]) => value);
}
