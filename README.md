# TITAN — Jekyll theme

A dark, gold-on-black theme with an animated procedural tessellation background
and a persisted site-wide on/off toggle.

## Run locally

```bash
bundle install
bundle exec jekyll serve
```

Open http://localhost:4000.

## Configure

In `_config.yml`:

```yaml
titan:
  shape: overlay    # voronoi | triangles | overlay | hexagons | squares | rhombille | hcp | fcc | bcc | cubic
  motion: sheet     # bulge | sheet  (2D shapes only; 3D lattices always spin)
  relax: 2          # Lloyd relaxation passes (0 = raw Poisson, 2-3 = even "blue-noise")
  cell: 66          # plate / lattice spacing in px

hero:
  kicker: Augmentation Online
  title: TITAN
  tagline: Adaptive nanoceramic shield — reactive plating engaged
```

These map to `data-*` attributes on `<canvas id="titan">`, read by
`assets/js/titan-bg.js`.

## Background toggle

Any element with `data-titan-toggle` becomes an on/off switch. State is saved
in `localStorage`; the default respects `prefers-reduced-motion`.

## Editing the engine

`assets/js/titan-bg.js` and `assets/css/titan.css` are **generated** from the
repo root (`index.html` + `shared/titan.css`). Edit those and re-run
`node scripts/extract-engine.js`.
