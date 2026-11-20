import { expect, it } from "vitest";
import { endOnLatestReading, tradingViewData } from "../../src/client/lib/tradingview-data";
it("converts milliseconds, sorts, deduplicates, and preserves missing values", () => {
  expect(tradingViewData([{at:2000,value:2},{at:1000,value:1},{at:2999,value:3},{at:3000,value:null},{at:NaN,value:0}]))
    .toEqual([{time:1,value:1},{time:2,value:3},{time:3}]);
});
it("accepts the complete 10,800-point preview without dropping data", () => {
  const points = Array.from({length:10800},(_,i)=>({at:1_780_000_000_000+i*60000,value:i%100}));
  expect(tradingViewData(points)).toHaveLength(10800);
});

it("ends the series on the newest reading inside its unfinished bucket", () => {
  const points = [{ at: 0, value: 80 }, { at: 1_800_000, value: 66.63 }];
  expect(endOnLatestReading(points, 1_800_000 + 240_000, 89.97, 1800)).toEqual([{ at: 0, value: 80 }, { at: 1_800_000, value: 89.97 }]);
  expect(endOnLatestReading(points, 3_600_000 + 5_000, 89.97, 1800).at(-1)).toEqual({ at: 3_600_000, value: 89.97 });
});
it("leaves the series unchanged without a newest reading, without points, or when history is newer", () => {
  const points = [{ at: 1_800_000, value: 66.63 }];
  expect(endOnLatestReading(points, null, 89.97, 1800)).toBe(points);
  expect(endOnLatestReading(points, 1_900_000, null, 1800)).toBe(points);
  expect(endOnLatestReading([], 1_900_000, 89.97, 1800)).toEqual([]);
  expect(endOnLatestReading(points, 60_000, 89.97, 1800)).toBe(points);
});
