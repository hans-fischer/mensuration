import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { formatLength, parseLengthCm } from './geometry';
import { COLORS, THICKNESSES } from './model';
import { isEditable, PlanCanvas } from './plan-canvas';
import {
  downloadBlob,
  exportFileName,
  loadPlanImage,
  PlanFileError,
  printBlob,
  renderJpeg,
} from './plan-file';
import { PlanStore } from './plan-store';

const ZOOM_STEP = 1.25;

@Component({
  selector: 'app-root',
  imports: [NgTemplateOutlet, PlanCanvas],
  templateUrl: './app.html',
  styleUrl: './app.css',
  host: {
    '(document:keydown)': 'onKeyDown($event)',
    '(window:paste)': 'onPaste($event)',
    '(window:beforeunload)': 'onBeforeUnload($event)',
  },
})
export class App {
  protected readonly store = inject(PlanStore);
  protected readonly colors = COLORS;
  protected readonly thicknesses = THICKNESSES;
  protected readonly modKey = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Strg';

  private readonly canvas = viewChild.required(PlanCanvas);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('calibrationDialog');
  private readonly lengthInput = viewChild.required<ElementRef<HTMLInputElement>>('lengthInput');
  private readonly rectDialog = viewChild.required<ElementRef<HTMLDialogElement>>('rectDialog');
  private readonly rectWidthInput = viewChild.required<ElementRef<HTMLInputElement>>('rectWidth');
  private readonly rectHeightInput = viewChild.required<ElementRef<HTMLInputElement>>('rectHeight');

  protected readonly error = signal<string | null>(null);
  protected readonly lengthInvalid = signal(false);
  protected readonly dragOver = signal(false);
  protected readonly busy = signal(false);
  /** Open rectangle dialog: `new`, or the id of the rectangle whose size is changed. */
  protected readonly rectEdit = signal<'new' | number | null>(null);
  protected readonly rectInvalid = signal(false);

  protected readonly zoomPercent = computed(() => Math.round(this.canvas().view().scale * 100));
  /** Lines and rectangles in the order they were made. */
  protected readonly rows = computed(() =>
    [
      ...this.store.lines().map((line) => ({
        id: line.id,
        color: line.color,
        label: this.store.label(line) ?? '–',
        rect: false,
      })),
      ...this.store.rects().map((rect) => ({
        id: rect.id,
        color: rect.color,
        label: this.store.rectLabel(rect),
        rect: true,
      })),
    ].sort((a, b) => a.id - b.id),
  );
  protected readonly referenceLabel = computed(() => {
    const reference = this.store.reference();
    return reference ? formatLength(reference.cm, this.store.unit()) : null;
  });
  protected readonly hint = computed(() => {
    switch (this.store.phase()) {
      case 'empty':
        return `Öffne einen Plan, ziehe ihn hierher oder füge ihn mit ${this.modKey} V ein.`;
      case 'calibrate':
        return 'Ziehe eine Linie über eine Strecke, deren Länge du kennst, zum Beispiel eine bemaßte Wand.';
      case 'measure':
        switch (this.store.tool()) {
          case 'reference':
            return 'Ziehe eine Linie über eine Strecke, deren Länge du kennst. Sie ersetzt die bisherige Referenz, alle Maße werden angepasst.';
          case 'draw':
            return 'Ziehe Linien, sie werden automatisch bemaßt. Shift hält sie gerade, Alt schaltet das Einrasten ab.';
          case 'select':
            return this.store.selectedRect()
              ? 'Rechteck an eine andere Stelle ziehen. Entf löscht.'
              : 'Linie oder Rechteck anklicken und verschieben, Endpunkte von Linien ziehen. Entf löscht.';
        }
    }
  });

  constructor() {
    effect(() => {
      const calibration = this.store.calibration();
      const dialog = this.dialog().nativeElement;
      if (calibration && !dialog.open) {
        const input = this.lengthInput().nativeElement;
        const current = untracked(() => this.store.reference());
        input.value = calibration.edit && current ? formatInput(current.cm) : '';
        this.lengthInvalid.set(false);
        dialog.showModal();
        input.focus();
        input.select();
      } else if (!calibration && dialog.open) {
        dialog.close();
      }
    });

    effect(() => {
      const edit = this.rectEdit();
      const dialog = this.rectDialog().nativeElement;
      if (edit !== null && !dialog.open) {
        const rect = untracked(() => this.store.rects().find((r) => r.id === edit));
        const width = this.rectWidthInput().nativeElement;
        width.value = rect ? formatInput(rect.widthCm) : '';
        this.rectHeightInput().nativeElement.value = rect ? formatInput(rect.heightCm) : '';
        this.rectInvalid.set(false);
        dialog.showModal();
        width.focus();
        width.select();
      } else if (edit === null && dialog.open) {
        dialog.close();
      }
    });
  }

  protected async openFile(file: File | null | undefined): Promise<void> {
    if (!file) {
      return;
    }
    if (
      this.hasWork() &&
      !confirm(
        'Der aktuelle Plan wird mit Maßstab und allen Linien geschlossen. Neuen Plan öffnen?',
      )
    ) {
      return;
    }
    this.error.set(null);
    try {
      this.store.loadImage(await loadPlanImage(file, file.name || 'plan.png'));
    } catch (e) {
      this.error.set(
        e instanceof PlanFileError ? e.message : `„${file.name}“ konnte nicht geöffnet werden.`,
      );
    }
  }

  protected onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.openFile(input.files?.[0]);
    input.value = '';
  }

  protected onDragOver(event: DragEvent): void {
    if (event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      this.dragOver.set(true);
    }
  }

  protected onDragLeave(event: DragEvent): void {
    if (!(event.currentTarget as Node).contains(event.relatedTarget as Node | null)) {
      this.dragOver.set(false);
    }
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    this.openFile(event.dataTransfer?.files[0]);
  }

  protected onPaste(event: ClipboardEvent): void {
    if (isEditable(event.target) || this.dialogOpen()) {
      return;
    }
    const item = [...(event.clipboardData?.items ?? [])].find(
      (i) => i.kind === 'file' && i.type.startsWith('image/'),
    );
    const file = item?.getAsFile();
    if (file) {
      event.preventDefault();
      this.openFile(file);
    }
  }

  protected confirmLength(event: Event): void {
    event.preventDefault();
    const input = this.lengthInput().nativeElement;
    const cm = parseLengthCm(input.value);
    if (cm === null) {
      this.lengthInvalid.set(true);
      input.focus();
      return;
    }
    this.store.confirmCalibration(cm);
  }

  /** Esc, the cancel button and any other close of the dialog abandon an open question. */
  protected onDialogClose(): void {
    this.store.cancelCalibration();
  }

  protected openRectDialog(id: 'new' | number): void {
    if (this.store.phase() === 'measure') {
      this.rectEdit.set(id);
    }
  }

  protected confirmRect(event: Event): void {
    event.preventDefault();
    const width = parseLengthCm(this.rectWidthInput().nativeElement.value);
    const height = parseLengthCm(this.rectHeightInput().nativeElement.value);
    const edit = this.rectEdit();
    if (width === null || height === null) {
      this.rectInvalid.set(true);
      (width === null ? this.rectWidthInput() : this.rectHeightInput()).nativeElement.focus();
      return;
    }
    if (edit === 'new') {
      this.store.addRect(this.canvas().viewCenter(), width, height);
    } else if (edit !== null) {
      this.store.resizeRect(edit, width, height);
    }
    this.rectEdit.set(null);
  }

  protected zoomIn(): void {
    this.canvas().zoomBy(ZOOM_STEP);
  }

  protected zoomOut(): void {
    this.canvas().zoomBy(1 / ZOOM_STEP);
  }

  protected fit(): void {
    this.canvas().fit();
  }

  protected async saveJpeg(): Promise<void> {
    const image = this.store.image();
    const blob = await this.render();
    if (image && blob) {
      downloadBlob(blob, exportFileName(image.name));
    }
  }

  protected async print(): Promise<void> {
    const image = this.store.image();
    const blob = await this.render();
    if (image && blob) {
      await printBlob(blob, image.width > image.height);
    }
  }

  protected onKeyDown(e: KeyboardEvent): void {
    if (this.dialogOpen() || isEditable(e.target)) {
      return;
    }
    const key = e.key.toLowerCase();
    if (e.metaKey || e.ctrlKey) {
      const action = {
        z: () => (e.shiftKey ? this.store.redo() : this.store.undo()),
        y: () => this.store.redo(),
        s: () => this.saveJpeg(),
        p: () => this.print(),
      }[key];
      if (action) {
        e.preventDefault();
        action();
      }
      return;
    }
    if (e.altKey) {
      return;
    }
    switch (key) {
      case 'l':
        this.store.setTool('draw');
        break;
      case 'v':
        this.store.setTool('select');
        break;
      case 'r':
        this.store.setTool('reference');
        break;
      case 'delete':
      case 'backspace': {
        const selected = this.store.selectedId();
        if (selected !== null) {
          e.preventDefault();
          this.store.deleteItem(selected);
        }
        break;
      }
      case 'escape':
        this.store.select(null);
        if (this.store.tool() === 'reference') {
          this.store.setTool('draw');
        }
        break;
      case '+':
      case '=':
        this.zoomIn();
        break;
      case '-':
        this.zoomOut();
        break;
      case '0':
        this.fit();
        break;
    }
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasWork()) {
      event.preventDefault();
    }
  }

  /** A scale or lines exist that would be lost. */
  private hasWork(): boolean {
    return (
      this.store.reference() !== null ||
      this.store.lines().length > 0 ||
      this.store.rects().length > 0
    );
  }

  private dialogOpen(): boolean {
    return this.store.calibration() !== null || this.rectEdit() !== null;
  }

  private async render(): Promise<Blob | null> {
    const image = this.store.image();
    if (!image || this.busy()) {
      return null;
    }
    this.busy.set(true);
    try {
      return await renderJpeg(image, {
        rects: this.store.rectShapes(),
        lines: this.store.lines(),
        label: (line) => this.store.label(line),
        unitPx: this.store.unitPx(),
      });
    } catch (e) {
      this.error.set(
        e instanceof PlanFileError ? e.message : 'Das Bild konnte nicht erzeugt werden.',
      );
      return null;
    } finally {
      this.busy.set(false);
    }
  }
}

/** A length as the user would type it: German decimal comma, no grouping. */
function formatInput(cm: number): string {
  return cm.toLocaleString('de-DE', { maximumFractionDigits: 2, useGrouping: false });
}
