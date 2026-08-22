// Reynolds boids over a fixed agent set — the one SIMULATED phenomenon.
//
// Pure: no THREE, no DOM, no rendering — the simulation can be exercised on its
// own, without importing the rendering world.

// Deterministic LCG. Same seed, same start state, or two runs cannot be compared.
export function createRandom(seed) {
  let state = seed >>> 0;
  return () => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;
}

// Radius of the core exclusion sphere, as a fraction of repelRadius.
const CAVITY_FRACTION = 0.36;

export const FLOCK_DEFAULTS = {
  count: 420,
  seed: 0x5140a1,

  maxSpeed: 4.6,           // CRUISE ceiling
  minSpeed: 0.55,          // fish never stop dead — failure mode 8
  accelClamp: 90,
  // A fleeing fish bursts. With flight capped at cruise speed the school cannot
  // outrun the threat, so the cavity never opens.
  burstGain: 0.62,         // alarm magnitude -> extra speed multiplier
  burstMax: 1.45,          // hard ceiling on that multiplier

  sep: 1.85,               // separation weight (force ∝ d⃗/d²)
  ali: 0.78,               // alignment weight
  coh: 0.30,               // cohesion weight
  neighbour: 2.7,          // neighbour radius, and the spatial-hash cell size

  repelRadius: 6.2,        // pointer influence radius, measured off the threat RAY
  repelForce: 110,         // inverse-square numerator
  repelFloor: 0.55,        // distance floor — failure mode 5 (NaN at d→0)
  anticipation: 0.16,      // seconds of pointer velocity to lead the threat by
  // A moving pointer outruns a fish (sweep ~19 u/s vs burst ~11 u/s), so a slow
  // lag means `resp` never reaches its target before the threat has moved on.
  // The STAGGER comes from the spread between these two, not their magnitude.
  reactionLag: 0.13,       // MAX per-agent response time constant
  reactionLagMin: 0.02,

  wander: 2.1,             // strength of the idle flow field
  // Spatial frequency. LOW keeps neighbours correlated so groups drift together
  // — but at 0.14 the field had one convergence across the whole tank
  // and the school parked in it as a single ball with the frame empty around it.
  // 0.19 gives several convergences, which is what sub-schools are made of, and
  // still turns over only 0.44 rad across a neighbour radius.
  flowScale: 0.27,
  flowSpeed: 0.28,         // how fast the field itself evolves

  bounds: { x: 16, y: 8.4, z: 5.2 },   // tank half-extents AT z = 0; refitted to the frame
  // The tank is a frustum slab, not a box. What the viewer sees is a wedge that is
  // narrower at the near wall than at the far one, so a BOX either clips its front
  // corners off the screen edges or leaves the back of the frame empty. The first
  // version of the fit got the second: a school squeezed into two thirds of the
  // frame with a bare left column.
  //
  // `taper` is how much the half-extent grows per unit of depth away from camera.
  // Zero is a plain box, which is what the isolated study wants.
  taper: { x: 0, y: 0 },
  // The walls are now the edge of the FRAME, so a fish that crosses one is a fish
  // sliced in half by the window. The fitted tank made the same 7.5 that had been
  // fine against a wall 5 units off-screen let fish 2.8 units past a wall that IS
  // the screen. Stiffer, and starting further in.
  boundForce: 14,
  boundSoft: 2.1,          // how far inside the wall the push begins

  // Composition corral. The flow field has convergences, and left alone the school
  // parks in one of them — measured pressed flat against the right wall with half
  // the tank empty. This is a soft home region, not a tether: inside
  // `homeFraction` of the tank there is no force at all, so the school still roams
  // and still makes its own shapes; beyond it, a gentle pull brings it back.
  //
  // Measured on the tank's OWN axes rather than as a sphere. A sphere sized to a
  // 22-unit-wide tank never engages in a 9-unit-tall one, so the corral silently
  // stopped doing anything vertically — and once bounds are refitted per viewport
  // (world.resize) a fixed radius means something different at every breakpoint.
  home: { x: 0, y: 0, z: 0 },
  homeFraction: 0.80,
  homing: 2.4
};

export class Flock {
  constructor(options = {}) {
    // The nested objects are CLONED, not spread by reference. `refit` and
    // `world.resize` mutate bounds, taper and home in place, and a shared
    // reference would have every Flock ever constructed writing into
    // FLOCK_DEFAULTS — including the copy the study reads its slider ranges from.
    this.params = {
      ...FLOCK_DEFAULTS, ...options,
      bounds: { ...FLOCK_DEFAULTS.bounds, ...(options.bounds ?? {}) },
      taper: { ...FLOCK_DEFAULTS.taper, ...(options.taper ?? {}) },
      home: { ...FLOCK_DEFAULTS.home, ...(options.home ?? {}) }
    };
    const n = this.params.count;

    // Everything preallocated. No allocation in the loop — ever.
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.acc = new Float32Array(n * 3);   // last frame's acceleration, for banking
    this.resp = new Float32Array(n * 3);  // lagged pointer response — stagger + overshoot
    this.lag = new Float32Array(n);       // per-agent reaction time constant
    this.phase = new Float32Array(n);     // tail-beat phase offset
    this.scale = new Float32Array(n);     // per-agent body size

    // Spatial hash (uniform grid, counting sort). Naive O(n²) measured 11.4 ms at
    // 260 agents; this scene runs 420.
    this._sizeGrid();
    this.order = new Int32Array(n);
    this.cellOf = new Int32Array(n);

    this._pointer = null;
    this._prevPointer = { x: 0, y: 0, z: 0, valid: false };
    this._threat = { x: 0, y: 0, z: 0 };
    // The view axis the threat ray runs along. Default points away from a camera
    // on +Z, which is what the isolated study uses.
    this._axis = { x: 0, y: 0, z: -1 };
    this.time = 0;
    this.frameMs = 0;

    // One reused object — sample() may be polled every frame, and a sample() that
    // allocates shows up as the leak you are hunting.
    this._sample = {
      simTime: 0, maxSpeed: 0, minSpeed: 0, meanSpeed: 0, minPointerDistance: 99, meanNeighbour: 0,
      boundingRadius: 0, escape: 0, nearPointer: 0, cavityRatio: 1, cavityEma: 1,
      alarm: 0, alarmPeak: 0,
      finite: true, agents: n, frameMs: 0
    };

    // Sustained depletion, not the instantaneous count: the pointer sweeping into
    // a dense cluster spikes the raw ratio for a few frames before the fish clear,
    // and a per-frame assertion on that is measuring arrival, not scatter.
    this._cavityEma = 1;

    this.reset();
  }

  _sizeGrid() {
    const { bounds, taper, neighbour } = this.params;
    this.cell = neighbour;
    // Sized to the frustum's WIDEST slice — the far wall — or agents at the back
    // of the tank hash outside the grid and stop seeing their neighbours.
    const spanX = bounds.x + taper.x * bounds.z;
    const spanY = bounds.y + taper.y * bounds.z;
    // One cell of padding each side so agents pushed past the wall still hash.
    this.nx = Math.max(1, Math.ceil((spanX * 2 + this.cell * 4) / this.cell));
    this.ny = Math.max(1, Math.ceil((spanY * 2 + this.cell * 4) / this.cell));
    this.nz = Math.max(1, Math.ceil((bounds.z * 2 + this.cell * 4) / this.cell));
    this.originX = -spanX - this.cell * 2;
    this.originY = -spanY - this.cell * 2;
    this.originZ = -bounds.z - this.cell * 2;
    this.cellCount = this.nx * this.ny * this.nz;
    if (!this.cellStart || this.cellStart.length !== this.cellCount + 1) {
      this.cellStart = new Int32Array(this.cellCount + 1);
    }
  }

  // Resize the tank. Called from world.resize() once the camera knows how much of
  // the world is actually on screen — the tank is a composition device, and a tank
  // wider than the frame is just fish being cut in half by the window edge.
  //
  // The grid is re-derived here and nowhere else: bounds and the spatial hash that
  // indexes them are one fact, and a resize that changed one without the other
  // would hash live agents into cells that no longer exist.
  refit(bounds, taper = { x: 0, y: 0 }) {
    const b = this.params.bounds, t = this.params.taper;
    if (b.x === bounds.x && b.y === bounds.y && b.z === bounds.z
        && t.x === taper.x && t.y === taper.y) return;
    b.x = bounds.x; b.y = bounds.y; b.z = bounds.z;
    t.x = taper.x; t.y = taper.y;
    this._sizeGrid();
    // Only on the FIRST fit, before the page has been seen. Re-seeding the school
    // because someone dragged their window edge would throw away the state they
    // were watching.
    if (this.time === 0) this.reset();
  }

  reset() {
    const { count, seed, bounds, minSpeed, maxSpeed, reactionLag, reactionLagMin } = this.params;
    const random = createRandom(seed);
    // Start as a few loose clusters, not a uniform cloud — a school has structure
    // from frame zero, and a uniform cloud takes seconds to look like anything.
    const clusters = 7;
    const cx = [], cy = [], cz = [];
    for (let c = 0; c < clusters; c += 1) {
      cz.push((random() - .5) * bounds.z * 1.6);
      // Spread across the frame at the depth the cluster landed at, so the school
      // starts distributed instead of spending the first seconds spilling outward
      // from a knot in the middle.
      cx.push((random() - .5) * 1.7 * (bounds.x + this.params.taper.x * -cz[c]));
      cy.push((random() - .5) * 1.4 * (bounds.y + this.params.taper.y * -cz[c]));
    }
    for (let i = 0; i < count; i += 1) {
      const c = i % clusters;
      const ix = i * 3;
      this.pos[ix]     = cx[c] + (random() - .5) * 5.5;
      this.pos[ix + 1] = cy[c] + (random() - .5) * 3.6;
      this.pos[ix + 2] = cz[c] + (random() - .5) * 4.0;
      const speed = minSpeed + random() * (maxSpeed - minSpeed) * .55;
      const yaw = random() * Math.PI * 2;
      const pitch = (random() - .5) * .5;
      this.vel[ix]     = Math.cos(yaw) * Math.cos(pitch) * speed;
      this.vel[ix + 1] = Math.sin(pitch) * speed;
      this.vel[ix + 2] = Math.sin(yaw) * Math.cos(pitch) * speed;
      this.acc[ix] = this.acc[ix + 1] = this.acc[ix + 2] = 0;
      this.resp[ix] = this.resp[ix + 1] = this.resp[ix + 2] = 0;
      this.lag[i] = reactionLagMin + random() * (reactionLag - reactionLagMin);
      this.phase[i] = random() * Math.PI * 2;
      this.scale[i] = .72 + random() * .62;
    }
    this.time = 0;
    this._pointer = null;
    this._prevPointer.valid = false;
  }

  // World-space threat position, or null for "pointer has left".
  //
  // The point is one sample on a RAY, not a location in the tank. A cursor has no
  // depth: the viewer sees a fish sitting under it and expects that fish to move,
  // whatever its z. Carrying the view axis on the same object (dx, dy, dz) keeps
  // the caller's contract to one argument and lets a caller that has no camera —
  // the isolated flocking study — simply not set it.
  setPointer(point) {
    if (!point) { this._pointer = null; this._prevPointer.valid = false; return; }
    this._pointer = this._pointer ?? { x: 0, y: 0, z: 0 };
    this._pointer.x = point.x; this._pointer.y = point.y; this._pointer.z = point.z ?? 0;
    if (Number.isFinite(point.dx)) {
      const m = Math.hypot(point.dx, point.dy, point.dz) || 1;
      this._axis.x = point.dx / m; this._axis.y = point.dy / m; this._axis.z = point.dz / m;
    }
  }

  _buildGrid() {
    const { count } = this.params;
    const { cellStart, cellOf, order, nx, ny, nz, cell } = this;
    cellStart.fill(0);
    for (let i = 0; i < count; i += 1) {
      const ix = i * 3;
      const gx = Math.min(nx - 1, Math.max(0, ((this.pos[ix]     - this.originX) / cell) | 0));
      const gy = Math.min(ny - 1, Math.max(0, ((this.pos[ix + 1] - this.originY) / cell) | 0));
      const gz = Math.min(nz - 1, Math.max(0, ((this.pos[ix + 2] - this.originZ) / cell) | 0));
      const c = (gz * ny + gy) * nx + gx;
      cellOf[i] = c;
      cellStart[c + 1] += 1;
    }
    for (let c = 0; c < this.cellCount; c += 1) cellStart[c + 1] += cellStart[c];
    // cellStart is consumed as a cursor here, then restored by the shift below.
    for (let i = 0; i < count; i += 1) order[cellStart[cellOf[i]]++] = i;
    for (let c = this.cellCount; c > 0; c -= 1) cellStart[c] = cellStart[c - 1];
    cellStart[0] = 0;
  }

  step(dt) {
    const now = (typeof window !== 'undefined' && window.__CAPTURE__?.realNow) || performanceNow;
    const t0 = now();
    // CLAMPED. A tab-switch hands an unclamped simulation a 4-second delta and it
    // explodes — the most common way a good element dies in production.
    dt = Math.min(1 / 30, Math.max(1 / 400, dt));
    this.time += dt;

    const P = this.params;
    const { pos, vel, acc, resp, lag, cellStart, order, nx, ny, nz, cell } = this;
    const nbr2 = P.neighbour * P.neighbour;
    const repel2 = P.repelRadius * P.repelRadius;
    const b0 = P.bounds;

    // Threat point leads the pointer along its own velocity — this is what reads
    // as anticipation rather than fish reacting after the fact.
    let hasThreat = false;
    const rayX = this._axis.x, rayY = this._axis.y, rayZ = this._axis.z;
    if (this._pointer) {
      const p = this._pointer, prev = this._prevPointer;
      const vx = prev.valid ? (p.x - prev.x) / dt : 0;
      const vy = prev.valid ? (p.y - prev.y) / dt : 0;
      const vz = prev.valid ? (p.z - prev.z) / dt : 0;
      this._threat.x = p.x + vx * P.anticipation;
      this._threat.y = p.y + vy * P.anticipation;
      this._threat.z = p.z + vz * P.anticipation;
      prev.x = p.x; prev.y = p.y; prev.z = p.z; prev.valid = true;
      hasThreat = true;
    }

    this._buildGrid();

    let maxSpeed = 0, minSpeed = Infinity, speedTotal = 0;
    let minPointerDistance = Infinity, neighbourTotal = 0, neighbourCount = 0;
    let boundingRadius = 0, escape = 0, nearPointer = 0, alarmTotal = 0, alarmPeak = 0, finite = true;

    for (let i = 0; i < P.count; i += 1) {
      const ix = i * 3;
      const px = pos[ix], py = pos[ix + 1], pz = pos[ix + 2];

      let sx = 0, sy = 0, sz = 0;      // separation
      let cx = 0, cy = 0, cz = 0;      // cohesion accumulator
      let ax = 0, ay = 0, az = 0;      // alignment accumulator
      let n = 0, nearest = Infinity;

      const gx = Math.min(nx - 1, Math.max(0, ((px - this.originX) / cell) | 0));
      const gy = Math.min(ny - 1, Math.max(0, ((py - this.originY) / cell) | 0));
      const gz = Math.min(nz - 1, Math.max(0, ((pz - this.originZ) / cell) | 0));

      for (let oz = -1; oz <= 1; oz += 1) {
        const zz = gz + oz; if (zz < 0 || zz >= nz) continue;
        for (let oy = -1; oy <= 1; oy += 1) {
          const yy = gy + oy; if (yy < 0 || yy >= ny) continue;
          const rowBase = (zz * ny + yy) * nx;
          for (let ox = -1; ox <= 1; ox += 1) {
            const xx = gx + ox; if (xx < 0 || xx >= nx) continue;
            const c = rowBase + xx;
            for (let k = cellStart[c], end = cellStart[c + 1]; k < end; k += 1) {
              const j = order[k];
              if (j === i) continue;
              const jx = j * 3;
              const dx = px - pos[jx], dy = py - pos[jx + 1], dz = pz - pos[jx + 2];
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 > nbr2 || d2 < 1e-9) continue;
              const d = Math.sqrt(d2);
              if (d < nearest) nearest = d;
              const inv = 1 / d2;
              sx += dx * inv; sy += dy * inv; sz += dz * inv;
              cx += pos[jx]; cy += pos[jx + 1]; cz += pos[jx + 2];
              ax += vel[jx]; ay += vel[jx + 1]; az += vel[jx + 2];
              n += 1;
            }
          }
        }
      }

      let fx = sx * P.sep, fy = sy * P.sep, fz = sz * P.sep;
      if (n) {
        const inv = 1 / n;
        fx += (cx * inv - px) * P.coh + (ax * inv - vel[ix])     * P.ali;
        fy += (cy * inv - py) * P.coh + (ay * inv - vel[ix + 1]) * P.ali;
        fz += (cz * inv - pz) * P.coh + (az * inv - vel[ix + 2]) * P.ali;
        neighbourTotal += nearest; neighbourCount += 1;
      }

      // --- pointer repulsion, lagged per agent -------------------------------
      let targetX = 0, targetY = 0, targetZ = 0;
      if (hasThreat) {
        // Distance to the threat RAY, measured perpendicular to it — the cursor is
        // a rod pushed through the tank, not a ball floating on the z = 0 plane.
        // Measured as a point, a fish sitting visibly under the cursor but half a
        // tank-depth away was up to 5 units from it and never entered the radius:
        // half the school the viewer could see under their cursor never reacted,
        // which is exactly what "the interaction is broken" looks like.
        const wx = px - this._threat.x, wy = py - this._threat.y, wz = pz - this._threat.z;
        const along = wx * rayX + wy * rayY + wz * rayZ;
        const dx = wx - rayX * along, dy = wy - rayY * along, dz = wz - rayZ * along;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < repel2) {
          const d = Math.max(P.repelFloor, Math.sqrt(d2));
          // Inverse-square, faded to zero at the radius so there is no hard edge.
          const fade = 1 - Math.sqrt(d2) / P.repelRadius;
          const magnitude = (P.repelForce / (d * d)) * fade;
          // Flight is perpendicular to the rod: on screen the school opens a round
          // hole around the cursor instead of parting in depth where nobody sees it.
          targetX = dx / d * magnitude; targetY = dy / d * magnitude; targetZ = dz / d * magnitude;
          // The CORE exclusion zone. A cylinder at 0.36·repelRadius sits exactly
          // where fled fish come to rest, so its density never drops.
          if (d2 < repel2 * CAVITY_FRACTION * CAVITY_FRACTION) nearPointer += 1;
        }
        if (d2 < minPointerDistance * minPointerDistance) minPointerDistance = Math.sqrt(d2);
      }
      // First-order lag: onset staggers (individuals, not a block) and the response
      // outlives the threat, which is what produces overshoot on recovery.
      const k = 1 - Math.exp(-dt / lag[i]);
      resp[ix]     += (targetX - resp[ix])     * k;
      resp[ix + 1] += (targetY - resp[ix + 1]) * k;
      resp[ix + 2] += (targetZ - resp[ix + 2]) * k;
      fx += resp[ix]; fy += resp[ix + 1]; fz += resp[ix + 2];
      const alarmMagnitude = Math.hypot(resp[ix], resp[ix + 1], resp[ix + 2]);
      alarmTotal += alarmMagnitude;
      if (alarmMagnitude > alarmPeak) alarmPeak = alarmMagnitude;

      // --- idle drift: a COHERENT flow field, not per-agent noise -------------
      // Per-agent decorrelated wander is a dispersant: it pulls
      // neighbours apart faster than cohesion pulls them together, and the school
      // spreads into a uniform cloud. A field sampled at the agent's POSITION gives
      // near-identical values to anything within the neighbour radius, so groups
      // drift together and the convergences in the field are what make sub-schools.
      const kf = P.flowScale, tf = this.time * P.flowSpeed, w = P.wander;
      // Each component carries a term in ITS OWN axis. Without one, the x-force
      // depends only on y and z — which makes it a uniform push along x, able to
      // TRANSLATE the school sideways but never to structure it. The measured
      // consequence: the school spent most of its time pressed into the right
      // third with the headline column empty, and the only thing stopping it
      // leaving was the corral. `sin(x)` as a force in x has stable zeros at odd
      // multiples of pi, so this puts two attractors across the tank width and the
      // school forms sub-groups on both sides of the frame instead of one drifting
      // ball. The phase creeps with time, so they migrate rather than sit.
      fx += (Math.sin(py * kf + tf) * Math.cos(pz * kf * .7 + tf * .6)
             + Math.sin(px * kf * 1.85 + tf * .9) * .9) * w;
      fy += (Math.sin(pz * kf + tf * .8) * Math.cos(px * kf * .6 - tf * .5)
             + Math.sin(py * kf * 3.2 - tf * .7) * .9) * w * .55;
      fz += Math.sin(px * kf + tf * .6) * Math.cos(py * kf * .9 + tf * .7) * w;

      // The tank's half-extents AT THIS FISH'S DEPTH. Everything below — corral,
      // walls, the escape metric — is measured against these rather than against
      // one number for the whole slab, which is what lets the school fill the
      // frame at the back without spilling past it at the front.
      const limX = b0.x + P.taper.x * -pz;
      const limY = b0.y + P.taper.y * -pz;

      // --- composition corral: no force inside the home region ----------------
      // Normalised to the tank's own axes, so it stays the same shape as the tank
      // however the frame refits it.
      const hx = (px - P.home.x) / limX, hy = (py - P.home.y) / limY, hz = (pz - P.home.z) / b0.z;
      const hd = Math.sqrt(hx * hx + hy * hy + hz * hz);
      if (hd > P.homeFraction) {
        const pull = (hd - P.homeFraction) / hd * P.homing;
        fx -= hx * pull * limX; fy -= hy * pull * limY; fz -= hz * pull * b0.z;
      }

      // --- soft tank containment --------------------------------------------
      const soft = P.boundSoft, bf = P.boundForce;
      if (px >  limX - soft) fx -= (px - (limX - soft)) * bf;
      if (px < -limX + soft) fx -= (px + (limX - soft)) * bf;
      if (py >  limY - soft) fy -= (py - (limY - soft)) * bf;
      if (py < -limY + soft) fy -= (py + (limY - soft)) * bf;
      if (pz >  b0.z - soft) fz -= (pz - (b0.z - soft)) * bf;
      if (pz < -b0.z + soft) fz -= (pz + (b0.z - soft)) * bf;

      const fm = Math.hypot(fx, fy, fz);
      if (fm > P.accelClamp) { const s = P.accelClamp / fm; fx *= s; fy *= s; fz *= s; }
      acc[ix] = fx; acc[ix + 1] = fy; acc[ix + 2] = fz;

      vel[ix] += fx * dt; vel[ix + 1] += fy * dt; vel[ix + 2] += fz * dt;
      let speed = Math.hypot(vel[ix], vel[ix + 1], vel[ix + 2]);
      // Burst: an alarmed fish may exceed cruise, up to burstMax. The ceiling
      // decays with `resp`, so the school coasts back down instead of braking.
      const ceiling = P.maxSpeed * (1 + Math.min(P.burstMax, alarmMagnitude * P.burstGain));
      if (speed > ceiling) { const s = ceiling / speed; vel[ix] *= s; vel[ix + 1] *= s; vel[ix + 2] *= s; speed = ceiling; }
      else if (speed < P.minSpeed) {
        const s = speed > 1e-6 ? P.minSpeed / speed : 0;
        if (s) { vel[ix] *= s; vel[ix + 1] *= s; vel[ix + 2] *= s; } else { vel[ix] = P.minSpeed; }
        speed = P.minSpeed;
      }
      pos[ix] += vel[ix] * dt; pos[ix + 1] += vel[ix + 1] * dt; pos[ix + 2] += vel[ix + 2] * dt;

      if (speed > maxSpeed) maxSpeed = speed;
      if (speed < minSpeed) minSpeed = speed;
      speedTotal += speed;
      const r = Math.hypot(pos[ix], pos[ix + 1], pos[ix + 2]);
      if (r > boundingRadius) boundingRadius = r;
      escape = Math.max(escape,
        Math.abs(pos[ix]) - limX, Math.abs(pos[ix + 1]) - limY, Math.abs(pos[ix + 2]) - b0.z);
      if (!Number.isFinite(pos[ix] + pos[ix + 1] + pos[ix + 2] + speed)) finite = false;
    }

    const s = this._sample;
    // Named simTime, not `t`: a field called `t` collides with the millisecond
    // timeline any external sampler is likely to key its own rows on.
    s.simTime = this.time;
    s.maxSpeed = maxSpeed;
    s.minSpeed = minSpeed === Infinity ? 0 : minSpeed;
    s.meanSpeed = speedTotal / P.count;
    s.minPointerDistance = minPointerDistance === Infinity ? 99 : minPointerDistance;
    s.meanNeighbour = neighbourCount ? neighbourTotal / neighbourCount : 0;
    s.boundingRadius = boundingRadius;
    s.escape = Math.max(0, escape);
    s.nearPointer = nearPointer;
    // Density in the core exclusion sphere against what uniform density would put
    // there — scale-free, so it survives a change in agent count or tank size.
    // The exclusion zone is now a CYLINDER along the view axis, not a sphere, so
    // the uniform-density baseline it is compared against has to be one too — the
    // old sphere formula understated the ambient count by roughly the tank's
    // depth-to-radius ratio and every cavity number would have read as a scatter.
    const cavityRadius = P.repelRadius * CAVITY_FRACTION;
    const span = 2 * Math.min(P.bounds.z, Math.max(P.bounds.x, P.bounds.y));
    const ambient = Math.max(.6, P.count * (Math.PI * cavityRadius ** 2 * span)
      / (8 * P.bounds.x * P.bounds.y * P.bounds.z));
    s.cavityRatio = hasThreat ? nearPointer / ambient : 1;
    this._cavityEma += (s.cavityRatio - this._cavityEma) * (1 - Math.exp(-dt / .35));
    s.cavityEma = this._cavityEma;
    s.alarm = alarmTotal / P.count;
    s.alarmPeak = alarmPeak;
    s.finite = finite;
    s.agents = P.count;
    // Real clock, not the virtualized performance.now — when the clock is faked,
    // a duration measured inside a single frame always comes out 0.
    this.frameMs = s.frameMs = now() - t0;
  }

  sample() { return this._sample; }
}

const performanceNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
