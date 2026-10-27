import { distance, readableAngle } from './geometry';
import { Line, PlanImage, Point } from './model';

export const LABEL_FONT_FAMILY = '"Barlow Semi Condensed", "Arial Narrow", sans-serif';

const SELECTION_COLOR = 'rgba(31, 95, 174, 0.28)';
const SNAP_COLOR = '#1f5fae';

/** A rectangle resolved to image pixels for drawing. */
export interface RectShape {
  id: number;
  /** Top left, top right, bottom right, bottom left as seen before turning. */
  corners: Point[];
  widthLabel: string;
  heightLabel: string;
  color: string;
  thickness: number;
}

export interface RenderOptions {
  rects: readonly RectShape[];
  lines: readonly Line[];
  label: (line: Line) => string | null;
  /** Image pixels per stroke-weight step, see styleUnit(). */
  unitPx: number;
  /** Screen pixels per image pixel; keeps handles a constant size on screen. */
  viewScale: number;
  selectedId?: number | null;
  draft?: Line | null;
  /** Reference being drawn or asked about; screen only, never part of the export. */
  reference?: { line: Line; label: string } | null;
  snapPoint?: Point | null;
}

/**
 * Draws the plan and its dimension lines in image coordinates. The screen view and the JPG export
 * both use this function, so the export matches what is on screen.
 */
export function drawPlan(ctx: CanvasRenderingContext2D, image: PlanImage, o: RenderOptions): void {
  // JPEG has no alpha channel: transparent plan areas would otherwise turn black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, image.width, image.height);
  ctx.drawImage(image.source, 0, 0, image.width, image.height);

  // Rectangles lie under the lines, so measurements across them stay readable.
  for (const rect of o.rects) {
    if (rect.id === o.selectedId) {
      drawSelection(ctx, [...rect.corners, rect.corners[0]], rect.thickness, o.unitPx, o.viewScale);
    }
    drawRect(ctx, rect, o.unitPx);
  }
  for (const line of o.lines) {
    if (line.id === o.selectedId) {
      drawSelection(ctx, [line.a, line.b], line.thickness, o.unitPx, o.viewScale);
    }
    drawDimension(ctx, line, o.label(line), o.unitPx);
  }
  if (o.draft) {
    drawDimension(ctx, o.draft, o.label(o.draft), o.unitPx);
  }
  if (o.reference) {
    drawDimension(ctx, o.reference.line, o.reference.label, o.unitPx, true);
  }
  const selected = o.lines.find((l) => l.id === o.selectedId);
  if (selected) {
    drawHandle(ctx, selected.a, selected.color, o.viewScale);
    drawHandle(ctx, selected.b, selected.color, o.viewScale);
  }
  if (o.snapPoint) {
    ctx.beginPath();
    ctx.arc(o.snapPoint.x, o.snapPoint.y, 9 / o.viewScale, 0, Math.PI * 2);
    ctx.strokeStyle = SNAP_COLOR;
    ctx.lineWidth = 2 / o.viewScale;
    ctx.stroke();
  }
}

/** Font size in image pixels for a line of the given thickness. */
export function labelFontPx(thickness: number, unitPx: number): number {
  return unitPx * (13 + 2.5 * thickness);
}

/**
 * A dimension line: the line itself, 45° slashes at both ends, and the length above it. A boxed
 * label marks a given length (the reference) as opposed to a measured one.
 */
function drawDimension(
  ctx: CanvasRenderingContext2D,
  line: Line,
  label: string | null,
  unitPx: number,
  boxed = false,
): void {
  const length = distance(line.a, line.b);
  if (length < 0.01) {
    return;
  }
  const width = line.thickness * unitPx;
  const ux = (line.b.x - line.a.x) / length;
  const uy = (line.b.y - line.a.y) / length;
  // Direction rotated by -45°: the slash reads "/" on a horizontal line.
  const sx = (ux + uy) * Math.SQRT1_2;
  const sy = (uy - ux) * Math.SQRT1_2;
  const slash = unitPx * (4 + 2.5 * line.thickness);

  ctx.save();
  ctx.strokeStyle = line.color;
  ctx.lineCap = 'butt';
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(line.a.x, line.a.y);
  ctx.lineTo(line.b.x, line.b.y);
  ctx.stroke();

  ctx.lineWidth = width * 1.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const end of [line.a, line.b]) {
    ctx.moveTo(end.x - sx * slash, end.y - sy * slash);
    ctx.lineTo(end.x + sx * slash, end.y + sy * slash);
  }
  ctx.stroke();

  if (label) {
    drawLabel(ctx, line, label, width, labelFontPx(line.thickness, unitPx), boxed);
  }
  ctx.restore();
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  line: Line,
  label: string,
  lineWidth: number,
  fontPx: number,
  boxed: boolean,
): void {
  ctx.translate((line.a.x + line.b.x) / 2, (line.a.y + line.b.y) / 2);
  ctx.rotate(readableAngle(line.a, line.b));
  ctx.font = `600 ${fontPx}px ${LABEL_FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const gap = lineWidth / 2 + fontPx * 0.3;

  if (boxed) {
    const padX = fontPx * 0.35;
    const boxHeight = fontPx * 1.1;
    const boxWidth = ctx.measureText(label).width + padX * 2;
    ctx.fillStyle = line.color;
    ctx.beginPath();
    ctx.roundRect(-boxWidth / 2, -gap - boxHeight, boxWidth, boxHeight, fontPx * 0.2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, 0, -gap - fontPx * 0.27);
    return;
  }
  ctx.lineJoin = 'round';
  ctx.lineWidth = fontPx * 0.24;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.strokeText(label, 0, -gap);
  ctx.fillStyle = line.color;
  ctx.fillText(label, 0, -gap);
}

/** A rectangle: light fill, outline, and its two edge lengths inside along the edges. */
function drawRect(ctx: CanvasRenderingContext2D, rect: RectShape, unitPx: number): void {
  const [tl, tr, br, bl] = rect.corners;
  const width = rect.thickness * unitPx;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(tl.x, tl.y);
  for (const p of [tr, br, bl]) {
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = rect.color;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = rect.color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'miter';
  ctx.stroke();
  ctx.restore();

  const fontPx = labelFontPx(rect.thickness, unitPx);
  const center = { x: (tl.x + br.x) / 2, y: (tl.y + br.y) / 2 };
  drawInsideLabel(ctx, tl, tr, center, rect.widthLabel, rect.color, width, fontPx);
  drawInsideLabel(ctx, tr, br, center, rect.heightLabel, rect.color, width, fontPx);
}

/** Label along the edge a–b, just inside the shape whose centre is `center`. */
function drawInsideLabel(
  ctx: CanvasRenderingContext2D,
  a: Point,
  b: Point,
  center: Point,
  label: string,
  color: string,
  lineWidth: number,
  fontPx: number,
): void {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const toCenter = distance(mid, center);
  if (toCenter < 0.01) {
    return;
  }
  const inset = lineWidth / 2 + fontPx * 0.75;
  ctx.save();
  ctx.translate(
    mid.x + ((center.x - mid.x) / toCenter) * inset,
    mid.y + ((center.y - mid.y) / toCenter) * inset,
  );
  ctx.rotate(readableAngle(a, b));
  ctx.font = `600 ${fontPx}px ${LABEL_FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = fontPx * 0.24;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.strokeText(label, 0, 0);
  ctx.fillStyle = color;
  ctx.fillText(label, 0, 0);
  ctx.restore();
}

/** Translucent halo along a polyline, sized on screen so it is visible at any zoom. */
function drawSelection(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  thickness: number,
  unitPx: number,
  viewScale: number,
): void {
  ctx.save();
  ctx.strokeStyle = SELECTION_COLOR;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = thickness * unitPx + 12 / viewScale;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const p of points.slice(1)) {
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawHandle(
  ctx: CanvasRenderingContext2D,
  p: Point,
  color: string,
  viewScale: number,
): void {
  ctx.beginPath();
  ctx.arc(p.x, p.y, 6 / viewScale, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5 / viewScale;
  ctx.stroke();
}
