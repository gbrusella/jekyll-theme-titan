# TITAN — Jekyll theme

A dark, gold-on-black theme with an animated procedural tessellation background.
The animation runs on a `<canvas>` and can be toggled off by visitors at any time —
their choice is saved in `localStorage`.

**[Live demo](https://gbrusella.github.io/jekyll-theme-titan/)**

---

## Install

Add to your `Gemfile`:

```ruby
gem "jekyll-theme-titan", git: "https://github.com/gbrusella/jekyll-theme-titan"
```

Then set the theme in `_config.yml`:

```yaml
theme: jekyll-theme-titan
```

Run `bundle install` and `bundle exec jekyll serve`.

---

## Configure

In `_config.yml`:

```yaml
titan:
  shape: overlay    # see Shapes below
  motion: sheet     # sheet | bulge
  relax: 2          # 0–3  (0 = raw random, 3 = very even cells)
  cell: 66          # cell size in px — smaller = more, finer cells
  # controls: false # uncomment to hide the in-page settings panel

hero:
  kicker: Augmentation Online
  title: TITAN
  tagline: Adaptive nanoceramic shield — reactive plating engaged
```

### Shapes

| Value | Description |
|---|---|
| `overlay` | Delaunay triangles with Voronoi edges drawn on top *(default)* |
| `voronoi` | Irregular armour polygons |
| `triangles` | Delaunay triangles only |
| `hexagons` | Regular honeycomb |
| `squares` | Square grid |
| `rhombille` | Isometric rhombus tiling |
| `hcp` | Hexagonal close-packed lattice *(3-D, always spins)* |
| `fcc` | Face-centred cubic lattice *(3-D)* |
| `bcc` | Body-centred cubic lattice *(3-D)* |
| `cubic` | Simple cubic lattice *(3-D)* |

`motion` and `relax` only apply to the six 2-D shapes. The 3-D lattices always rotate.

---

## Colours

All colours are CSS custom properties on `:root`. Override any of them by
creating `assets/css/custom.css` and linking it from a custom `_includes/head.html`:

```css
:root {
  --gold-bright: #ffe9a0;          /* highlights, headings, active states */
  --gold:        #d4af37;          /* links, accents                      */
  --gold-deep:   #8a6d1d;          /* borders, dimmed elements            */
  --ink:         #050506;          /* page background                     */
  --paper:       rgba(10,10,12,0.66); /* content panel (with blur)        */
  --text:        #e9e3cf;          /* body text                           */
  --text-dim:    rgba(233,227,207,0.62); /* secondary text                */
}
```

Example — silver on navy:

```css
:root {
  --gold-bright: #e8eaf6;
  --gold:        #9fa8da;
  --gold-deep:   #3949ab;
  --ink:         #050a1a;
  --paper:       rgba(5,10,26,0.70);
  --text:        #dde1f0;
  --text-dim:    rgba(221,225,240,0.60);
}
```

---

## Background toggle

Any element with `data-titan-toggle` becomes an on/off button. The header
already includes one. State persists in `localStorage` and the background
defaults to **on** for all visitors.

You can also control it from JavaScript:

```js
Titan.on()                                        // show background
Titan.off()                                       // hide background
Titan.toggle()                                    // flip
Titan.setConfig({ shape: 'hexagons', cell: 50 }) // live-update settings
Titan.reset()                                     // restore theme defaults
```

---

## Run locally

```bash
bundle install
bundle exec jekyll serve
```

Open http://localhost:4000.

---

## Editing the engine

`assets/js/titan-bg.js` and `assets/css/titan.css` are **generated files** — do not
edit them directly. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow.
