# Contributing to TITAN (Jekyll theme)

Thanks for your interest! Contributions of all kinds are welcome — bug reports,
layout improvements, documentation fixes, and new features.

---

## Project structure

```text
jekyll-theme-titan/
├── _includes/               # reusable partials (head, header, footer…)
├── _layouts/                # page layouts (default, home, post, page)
├── assets/
│   ├── css/
│   │   ├── titan.css        # readable stylesheet  (generated — do not edit)
│   │   └── titan.min.css    # minified             (generated — do not edit)
│   └── js/
│       ├── titan-bg.js      # animation engine     (generated — do not edit)
│       └── titan-bg.min.js  # minified             (generated — do not edit)
├── _config.yml              # default theme config
├── Gemfile
└── jekyll-theme-titan.gemspec
```

---

## What lives where

### Layouts and includes

`_layouts/` and `_includes/` are the right places for Jekyll-specific changes.
Edit freely and open a PR.

### The animation engine and stylesheet

`assets/js/titan-bg.js` and `assets/css/titan.css` are **generated from a separate
source repository** — the [titan-bg playground](https://github.com/gbrusella/titan-bg).
Do **not** edit them directly here; your changes will be overwritten the next time
the files are regenerated.

If you want to change the animation logic or the shared stylesheet, open an issue or
PR there instead. Once merged, the maintainer regenerates the files and updates this repo.

---

## Running the demo locally

```bash
bundle install
bundle exec jekyll serve
```

Open http://localhost:4000.

---

## Submitting a pull request

1. Fork the repo and create a branch from `main`.
2. Make your changes. Keep commits focused — one logical change per commit.
3. Test the site locally (see above) before opening a PR.
4. Open a PR with a clear description of what changed and why.

Please do not commit the generated `assets/js/titan-bg*.js` or
`assets/css/titan*.css` files unless you are the maintainer regenerating them
from the source playground.

---

## Reporting issues

Open a GitHub issue with:

- What you expected vs. what happened
- Jekyll version (`jekyll --version`) and Ruby version (`ruby --version`)
- Browser and OS (for visual bugs)
- A minimal reproduction if possible
