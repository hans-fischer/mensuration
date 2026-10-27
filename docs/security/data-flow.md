# Data flow

Floor plans can show private homes, alarm points or company premises. This page states what
happens to such a file.

```text
  user's disk / clipboard
          │  File object (browser API, no upload)
          ▼
  ┌──────────────────── browser tab ────────────────────┐
  │ object URL → <img>.decode() → canvas copy (≤ 16 MP) │
  │ lines, rects, scale: JS memory (PlanStore)          │
  │ JPG: Blob → object URL → <a download> / print sheet │
  └─────────────────────────────────────────────────────┘
          │  only on explicit save
          ▼
  user's download folder / printer
```

| Data | Where it lives | Leaves the tab? |
| --- | --- | --- |
| Opened plan image | Object URL (revoked right after decoding), then an in-memory canvas | No |
| Lines, rectangles, reference | Signals in [PlanStore](../../src/app/plan-store.ts) | No |
| Exported JPG | Blob and short-lived object URL ([plan-file.ts](../../src/app/plan-file.ts)) | Only as the file the user saves or prints |
| Label font | Bundled into the build from `@fontsource/barlow-semi-condensed` | — (no font CDN request) |

Verified in the code: the app makes no `fetch`/XHR calls, uses no cookies, `localStorage`,
`sessionStorage` or IndexedDB, and loads no third-party scripts or styles at runtime. Closing or
reloading the tab discards the plan; the browser asks first while lines exist.

## What this does not cover

### H-1 Image decoding of untrusted files

Files are decoded by the browser's own image decoders. The app adds no isolation of its own; a
malicious image is exactly as dangerous as opening it in any web page, and as safe as the browser
is up to date.

### H-2 Hosting

The repository contains no deployment. Whoever hosts the static build controls what is served:
a compromised host could ship modified JavaScript that uploads plans. No Content-Security-Policy
or Subresource Integrity is configured, because there is no hosting configuration to put them in.

### H-3 Development server

`npm start` runs Angular's development server (Vite) on `localhost:4200`. It is meant for
development; known Vite dev-server advisories (GHSA-9jrq-w75r-8gcw and others in 8.3.0–8.3.2) are
closed by pinning Vite 8.3.5 through `overrides` in [package.json](../../package.json). Later
advisories against the dev server would apply while it runs; a static build on a plain web server
avoids that surface.
