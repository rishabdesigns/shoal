// Assembly of the one world: water volume, light, and the school inside it.
// Everything the frame loop touches is preallocated here; update() allocates nothing.
import { Flock, createRandom } from './flock.js';
import { createFishGeometry, applyUndulation, attachInstanceAttributes } from './fish.js';
import { createWaterUniforms, createBackdrop, createMotes, createBubbles } from './water.js';
import { createGravel, createBedPlane } from './substrate.js';
import { createPlants } from './plants.js';
import { SCENE_SEED, TANK, CAMERA, PALETTE, FOG, FISH_VARIETIES } from '../config.js';

export function createWorld(THREE, { canvas, agents, plants: plantCount }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(PALETTE.deep, 1);

  const scene = new THREE.Scene();
  // Depth attenuation. The tank is only ~13 units deep, so the range is tight —
  // fog set to the scene's scale rather than a default is what makes the back of
  // the school sit behind the front of it instead of beside it.
  scene.fog = new THREE.Fog(PALETTE.deep, FOG.near, FOG.far);

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, .1, 220);
  camera.position.set(0, 0, CAMERA.distance);

  // --- light -----------------------------------------------------------------
  // A HEMISPHERE, not a flat ambient. Green-lit water above, warm bounce off the
  // gravel below — which is what a planted tank actually is, and what stops every
  // belly in the school reading as a grey underside. A single ambient term of one
  // colour was most of why the fish looked dull: it filled the shadows with the
  // water's own hue and desaturated every orange in the frame toward it.
  // Sky term is near-WHITE, not the water's green. Filling every shadow in the
  // frame with a saturated hue drags every other hue toward it, and the subject of
  // this page is an orange fish.
  scene.add(new THREE.HemisphereLight(0xeaf8f0, PALETTE.bounce, 0.75));
  // Sun through the surface: strong from above and slightly behind the viewer.
  const sun = new THREE.DirectionalLight(PALETTE.sun, 2.2);
  sun.position.set(3, 14, 6);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(PALETTE.shallow, 0.32);
  fill.position.set(-5, -6, -4);
  scene.add(fill);

  // --- water -----------------------------------------------------------------
  const random = createRandom(SCENE_SEED);
  const water = createWaterUniforms(THREE);
  const backdrop = createBackdrop(THREE, water);
  const motes = createMotes(THREE, water, random);
  scene.add(backdrop, motes);

  // --- the tank itself: floor and planting -------------------------------------
  // Built before the school so the fish are drawn over a world that already exists,
  // and so anything that goes wrong with the substrate is visible without the
  // school on top of it.
  const bed = createBedPlane(THREE);
  const gravel = createGravel(THREE, water, random);
  const planting = createPlants(THREE, water, random, { count: plantCount });
  scene.add(bed, gravel.mesh, ...planting.meshes);

  // Built LAST of the seeded systems. Every one of these draws from the same
  // deterministic stream, so inserting a system ahead of the gravel and the
  // planting re-rolls both of them and silently rearranges a composition that was
  // tuned by hand. New systems go on the end.
  const bubbles = createBubbles(THREE, water, random);
  scene.add(bubbles);

  // --- the school ------------------------------------------------------------
  const flock = new Flock({ count: agents, seed: SCENE_SEED, bounds: TANK.bounds });
  const geometry = createFishGeometry(THREE);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: .40, metalness: 0, fog: true,
    // Fins are single surfaces. Culled from behind, half the school loses its tail
    // on every frame it happens to be swimming the other way.
    side: THREE.DoubleSide
  });
  // The coat shader reads uv, and a material with no map does not declare one.
  material.defines = { USE_UV: '' };
  const undulation = applyUndulation(material, {}, water);

  const mesh = new THREE.InstancedMesh(geometry, material, agents);
  mesh.frustumCulled = false;             // one bounding sphere for the whole tank
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);
  const { phase, beat, coat } = attachInstanceAttributes(THREE, mesh, agents);

  // Per-instance markings, variety and tint. `coat` seeds the pattern so no two
  // fish carry the same coat; the instance colour is a narrow value spread on top,
  // which is what stops the far half of the school reading as one flat silhouette.
  const near = new THREE.Color(PALETTE.fish);
  const far = new THREE.Color(PALETTE.fishDeep);
  const tint = new THREE.Color();
  const totalWeight = FISH_VARIETIES.reduce((sum, v) => sum + v.weight, 0);
  for (let i = 0; i < agents; i += 1) {
    phase[i] = random() * 6.283;
    coat[i * 3] = random() * 40;
    // Skewed toward the saddle: in a bowl of shubunkins a few fish are nearly
    // white and a few nearly solid, but most carry more marking than not.
    coat[i * 3 + 1] = -0.10 + Math.pow(random(), .72) * 0.70;
    // Which variety this fish is. Drawn from the weighted table rather than
    // assigned in blocks, so the varieties are mixed THROUGH the school — a
    // school sorted by colour reads as several schools sharing a tank.
    let roll = random() * totalWeight;
    let variety = FISH_VARIETIES[FISH_VARIETIES.length - 1].index;
    for (const entry of FISH_VARIETIES) {
      if (roll < entry.weight) { variety = entry.index; break; }
      roll -= entry.weight;
    }
    coat[i * 3 + 2] = variety;
    tint.copy(far).lerp(near, .62 + random() * .38);
    mesh.setColorAt(i, tint);
  }
  mesh.geometry.attributes.aPhase.needsUpdate = true;
  mesh.geometry.attributes.aCoat.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  // Scratch objects, reused every frame. Creating these inside update() is the
  // allocation that eventually reports as a leak.
  const dummy = new THREE.Object3D();
  const stats = { progress: 0, calls: 0, triangles: 0, renderScale: 1, agents };

  const maxSpeed = flock.params.maxSpeed;

  function update(dt) {
    water.uTime.value += dt;
    flock.step(dt);

    const { pos, vel, acc, scale } = flock;
    for (let i = 0; i < agents; i += 1) {
      const ix = i * 3;
      const vx = vel[ix], vy = vel[ix + 1], vz = vel[ix + 2];
      dummy.position.set(pos[ix], pos[ix + 1], pos[ix + 2]);
      // Geometry points along +Z and lookAt aims +Z, so heading needs no fix-up.
      dummy.lookAt(pos[ix] + vx, pos[ix + 1] + vy, pos[ix + 2] + vz);

      // Bank into the turn. Signed turn rate about the vertical axis, from the
      // component of acceleration across the heading — a fish that changes
      // direction without rolling reads as a paper aeroplane.
      const speed2 = vx * vx + vy * vy + vz * vz + 1e-4;
      const turn = (acc[ix] * vz - acc[ix + 2] * vx) / speed2;
      // Clamped to ~26 degrees. The first pass allowed 60, and at that angle a fish
      // presents its back to the camera — the body is six times longer than it is
      // deep, so a rolled fish reads as a flat leaf and the school stops being fish.
      // Real schooling fish bank shallowly and hold dorsal-up.
      const bank = Math.max(-.46, Math.min(.46, turn * .05));
      dummy.rotateZ(bank);

      dummy.scale.setScalar(scale[i]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // Tail beat tracks speed: a bursting fish beats faster. This is the cheapest
      // possible link between the simulation and the locomotion, and without it the
      // school swims at one metronome rate whatever it is doing.
      beat[i] = .55 + Math.sqrt(speed2) / maxSpeed * 1.35;
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.geometry.attributes.aBeat.needsUpdate = true;
  }

  function render() {
    renderer.render(scene, camera);
    const info = renderer.info.render;
    stats.calls = info.calls;
    stats.triangles = info.triangles;
  }

  function resize(width, height, pixelRatio) {
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    const aspect = width / height;
    camera.aspect = aspect;
    // Dolly back on narrow viewports so the tank still spans the frame.
    camera.position.z = aspect < CAMERA.narrowAspect
      ? CAMERA.narrowDistance - (aspect / CAMERA.narrowAspect) * (CAMERA.narrowDistance - CAMERA.distance)
      : CAMERA.distance;
    camera.updateProjectionMatrix();

    // Fit the TANK ITSELF to the frame, not just the corral.
    //
    // The frustum is a wedge, so the frame is narrowest at the tank's near wall —
    // and the near wall is where the biggest, most legible fish are. A tank sized
    // in world units regardless of that put a hundred of them past the right edge,
    // each one sliced in half by the window: the school looked like it was leaking
    // out of the page. Fitting to the NEAR plane and insetting by a margin means
    // no fish is ever cut, at any viewport.
    const tan = Math.tan(camera.fov * Math.PI / 360);
    // Half-extents at z = 0, and how fast the frame opens up with depth. Together
    // these ARE the view frustum, inset by a margin — so the school fills the
    // frame at every depth and no fish is ever cut by an edge.
    flock.refit(
      {
        x: Math.max(5, camera.position.z * tan * aspect - TANK.margin),
        y: Math.max(3.6, camera.position.z * tan - TANK.margin),
        z: TANK.bounds.z
      },
      { x: tan * aspect, y: tan }
    );
    // Centred horizontally, and lifted. The headline is centred now, so the type
    // and the densest part of the school want the same piece of frame — and the
    // fix for that is a COMPOSITION, made in the scene, not a plate behind the
    // words. Biasing the school's attractor up by a fifth of the corral drifts the
    // mass above the centre line and leaves the band the lead sits in noticeably
    // thinner, without emptying a third of the tank the way an off-centre
    // composition did.
    const home = flock.params.home;
    home.x = 0; home.y = flock.params.bounds.y * 0.12; home.z = 0;

    // The planting is placed in frame-relative coordinates, so it has to be
    // resolved against the frame every time the frame changes.
    planting.layout(aspect, camera.position.z);
  }

  // Normalised viewport coords -> a RAY through the tank: one point on the z = 0
  // plane, plus the direction the camera sees it along.
  //
  // The direction is the whole point. A cursor has no depth, so the fish a viewer
  // expects to move are the ones that look near it on screen — which, under
  // perspective, are spread over several world units of x and y depending on how
  // deep in the tank they sit. Handing the flock only the plane intersection made
  // the pointer a ball floating in the middle of the water.
  function pointerToWorld(nx, ny, target) {
    const height = 2 * camera.position.z * Math.tan(camera.fov * Math.PI / 360);
    target.x = (nx - .5) * height * camera.aspect;
    target.y = -(ny - .5) * height;
    target.z = 0;
    const length = Math.hypot(target.x, target.y, camera.position.z);
    target.dx = target.x / length;
    target.dy = target.y / length;
    target.dz = -camera.position.z / length;
    return target;
  }

  return {
    scene, camera, renderer, THREE, flock, mesh, water, undulation,
    gravel, planting,
    update, render, resize, pointerToWorld,
    getStats: () => { stats.progress = flock.time; return stats; }
  };
}
