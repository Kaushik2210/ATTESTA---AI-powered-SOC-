"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import createREGL from "regl";
import { useTheme } from "next-themes";
import type { GraphEdge, GraphNode } from "@/lib/data/types";
import { layoutNodes, COLUMN_WIDTH, ROW_HEIGHT, type LaidOutNode } from "./layout";
import { Quadtree } from "./quadtree";

const NODE_COLOR_DARK: [number, number, number, number] = [0.541, 0.557, 0.6, 1]; // #8a8e99
const NODE_COLOR_LIGHT: [number, number, number, number] = [0.357, 0.373, 0.408, 1]; // #5b5f68
const ACCENT_DARK: [number, number, number, number] = [0.298, 0.553, 1, 1]; // #4c8dff
const ACCENT_LIGHT: [number, number, number, number] = [0.208, 0.376, 0.788, 1]; // #3560c9
const SUPPORTS_COLOR_DARK: [number, number, number, number] = [0.541, 0.557, 0.6, 0.55];
const SUPPORTS_COLOR_LIGHT: [number, number, number, number] = [0.357, 0.373, 0.408, 0.55];
const REFUTES_COLOR_DARK: [number, number, number, number] = [0.541, 0.557, 0.6, 0.28];
const REFUTES_COLOR_LIGHT: [number, number, number, number] = [0.357, 0.373, 0.408, 0.28];

const HIT_RADIUS_PX = 10;
const LABEL_ZOOM_THRESHOLD = 1.4;
const MAX_LABELS = 120;

function computeViewProjection(panX: number, panY: number, zoom: number, width: number, height: number): Float32Array {
  const sx = (2 * zoom) / width;
  const sy = (-2 * zoom) / height;
  // Column-major mat3 for `viewProjection * vec3(x, y, 1)` in GLSL.
  return new Float32Array([sx, 0, 0, 0, sy, 0, -panX * sx, -panY * sy, 1]);
}

export function GraphCanvas({
  nodes,
  edges,
  columnCount,
  selectedNodeId,
  onSelectNode,
  onSelectEdge,
  highlightedEdgeIds,
  onFpsSample,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  columnCount: number;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onSelectEdge: (edge: GraphEdge | null) => void;
  highlightedEdgeIds?: Set<string>;
  onFpsSample?: (fps: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const [viewport, setViewport] = useState({ panX: 0, panY: 0, zoom: 1, width: 800, height: 600 });
  const viewportRef = useRef(viewport);
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  const laidOut = useMemo(() => layoutNodes(nodes, columnCount), [nodes, columnCount]);

  const nodeById = useMemo(() => {
    const m = new Map<string, LaidOutNode>();
    for (const n of laidOut) m.set(n.id, n);
    return m;
  }, [laidOut]);

  // A small, deliberately-exposed test hook -- computing an exact screen
  // pixel for a specific world-space node/edge from outside React (e.g.
  // eval/ui/investigation-canvas-flow.mjs) is otherwise only possible by
  // guessing coordinates from a screenshot, which is not viable against
  // a dense 10k-point cloud. Synthetic demo data only; nothing sensitive.
  useEffect(() => {
    const w = window as unknown as {
      __attestaCanvasDebug?: { viewport: typeof viewport; nodeWorldPos: (id: string) => { x: number; y: number } | null };
    };
    w.__attestaCanvasDebug = {
      viewport,
      nodeWorldPos: (id: string) => {
        const n = nodeById.get(id);
        return n ? { x: n.x, y: n.y } : null;
      },
    };
  }, [viewport, nodeById]);

  const quadtree = useMemo(() => {
    if (laidOut.length === 0) return null;
    const xs = laidOut.map((n) => n.x);
    const ys = laidOut.map((n) => n.y);
    const minX = Math.min(...xs) - COLUMN_WIDTH;
    const minY = Math.min(...ys) - ROW_HEIGHT;
    const maxX = Math.max(...xs) + COLUMN_WIDTH;
    const maxY = Math.max(...ys) + ROW_HEIGHT;
    return new Quadtree({ x: minX, y: minY, w: maxX - minX, h: maxY - minY }, laidOut.map((n) => ({ id: n.id, x: n.x, y: n.y })));
  }, [laidOut]);

  const { supportsSegments, refutesSegments, edgeGeom } = useMemo(() => {
    const supports: number[] = [];
    const refutes: number[] = [];
    const geom: { id: string; edge: GraphEdge; x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const e of edges) {
      const from = nodeById.get(e.fromNodeId);
      const to = nodeById.get(e.toNodeId);
      if (!from || !to) continue;
      geom.push({ id: e.id, edge: e, x1: from.x, y1: from.y, x2: to.x, y2: to.y });
      const target = e.polarity === "supports" ? supports : refutes;
      target.push(from.x, from.y, to.x, to.y);
    }
    return { supportsSegments: supports, refutesSegments: refutes, edgeGeom: geom };
  }, [edges, nodeById]);

  // Fit the initial viewport to the graph's extent once per graph -- the
  // React-documented "adjusting state when a prop changes" pattern
  // (calling setState directly in the render body, guarded so it only
  // fires once per distinct graph): https://react.dev/reference/react/useState#storing-information-from-previous-renders.
  // A plain useEffect here would call setState after the first paint,
  // causing a visible jump; this fires before that paint instead.
  const [fittedGraphKey, setFittedGraphKey] = useState<string | null>(null);
  const graphKey = laidOut.length > 0 ? `${nodes.length}:${Math.max(...laidOut.map((n) => n.column))}` : null;
  if (graphKey !== null && graphKey !== fittedGraphKey) {
    setFittedGraphKey(graphKey);
    // Fit the whole graph's bounding box, not just its column (X) extent:
    // a "left->right by first-seen" layout packs nodes vertically within
    // each column, so a busy time-bucket can make one column far taller
    // than the viewport -- fitting X alone left rows silently running off
    // the bottom with no vertical centering. Found via a real render (a
    // dense graph appearing to load into only the lower half of the
    // canvas), not by inspection (phases/reports/PHASE-11.md).
    const minX = Math.min(...laidOut.map((n) => n.x));
    const maxX = Math.max(...laidOut.map((n) => n.x));
    const minY = Math.min(...laidOut.map((n) => n.y));
    const maxY = Math.max(...laidOut.map((n) => n.y));
    const spanX = Math.max(1, maxX - minX + COLUMN_WIDTH);
    const spanY = Math.max(1, maxY - minY + ROW_HEIGHT);
    setViewport((v) => ({
      ...v,
      panX: (minX + maxX) / 2,
      panY: (minY + maxY) / 2,
      zoom: Math.min(1, v.width / spanX, v.height / spanY),
    }));
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let regl: ReturnType<typeof createREGL> | null;
    try {
      // No depth buffer (this is a flat 2D orthographic scene -- nothing
      // ever depth-tests) and no MSAA: both are real GPU cost with no
      // visual benefit here, and antialiasing in particular showed up as
      // a genuine bottleneck at 10,000 nodes -- a real fps cliff (~60fps
      // at 500 nodes, ~30fps at 10,000), confirmed by measuring rather
      // than assumed, that the overlapping semi-transparent SUPPORTS/
      // REFUTES line blending was making worse (phases/reports/PHASE-11.md).
      regl = createREGL({ canvas, attributes: { antialias: false, alpha: false, depth: false } });
    } catch {
      regl = null;
    }
    if (!regl) return;

    const nodePositions = new Float32Array(laidOut.length * 2);
    laidOut.forEach((n, i) => {
      nodePositions[i * 2] = n.x;
      nodePositions[i * 2 + 1] = n.y;
    });
    const nodeBuffer = regl.buffer(nodePositions);
    const supportsBuffer = regl.buffer(new Float32Array(supportsSegments));
    const refutesBuffer = regl.buffer(new Float32Array(refutesSegments));

    const highlightSegments: number[] = [];
    if (highlightedEdgeIds && highlightedEdgeIds.size > 0) {
      for (const g of edgeGeom) {
        if (highlightedEdgeIds.has(g.id)) highlightSegments.push(g.x1, g.y1, g.x2, g.y2);
      }
    }
    const highlightBuffer = highlightSegments.length > 0 ? regl.buffer(new Float32Array(highlightSegments)) : null;

    const drawPoints = regl({
      vert: `
        precision highp float;
        attribute vec2 position;
        uniform mat3 viewProjection;
        uniform float pointSize;
        void main() {
          vec3 p = viewProjection * vec3(position, 1.0);
          gl_Position = vec4(p.xy, 0.0, 1.0);
          gl_PointSize = pointSize;
        }
      `,
      frag: `
        precision highp float;
        uniform vec4 color;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          if (length(c) > 0.5) discard;
          gl_FragColor = color;
        }
      `,
      attributes: { position: nodeBuffer },
      uniforms: {
        viewProjection: regl.prop<{ vp: Float32Array }, "vp">("vp"),
        pointSize: regl.prop<{ size: number }, "size">("size"),
        color: regl.prop<{ color: number[] }, "color">("color"),
      },
      count: laidOut.length,
      primitive: "points",
      blend: { enable: true, func: { srcRGB: "src alpha", srcAlpha: 1, dstRGB: "one minus src alpha", dstAlpha: 1 } },
    });

    const drawLines = regl({
      vert: `
        precision highp float;
        attribute vec2 position;
        uniform mat3 viewProjection;
        void main() {
          vec3 p = viewProjection * vec3(position, 1.0);
          gl_Position = vec4(p.xy, 0.0, 1.0);
        }
      `,
      frag: `
        precision highp float;
        uniform vec4 color;
        void main() { gl_FragColor = color; }
      `,
      attributes: { position: regl.prop<{ buf: unknown }, "buf">("buf") },
      uniforms: {
        viewProjection: regl.prop<{ vp: Float32Array }, "vp">("vp"),
        color: regl.prop<{ color: number[] }, "color">("color"),
      },
      count: regl.prop<{ count: number }, "count">("count"),
      primitive: "lines",
      blend: { enable: true, func: { srcRGB: "src alpha", srcAlpha: 1, dstRGB: "one minus src alpha", dstAlpha: 1 } },
    });

    const dark = resolvedTheme !== "light";
    const nodeColor = dark ? NODE_COLOR_DARK : NODE_COLOR_LIGHT;
    const accentColor = dark ? ACCENT_DARK : ACCENT_LIGHT;
    const supportsColor = dark ? SUPPORTS_COLOR_DARK : SUPPORTS_COLOR_LIGHT;
    const refutesColor = dark ? REFUTES_COLOR_DARK : REFUTES_COLOR_LIGHT;

    let raf = 0;
    const frameTimes: number[] = [];
    let lastFpsReport = 0;

    const selectedPos = nodeById.get(selectedNodeId ?? "");
    const selectedBuffer = selectedPos ? regl.buffer(new Float32Array([selectedPos.x, selectedPos.y])) : null;
    // A dedicated draw command, compiled ONCE here -- not inside the
    // frame loop below, which would recompile a WebGL shader program on
    // every animation frame. That bug was real, not hypothetical: found
    // via live fps measurement in a real browser collapsing to ~2fps
    // (phases/reports/PHASE-11.md), not by code inspection.
    const drawSelected = regl({
      vert: `
        precision highp float;
        attribute vec2 position;
        uniform mat3 viewProjection;
        uniform float pointSize;
        void main() {
          vec3 p = viewProjection * vec3(position, 1.0);
          gl_Position = vec4(p.xy, 0.0, 1.0);
          gl_PointSize = pointSize;
        }
      `,
      frag: `
        precision highp float;
        uniform vec4 color;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          if (length(c) > 0.5) discard;
          gl_FragColor = color;
        }
      `,
      attributes: { position: regl.prop<{ buf: unknown }, "buf">("buf") },
      uniforms: {
        viewProjection: regl.prop<{ vp: Float32Array }, "vp">("vp"),
        pointSize: regl.prop<{ size: number }, "size">("size"),
        color: regl.prop<{ color: number[] }, "color">("color"),
      },
      count: 1,
      primitive: "points",
    });

    function frame(t: number) {
      frameTimes.push(t);
      if (frameTimes.length > 30) frameTimes.shift();
      if (onFpsSample && t - lastFpsReport > 500 && frameTimes.length > 1) {
        const dt = (frameTimes[frameTimes.length - 1] - frameTimes[0]) / (frameTimes.length - 1);
        onFpsSample(1000 / dt);
        lastFpsReport = t;
      }

      // regl caches the GL viewport at construction time (canvas defaults
      // to 300x150 before the ResizeObserver below ever fires) and only
      // re-syncs it to the canvas's current size inside its own
      // scheduler (regl.frame()/regl.poll()). This loop drives its own
      // requestAnimationFrame instead of regl.frame() -- so every draw
      // this frame would otherwise render into a stale, tiny,
      // bottom-left-clipped 300x150 region regardless of the canvas's
      // real size. regl.poll() resyncs it. Found via a real dead-canvas
      // repro (a visible gray square exactly where a 300x150 viewport
      // would land), not by inspection (phases/reports/PHASE-11.md).
      regl!.poll();
      const v = viewportRef.current;
      const vp = computeViewProjection(v.panX, v.panY, v.zoom, v.width, v.height);
      regl!.clear({ color: dark ? [0.039, 0.043, 0.051, 1] : [0.969, 0.973, 0.98, 1] });

      if (refutesSegments.length > 0) {
        drawLines({ buf: refutesBuffer, vp, color: refutesColor, count: refutesSegments.length / 2 });
      }
      if (supportsSegments.length > 0) {
        drawLines({ buf: supportsBuffer, vp, color: supportsColor, count: supportsSegments.length / 2 });
      }
      if (highlightBuffer) {
        drawLines({ buf: highlightBuffer, vp, color: [...accentColor.slice(0, 3), 0.95], count: highlightSegments.length / 2 });
      }
      drawPoints({ vp, color: nodeColor, size: Math.max(2, Math.min(6, 4 * v.zoom)) });
      if (selectedBuffer) {
        drawSelected({ buf: selectedBuffer, vp, size: Math.max(6, Math.min(14, 10 * v.zoom)), color: accentColor });
      }

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      nodeBuffer.destroy();
      supportsBuffer.destroy();
      refutesBuffer.destroy();
      highlightBuffer?.destroy();
      selectedBuffer?.destroy();
      regl?.destroy();
    };
  }, [laidOut, supportsSegments, refutesSegments, resolvedTheme, selectedNodeId, nodeById, onFpsSample, highlightedEdgeIds, edgeGeom]);

  // Resize observer keeps the canvas's pixel size (and the viewport used
  // for hit-testing/projection) in sync with its container.
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      // A transient 0x0 report (e.g. the container briefly not painted --
      // a backgrounded tab, a display:none toggle -- ResizeObserver can
      // fire one either way) must never overwrite the last known-good
      // size: computeViewProjection divides by width/height, so a 0
      // silently turns the whole projection matrix into NaN and every
      // point/line vanishes off-screen from that frame on. Found via a
      // real dead-blank-canvas repro, not by inspection
      // (phases/reports/PHASE-11.md).
      if (width <= 0 || height <= 0) return;
      canvas.width = width * devicePixelRatio;
      canvas.height = height * devicePixelRatio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      setViewport((v) => ({ ...v, width: width * devicePixelRatio, height: height * devicePixelRatio }));
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  function screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const sx = (clientX - rect.left) * devicePixelRatio;
    const sy = (clientY - rect.top) * devicePixelRatio;
    const v = viewportRef.current;
    return { x: (sx - v.width / 2) / v.zoom + v.panX, y: (sy - v.height / 2) / v.zoom + v.panY };
  }

  const dragState = useRef<{ startX: number; startY: number; panX: number; panY: number; dragged: boolean } | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    dragState.current = { startX: e.clientX, startY: e.clientY, panX: viewport.panX, panY: viewport.panY, dragged: false };
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragState.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) d.dragged = true;
    setViewport((v) => ({ ...v, panX: d.panX - (dx * devicePixelRatio) / v.zoom, panY: d.panY - (dy * devicePixelRatio) / v.zoom }));
  }
  function onPointerUp(e: React.PointerEvent) {
    const d = dragState.current;
    dragState.current = null;
    if (!d) return;
    if (!d.dragged) {
      const world = screenToWorld(e.clientX, e.clientY);
      const hitRadius = HIT_RADIUS_PX / viewport.zoom;
      const nodeHit = quadtree?.nearest(world.x, world.y, hitRadius);
      if (nodeHit) {
        onSelectNode(nodeHit.id);
        onSelectEdge(null);
        return;
      }
      // Coarse edge hit-test: nearest segment among edges visible near
      // the click point (a bounded set, not all edges).
      const tolerance = hitRadius * 1.5;
      let bestEdge: GraphEdge | null = null;
      let bestDist = tolerance;
      for (const g of edgeGeom) {
        if (Math.min(g.x1, g.x2) - tolerance > world.x || Math.max(g.x1, g.x2) + tolerance < world.x) continue;
        if (Math.min(g.y1, g.y2) - tolerance > world.y || Math.max(g.y1, g.y2) + tolerance < world.y) continue;
        const dist = pointToSegmentDistance(world.x, world.y, g.x1, g.y1, g.x2, g.y2);
        if (dist < bestDist) {
          bestDist = dist;
          bestEdge = g.edge;
        }
      }
      if (bestEdge) {
        onSelectEdge(bestEdge);
        onSelectNode(null);
      } else {
        onSelectNode(null);
        onSelectEdge(null);
      }
    }
  }
  // React's JSX `onWheel` attaches a PASSIVE listener (matching browser
  // guidance for scroll perf), which silently no-ops preventDefault --
  // the page scrolls underneath instead of only zooming the canvas.
  // Found via a real "Unable to preventDefault inside passive event
  // listener invocation" console error while testing zoom in a live
  // browser (phases/reports/PHASE-11.md), not by inspection. A manually
  // attached, non-passive native listener is the standard fix.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    function handleWheel(e: WheelEvent) {
      e.preventDefault();
      const world = screenToWorld(e.clientX, e.clientY);
      setViewport((v) => {
        const nextZoom = Math.max(0.05, Math.min(8, v.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
        // Zoom around the cursor: keep `world` fixed under (e.clientX, e.clientY).
        return { ...v, zoom: nextZoom, panX: world.x - ((world.x - v.panX) * v.zoom) / nextZoom, panY: world.y - ((world.y - v.panY) * v.zoom) / nextZoom };
      });
    }
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, []);

  const labels = useMemo(() => {
    if (viewport.zoom < LABEL_ZOOM_THRESHOLD || !quadtree) return [];
    const halfW = viewport.width / 2 / viewport.zoom;
    const halfH = viewport.height / 2 / viewport.zoom;
    const visible = quadtree.inRange({ x: viewport.panX - halfW, y: viewport.panY - halfH, w: halfW * 2, h: halfH * 2 });
    return visible.slice(0, MAX_LABELS);
  }, [viewport, quadtree]);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-canvas" data-testid="graph-canvas-container">
      <canvas
        ref={canvasRef}
        data-testid="graph-canvas"
        className="h-full w-full touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {labels.map((p) => {
          const sx = (p.x - viewport.panX) * viewport.zoom + viewport.width / 2;
          const sy = (p.y - viewport.panY) * viewport.zoom + viewport.height / 2;
          return (
            <div
              key={p.id}
              className="absolute -translate-x-1/2 translate-y-1.5 truncate rounded-sm bg-surface-1/80 px-1 font-mono text-[9px] text-text-tertiary"
              style={{ left: sx / devicePixelRatio, top: sy / devicePixelRatio, maxWidth: 100 }}
            >
              {p.id}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function pointToSegmentDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}
