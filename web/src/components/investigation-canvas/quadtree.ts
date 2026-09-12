/** A minimal 2D point quadtree for hit-testing against up to 10,000
 * graph nodes -- docs/UI-SPEC.md's Investigation Canvas requires
 * "quadtree hit-testing" explicitly rather than a linear scan per
 * click, since a linear scan of 10,000 world-space points on every
 * click (and, worse, on hover) is the kind of thing that stays "fine in
 * testing" and then isn't. Point-only (no rectangles): every graph node
 * is a single (x, y) with an id, which is all this canvas ever needs to
 * pick.
 */

export interface QuadPoint {
  id: string;
  x: number;
  y: number;
}

interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MAX_POINTS_PER_NODE = 8;
const MAX_DEPTH = 12;

class QuadNode {
  bounds: Bounds;
  points: QuadPoint[] = [];
  children: QuadNode[] | null = null;
  depth: number;

  constructor(bounds: Bounds, depth: number) {
    this.bounds = bounds;
    this.depth = depth;
  }

  private subdivide() {
    const { x, y, w, h } = this.bounds;
    const hw = w / 2;
    const hh = h / 2;
    this.children = [
      new QuadNode({ x, y, w: hw, h: hh }, this.depth + 1),
      new QuadNode({ x: x + hw, y, w: hw, h: hh }, this.depth + 1),
      new QuadNode({ x, y: y + hh, w: hw, h: hh }, this.depth + 1),
      new QuadNode({ x: x + hw, y: y + hh, w: hw, h: hh }, this.depth + 1),
    ];
    for (const p of this.points) this.insertIntoChildren(p);
    this.points = [];
  }

  private insertIntoChildren(p: QuadPoint) {
    for (const c of this.children!) {
      if (contains(c.bounds, p)) {
        c.insert(p);
        return;
      }
    }
  }

  insert(p: QuadPoint) {
    if (!contains(this.bounds, p)) return;
    if (this.children) {
      this.insertIntoChildren(p);
      return;
    }
    this.points.push(p);
    if (this.points.length > MAX_POINTS_PER_NODE && this.depth < MAX_DEPTH) {
      this.subdivide();
    }
  }

  /** Collects every point within `bounds` into `out`. */
  queryRange(bounds: Bounds, out: QuadPoint[]) {
    if (!intersects(this.bounds, bounds)) return;
    if (this.children) {
      for (const c of this.children) c.queryRange(bounds, out);
      return;
    }
    for (const p of this.points) {
      if (p.x >= bounds.x && p.x <= bounds.x + bounds.w && p.y >= bounds.y && p.y <= bounds.y + bounds.h) {
        out.push(p);
      }
    }
  }
}

function contains(b: Bounds, p: { x: number; y: number }): boolean {
  return p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h;
}

function intersects(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export class Quadtree {
  private root: QuadNode;

  constructor(bounds: Bounds, points: QuadPoint[]) {
    this.root = new QuadNode(bounds, 0);
    for (const p of points) this.root.insert(p);
  }

  /** Nearest point to (x, y) within `radius` world units, or null. */
  nearest(x: number, y: number, radius: number): QuadPoint | null {
    const candidates: QuadPoint[] = [];
    this.root.queryRange({ x: x - radius, y: y - radius, w: radius * 2, h: radius * 2 }, candidates);
    let best: QuadPoint | null = null;
    let bestDistSq = radius * radius;
    for (const p of candidates) {
      const dx = p.x - x;
      const dy = p.y - y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= bestDistSq) {
        best = p;
        bestDistSq = distSq;
      }
    }
    return best;
  }

  /** Every point inside a screen/world-space rectangle -- viewport
   * culling for the label-overlay and hit-testing loops. */
  inRange(bounds: Bounds): QuadPoint[] {
    const out: QuadPoint[] = [];
    this.root.queryRange(bounds, out);
    return out;
  }
}
