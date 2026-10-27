# Bemessung

A small browser tool for quick dimensioned sketches on scale drawings. Open a picture of a floor
plan, trace one distance whose real length you know, type that length in centimetres, and every
further line you draw is dimensioned automatically. Rectangles with fixed edge lengths — a bed, a
kitchen block — can be placed and moved around to see what fits. Lines and rectangles come in six
colours and five weights; the result is saved as a JPG or printed. Everything runs in the browser — there is no backend, and
the plan never leaves your machine.

The user interface is German; this documentation is English.

## ✨ Key Features

- 🖼️ Open a plan from a file, by drag and drop, or by pasting it from the clipboard (⌘V / Ctrl+V).
- 📏 Set the scale with one reference distance; it is a tool, not part of the drawing, and disappears once its length is entered.
- 🔁 Set a new reference at any time: the last one counts, and every length is recalculated.
- ▭ Place rectangles of fixed real size (e.g. furniture), move them, turn them by 90°, change their size.
- ✏️ Draw by dragging or by click-click; Shift keeps lines at 0°/45°/90°, endpoints snap together.
- 🎨 Six colours, five line weights, construction-drawing style (45° end slashes, text along the line).
- ↩️ Undo/redo, select, move, restyle and delete lines and rectangles.
- 🔍 Zoom and pan for precise placement (⌘/Ctrl + scroll, pinch, Space + drag).
- 💾 Save as JPG at the plan's resolution, or print only the plan.
- 📐 Lengths in cm or m, German number format.

## 📛 Naming conventions

| What | Pattern | Example |
| --- | --- | --- |
| Exported JPG | `<plan file name without extension>-bemasst.jpg` | `grundriss.png` → `grundriss-bemasst.jpg` |
| Pasted plan without file name | `plan.png` (then `plan-bemasst.jpg`) | — |
| Dev server | `http://localhost:4200` (`ng serve` default) | — |
| E2E test server | `http://localhost:4321` ([playwright.config.ts](playwright.config.ts)) | — |

## 📚 Documentation

| Document | Content |
| --- | --- |
| [docs/developer/](docs/developer/README.md) | Repository layout, architecture, tests, how to extend |
| [docs/security/](docs/security/README.md) | Where plan data goes (it stays in the browser) and known gaps |
| [Angular documentation](https://angular.dev) | Framework used |
| [Playwright documentation](https://playwright.dev) | End-to-end test runner used |

## 🚀 TL;DR fast start

Requires Node.js `^22.22.3 || ^24.15.0 || >=26.0.0` (the range Angular CLI 22 accepts).

```sh
npm install
npm start          # serves http://localhost:4200
```

1. **Plan öffnen** — pick an image (JPG, PNG, WebP, GIF, …), drop it onto the board, or paste it.
2. Drag a line over a distance whose length you know, e.g. a dimensioned wall. A dialog asks
   *Wie lang ist diese Strecke in Wirklichkeit?* — enter `350` (cm), `3,5 m` or `35 mm`.
3. Drag further lines; each one shows its length. Pick colour and weight in the toolbar before
   drawing, or select a line (**Auswahl**) and change them afterwards.
4. **Rechteck** asks for two edge lengths and places that rectangle in the middle of the view; drag
   it where you want it.
5. **Als JPG speichern** downloads the result; the printer button prints only the plan.

Verify the installation:

```sh
npm test -- --watch=false   # unit tests (Vitest)
npm run e2e                 # browser tests (Playwright, Chromium + WebKit)
```

<details>
<summary>Static build, update, removal</summary>

- **Static build:** `npm run build` writes the app to `dist/bemessung/browser/`. Serve that folder
  from any static web server at the site root (`<base href="/">`). Opening `index.html` directly via
  `file://` does not work: browsers block module scripts there.
- **Update:** `npx ng update @angular/core @angular/cli`, then run both test suites.
- **Remove:** delete the folder. The app stores nothing outside the browser tab.

</details>

## 📖 Full reference

### Workflow and states

| State | Shown when | What the next drawn line does |
| --- | --- | --- |
| Empty | No plan open | — (welcome panel with **Plan öffnen**) |
| Calibrate | Plan open, no reference yet | Is the reference; the length dialog opens |
| Measure | A reference exists | Is added and dimensioned — or, with the tool **Maßstab** (`R`), is a new reference |

The reference is shown only while it is drawn and while its length is asked for. It is not a line
of the drawing: it does not appear in the list, on the plan afterwards, or in the JPG.

| Reference action | Effect |
| --- | --- |
| **Maßstab** tool or **Neu festlegen** in the status bar, then draw | After the length is entered, the new reference replaces the old one; all lengths are recalculated |
| Cancel the length dialog (Esc, **Abbrechen**) | The previous reference stays in force; on a new plan, the plan stays uncalibrated |
| **Länge ändern** in the status bar | Corrects the entered length of the current reference |
| Undo after a new reference | Brings the previous reference back |

### Rectangles

| Topic | Behaviour |
| --- | --- |
| Create | **Rechteck** (enabled once a scale exists) asks for *Länge* and *Breite*, accepting the same input as the length dialog; the rectangle appears in the middle of the view in the current colour and weight, selected |
| Size | Kept in centimetres. A new reference changes how large the rectangle is drawn, never its real size |
| Move | Drag it with the tool **Auswahl** |
| Status bar when selected | **Maße ändern** (keeps centre and turn), **Um 90° drehen** (clockwise around the centre), **Ausgewähltes Rechteck löschen** |
| Drawing | Light fill and outline in its colour, the two edge lengths written inside along the edges; it lies under the lines |
| Snapping | Line ends snap to rectangle corners as they do to other line ends |
| List | Shown as `200 × 90 cm` with a square colour marker |

### Length input

| Input | Read as |
| --- | --- |
| `350`, `350,5`, `350.5` | centimetres |
| `350 cm` | centimetres |
| `3,5 m` | 350 cm |
| `35 mm` | 3.5 cm |
| `1.000`, `3.500 cm` — a point followed by exactly three digits | rejected: German reads it as 1000, English as 1 |
| `0`, negative, text, thousands separators (`1 000`, `1.000,5`) | rejected with a hint |

Implemented in [`parseLengthCm`](src/app/geometry.ts).

### Displayed lengths

| Unit | Format | Example |
| --- | --- | --- |
| `cm` (default) | whole centimetres, one decimal below 10 cm | `350 cm`, `4,6 cm`, `1.235 cm` |
| `m` | two decimals | `3,51 m` |

While it is asked for, the reference length is shown in a solid box (given value); measured lengths
are plain text. The unit switch (`cm` / `m`) sits in the header of the list, on phones in the toolbar.

### Mouse, touch and keyboard

| Action | Input |
| --- | --- |
| Draw a line | drag, or click start and click end (tool **Linie**, `L`) |
| Straight line (0°, 45°, 90°) | hold Shift while drawing or moving an endpoint |
| Do not snap to line ends and rectangle corners | hold Alt while drawing |
| New reference | tool **Maßstab** (`R`); Esc leaves it |
| Select / move a line or rectangle / move a line end | tool **Auswahl** (`V`), click or drag |
| Delete the selected line or rectangle | Delete or Backspace, the delete link in the status bar, or × in the list |
| Undo / redo | ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y) |
| Zoom | ⌘/Ctrl + scroll, trackpad pinch (Chrome, Firefox: ctrl+wheel; Safari: gesture events), `+` / `-`, buttons bottom left |
| Fit plan to window | `0` or **Einpassen** |
| Pan | scroll, Space + drag, middle mouse button, drag empty area in **Auswahl** |
| Cancel a line in progress | Esc |
| Save JPG / print | ⌘S / ⌘P (Ctrl+S / Ctrl+P) |

Snapping and picking use a 10 screen-pixel radius, so they behave the same at every zoom level.
Measurements are as precise as the line placement: zoom in for exact endpoints.

### Line styles

| Setting | Values |
| --- | --- |
| Colours | red `#e0301e` (default), blue `#1f5fae`, green `#1e8c4e`, orange `#f08a00`, magenta `#c2185b`, black `#1d2a33` |
| Weights | 1, 1.4 (default), 2, 2.8, 4 — the √2 steps of technical pen sets |

Stroke width and text size scale with the plan (one weight step = longest image side / 1000 px,
at least 1 px), so a phone photo and a large scan look alike at **Einpassen**, and the JPG matches
the screen.

### Images, export and print

| Topic | Behaviour |
| --- | --- |
| Accepted files | Whatever the browser can decode as an image. PDF is not supported — export the page as an image first. |
| Large images | Plans above 16,000,000 pixels are reduced to that size on opening ([`MAX_WORKING_PIXELS`](src/app/plan-file.ts)); measuring is unaffected because the scale is set on the reduced copy. |
| JPG export | Working resolution of the plan, quality 0.92, transparent areas white, with lines and rectangles, without the reference and selection marks. |
| Print | Prints only the plan, landscape for wide plans, portrait otherwise, 10 mm margins. |
| Persistence | None. Reloading or closing the tab discards the work; the browser warns before leaving, and opening another plan asks first, while a scale, lines or rectangles exist. |

Privacy: plan images are processed in the tab only, see [docs/security/data-flow.md](docs/security/data-flow.md).

## 🛠 Development

```sh
npm start                    # dev server with live reload
npm test                     # unit tests in watch mode
npm run e2e                  # Playwright, Chromium + WebKit
npm run build                # production build to dist/
npx prettier --write src e2e # format
```

See [docs/developer/](docs/developer/README.md) for architecture and conventions.

## License

No license has been chosen yet; the repository contains no license file.
