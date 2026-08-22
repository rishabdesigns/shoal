# Shoal — a concept hero section

**Live:** https://rishabdesigns.github.io/shoal/

Four hundred goldfish — eight varieties, orange through calico, sarasa and moor —
holding a school with no leader, in a planted tank with a gravel floor and bubbles
coming off it. Bring a pointer near and the school opens; take it away and the hole
closes behind you.

No build step, no dependencies, no network: three.js is vendored and the type is a
system stack. The repository is the site — clone it and serve the folder.

```bash
python3 -m http.server 4427    # then open http://127.0.0.1:4427
```

A plain static server is all it needs, but it does need to be *served* — the page
loads as ES modules, so opening `index.html` from the filesystem will not work.

## How it works

The pointer is the input and the school's response to it is the whole piece. Only
the thing the pointer touches is actually simulated; everything else is an analytic
function of position and time, which is why the scene costs so few draw calls.

| Element | Approach |
| --- | --- |
| Flocking + pointer avoidance | simulated — Reynolds boids, uniform-grid spatial hash |
| Fish body | procedural — lofted from three drawn profiles, 416 triangles |
| Markings and variety | one coat routine, eight colour sets, seeded per instance |
| Body undulation, banking | vertex shader |
| Gravel bed | procedural — 4,510 instanced stones, screen-constant size |
| Planting | procedural — two species, clumped, swaying in the vertex shader |
| Bubbles | one modulo per bubble, streams from three vents |
| Caustics, godrays, motes, depth attenuation | analytic |
| Pointer → world projection | exact — the view ray, not a point on a plane |

## Layout

```
index.html          the page
src/css/            type scale, then hero layout — every font-size comes from a token
src/js/config.js    every tunable in the scene
src/js/scene/       flock (pure, no THREE), fish, water, substrate, plants, caustics
vendor/             three.js, pinned
```

`src/js/scene/flock.js` is deliberately free of THREE and DOM, so the simulation can
be exercised without rendering anything.

## Numbers

420 fish · 4,510 stones · 600 plants · 240 bubbles · 9 draw calls ·
372,818 triangles · 0.6–5.0 ms of simulation per frame · 16.7 ms median frame ·
no fish clipped by the frame at 390, 768 or 1440 · flat heap · clean console.

Reduced motion and a WebGL-less context both still keep every word on the page.

## License

Copyright (c) 2026 Rishabh Joshi, all
rights reserved. You are welcome to read this, study it, run it locally, and
build your own implementation of the ideas in it. See
[LICENSE](LICENSE) for the full terms.

Bundled third-party components keep their own licenses — see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
