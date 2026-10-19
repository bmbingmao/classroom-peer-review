import { useEffect, useRef, useState } from 'react';

/**
 * 轻量 SVG 图表（不引 ECharts，包体积少 1MB）：
 *  - BarChart：多对象在某评分项上的均分对比（按容器真实像素画，文字不拉伸）
 *  - RadarChart：单个对象的多维轮廓
 */

function useWidth<T extends HTMLElement>(fallback = 600) {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW(Math.max(240, el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function BarChart({
  labels,
  values,
  max,
  min = 0,
  height = 220,
}: {
  labels: string[];
  values: (number | null)[];
  max: number;
  min?: number;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const pad = { top: 18, right: 10, bottom: 34, left: 42 };
  const innerW = Math.max(60, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const span = max - min || 1;
  const slot = innerW / Math.max(1, labels.length);
  const barW = Math.min(72, slot * 0.52);
  const yOf = (v: number) => pad.top + innerH - ((v - min) / span) * innerH;

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg width={width} height={height} style={{ display: 'block' }}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const v = min + span * t;
          return (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={yOf(v)} y2={yOf(v)} stroke="#e3e7ef" strokeWidth={1} />
              <text x={pad.left - 8} y={yOf(v) + 4} fontSize={11} fill="#8a93a6" textAnchor="end">
                {round(v)}
              </text>
            </g>
          );
        })}
        {labels.map((label, i) => {
          const v = values[i];
          const cx = pad.left + slot * i + slot / 2;
          const x = cx - barW / 2;
          return (
            <g key={label}>
              {v !== null && (
                <>
                  <rect x={x} y={yOf(v)} width={barW} height={Math.max(1, yOf(min) - yOf(v))} rx={4} fill="#2f5bd0" />
                  <text x={cx} y={yOf(v) - 6} fontSize={12} fill="#17203a" textAnchor="middle" fontWeight={600}>
                    {round(v)}
                  </text>
                </>
              )}
              <text x={cx} y={height - 12} fontSize={12} fill="#5b6478" textAnchor="middle">
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function RadarChart({
  axes,
  values,
  max,
  min = 0,
  size = 240,
}: {
  axes: string[];
  values: (number | null)[];
  max: number;
  min?: number;
  size?: number;
}) {
  const n = axes.length;
  if (n < 3) {
    return <div className="muted" style={{ padding: 12 }}>评分项少于 3 个，画不了雷达图（看柱状图就行）</div>;
  }
  const cx = size / 2;
  const cy = size / 2 + 2;
  const r = size * 0.3;
  const span = max - min || 1;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const point = (i: number, ratio: number) => {
    const a = angle(i);
    return [cx + Math.cos(a) * r * ratio, cy + Math.sin(a) * r * ratio] as const;
  };
  const poly = (ratio: number) =>
    axes
      .map((_, i) => point(i, ratio))
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ');

  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: '100%', maxWidth: size, display: 'block', margin: '0 auto' }}>
      {[0.25, 0.5, 0.75, 1].map((ring) => (
        <polygon key={ring} points={poly(ring)} fill="none" stroke="#e3e7ef" strokeWidth={1} />
      ))}
      {axes.map((label, i) => {
        const [x, y] = point(i, 1);
        const [lx, ly] = point(i, 1.22);
        return (
          <g key={label}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke="#eef1f7" strokeWidth={1} />
            <text
              x={lx}
              y={ly}
              fontSize={11}
              fill="#5b6478"
              textAnchor={Math.abs(lx - cx) < 10 ? 'middle' : lx > cx ? 'start' : 'end'}
              dominantBaseline="middle"
            >
              {label}
            </text>
          </g>
        );
      })}
      <polygon
        points={values
          .map((v, i) => point(i, v === null ? 0 : Math.max(0.02, (v - min) / span)))
          .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
          .join(' ')}
        fill="rgba(47,91,208,0.18)"
        stroke="#2f5bd0"
        strokeWidth={2}
      />
      {values.map((v, i) => {
        if (v === null) return null;
        const [x, y] = point(i, Math.max(0.02, (v - min) / span));
        return <circle key={i} cx={x} cy={y} r={3.5} fill="#2f5bd0" />;
      })}
    </svg>
  );
}

function round(v: number) {
  return Math.round(v * 100) / 100;
}
