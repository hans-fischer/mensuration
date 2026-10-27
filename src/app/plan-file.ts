import { workingSize } from './geometry';
import { PlanImage } from './model';
import { drawPlan, LABEL_FONT_FAMILY, RenderOptions } from './render';

/**
 * Upper bound for the working copy of a plan. Browsers refuse or silently blank canvases beyond
 * roughly 16.7 million pixels (Safari on iOS); a downscaled copy measures just as well because the
 * scale is calibrated on the copy itself.
 */
export const MAX_WORKING_PIXELS = 16_000_000;

export class PlanFileError extends Error {}

export async function loadPlanImage(file: Blob, name: string): Promise<PlanImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new PlanFileError(
        `„${name}“ lässt sich im Browser nicht als Bild öffnen. Unterstützt werden z. B. JPG, PNG, WebP und GIF.`,
      );
    }
    if (!img.naturalWidth || !img.naturalHeight) {
      throw new PlanFileError(`„${name}“ hat keine Bildgröße und lässt sich nicht bemaßen.`);
    }
    const size = workingSize(img.naturalWidth, img.naturalHeight, MAX_WORKING_PIXELS);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new PlanFileError('Der Browser stellt keine Zeichenfläche bereit.');
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, size.width, size.height);
    return { source: canvas, width: size.width, height: size.height, name };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Renders the plan at its working resolution, without selection or other screen-only marks. */
export async function renderJpeg(
  image: PlanImage,
  options: Pick<RenderOptions, 'rects' | 'lines' | 'label' | 'unitPx'>,
): Promise<Blob> {
  await document.fonts.load(`600 20px ${LABEL_FONT_FAMILY}`);
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new PlanFileError('Der Browser stellt keine Zeichenfläche bereit.');
  }
  drawPlan(ctx, image, { ...options, viewScale: 1 });
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new PlanFileError('Das JPG konnte nicht erzeugt werden.')),
      'image/jpeg',
      0.92,
    ),
  );
}

export function exportFileName(planName: string): string {
  const base = planName.replace(/\.[^.]+$/, '').trim() || 'plan';
  return `${base}-bemasst.jpg`;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Prints only the rendered plan: a print-only sheet with the image is added to the page, the rest
 * of the interface is hidden by the print stylesheet, and the sheet is removed after printing.
 */
export async function printBlob(blob: Blob, landscape: boolean): Promise<void> {
  document.querySelectorAll('.print-sheet, style[data-print-page]').forEach((el) => el.remove());
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  img.alt = '';
  await img.decode();
  const sheet = document.createElement('div');
  sheet.className = 'print-sheet';
  sheet.append(img);
  const page = document.createElement('style');
  page.dataset['printPage'] = '';
  page.textContent = `@page { size: ${landscape ? 'landscape' : 'portrait'}; margin: 10mm; }`;
  document.head.append(page);
  document.body.append(sheet);
  window.addEventListener(
    'afterprint',
    () => {
      sheet.remove();
      page.remove();
      URL.revokeObjectURL(url);
    },
    { once: true },
  );
  window.print();
}
