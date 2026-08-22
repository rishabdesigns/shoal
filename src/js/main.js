// Boot, the frame loop, and the window.__SCENE__ debug contract.
import * as THREE from '../../vendor/three.module.min.js';
import { createWorld } from './scene/world.js';
import { AGENT_COUNTS, PLANT_COUNTS } from './config.js';

const hero = document.querySelector('.hero');
const canvas = document.querySelector('.hero__canvas');
const liveAgents = document.querySelector('[data-live="agents"]');
const liveCalls = document.querySelector('[data-live="calls"]');

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;

function byViewport(counts) {
  if (innerWidth < 700) return counts.phone;
  if (innerWidth < 1200) return counts.tablet;
  return counts.wide;
}

let world = null;
try {
  world = createWorld(THREE, {
    canvas, agents: byViewport(AGENT_COUNTS), plants: byViewport(PLANT_COUNTS)
  });
} catch (error) {
  // No WebGL, or a context that refused to create. The editorial layer is DOM, so
  // every word of the page survives — only the tank is missing.
  hero.dataset.fallback = 'true';
  console.warn('WebGL unavailable; hero falling back to the static gradient.', error);
}

if (world) {
  const pointer = { x: 0, y: 0, z: 0 };
  let pointerActive = false;

  // --- adaptive quality: pixel ratio first, never agent count mid-flight ------
  // Removing fish would change the thing the page is about; resolution is the
  // budget the viewer notices least.
  let renderScale = Math.min(devicePixelRatio, 2);
  let slowFrames = 0;

  function resize() {
    world.resize(innerWidth, innerHeight, renderScale);
  }
  addEventListener('resize', resize, { passive: true });
  resize();

  // --- pointer ---------------------------------------------------------------
  function movePointer(clientX, clientY) {
    world.pointerToWorld(clientX / innerWidth, clientY / innerHeight, pointer);
    pointerActive = true;
  }
  if (!reducedMotion) {
    addEventListener('pointermove', event => movePointer(event.clientX, event.clientY), { passive: true });
    addEventListener('pointerdown', event => movePointer(event.clientX, event.clientY), { passive: true });
    addEventListener('pointerleave', () => { pointerActive = false; }, { passive: true });
    // A touch that ends should let the school reform, or the cavity stays frozen
    // open under a finger that is no longer there.
    addEventListener('pointerup', () => { if (coarse) pointerActive = false; }, { passive: true });
  }

  // --- the loop --------------------------------------------------------------
  let previous = performance.now();

  function step(dt) {
    world.flock.setPointer(pointerActive ? pointer : null);
    world.update(dt);
    world.render();
  }

  function frame(now) {
    // CLAMPED. A backgrounded tab returns a delta of seconds, and every unclamped
    // simulation explodes on the first frame after it.
    const dt = Math.min(1 / 30, Math.max(1 / 400, (now - previous) / 1000));
    previous = now;
    step(dt);

    const stats = world.getStats();
    if (liveCalls) liveCalls.textContent = stats.calls;

    // Back off resolution only after a sustained run of slow frames, so one
    // garbage-collection spike does not permanently downgrade the page.
    if (world.flock.frameMs > 9) { slowFrames += 1; } else { slowFrames = Math.max(0, slowFrames - 1); }
    if (slowFrames > 90 && renderScale > 1) {
      renderScale = 1; slowFrames = 0; resize();
    }
    requestAnimationFrame(frame);
  }

  if (reducedMotion) {
    // Settle to a composed still and stop. Every word stays; only motion goes.
    for (let i = 0; i < 240; i += 1) step(1 / 60);
    addEventListener('resize', () => { resize(); step(1 / 60); }, { passive: true });
  } else {
    requestAnimationFrame(frame);
  }

  if (liveAgents) liveAgents.textContent = world.flock.params.count;

  // --- the debug contract ----------------------------------------------------
  window.__SCENE__ = {
    world,
    // Interaction archetype: "progress" is seconds of simulated time, not a
    // journey position. Deterministic from the seed, so two runs are comparable.
    setProgress(seconds) {
      world.flock.reset();
      pointerActive = false;
      const target = Math.max(0, Number(seconds) || 0);
      for (let t = 0; t < target; t += 1 / 60) step(1 / 60);
    },
    setPointer(x, y) {
      if (x === null || x === undefined) { pointerActive = false; return; }
      world.pointerToWorld(x, y, pointer);
      pointerActive = true;
    },
    sample: () => world.flock.sample(),
    stats: () => world.getStats()
  };

  // If something external takes over the frame loop, re-seed as it does: how many
  // frames ran free before that point depends on machine load, and re-seeding is
  // what makes every run start from an identical state.
  if (window.__CAPTURE__) {
    const seize = window.__CAPTURE__.lock;
    window.__CAPTURE__.lock = at => { world.flock.reset(); previous = at; seize(at); };
  }

  // ?shot=4 jumps straight to four seconds of settled swimming.
  const requested = Number(new URLSearchParams(location.search).get('shot'));
  if (Number.isFinite(requested) && requested > 0) window.__SCENE__.setProgress(requested);
} else {
  window.__SCENE__ = {
    fallback: true,
    setProgress() {}, setPointer() {},
    sample: () => ({ finite: true, agents: 0, frameMs: 0 }),
    stats: () => ({ progress: 0, calls: 0, triangles: 0, renderScale: 1 })
  };
}
