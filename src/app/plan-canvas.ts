import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  constrainAngle,
  distance,
  formatLength,
  hitEndpoint,
  hitLine,
  nearestPoint,
  pointInRect,
} from './geometry';
import { Line, PlanImage, Point, Rect, REFERENCE_COLOR } from './model';
import { PlanStore, Snapshot } from './plan-store';
import { drawPlan, LABEL_FONT_FAMILY } from './render';

/** Screen transform: screen = image * scale + offset. */
export interface View {
  scale: number;
  x: number;
  y: number;
}

type Gesture =
  | { kind: 'draw'; pointerId: number; start: Point; moved: boolean }
  | { kind: 'pan'; pointerId: number; last: Point }
  | { kind: 'end'; pointerId: number; id: number; end: 'a' | 'b'; before: Snapshot }
  | {
      kind: 'move';
      pointerId: number;
      id: number;
      grab: Point;
      a: Point;
      b: Point;
      before: Snapshot;
    }
  | {
      kind: 'move-rect';
      pointerId: number;
      id: number;
      grab: Point;
      center: Point;
      before: Snapshot;
    };

/** Non-standard WebKit trackpad gesture events; other browsers send ctrl+wheel instead. */
const GESTURE_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'] as const;
type SafariGestureEvent = MouseEvent & { scale: number };

/** Pick and snap tolerance in screen pixels. */
const HIT_PX = 10;
/** Pointer travel below which a press counts as a click, starting a click-click line. */
const CLICK_PX = 4;
/** Lines shorter than this on screen are discarded as accidental. */
const MIN_LINE_PX = 3;
const MIN_SCALE = 0.02;
const MAX_SCALE = 16;
const FIT_PADDING = 32;

@Component({
  selector: 'app-plan-canvas',
  template: `<canvas
    #canvas
    tabindex="-1"
    aria-label="Plan"
    [attr.data-scale]="view().scale"
    [attr.data-x]="view().x"
    [attr.data-y]="view().y"
    [style.cursor]="cursor()"
    (pointerdown)="onPointerDown($event)"
    (pointermove)="onPointerMove($event)"
    (pointerup)="onPointerUp($event)"
    (pointercancel)="onPointerCancel($event)"
    (contextmenu)="$event.preventDefault()"
  ></canvas>`,
  styles: `
    :host {
      display: block;
      position: relative;
      overflow: hidden;
    }
    canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
      touch-action: none;
      outline: none;
    }
  `,
  host: {
    '(document:keydown)': 'onKeyDown($event)',
    '(document:keyup)': 'onKeyUp($event)',
    '(window:blur)': 'spaceDown.set(false)',
  },
})
export class PlanCanvas {
  private readonly store = inject(PlanStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  readonly view = signal<View>({ scale: 1, x: 0, y: 0 });
  private readonly size = signal({ width: 0, height: 0 });
  private readonly draft = signal<Line | null>(null);
  private readonly snapPoint = signal<Point | null>(null);
  private readonly hover = signal<'end' | 'line' | null>(null);
  private readonly panning = signal(false);
  protected readonly spaceDown = signal(false);
  private readonly fontsLoaded = signal(0);

  protected readonly cursor = computed(() => {
    if (this.panning()) {
      return 'grabbing';
    }
    if (this.spaceDown()) {
      return 'grab';
    }
    if (this.store.tool() !== 'select') {
      return 'crosshair';
    }
    return { end: 'crosshair', line: 'move', none: 'grab' }[this.hover() ?? 'none'];
  });

  private gesture: Gesture | null = null;
  /**
   * The view follows the window width until the user zooms or pans. Height-only changes, such as
   * the status bar wrapping, leave the plan where it is instead of shifting it under the pointer.
   */
  private fitted = true;
  private fittedWidth = 0;
  private lastImage: PlanImage | null = null;
  /** Cumulative scale of the running Safari pinch, null outside a pinch. */
  private gestureScale: number | null = null;

  constructor() {
    effect(() => {
      const image = this.store.image();
      const size = this.size();
      if (image !== this.lastImage) {
        this.lastImage = image;
        this.fitted = true;
        this.fittedWidth = 0;
        this.cancelDraft();
      }
      if (image && size.width > 0 && this.fitted && size.width !== this.fittedWidth) {
        this.fittedWidth = size.width;
        this.view.set(fitView(image, size.width, size.height));
      }
    });

    effect(() => this.render());

    afterNextRender(() => {
      const canvas = this.canvasRef().nativeElement;
      const observer = new ResizeObserver(([entry]) =>
        this.size.set({ width: entry.contentRect.width, height: entry.contentRect.height }),
      );
      observer.observe(this.host.nativeElement);
      // Registered by hand: preventing page zoom on pinch needs non-passive listeners.
      const onWheel = (e: WheelEvent) => this.onWheel(e);
      const onGesture = (e: Event) => this.onGesture(e as SafariGestureEvent);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      for (const type of GESTURE_EVENTS) {
        canvas.addEventListener(type, onGesture, { passive: false });
      }
      document.fonts
        .load(`600 20px ${LABEL_FONT_FAMILY}`)
        .then(() => this.fontsLoaded.update((n) => n + 1));
      this.destroyRef.onDestroy(() => {
        observer.disconnect();
        canvas.removeEventListener('wheel', onWheel);
        for (const type of GESTURE_EVENTS) {
          canvas.removeEventListener(type, onGesture);
        }
      });
    });
  }

  fit(): void {
    const image = this.store.image();
    const { width, height } = this.size();
    if (image && width > 0) {
      this.fitted = true;
      this.fittedWidth = width;
      this.view.set(fitView(image, width, height));
    }
  }

  zoomBy(factor: number): void {
    const { width, height } = this.size();
    this.zoomAt({ x: width / 2, y: height / 2 }, factor);
  }

  protected onPointerDown(e: PointerEvent): void {
    if (!this.store.image() || this.store.calibration()) {
      return;
    }
    const canvas = this.canvasRef().nativeElement;
    // Takes focus off toolbar buttons so Space pans instead of pressing them.
    canvas.focus({ preventScroll: true });
    const screen = this.toScreen(e);
    const p = this.toImage(screen);
    if (e.button === 1 || (e.button === 0 && this.spaceDown())) {
      this.startPan(e, screen);
      return;
    }
    if (e.button !== 0) {
      return;
    }
    this.capture(e);

    if (this.store.tool() !== 'select') {
      if (this.draft()) {
        // Second click of a click-click line.
        this.updateDraft(p, e);
        this.finishDraft();
        return;
      }
      const start = (!e.altKey && this.snapTo(p)) || p;
      this.draft.set({
        id: 0,
        a: start,
        b: start,
        color: this.store.color(),
        thickness: this.store.thickness(),
      });
      this.gesture = { kind: 'draw', pointerId: e.pointerId, start: screen, moved: false };
      return;
    }

    const tolerance = HIT_PX / this.view().scale;
    const selected = this.store.selectedLine();
    const end = selected && hitEndpoint(selected, p, tolerance);
    if (selected && end) {
      this.gesture = {
        kind: 'end',
        pointerId: e.pointerId,
        id: selected.id,
        end,
        before: this.store.snapshot(),
      };
      return;
    }
    const hit = hitLine(this.store.lines(), p, tolerance);
    if (hit) {
      this.store.select(hit.id);
      this.gesture = {
        kind: 'move',
        pointerId: e.pointerId,
        id: hit.id,
        grab: p,
        a: hit.a,
        b: hit.b,
        before: this.store.snapshot(),
      };
      return;
    }
    const rect = this.hitRect(p, tolerance);
    if (rect) {
      this.store.select(rect.id);
      this.gesture = {
        kind: 'move-rect',
        pointerId: e.pointerId,
        id: rect.id,
        grab: p,
        center: rect.center,
        before: this.store.snapshot(),
      };
      return;
    }
    this.store.select(null);
    this.startPan(e, screen);
  }

  /** Centre of the visible part of the board, in image pixels. */
  viewCenter(): Point {
    const { width, height } = this.size();
    return this.toImage({ x: width / 2, y: height / 2 });
  }

  protected onPointerMove(e: PointerEvent): void {
    const screen = this.toScreen(e);
    const p = this.toImage(screen);
    const g = this.gesture;

    if (g?.kind === 'pan') {
      const v = this.view();
      this.view.set({ ...v, x: v.x + screen.x - g.last.x, y: v.y + screen.y - g.last.y });
      g.last = screen;
      this.fitted = false;
    } else if (g?.kind === 'draw' || (!g && this.draft())) {
      if (g?.kind === 'draw' && distance(screen, g.start) > CLICK_PX) {
        g.moved = true;
      }
      this.updateDraft(p, e);
    } else if (g?.kind === 'end') {
      const line = this.store.lines().find((l) => l.id === g.id);
      if (line) {
        const fixed = g.end === 'a' ? line.b : line.a;
        const snap = e.shiftKey || e.altKey ? null : this.snapTo(p, g.id);
        this.snapPoint.set(snap);
        const point = e.shiftKey ? constrainAngle(fixed, p) : (snap ?? p);
        this.store.updateLine(g.id, g.end === 'a' ? { a: point } : { b: point });
      }
    } else if (g?.kind === 'move') {
      const dx = p.x - g.grab.x;
      const dy = p.y - g.grab.y;
      this.store.updateLine(g.id, {
        a: { x: g.a.x + dx, y: g.a.y + dy },
        b: { x: g.b.x + dx, y: g.b.y + dy },
      });
    } else if (g?.kind === 'move-rect') {
      this.store.updateRect(g.id, {
        center: { x: g.center.x + p.x - g.grab.x, y: g.center.y + p.y - g.grab.y },
      });
    } else {
      this.updateHover(p);
    }
  }

  protected onPointerUp(e: PointerEvent): void {
    const g = this.gesture;
    if (!g || g.pointerId !== e.pointerId) {
      return;
    }
    this.gesture = null;
    this.panning.set(false);
    if (g.kind === 'draw') {
      // A press without travel keeps the line open until the second click.
      if (g.moved) {
        this.finishDraft();
      }
    } else if (g.kind === 'end' || g.kind === 'move' || g.kind === 'move-rect') {
      this.snapPoint.set(null);
      this.store.commit(g.before);
    }
  }

  protected onPointerCancel(e: PointerEvent): void {
    const g = this.gesture;
    if (g?.kind === 'draw') {
      this.cancelDraft();
    } else {
      this.onPointerUp(e);
    }
  }

  protected onKeyDown(e: KeyboardEvent): void {
    if (isEditable(e.target)) {
      return;
    }
    if (e.code === 'Space' && this.store.image()) {
      e.preventDefault();
      this.spaceDown.set(true);
    } else if (e.key === 'Escape') {
      this.cancelDraft();
    }
  }

  protected onKeyUp(e: KeyboardEvent): void {
    if (e.code === 'Space') {
      if (!isEditable(e.target)) {
        e.preventDefault();
      }
      this.spaceDown.set(false);
    }
  }

  private onWheel(e: WheelEvent): void {
    if (!this.store.image()) {
      return;
    }
    e.preventDefault();
    const perUnit =
      e.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? 16
        : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? 400
          : 1;
    if (e.ctrlKey || e.metaKey) {
      if (this.gestureScale !== null) {
        return;
      }
      // Trackpad pinch arrives as ctrl+wheel with small deltas, a mouse wheel notch as ±100.
      const dy = Math.max(-25, Math.min(25, e.deltaY * perUnit));
      this.zoomAt(this.toScreen(e), Math.exp(-dy * 0.01));
    } else {
      const v = this.view();
      this.view.set({ ...v, x: v.x - e.deltaX * perUnit, y: v.y - e.deltaY * perUnit });
      this.fitted = false;
    }
  }

  /** Safari reports trackpad pinch as gesture events with a cumulative scale. */
  private onGesture(e: SafariGestureEvent): void {
    if (!this.store.image()) {
      return;
    }
    e.preventDefault();
    if (e.type === 'gesturestart') {
      this.gestureScale = 1;
    } else if (e.type === 'gesturechange' && this.gestureScale !== null && e.scale > 0) {
      this.zoomAt(this.toScreen(e), e.scale / this.gestureScale);
      this.gestureScale = e.scale;
    } else if (e.type === 'gestureend') {
      this.gestureScale = null;
    }
  }

  private zoomAt(screen: Point, factor: number): void {
    const v = this.view();
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor));
    const ratio = scale / v.scale;
    this.fitted = false;
    this.view.set({
      scale,
      x: screen.x - (screen.x - v.x) * ratio,
      y: screen.y - (screen.y - v.y) * ratio,
    });
  }

  private startPan(e: PointerEvent, screen: Point): void {
    this.capture(e);
    this.gesture = { kind: 'pan', pointerId: e.pointerId, last: screen };
    this.panning.set(true);
  }

  private updateDraft(p: Point, e: PointerEvent): void {
    const draft = this.draft();
    if (!draft) {
      return;
    }
    const snap = e.shiftKey || e.altKey ? null : this.snapTo(p);
    this.snapPoint.set(snap);
    this.draft.set({ ...draft, b: e.shiftKey ? constrainAngle(draft.a, p) : (snap ?? p) });
  }

  private finishDraft(): void {
    const draft = this.draft();
    this.cancelDraft();
    if (!draft || distance(draft.a, draft.b) * this.view().scale < MIN_LINE_PX) {
      return;
    }
    if (this.store.drawsReference()) {
      this.store.startCalibration(draft.a, draft.b);
    } else {
      this.store.addLine(draft.a, draft.b);
    }
  }

  /** The reference while it is drawn or its length is asked for; it is hidden otherwise. */
  private shownReference(): { line: Line; label: string } | null {
    const draft = this.draft();
    if (draft && this.store.drawsReference()) {
      return { line: { ...draft, color: REFERENCE_COLOR }, label: '? cm' };
    }
    const calibration = this.store.calibration();
    if (!calibration) {
      return null;
    }
    const current = this.store.reference();
    return {
      line: {
        id: 0,
        a: calibration.a,
        b: calibration.b,
        color: REFERENCE_COLOR,
        thickness: this.store.thickness(),
      },
      label: calibration.edit && current ? formatLength(current.cm, this.store.unit()) : '? cm',
    };
  }

  private cancelDraft(): void {
    if (this.gesture?.kind === 'draw') {
      this.gesture = null;
    }
    this.draft.set(null);
    this.snapPoint.set(null);
  }

  private snapTo(p: Point, excludeId?: number): Point | null {
    return nearestPoint(p, this.store.snapPoints(excludeId), HIT_PX / this.view().scale);
  }

  /** The topmost rectangle at `p`. */
  private hitRect(p: Point, tolerance: number): Rect | null {
    const rects = this.store.rects();
    for (let i = rects.length - 1; i >= 0; i--) {
      const size = this.store.rectSizePx(rects[i]);
      if (
        size &&
        pointInRect(p, rects[i].center, size.width, size.height, rects[i].angle, tolerance)
      ) {
        return rects[i];
      }
    }
    return null;
  }

  private updateHover(p: Point): void {
    if (this.store.tool() !== 'select') {
      return;
    }
    const tolerance = HIT_PX / this.view().scale;
    const selected = this.store.selectedLine();
    if (selected && hitEndpoint(selected, p, tolerance)) {
      this.hover.set('end');
    } else {
      const hit = hitLine(this.store.lines(), p, tolerance) ?? this.hitRect(p, tolerance);
      this.hover.set(hit ? 'line' : null);
    }
  }

  private capture(e: PointerEvent): void {
    try {
      this.canvasRef().nativeElement.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic or already released pointers cannot be captured; dragging still works inside.
    }
  }

  private toScreen(e: MouseEvent): Point {
    const rect = this.canvasRef().nativeElement.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private toImage(screen: Point): Point {
    const v = this.view();
    return { x: (screen.x - v.x) / v.scale, y: (screen.y - v.y) / v.scale };
  }

  private render(): void {
    const canvas = this.canvasRef().nativeElement;
    const { width, height } = this.size();
    const view = this.view();
    const image = this.store.image();
    this.fontsLoaded();

    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);
    if (!image) {
      return;
    }
    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.x, dpr * view.y);

    ctx.save();
    ctx.shadowColor = 'rgba(29, 42, 51, 0.28)';
    ctx.shadowBlur = 18 * dpr;
    ctx.shadowOffsetY = 4 * dpr;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, image.width, image.height);
    ctx.restore();

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    drawPlan(ctx, image, {
      rects: this.store.rectShapes(),
      lines: this.store.lines(),
      label: (line) => this.store.label(line),
      unitPx: this.store.unitPx(),
      viewScale: view.scale,
      selectedId: this.store.selectedId(),
      draft: this.store.drawsReference() ? null : this.draft(),
      reference: this.shownReference(),
      snapPoint: this.snapPoint(),
    });
  }
}

function fitView(image: PlanImage, width: number, height: number): View {
  const scale = Math.max(
    MIN_SCALE,
    Math.min(
      MAX_SCALE,
      (width - FIT_PADDING * 2) / image.width,
      (height - FIT_PADDING * 2) / image.height,
    ),
  );
  return {
    scale,
    x: (width - image.width * scale) / 2,
    y: (height - image.height * scale) / 2,
  };
}

export function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
