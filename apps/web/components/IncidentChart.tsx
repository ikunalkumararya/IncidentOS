"use client";

import { useEffect, useRef, useState } from "react";
import type { TimelineMarker, TimelinePoint } from "@/lib/types";

/**
 * Two small multiples sharing one x-axis.
 *
 * Peak memory and error rate are different measures, so they get one panel
 * each with its own y-scale rather than being forced onto a shared axis —
 * and each panel carries a single series, so the panel title is the label and
 * no legend is needed.
 */
const SERIES = [
  {
    key: "memoryPeak" as const,
    title: "Peak pod memory",
    unit: "% of 2Gi limit",
    color: "var(--color-series-memory)",
    max: 100,
  },
  {
    key: "errorRate" as const,
    title: "HTTP 5xx",
    unit: "% of requests",
    color: "var(--color-series-errors)",
    max: null,
  },
];

const PANEL_HEIGHT = 74;
const PAD_LEFT = 44;
const PAD_RIGHT = 12;
const PAD_TOP = 14;
const PAD_BOTTOM = 18;

export function IncidentChart({
  points,
  markers,
}: {
  points: TimelinePoint[];
  markers: TimelineMarker[];
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

  const plotWidth = Math.max(160, width - PAD_LEFT - PAD_RIGHT);
  const xAt = (index: number) => PAD_LEFT + (index / (points.length - 1)) * plotWidth;
  const indexAt = (px: number) =>
    Math.max(0, Math.min(points.length - 1, Math.round(((px - PAD_LEFT) / plotWidth) * (points.length - 1))));

  const markerIndex = (t: string) => points.findIndex((p) => p.t === t);

  return (
    <div ref={container} className="w-full">
      <svg
        width={width}
        height={SERIES.length * (PANEL_HEIGHT + PAD_TOP) + PAD_BOTTOM}
        role="img"
        aria-label="Peak pod memory and HTTP 5xx rate between 14:00 and 14:45"
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setHover(indexAt(event.clientX - box.left));
        }}
        onMouseLeave={() => setHover(null)}
      >
        {SERIES.map((series, panel) => {
          const top = panel * (PANEL_HEIGHT + PAD_TOP) + PAD_TOP;
          const values = points.map((p) => p[series.key]);
          const max = series.max ?? Math.max(5, Math.ceil(Math.max(...values) / 5) * 5);
          const yAt = (value: number) => top + PANEL_HEIGHT - (value / max) * PANEL_HEIGHT;

          const line = points.map((p, i) => `${i ? "L" : "M"}${xAt(i)},${yAt(p[series.key])}`).join(" ");
          const area = `${line} L${xAt(points.length - 1)},${top + PANEL_HEIGHT} L${xAt(0)},${
            top + PANEL_HEIGHT
          } Z`;

          return (
            <g key={series.key}>
              <text x={0} y={top - 3} fontSize={10} fontWeight={600} fill="var(--color-ink-secondary)">
                {series.title}
                <tspan fill="var(--color-ink-muted)" fontWeight={400}>
                  {"  "}
                  {series.unit}
                </tspan>
              </text>

              {/* Recessive gridlines at 0 and the top of the scale only. */}
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

              <path d={area} fill={series.color} opacity={0.14} />
              <path d={line} fill="none" stroke={series.color} strokeWidth={2} strokeLinejoin="round" />

              {hover !== null && (
                <circle
                  cx={xAt(hover)}
                  cy={yAt(points[hover][series.key])}
                  r={4}
                  fill={series.color}
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                />
              )}
            </g>
          );
        })}

        {/* Annotations carry the narrative: the deploy is the whole story. */}
        {markers.map((marker) => {
          const index = markerIndex(marker.t);
          if (index < 0) return null;
          const x = xAt(index);
          const bottom = SERIES.length * (PANEL_HEIGHT + PAD_TOP);
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
            y2={SERIES.length * (PANEL_HEIGHT + PAD_TOP)}
            stroke="var(--color-ink-muted)"
            strokeWidth={1}
          />
        )}
      </svg>

      <div className="h-8 pt-1 text-[11px]">
        {hover !== null ? (
          <div className="flex items-center gap-4 tabular">
            <span className="text-[var(--color-ink-secondary)]">{points[hover].t}</span>
            {SERIES.map((series) => (
              <span key={series.key} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: series.color }}
                  aria-hidden
                />
                <span className="text-[var(--color-ink-muted)]">{series.title}</span>
                <span className="text-[var(--color-ink)]">{points[hover][series.key]}%</span>
              </span>
            ))}
          </div>
        ) : (
          <span className="text-[var(--color-ink-muted)]">Hover the chart for per-minute values.</span>
        )}
      </div>
    </div>
  );
}
