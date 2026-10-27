import { Line, Point, Unit } from './model';

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Parses a length typed by the user into centimetres. Accepts a decimal comma or point and an
 * optional unit suffix (mm, cm, m); a bare number is centimetres. A point followed by exactly three
 * digits is rejected: "1.000" is 1000 in German but 1 in English, and guessing wrong is a factor
 * of 1000.
 */
export function parseLengthCm(input: string): number | null {
  const match = input
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:[.,]\d+)?|[.,]\d+)\s*(mm|cm|m)?$/);
  if (!match || /^\d+\.\d{3}$/.test(match[1])) {
    return null;
  }
  const value = Number(match[1].replace(',', '.'));
  const factor = match[2] === 'mm' ? 0.1 : match[2] === 'm' ? 100 : 1;
  const cm = value * factor;
  return Number.isFinite(cm) && cm > 0 ? cm : null;
}

export function formatLength(cm: number, unit: Unit): string {
  return `${formatNumber(cm, unit)} ${unit}`;
}

/** Edge lengths of a rectangle, e.g. "200 × 90 cm". */
export function formatSize(widthCm: number, heightCm: number, unit: Unit): string {
  return `${formatNumber(widthCm, unit)} × ${formatNumber(heightCm, unit)} ${unit}`;
}

/** Metres with two decimals; centimetres whole, with one decimal below 10 cm. */
function formatNumber(cm: number, unit: Unit): string {
  const value = unit === 'm' ? cm / 100 : cm;
  const digits = unit === 'm' ? 2 : cm < 10 ? 1 : 0;
  return value.toLocaleString('de-DE', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Restricts the direction from `from` to `to` to multiples of 45°, keeping the projected length. */
export function constrainAngle(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const length = dx * ux + dy * uy;
  return { x: from.x + ux * length, y: from.y + uy * length };
}

/** Returns the candidate closest to `p` if it lies within `radius`, otherwise null. */
export function nearestPoint(p: Point, candidates: readonly Point[], radius: number): Point | null {
  let best: Point | null = null;
  let bestDistance = radius;
  for (const c of candidates) {
    const d = distance(p, c);
    if (d <= bestDistance) {
      best = c;
      bestDistance = d;
    }
  }
  return best;
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) {
    return distance(p, a);
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** The topmost (last drawn) line within `tolerance` of `p`. */
export function hitLine(lines: readonly Line[], p: Point, tolerance: number): Line | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (distanceToSegment(p, lines[i].a, lines[i].b) <= tolerance) {
      return lines[i];
    }
  }
  return null;
}

export function hitEndpoint(line: Line, p: Point, tolerance: number): 'a' | 'b' | null {
  const da = distance(p, line.a);
  const db = distance(p, line.b);
  if (Math.min(da, db) > tolerance) {
    return null;
  }
  return da <= db ? 'a' : 'b';
}

/**
 * Image pixels per stroke-weight step. Scaling strokes and labels with the image size makes a
 * drawing look the same at "fit to window" for a phone photo and a large scan, and keeps the
 * exported JPG identical to the screen.
 */
export function styleUnit(width: number, height: number): number {
  return Math.max(1, Math.max(width, height) / 1000);
}

/** Size the image is worked on, shrunk so its pixel count stays within `maxPixels`. */
export function workingSize(
  width: number,
  height: number,
  maxPixels: number,
): { width: number; height: number } {
  const factor = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  return { width: Math.floor(width * factor), height: Math.floor(height * factor) };
}

/**
 * Angle of the line from a to b, normalised to [-90°, 90°) so text along it is never upside down;
 * vertical text reads bottom to top, as in construction drawings.
 */
export function readableAngle(a: Point, b: Point): number {
  let angle = Math.atan2(b.y - a.y, b.x - a.x);
  if (angle >= Math.PI / 2 - 1e-9) {
    angle -= Math.PI;
  } else if (angle < -Math.PI / 2 - 1e-9) {
    angle += Math.PI;
  }
  return angle;
}

/**
 * Corners of a `width` × `height` rectangle around `center`, turned clockwise by `angle` degrees:
 * top left, top right, bottom right, bottom left as seen before turning.
 */
export function rectCorners(center: Point, width: number, height: number, angle: number): Point[] {
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => {
    const x = (sx * width) / 2;
    const y = (sy * height) / 2;
    return { x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos };
  });
}

/** Whether `p` lies inside the turned rectangle, or within `tolerance` of it. */
export function pointInRect(
  p: Point,
  center: Point,
  width: number,
  height: number,
  angle: number,
  tolerance = 0,
): boolean {
  const rad = (angle * Math.PI) / 180;
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const localX = dx * Math.cos(rad) + dy * Math.sin(rad);
  const localY = -dx * Math.sin(rad) + dy * Math.cos(rad);
  return Math.abs(localX) <= width / 2 + tolerance && Math.abs(localY) <= height / 2 + tolerance;
}
