import { Injectable, computed, signal } from '@angular/core';
import { distance, formatLength, formatSize, rectCorners, styleUnit } from './geometry';
import { COLORS, Line, PlanImage, Point, Rect, Reference, THICKNESSES, Tool, Unit } from './model';
import { RectShape } from './render';

export interface Snapshot {
  lines: Line[];
  rects: Rect[];
  reference: Reference | null;
}

/** An open "how long is this distance?" question. */
export interface Calibration {
  a: Point;
  b: Point;
  /** True when only the length of the current reference is corrected. */
  edit: boolean;
}

export type Phase = 'empty' | 'calibrate' | 'measure';

type Style = Pick<Line, 'color' | 'thickness'>;

/**
 * Holds the plan, its lines and rectangles. Lines store only pixel coordinates and rectangles only
 * real sizes; both are converted through the current reference, so entering a new reference
 * re-dimensions every line and redraws every rectangle at its true size.
 */
@Injectable({ providedIn: 'root' })
export class PlanStore {
  readonly image = signal<PlanImage | null>(null);
  readonly lines = signal<Line[]>([]);
  readonly rects = signal<Rect[]>([]);
  readonly reference = signal<Reference | null>(null);
  readonly selectedId = signal<number | null>(null);
  readonly tool = signal<Tool>('draw');
  readonly color = signal(COLORS[0].value);
  readonly thickness = signal(THICKNESSES[1]);
  readonly unit = signal<Unit>('cm');
  readonly calibration = signal<Calibration | null>(null);

  private readonly past = signal<Snapshot[]>([]);
  private readonly future = signal<Snapshot[]>([]);
  private nextId = 1;

  readonly canUndo = computed(() => this.past().length > 0);
  readonly canRedo = computed(() => this.future().length > 0);
  readonly selectedLine = computed(
    () => this.lines().find((l) => l.id === this.selectedId()) ?? null,
  );
  readonly selectedRect = computed(
    () => this.rects().find((r) => r.id === this.selectedId()) ?? null,
  );
  readonly unitPx = computed(() => {
    const image = this.image();
    return image ? styleUnit(image.width, image.height) : 1;
  });
  readonly cmPerPx = computed(() => {
    const reference = this.reference();
    const px = reference ? distance(reference.a, reference.b) : 0;
    return reference && px > 0 ? reference.cm / px : null;
  });
  readonly phase = computed<Phase>(() =>
    !this.image() ? 'empty' : this.cmPerPx() === null ? 'calibrate' : 'measure',
  );
  /** Whether the next drawn line is a reference: chosen explicitly, or as long as no scale exists. */
  readonly drawsReference = computed(
    () => this.tool() === 'reference' || (this.tool() === 'draw' && this.phase() === 'calibrate'),
  );

  /** Rectangles resolved to image pixels at the current scale; empty while no scale exists. */
  readonly rectShapes = computed<RectShape[]>(() =>
    this.rects().flatMap((rect) => {
      const corners = this.rectCornersPx(rect);
      const unit = this.unit();
      return corners
        ? [
            {
              id: rect.id,
              corners,
              widthLabel: formatLength(rect.widthCm, unit),
              heightLabel: formatLength(rect.heightCm, unit),
              color: rect.color,
              thickness: rect.thickness,
            },
          ]
        : [];
    }),
  );

  lengthCm(line: Line): number | null {
    const cmPerPx = this.cmPerPx();
    return cmPerPx === null ? null : distance(line.a, line.b) * cmPerPx;
  }

  /** Text shown on the line; null while no scale is known. */
  label(line: Line): string | null {
    const cm = this.lengthCm(line);
    return cm === null ? null : formatLength(cm, this.unit());
  }

  rectLabel(rect: Rect): string {
    return formatSize(rect.widthCm, rect.heightCm, this.unit());
  }

  /** Width and height of the rectangle in image pixels at the current scale. */
  rectSizePx(rect: Rect): { width: number; height: number } | null {
    const cmPerPx = this.cmPerPx();
    return cmPerPx === null
      ? null
      : { width: rect.widthCm / cmPerPx, height: rect.heightCm / cmPerPx };
  }

  rectCornersPx(rect: Rect): Point[] | null {
    const size = this.rectSizePx(rect);
    return size ? rectCorners(rect.center, size.width, size.height, rect.angle) : null;
  }

  /** Points a line end can snap to: line ends and rectangle corners. */
  snapPoints(excludeId?: number): Point[] {
    return [
      ...this.lines()
        .filter((l) => l.id !== excludeId)
        .flatMap((l) => [l.a, l.b]),
      ...this.rects().flatMap((r) => this.rectCornersPx(r) ?? []),
    ];
  }

  loadImage(image: PlanImage): void {
    this.image.set(image);
    this.lines.set([]);
    this.rects.set([]);
    this.reference.set(null);
    this.selectedId.set(null);
    this.calibration.set(null);
    this.past.set([]);
    this.future.set([]);
    this.tool.set('draw');
  }

  /** Adds a measurement line in the current style. */
  addLine(a: Point, b: Point): Line {
    const line: Line = { id: this.nextId++, a, b, ...this.style() };
    this.pushHistory(this.snapshot());
    this.lines.update((lines) => [...lines, line]);
    return line;
  }

  /** Changes a line without recording history; pair with snapshot() and commit() for drags. */
  updateLine(id: number, patch: Partial<Pick<Line, 'a' | 'b' | 'color' | 'thickness'>>): void {
    this.lines.update((lines) => lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  /** Adds a rectangle in the current style and selects it, ready to be moved. */
  addRect(center: Point, widthCm: number, heightCm: number): Rect {
    const rect: Rect = { id: this.nextId++, center, widthCm, heightCm, angle: 0, ...this.style() };
    this.pushHistory(this.snapshot());
    this.rects.update((rects) => [...rects, rect]);
    this.select(rect.id);
    return rect;
  }

  /** Changes a rectangle without recording history; pair with snapshot() and commit() for drags. */
  updateRect(id: number, patch: Partial<Omit<Rect, 'id'>>): void {
    this.rects.update((rects) => rects.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  resizeRect(id: number, widthCm: number, heightCm: number): void {
    this.changeRect(id, { widthCm, heightCm });
  }

  /** Turns the rectangle clockwise by 90° around its centre. */
  rotateRect(id: number): void {
    const rect = this.rects().find((r) => r.id === id);
    if (rect) {
      this.changeRect(id, { angle: (rect.angle + 90) % 360 });
    }
  }

  snapshot(): Snapshot {
    return { lines: this.lines(), rects: this.rects(), reference: this.reference() };
  }

  /** Records `before` as an undo step if anything changed since it was taken. */
  commit(before: Snapshot): void {
    if (
      before.lines !== this.lines() ||
      before.rects !== this.rects() ||
      before.reference !== this.reference()
    ) {
      this.pushHistory(before);
    }
  }

  /** Deletes a line or rectangle. */
  deleteItem(id: number): void {
    if (!this.lines().some((l) => l.id === id) && !this.rects().some((r) => r.id === id)) {
      return;
    }
    this.pushHistory(this.snapshot());
    this.lines.update((lines) => lines.filter((l) => l.id !== id));
    this.rects.update((rects) => rects.filter((r) => r.id !== id));
    if (this.selectedId() === id) {
      this.selectedId.set(null);
    }
  }

  setTool(tool: Tool): void {
    this.tool.set(tool);
    if (tool !== 'select') {
      this.selectedId.set(null);
    }
  }

  select(id: number | null): void {
    this.selectedId.set(id);
    const item = this.selectedLine() ?? this.selectedRect();
    if (item) {
      this.tool.set('select');
      this.color.set(item.color);
      this.thickness.set(item.thickness);
    }
  }

  /** Sets the drawing colour and recolours the selected line or rectangle. */
  setColor(color: string): void {
    this.color.set(color);
    this.restyleSelected({ color });
  }

  setThickness(thickness: number): void {
    this.thickness.set(thickness);
    this.restyleSelected({ thickness });
  }

  /** Asks for the real length of a newly drawn reference. */
  startCalibration(a: Point, b: Point): void {
    this.calibration.set({ a, b, edit: false });
  }

  /** Asks again for the length of the current reference, e.g. to fix a typo. */
  editCalibration(): void {
    const reference = this.reference();
    if (reference) {
      this.calibration.set({ a: reference.a, b: reference.b, edit: true });
    }
  }

  /** Makes the asked-about distance the reference; it replaces any previous one. */
  confirmCalibration(cm: number): void {
    const calibration = this.calibration();
    if (!calibration) {
      return;
    }
    this.pushHistory(this.snapshot());
    this.reference.set({ a: calibration.a, b: calibration.b, cm });
    this.calibration.set(null);
    if (this.tool() === 'reference') {
      this.tool.set('draw');
    }
  }

  /** Abandons the question; the previous reference stays in force. */
  cancelCalibration(): void {
    this.calibration.set(null);
  }

  undo(): void {
    const past = this.past();
    if (past.length === 0 || this.calibration()) {
      return;
    }
    this.future.update((future) => [...future, this.snapshot()]);
    this.past.set(past.slice(0, -1));
    this.restore(past[past.length - 1]);
  }

  redo(): void {
    const future = this.future();
    if (future.length === 0 || this.calibration()) {
      return;
    }
    this.past.update((past) => [...past, this.snapshot()]);
    this.future.set(future.slice(0, -1));
    this.restore(future[future.length - 1]);
  }

  private style(): Style {
    return { color: this.color(), thickness: this.thickness() };
  }

  private changeRect(id: number, patch: Partial<Omit<Rect, 'id'>>): void {
    if (!this.rects().some((r) => r.id === id)) {
      return;
    }
    const before = this.snapshot();
    this.updateRect(id, patch);
    this.pushHistory(before);
  }

  private restyleSelected(patch: Partial<Style>): void {
    const item = this.selectedLine() ?? this.selectedRect();
    if (
      !item ||
      Object.entries(patch).every(([key, value]) => item[key as keyof Style] === value)
    ) {
      return;
    }
    const before = this.snapshot();
    this.updateLine(item.id, patch);
    this.updateRect(item.id, patch);
    this.pushHistory(before);
  }

  private pushHistory(snapshot: Snapshot): void {
    this.past.update((past) => [...past.slice(-199), snapshot]);
    this.future.set([]);
  }

  private restore(snapshot: Snapshot): void {
    this.lines.set(snapshot.lines);
    this.rects.set(snapshot.rects);
    this.reference.set(snapshot.reference);
    if (!this.selectedLine() && !this.selectedRect()) {
      this.selectedId.set(null);
    }
  }
}
