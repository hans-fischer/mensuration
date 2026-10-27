import { expect, Page, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

interface Pt {
  x: number;
  y: number;
}

/** Paints a simple floor plan in the browser and returns it as PNG bytes. */
async function planPng(page: Page, width = 1000, height = 600): Promise<Buffer> {
  const base64 = await page.evaluate(
    ([w, h]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = Math.max(4, w / 150);
      ctx.strokeRect(w * 0.1, h / 6, w * 0.8, (h * 2) / 3);
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 6);
      ctx.lineTo(w / 2, (h * 5) / 6);
      ctx.stroke();
      return canvas.toDataURL('image/png').split(',')[1];
    },
    [width, height],
  );
  return Buffer.from(base64, 'base64');
}

async function openPlan(page: Page, width = 1000, height = 600): Promise<void> {
  await page.goto('/');
  const buffer = await planPng(page, width, height);
  await page
    .getByTestId('file-input')
    .setInputFiles({ name: 'grundriss.png', mimeType: 'image/png', buffer });
  await expect(page.getByTestId('hint')).toContainText('deren Länge du kennst');
}

/** Page coordinates of a point given in plan image pixels, read from the canvas' current view. */
async function toPage(page: Page, p: Pt): Promise<Pt> {
  const canvas = page.locator('app-plan-canvas canvas');
  const box = (await canvas.boundingBox())!;
  const [scale, x, y] = await Promise.all(
    ['data-scale', 'data-x', 'data-y'].map(async (name) => Number(await canvas.getAttribute(name))),
  );
  return { x: box.x + x + p.x * scale, y: box.y + y + p.y * scale };
}

async function drag(page: Page, from: Pt, to: Pt): Promise<void> {
  const a = await toPage(page, from);
  const b = await toPage(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

/** Draws a 500 px reference along the top wall and enters its length. */
async function calibrate(page: Page, length = '500'): Promise<void> {
  await drag(page, { x: 100, y: 100 }, { x: 600, y: 100 });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox').fill(length);
  await dialog.getByRole('textbox').press('Enter');
  await expect(dialog).toBeHidden();
}

/** Text of the measurement in list row `index`, waiting until the row exists. */
async function valueAt(page: Page, index: number): Promise<string> {
  const cell = page.getByTestId('measure-value').nth(index);
  await expect(cell).toBeVisible();
  return (await cell.textContent())!;
}

/** Reads "1.234 cm" or "3,00 m" as centimetres. */
function toCm(text: string): number {
  const [, number, unit] = text.trim().match(/^([\d.,]+) (cm|m)$/)!;
  const value = Number(number.replace(/\./g, '').replace(',', '.'));
  return unit === 'm' ? value * 100 : value;
}

/** Decodes an image in the page and samples pixels at plan coordinates. */
async function inspectImage(page: Page, bytes: Buffer, mime: string, points: Pt[]) {
  return page.evaluate(
    async ({ base64, mime, points }) => {
      const img = new Image();
      img.src = `data:${mime};base64,${base64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      return {
        width: img.naturalWidth,
        height: img.naturalHeight,
        pixels: points.map((p) => Array.from(ctx.getImageData(p.x, p.y, 1, 1).data.slice(0, 3))),
      };
    },
    { base64: bytes.toString('base64'), mime, points },
  );
}

/** Colour of the on-screen canvas at a plan coordinate. */
async function screenPixel(page: Page, p: Pt): Promise<number[]> {
  return page.locator('app-plan-canvas canvas').evaluate((canvas: HTMLCanvasElement, p) => {
    const scale = Number(canvas.dataset['scale']);
    const dpr = window.devicePixelRatio || 1;
    const x = Math.round((Number(canvas.dataset['x']) + p.x * scale) * dpr);
    const y = Math.round((Number(canvas.dataset['y']) + p.y * scale) * dpr);
    return Array.from(canvas.getContext('2d')!.getImageData(x, y, 1, 1).data.slice(0, 3));
  }, p);
}

/** True for the reference's accent blue (31, 95, 174), with room for anti-aliasing. */
function isReferenceBlue([r, g, b]: number[]): boolean {
  return b > 140 && r < 90 && g < 130;
}

/** True where the default red rectangle's light fill covers white paper. */
function isRedFill([r, g, b]: number[]): boolean {
  return r > 240 && r - g > 15 && r - b > 15;
}

test('guides through opening a plan, setting the scale and measuring', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Maße auf einem Plan abnehmen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Als JPG speichern' })).toBeDisabled();

  await openPlan(page);
  await drag(page, { x: 100, y: 100 }, { x: 600, y: 100 });
  const dialog = page.getByRole('dialog', { name: 'Wie lang ist diese Strecke in Wirklichkeit?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox')).toBeFocused();
  // The reference is a tool, not a measurement: it never appears in the list.
  await expect(page.getByTestId('measure')).toHaveCount(0);

  await dialog.getByRole('textbox').fill('5 m');
  await dialog.getByRole('button', { name: 'Maßstab übernehmen' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('reference')).toHaveText('500 cm');
  await expect(page.getByTestId('hint')).toContainText('automatisch bemaßt');

  await drag(page, { x: 100, y: 300 }, { x: 400, y: 300 });
  const measured = await valueAt(page, 0);
  await expect(page.getByTestId('measure')).toHaveCount(1);
  expect(toCm(measured)).toBeGreaterThanOrEqual(297);
  expect(toCm(measured)).toBeLessThanOrEqual(303);

  await page.getByRole('button', { name: 'm', exact: true }).click();
  await expect(page.getByTestId('reference')).toHaveText('5,00 m');
  await expect(page.getByTestId('measure-value').nth(0)).toHaveText(/^\d,\d\d m$/);
});

test('rejects an invalid length and cancels with Escape', async ({ page }) => {
  await openPlan(page);
  await drag(page, { x: 100, y: 100 }, { x: 600, y: 100 });
  const dialog = page.getByRole('dialog');
  const input = dialog.getByRole('textbox');

  await input.fill('abc');
  await input.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Gib eine Länge größer als 0 ein');
  await expect(input).toHaveAttribute('aria-invalid', 'true');

  await input.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('measure')).toHaveCount(0);
  await expect(page.getByTestId('hint')).toContainText('deren Länge du kennst');

  // The next line is the reference again.
  await calibrate(page, '250');
  await expect(page.getByTestId('reference')).toHaveText('250 cm');
});

test('draws lines by click-click, straightens them with Shift and snaps to endpoints', async ({
  page,
}) => {
  await openPlan(page);
  await calibrate(page);

  // Click, move, click.
  const a = await toPage(page, { x: 100, y: 300 });
  const b = await toPage(page, { x: 300, y: 300 });
  await page.mouse.click(a.x, a.y);
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.mouse.click(b.x, b.y);
  expect(toCm(await valueAt(page, 0))).toBeCloseTo(200, -1);

  // Shift keeps a slanted drag horizontal: only the 400 px horizontal part counts.
  await page.keyboard.down('Shift');
  await drag(page, { x: 100, y: 450 }, { x: 500, y: 470 });
  await page.keyboard.up('Shift');
  const straight = toCm(await valueAt(page, 1));
  expect(straight).toBeGreaterThanOrEqual(398);
  expect(straight).toBeLessThanOrEqual(402);

  // Starting 6 px off the end of the first line snaps onto it: the vertical line is 200, not 196.
  await page.keyboard.down('Shift');
  await drag(page, { x: 305, y: 304 }, { x: 300, y: 500 });
  await page.keyboard.up('Shift');
  const snapped = toCm(await valueAt(page, 2));
  expect(snapped).toBeGreaterThanOrEqual(198.5);
  expect(snapped).toBeLessThanOrEqual(201.5);
});

test('selects, restyles, deletes and restores a line', async ({ page }) => {
  await openPlan(page);
  await calibrate(page);
  await drag(page, { x: 100, y: 300 }, { x: 400, y: 300 });
  await drag(page, { x: 100, y: 450 }, { x: 400, y: 450 });
  const rows = page.getByTestId('measure');
  await expect(rows).toHaveCount(2);

  await rows.nth(0).getByRole('button').first().click();
  await expect(rows.nth(0)).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'Auswahl' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Blau' }).click();
  await page.getByRole('button', { name: 'Linienstärke 5' }).click();
  await expect(rows.nth(0).locator('.dot')).toHaveCSS('background-color', 'rgb(31, 95, 174)');
  await expect(rows.nth(1).locator('.dot')).toHaveCSS('background-color', 'rgb(224, 48, 30)');

  // Click on the line itself selects it on the canvas, Delete removes it.
  await page.mouse.click(0, 0);
  const onLine = await toPage(page, { x: 250, y: 300 });
  await page.keyboard.press('Escape');
  await page.mouse.click(onLine.x, onLine.y);
  await expect(rows.nth(0)).toHaveClass(/selected/);
  await page.keyboard.press('Delete');
  await expect(rows).toHaveCount(1);

  await page.keyboard.press('ControlOrMeta+z');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('.dot')).toHaveCSS('background-color', 'rgb(31, 95, 174)');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(rows).toHaveCount(1);

  await page.getByRole('button', { name: 'Linie', exact: true }).click();
  await drag(page, { x: 100, y: 400 }, { x: 300, y: 400 });
  await expect(rows).toHaveCount(2);
  await rows.nth(1).getByRole('button', { name: 'Linie löschen' }).click();
  await expect(rows).toHaveCount(1);

  // Without a keyboard (phones hide the list), the status bar deletes the selection.
  await rows.nth(0).getByRole('button').first().click();
  await page.getByRole('button', { name: 'Ausgewählte Linie löschen' }).click();
  await expect(rows).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ausgewählte Linie löschen' })).toBeHidden();
  // Deleting lines never touches the scale.
  await expect(page.getByTestId('reference')).toHaveText('500 cm');
});

for (const width of [1280, 390]) {
  test(`selecting a line keeps the plan in place at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openPlan(page);
    await calibrate(page);
    await drag(page, { x: 100, y: 300 }, { x: 400, y: 300 });
    await expect(page.getByTestId('measure-value')).toHaveCount(1);
    const canvas = page.locator('app-plan-canvas canvas');
    const view = () =>
      Promise.all(['data-scale', 'data-x', 'data-y'].map((name) => canvas.getAttribute(name)));
    const before = await view();

    await page.getByRole('button', { name: 'Auswahl' }).click();
    const onLine = await toPage(page, { x: 250, y: 300 });
    await page.mouse.click(onLine.x, onLine.y);
    await expect(page.getByRole('button', { name: 'Ausgewählte Linie löschen' })).toBeVisible();
    expect(await view()).toEqual(before);
  });
}

test('the reference disappears once its length is entered', async ({ page }) => {
  await openPlan(page);
  await drag(page, { x: 100, y: 100 }, { x: 600, y: 100 });
  await expect(page.getByRole('dialog')).toBeVisible();
  // While asking, the reference's "? cm" box is shown in the accent colour. (332, 85) lies in the
  // box's left padding above the line's midpoint, where no glyph is drawn.
  const inBox = { x: 332, y: 85 };
  expect(isReferenceBlue(await screenPixel(page, inBox))).toBe(true);

  await page.getByRole('dialog').getByRole('textbox').fill('500');
  await page.getByRole('dialog').getByRole('textbox').press('Enter');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect.poll(async () => isReferenceBlue(await screenPixel(page, inBox))).toBe(false);
  expect(Math.min(...(await screenPixel(page, inBox)))).toBeGreaterThan(235);
});

test('a new reference replaces the old one and re-dimensions every line', async ({ page }) => {
  await openPlan(page);
  await calibrate(page);
  await drag(page, { x: 100, y: 300 }, { x: 400, y: 300 });
  const before = toCm(await valueAt(page, 0));

  // Same 500 cm over half the pixels: every length doubles.
  await page.getByRole('button', { name: 'Neu festlegen' }).click();
  await expect(page.getByRole('button', { name: 'Maßstab' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByTestId('hint')).toContainText('ersetzt die bisherige Referenz');
  await drag(page, { x: 100, y: 500 }, { x: 350, y: 500 });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('ersetzt den bisherigen Maßstab');
  await dialog.getByRole('textbox').fill('500');
  await dialog.getByRole('textbox').press('Enter');
  await expect.poll(async () => toCm(await valueAt(page, 0)) / before).toBeGreaterThan(1.97);
  expect(toCm(await valueAt(page, 0)) / before).toBeLessThan(2.03);
  await expect(page.getByTestId('measure')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Linie', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const doubled = await valueAt(page, 0);

  // A third reference, cancelled: the last entered one stays in force.
  await page.keyboard.press('r');
  await drag(page, { x: 100, y: 520 }, { x: 200, y: 520 });
  await dialog.getByRole('textbox').press('Escape');
  await expect(dialog).toBeHidden();
  expect(await valueAt(page, 0)).toBe(doubled);

  // Undo brings the first reference back.
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => Math.abs(toCm(await valueAt(page, 0)) - before)).toBeLessThan(1);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.getByTestId('measure-value').nth(0)).toHaveText(doubled);

  // Correcting the entered length keeps the reference distance.
  await page.getByRole('button', { name: 'Länge ändern' }).click();
  const input = dialog.getByRole('textbox');
  await expect(input).toHaveValue('500');
  await input.fill('250');
  await input.press('Enter');
  await expect.poll(async () => Math.abs(toCm(await valueAt(page, 0)) - before)).toBeLessThan(3);
  await expect(page.getByTestId('reference')).toHaveText('250 cm');
});

test('places a rectangle of fixed size, then moves, turns and resizes it', async ({ page }) => {
  await openPlan(page);
  const add = page.getByRole('button', { name: 'Rechteck', exact: true });
  await expect(add).toBeDisabled();
  await calibrate(page);

  await add.click();
  const dialog = page.getByRole('dialog', { name: 'Rechteck mit festen Maßen' });
  await dialog.getByRole('textbox', { name: 'Länge' }).fill('200');
  await dialog.getByRole('textbox', { name: 'Breite' }).fill('abc');
  await dialog.getByRole('button', { name: 'Rechteck einsetzen' }).click();
  await expect(dialog).toContainText('Gib beide Längen größer als 0 ein');
  await dialog.getByRole('textbox', { name: 'Breite' }).fill('100');
  await dialog.getByRole('button', { name: 'Rechteck einsetzen' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('measure-value')).toHaveText(['200 × 100 cm']);
  await expect(page.getByRole('button', { name: 'Ausgewähltes Rechteck löschen' })).toBeVisible();

  // 1 cm = 1 px: the rectangle sits in the middle of the view, x 400–600, y 250–350.
  await expect.poll(async () => isRedFill(await screenPixel(page, { x: 450, y: 310 }))).toBe(true);

  // Dragging moves it 200 px left and 150 px down: x 200–400, y 400–500.
  await drag(page, { x: 450, y: 310 }, { x: 250, y: 460 });
  await expect.poll(async () => isRedFill(await screenPixel(page, { x: 250, y: 460 }))).toBe(true);
  expect(isRedFill(await screenPixel(page, { x: 450, y: 310 }))).toBe(false);

  // The JPG carries the rectangle where it was moved to.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Als JPG speichern' }).click();
  const bytes = await readFile((await (await download).path())!);
  const exported = await inspectImage(page, bytes, 'image/jpeg', [
    { x: 250, y: 460 },
    { x: 450, y: 310 },
  ]);
  expect(isRedFill(exported.pixels[0])).toBe(true);
  expect(Math.min(...exported.pixels[1])).toBeGreaterThan(235);

  // Turned by 90° around its centre (300, 450): x 250–350, y 350–550. Samples stay at x = 270,
  // clear of the edge labels centred on x = 300.
  await page.getByRole('button', { name: 'Um 90° drehen' }).click();
  await expect.poll(async () => isRedFill(await screenPixel(page, { x: 270, y: 530 }))).toBe(true);

  // Longer edge 300 cm: y 300–600.
  await page.getByRole('button', { name: 'Maße ändern' }).click();
  const edit = page.getByRole('dialog', { name: 'Maße des Rechtecks' });
  await expect(edit.getByRole('textbox', { name: 'Länge' })).toHaveValue('200');
  await expect(edit.getByRole('textbox', { name: 'Breite' })).toHaveValue('100');
  await edit.getByRole('textbox', { name: 'Länge' }).fill('300');
  await edit.getByRole('button', { name: 'Maße übernehmen' }).click();
  await expect(page.getByTestId('measure-value')).toHaveText(['300 × 100 cm']);
  await expect.poll(async () => isRedFill(await screenPixel(page, { x: 270, y: 580 }))).toBe(true);

  // A new scale (250 px = 500 cm) keeps the real size and halves the drawing: y 375–525,
  await page.keyboard.press('r');
  await drag(page, { x: 600, y: 560 }, { x: 850, y: 560 });
  await page.getByRole('dialog').getByRole('textbox').fill('500');
  await page.getByRole('dialog').getByRole('textbox').press('Enter');
  // x 275–325 now; (285, 390) is inside and away from both labels.
  await expect.poll(async () => isRedFill(await screenPixel(page, { x: 270, y: 580 }))).toBe(false);
  expect(isRedFill(await screenPixel(page, { x: 285, y: 390 }))).toBe(true);
  await expect(page.getByTestId('measure-value')).toHaveText(['300 × 100 cm']);

  // Delete from the list, undo brings it back.
  await page.getByTestId('measure').getByRole('button', { name: 'Rechteck löschen' }).click();
  await expect(page.getByTestId('measure')).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('measure-value')).toHaveText(['300 × 100 cm']);
});

test('snaps a line end onto a rectangle corner', async ({ page }) => {
  await openPlan(page);
  await calibrate(page);
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Länge' }).fill('200');
  await dialog.getByRole('textbox', { name: 'Breite' }).fill('100');
  await dialog.getByRole('textbox', { name: 'Breite' }).press('Enter');
  await page.getByRole('button', { name: 'Linie', exact: true }).click();

  // The corner is at (600, 350). Starting 6 px off and ending straight down at y = 550 gives 200.
  await page.keyboard.down('Shift');
  await drag(page, { x: 605, y: 354 }, { x: 600, y: 550 });
  await page.keyboard.up('Shift');
  const measured = toCm(await valueAt(page, 1));
  expect(measured).toBeGreaterThanOrEqual(198.5);
  expect(measured).toBeLessThanOrEqual(201.5);
});

test('measures accurately after zooming and panning', async ({ page }) => {
  await openPlan(page);
  await calibrate(page);
  const zoom = page.getByTestId('zoom');
  const fitted = await zoom.textContent();

  const centre = await toPage(page, { x: 500, y: 300 });
  await page.mouse.move(centre.x, centre.y);
  await page.keyboard.down('ControlOrMeta');
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, -100);
  }
  await page.keyboard.up('ControlOrMeta');
  await expect(zoom).not.toHaveText(fitted!);
  await page.mouse.wheel(30, 40);

  await drag(page, { x: 420, y: 250 }, { x: 560, y: 250 });
  const measured = toCm(await valueAt(page, 0));
  expect(measured).toBeGreaterThanOrEqual(139);
  expect(measured).toBeLessThanOrEqual(141);

  await page.getByRole('button', { name: 'Einpassen' }).click();
  await expect(zoom).toHaveText(fitted!);
});

test('zooms on Safari trackpad pinch gestures', async ({ page }) => {
  await openPlan(page);
  const canvas = page.locator('app-plan-canvas canvas');
  const fitted = Number(await canvas.getAttribute('data-scale'));
  // Playwright cannot pinch; this replays the event sequence WebKit sends for one.
  await canvas.evaluate((canvas) => {
    const send = (type: string, scale: number) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: 400,
        clientY: 300,
      });
      Object.defineProperty(event, 'scale', { value: scale });
      canvas.dispatchEvent(event);
    };
    send('gesturestart', 1);
    send('gesturechange', 1.5);
    send('gesturechange', 2);
    send('gestureend', 2);
  });
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-scale')) / fitted)
    .toBeCloseTo(2, 6);
});

test('saves the dimensioned plan as JPG at full resolution', async ({ page }) => {
  await openPlan(page);
  await calibrate(page);
  await page.getByRole('button', { name: 'Linienstärke 5' }).click();
  await drag(page, { x: 100, y: 300 }, { x: 400, y: 300 });
  await page.getByRole('button', { name: 'Auswahl' }).click();
  await page.getByTestId('measure').nth(0).getByRole('button').first().click();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Als JPG speichern' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('grundriss-bemasst.jpg');
  const bytes = await readFile((await file.path())!);
  expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));

  const image = await inspectImage(page, bytes, 'image/jpeg', [
    { x: 250, y: 300 },
    { x: 750, y: 50 },
    { x: 400, y: 380 },
    { x: 332, y: 85 },
  ]);
  expect(image.width).toBe(1000);
  expect(image.height).toBe(600);
  const [onLine, paper, belowLine, referenceLabel] = image.pixels;
  // The reference and its length are not part of the result.
  expect(Math.min(...referenceLabel)).toBeGreaterThan(235);
  expect(onLine[0]).toBeGreaterThan(180);
  expect(onLine[1]).toBeLessThan(110);
  expect(onLine[2]).toBeLessThan(110);
  expect(Math.min(...paper)).toBeGreaterThan(235);
  // No selection highlight in the export.
  expect(Math.min(...belowLine)).toBeGreaterThan(235);
});

test('prints only the plan', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed =
        document.querySelector<HTMLImageElement>('.print-sheet img')?.naturalWidth ?? -1;
    };
  });
  await openPlan(page);
  await calibrate(page);
  await page.getByRole('button', { name: 'Drucken' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed))
    .toBe(1000);

  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.print-sheet img')).toBeVisible();
  await expect(page.locator('.toolbar')).toBeHidden();
  await expect(page.locator('app-root')).toBeHidden();
});

test('opens a plan dropped onto the board', async ({ page }) => {
  await page.goto('/');
  const buffer = await planPng(page);
  const transfer = await page.evaluateHandle((base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'skizze.png', { type: 'image/png' }));
    return data;
  }, buffer.toString('base64'));
  await page.locator('main.workspace').dispatchEvent('dragover', { dataTransfer: transfer });
  await expect(page.locator('main.workspace')).toHaveClass(/drag-over/);
  await page.locator('main.workspace').dispatchEvent('drop', { dataTransfer: transfer });
  await expect(page.getByTestId('hint')).toContainText('deren Länge du kennst');
  await expect(page.locator('main.workspace')).not.toHaveClass(/drag-over/);
});

test('works on large scans by measuring on a reduced copy', async ({ page }) => {
  await openPlan(page, 6000, 4000);
  await calibrate(page);
  await drag(page, { x: 1000, y: 1000 }, { x: 2000, y: 1000 });
  const measured = toCm(await valueAt(page, 0));
  expect(measured).toBeGreaterThanOrEqual(990);
  expect(measured).toBeLessThanOrEqual(1010);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Als JPG speichern' }).click();
  const bytes = await readFile((await (await download).path())!);
  const image = await inspectImage(page, bytes, 'image/jpeg', []);
  expect(image.width * image.height).toBeLessThanOrEqual(16_000_000);
  expect(image.width / image.height).toBeCloseTo(1.5, 2);
});

test('explains files that are not images', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({
    name: 'notizen.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('kein Bild'),
  });
  await expect(page.getByRole('alert')).toContainText(
    '„notizen.txt“ lässt sich im Browser nicht als Bild öffnen',
  );
});

test('asks before replacing a plan that has a scale', async ({ page }) => {
  await openPlan(page);
  await calibrate(page);
  const buffer = await planPng(page);

  page.once('dialog', (d) => d.dismiss());
  await page
    .getByTestId('file-input')
    .setInputFiles({ name: 'neu.png', mimeType: 'image/png', buffer });
  await expect(page.getByTestId('reference')).toHaveText('500 cm');

  page.once('dialog', (d) => d.accept());
  await page
    .getByTestId('file-input')
    .setInputFiles({ name: 'neu2.png', mimeType: 'image/png', buffer });
  await expect(page.getByTestId('reference')).toBeHidden();
  await expect(page.getByTestId('hint')).toContainText('deren Länge du kennst');
});
