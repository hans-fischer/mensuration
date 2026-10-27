# Developer documentation

Bemessung is a single-page Angular 22 app (standalone components, signals, zoneless) without a
backend. It draws on one `<canvas>`; there is no SVG or DOM per line.

## What to have in your head first

- **All geometry is in image pixels** of the working copy of the plan. The screen is a view
  (`scale`, `x`, `y`) onto it; only [plan-canvas.ts](../../src/app/plan-canvas.ts) converts.
- **The scale is derived, never stored.** `cmPerPx = reference.cm / pixel length of the reference`
  ([plan-store.ts](../../src/app/plan-store.ts)). Lines keep pixels, rectangles keep centimetres;
  replacing the reference re-dimensions every line and redraws every rectangle at its true size
  without extra code.
- **One render function** ([render.ts](../../src/app/render.ts) `drawPlan`) draws both the screen
  and the JPG export, so the export cannot drift from what is shown.
- **The reference is not a line.** It is its own state (`{ a, b, cm }`), drawn only while it is
  being drawn or asked about. The first line on an uncalibrated plan is a reference; afterwards the
  tool **Maßstab** makes the next line one (`drawsReference`).

## Pages

| Page | Content |
| --- | --- |
| [architecture.md](architecture.md) | State, interaction, rendering, image handling, export |
| [testing.md](testing.md) | Test tiers, fixtures, how the browser tests address the canvas |

## Repository layout

```text
.
├── angular.json            # build/serve/test targets; bundles the label font
├── playwright.config.ts    # e2e: ng serve on :4321, Chromium + WebKit
├── e2e/
│   └── bemessung.spec.ts   # browser tests of the complete workflow
├── public/                 # favicon
├── src/
│   ├── index.html
│   ├── main.ts             # bootstrap
│   ├── styles.css          # colour tokens, base styles, print stylesheet
│   └── app/
│       ├── app.ts|html|css # shell: toolbar, board, list, status bar, length dialog
│       ├── plan-canvas.ts  # canvas: view, pointer/keyboard/wheel interaction
│       ├── plan-store.ts   # state: plan, lines, scale, selection, undo/redo
│       ├── render.ts       # drawPlan(): plan + dimension lines onto a 2D context
│       ├── plan-file.ts    # open image, render JPG, download, print
│       ├── geometry.ts     # pure maths: parsing, formatting, hit tests, snapping
│       ├── model.ts        # types, colour and weight palettes
│       └── *.spec.ts       # unit tests (Vitest)
└── docs/
```

## Files and responsibilities

| File | Responsibility |
| --- | --- |
| [app.ts](../../src/app/app.ts) | Opening files (picker, drop, paste), length and rectangle dialogs, keyboard shortcuts, export/print buttons, list and status texts |
| [plan-canvas.ts](../../src/app/plan-canvas.ts) | View transform, fit/zoom/pan, drawing (drag and click-click), snapping, selecting and dragging lines and rectangles, showing the reference, redraw effect |
| [plan-store.ts](../../src/app/plan-store.ts) | Single source of truth as signals; all mutations and the undo history |
| [render.ts](../../src/app/render.ts) | Dimension-line style: 45° slashes, label placement and halo, reference box, rectangles with inside labels, selection marks |
| [plan-file.ts](../../src/app/plan-file.ts) | Decoding and downscaling uploads, JPG encoding, download, print sheet |
| [geometry.ts](../../src/app/geometry.ts) | Side-effect-free helpers, fully unit-tested |
| [model.ts](../../src/app/model.ts) | `Line`, `Rect`, `Reference`, `PlanImage`, `COLORS`, `THICKNESSES`, `REFERENCE_COLOR` |

## Commands

| Task | Command |
| --- | --- |
| Dev server | `npm start` |
| Unit tests (watch / once) | `npm test` / `npm test -- --watch=false` |
| Browser tests | `npm run e2e` (starts its own dev server on port 4321) |
| One browser only | `npm run e2e -- --project=webkit` |
| Production build | `npm run build` |
| Format | `npx prettier --write src e2e` |

There is no CI pipeline in this repository yet.

## Tool versions

Each tool is pinned once in [package.json](../../package.json); run everything through the npm
scripts or `npx`, which use the project's local versions.

| Tool | Pin | Note |
| --- | --- | --- |
| Angular CLI / build | `^22.2.4` | The npm scripts use this local CLI, never a global `ng` on `PATH` |
| Vite | `overrides.vite = 8.3.5` | `@angular/build` 22.2.4 pins 8.3.0 (affected by GHSA-9jrq-w75r-8gcw and others); the override keeps one patched Vite for build and Vitest |
| Playwright | `1.64.1` exactly | Matches the installed browser builds; a newer version needs `npx playwright install chromium webkit` |

Remove the Vite override once `@angular/build` ships with Vite ≥ 8.3.3.

## How to add …

**A line colour**

1. Add `{ value, name }` to `COLORS` in [model.ts](../../src/app/model.ts). The name is the
   button's accessible label.
2. Pick a colour that stays readable on white paper and against the white label halo.
3. Update the colour list in the README reference.

**A line weight**

1. Add the step to `THICKNESSES` in [model.ts](../../src/app/model.ts) (keep the √2 progression).
2. Check label size and slash length in [render.ts](../../src/app/render.ts) (`labelFontPx`, `slash`).
3. Tests address weights as `Linienstärke <n>`; adjust them if numbering shifts.

**A keyboard shortcut**

1. Add it to `App.onKeyDown` in [app.ts](../../src/app/app.ts). Canvas-only keys (Space, Esc for
   a line in progress) live in `PlanCanvas.onKeyDown`.
2. Shortcuts are ignored while typing (`isEditable`) and while the length dialog is open.
3. Add it to the README shortcut table and the button `title`.

**A store action**

1. Take `const before = this.snapshot()` first, change `lines`/`rects`/`reference`, then
   `pushHistory(before)` — or use `commit(before)` for drags that may end without change.
2. Never store derived values (scale, lengths); add a `computed` instead.
3. Cover it in [plan-store.spec.ts](../../src/app/plan-store.spec.ts), including undo.

## Conventions

- UI text German, informal "du", sentence case. Code, comments, docs English.
- No routing, no forms module, no state library: signals in one injectable store.
- Component files follow the Angular 20+ naming (`app.ts`, not `app.component.ts`).
- Formatting by Prettier ([.prettierrc](../../.prettierrc), print width 100).
