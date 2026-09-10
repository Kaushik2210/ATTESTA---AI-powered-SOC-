/** A 12-point trend line -- dataviz skill's stat-tile contract: "trend
 * (optional; 12-point sparkline in the de-emphasis hue, current period
 * in the accent)." Text/labels never carry the series color (same
 * skill, marks-and-anatomy.md); this renders no labels at all, only the
 * line + one accent end-dot, which is the sparkline's entire job.
 */
export function Sparkline({ values, width = 64, height = 20 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);

  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * height;
    return [x, y] as const;
  });

  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible" aria-hidden="true">
      <path d={path} fill="none" stroke="var(--attesta-text-tertiary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={4} className="fill-accent-attesta" stroke="var(--attesta-bg-surface-1)" strokeWidth={2} />
    </svg>
  );
}
