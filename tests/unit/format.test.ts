import { describe, expect, it } from "vitest";
import { formatBytes, formatCount, formatLatency, formatPercent, formatRatio } from "../../src/client/lib/format";

describe("monitoring number formatting", () => {
  it("never exposes invalid numeric values", () => {
    expect(formatPercent(null)).toBe("--");
    expect(formatRatio(Number.NaN)).toBe("--");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("--");
  });

  it("removes signed zero and formats tiny percentages", () => {
    expect(formatPercent(-0)).toBe("0.0%");
    expect(formatPercent(0.004)).toBe("<0.01%");
  });

  it("formats operational units without scientific notation", () => {
    expect(formatBytes(1_073_741_824)).toBe("1 GB");
    expect(formatLatency(1250)).toBe("1.25 s");
    expect(formatRatio(1.5)).toBe("1.5x");
    expect(formatCount(1250)).toBe("1.3K");
  });
});
