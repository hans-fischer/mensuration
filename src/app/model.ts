export interface Point {
  x: number;
  y: number;
}

/** A drawn line in image pixel coordinates. */
export interface Line {
  id: number;
  a: Point;
  b: Point;
  color: string;
  /** Stroke weight step; multiplied by the image's style unit when rendered. */
  thickness: number;
}

/**
 * A rectangle of fixed real size, e.g. a piece of furniture to try on the plan. Its size is kept in
 * centimetres, so a new scale changes how big it is drawn, never how big it is.
 */
export interface Rect {
  id: number;
  /** Centre in image pixels. */
  center: Point;
  widthCm: number;
  heightCm: number;
  /** Clockwise turn in degrees. */
  angle: number;
  color: string;
  thickness: number;
}

/**
 * The distance whose real length the user entered. It defines the scale and is not part of the
 * drawing: it is shown only while it is being drawn or asked about.
 */
export interface Reference {
  a: Point;
  b: Point;
  cm: number;
}

/** `reference` draws a new reference; the last one entered sets the scale for all lines. */
export type Tool = 'draw' | 'select' | 'reference';

export type Unit = 'cm' | 'm';

export interface PlanImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  name: string;
}

export const COLORS: readonly { value: string; name: string }[] = [
  { value: '#e0301e', name: 'Rot' },
  { value: '#1f5fae', name: 'Blau' },
  { value: '#1e8c4e', name: 'Grün' },
  { value: '#f08a00', name: 'Orange' },
  { value: '#c2185b', name: 'Magenta' },
  { value: '#1d2a33', name: 'Schwarz' },
];

/** Colour of the reference while it is shown: the interface accent, as it is a tool, not a line. */
export const REFERENCE_COLOR = '#1f5fae';

/** Stroke weights follow the √2 progression of technical pen sets. */
export const THICKNESSES: readonly number[] = [1, 1.4, 2, 2.8, 4];
