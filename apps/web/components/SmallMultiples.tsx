"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Shared small-multiples SVG chart: one titled panel per series, its own
 * y-scale, sharing one x-axis. AttackChart and IncidentChart are thin
 * wrappers over this with their own series configs; LiveHealthChart composes
 * two blocks of it (auth series, system-health series).
 *
 * `visibleCount` slices which points are actually drawn (for progressive
 * reveal during a live run) while the x-axis domain and each series' y max
 * are still computed from the FULL point array — otherwise the chart would
 * rescale under the viewer as more of the run completes, which reads as the
 * data changing rather than more of it becoming visible.
 */
export interface SmallMultiplesPoint {
  t: string;
}

export interface SmallMultiplesSeries<T extends SmallMultiplesPoint = SmallMultiplesPoint> {
  key: keyof T & string;
  title: string;
  unit: string;
  color: string;
  /** Fixed y max (e.g. a 0-100% scale). Omit to derive one from the data. */
  max?: number | null;
  formatValue?: (value: number) => string;
}

const PAD_LEFT = 44;
const PAD_RIGHT = 12;
const PAD_TOP = 14;
const PAD_BOTTOM = 18;

export function SmallMultiples<T extends SmallMultiplesPoint>({
  series,
  points,
  markers = [],
  visibleCount,
  panelHeight = 64,
  ariaLabel,
}: {
  series: SmallMultiplesSeries<T>[];
  points: T[];
  markers?: { t: string; label: string }[];
  /** Number of leading points to draw; defaults to all of them. */
  visibleCount?: number;
  panelHeight?: number;
  ariaLabel: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (!points.length) {
    return <div ref={container} className="h-40" />;
  }

  const shown = Math.max(0, Math.min(points.length, visibleCount ?? points.length));
  const plotWidth = Math.max(160, width - PAD_LEFT - PAD_RIGHT);
  const domainLength = Math.max(1, points.length - 1);
  const xAt = (index: number) => PAD_LEFT + (index / domainLength) * plotWidth;
  const indexAt = (px: number) =>
    Math.max(0, Math.min(shown - 1, Math.round(((px - PAD_LEFT) / plotWidth) * domainLength)));
  const markerIndex = (t: string) => points.findIndex((p) => p.t === t);

  return (
    <div ref={container} className="w-full">
      <svg
        width={width}
        height={series.length * (panelHeight + PAD_TOP) + PAD_BOTTOM}
        role="img"
        aria-label={ariaLabel}
        onMouseMove={(event) => {
          if (shown < 2) return;
          const box = event.currentTarget.getBoundingClientRect();
          setHover(indexAt(event.clientX - box.left));
        }}
        onMouseLeave={() => setHover(null)}
      >
        {series.map((s, panel) => {
          const top = panel * (panelHeight + PAD_TOP) + PAD_TOP;
          const allValues = points
            .map((p) => p[s.key] as unknown as number | null)
            .filter((v): v is number => typeof v === "number");
          const max = s.max ?? Math.max(10, Math.ceil((Math.max(0, ...allValues) || 10) / 5) * 5);
          const yAt = (value: number) => top + panelHeight - (value / max) * panelHeight;

          // Break the line at gaps (null values) instead of interpolating
          // across them — a gap in the fixture means "no reading", not zero.
          const segments: { x: number; y: number }[][] = [];
          let current: { x: number; y: number }[] = [];
          for (let i = 0; i < shown; i++) {
            const value = points[i][s.key] as unknown as number | null;
            if (typeof value !== "number") {
              if (current.length) segments.push(current);
              current = [];
              continue;
            }
            current.push({ x: xAt(i), y: yAt(value) });
          }
          if (current.length) segments.push(current);

          const hoverValue = hover !== null ? (points[hover]?.[s.key] as unknown as number | null) : null;

          return (
            <g key={s.key}>
              <text x={0} y={top - 3} fontSize={10} fontWeight={600} fill="var(--color-ink-secondary)">
                {s.title}
                <tspan fill="var(--color-ink-muted)" fontWeight={400}>
                  {"  "}
                  {s.unit}
                </tspan>
              </text>

              {[0, max].map((value) => (
                <g key={value}>
                  <line
                    x1={PAD_LEFT}
                    x2={PAD_LEFT + plotWidth}
                    y1={yAt(value)}
                    y2={yAt(value)}
                    stroke={value === 0 ? "var(--color-baseline)" : "var(--color-gridline)"}
                    strokeWidth={1}
                  />
                  <text
                    x={PAD_LEFT - 6}
                    y={yAt(value) + 3}
                    fontSize={9}
                    textAnchor="end"
                    fill="var(--color-ink-muted)"
                    className="tabular"
                  >
                    {value}
                  </text>
                </g>
              ))}

              {segments.map((segment, i) => {
                if (segment.length < 2) return null;
                const line = segment.map((p, j) => `${j ? "L" : "M"}${p.x},${p.y}`).join(" ");
                const area = `${line} L${segment[segment.length - 1].x},${top + panelHeight} L${segment[0].x},${
                  top + panelHeight
                } Z`;
                return (
                  <g key={i}>
                    <path d={area} fill={s.color} opacity={0.14} />
                    <path d={line} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
                  </g>
                );
              })}

              {hover !== null && typeof hoverValue === "number" && (
                <circle
                  cx={xAt(hover)}
                  cy={yAt(hoverValue)}
                  r={4}
                  fill={s.color}
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                />
              )}
            </g>
          );
        })}

        {markers.map((marker) => {
          const index = markerIndex(marker.t);
          if (index < 0 || index >= shown) return null;
          const x = xAt(index);
          const bottom = series.length * (panelHeight + PAD_TOP);
          return (
            <g key={marker.t}>
              <line
                x1={x}
                x2={x}
                y1={PAD_TOP - 6}
                y2={bottom}
                stroke="var(--color-baseline)"
                strokeWidth={1}
                strokeDasharray="2 3"
              />
              <text
                x={x + 3}
                y={bottom + 12}
                fontSize={9}
                fill="var(--color-ink-muted)"
                textAnchor={index > points.length - 6 ? "end" : "start"}
              >
                {marker.t} {marker.label}
              </text>
            </g>
          );
        })}

        {hover !== null && (
          <line
            x1={xAt(hover)}
            x2={xAt(hover)}
            y1={PAD_TOP - 6}
            y2={series.length * (panelHeight + PAD_TOP)}
            stroke="var(--color-ink-muted)"
            strokeWidth={1}
          />
        )}
      </svg>

      <div className="h-8 pt-1 text-[11px]">
        {hover !== null ? (
          <div className="flex flex-wrap items-center gap-4 tabular">
            <span className="text-[var(--color-ink-secondary)]">{points[hover].t}</span>
            {series.map((s) => {
              const value = points[hover][s.key] as unknown as number | null;
              const format = s.formatValue ?? ((v: number) => String(v));
              return (
                <span key={s.key} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: s.color }}
                    aria-hidden
                  />
                  <span className="text-[var(--color-ink-muted)]">{s.title}</span>
                  <span className="text-[var(--color-ink)]">
                    {typeof value === "number" ? format(value) : "—"}
                  </span>
                </span>
              );
            })}
          </div>
        ) : (
          <span className="text-[var(--color-ink-muted)]">Hover the chart for per-minute values.</span>
        )}
      </div>
    </div>
  );
}
