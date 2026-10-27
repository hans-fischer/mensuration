# Testing

| Tier | Runner | Location | Covers |
| --- | --- | --- | --- |
| Unit | Vitest via `ng test` (jsdom) | [src/app/*.spec.ts](../../src/app/) | every function in `geometry.ts`; `PlanStore` workflows: calibration, replacing and cancelling a reference, rectangles (real size under a new scale, move, turn, resize), undo/redo, restyling |
| Browser | Playwright, Chromium and WebKit | [e2e/bemessung.spec.ts](../../e2e/bemessung.spec.ts) | The real app on `ng serve`: opening (picker, drop, wrong file), calibration dialog, reference hidden after entry and replaced by a new one, drawing modes, snapping (line ends, rectangle corners), selection, rectangles, zoom/pan/pinch, JPG export pixels, print, large images |

```sh
npm test -- --watch=false
npm run e2e
npm run e2e -- --project=chromium -g "JPG"   # one browser, one test
npm run e2e -- --repeat-each=3               # flakiness check
```

Canvas drawing itself is not unit-tested: jsdom has no 2D context. The browser tests check it
through the exported JPG (line colour at a known pixel, white paper, no selection marks).

## Browser test fixtures

- **Plans are generated in the page** (`planPng`): a canvas with walls, exported as PNG, handed to
  the hidden file input via `setInputFiles`. No binary fixtures in the repository.
- **Plan coordinates → mouse coordinates:** the canvas exposes its view as `data-scale`, `data-x`,
  `data-y`; `toPage()` converts. Tests therefore say "drag from (100, 300) to (400, 300) on the
  plan", independent of window size and zoom.
- **Reference:** `calibrate()` draws 500 plan pixels along the top wall and enters `500`, so 1 cm
  equals 1 plan pixel and expected lengths read directly from the coordinates.
- **Tolerances:** browsers deliver mouse positions in whole CSS pixels, so at fit zoom an endpoint
  can land about one plan pixel off. Length assertions allow ±2–3 cm; tests that need precision
  (zoom, snapping) choose offsets well outside that band.
- **Waiting:** the list updates after Angular's next change detection. Read values with
  `valueAt()` or `expect.poll`, never with a bare `textContent()` right after a mouse action.
- **Canvas pixels:** `screenPixel()` reads the on-screen canvas at a plan coordinate (view and
  device pixel ratio applied); `isReferenceBlue()` / `isRedFill()` classify the colour. Sample points
  are chosen away from labels, whose size depends on the browser's font metrics.
- **Print:** `window.print` is replaced by a stub that records the print image's width;
  `page.emulateMedia({ media: 'print' })` checks that only the sheet is visible.
- **Safari pinch:** Playwright cannot pinch; the test dispatches the `gesturestart` /
  `gesturechange` / `gestureend` sequence with a `scale` property.

## Not covered by automated tests

- Real trackpad pinch on Safari and Chrome (only the event handling is replayed).
- Paste from the clipboard (`paste` event) — the handler shares `openFile` with the tested picker
  and drop paths.
- Touch input on real devices.
- The browser's native print dialog and the printed page.
