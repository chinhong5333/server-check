import { expect, it } from "vitest";
import { tradingViewData } from "../../src/client/lib/tradingview-data";
it("converts milliseconds, sorts, deduplicates, and preserves missing values", () => {
  expect(tradingViewData([{at:2000,value:2},{at:1000,value:1},{at:2999,value:3},{at:3000,value:null},{at:NaN,value:0}]))
    .toEqual([{time:1,value:1},{time:2,value:3},{time:3}]);
});
it("accepts the complete 10,800-point preview without dropping data", () => {
  const points = Array.from({length:10800},(_,i)=>({at:1_780_000_000_000+i*60000,value:i%100}));
  expect(tradingViewData(points)).toHaveLength(10800);
});
