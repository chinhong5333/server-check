import { useEffect, useMemo, useRef } from "react";
import { AreaSeries, ColorType, LastPriceAnimationMode, TickMarkType, createChart, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import { tradingViewData } from "../lib/tradingview-data";
import { formatDateTime } from "../lib/format";
const shortTime = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** Convert existing OKLCH theme tokens to sRGB accepted by the Canvas chart library. */
function themeColor(element: HTMLElement, token: string, fallback: string): string {
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!context) return fallback;
  context.fillStyle = getComputedStyle(element).getPropertyValue(token).trim() || fallback;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

/** TradingView owns all drag gestures and rendering; React updates data without resetting historical position. */
export function TradingViewMetricChart({ title, points, formatter }: {
  title: string; points: { at: number; value: number | null | undefined }[];
  formatter: (value: number | null | undefined) => string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const priorLast = useRef<Time | null>(null);
  const rangeText = useRef<HTMLDivElement>(null);
  const hoverText = useRef<HTMLDivElement>(null);
  const data = useMemo(() => tradingViewData(points), [points]);
  const dragging = useRef(false);
  const pending = useRef<(() => void) | null>(null);
  useEffect(() => {
    const element = container.current!;
    const chart = createChart(element, {
      autoSize: true,
      layout: { attributionLogo: true, background: { type: ColorType.Solid, color: "transparent" }, fontSize: 11 },
      handleScale: false,
      handleScroll: { pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false, mouseWheel: false },
      kineticScroll: { mouse: false, touch: false },
      rightPriceScale: { visible: false }, leftPriceScale: { visible: true, borderVisible: false },
      timeScale: { timeVisible: true, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true,
        lockVisibleTimeRangeOnResize: true, borderVisible: false, shiftVisibleRangeOnNewBar: false,
        tickMarkMaxCharacterLength: 9,
        tickMarkFormatter: (time: Time, kind: TickMarkType) => typeof time === "number"
          ? (kind <= TickMarkType.DayOfMonth ? shortDate : shortTime).format(time * 1000) : "" },
      localization: { timeFormatter: (time: Time) => typeof time === "number" ? formatDateTime(time * 1000) : "", priceFormatter: (value: number) => formatter(value) },
      grid: { vertLines: { visible: false } }
    });
    const series = chart.addSeries(AreaSeries, { priceScaleId: "left", lineWidth: 2, priceLineVisible: false,
      lastValueVisible: false, crosshairMarkerVisible: true, priceFormat: { type: "custom", formatter: (value: number) => formatter(value), minMove: 0.01 } });
    chartRef.current = chart; seriesRef.current = series;
    const reducedMotion = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    const updatePulse = () => series.applyOptions({ lastPriceAnimation: reducedMotion?.matches
      ? LastPriceAnimationMode.Disabled : LastPriceAnimationMode.Continuous });
    updatePulse();
    reducedMotion?.addEventListener("change", updatePulse);
    const theme = () => {
      const ink = themeColor(element, "--color-muted", "#a0aab8");
      const line = themeColor(element, "--color-accent", "#328eff");
      chart.applyOptions({ layout: { textColor: ink }, grid: { horzLines: { color: themeColor(element, "--color-rule", "#293340") } } });
      series.applyOptions({ lineColor: line, topColor: line.replace("rgb(", "rgba(").replace(")", ", 0.22)"), bottomColor: line.replace("rgb(", "rgba(").replace(")", ", 0.08)") });
    };
    theme();
    const observer = new MutationObserver(theme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    chart.timeScale().subscribeVisibleTimeRangeChange(range => {
      if (rangeText.current) rangeText.current.textContent = range && typeof range.from === "number" && typeof range.to === "number"
        ? `${formatDateTime(range.from * 1000)} – ${formatDateTime(range.to * 1000)}` : "";
    });
    chart.subscribeCrosshairMove(event => {
      const item = event.seriesData.get(series);
      const tooltip = hoverText.current;
      if (!tooltip) return;
      if (!event.point || !event.time || typeof event.time !== "number" || !item || !("value" in item)
        || event.point.x < 0 || event.point.y < 0 || event.point.x > element.clientWidth || event.point.y > element.clientHeight) {
        tooltip.style.display = "none";
        return;
      }
      tooltip.textContent = `${formatDateTime(event.time * 1000)}\n${title}: ${formatter(item.value)}`;
      tooltip.style.display = "block";
      tooltip.style.left = `${Math.max(8, Math.min(event.point.x + 12, element.clientWidth - tooltip.offsetWidth - 8))}px`;
      tooltip.style.top = `${Math.max(8, Math.min(event.point.y + 12, element.clientHeight - tooltip.offsetHeight - 8))}px`;
    });
    const begin = () => { dragging.current = true; };
    const end = () => { dragging.current = false; pending.current?.(); pending.current = null; };
    element.addEventListener("pointerdown", begin);
    window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
    return () => {
      reducedMotion?.removeEventListener("change", updatePulse);
      observer.disconnect(); element.removeEventListener("pointerdown", begin);
      window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end);
      pending.current = null; chart.remove(); chartRef.current = null; seriesRef.current = null; priorLast.current = null;
    };
  }, [formatter, title]);
  useEffect(() => {
    const apply = () => {
      const chart = chartRef.current, series = seriesRef.current;
      if (!chart || !series) return;
      const range = chart.timeScale().getVisibleRange();
      const logical = chart.timeScale().getVisibleLogicalRange();
      const following = !range || priorLast.current === null || range.to >= priorLast.current;
      series.setData(data);
      if (data.length) {
        if (following) {
          const slots = logical ? Math.max(2, logical.to - logical.from) : 59;
          chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, data.length - 1 - slots), to: data.length - 1 });
        } else if (range) chart.timeScale().setVisibleRange(range);
      }
      priorLast.current = data.at(-1)?.time ?? null;
    };
    if (dragging.current) pending.current = apply; else apply();
  }, [data]);
  return <div className="tradingview-metric" role="group" aria-label={`${title} Draggable History`}>
    <div ref={container} className="tradingview-canvas" tabIndex={0} aria-label={`${title} Chart`}
      aria-description="Drag horizontally to browse history. Arrow keys pan; End returns to latest. Zoom is disabled."
      onKeyDown={event => {
        const scale = chartRef.current?.timeScale(); const range = scale?.getVisibleLogicalRange();
        if (!scale || !range) return;
        if (event.key === "End") { event.preventDefault(); scale.scrollToRealTime(); }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault(); const move = (range.to - range.from) / 2 * (event.key === "ArrowLeft" ? -1 : 1);
          scale.setVisibleLogicalRange({ from: range.from + move, to: range.to + move });
        }
      }} />
    <div ref={hoverText} className="tradingview-tooltip" role="tooltip" />
    <div className="tradingview-caption" ref={rangeText} />
  </div>;
}
