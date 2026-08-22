// The gravel bed — the tank's floor, as actual geometry.
//
// PROCEDURAL, not a texture. A photographed gravel plane gives itself away the
// moment anything moves: it has no silhouette against the water, no pebble ever
// occludes another, and the caustics slide across it like a slide projector rather
// than breaking over stones. Instanced solids cost one draw call and fix all three.
//
// Scattered to a roughly constant ON-SCREEN size: a bed of world-constant pebbles
// dissolves into noise by the middle distance and the tank loses its floor exactly
// where it most needs one. Pebbles therefore grow with depth, and so does the
// spacing between them.
import { CAUSTIC_GLSL } from './caustics.js';
import { PALETTE, GRAVEL_COLOURS, GRAVEL, TANK, CAMERA } from '../config.js';

// One irregular pebble, reused. Per-instance rotation and non-uniform scale supply
// the variety — jittering the shared mesh once and rotating it 2,000 ways is
// indistinguishable from 2,000 meshes, at 1/2000th of the build cost.
function pebbleGeometry(THREE, random) {
  const geometry = new THREE.IcosahedronGeometry(1, 0);   // 20 triangles
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  for (let i = 0; i < position.count; i += 1) {
    // Jitter HALVED. At +/-20% on a twelve-vertex solid a single displaced vertex
    // is a crease running a third of the way round the stone, and smooth normals
    // over a crease read as folded card — the bed looked like crumpled paper for
    // exactly this reason. A pebble twenty pixels across needs an irregular
    // OUTLINE, not an irregular surface.
    const k = 0.90 + random() * 0.20;
    const x = position.getX(i) * k, y = position.getY(i) * k * 0.78, z = position.getZ(i) * k;
    position.setXYZ(i, x, y, z);
    // Normals from the DIRECTION, not from the faces. A twenty-triangle solid with
    // face normals shades as twenty flat plates and the bed reads as a drift of
    // dead leaves; the same twenty triangles shaded as a deformed sphere read as
    // rounded stones. Twenty triangles either way — the whole difference is here.
    const length = Math.hypot(x, y, z) || 1;
    normal.setXYZ(i, x / length, y / length, z / length);
  }
  position.needsUpdate = true;
  normal.needsUpdate = true;
  return geometry;
}

export function createGravel(THREE, uniforms, random) {
  const tan = Math.tan(CAMERA.fov * Math.PI / 360);
  const distanceTo = z => CAMERA.distance - z;
  // World size grows with distance, but SLOWER than the perspective shrink — so
  // near stones are visibly larger on screen than far ones and the bed reads as a
  // surface going away from the camera. See GRAVEL.perspective.
  const sizeAt = z =>
    GRAVEL.size * Math.pow(distanceTo(z) / CAMERA.distance, GRAVEL.perspective);
  const halfWidthAt = z => distanceTo(z) * tan * GRAVEL.aspect;

  // --- scatter -----------------------------------------------------------------
  const rows = [];
  for (let z = TANK.floorFrom; z > TANK.floorTo;) {
    rows.push(z);
    z -= sizeAt(z) * GRAVEL.spacing * 1.9;
  }
  const placements = [];
  for (const z of rows) {
    const size = sizeAt(z);
    const step = size * GRAVEL.spacing;
    const half = halfWidthAt(z);
    for (let x = -half; x <= half; x += step) {
      placements.push(x, z, size);
    }
  }
  const count = placements.length / 3;

  const geometry = pebbleGeometry(THREE, random);
  const material = new THREE.MeshStandardMaterial({
    // WET. Gravel under water is glossy, and at roughness .92 every stone was a
    // matte chip lit only by the ambient term — which is why the bed read as
    // pressed card rather than as stone. The specular is what tells the eye there
    // is water above the floor as well as around it.
    color: 0xffffff, roughness: .66, metalness: 0, fog: true
  });
  applyGravelShading(material, uniforms);

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  const colour = new THREE.Color();
  for (let i = 0; i < count; i += 1) {
    const x = placements[i * 3], z = placements[i * 3 + 1], size = placements[i * 3 + 2];
    const step = size * GRAVEL.spacing;
    // Jitter inside the cell. A grid this regular reads as tiling from across the
    // room even when every stone on it is different.
    dummy.position.set(
      x + (random() - .5) * step * .85,
      TANK.bedY + (random() - .5) * size * .5 + size * .35,
      z + (random() - .5) * step * .85
    );
    // GRAVEL SETTLES. Spin freely about the vertical, but tilt only a little:
    // stones fall flat side down, and a bed rotated freely on all three axes has
    // a third of its pebbles standing on edge, which is what made the floor read
    // as scattered debris rather than as a bed something had been poured into.
    dummy.rotation.set(
      (random() - .5) * .8, random() * 6.283, (random() - .5) * .8
    );
    // Size is skewed, not uniform. Grading a substrate evenly is what makes it
    // read as a printed texture: real gravel is mostly one grade with a scatter
    // of stones two and three times the size, and those big ones are the only
    // thing in the bed that gives the eye a scale to read the rest against.
    const grade = .78 + Math.pow(random(), 2.6) * 1.05;
    dummy.scale.set(
      size * grade * (.82 + random() * .5),
      size * grade * (.5 + random() * .34),
      size * grade * (.82 + random() * .5)
    );
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    colour.setHex(GRAVEL_COLOURS[(random() * GRAVEL_COLOURS.length) | 0]);
    // Value spread within the drawn palette, so the bed has grain as well as hue.
    const v = .46 + random() * .34;
    mesh.setColorAt(i, colour.multiplyScalar(v));
  }
  mesh.instanceColor.needsUpdate = true;
  mesh.renderOrder = -3;
  return { mesh, count };
}

// The bed the pebbles sit on. Without it the gaps between stones show the fogged
// backdrop and the floor reads as a scattering of debris floating in mid-water.
export function createBedPlane(THREE) {
  // Long enough to meet the backdrop and NOT ONE UNIT LONGER. It used to run 24
  // units past the wall; the wall does not write depth generously enough to hide
  // a plane behind it, and the far edge of the overshoot was a hard horizontal
  // line across the lower frame.
  const length = Math.abs(TANK.backdropZ - TANK.floorFrom);
  const geometry = new THREE.PlaneGeometry(300, length);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({
    color: PALETTE.deep, roughness: 1, metalness: 0, fog: true
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, TANK.bedY - .35, (TANK.floorFrom + TANK.backdropZ) / 2);
  mesh.renderOrder = -4;
  return mesh;
}

// Caustics on the stones. This is the single detail that welds the floor to the
// water above it: the same field that plays on the backdrop and across the fish
// breaks over the pebbles, so all three read as being lit by one surface.
function applyGravelShading(material, uniforms) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, {
      uTime: uniforms.uTime, uLight: uniforms.uLight, uCaustic: uniforms.uCaustic
    });
    shader.vertexShader = 'varying vec3 vWorldPos;\nvarying float vStone;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', `
        #include <begin_vertex>
        // How far up its OWN body this vertex sits, -1 at the underside and +1 at
        // the crown. The stone is a unit solid before the instance matrix, so this
        // is the same number whatever size the pebble ends up.
        vStone = normalize(position).y;
      `)
      .replace('#include <project_vertex>', `
        vWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #include <project_vertex>
      `);
    shader.fragmentShader = `
      uniform float uTime, uCaustic;
      uniform vec3 uLight;
      varying vec3 vWorldPos;
      varying float vStone;
      ${CAUSTIC_GLSL}
    ` + shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      // CREVICE OCCLUSION. Every stone in a bed is surrounded by other stones, so
      // almost no sky reaches its lower half — and the gaps between stones are the
      // darkest thing in the substrate. Without this the bed is uniformly lit from
      // above and reads as one pale sheet with a pattern printed on it, which is
      // the single biggest reason a procedural gravel bed looks fake. One
      // varying, no extra geometry, no shadow map.
      diffuseColor.rgb *= mix(0.46, 1.0, smoothstep(-0.85, 0.60, vStone));
      // Sampled in the horizontal plane — caustics are cast DOWN onto the floor,
      // so the field runs across xz here where it runs across xy on a wall. Only
      // the upward-facing stone catches them, as light from above does.
      float causticOnBed = shoalCaustic(vWorldPos.xz * 0.45, uTime) * uCaustic;
      diffuseColor.rgb += uLight * causticOnBed * 0.42 * smoothstep(-0.2, 0.8, vStone);
      // The nearest bed — the strip along the bottom of the frame — sits below and
      // in front of the light shafts, and falls off into the foreground shadow.
      // This is a lighting fact about a tank lit from above and behind, and it is
      // also what gives the marginalia something dark to sit on without a plate
      // being placed anywhere.
      diffuseColor.rgb *= mix(0.30, 1.0, smoothstep(2.0, -18.0, vWorldPos.z));
    `).replace('#include <fog_fragment>', `
      #include <fog_fragment>
    `);
  };
  material.customProgramCacheKey = () => 'gravel-caustic';
}
