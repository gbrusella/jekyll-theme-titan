/*!
 * TITAN — animated tessellation background engine (reusable module).
 * Extracted from the standalone index.html playground; do not edit by hand —
 * edit index.html and re-run scripts/extract-engine.js.
 *
 * Auto-inits on <canvas id="titan">. Config via data-* attributes
 * (data-shape, data-motion, data-relax, data-cell) or window.TITAN_CONFIG.
 * Exposes window.Titan with on() / off() / toggle() / isOn() for the
 * site-wide background switch (choice persisted in localStorage, and the
 * default respects prefers-reduced-motion). Any element with the attribute
 * [data-titan-toggle] becomes a toggle button automatically.
 */
(function (global) {
  'use strict';

  const DEFAULTS = { shape: 'overlay', motion: 'sheet', relax: 2, cell: 66 };

  function makeEngine(canvas, options) {
    const cfg = Object.assign({}, DEFAULTS, options);
    const ctx = canvas.getContext('2d', { alpha: false });
    const reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduce = reduceMQ.matches;
    if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', function (e) { reduce = e.matches; });
    let running = false, rafId = null;


      let W = 0, H = 0, dpr = 1;
      const CELL_TARGET = cfg.cell;   // approx plate / lattice spacing in CSS px

      // Tessellation model:
      //   2D plates (animated by the travelling bulge):
      //     'voronoi'   irregular armor polygons
      //     'triangles' Delaunay triangles
      //     'overlay'   Delaunay triangles + Voronoi edges drawn together
      //     'hexagons'  regular honeycomb
      //     'squares'   square grid
      //     'rhombille' rhombi (isometric-cube look)
      //   3D lattice (rotating crystal):
      //     'hcp'       hexagonal close-packed
      //     'fcc'       face-centred cubic
      //     'bcc'       body-centred cubic
      //     'cubic'     simple cubic
      const SHAPE = cfg.shape;
      const is3D = (SHAPE === 'hcp' || SHAPE === 'fcc' || SHAPE === 'bcc' || SHAPE === 'cubic');

      // Lloyd relaxation passes applied to the Poisson points before triangulating
      // (voronoi / triangles / overlay). 0 = raw Poisson, 2-3 = even "blue-noise".
      const RELAX = cfg.relax;

      // Motion for the 2D plate models:
      //   'bulge' a single swell travelling between two points
      //   'sheet' the whole plane ripples like a floating sheet of fabric
      const MOTION = cfg.motion;

      // shared vertex grid (flat Float32 arrays) — triangles reference these by index
      let stride = 0, nPts = 0;
      let baseX, baseY;         // rest positions (with static jitter baked in)
      let curX, curY;           // animated positions, recomputed each frame
      let fieldB;               // per-point displacement magnitude, reused for lighting
      let phX, phY;             // per-point idle-shimmer phases
      let tris = [];            // { a,b,c (indices), ph }

      // overlay mode: triangle corner-triples + dual (adjacent-triangle) edge pairs,
      // used to rebuild the Voronoi edges each frame from the animated vertices
      let triVerts = [], dualEdges = [];

      // a single bulge that travels in a straight line from point 1 to point 2,
      // then re-picks a new distant pair and repeats
      let trav = null;          // { x0,y0, x1,y1, t0, dur, r, s }
      let tcx = 0, tcy = 0, tamp = 0, tr2 = 1;   // per-frame: bulge centre, strength, falloff

      // 3D crystal lattice (used by the hcp / fcc / bcc / cubic modes)
      let hx, hy, hz, hN = 0, hbonds = [], hR = 0, hSpanXY = 1, hSpan3 = 1;

      function rand(seed) { const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

      /* ===== POINTS & TRIANGULATION — Poisson → Lloyd → Delaunay/Voronoi ===== */

      // Poisson-disk sampling (Bridson) — random points with a guaranteed minimum
      // spacing, so the random tessellation has no slivers or clumps.
      function poisson(x0, y0, x1, y1, r) {
        const k = 30, r2 = r * r, cs = r / Math.SQRT2;
        const gw = Math.ceil((x1 - x0) / cs), gh = Math.ceil((y1 - y0) / cs);
        const grid = new Int32Array(gw * gh).fill(-1);
        const pts = [], active = [];
        const gidx = (x, y) => (Math.floor((x - x0) / cs) + Math.floor((y - y0) / cs) * gw);
        function fits(x, y) {
          if (x < x0 || x >= x1 || y < y0 || y >= y1) return false;
          const gx = Math.floor((x - x0) / cs), gy = Math.floor((y - y0) / cs);
          for (let yy = Math.max(0, gy - 2); yy <= Math.min(gh - 1, gy + 2); yy++)
            for (let xx = Math.max(0, gx - 2); xx <= Math.min(gw - 1, gx + 2); xx++) {
              const id = grid[xx + yy * gw];
              if (id >= 0) { const dx = pts[id][0] - x, dy = pts[id][1] - y; if (dx * dx + dy * dy < r2) return false; }
            }
          return true;
        }
        function add(x, y) { const id = pts.length; pts.push([x, y]); active.push(id); grid[gidx(x, y)] = id; }
        add(x0 + Math.random() * (x1 - x0), y0 + Math.random() * (y1 - y0));
        while (active.length) {
          const ai = Math.floor(Math.random() * active.length);
          const p = pts[active[ai]];
          let placed = false;
          for (let i = 0; i < k; i++) {
            const ang = Math.random() * 6.2832, rad = r * (1 + Math.random());
            const nx = p[0] + Math.cos(ang) * rad, ny = p[1] + Math.sin(ang) * rad;
            if (fits(nx, ny)) { add(nx, ny); placed = true; break; }
          }
          if (!placed) active.splice(ai, 1);
        }
        return pts;
      }

      // Delaunay triangulation (Bowyer-Watson) -> array of [i,j,k] index triples.
      // Optimised vs. the naive version: each triangle caches its circumcircle so
      // the in-circle test is a cheap squared-distance compare, and the cavity
      // boundary is found with a hash map (O(E)) instead of an O(E^2) double loop.
      function delaunay(points) {
        const n = points.length;
        let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
        for (const p of points) {
          if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0];
          if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1];
        }
        const dmax = Math.max(maxx - minx, maxy - miny) * 10 + 1;
        const mx = (minx + maxx) / 2, my = (miny + maxy) / 2;
        const v = points.slice();
        const s0 = v.length; v.push([mx - dmax, my - dmax]);
        const s1 = v.length; v.push([mx, my + dmax]);
        const s2 = v.length; v.push([mx + dmax, my - dmax]);
        const M = v.length;                          // edge-key base (> any index)

        // build a triangle {a,b,c} (CCW) with its cached circumcircle (cx,cy,r2)
        function mkTri(a, b, c) {
          const A = v[a], B = v[b], C = v[c];
          if ((B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]) < 0) { const t = b; b = c; c = t; }
          const cc = circumcenter(v[a], v[b], v[c]);
          const dx = v[a][0] - cc[0], dy = v[a][1] - cc[1];
          return { a, b, c, cx: cc[0], cy: cc[1], r2: dx * dx + dy * dy };
        }

        let tl = [mkTri(s0, s1, s2)];
        for (let p = 0; p < n; p++) {
          const px = v[p][0], py = v[p][1];
          const bad = new Set(), ecount = new Map(), estore = new Map();
          for (const t of tl) { const dx = px - t.cx, dy = py - t.cy; if (dx * dx + dy * dy < t.r2) bad.add(t); }
          for (const t of bad) {
            const es = [[t.a, t.b], [t.b, t.c], [t.c, t.a]];
            for (const e of es) {
              const k = e[0] < e[1] ? e[0] * M + e[1] : e[1] * M + e[0];
              ecount.set(k, (ecount.get(k) || 0) + 1);
              if (!estore.has(k)) estore.set(k, e);
            }
          }
          if (bad.size) tl = tl.filter(t => !bad.has(t));
          ecount.forEach((cnt, k) => { if (cnt === 1) { const e = estore.get(k); tl.push(mkTri(e[0], e[1], p)); } });
        }
        // drop triangles touching the super-triangle
        const out = [];
        for (const t of tl) if (t.a < n && t.b < n && t.c < n) out.push([t.a, t.b, t.c]);
        return out;
      }

      // circumcenter of a triangle = the Voronoi vertex shared by its neighbours
      function circumcenter(a, b, c) {
        const ax = a[0], ay = a[1], bx = b[0], by = b[1], cx = c[0], cy = c[1];
        const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by)) || 1e-9;
        const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
        return [(a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d,
        (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d];
      }

      // circumcentre straight from coordinates (used to rebuild Voronoi vertices
      // each frame from the animated triangle corners)
      function circumcenterXY(ax, ay, bx, by, cx, cy, out) {
        const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by)) || 1e-9;
        const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
        out[0] = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
        out[1] = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
      }

      // Lloyd relaxation — repeatedly move each interior seed point to the area
      // centroid of its Voronoi cell. Turns raw Poisson points into an even,
      // "blue-noise" distribution so the triangles/cells are more uniform.
      function lloyd(pts, iters) {
        for (let it = 0; it < iters; it++) {
          const tri = delaunay(pts);
          const n = pts.length;
          const cc = tri.map(t => circumcenter(pts[t[0]], pts[t[1]], pts[t[2]]));
          const incident = [];
          for (let i = 0; i < n; i++) incident.push([]);
          const edgeCount = new Map();
          tri.forEach((t, ti) => {
            incident[t[0]].push(ti); incident[t[1]].push(ti); incident[t[2]].push(ti);
            const es = [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]];
            for (const e of es) { const k = e[0] < e[1] ? e[0] + '_' + e[1] : e[1] + '_' + e[0]; edgeCount.set(k, (edgeCount.get(k) || 0) + 1); }
          });
          const boundary = new Set();
          edgeCount.forEach((c, k) => { if (c === 1) { const p = k.split('_'); boundary.add(+p[0]); boundary.add(+p[1]); } });

          const np = pts.slice();
          for (let s = 0; s < n; s++) {
            if (boundary.has(s)) continue;             // keep the boundary anchored
            const inc = incident[s];
            if (inc.length < 3) continue;
            const sx = pts[s][0], sy = pts[s][1];
            inc.sort((p, q) => Math.atan2(cc[p][1] - sy, cc[p][0] - sx) - Math.atan2(cc[q][1] - sy, cc[q][0] - sx));
            let A = 0, Cx = 0, Cy = 0;                  // polygon area centroid
            for (let i = 0; i < inc.length; i++) {
              const p0 = cc[inc[i]], p1 = cc[inc[(i + 1) % inc.length]];
              const cross = p0[0] * p1[1] - p1[0] * p0[1];
              A += cross; Cx += (p0[0] + p1[0]) * cross; Cy += (p0[1] + p1[1]) * cross;
            }
            if (Math.abs(A) < 1e-6) continue;
            A *= 0.5; np[s] = [Cx / (6 * A), Cy / (6 * A)];
          }
          pts = np;
        }
        return pts;
      }

      function allocVerts() {
        baseX = new Float32Array(nPts); baseY = new Float32Array(nPts);
        curX = new Float32Array(nPts); curY = new Float32Array(nPts);
        fieldB = new Float32Array(nPts);
        phX = new Float32Array(nPts); phY = new Float32Array(nPts);
      }

      // Build a shared-vertex polygon mesh from a list of cells, where each cell
      // is an array of [x,y] corner points. Coincident corners are merged so the
      // mesh is watertight and plugs into the bulge animation + polygon renderer.
      function meshFromCells(rawCells) {
        const vmap = new Map(), vx = [], vy = [];
        function vid(x, y) {
          const kx = Math.round(x * 2) / 2, ky = Math.round(y * 2) / 2, k = kx + ',' + ky;
          let id = vmap.get(k);
          if (id === undefined) { id = vx.length; vx.push(kx); vy.push(ky); vmap.set(k, id); }
          return id;
        }
        const cells = rawCells.map(c => c.map(p => vid(p[0], p[1])));
        nPts = vx.length; allocVerts();
        for (let i = 0; i < nPts; i++) {
          baseX[i] = vx[i]; baseY[i] = vy[i];
          phX[i] = rand(i + 0.2) * 6.2832; phY[i] = rand(i + 0.7) * 6.2832;
        }
        tris = cells.map((idx, i) => ({ idx, ph: rand(i * 0.37 + 1.1) * 6.2832 }));
      }

      // 2D honeycomb — regular hexagons
      function buildHexagons(cell, margin) {
        const R = cell * 0.62, dx = Math.sqrt(3) * R, dy = 1.5 * R;   // pointy-top
        const cols = Math.ceil((W + 2 * margin) / dx) + 1;
        const rows = Math.ceil((H + 2 * margin) / dy) + 1;
        const cells = [];
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) {
            const cx = -margin + c * dx + (r & 1 ? dx / 2 : 0), cy = -margin + r * dy;
            const corners = [];
            for (let k = 0; k < 6; k++) { const a = Math.PI / 180 * (30 + 60 * k); corners.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); }
            cells.push(corners);
          }
        meshFromCells(cells);
      }

      // 2D square grid
      function buildSquares(cell, margin) {
        const cols = Math.ceil((W + 2 * margin) / cell) + 1;
        const rows = Math.ceil((H + 2 * margin) / cell) + 1;
        const cells = [];
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) {
            const x = -margin + c * cell, y = -margin + r * cell;
            cells.push([[x, y], [x + cell, y], [x + cell, y + cell], [x, y + cell]]);
          }
        meshFromCells(cells);
      }

      // 2D rhombille — each hexagon split into 3 rhombi (isometric-cube look)
      function buildRhombille(cell, margin) {
        const R = cell * 0.66, dx = Math.sqrt(3) * R, dy = 1.5 * R;
        const cols = Math.ceil((W + 2 * margin) / dx) + 1;
        const rows = Math.ceil((H + 2 * margin) / dy) + 1;
        const cells = [];
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) {
            const cx = -margin + c * dx + (r & 1 ? dx / 2 : 0), cy = -margin + r * dy;
            const v = [];
            for (let k = 0; k < 6; k++) { const a = Math.PI / 180 * (30 + 60 * k); v.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); }
            for (let m = 0; m < 3; m++)                       // 3 rhombi: centre + 3 consecutive corners
              cells.push([[cx, cy], v[2 * m], v[(2 * m + 1) % 6], v[(2 * m + 2) % 6]]);
          }
        meshFromCells(cells);
      }

      // Centre a set of 3D points, measure extent (for the camera), set node size,
      // and build bonds between neighbours closer than bondFactor * spacing.
      function finalize3D(xs, ys, zs, a, bondFactor) {
        const N = xs.length;
        let mx = 0, my = 0, mz = 0;
        for (let k = 0; k < N; k++) { mx += xs[k]; my += ys[k]; mz += zs[k]; }
        mx /= N; my /= N; mz /= N;
        hx = new Float32Array(N); hy = new Float32Array(N); hz = new Float32Array(N);
        let spanXY = 0, span3 = 0;
        for (let k = 0; k < N; k++) {
          const X = xs[k] - mx, Y = ys[k] - my, Z = zs[k] - mz;
          hx[k] = X; hy[k] = Y; hz[k] = Z;
          const rxy = Math.sqrt(X * X + Y * Y);        if (rxy > spanXY) spanXY = rxy;
          const r3 = Math.sqrt(X * X + Y * Y + Z * Z);  if (r3 > span3) span3 = r3;
        }
        hN = N; hR = a * 0.16; hSpanXY = spanXY || 1; hSpan3 = span3 || 1;
        hbonds = [];
        const thr2 = (a * bondFactor) * (a * bondFactor);
        for (let i = 0; i < N; i++)
          for (let j = i + 1; j < N; j++) {
            const ddx = hx[i] - hx[j], ddy = hy[i] - hy[j], ddz = hz[i] - hz[j];
            if (ddx * ddx + ddy * ddy + ddz * ddz < thr2) hbonds.push(i, j);
          }
      }

      // helper: collect unique 3D points (dedupes shared lattice sites)
      function lattice3D(n, basis, a) {
        const xs = [], ys = [], zs = [], seen = new Set();
        for (let i = 0; i < n; i++)
          for (let j = 0; j < n; j++)
            for (let k = 0; k < n; k++)
              for (const b of basis) {
                const x = (i + b[0]) * a, y = (j + b[1]) * a, z = (k + b[2]) * a;
                const key = Math.round(x) + ',' + Math.round(y) + ',' + Math.round(z);
                if (!seen.has(key)) { seen.add(key); xs.push(x); ys.push(y); zs.push(z); }
              }
        return [xs, ys, zs];
      }

      // 3D hexagonal close-packed lattice (ideal ABAB stacking)
      function buildHCP() {
        const a = 100, nx = 9, ny = 9, nL = 6, cz = 0.8165 * a;
        const xs = [], ys = [], zs = [];
        for (let L = 0; L < nL; L++) {
          const offx = (L & 1) ? a * 0.5 : 0;               // B layers sit in A's interstices
          const offy = (L & 1) ? a / (2 * Math.sqrt(3)) : 0;
          for (let j = 0; j < ny; j++)
            for (let i = 0; i < nx; i++) {
              xs.push(i * a + j * (a * 0.5) + offx);
              ys.push(j * (a * Math.sqrt(3) / 2) + offy);
              zs.push(L * cz);
            }
        }
        finalize3D(xs, ys, zs, a, 1.06);                    // 12 nearest neighbours
      }

      // 3D simple cubic lattice
      function buildCubic() {
        const a = 100;
        const [xs, ys, zs] = lattice3D(6, [[0, 0, 0]], a);
        finalize3D(xs, ys, zs, a, 1.05);                    // 6 neighbours (cube edges)
      }

      // 3D body-centred cubic — corners + cube centres
      function buildBCC() {
        const a = 110;
        const [xs, ys, zs] = lattice3D(5, [[0, 0, 0], [0.5, 0.5, 0.5]], a);
        finalize3D(xs, ys, zs, a, 1.05);                    // body diagonals + cube edges
      }

      // 3D face-centred cubic — corners + face centres
      function buildFCC() {
        const a = 120;
        const [xs, ys, zs] = lattice3D(4, [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]], a);
        finalize3D(xs, ys, zs, a, 0.78);                    // 12 nearest neighbours
      }

      // render the rotating 3D lattice — perspective projection, depth shading
      function render3D(now) {
        ctx.fillStyle = '#050506';
        ctx.fillRect(0, 0, W, H);

        const ay = reduce ? 0.7 : now * 0.00022;                 // spin about vertical
        const ax = -0.5 + Math.sin(now * 0.0001) * 0.14;         // gentle tilt wobble
        const ca = Math.cos(ay), sa = Math.sin(ay);
        const cb = Math.cos(ax), sb = Math.sin(ax);

        // camera sits safely beyond the lattice; focal chosen so it fills ~the screen
        const camDist = hSpan3 * 3.0;
        const focal = 0.46 * Math.min(W, H) * camDist / hSpanXY;

        const PX = new Float32Array(hN), PY = new Float32Array(hN), PS = new Float32Array(hN);
        let sMin = Infinity, sMax = -Infinity;
        for (let k = 0; k < hN; k++) {
          const x = hx[k], y = hy[k], z = hz[k];
          const x1 = x * ca + z * sa, z1 = -x * sa + z * ca;     // rotate Y
          const y1 = y * cb - z1 * sb, z2 = y * sb + z1 * cb;    // rotate X
          const s = focal / (z2 + camDist);                      // perspective scale
          PX[k] = W / 2 + x1 * s; PY[k] = H / 2 + y1 * s; PS[k] = s;
          if (s < sMin) sMin = s; if (s > sMax) sMax = s;
        }
        const span = (sMax - sMin) || 1;

        // gold bond edges — the lattice wireframe, brighter & thicker toward the front
        for (let b = 0; b < hbonds.length; b += 2) {
          const i = hbonds[b], j = hbonds[b + 1];
          const t = (((PS[i] + PS[j]) * 0.5) - sMin) / span;     // 0 far .. 1 near
          ctx.lineWidth = 0.6 + 1.2 * t;
          ctx.strokeStyle = 'rgba(' + (150 + t * 105 | 0) + ',' + (120 + t * 100 | 0) + ',' + (55 + t * 80 | 0) + ',' + (0.16 + 0.6 * t) + ')';
          ctx.beginPath(); ctx.moveTo(PX[i], PY[i]); ctx.lineTo(PX[j], PY[j]); ctx.stroke();
        }

        // metallic atoms with gold rims, painter-sorted back -> front
        const order = Array.from({ length: hN }, (_, k) => k).sort((i, j) => PS[i] - PS[j]);
        for (let o = 0; o < order.length; o++) {
          const id = order[o];
          const s = PS[id], t = (s - sMin) / span;
          const rr = hR * s;
          if (rr < 0.5) continue;
          const grd = ctx.createRadialGradient(PX[id] - rr * 0.4, PY[id] - rr * 0.4, rr * 0.1, PX[id], PY[id], rr);
          grd.addColorStop(0, 'rgb(' + (30 + t * 55 | 0) + ',' + (26 + t * 44 | 0) + ',' + (16 + t * 20 | 0) + ')');
          grd.addColorStop(1, '#070708');
          ctx.fillStyle = grd;
          ctx.beginPath(); ctx.arc(PX[id], PY[id], rr, 0, 6.2832); ctx.fill();
          ctx.lineWidth = Math.max(0.7, rr * 0.13);
          ctx.strokeStyle = 'rgba(' + (170 + t * 85 | 0) + ',' + (135 + t * 95 | 0) + ',' + (60 + t * 75 | 0) + ',' + (0.5 + 0.5 * t) + ')';
          ctx.stroke();
        }
      }

      function build() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = window.innerWidth; H = window.innerHeight;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        if (is3D) {
          if (SHAPE === 'hcp') buildHCP();
          else if (SHAPE === 'fcc') buildFCC();
          else if (SHAPE === 'bcc') buildBCC();
          else buildCubic();
          return;
        }

        const cell = CELL_TARGET;
        const margin = cell * 2;       // sample past the screen so morphing never exposes edges

        if (SHAPE === 'hexagons') { buildHexagons(cell, margin); return; }
        if (SHAPE === 'squares') { buildSquares(cell, margin); return; }
        if (SHAPE === 'rhombille') { buildRhombille(cell, margin); return; }

        // 1) random seed points  2) even them out with Lloyd  3) triangulate
        let pts = poisson(-margin, -margin, W + margin, H + margin, cell);
        if (RELAX > 0) pts = lloyd(pts, RELAX);
        const triIdx = delaunay(pts);

        if (SHAPE === 'triangles' || SHAPE === 'overlay') {
          // vertices = the seed points; each plate is a Delaunay triangle
          nPts = pts.length;
          allocVerts();
          for (let i = 0; i < nPts; i++) {
            baseX[i] = pts[i][0]; baseY[i] = pts[i][1];
            phX[i] = rand(i + 0.2) * 6.2832; phY[i] = rand(i + 0.7) * 6.2832;
          }
          tris = [];
          for (let i = 0; i < triIdx.length; i++) {
            const t = triIdx[i];
            tris.push({ idx: [t[0], t[1], t[2]], ph: rand(i * 0.37 + 1.1) * 6.2832 });
          }

          if (SHAPE === 'overlay') {
            // dual edges: each pair of triangles sharing a Delaunay edge gives one
            // Voronoi edge (between their circumcentres, rebuilt per frame)
            triVerts = triIdx;
            dualEdges = [];
            const emap = new Map();
            triIdx.forEach((t, ti) => {
              const es = [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]];
              for (const e of es) {
                const k = e[0] < e[1] ? e[0] + '_' + e[1] : e[1] + '_' + e[0];
                if (emap.has(k)) dualEdges.push(emap.get(k), ti); else emap.set(k, ti);
              }
            });
          }
          return;
        }

        // VORONOI — vertices = triangle circumcenters; each plate is the polygon
        // formed by the circumcenters of all triangles around one seed point.
        const nt = triIdx.length;
        nPts = nt;
        allocVerts();
        for (let i = 0; i < nt; i++) {
          const t = triIdx[i];
          const cc = circumcenter(pts[t[0]], pts[t[1]], pts[t[2]]);
          baseX[i] = cc[0]; baseY[i] = cc[1];
          phX[i] = rand(i + 0.2) * 6.2832; phY[i] = rand(i + 0.7) * 6.2832;
        }

        const n = pts.length;
        const incident = [];
        for (let i = 0; i < n; i++) incident.push([]);
        const edgeCount = new Map();
        for (let ti = 0; ti < nt; ti++) {
          const t = triIdx[ti];
          incident[t[0]].push(ti); incident[t[1]].push(ti); incident[t[2]].push(ti);
          const es = [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]];
          for (const e of es) {
            const k = e[0] < e[1] ? e[0] + '_' + e[1] : e[1] + '_' + e[0];
            edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
          }
        }
        // seed points on a hull edge (count 1) have open cells — skip them
        const boundary = new Set();
        edgeCount.forEach((c, k) => { if (c === 1) { const p = k.split('_'); boundary.add(+p[0]); boundary.add(+p[1]); } });

        tris = [];
        for (let s = 0; s < n; s++) {
          if (boundary.has(s)) continue;
          const inc = incident[s];
          if (inc.length < 3) continue;
          const sx = pts[s][0], sy = pts[s][1];
          // order the cell's vertices radially around the seed point
          inc.sort((p, q) => Math.atan2(baseY[p] - sy, baseX[p] - sx) - Math.atan2(baseY[q] - sy, baseX[q] - sx));
          tris.push({ idx: inc.slice(), ph: rand(s * 0.37 + 1.1) * 6.2832 });
        }
      }

      // pick two somewhat-distant points and send a bulge travelling from 1 -> 2
      function spawnTravel(t) {
        const minDist = Math.hypot(W, H) * 0.45;   // "somewhat distant"
        let x0, y0, x1, y1, dist, tries = 0;
        do {
          x0 = Math.random() * W; y0 = Math.random() * H;
          x1 = Math.random() * W; y1 = Math.random() * H;
          dist = Math.hypot(x1 - x0, y1 - y0);
        } while (dist < minDist && ++tries < 24);
        const speed = 0.42;                         // px per ms
        const r = 135;                              // bulge radius (px)
        trav = { x0, y0, x1, y1, t0: t, dur: Math.max(1100, dist / speed), r, s: 50 };
      }

      // advance the travelling bulge: compute its current centre + strength once per
      // frame. It ramps up at point 1, holds while crossing, eases out at point 2.
      function advanceTravel(t) {
        if (!trav || t - trav.t0 > trav.dur) spawnTravel(t);
        const u = (t - trav.t0) / trav.dur;         // 0..1 along the line
        tcx = trav.x0 + (trav.x1 - trav.x0) * u;
        tcy = trav.y0 + (trav.y1 - trav.y0) * u;
        const e = 0.16;                             // fade-in / fade-out fraction
        let env = u < e ? u / e : (u > 1 - e ? (1 - u) / e : 1);
        env = env < 0 ? 0 : env > 1 ? 1 : env;
        env = env * env * (3 - 2 * env);            // smoothstep
        tamp = trav.s * env;
        tr2 = 2 * trav.r * trav.r;
      }

      // --- value noise (non-repeating, unlike sine waves) ---
      function hash2(ix, iy) {
        let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        h ^= h >>> 16;
        return (h >>> 0) / 4294967296;
      }
      function vnoise(x, y) {
        const x0 = Math.floor(x), y0 = Math.floor(y);
        const fx = x - x0, fy = y - y0;
        const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
        const n00 = hash2(x0, y0), n10 = hash2(x0 + 1, y0);
        const n01 = hash2(x0, y0 + 1), n11 = hash2(x0 + 1, y0 + 1);
        const a = n00 + (n10 - n00) * ux, b = n01 + (n11 - n01) * ux;
        return a + (b - a) * uy;                    // [0,1)
      }
      function fbm(x, y) {                           // 3-octave fractal noise
        let v = 0, amp = 0.5, freq = 1, norm = 0;
        for (let o = 0; o < 3; o++) { v += amp * vnoise(x * freq, y * freq); norm += amp; amp *= 0.5; freq *= 2; }
        return v / norm;                            // [0,1)
      }
      // fabric height at a point: one slow large billow + flowing noise detail,
      // both animated by scrolling through the noise so nothing ever tiles.
      function sheetH(x, y, t) {
        const big = Math.sin(x * 0.0019 + y * 0.0013 + t * 0.0007) * 0.5;
        const n = fbm(x * 0.0023 + t * 0.00007, y * 0.0023 - t * 0.00006);
        return big + (n - 0.5) * 1.3;               // centred ~ -1.1 .. 1.1
      }

      // Floating-sheet motion — the plane is a noise-driven fabric height field.
      // Vertices ride the folds and the gold sheen tracks each fold's slope, like
      // light gliding over rippling silk. Noise keeps the pattern from repeating.
      function deformSheet(t) {
        const ampY = 16, ampX = 7, e = 7;
        for (let idx = 0; idx < nPts; idx++) {
          const bx = baseX[idx], by = baseY[idx];
          const h = sheetH(bx, by, t);
          const hX = sheetH(bx + e, by, t);          // slope -> sheen
          const hY = sheetH(bx, by + e, t);
          curX[idx] = bx + h * ampX + (hY - h) * 260; // lateral sway / parallax
          curY[idx] = by + h * ampY;                 // folds roll up & down
          const lit = 0.5 + (hX - h) * 42 + h * 0.05;
          fieldB[idx] = lit < 0 ? 0 : lit > 1 ? 1 : lit;
        }
      }

      // Recompute every vertex position from the travelling bulge + cursor + shimmer.
      function deform(t) {
        if (MOTION === 'sheet') { deformSheet(t); return; }
        for (let idx = 0; idx < nPts; idx++) {
          const bx = baseX[idx], by = baseY[idx];

          // tiny local shimmer so the resting mesh stays alive (not a wave)
          let ox = Math.sin(t * 0.0016 + phX[idx]) * 2.0;
          let oy = Math.cos(t * 0.0014 + phY[idx]) * 2.0;

          // travelling bulge — push points outward around its current centre
          if (tamp > 0.001) {
            const dx = bx - tcx, dy = by - tcy;
            const d2 = dx * dx + dy * dy;
            const fall = Math.exp(-d2 / tr2);
            if (fall > 0.01) {
              const infl = tamp * fall;
              const d = Math.sqrt(d2) || 1;
              ox += (dx / d) * infl;
              oy += (dy / d) * infl;
            }
          }

          curX[idx] = bx + ox;
          curY[idx] = by + oy;
          fieldB[idx] = Math.min(1, Math.sqrt(ox * ox + oy * oy) / 38); // drives lighting
        }
      }

      function frame(now) {
        if (!running) { rafId = null; return; }
        if (is3D) { render3D(now); rafId = requestAnimationFrame(frame); return; }

        // advance the travelling bulge (re-picks a new point pair when it arrives)
        if (MOTION === 'bulge') advanceTravel(now);

        deform(now);

        ctx.fillStyle = '#050506';
        ctx.fillRect(0, 0, W, H);
        ctx.lineJoin = 'round';

        const bright = [];

        // trace a plate's polygon path from its vertex-index list
        function trace(ix) {
          ctx.beginPath();
          ctx.moveTo(curX[ix[0]], curY[ix[0]]);
          for (let j = 1; j < ix.length; j++) ctx.lineTo(curX[ix[j]], curY[ix[j]]);
          ctx.closePath();
        }

        // PASS 1 — metallic fills (lit by how much the plate is swelling)
        for (let i = 0; i < tris.length; i++) {
          const tr = tris[i];
          const ix = tr.idx;
          let sum = 0;
          for (let j = 0; j < ix.length; j++) sum += fieldB[ix[j]];
          const b = sum / ix.length;                       // 0..1 displacement
          let lit = 0.15 + 0.95 * b + 0.05 * Math.sin(now * 0.0018 + tr.ph);
          lit = lit < 0 ? 0 : lit > 1 ? 1 : lit;
          tr._lit = lit;

          const l2 = lit * lit;
          const cr = (9 + l2 * 50) | 0;
          const cg = (8 + l2 * 40) | 0;
          const cb = (11 + lit * 13) | 0;
          ctx.fillStyle = 'rgb(' + cr + ',' + cg + ',' + cb + ')';
          trace(ix);
          ctx.fill();
          if (lit > 0.82) bright.push(tr);
        }

        // PASS 2 — gold edges on every plate
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1;
        for (let i = 0; i < tris.length; i++) {
          const tr = tris[i];
          const eb = Math.pow(tr._lit, 1.4);
          const cr = (80 + eb * 175) | 0;
          const cg = (62 + eb * 163) | 0;
          const cb = (24 + eb * 118) | 0;
          ctx.strokeStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',' + (0.42 + 0.58 * eb) + ')';
          trace(tr.idx);
          ctx.stroke();
        }

        // PASS 3 — bloom on the most-expanded plates only
        if (!reduce && bright.length) {
          ctx.shadowColor = 'rgba(255,225,150,0.9)';
          ctx.lineWidth = 1.4;
          for (let i = 0; i < bright.length; i++) {
            const tr = bright[i];
            ctx.shadowBlur = 5 + tr._lit * 11;
            ctx.strokeStyle = 'rgba(255,235,180,' + tr._lit + ')';
            trace(tr.idx);
            ctx.stroke();
          }
          ctx.shadowBlur = 0;
        }

        // PASS 4 — Voronoi edges overlaid on the Delaunay triangles (overlay mode).
        // Circumcentres are rebuilt from the animated corners so both move together.
        if (SHAPE === 'overlay' && dualEdges.length) {
          const cx = new Float32Array(triVerts.length), cy = new Float32Array(triVerts.length);
          const tmp = [0, 0];
          for (let i = 0; i < triVerts.length; i++) {
            const t = triVerts[i];
            circumcenterXY(curX[t[0]], curY[t[0]], curX[t[1]], curY[t[1]], curX[t[2]], curY[t[2]], tmp);
            cx[i] = tmp[0]; cy[i] = tmp[1];
          }
          ctx.lineWidth = 1;
          ctx.strokeStyle = 'rgba(255,240,205,0.5)';
          ctx.beginPath();
          for (let k = 0; k < dualEdges.length; k += 2) {
            const i = dualEdges[k], j = dualEdges[k + 1];
            ctx.moveTo(cx[i], cy[i]); ctx.lineTo(cx[j], cy[j]);
          }
          ctx.stroke();
        }

        rafId = requestAnimationFrame(frame);
      }

      let resizeTimer;
      function onResize() { clearTimeout(resizeTimer); resizeTimer = setTimeout(build, 150); }

      build();

      return {
        start() { if (running) return; running = true; rafId = requestAnimationFrame(frame); },
        stop() { running = false; if (rafId) cancelAnimationFrame(rafId); rafId = null; },
        rebuild: build,
        onResize: onResize,
        canvas: canvas
      };
  } // makeEngine

  /* ---- site-wide manager: on/off + live config, both persisted ---- */
  const KEY = 'titan-bg';      // 'on' | 'off'
  const CFG_KEY = 'titan-cfg'; // JSON of user config overrides (shape, motion, cell...)
  let engine = null, isOn = false, canvasEl = null, baseCfg = {}, overrides = {};

  function defaultOn() {
    try { var v = localStorage.getItem(KEY); if (v === 'on') return true; if (v === 'off') return false; } catch (e) {}
    return true; // default ON; visitors can toggle off via the header button
  }
  function persistOn(v) { try { localStorage.setItem(KEY, v ? 'on' : 'off'); } catch (e) {} }
  function loadOverrides() { try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function saveOverrides() { try { localStorage.setItem(CFG_KEY, JSON.stringify(overrides)); } catch (e) {} }
  function merged() { return Object.assign({}, DEFAULTS, baseCfg, overrides); }

  // (re)create the engine with the current merged config, preserving on/off state
  function rebuild() {
    if (engine) { engine.stop(); window.removeEventListener('resize', engine.onResize); }
    engine = makeEngine(canvasEl, merged());
    window.addEventListener('resize', engine.onResize);
    if (isOn) { canvasEl.style.display = ''; engine.start(); } else { canvasEl.style.display = 'none'; }
  }

  function setVal(sel, v) { var e = document.querySelectorAll(sel); for (var i = 0; i < e.length; i++) e[i].value = v; }
  function syncControls() {
    var c = merged();
    setVal('[data-titan-shape]', c.shape);
    setVal('[data-titan-motion]', c.motion);
    setVal('[data-titan-cell]', c.cell);
    var outs = document.querySelectorAll('[data-titan-cell-value]');
    for (var i = 0; i < outs.length; i++) outs[i].textContent = c.cell + 'px';
  }
  function syncUI() {
    var btns = document.querySelectorAll('[data-titan-toggle]');
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-pressed', String(isOn));
    var r = document.documentElement.classList; r.toggle('titan-on', isOn); r.toggle('titan-off', !isOn);
    syncControls();
  }

  const Titan = {
    mount: function (canvas, options) {
      canvasEl = canvas;
      baseCfg = options || {};
      overrides = loadOverrides();
      isOn = defaultOn();
      rebuild();
      syncUI();
      return engine;
    },
    on: function () { if (isOn) return; isOn = true; if (canvasEl) canvasEl.style.display = ''; if (engine) engine.start(); persistOn(true); syncUI(); },
    off: function () { if (!isOn) return; isOn = false; if (engine) engine.stop(); if (canvasEl) canvasEl.style.display = 'none'; persistOn(false); syncUI(); },
    toggle: function () { isOn ? this.off() : this.on(); },
    isOn: function () { return isOn; },
    setConfig: function (patch) { Object.assign(overrides, patch || {}); saveOverrides(); rebuild(); syncUI(); },
    getConfig: function () { return merged(); },
    reset: function () { overrides = {}; saveOverrides(); rebuild(); syncUI(); }
  };
  global.Titan = Titan;

  function addAll(sel, evt, fn) { var e = document.querySelectorAll(sel); for (var i = 0; i < e.length; i++) e[i].addEventListener(evt, fn); }
  function wireControls() {
    addAll('[data-titan-toggle]', 'click', function () { Titan.toggle(); });
    addAll('[data-titan-shape]', 'change', function (e) { Titan.setConfig({ shape: e.target.value }); });
    addAll('[data-titan-motion]', 'change', function (e) { Titan.setConfig({ motion: e.target.value }); });
    addAll('[data-titan-reset]', 'click', function () { Titan.reset(); });
    var cellTimer;
    addAll('[data-titan-cell]', 'input', function (e) {
      var v = +e.target.value;
      var outs = document.querySelectorAll('[data-titan-cell-value]');
      for (var i = 0; i < outs.length; i++) outs[i].textContent = v + 'px';
      clearTimeout(cellTimer); cellTimer = setTimeout(function () { Titan.setConfig({ cell: v }); }, 130);
    });
  }

  function autoInit() {
    const canvas = document.getElementById('titan');
    if (!canvas) return;
    const d = canvas.dataset, cfg = {};
    if (d.shape) cfg.shape = d.shape;
    if (d.motion) cfg.motion = d.motion;
    if (d.relax != null && d.relax !== '') cfg.relax = +d.relax;
    if (d.cell != null && d.cell !== '') cfg.cell = +d.cell;
    Object.assign(cfg, global.TITAN_CONFIG || {});
    Titan.mount(canvas, cfg);
    wireControls();
  }
  if (document.readyState !== 'loading') autoInit();
  else document.addEventListener('DOMContentLoaded', autoInit);
})(window);
