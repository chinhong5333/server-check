// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), setData: vi.fn(), remove: vi.fn(), apply: vi.fn(), setRange: vi.fn(), setLogical: vi.fn(), range: vi.fn(), logical: vi.fn(), crosshair: vi.fn() }));
vi.mock("lightweight-charts", () => ({ AreaSeries: {}, ColorType: { Solid: "solid" }, LastPriceAnimationMode: { Disabled: 0, Continuous: 1 }, TickMarkType: { DayOfMonth: 2 }, createChart: mocks.create }));
import { TradingViewMetricChart } from "../../src/client/components/TradingViewMetricChart";
const formatter = (value: number | null | undefined) => `${value}%`;
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillRect: vi.fn(), getImageData: () => ({ data: [30, 100, 200, 255] }) } as never);
  mocks.range.mockReturnValue(null); mocks.logical.mockReturnValue(null);
  const series = { setData: mocks.setData, applyOptions: mocks.apply };
  mocks.create.mockReturnValue({ addSeries: () => series, applyOptions: mocks.apply,
    remove: mocks.remove, subscribeCrosshairMove: mocks.crosshair, timeScale: () => ({
      subscribeVisibleTimeRangeChange: vi.fn(), getVisibleRange: mocks.range, getVisibleLogicalRange: mocks.logical,
      setVisibleRange: mocks.setRange, setVisibleLogicalRange: mocks.setLogical }) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("uses TradingView's continuous pulse and responds to reduced-motion changes", () => {
  const preference = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", vi.fn(() => preference));
  const view = render(<TradingViewMetricChart title="RAM" points={[{at:1000,value:42}]} formatter={formatter} />);
  expect(mocks.apply).toHaveBeenCalledWith({ lastPriceAnimation: 1 });
  preference.matches = true;
  preference.addEventListener.mock.calls[0][1]();
  expect(mocks.apply).toHaveBeenLastCalledWith({ lastPriceAnimation: 0 });
  view.unmount();
  expect(preference.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
});
it("shows floating hover details and hides them when the pointer leaves", () => {
  const view = render(<TradingViewMetricChart title="RAM" points={[{at:1000,value:42}]} formatter={formatter} />);
  const canvas = view.container.querySelector(".tradingview-canvas")!;
  Object.defineProperty(canvas, "clientWidth", {value:400});
  Object.defineProperty(canvas, "clientHeight", {value:240});
  const tooltip = view.container.querySelector(".tradingview-tooltip") as HTMLElement;
  const series = mocks.create.mock.results[0].value.addSeries();
  const hover = mocks.crosshair.mock.calls[0][0];
  hover({time:1,point:{x:100,y:100},seriesData:new Map([[series,{value:42}]])});
  expect(tooltip.style.display).toBe("block");
  expect(tooltip.textContent).toContain("RAM: 42%");
  expect(tooltip.style.left).toBe("112px");
  expect(view.container.querySelector(".tradingview-caption")?.textContent).not.toContain("42%");
  hover({seriesData:new Map()});
  expect(tooltip.style.display).toBe("none");
});
it("uses native horizontal dragging with zoom disabled and cleans up", () => {
  const view = render(<TradingViewMetricChart title="RAM" points={[{at:1000,value:1}]} formatter={formatter} />);
  expect(mocks.create.mock.calls[0][1]).toMatchObject({ handleScale: false,
    handleScroll: { pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false, mouseWheel: false },
    layout: { attributionLogo: true } });
  expect(mocks.setData).toHaveBeenCalledWith([{time:1,value:1}]);
  view.unmount(); expect(mocks.remove).toHaveBeenCalledOnce();
});
it("preserves a historical viewing position when new data arrives", () => {
  const view = render(<TradingViewMetricChart title="RAM" points={[{at:1000,value:1},{at:10000,value:10}]} formatter={formatter} />);
  mocks.range.mockReturnValue({from:1,to:5}); mocks.logical.mockReturnValue({from:0,to:4});
  view.rerender(<TradingViewMetricChart title="RAM" points={[{at:1000,value:2},{at:11000,value:11}]} formatter={formatter} />);
  expect(mocks.setRange).toHaveBeenLastCalledWith({from:1,to:5});
  expect(mocks.create).toHaveBeenCalledOnce();
});
