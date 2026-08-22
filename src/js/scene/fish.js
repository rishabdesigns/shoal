import { CAUSTIC_GLSL } from './caustics.js';

// Fish body + swimming locomotion — the PARAMETERISED tier.
//
// Undulation is an analytic function of (position along spine, time, per-agent
// phase, per-agent beat rate). Nothing here is simulated: the user never interacts
// with a tail, they only watch it, so it costs a vertex-shader line instead of a
// solver. Everything runs on the GPU, so the whole school undulates for one draw
// call.
//
// The body is LOFTED FROM DRAWN PROFILES — a top curve, a bottom curve and a side
// curve, sampled into closed frames along the spine — rather than swept from a
// radius function. A radius function only ever produces a spindle; a silhouette
// you can actually draw is what decides which animal this is, and a goldfish is
// defined by a deep belly, a blunt head and a long forked tail that a single
// `radiusAt(t)` cannot express. Same construction as the reference pen, at 1/200th
// the resolution, because 420 of these ship in one instanced mesh.

// Fish space: x runs 0 at the nose to 10 at the tail root, y is up, z is the
// lateral half-width. Converted to local space on the way into the buffer, so the
// profiles below can be read as a side-elevation drawing.
const S = 0.1;                        // fish-space unit -> local unit
const LENGTH = 10;

// Deep-bodied and blunt-headed: a goldfish, not a mackerel. The shoulder sits at
// a third of the body and the caudal peduncle pinches hard before the tail.
const TOP =    [[0, 0], [0.15, 0.42], [1.0, 1.20], [3.0, 1.92], [5.2, 1.72], [7.6, 0.92], [10, 0.46]];
const BOTTOM = [[0, 0], [0.15, -0.34], [0.9, -1.00], [3.4, -1.58], [5.6, -1.34], [7.8, -0.68], [10, -0.40]];
// The side curve dips in y as it widens: the widest part of a fish is below its
// midline, which is what gives the body a keel instead of a barrel.
const SIDE =   [[0, 0, 0], [0.15, 0, 0.20], [1.0, -0.05, 0.54], [3.2, -0.20, 0.74], [5.6, -0.10, 0.52], [7.8, 0, 0.22], [10, 0, 0.07]];

// A long, deeply forked tail with trailing lobes — the single most recognisable
// thing about the fish in the reference, and the part a fan-of-three-triangles
// could never carry.
const CAUDAL = [[10.3, -1.05], [12.9, -2.70], [11.7, 0], [12.9, 2.70], [10.3, 1.05]];

const DORSAL = [[2.5, 2.02], [3.2, 2.98], [4.5, 2.82], [6.1, 2.05], [7.7, 0.98]];
const ANAL   = [[6.4, -1.22], [7.3, -2.24], [8.4, -0.76]];
const PELVIC = [[3.7, -1.62], [4.7, -2.74], [5.6, -1.30]];
// Pectorals are a flat blade on the flank rather than a fin rooted in a profile
// curve, so they are built from an outline instead of the loft.
const PECTORAL = [[1.95, -0.30], [2.55, -0.92], [3.20, -1.18], [3.60, -0.90], [3.25, -0.30]];

const vec = (THREE, p) => new THREE.Vector3(p[0], p[1], p[2] ?? 0);
const sample = (THREE, points, count = 80) =>
  new THREE.CatmullRomCurve3(points.map(p => vec(THREE, p))).getSpacedPoints(count);

// Linear read-off of a sampled profile at an arbitrary x. The profiles are
// monotonic in x by construction, which is what makes this safe.
function at(points, x, out) {
  if (x <= points[0].x) return out.copy(points[0]);
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i], b = points[i + 1];
    if (x >= a.x && x <= b.x) return out.lerpVectors(a, b, (x - a.x) / (b.x - a.x) || 0);
  }
  return out.copy(points[points.length - 1]);
}

export function createFishGeometry(THREE, { frames = 15, radial = 10 } = {}) {
  const positions = [];
  const uvs = [];
  const parts = [];      // 0 body, 1 fin — the fragment shader colours them apart
  const flanks = [];     // -1 left flank .. 0 back/belly .. +1 right flank
  const indices = [];

  const topPoints = sample(THREE, TOP);
  const bottomPoints = sample(THREE, BOTTOM);
  const sidePoints = sample(THREE, SIDE);

  const top = new THREE.Vector3(), bottom = new THREE.Vector3(), side = new THREE.Vector3();

  // Fish space -> local space. Forward is +Z because lookAt aims +Z, so the nose
  // lands at z = +0.5 and the tail root at z = -0.5 for a body of length 1.
  const push = (x, y, z, u, v, part, flank) => {
    positions.push(z * S, y * S, 0.5 - x * S);
    uvs.push(u, v);
    parts.push(part);
    flanks.push(flank);
  };

  // --- body: closed frames lofted along the spine ------------------------------
  const ring = radial + 1;             // seam duplicated so uv.y can run 0..1
  // Stations bunched toward the head, where the profile turns hardest. Evenly
  // spaced frames spend their budget on the straight middle and facet the skull.
  const stationAt = i => LENGTH * Math.pow(i / (frames - 1), 1.25);

  for (let i = 0; i < frames; i += 1) {
    const x = stationAt(i);
    if (i === 0) {
      // The nose is a point: the profiles all meet at the origin, and a
      // CatmullRom through four identical points has no arc length to space by.
      for (let j = 0; j < ring; j += 1) push(0, 0, 0, 0, j / radial, 0, 0);
      continue;
    }
    at(topPoints, x, top);
    at(bottomPoints, x, bottom);
    at(sidePoints, x, side);
    // Bottom -> right flank -> back -> left flank, closed. Four control points is
    // enough for an oval that is taller than it is wide and fuller below.
    const frame = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, bottom.y, 0),
      new THREE.Vector3(x, side.y, side.z),
      new THREE.Vector3(x, top.y, 0),
      new THREE.Vector3(x, side.y, -side.z)
    ], true).getSpacedPoints(radial);
    for (let j = 0; j < ring; j += 1) {
      const p = frame[j];
      push(x, p.y, p.z, x / LENGTH, j / radial, 0, p.z / (side.z + 1e-6));
    }
  }
  for (let i = 0; i < frames - 1; i += 1) {
    for (let j = 0; j < radial; j += 1) {
      const a = i * ring + j, b = a + 1, c = a + ring, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  // --- caudal fin: the last body frame lerped out to a flat tail outline --------
  // Built by interpolating the body's own ring toward a flat contour with the same
  // point count, so the joint is continuous — the tail grows out of the peduncle
  // instead of being a separate card stuck behind it.
  const half = new THREE.CatmullRomCurve3(CAUDAL.map(p => vec(THREE, p))).getPoints(radial / 2);
  const caudalRing = half.concat(half.slice(0, -1).reverse().slice(0, radial - half.length + 1));
  while (caudalRing.length < ring) caudalRing.push(half[half.length - 1]);

  const lastFrameStart = (frames - 1) * ring;
  const slices = 2;
  const caudalStart = positions.length / 3;
  const lerped = new THREE.Vector3();
  for (let k = 0; k <= slices; k += 1) {
    const ratio = k / slices;
    for (let j = 0; j < ring; j += 1) {
      const b = (lastFrameStart + j) * 3;
      // Read the body vertex back out of the buffer in LOCAL space, then undo the
      // mapping — cheaper than keeping a parallel copy of the last frame.
      const bx = (0.5 - positions[b + 2]) / S, by = positions[b + 1] / S, bz = positions[b] / S;
      const c = caudalRing[j];
      lerped.set(bx, by, bz).lerp(new THREE.Vector3(c.x, c.y, 0), ratio);
      push(lerped.x, lerped.y, lerped.z, j / radial, ratio, 1, 0);
    }
  }
  for (let k = 0; k < slices; k += 1) {
    for (let j = 0; j < radial; j += 1) {
      const a = caudalStart + k * ring + j, b = a + 1, c = a + ring, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  // --- profile-rooted fins: dorsal, anal, pelvics -------------------------------
  // Each is a thin closed pouch between an outline and the body profile directly
  // beneath it. Roots are READ FROM the profile rather than written as literals:
  // the back tapers hard toward the tail, so a fixed y that sits inside the body
  // at the front floats clear of it at the rear and the fin detaches.
  function addFin(outline, basePoints, isTop, transform) {
    const contour = sample(THREE, outline, outline.length * 2 - 2);
    const n = contour.length;
    const shift = 0.06 * (isTop ? 1 : -1);
    const root = new THREE.Vector3();
    const base = contour.map((p, index) => {
      at(basePoints, p.x, root);
      const v = new THREE.Vector3(p.x, root.y - shift, 0);
      if (index > 0 && index < n - 1) v.z = shift;
      return v;
    });
    const baseBack = base.slice(0, -1).reverse().map(p => p.clone().setZ(p.z === 0 ? 0 : -shift));
    const contourBack = contour.slice(0, -1).reverse();

    const start = positions.length / 3;
    const rows = [contour.concat(contourBack), base.concat(baseBack)];
    // uv.x runs out along the fin and back; uv.y is 0 at the root, 1 at the edge.
    const alongOf = index => (index < n ? index : (n - 1) * 2 - index) / (n - 1);
    for (let r = 0; r < 2; r += 1) {
      rows[r].forEach((p, index) => {
        const q = transform ? transform(p) : p;
        push(q.x, q.y, q.z, alongOf(index), 1 - r, 1, 0);
      });
    }
    const cols = rows[0].length;
    for (let c = 0; c < cols - 1; c += 1) {
      const a = start + c, b = a + 1, e = start + cols + c, f = e + 1;
      indices.push(a, e, b, b, e, f);
    }
  }

  addFin(DORSAL, topPoints, true);
  addFin(ANAL, bottomPoints, false);
  // Pelvics are paired and splay outward, so the same outline is used twice with a
  // roll about the fish's long axis.
  const roll = angle => p => {
    const c = Math.cos(angle), s = Math.sin(angle);
    const y = p.y + 0.6;   // roll about a hinge inside the belly, not the midline
    return new THREE.Vector3(p.x, y * c - p.z * s - 0.6, y * s + p.z * c);
  };
  addFin(PELVIC, bottomPoints, false, roll(0.42));
  addFin(PELVIC, bottomPoints, false, roll(-0.42));

  // --- pectorals: a flat blade on each flank -----------------------------------
  // Held clear of the body and angled back. These are what stop a swimming fish
  // reading as a torpedo — real ones are almost always visible in silhouette.
  function addPectoral(sign) {
    const outline = sample(THREE, PECTORAL, 8);
    const start = positions.length / 3;
    at(sidePoints, PECTORAL[0][0], side);
    const rootZ = side.z * 0.82;
    outline.forEach((p, index) => {
      const spread = 0.22 + (index / (outline.length - 1)) * 0.52;
      push(p.x, p.y, sign * (rootZ + spread), index / (outline.length - 1), 1, 1, sign);
    });
    // A single root vertex, fanned to the outline.
    push(PECTORAL[0][0] + 0.2, PECTORAL[0][1] - 0.1, sign * rootZ, 0, 0, 1, sign);
    const hub = start + outline.length;
    for (let i = 0; i < outline.length - 1; i += 1) {
      indices.push(hub, start + i + (sign > 0 ? 1 : 0), start + i + (sign > 0 ? 0 : 1));
    }
  }
  addPectoral(1);
  addPectoral(-1);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('parts', new THREE.Float32BufferAttribute(parts, 1));
  geometry.setAttribute('flank', new THREE.Float32BufferAttribute(flanks, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// Shubunkin markings, drawn procedurally so no two fish in the school carry the
// same coat. Built from interfering sines rather than a `fract(sin(dot(...)))`
// hash for the same reason the caustics are: the hash loses precision and the
// result reads as film grain welded to the body.
const PATTERN_GLSL = /* glsl */`
  float shoalBlob(vec2 p) {
    float a = sin(p.x * 1.7 + sin(p.y * 2.3) * 1.3);
    float b = sin(p.y * 1.9 - sin(p.x * 1.1) * 1.6);
    float c = sin((p.x - p.y) * 1.3 + 1.7);
    return (a + b + c) * 0.3333;
  }
`;

// The varieties in the bowl. ONE coat routine, eight sets of constants — the
// markings, the speckling and the countershading are the same code for every
// fish, and what makes a sarasa a sarasa rather than a shubunkin is which three
// colours it is drawn with.
//
// A school of one colour is a school with one silhouette: every fish reads as a
// copy of its neighbour and 420 of them read as texture rather than as animals.
// The value range matters more than the hue range — a bowl that is all orange at
// one value is flat however saturated the orange is, and the near-white, the
// slate and the two dark varieties are what give the mass its depth.
//
// Values are ALBEDO under a green key in fogged water, so they are authored a
// stop above where they should look as swatches. `sat` is how heavily the fish
// is speckled; `glow` is how much of its own light it carries back through the
// fog, which is a warm-variety trick and near zero on the cool ones.
//
// NOTE: `patch` is a reserved word in GLSL ES 3.0 and silently fails to compile.
const VARIETY_GLSL = /* glsl */`
  void shoalCoat(float v, out vec3 ground, out vec3 saddle, out vec3 accent,
                 out float speckAmt, out float glow) {
    if (v < 0.5) {                      // common orange — the bowl's default
      ground = vec3(1.00, 0.99, 0.96); saddle = vec3(1.00, 0.36, 0.02);
      accent = vec3(0.96, 0.14, 0.01); speckAmt = 0.85; glow = 1.0;
    } else if (v < 1.5) {               // calico shubunkin — slate over pearl
      ground = vec3(0.97, 0.96, 0.93); saddle = vec3(0.30, 0.43, 0.63);
      accent = vec3(1.00, 0.44, 0.06); speckAmt = 1.30; glow = 0.35;
    } else if (v < 2.5) {               // sarasa — red and white, barely speckled
      ground = vec3(1.00, 0.98, 0.95); saddle = vec3(0.90, 0.09, 0.05);
      accent = vec3(0.58, 0.03, 0.03); speckAmt = 0.22; glow = 0.9;
    } else if (v < 3.5) {               // lemon
      ground = vec3(1.00, 0.98, 0.86); saddle = vec3(1.00, 0.80, 0.12);
      accent = vec3(0.95, 0.57, 0.05); speckAmt = 0.30; glow = 0.8;
    } else if (v < 4.5) {               // moor — near-black with a copper edge
      ground = vec3(0.17, 0.15, 0.14); saddle = vec3(0.07, 0.07, 0.08);
      accent = vec3(0.36, 0.21, 0.09); speckAmt = 0.10; glow = 0.15;
    } else if (v < 5.5) {               // blue — cool slate, no orange anywhere
      ground = vec3(0.55, 0.61, 0.64); saddle = vec3(0.27, 0.34, 0.41);
      accent = vec3(0.66, 0.70, 0.72); speckAmt = 0.45; glow = 0.2;
    } else if (v < 6.5) {               // pearl with an orange cap
      ground = vec3(1.00, 0.99, 0.97); saddle = vec3(0.99, 0.53, 0.10);
      accent = vec3(0.98, 0.34, 0.05); speckAmt = 0.35; glow = 0.7;
    } else {                            // wild type — olive bronze
      ground = vec3(0.56, 0.48, 0.26); saddle = vec3(0.33, 0.28, 0.14);
      accent = vec3(0.76, 0.58, 0.23); speckAmt = 0.55; glow = 0.4;
    }
  }
`;

// Injects undulation and markings into a standard material so the fish still take
// scene lighting. `uniforms` is returned so the caller can advance uTime without
// touching internals.
export function applyUndulation(
  material,
  { amplitude = .15, waveK = 5.2, frequency = 9 } = {},
  water = null
) {
  // When the water's uniform block is supplied, the fish share ITS clock rather
  // than keeping a second one. Two clocks for one world is two things to advance
  // and one of them will eventually be forgotten.
  const uniforms = {
    uTime: water?.uTime ?? { value: 0 },
    uAmplitude: { value: amplitude },
    uWaveK: { value: waveK },
    uFrequency: { value: frequency }
  };
  if (water) Object.assign(uniforms, { uLight: water.uLight, uCaustic: water.uCaustic });

  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = `
      uniform float uTime, uAmplitude, uWaveK, uFrequency;
      attribute float aPhase;
      attribute float aBeat;
      attribute vec3 aCoat;
      attribute float parts;
      attribute float flank;
      varying float vParts;
      varying float vFlank;
      varying vec3 vCoat;
      varying vec3 vObject;
      ${water ? 'varying vec3 vWorldPos;' : ''}
    ` + shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vParts = parts;
      vFlank = flank;
      vCoat = aCoat;
      vObject = position;
      // Spine coordinate: 0 at the nose, 1 at the tail tip, >1 out along the fin.
      float spine = 0.5 - position.z;
      // CLAMPED for the amplitude term. Unclamped, the caudal fin reaches spine
      // 1.32, so spine*spine gives it 1.74x the tail root's throw and the fin
      // visibly tears off the body. Clamping holds the fin and the tail root on
      // the same amplitude, which is what keeps the joint continuous.
      float s = clamp(spine, 0.0, 1.0);
      // Amplitude grows with the square of distance from the head — a fish pivots
      // about a point behind the skull, it does not shimmy as a rigid body.
      float amp = uAmplitude * s * s;
      // Phase uses the UNCLAMPED spine so the fin still lags behind the tail.
      float wave = sin(aPhase + spine * uWaveK - uTime * uFrequency * aBeat);
      transformed.x += amp * wave;
      // Counter-yaw the front third so the head leads the turn instead of being
      // dragged sideways — this is what separates "swimming" from "vibrating".
      transformed.x -= uAmplitude * 0.30 * wave * max(0.0, 0.45 - spine);
      // Paired fins scull against the body's own beat rather than riding it, which
      // is the difference between a fin and a flap of skin.
      transformed.z += float(parts) * abs(flank) * cos(aPhase * 1.7 - uTime * uFrequency * aBeat) * 0.012;
    `);
    if (water) {
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
        vWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #include <project_vertex>
      `);
    }

    // Normals are left un-rotated: at the on-screen size of one fish in a school
    // the shading error is invisible, and rotating them costs a matrix per vertex.

    shader.fragmentShader = `
      uniform float uTime;
      ${water ? 'uniform float uCaustic;\nuniform vec3 uLight;\nvarying vec3 vWorldPos;' : ''}
      varying float vParts;
      varying float vFlank;
      varying vec3 vCoat;
      varying vec3 vObject;
      float vOrange;
      vec3 vSaddle;
      float vGlow;
      ${PATTERN_GLSL}
      ${VARIETY_GLSL}
      ${water ? CAUSTIC_GLSL : ''}
    ` + shader.fragmentShader.replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      // A little self-lit saddle. Fog is applied to the final colour, so a fish at
      // the back of the tank loses saturation before it loses brightness — the
      // saddles go to a grey-green wash long before the fish is meant to be far
      // away. Carrying a fraction of its own light back is what holds the hue
      // through the depth, and it is a fifth of a stop, not a glow. Keyed to the
      // fish's OWN saddle colour, so the red of a sarasa holds as red and a moor
      // does not quietly light itself orange.
      totalEmissiveRadiance += vSaddle * vOrange * 0.10 * vGlow;
    `).replace('#include <color_fragment>', `
      {
        // --- shubunkin coat ----------------------------------------------------
        // A ground colour, saddles concentrated toward the head, and hard
        // speckling over both. Everything keys off object space, so the markings
        // stay welded to the body while it undulates. Which THREE colours this
        // fish is drawn with comes from its variety — see VARIETY_GLSL.
        vec3 PEARL, ORANGE, RUST;
        float speckAmt, glow;
        shoalCoat(vCoat.z, PEARL, ORANGE, RUST, speckAmt, glow);
        vSaddle = ORANGE;
        vGlow = glow;
        vec3 INK    = vec3(0.08, 0.08, 0.09);

        float spine = clamp(0.5 - vObject.z, 0.0, 1.35);
        float snout = 1.0 - min(spine, 1.0);
        // Decorrelate the two flanks: a calico fish is not mirror-symmetric, and a
        // fish whose two sides match reads as a decal.
        //
        // The two axes are scaled to be ISOTROPIC. The body is 1.0 long and 0.38
        // deep, so equal multipliers on spine and y give blobs eight times wider
        // than they are tall — which arrives as horizontal STRIPES and turns a
        // shubunkin into a tetra. This is the whole difference between the two
        // fish, and it is one constant.
        vec2 coat = vec2(spine * 3.0, vObject.y * 8.5 + sign(vFlank) * 11.3) + vCoat.x;

        float saddle = shoalBlob(coat);
        // The head is orange-dominant in every fish, the body is a lottery.
        float headBias = smoothstep(0.50, 0.95, snout) * 0.85;
        // A tight ramp: on the real animal a patch has an EDGE. Feathered over a
        // wide range the whole fish becomes one airbrushed gradient.
        float orange = smoothstep(0.10, 0.24, saddle + headBias + vCoat.y);
        vec3 col = mix(PEARL, ORANGE, orange);
        col = mix(col, RUST, smoothstep(0.46, 0.95, saddle + headBias) * 0.5);

        // Speckles sit mostly on the pale ground, as they do on the real animal.
        // How MANY is the variety's business: a calico is peppered, a sarasa is
        // two clean colours and nothing else.
        float speck = smoothstep(0.46, 0.70, shoalBlob(coat * 3.1 + 5.1));
        col = mix(col, INK, speck * (1.0 - orange * 0.5) * speckAmt);

        // Countershading: dark back, bright belly. Without it a fish lit from
        // above still reads as a flat cut-out from the side.
        float height = clamp(vObject.y / 0.19 * 0.5 + 0.5, 0.0, 1.0);
        col *= mix(1.06, 0.92, smoothstep(0.15, 0.95, height));

        // --- eye ---------------------------------------------------------------
        // Gated on the flank so it appears once per side and never on the crown.
        float eyeD = length((vec2(spine, vObject.y) - vec2(0.115, 0.045)) * vec2(1.0, 1.35));
        float onFlank = smoothstep(0.45, 0.85, abs(vFlank));
        col = mix(col, vec3(0.96, 0.58, 0.14), smoothstep(0.042, 0.034, eyeD) * onFlank);
        col = mix(col, vec3(0.02, 0.02, 0.03), smoothstep(0.029, 0.022, eyeD) * onFlank);

        // --- fins --------------------------------------------------------------
        if (vParts > 0.5) {
          // uv.y is 0 at the root and 1 at the edge; uv.x runs along the outline.
          float edge = clamp(vUv.y, 0.0, 1.0);
          // Fin rays. Thin bright lines over a translucent membrane — the detail
          // that stops a fin reading as a paper triangle.
          float ray = sin(vUv.x * 42.0) * 0.5 + 0.5;
          vec3 fin = mix(mix(PEARL, ORANGE, orange * 0.8), vec3(0.90, 0.93, 0.90), edge * 0.85);
          fin *= 0.80 + ray * 0.20;
          fin = mix(fin, INK, smoothstep(0.48, 0.74, shoalBlob(vUv * vec2(6.0, 2.4) + vCoat.x)) * 0.6);
          // Faked translucency: the membrane thins toward its edge and lets the
          // water behind it through, so it loses value rather than gaining it.
          // The first pass brightened the edge instead, which made every fin the
          // lightest thing on screen and the school read as a drift of white
          // petals with fish attached. Cheaper than a second transparent pass.
          col = mix(col, fin, smoothstep(0.0, 0.30, edge));
          col *= 1.0 - edge * edge * 0.34;
        }

        diffuseColor.rgb = col;
        vOrange = orange;
      }
      #include <color_fragment>
      ${water ? `
        // Same caustic field as the backdrop, sampled at the fish's own world
        // position, so light bands travel across bodies and wall together.
        // Kept low: pushed hard this clips to white and the school flattens into
        // a sheet of paper cut-outs.
        float causticOnBody = shoalCaustic(vWorldPos.xy * 0.5, uTime) * uCaustic;
        diffuseColor.rgb += uLight * causticOnBody * 0.20;
      ` : ''}
    `);
  };
  // Distinct key per variant, or three.js reuses one compiled program for both the
  // caustic and non-caustic materials and one of them renders with the wrong shader.
  material.customProgramCacheKey = () => (water ? 'fish-goldfish-caustic' : 'fish-goldfish');
  return uniforms;
}

// Per-instance attributes the shader above expects. `aCoat` carries the coat
// seed, the per-fish saddle bias and the VARIETY INDEX — packed into one vec3
// because three scalars would be three more attribute slots and three more
// buffers to keep in step.
export function attachInstanceAttributes(THREE, mesh, count) {
  const phase = new Float32Array(count);
  const beat = new Float32Array(count).fill(1);
  const coat = new Float32Array(count * 3);
  mesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  mesh.geometry.setAttribute('aBeat', new THREE.InstancedBufferAttribute(beat, 1));
  mesh.geometry.setAttribute('aCoat', new THREE.InstancedBufferAttribute(coat, 3));
  return { phase, beat, coat };
}
