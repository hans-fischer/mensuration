# Architecture

Everything runs in one browser tab. There is no server component; `ng serve` or any static host
only delivers the files.

```text
 file picker / drop / paste
            │
            ▼
 plan-file.ts loadPlanImage ──► PlanImage (canvas, ≤ 16 MP) ──► PlanStore.image
                                                                   │
 pointer, wheel, keys ──► PlanCanvas ──► PlanStore actions ──► lines, rects, reference (+ history)
                              │                                    │
                              └──── effect: drawPlan(screen ctx) ◄─┘
                                                                   │
 "Als JPG speichern" / "Drucken" ──► renderJpeg: drawPlan(offscreen ctx) ──► download / print sheet
```

## State ([plan-store.ts](../../src/app/plan-store.ts))

| Signal | Meaning |
| --- | --- |
| `image` | The working copy of the plan (`PlanImage`), `null` before a plan is opened |
| `lines` | Measurement lines in drawing order, image-pixel coordinates |
| `rects` | Rectangles: centre in image pixels, edges in centimetres, turn in degrees |
| `reference` | `{ a, b, cm }`: the last entered reference distance; `null` before the first |
| `calibration` | Open length question: the distance asked about, and whether it only corrects the current reference's length |
| `selectedId`, `tool`, `color`, `thickness`, `unit` | UI state; ids are shared by lines and rectangles |

Derived with `computed`: `cmPerPx`, `phase` (`empty` → `calibrate` → `measure`), `drawsReference`,
`selectedLine`, `selectedRect`, `rectShapes` (rectangles resolved to pixel corners and labels),
`unitPx`, `canUndo`, `canRedo`. `label(line)` and `rectLabel(rect)` format sizes for the canvas and
the list alike.

The reference never enters `lines`, so it cannot be selected, listed or exported. Its life cycle:

| Action | Effect |
| --- | --- |
| Line drawn while `drawsReference` | `startCalibration(a, b)` opens the question; nothing is recorded yet |
| `confirmCalibration(cm)` | Records one undo step, replaces `reference`, switches the **Maßstab** tool back to **Linie** |
| `cancelCalibration` | Closes the question; the previous `reference` (or none) stays |
| `editCalibration` | Asks again for the current reference's length; confirming keeps its distance |
| `undo` / `redo` | Restore whole snapshots `{ lines, rects, reference }`; blocked while a question is open |

History holds up to 200 snapshots. Snapshots share unchanged objects, so they are cheap.

## Interaction ([plan-canvas.ts](../../src/app/plan-canvas.ts))

- **View:** `screen = image × scale + (x, y)`. The view fits the plan on opening, on **Einpassen**,
  and when the board's width changes while the user has not zoomed or panned. Height-only changes
  (the status bar wrapping on phones) leave it alone, so selecting a line never moves the plan.
- **Gestures:** `pointerdown` decides once what a press does (`draw`, `pan`, `end`, `move`,
  `move-rect`) and stores it in `gesture`; `pointermove` and `pointerup` only continue it. Pointer
  capture keeps drags alive outside the canvas. In **Auswahl**, a press tries the selected line's
  ends, then lines (topmost first), then rectangles, then pans.
- **Reference display:** while `drawsReference` the draft is passed to the renderer as `reference`
  (boxed `? cm`, accent colour) instead of as a line; while a question is open, the asked-about
  distance is shown the same way. Nothing else draws it.
- **Click-click lines:** a press that travels less than 4 screen px leaves the draft open; the next
  press ends it. Lines shorter than 3 screen px are dropped as accidental.
- **Snapping:** start and end points snap to line ends and rectangle corners within 10 screen px
  (`snapPoints`, Alt turns it off). Shift instead restricts the direction to multiples of 45°, keeping the projected length.
- **Wheel:** plain wheel pans, ctrl/⌘+wheel zooms around the pointer (Chrome and Firefox report
  trackpad pinch this way). Safari's `gesture*` events zoom too; ctrl+wheel is ignored during such
  a gesture so a pinch is never applied twice. Listeners are registered non-passive by hand,
  otherwise `preventDefault()` cannot stop page zoom.
- **Redraw:** one `effect` reads every signal the picture depends on and redraws synchronously.
  There is no manual invalidation.

## Rendering ([render.ts](../../src/app/render.ts))

`drawPlan(ctx, image, options)` expects a context already transformed to image coordinates.

- White fill first, then the plan: JPEG has no alpha, transparent PNG areas would turn black.
- Weight step → pixels via `unitPx = max(1, longest side / 1000)`; stroke `thickness × unitPx`,
  label `unitPx × (13 + 2.5 × thickness)`. Screen-only marks (selection halo, handles, snap ring)
  divide by the view scale instead, so they stay a constant size on screen.
- Order: rectangles, then lines, then the draft and the reference, then handles and the snap ring.
- Labels sit at the midpoint, above the line in reading direction, rotated by `readableAngle`
  (never upside down; vertical text reads bottom to top). Measured labels get a white halo; the
  reference label is white on a box in `REFERENCE_COLOR`.
- Rectangles get a 14 % fill and an outline in their colour; the edge lengths are written inside,
  along the first two edges, pushed towards the centre so they stay inside at any turn.
- The canvas waits for the label font (`document.fonts.load`) and redraws once it is there; the
  export awaits it before drawing.

## Images, export, print ([plan-file.ts](../../src/app/plan-file.ts))

- `loadPlanImage` decodes through `<img>` + `decode()` (EXIF orientation applied by the browser),
  then copies into a canvas no larger than 16,000,000 pixels. Safari refuses larger canvases on
  iOS; the scale is set on the copy, so measuring is unaffected.
- `renderJpeg` draws onto an offscreen canvas of the working size with `viewScale = 1` and no
  selection, then `toBlob('image/jpeg', 0.92)`.
- `printBlob` appends a `.print-sheet` with the JPG and a `@page` rule (landscape for wide plans);
  [styles.css](../../src/styles.css) hides everything else in print. The sheet is removed on
  `afterprint`.
