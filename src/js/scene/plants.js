// The planting — real geometry, rooted in the gravel, swaying in the current.
//
// Two species, because one repeated silhouette is what makes a procedural garden
// read as wallpaper: a fine-leaved stem plant (cabomba/hornwort) for mass, and a
// broadleaf for the punctuation that lets the eye find scale. Each is one
// instanced draw call.
//
// Built in PLANT SPACE: rooted at y = 0, tip at y = 1, so the vertex shader can use
// y directly as "how far up the stem am I" and per-instance scale is the only thing
// that decides how tall a given plant is.
import { CAUSTIC_GLSL } from './caustics.js';
import { PALETTE, PLANT_COLOURS, PLANT_ACCENT, TANK, CAMERA } from '../config.js';

// --- geometry ----------------------------------------------------------------

function blade(positions, uvs, indices, ax, ay, az, bx, by, bz, width, vRoot, vTip, axis, tipScale = .18) {
  // A tapered quad from (a) to (b), widened across the axis it leans least along,
  // so a leaf standing straight up is still a leaf and not a line. `axis` forces
  // the widening direction, which is the only way to build two quads that are
  // genuinely crossed rather than coincident.
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const length = Math.hypot(dx, dy, dz) || 1e-4;
  let sx, sy, sz;
  if (axis) {
    [sx, sy, sz] = axis;
  } else {
    // Any vector not parallel to the blade will do for the cross product; the
    // world up axis fails only for a perfectly horizontal leaf, hence the fallback.
    const upx = Math.abs(dy / length) > .97 ? 1 : 0, upy = Math.abs(dy / length) > .97 ? 0 : 1;
    sx = dy * 0 - dz * upy; sy = dz * upx - dx * 0; sz = dx * upy - dy * upx;
  }
  const sl = Math.hypot(sx, sy, sz) || 1e-4;
  sx = sx / sl * width; sy = sy / sl * width; sz = sz / sl * width;

  const base = positions.length / 3;
  positions.push(ax - sx, ay - sy, az - sz, ax + sx, ay + sy, az + sz);
  positions.push(bx - sx * tipScale, by - sy * tipScale, bz - sz * tipScale,
                 bx + sx * tipScale, by + sy * tipScale, bz + sz * tipScale);
  uvs.push(0, vRoot, 1, vRoot, 0, vTip, 1, vTip);
  indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
}

// Stems ARC. A plant grown in water leans away from its own weight and toward the
// light; a stem that is a perfectly straight vertical line reads as wire, and a
// bed of them reads as a picket fence, which is most of why the planting looked
// manufactured. One constant, applied to every whorl and leaf root as well as to
// the stem itself, so the whole plant bends together.
const CURVE = 0.17;
const curveAt = t => CURVE * t * t;

// A stem, as two quads genuinely crossed at right angles — visible from any
// bearing for eight triangles, where a tube costs thirty-two and reads no thicker
// at this distance.
//
// Both quads used to be built from the same automatic side vector, and for a
// vertical stem that vector is the same both times: the "cross" was two copies of
// one plane, and every stem in the tank disappeared when seen edge-on. Forcing
// the two axes is the whole fix.
function stem(positions, uvs, indices, width, from, to, segments = 4) {
  for (const axis of [[1, 0, 0], [0, 0, 1]]) {
    for (let s = 0; s < segments; s += 1) {
      const t0 = from + (to - from) * (s / segments);
      const t1 = from + (to - from) * ((s + 1) / segments);
      // Width tapers up the stem — a stalk of constant thickness is a drinking
      // straw. Segmented so the arc is a curve rather than a chord.
      const w = width * (1 - t0 * .55);
      blade(positions, uvs, indices,
        curveAt(t0), t0, 0, curveAt(t1), t1, 0, w, t0, t1, axis,
        (1 - t1 * .55) / (1 - t0 * .55));
    }
  }
}

// Fine-leaved stem plant: whorls of narrow blades radiating from a central stem.
export function createFeatheryGeometry(THREE, { nodes = 15, blades = 8 } = {}) {
  const positions = [], uvs = [], indices = [];
  stem(positions, uvs, indices, .008, 0, 1);
  for (let n = 0; n < nodes; n += 1) {
    const t = .07 + (n / (nodes - 1)) * .93;
    // Whorls shrink toward the growing tip, which is what gives the plant a
    // taper — a stem of constant-length whorls reads as a bottle brush.
    // A whorl is about a TENTH of the stem it grows on. At a third — which is
    // where this started — the plant is sword grass, and a bed of sword grass is
    // the cut-out look the geometry was supposed to replace.
    const reach = (.155 - t * .062) * (1 - Math.pow(t, 6));
    const root = curveAt(t);
    for (let b = 0; b < blades; b += 1) {
      // Golden-angle offset per node, so successive whorls do not stack into
      // vertical ribs.
      const a = (b / blades) * Math.PI * 2 + n * 2.39996;
      // Whorls DROOP. A blade held out level is a spoke; a blade that falls away
      // over its own length is a leaf with weight on it, and the sag is the
      // difference between a bottle brush and a plant in water.
      const droop = -reach * .30;
      blade(positions, uvs, indices,
        root, t, 0,
        // Whorls FAN outward, barely rising. Blades angled up along the stem read
        // as grass however fine they are — the near-horizontal fan is the whole
        // silhouette of a fine-leaved stem plant.
        root + Math.cos(a) * reach, t + reach * .18 + droop, Math.sin(a) * reach,
        .0105, t, t + .1);
    }
  }
  return finish(THREE, positions, uvs, indices);
}

// Broadleaf: alternating oval leaves up a stem. Fewer, larger surfaces — this is
// the species that gives the thicket a readable scale.
export function createBroadleafGeometry(THREE, { leaves = 15 } = {}) {
  const positions = [], uvs = [], indices = [];
  stem(positions, uvs, indices, .012, 0, 1);
  for (let n = 0; n < leaves; n += 1) {
    const t = .1 + (n / (leaves - 1)) * .88;
    const a = n * 2.39996;
    const reach = .125 - t * .048;
    const lean = .078 - t * .028;
    // Each leaf is two segments so it can CURVE — a flat quad leaf is a playing
    // card, and a bed of playing cards is exactly the cut-out look being avoided.
    const root = curveAt(t);
    // Leaf width varies down the plant: the lowest leaves on a broadleaf are the
    // biggest, and a stem of identical leaves is a diagram of a plant.
    const fat = 1.35 - t * .7;
    const mx = root + Math.cos(a) * reach * .55, mz = Math.sin(a) * reach * .55;
    const ex = root + Math.cos(a) * reach, ez = Math.sin(a) * reach;
    // The second segment falls BELOW the first: a leaf that curves up at the tip
    // is a plastic one.
    // A leaf is widest in its MIDDLE. Built as one taper from a wide root it is
    // a spearhead, and a plant hung with spearheads is the cut-out look the two
    // segments were added to avoid — so the first segment WIDENS out of the stem
    // and only the second comes to a point.
    blade(positions, uvs, indices, root, t, 0, mx, t + lean * .7, mz, .0095 * fat, t, t + .06, null, 2.4);
    blade(positions, uvs, indices, mx, t + lean * .7, mz, ex, t + lean * .25, ez, .0228 * fat, t + .06, t + .12, null, .10);
  }
  return finish(THREE, positions, uvs, indices);
}

function finish(THREE, positions, uvs, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// --- material ----------------------------------------------------------------

// Sway, plus the green gradient up the stem, plus the same caustics everything
// else in this tank is lit by.
function applyPlantShading(material, uniforms) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, {
      uTime: uniforms.uTime, uLight: uniforms.uLight, uCaustic: uniforms.uCaustic
    });
    shader.vertexShader = `
      uniform float uTime;
      attribute vec2 aSway;
      varying float vHeight;
      varying vec3 vWorldPos;
    ` + shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vHeight = clamp(position.y, 0.0, 1.0);
      // Bend, not translate: displacement grows with the SQUARE of height so the
      // base stays rooted in the gravel. A plant that slides as a rigid body reads
      // as a sticker being dragged across the glass.
      float bend = vHeight * vHeight * aSway.y;
      float phase = aSway.x;
      transformed.x += sin(uTime * 0.42 + phase) * bend;
      transformed.z += cos(uTime * 0.33 + phase * 1.7) * bend * 0.55;
      // A faster, smaller flutter on the leaf tips, which is what separates a
      // plant moving in water from a plant moving in wind.
      transformed.y -= abs(sin(uTime * 0.9 + phase * 2.3)) * bend * 0.12;
    `).replace('#include <project_vertex>', `
      vWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
      #include <project_vertex>
    `);
    shader.fragmentShader = `
      uniform float uTime, uCaustic;
      uniform vec3 uLight;
      varying float vHeight;
      varying vec3 vWorldPos;
      ${CAUSTIC_GLSL}
    ` + shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      // Dark at the base, fresh at the growing tip. Light in a planted tank comes
      // from directly above and very little of it reaches the crown of the
      // substrate — this one gradient does most of the work of making a green mass
      // read as many plants rather than one flat shape.
      diffuseColor.rgb *= mix(0.22, 1.05, smoothstep(0.0, 0.85, vHeight));
      // Across the blade: darker at the two long edges, with a pale midrib. A leaf
      // is not a flat chip of colour, and one gradient across its width is what
      // separates a leaf from a strip of coloured card at no geometric cost.
      float across = abs(vUv.x - 0.5) * 2.0;
      diffuseColor.rgb *= mix(1.10, 0.72, smoothstep(0.15, 1.0, across));
      float causticOnLeaf = shoalCaustic(vWorldPos.xz * 0.45 + vWorldPos.y * 0.1, uTime) * uCaustic;
      diffuseColor.rgb += uLight * causticOnLeaf * 0.16;
    `).replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      // TRANSLUCENCY. A leaf is a thin sheet with light coming through it from the
      // far side, and it is the cue that most reliably separates vegetation from
      // painted geometry: the blades that face away from the key are the ones that
      // glow, which is the opposite of how every opaque surface in the frame
      // behaves. Carried as a fraction of the leaf's OWN colour so it deepens the
      // green rather than washing it toward the light.
      totalEmissiveRadiance += diffuseColor.rgb * 0.14 * smoothstep(0.1, 0.9, vHeight);
    `);
  };
  material.customProgramCacheKey = () => 'plant-sway';
}

// --- planting ----------------------------------------------------------------

// Where a plant goes, and how tall. Deliberately NOT uniform: the reference is a
// thicket at the back and clumps at the left and right edges, with the middle kept
// open so there is somewhere for the subject to be. That is a composition made in
// the scene, which is the legitimate way to help the frame — as opposed to putting
// anything behind the type.
function plantSites(count, random) {
  const sites = [];
  // Plants arrive in CLUMPS, not one at a time. Independently scattered stems
  // distribute perfectly evenly, and perfectly even is a lawn — the reference is a
  // handful of bushes with open water between them. Each site below seeds a clump;
  // its neighbours inherit its position and species and vary around it.
  let clump = null;
  let remaining = 0;
  for (let i = 0; i < count; i += 1) {
    if (remaining > 0) {
      remaining -= 1;
      sites.push({
        ...clump,
        // Rolled per plant, not inherited: one red stem in a green clump is the
        // punctuation; a red clump is a second colour scheme.
        colour: random() < .05 ? PLANT_ACCENT : clump.colour,
        jitter: clump.jitter + (random() - .5) * clump.spread,
        z: clump.z + (random() - .5) * clump.spread * .55,
        height: clump.height * (.62 + random() * .62),
        lean: (random() - .5) * .55,
        spin: random() * 6.283,
        phase: random() * 6.283,
        width: .30 + random() * .30
      });
      continue;
    }
    const roll = random();
    let z, u, height;
    if (roll < .56) {
      // Back thicket: full width, but SHORT. Tall planting across the back fills
      // the frame edge to edge and the school loses the dark water it is read
      // against — the thicket's job is to give the lower third a floor of
      // vegetation, not to become the backdrop.
      z = -13 - random() * 18;
      u = (random() - .5) * 2;
      height = 6 + random() * 9;
    } else if (roll < .86) {
      // Mid clumps, held well out to the edges.
      z = -12 + random() * 8;
      u = (random() < .5 ? -1 : 1) * (.62 + random() * .38);
      height = 5 + random() * 7;
    } else {
      // Foreground: the closest planting, at the extreme edges only. These are the
      // plants that give the frame its depth, and the ones most able to ruin it.
      z = -2 + random() * 8;
      u = (random() < .5 ? -1 : 1) * (.86 + random() * .18);
      height = 6 + random() * 7;
    }
    clump = {
      // Stored NORMALISED: -1 at the left edge of the frame, +1 at the right, with
      // the world x resolved at layout time against the frame that actually exists.
      // Placed against a fixed aspect instead, "at the left edge" landed a third of
      // the way into a 16:9 frame and entirely off a portrait one — the phone
      // capture had 280 plants in it and showed about nine.
      u,
      jitter: (random() - .5) * 2.4,
      z,
      height,
      spread: 2.2 + random() * 4.5,
      lean: (random() - .5) * .55,
      spin: random() * 6.283,
      phase: random() * 6.283,
      width: .30 + random() * .30,
      colour: PLANT_COLOURS[(random() * PLANT_COLOURS.length) | 0],
      // Red stems are a rarity, and a thicket half made of them is not a tank.
      broadleaf: random() < .34
    };
    remaining = 3 + ((random() * 6) | 0);
    sites.push(clump);
  }
  return sites;
}

export function createPlants(THREE, uniforms, random, { count }) {
  const sites = plantSites(count, random);
  const groups = [
    { geometry: createFeatheryGeometry(THREE), sites: sites.filter(s => !s.broadleaf) },
    { geometry: createBroadleafGeometry(THREE), sites: sites.filter(s => s.broadleaf) }
  ];

  const dummy = new THREE.Object3D();
  const colour = new THREE.Color();
  const meshes = [];
  const laid = [];

  for (const group of groups) {
    const n = group.sites.length;
    if (!n) continue;
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: .62, metalness: 0, fog: true,
      // Leaves are single surfaces. Back-face culled, half of every plant vanishes.
      side: THREE.DoubleSide
    });
    // The shading below reads uv, and a material with no map does not declare one.
    material.defines = { USE_UV: '' };
    applyPlantShading(material, uniforms);

    const mesh = new THREE.InstancedMesh(group.geometry, material, n);
    mesh.frustumCulled = false;
    const sway = new Float32Array(n * 2);
    group.sites.forEach((site, i) => {
      colour.setHex(site.colour);
      // A WIDE value spread. Plants an equal distance into the fog still differ
      // by more than this in a real tank — some are shaded by their neighbours,
      // some are old and dark, and a thicket whose every stem is the same value
      // is one silhouette rather than fifty.
      mesh.setColorAt(i, colour.multiplyScalar(.42 + random() * .78));
      sway[i * 2] = site.phase;
      // Tall plants sway further, and everything sways less than it wants to:
      // a planted tank is nearly still, and overdone sway reads as wind.
      sway[i * 2 + 1] = .012 + random() * .022;
    });
    mesh.instanceColor.needsUpdate = true;
    mesh.geometry.setAttribute('aSway', new THREE.InstancedBufferAttribute(sway, 2));
    mesh.renderOrder = -2;
    meshes.push(mesh);
    laid.push({ mesh, sites: group.sites });
  }

  // Resolve every plant's world position against the frame that exists right now.
  // Called from world.resize — six hundred matrix writes, on an event that fires
  // when someone drags a window edge, not sixty times a second.
  const tan = Math.tan(CAMERA.fov * Math.PI / 360);
  let lastKey = '';
  function layout(aspect, distance) {
    const key = `${aspect}:${distance}`;
    if (key === lastKey) return;
    lastKey = key;
    for (const { mesh, sites } of laid) {
      sites.forEach((site, i) => {
        const halfWidth = (distance - site.z) * tan * aspect;
        dummy.position.set(site.u * halfWidth + site.jitter, TANK.bedY - .3, site.z);
        dummy.rotation.set(site.lean * .4, site.spin, site.lean);
        // Width varies per plant: a clump of identically proportioned stems reads
        // as one object stamped repeatedly, which is the giveaway of every
        // procedural garden. x and z stay equal or the leaves stretch to ribbons.
        dummy.scale.set(site.height * site.width, site.height, site.height * site.width);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  return { meshes, layout };
}
