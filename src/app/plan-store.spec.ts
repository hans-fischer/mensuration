import { TestBed } from '@angular/core/testing';
import { PlanImage } from './model';
import { PlanStore } from './plan-store';

const plan: PlanImage = {
  source: {} as CanvasImageSource,
  width: 1000,
  height: 600,
  name: 'plan.png',
};
const p = (x: number, y: number) => ({ x, y });

describe('PlanStore', () => {
  let store: PlanStore;

  beforeEach(() => {
    store = TestBed.inject(PlanStore);
    store.loadImage(plan);
  });

  /** Declares a 500 px distance to be 250 cm: 0.5 cm per pixel. */
  function calibrate(cm = 250, px = 500): void {
    store.startCalibration(p(100, 100), p(100 + px, 100));
    store.confirmCalibration(cm);
  }

  it('starts empty and asks for a reference once a plan is loaded', () => {
    expect(store.phase()).toBe('calibrate');
    expect(store.drawsReference()).toBe(true);
    expect(new PlanStore().phase()).toBe('empty');
  });

  it('measures lines with the entered scale', () => {
    calibrate();
    expect(store.phase()).toBe('measure');
    expect(store.drawsReference()).toBe(false);
    expect(store.cmPerPx()).toBeCloseTo(0.5);
    const line = store.addLine(p(0, 0), p(300, 400));
    expect(store.lengthCm(line)).toBeCloseTo(250);
    expect(store.label(line)).toBe('250 cm');
    store.unit.set('m');
    expect(store.label(line)).toBe('2,50 m');
  });

  it('does not keep the reference as a line', () => {
    calibrate();
    expect(store.lines()).toEqual([]);
    expect(store.reference()).toEqual({ a: p(100, 100), b: p(600, 100), cm: 250 });
  });

  it('keeps the plan uncalibrated when the first question is cancelled', () => {
    store.startCalibration(p(100, 100), p(600, 100));
    store.cancelCalibration();
    expect(store.reference()).toBeNull();
    expect(store.canUndo()).toBe(false);
    expect(store.phase()).toBe('calibrate');
  });

  it('replaces the reference with a new one and re-dimensions every line', () => {
    calibrate();
    const line = store.addLine(p(0, 0), p(100, 0));
    expect(store.label(line)).toBe('50 cm');

    store.setTool('reference');
    expect(store.drawsReference()).toBe(true);
    // 250 px are 250 cm now: 1 cm per pixel.
    store.startCalibration(p(0, 300), p(250, 300));
    store.confirmCalibration(250);
    expect(store.label(line)).toBe('100 cm');
    expect(store.reference()?.b).toEqual(p(250, 300));
    expect(store.tool()).toBe('draw');
    expect(store.lines()).toHaveLength(1);
  });

  it('keeps the previous reference when a new one is cancelled', () => {
    calibrate();
    const line = store.addLine(p(0, 0), p(100, 0));
    store.setTool('reference');
    store.startCalibration(p(0, 300), p(250, 300));
    store.cancelCalibration();
    expect(store.label(line)).toBe('50 cm');
    expect(store.reference()?.cm).toBe(250);
    expect(store.tool()).toBe('reference');
  });

  it('brings the previous reference back on undo', () => {
    calibrate();
    const line = store.addLine(p(0, 0), p(100, 0));
    calibrate(400);
    expect(store.label(line)).toBe('80 cm');
    store.undo();
    expect(store.label(line)).toBe('50 cm');
    store.redo();
    expect(store.label(line)).toBe('80 cm');
  });

  it('corrects the length of the current reference', () => {
    calibrate();
    const line = store.addLine(p(0, 0), p(100, 0));
    store.editCalibration();
    expect(store.calibration()).toEqual({ a: p(100, 100), b: p(600, 100), edit: true });
    store.confirmCalibration(500);
    expect(store.label(line)).toBe('100 cm');
    store.undo();
    expect(store.label(line)).toBe('50 cm');
  });

  it('undoes and redoes line additions and deletions', () => {
    calibrate();
    const line = store.addLine(p(0, 0), p(100, 0));
    store.deleteItem(line.id);
    expect(store.lines()).toHaveLength(0);
    store.undo();
    expect(store.lines()).toHaveLength(1);
    store.undo();
    expect(store.lines()).toHaveLength(0);
    store.undo();
    expect(store.phase()).toBe('calibrate');
    store.redo();
    expect(store.phase()).toBe('measure');
    store.redo();
    store.redo();
    expect(store.lines()).toHaveLength(0);
    expect(store.canRedo()).toBe(false);
  });

  it('records a drag as one undo step and ignores drags without movement', () => {
    calibrate();
    const line = store.addLine(p(0, 0), p(100, 0));
    const idle = store.snapshot();
    store.commit(idle);
    store.undo();
    expect(store.lines()).toHaveLength(0);
    store.redo();

    const before = store.snapshot();
    store.updateLine(line.id, { b: p(150, 0) });
    store.updateLine(line.id, { b: p(200, 0) });
    store.commit(before);
    store.undo();
    expect(store.lines().find((l) => l.id === line.id)?.b).toEqual(p(100, 0));
  });

  it('applies colour and thickness to the selected line only', () => {
    calibrate();
    const first = store.addLine(p(0, 0), p(100, 0));
    const second = store.addLine(p(0, 50), p(100, 50));
    store.select(first.id);
    expect(store.tool()).toBe('select');
    store.setColor('#1f5fae');
    store.setThickness(4);
    const lines = store.lines();
    expect(lines.find((l) => l.id === first.id)).toMatchObject({ color: '#1f5fae', thickness: 4 });
    expect(lines.find((l) => l.id === second.id)?.color).toBe('#e0301e');
    store.undo();
    expect(store.lines().find((l) => l.id === first.id)?.thickness).toBe(second.thickness);
  });

  it('clears the selection when switching to drawing or a new reference', () => {
    calibrate();
    const line = store.addLine(p(0, 0), p(100, 0));
    store.select(line.id);
    store.setTool('reference');
    expect(store.selectedId()).toBeNull();
  });

  it('blocks undo while the length question is open', () => {
    calibrate();
    store.addLine(p(0, 0), p(100, 0));
    store.editCalibration();
    store.undo();
    expect(store.lines()).toHaveLength(1);
  });

  it('places a rectangle of real size and keeps that size under a new scale', () => {
    calibrate();
    store.setColor('#1e8c4e');
    const rect = store.addRect(p(500, 300), 200, 90);
    expect(store.selectedRect()?.id).toBe(rect.id);
    expect(store.tool()).toBe('select');
    expect(store.rectLabel(rect)).toBe('200 × 90 cm');
    // 0.5 cm per pixel: 400 × 180 px.
    expect(store.rectSizePx(rect)).toEqual({ width: 400, height: 180 });
    expect(store.rectShapes()[0]).toMatchObject({
      widthLabel: '200 cm',
      heightLabel: '90 cm',
      color: '#1e8c4e',
    });

    calibrate(250, 250);
    expect(store.rectSizePx(store.rects()[0])).toEqual({ width: 200, height: 90 });
    expect(store.rectLabel(store.rects()[0])).toBe('200 × 90 cm');
    store.unit.set('m');
    expect(store.rectLabel(store.rects()[0])).toBe('2,00 × 0,90 m');
  });

  it('moves, rotates, resizes and deletes a rectangle with undo', () => {
    calibrate();
    const rect = store.addRect(p(500, 300), 200, 90);

    const before = store.snapshot();
    store.updateRect(rect.id, { center: p(300, 200) });
    store.commit(before);
    store.rotateRect(rect.id);
    store.rotateRect(rect.id);
    store.resizeRect(rect.id, 160, 80);
    expect(store.rects()[0]).toMatchObject({ center: p(300, 200), angle: 180, widthCm: 160 });

    store.undo();
    expect(store.rects()[0].widthCm).toBe(200);
    store.undo();
    store.undo();
    expect(store.rects()[0].angle).toBe(0);
    store.undo();
    expect(store.rects()[0].center).toEqual(p(500, 300));

    store.deleteItem(rect.id);
    expect(store.rects()).toEqual([]);
    expect(store.selectedId()).toBeNull();
    store.undo();
    expect(store.rects()).toHaveLength(1);
  });

  it('restyles the selected rectangle', () => {
    calibrate();
    const rect = store.addRect(p(500, 300), 200, 90);
    store.setThickness(4);
    expect(store.rects()[0].thickness).toBe(4);
    store.undo();
    expect(store.rects()[0].thickness).toBe(rect.thickness);
  });

  it('offers rectangle corners and line ends as snap points', () => {
    calibrate();
    const line = store.addLine(p(0, 0), p(10, 0));
    store.addRect(p(500, 300), 100, 50);
    const points = store.snapPoints();
    expect(points).toContainEqual(p(0, 0));
    expect(points).toContainEqual(p(400, 250));
    expect(points).toContainEqual(p(600, 350));
    expect(store.snapPoints(line.id)).not.toContainEqual(p(0, 0));
  });

  it('starts over when another plan is loaded', () => {
    calibrate();
    store.addLine(p(0, 0), p(100, 0));
    store.addRect(p(500, 300), 100, 50);
    store.loadImage({ ...plan, name: 'other.png' });
    expect(store.lines()).toEqual([]);
    expect(store.rects()).toEqual([]);
    expect(store.reference()).toBeNull();
    expect(store.canUndo()).toBe(false);
  });
});
