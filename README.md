# STL Blueprint

Generate measured blueprint drawings — plan, elevation, section, and ISO views with dimensions — directly from an STL mesh, in the browser.

Drop in an STL and it fits cylinders, spheres, cones, and flat faces from the raw triangle mesh (not just its bounding box), then lays out a dimensioned engineering sheet: top/bottom plan, front/right elevation, a live section, and an orbitable isometric view. Round and spherical features, inclined faces, and axial steps are broken out into their own measurement tables.

**[Live demo](https://javisperez.github.io/stl-blueprint/)**

## Features

- Least-squares fitting of cylinders, spheres, and cones from mesh geometry — a 72-facet cylinder reports its true diameter, not the flat-to-flat distance
- Four-pane sheet: plan, elevation, section A-A (or a second elevation), and a draggable ISO view
- Feature tables for round/spherical features, inclined faces, and step chains, with click-to-highlight on the sheet
- Configurable source/display units (mm, cm, in)
- Export to:
  - **PNG** — the sheet as shown
  - **SVG** — vector line art with real hidden-line removal
  - **DXF R12** — 1:1 CAD interchange, layered (outline, hidden, centre, section, hatch, dims, text, fitted, pictorial)
  - **CSV** — raw measurements
  - **JSON** — a semantic model (features, fits, relationships, passage map) intended for an AI or script to consume
  - **OpenSCAD** — an editable rebuild script with the mesh as the base solid and fitted features as positioned geometry

## Getting started

Requires [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev
```

Build for production:

```bash
pnpm build
```

## Stack

Vite, Vue 3 (`<script setup>`), TypeScript. The STL parsing, mesh analysis, canvas rendering, and export logic live in [`src/engine/blueprint.ts`](src/engine/blueprint.ts).

## License

Apache License 2.0 — see [LICENSE](LICENSE).
