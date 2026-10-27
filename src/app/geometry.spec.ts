import {
  constrainAngle,
  distanceToSegment,
  formatLength,
  formatSize,
  hitEndpoint,
  hitLine,
  nearestPoint,
  parseLengthCm,
  pointInRect,
  readableAngle,
  rectCorners,
  styleUnit,
  workingSize,
} from './geometry';
import { Line } from './model';

const line = (id: number, ax: number, ay: number, bx: number, by: number): Line => ({
  id,
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
  color: '#000000',
  thickness: 1,
});

describe('parseLengthCm', () => {
  it.each([
    ['350', 350],
    ['350,5', 350.5],
    ['350.5', 350.5],
    [' 42 cm ', 42],
    ['3,5 m', 350],
    ['3.5m', 350],
    ['35 mm', 3.5],
    [',5', 0.5],
    ['12 CM', 12],
  ])('reads %j as %d cm', (input, expected) => {
    expect(parseLengthCm(input)).toBeCloseTo(expected, 9);
  });

  it.each(['', '0', '0,0', '-5', 'abc', '3,5,1', '1 000', '5 km', '1e3', '1.000', '3.500 cm'])(
    'rejects %j',
    (input) => {
      expect(parseLengthCm(input)).toBeNull();
    },
  );

  it('still reads three decimals after a comma', () => {
    expect(parseLengthCm('1,250 m')).toBeCloseTo(125);
  });
});

describe('formatLength', () => {
  it('rounds centimetres to whole numbers with German grouping', () => {
    expect(formatLength(350.4, 'cm')).toBe('350 cm');
    expect(formatLength(1234.6, 'cm')).toBe('1.235 cm');
  });

  it('keeps one decimal below 10 cm', () => {
    expect(formatLength(4.56, 'cm')).toBe('4,6 cm');
  });

  it('shows metres with two decimals and a decimal comma', () => {
    expect(formatLength(351.2, 'm')).toBe('3,51 m');
    expect(formatLength(50, 'm')).toBe('0,50 m');
  });
});

describe('constrainAngle', () => {
  it('snaps a nearly horizontal line to horizontal', () => {
    const p = constrainAngle({ x: 0, y: 0 }, { x: 100, y: 8 });
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(0);
  });

  it('snaps a nearly vertical line to vertical', () => {
    const p = constrainAngle({ x: 10, y: 10 }, { x: 14, y: -90 });
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(-90);
  });

  it('snaps to the diagonal, keeping the projected length', () => {
    const p = constrainAngle({ x: 0, y: 0 }, { x: 100, y: 90 });
    expect(p.x).toBeCloseTo(p.y);
    expect(p.x).toBeCloseTo(95);
  });
});

describe('nearestPoint', () => {
  const candidates = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ];

  it('returns the closest candidate within the radius', () => {
    expect(nearestPoint({ x: 8, y: 1 }, candidates, 5)).toEqual({ x: 10, y: 0 });
  });

  it('returns null when nothing is within the radius', () => {
    expect(nearestPoint({ x: 5, y: 20 }, candidates, 5)).toBeNull();
  });
});

describe('hit testing', () => {
  it('measures the distance to a segment, clamped to its ends', () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(3);
    expect(distanceToSegment({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(5);
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(5);
  });

  it('picks the topmost line', () => {
    const lines = [line(1, 0, 0, 100, 0), line(2, 0, 2, 100, 2)];
    expect(hitLine(lines, { x: 50, y: 1 }, 3)?.id).toBe(2);
    expect(hitLine(lines, { x: 50, y: 20 }, 3)).toBeNull();
  });

  it('finds the nearer endpoint', () => {
    const l = line(1, 0, 0, 100, 0);
    expect(hitEndpoint(l, { x: 2, y: 1 }, 5)).toBe('a');
    expect(hitEndpoint(l, { x: 97, y: 0 }, 5)).toBe('b');
    expect(hitEndpoint(l, { x: 50, y: 0 }, 5)).toBeNull();
  });
});

describe('readableAngle', () => {
  it('keeps left-to-right lines as they are', () => {
    expect(readableAngle({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(0);
  });

  it('turns right-to-left lines so text is not upside down', () => {
    expect(readableAngle({ x: 10, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(0);
  });

  it('reads vertical lines bottom to top in both directions', () => {
    expect(readableAngle({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(-Math.PI / 2);
    expect(readableAngle({ x: 0, y: 10 }, { x: 0, y: 0 })).toBeCloseTo(-Math.PI / 2);
  });
});

describe('sizes', () => {
  it('scales the style unit with the long side of the image, never below 1', () => {
    expect(styleUnit(500, 300)).toBe(1);
    expect(styleUnit(4000, 3000)).toBe(4);
  });

  it('shrinks large images to the pixel budget and keeps the aspect ratio', () => {
    const size = workingSize(8000, 6000, 12_000_000);
    expect(size.width * size.height).toBeLessThanOrEqual(12_000_000);
    expect(size.width / size.height).toBeCloseTo(8000 / 6000, 2);
  });

  it('never rounds up past the pixel budget', () => {
    const size = workingSize(6000, 4000, 16_000_000);
    expect(size.width * size.height).toBeLessThanOrEqual(16_000_000);
  });

  it('leaves small images untouched', () => {
    expect(workingSize(1200, 800, 16_000_000)).toEqual({ width: 1200, height: 800 });
  });
});

describe('rectangles', () => {
  it('formats both edges with one unit', () => {
    expect(formatSize(200, 90, 'cm')).toBe('200 × 90 cm');
    expect(formatSize(200, 90.5, 'm')).toBe('2,00 × 0,91 m');
  });

  it('places corners around the centre', () => {
    expect(rectCorners({ x: 100, y: 50 }, 40, 20, 0)).toEqual([
      { x: 80, y: 40 },
      { x: 120, y: 40 },
      { x: 120, y: 60 },
      { x: 80, y: 60 },
    ]);
  });

  it('turns corners clockwise on screen', () => {
    const [topLeft, topRight] = rectCorners({ x: 0, y: 0 }, 40, 20, 90);
    expect(topLeft.x).toBeCloseTo(10);
    expect(topLeft.y).toBeCloseTo(-20);
    expect(topRight.x).toBeCloseTo(10);
    expect(topRight.y).toBeCloseTo(20);
  });

  it('finds points inside a turned rectangle', () => {
    expect(pointInRect({ x: 15, y: 5 }, { x: 0, y: 0 }, 40, 20, 0)).toBe(true);
    expect(pointInRect({ x: 5, y: 15 }, { x: 0, y: 0 }, 40, 20, 0)).toBe(false);
    expect(pointInRect({ x: 5, y: 15 }, { x: 0, y: 0 }, 40, 20, 90)).toBe(true);
    expect(pointInRect({ x: 22, y: 0 }, { x: 0, y: 0 }, 40, 20, 0, 3)).toBe(true);
  });
});
