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

type ChartPoint = { at: number; value: number | null | undefined };

/**
 * Ends the series on the newest report so the last point equals the Latest Value beside the chart.
 * The bucket holding that report is still filling; without this it shows an unfinished average or worst case.
 * @param {ChartPoint[]} points Bucketed points ordered oldest first.
 * @param {number|null|undefined} latestAt Receive time of the newest report, Unix milliseconds.
 * @param {number|null|undefined} latestValue Newest reading in the chart's unit.
 * @param {number} bucketSeconds Bucket width of the selected interval.
 * @returns {ChartPoint[]} Points whose final bucket carries the newest reading; unchanged when there is none.
 */
export function endOnLatestReading(points: ChartPoint[], latestAt: number | null | undefined,
  latestValue: number | null | undefined, bucketSeconds: number): ChartPoint[] {
  const last = points.at(-1);
  if (!last || latestAt == null || latestValue == null || !Number.isFinite(latestAt) || !Number.isFinite(latestValue)) return points;
  const bucketAt = Math.floor(latestAt / (bucketSeconds * 1000)) * bucketSeconds * 1000;
  if (bucketAt < last.at) return points;
  const live = { at: bucketAt, value: latestValue };
  return bucketAt === last.at ? [...points.slice(0, -1), live] : [...points, live];
}
