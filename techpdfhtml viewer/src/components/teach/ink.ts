export type Pt = { x: number; y: number };

export type Stroke = {
  type: "stroke";
  points: Pt[];
  color: string;
  width: number;
  opacity: number;
  highlight?: boolean;
};

export type LineObj = {
  type: "line" | "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  opacity: number;
};

export type ShapeObj = {
  type: "rect" | "circle" | "triangle";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  width: number;
  opacity: number;
};

export type TextObj = {
  type: "text";
  x: number;
  y: number;
  text: string;
  fontSize: number;
  color: string;
  opacity: number;
};

export type EraseObj = {
  type: "erase";
  points: Pt[];
  width: number;
};

export type DrawObj = Stroke | LineObj | ShapeObj | TextObj | EraseObj;

export type MediaObj = {
  id: string;
  kind: "image" | "video";
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
};

export const COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#a855f7",
  "#111111",
  "#ffffff",
] as const;

export function colorName(c: string) {
  if (c === "#111111") return "Black";
  if (c === "#ffffff") return "White";
  return `Color ${c}`;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function strokeCommands(points: Pt[]) {
  if (!points.length) return "";
  if (points.length === 1) {
    return `M ${r2(points[0].x)} ${r2(points[0].y)} l 0.2 0.2`;
  }
  let d = `M ${r2(points[0].x)} ${r2(points[0].y)}`;
  if (points.length === 2) {
    return `${d} L ${r2(points[1].x)} ${r2(points[1].y)}`;
  }
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2;
    const my = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${r2(points[i].x)} ${r2(points[i].y)} ${r2(mx)} ${r2(my)}`;
  }
  const last = points[points.length - 1];
  d += ` L ${r2(last.x)} ${r2(last.y)}`;
  return d;
}

export function boundsOf(o: DrawObj) {
  if (o.type === "stroke") {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of o.points) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    const pad = o.width;
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  }
  if (o.type === "text") {
    const w = Math.max(24, o.text.length * o.fontSize * 0.56);
    return { x0: o.x, y0: o.y - o.fontSize, x1: o.x + w, y1: o.y };
  }
  if (o.type === "erase") {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of o.points) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    const pad = o.width;
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  }
  if (o.type === "line" || o.type === "arrow") {
    return {
      x0: Math.min(o.x1, o.x2),
      y0: Math.min(o.y1, o.y2),
      x1: Math.max(o.x1, o.x2),
      y1: Math.max(o.y1, o.y2),
    };
  }
  return {
    x0: Math.min(o.x, o.x + o.w),
    y0: Math.min(o.y, o.y + o.h),
    x1: Math.max(o.x, o.x + o.w),
    y1: Math.max(o.y, o.y + o.h),
  };
}

function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  if (len === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function hitObj(o: DrawObj, x: number, y: number, radius: number) {
  if (o.type === "stroke") {
    const reach = radius + o.width * 0.5;
    const pts = o.points;
    if (pts.length === 1) return Math.hypot(pts[0].x - x, pts[0].y - y) <= reach;
    for (let i = 1; i < pts.length; i++) {
      if (distToSeg(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= reach) return true;
    }
    return false;
  }
  if (o.type === "erase") {
    const reach = radius + o.width * 0.5;
    const pts = o.points;
    if (pts.length === 1) return Math.hypot(pts[0].x - x, pts[0].y - y) <= reach;
    for (let i = 1; i < pts.length; i++) {
      if (distToSeg(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= reach) return true;
    }
    return false;
  }
  if (o.type === "line" || o.type === "arrow") {
    return distToSeg(x, y, o.x1, o.y1, o.x2, o.y2) <= radius + o.width;
  }
  const b = boundsOf(o);
  return x >= b.x0 - radius && x <= b.x1 + radius && y >= b.y0 - radius && y <= b.y1 + radius;
}

function strokePoints(ctx: CanvasRenderingContext2D, points: Pt[]) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  if (points.length === 1) ctx.lineTo(points[0].x + 0.2, points[0].y + 0.2);
  ctx.stroke();
}

function triangleVertices(x: number, y: number, w: number, h: number): [Pt, Pt, Pt] {
  // Apex at top-center, base along the bottom of the bounding box.
  const x0 = Math.min(x, x + w);
  const y0 = Math.min(y, y + h);
  const x1 = Math.max(x, x + w);
  const y1 = Math.max(y, y + h);
  return [
    { x: (x0 + x1) / 2, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

export function drawObj(ctx: CanvasRenderingContext2D, o: DrawObj) {
  if (o.type === "erase") {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = 1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = o.width;
    strokePoints(ctx, o.points);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = Math.max(0.05, Math.min(1, o.opacity));
  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;
  ctx.lineWidth = o.type === "text" ? 1 : o.width;
  if (o.type === "stroke") {
    const path = new Path2D(strokeCommands(o.points));
    ctx.stroke(path);
  } else if (o.type === "line" || o.type === "arrow") {
    ctx.beginPath();
    ctx.moveTo(o.x1, o.y1);
    ctx.lineTo(o.x2, o.y2);
    ctx.stroke();
    if (o.type === "arrow") {
      const a = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
      const len = Math.max(14, o.width * 4);
      ctx.beginPath();
      ctx.moveTo(o.x2, o.y2);
      ctx.lineTo(o.x2 - len * Math.cos(a - 0.42), o.y2 - len * Math.sin(a - 0.42));
      ctx.moveTo(o.x2, o.y2);
      ctx.lineTo(o.x2 - len * Math.cos(a + 0.42), o.y2 - len * Math.sin(a + 0.42));
      ctx.stroke();
    }
  } else if (o.type === "rect") {
    ctx.strokeRect(o.x, o.y, o.w, o.h);
  } else if (o.type === "circle") {
    ctx.beginPath();
    ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, Math.abs(o.w / 2), Math.abs(o.h / 2), 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (o.type === "triangle") {
    const [a, b, c] = triangleVertices(o.x, o.y, o.w, o.h);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.closePath();
    ctx.stroke();
  } else if (o.type === "text") {
    ctx.globalAlpha = o.opacity;
    ctx.font = `${o.fontSize}px "Source Sans 3", sans-serif`;
    ctx.fillText(o.text, o.x, o.y);
  }
  ctx.restore();
}

function xmlText(s: string) {
  return s
    .replaceAll("&", "&" + "amp;")
    .replaceAll("<", "&" + "lt;")
    .replaceAll(">", "&" + "gt;");
}

export function objSvg(o: DrawObj) {
  if (o.type === "erase") return "";
  const op = r2(o.opacity);
  if (o.type === "stroke") {
    return `<path d="${strokeCommands(o.points)}" fill="none" stroke="${o.color}" stroke-width="${r2(o.width)}" stroke-linecap="round" stroke-linejoin="round" opacity="${op}"/>`;
  }
  if (o.type === "line") {
    return `<line x1="${r2(o.x1)}" y1="${r2(o.y1)}" x2="${r2(o.x2)}" y2="${r2(o.y2)}" stroke="${o.color}" stroke-width="${r2(o.width)}" stroke-linecap="round" opacity="${op}"/>`;
  }
  if (o.type === "arrow") {
    const a = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
    const len = Math.max(14, o.width * 4);
    const x3 = o.x2 - len * Math.cos(a - 0.42);
    const y3 = o.y2 - len * Math.sin(a - 0.42);
    const x4 = o.x2 - len * Math.cos(a + 0.42);
    const y4 = o.y2 - len * Math.sin(a + 0.42);
    return `<path d="M ${r2(o.x1)} ${r2(o.y1)} L ${r2(o.x2)} ${r2(o.y2)} M ${r2(o.x2)} ${r2(o.y2)} L ${r2(x3)} ${r2(y3)} M ${r2(o.x2)} ${r2(o.y2)} L ${r2(x4)} ${r2(y4)}" fill="none" stroke="${o.color}" stroke-width="${r2(o.width)}" stroke-linecap="round" opacity="${op}"/>`;
  }
  if (o.type === "rect") {
    return `<rect x="${r2(Math.min(o.x, o.x + o.w))}" y="${r2(Math.min(o.y, o.y + o.h))}" width="${r2(Math.abs(o.w))}" height="${r2(Math.abs(o.h))}" fill="none" stroke="${o.color}" stroke-width="${r2(o.width)}" opacity="${op}"/>`;
  }
  if (o.type === "circle") {
    return `<ellipse cx="${r2(o.x + o.w / 2)}" cy="${r2(o.y + o.h / 2)}" rx="${r2(Math.abs(o.w / 2))}" ry="${r2(Math.abs(o.h / 2))}" fill="none" stroke="${o.color}" stroke-width="${r2(o.width)}" opacity="${op}"/>`;
  }
  if (o.type === "triangle") {
    const [a, b, c] = triangleVertices(o.x, o.y, o.w, o.h);
    return `<polygon points="${r2(a.x)},${r2(a.y)} ${r2(b.x)},${r2(b.y)} ${r2(c.x)},${r2(c.y)}" fill="none" stroke="${o.color}" stroke-width="${r2(o.width)}" opacity="${op}"/>`;
  }
  return `<text x="${r2(o.x)}" y="${r2(o.y)}" fill="${o.color}" font-size="${r2(o.fontSize)}" font-family="Source Sans 3, sans-serif" opacity="${op}">${xmlText(o.text)}</text>`;
}

/* --------------------------------------------------------------------------
   SHAPE DETECTION — rewritten from scratch.

   Detection order:
     1. Line / Arrow  (open, straight)
     2. Triangle      (closed, 3 corners)
     3. Rectangle     (closed, 4 corners, points hug bbox perimeter)
     4. Circle        (closed, points on an ellipse, high aspect ratio)

   Correct order matters: a hand-drawn rectangle can look like a
   squashed circle, and a hand-drawn triangle can look like both. We
   test corners first because they are the most distinguishing feature.
   -------------------------------------------------------------------------- */

type B = { x0: number; y0: number; x1: number; y1: number };

function bbox(points: Pt[]): B {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

/** Returns the indices of points where the direction changes sharply. */
function cornerIndices(points: Pt[], threshold: number): number[] {
  const idx: number[] = [];
  if (points.length < 5) return idx;
  const step = Math.max(2, Math.floor(points.length / 40));
  let prevAng: number | null = null;
  for (let i = step; i < points.length - step; i += step) {
    const a = Math.atan2(
      points[i].y - points[i - step].y,
      points[i].x - points[i - step].x,
    );
    if (prevAng !== null) {
      let d = Math.abs(a - prevAng);
      if (d > Math.PI) d = Math.PI * 2 - d;
      if (d > threshold) idx.push(i);
    }
    prevAng = a;
  }
  // Merge corner indices that are close together (same corner counted twice).
  const merged: number[] = [];
  for (const i of idx) {
    if (!merged.length || i - merged[merged.length - 1] > step * 2) merged.push(i);
  }
  return merged;
}

/**
 * Tests a stroke against a shape defined by corner points.
 * Returns the mean distance from each stroke point to the nearest edge,
 * normalized by the shape's diagonal (so 0 = perfect fit).
 */
function fitToPolygon(points: Pt[], corners: Pt[]): number {
  const n = corners.length;
  let total = 0;
  for (const p of points) {
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % n];
      best = Math.min(best, distToSeg(p.x, p.y, a.x, a.y, b.x, b.y));
    }
    total += best;
  }
  const diag = Math.hypot(
    Math.max(...corners.map((c) => c.x)) - Math.min(...corners.map((c) => c.x)),
    Math.max(...corners.map((c) => c.y)) - Math.min(...corners.map((c) => c.y)),
  ) || 1;
  return total / points.length / diag;
}

export function snapShape(
  points: Pt[],
  style: { color: string; width: number; opacity: number },
): DrawObj | null {
  if (points.length < 8) return null;

  // Total arc length — a stray dot should not become a shape.
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  if (length < 40) return null;

  const b = bbox(points);
  const bw = b.x1 - b.x0;
  const bh = b.y1 - b.y0;
  const diag = Math.hypot(bw, bh) || 1;
  if (diag < 30) return null;

  const start = points[0];
  const end = points[points.length - 1];
  const gap = Math.hypot(end.x - start.x, end.y - start.y);
  // Closed if endpoints meet within 28% of the shape's diagonal.
  const closed = gap < Math.max(26, diag * 0.28);

  const corners = cornerIndices(points, 1.0);

  // ---------- 1. LINE / ARROW --------------------------------------------
  if (!closed && corners.length <= 2) {
    // Straightness check: every point near the start-end line.
    let dev = 0;
    for (const p of points) dev = Math.max(dev, distToSeg(p.x, p.y, start.x, start.y, end.x, end.y));
    if (dev / diag < 0.09) {
      // Arrow if the tail has a V-splay.
      const cut = Math.max(1, Math.floor(points.length * 0.85));
      let head = 0;
      for (let i = cut; i < points.length; i++) {
        head = Math.max(
          head,
          distToSeg(points[i].x, points[i].y, start.x, start.y, points[cut].x, points[cut].y),
        );
      }
      const main = Math.hypot(points[cut].x - start.x, points[cut].y - start.y) || 1;
      if (head > Math.max(14, main * 0.16)) {
        return {
          type: "arrow",
          x1: start.x,
          y1: start.y,
          x2: points[cut].x,
          y2: points[cut].y,
          ...style,
        };
      }
      return { type: "line", x1: start.x, y1: start.y, x2: end.x, y2: end.y, ...style };
    }
  }

  if (!closed) return null;

  // ---------- 2. TRIANGLE (3 corners) ------------------------------------
  if (corners.length >= 2 && corners.length <= 4) {
    // Pick the 3 most prominent corners.
    const c3 = corners.slice(0, 3).map((i) => points[i]);
    if (c3.length === 3) {
      const err = fitToPolygon(points, c3);
      if (err < 0.11) {
        // Recompute a clean triangle in bbox space so it renders nicely.
        return { type: "triangle", x: b.x0, y: b.y0, w: bw, h: bh, ...style };
      }
    }
  }

  // ---------- 3. RECTANGLE (4 corners, perimeter-hugging) ----------------
  if (corners.length >= 3 && corners.length <= 6) {
    // Corners of the bounding box.
    const rectCorners: Pt[] = [
      { x: b.x0, y: b.y0 },
      { x: b.x1, y: b.y0 },
      { x: b.x1, y: b.y1 },
      { x: b.x0, y: b.y1 },
    ];
    const err = fitToPolygon(points, rectCorners);
    if (err < 0.11) {
      return { type: "rect", x: b.x0, y: b.y0, w: bw, h: bh, ...style };
    }
  }

  // ---------- 4. CIRCLE / ELLIPSE ----------------------------------------
  {
    const aspect = Math.min(bw, bh) / Math.max(bw, bh);
    if (aspect > 0.5) {
      const cx = (b.x0 + b.x1) / 2;
      const cy = (b.y0 + b.y1) / 2;
      const rx = bw / 2 || 1;
      const ry = bh / 2 || 1;
      let err = 0;
      for (const p of points) {
        err += Math.abs(Math.hypot((p.x - cx) / rx, (p.y - cy) / ry) - 1);
      }
      err /= points.length;
      if (err < 0.16) {
        return { type: "circle", x: b.x0, y: b.y0, w: bw, h: bh, ...style };
      }
    }
  }

  return null;
}
