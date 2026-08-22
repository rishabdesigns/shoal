// The parameterised water: backdrop, caustics, bubbles and suspended motes.
//
// None of this is simulated. The user never interacts with the light, only with the
// school, so all of it is an analytic function of position and time.
//
// There are NO GODRAYS here any more. Shafts from the surface are the first thing
// everyone reaches for to say "underwater", and they were the most artificial thing
// in the frame: seven soft-edged additive quads at a fixed depth, which the eye
// reads as translucent panes hanging in front of the back wall rather than as
// light in a volume. The caustics do the same job honestly — they are cast BY the
// same surface, and they break over the floor, the plants and the fish, which a
// quad standing in mid-water can never do.
import { CAUSTIC_GLSL } from './caustics.js';
import { PALETTE, TANK, MOTES, BUBBLES, BUBBLE_RISE } from '../config.js';

// A single shared clock. Passing one uniform object to every system is what keeps
// the backdrop, the rays and the fish in phase with each other.
export function createWaterUniforms(THREE) {
  return {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color(PALETTE.deep) },
    uMid: { value: new THREE.Color(PALETTE.mid) },
    uShallow: { value: new THREE.Color(PALETTE.shallow) },
    uSurface: { value: new THREE.Color(PALETTE.surface) },
    uLight: { value: new THREE.Color(PALETTE.light) },
    uCaustic: { value: 0.62 }
  };
}

// The rear wall of the tank: a depth gradient with caustics playing over it. This
// is also the scene's value floor — everything else is read against it.
export function createBackdrop(THREE, uniforms) {
  // Sized to the frustum at TANK.backdropZ, which is now well behind the gravel —
  // the old 120x70 at z = -13 sat IN FRONT of the floor and clipped it off.
  const geometry = new THREE.PlaneGeometry(240, 150);
  const material = new THREE.ShaderMaterial({
    uniforms,
    // WRITES DEPTH. As a non-writing "skybox" it was drawn first and then
    // overpainted by anything that happened to extend past it — the bed plane
    // ran 12 units BEHIND this wall and drew right over it, and the far edge of
    // a plane that should never have been visible was the hard horizontal line
    // across the lower third of the frame.
    depthWrite: true,
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime, uCaustic;
      uniform vec3 uDeep, uMid, uShallow, uSurface, uLight;
      varying vec3 vWorld;
      ${CAUSTIC_GLSL}
      void main() {
        // Depth attenuation: light is absorbed with depth, so the gradient runs
        // top-to-bottom and IS the reason the lower frame is quiet. It is a
        // property of the water, not a plate placed behind the type.
        // ZERO AT THE SUBSTRATE LINE, not 11 units below it. scene.fog resolves
        // every distant surface to exactly uDeep, so the wall has to BE uDeep at
        // the height where the floor and the back thicket fade into it — or the
        // fogged floor and the wall behind it are two different colours meeting
        // at a hard edge, which is what a "flat overlay" in the lower frame
        // always turns out to be.
        float h = clamp((vWorld.y + 12.0) / 34.0, 0.0, 1.0);
        vec3 color = mix(uDeep, uMid, smoothstep(0.0, 0.60, h));
        // The lit water is held to the TOP EIGHTH of the wall and to a third of
        // its own strength. This gradient is the brightest thing in the frame
        // that is not a fish, and every stop it gains is a stop of contrast the
        // school loses — the subject is orange bodies against dark water, and a
        // backdrop that climbs to 98 out of 255 at the frame edge is competing
        // with them for the eye rather than carrying them.
        color = mix(color, uShallow, smoothstep(0.86, 1.0, h) * 0.30);
        // The WATERLINE. A tank has a top, and the band where the surface is seen
        // from below is most of what says "aquarium" rather than "ocean" — it is
        // the one edge in the frame that is not water. Kept as a thin edge rather
        // than a wash: it needs to be READ, not to light the room.
        float ripple = sin(vWorld.x * 0.21 + uTime * 0.55) * 0.010
                     + sin(vWorld.x * 0.53 - uTime * 0.31) * 0.006;
        color = mix(color, uSurface, smoothstep(0.968, 0.999, h + ripple) * 0.34);
        // Caustics fall off with depth too — they are cast from the surface.
        // Sampled FINER than the fish and the floor are. The wall is 62 units
        // away and 200 across, so a field scaled for objects an arm's length from
        // the camera arrives on it as blobs a hundred pixels wide — light on
        // water read as smeared paint, which is the single thing in the frame
        // most likely to be taken for a rendering fault.
        // TWO OCTAVES, rotated and out of phase. One set of interfering sines is a
        // regular lattice, and on a flat wall a regular lattice reads as a tiled
        // texture rather than as light — the second octave at a different scale is
        // what turns a pattern back into a phenomenon.
        vec2 cp = vWorld.xy * 1.35;
        float c = shoalCaustic(cp, uTime) * 0.62
                + shoalCaustic(cp.yx * 1.9 + 7.3, uTime * 1.37) * 0.38;
        c *= uCaustic * smoothstep(0.05, 0.95, h);
        // A sixteenth of a stop. On the old, over-bright wall this was scenery;
        // against a wall this dark the same value reads as a field of pale
        // blobs — the eye finds a repeating soft shape long before it finds a
        // gradient, and a repeating soft shape on a flat plane is bokeh, not
        // caustics. Whatever light the wall gets now, it gets by suggestion.
        color += uLight * c * 0.055;
        gl_FragColor = vec4(color, 1.0);
        // WITHOUT THIS the whole wall is written to an sRGB framebuffer as raw
        // LINEAR values — a third of a stop of everything, and 0x061a18 arrives
        // as luminance 2 instead of 22. Three.js only inserts this conversion
        // into its own materials; a hand-written ShaderMaterial has to ask.
        //
        // The visible symptom was not "the backdrop is dark". It was a hard-edged
        // lighter SLAB across the lower frame: scene.fog resolves to PALETTE.deep
        // through the standard pipeline at luminance 22, the backdrop rendered
        // the same colour at luminance 2, and every fogged-out surface — the bed
        // plane, the far gravel, the back thicket — cut a bright rectangle out of
        // a wall that was ten times too dark to receive it.
        #include <colorspace_fragment>
      }
    `
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = TANK.backdropZ;
  mesh.renderOrder = -10;
  return mesh;
}

// Bubbles. The single cheapest thing in this file and the one that decides
// whether the frame is a tank or a school of fish floating in green air.
//
// A viewer does not read "water" from a blue gradient — every one of the cues
// that actually says water is a piece of MOTION with a direction the rest of the
// scene does not have. Fish drive forward and bank, silt drifts, and bubbles go
// straight up, accelerating, wobbling, at a speed nothing else in the frame
// moves at. One contrary vector is worth more than any amount of tint.
//
// Two populations from one buffer: a scattered few coming off the plants, and
// STREAMS from three points in the gravel, which is what a tank with an airstone
// in it looks like. The streams are the half that reads as deliberate.
export function createBubbles(THREE, uniforms, random) {
  const positions = new Float32Array(BUBBLES * 3);
  // seed, radius (world), wobble amplitude, rise speed
  const traits = new Float32Array(BUBBLES * 4);
  const b = TANK.bounds;
  // Three vents in the gravel, held out of the middle third: a stream of bubbles
  // rising through the school is a curtain across the subject.
  const vents = [
    { x: -b.x * .72, z: -3.4 },
    { x: b.x * .58, z: 1.2 },
    { x: -b.x * .36, z: -5.0 }
  ];
  for (let i = 0; i < BUBBLES; i += 1) {
    // Two in three come off a vent. The strays are what stop the streams reading
    // as three pieces of scenery rather than as air in the water.
    const vent = random() < .66 ? vents[(random() * vents.length) | 0] : null;
    positions[i * 3]     = vent ? vent.x + (random() - .5) * 1.1 : (random() - .5) * b.x * 2.3;
    // The phase along the rise. Stored in y and turned into a loop by the shader,
    // so a bubble is only ever one modulo — no per-frame work on the CPU at all.
    positions[i * 3 + 1] = random() * BUBBLE_RISE;
    positions[i * 3 + 2] = vent ? vent.z + (random() - .5) * 1.1 : (random() - .5) * b.z * 2.2;
    traits[i * 4]     = random() * 6.283;
    // Sizes are heavily skewed small. A field of evenly sized bubbles reads as a
    // particle system; a real stream is mostly pinheads with the occasional
    // wobbling big one, and the big ones are what the eye actually tracks.
    traits[i * 4 + 1] = 0.030 + Math.pow(random(), 2.2) * 0.150;
    traits[i * 4 + 2] = 0.12 + random() * 0.42;
    // Big bubbles rise faster — buoyancy beats drag. Getting this backwards is
    // what makes a bubble field look like falling snow played in reverse.
    traits[i * 4 + 3] = 1.5 + traits[i * 4 + 1] * 22.0 + random() * 0.8;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aBubble', new THREE.Float32BufferAttribute(traits, 4));

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */`
      attribute vec4 aBubble;
      uniform float uTime;
      varying float vFade;
      varying float vSize;
      void main() {
        vec3 p = position;
        // One modulo IS the whole simulation: rise, loop, start again at the bed.
        float travel = mod(p.y + uTime * aBubble.w, ${BUBBLE_RISE.toFixed(1)});
        p.y = ${TANK.bedY.toFixed(2)} + travel;
        // Bubbles do not go straight up. They spiral, and the wobble WIDENS as
        // they rise and speed up — a bubble on a perfectly straight line reads as
        // a tracer round.
        float climb = travel / ${BUBBLE_RISE.toFixed(1)};
        float wobble = aBubble.z * (0.25 + climb);
        p.x += sin(uTime * 2.1 + aBubble.x) * wobble;
        p.z += cos(uTime * 1.7 + aBubble.x * 1.6) * wobble * 0.7;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        // Perspective size, from a world radius — so a bubble at the back of the
        // tank is a pinhead and one at the front is a lens.
        vSize = aBubble.y * 900.0 / -mv.z;
        gl_PointSize = max(vSize, 1.5);
        // Fade in off the bed and out at the surface, or bubbles pop into
        // existence in mid-water and vanish against the waterline.
        vFade = smoothstep(0.0, 0.06, climb) * smoothstep(1.0, 0.86, climb);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uLight;
      varying float vFade;
      varying float vSize;
      void main() {
        // A bubble is a LENS, not a dot: nearly invisible in the middle, bright
        // at the rim where the sphere turns away, with one specular highlight
        // where the surface catches the light from above. Drawn as a filled disc
        // it is a snowflake, and this is the entire difference.
        vec2 p = gl_PointCoord - 0.5;
        float d = length(p) * 2.0;
        if (d > 1.0) discard;
        float rim = smoothstep(0.55, 0.95, d) * (1.0 - smoothstep(0.95, 1.0, d));
        float highlight = smoothstep(0.40, 0.0, length(p - vec2(-0.15, 0.17)) * 2.0);
        float fill = (1.0 - smoothstep(0.0, 0.9, d)) * 0.09;
        // Below about three pixels there is no room for a rim and a highlight, so
        // the bubble collapses to a soft dot rather than to aliased confetti.
        float small = smoothstep(4.0, 1.5, vSize);
        float a = mix(rim * 0.80 + highlight * 0.70 + fill,
                      (1.0 - smoothstep(0.0, 1.0, d)) * 0.55, small);
        gl_FragColor = vec4(uLight, clamp(a, 0.0, 1.0) * vFade * 0.95);
        #include <colorspace_fragment>
      }
    `
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

// Suspended silt. Separate from the fish by MOTION and SHAPE, not just colour —
// two particle systems that differ only in tint read as one system with a bug.
export function createMotes(THREE, uniforms, random) {
  const positions = new Float32Array(MOTES * 3);
  const seeds = new Float32Array(MOTES);
  const b = TANK.bounds;
  for (let i = 0; i < MOTES; i += 1) {
    positions[i * 3]     = (random() - .5) * b.x * 2.6;
    positions[i * 3 + 1] = (random() - .5) * b.y * 2.4;
    positions[i * 3 + 2] = (random() - .5) * b.z * 2.2;
    seeds[i] = random() * 6.283;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute float aSeed;
      uniform float uTime;
      varying float vFade;
      void main() {
        vec3 p = position;
        // Motes rise and wobble; fish drive forward and bank. Different motion is
        // what stops the two systems reading as one.
        p.y += mod(uTime * 0.24 + aSeed * 3.0, 22.0) - 11.0;
        p.x += sin(uTime * 0.31 + aSeed) * 0.7;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (1.0 + fract(aSeed) * 2.2) * (34.0 / -mv.z);
        vFade = 0.30 + 0.55 * fract(aSeed * 1.7);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uLight;
      varying float vFade;
      void main() {
        // Round, soft. gl_PointCoord gives a square without this.
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.06, d) * vFade;
        gl_FragColor = vec4(uLight, a * 0.42);
        #include <colorspace_fragment>
      }
    `
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}
