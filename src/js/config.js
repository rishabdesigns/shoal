// Tunable constants for the hero. Every adjustable value lives here, not as
// a literal inside a system — a value edited in two places is a value that drifts.

export const SCENE_SEED = 0x5140a1;

export const TANK = {
  // Authored half-extents; must match FLOCK_DEFAULTS. x and y are REFITTED to the
  // frame in world.resize() — these are the fallback for a world that never sized
  // itself. z is not refitted: depth is a look decision, and a deeper tank means
  // more perspective spread between the near and far walls than the frame can hold.
  bounds: { x: 16, y: 8.4, z: 5.2 },
  // Inset from the frame edge, in world units. Roughly one and a half body lengths
  // at the near wall — enough that a fish turning at the wall never clips out.
  // Was 2.4 — a body and a half of dead water inside every edge of the frame, so
  // the school stopped a visible distance short of all four sides and read as a
  // ball floating in the middle of a page. At 0.6 the corral is effectively the
  // frame: fish turn AT the edge, which means a few are clipped by it at any
  // moment, and a school that runs off the edge of the frame is the thing that
  // makes the tank feel bigger than the window.
  margin: 0.2,
  // The gravel bed. Below the flock's deepest reach (its y limit tapers with depth
  // and bottoms out around -9.6 at the back wall) — fish swim ABOVE the substrate,
  // and a fish clipping through a pebble is the fastest way to lose the illusion
  // that this is a tank rather than two unrelated systems sharing a frame.
  bedY: -11.2,
  // The bed and the planting run far past the school, which occupies only
  // z = ±5.2. Depth is what makes a tank read as a volume rather than a backdrop.
  floorFrom: 6,
  // Stones stop where the fog has finished with them. Beyond z = -22 every pebble
  // is more than 90% fog colour, so 54,000 triangles of gravel were being drawn to
  // produce the flat dark green that the bed plane behind them already is. The
  // plane runs all the way back to the backdrop; only the stones stop early.
  floorTo: -22,
  backdropZ: -36
};

export const CAMERA = {
  fov: 42,
  distance: 26,
  // Narrow viewports lose horizontal field, so the school would swim off both
  // edges. Pulling back restores the frame. There is no interior geometry to clip
  // through here, which is the only reason a dolly is safe.
  narrowDistance: 34,
  narrowAspect: 1.1
};

// A PLANTED tank, not open ocean. The difference is not one hue slider: open water
// is blue because blue is what survives depth, and a planted tank is green because
// the light is bouncing off leaves a foot away. Everything below follows from that
// — the fog is green, the bounce light is warm off the gravel, and the far water is
// near-black rather than navy.
// Every water value below is DARK, and deliberately so. The lights are untouched:
// the fish are lit by a near-white key and a hemisphere, and none of that is in
// this table. Dropping the water and leaving the lighting alone is what widens the
// gap between the subject and its ground — the school did not get brighter, the
// tank got darker, and that is the only way to buy contrast that does not cost the
// fish their own colour.
export const PALETTE = {
  deep:    0x030e0d,     // the far water, and the fog it fades into
  mid:     0x07211c,
  shallow: 0x0e3a2f,     // lit water toward the surface
  surface: 0x225045,     // the waterline band at the very top of the frame
  light:   0xd6f7e6,     // caustics, motes and bubbles — the water's own colour
  // The key light is warm and near-white. Orange under a saturated key of any
  // other hue goes to mud, and the fish are the subject: the water is allowed to
  // be green, the light falling on the fish is not.
  sun:     0xfff4e2,
  // Light coming back UP off the gravel. Real tanks have it, it is warm, and it is
  // what stops every belly in the school reading as a grey underside.
  bounce:  0x8a6a3e,
  // Per-instance multiplier over the procedural coat, NOT the fish's colour —
  // that lives in the shader. A narrow spread near white, or the tint fights the
  // markings it is multiplying and the school goes grey.
  fish:    0xffffff,
  fishDeep: 0xf3e8d8
};

// How the bowl is stocked. Index into the eight varieties drawn by shoalCoat()
// in fish.js; the weights are the share of the school each one gets.
//
// Deliberately NOT uniform. A tank stocked evenly across eight varieties reads as
// a colour chart — a real bowl has a dominant fish and a handful of others, and
// the rarities are what the eye finds. Common orange is still nearly a third of
// the school, so the page keeps the one silhouette everybody recognises, and the
// two dark varieties (moor, wild bronze) are the value floor that stops a school
// of pale fish flattening into one bright mass.
export const FISH_VARIETIES = [
  { name: 'orange',  index: 0, weight: 30 },
  { name: 'calico',  index: 1, weight: 16 },
  { name: 'sarasa',  index: 2, weight: 14 },
  { name: 'lemon',   index: 3, weight: 10 },
  { name: 'moor',    index: 4, weight: 7 },
  { name: 'blue',    index: 5, weight: 8 },
  { name: 'pearl',   index: 6, weight: 9 },
  { name: 'wild',    index: 7, weight: 6 }
];

// Gravel. Sampled off the reference: cream, tan, ochre, pale grey, olive, rust and
// a few near-black stones. The near-blacks are what stop a bed of warm tones
// reading as a beach — a real substrate has holes in it.
export const GRAVEL_COLOURS = [
  0xd8c9a4, 0xc3a675, 0x8f8b7a, 0xbb8a44, 0xb7b6a8,
  0x8c5e36, 0x585c40, 0x2c2b23, 0xe3dccb, 0x9aa08c
];

// Planting. Fresh green at the growing tips, dark at the base where the light does
// not reach, plus the occasional red stem the reference has on its right.
export const PLANT_COLOURS = [
  // Pulled DOWN in both value and saturation. Aquatic leaves are not poster
  // green: they sit under a metre of water that has already taken most of the
  // red out of the light, and a thicket painted in full-strength greens is the
  // brightest, most saturated thing in a frame whose subject is meant to be the
  // fish. Hue variety stays — olive, blue-green, yellow-green — because that is
  // what says "several species" rather than "one shader".
  0x2f6b2c, 0x24572a, 0x3d7a31, 0x17401f, 0x4b8637, 0x256045,
  0x347044, 0x2a5f31, 0x497d38, 0x1c4c2b
];

// The red stem, kept OUT of the list above and rolled per plant instead.
// Inside the list it was drawn once per CLUMP, so a nine percent chance of an
// accent colour meant a nine percent chance of a thicket of eight red plants —
// the reference has one red stem in the frame and it is a punctuation mark, not
// a hedge.
export const PLANT_ACCENT = 0x7d4230;

// The single biggest reason the school read as khaki. Fog replaces colour with the
// fog colour, and the fog colour is a near-black green — at near = 12 a fish in the
// MIDDLE of its own tank was already 39% dark green, so every orange arrived
// pre-muddied and no amount of pushing the albedo could win it back. The school
// occupies distances 21–31; the floor and the far thicket sit at 45–58. Starting
// the fog past the school and ending it past the thicket is what lets the fish be
// vivid and the back of the tank still recede.
export const FOG = { near: 22, far: 62 };

// Agent count by viewport. The simulation is O(n) per frame thanks to the spatial
// hash, but fill rate is not, and a phone is not a workstation.
export const AGENT_COUNTS = { wide: 420, tablet: 300, phone: 190 };

export const MOTES = 520;

// Gravel is scattered to a roughly CONSTANT ON-SCREEN size — pebbles grow with
// depth so the bed keeps its texture all the way back instead of dissolving into
// noise. These are the near-plane values; the scatter derives the rest.
// `perspective` is the exponent on distance. At 1.0 every stone is the same size
// ON SCREEN, which is what this started as — and a plane covered in identically
// sized dots has no perspective in it at all, so the bed read as a photograph of
// gravel pasted onto the floor rather than as a floor receding away from the
// camera. At 0 it would be world-constant and the far bed would dissolve into
// noise. Just under a half keeps texture in the distance and still gives the eye
// the size gradient it needs to read depth.
export const GRAVEL = { size: 0.30, spacing: 1.16, aspect: 1.62, perspective: 0.45 };

// Plants by viewport, same reasoning as the agent count: the simulation is not
// what costs here, fill rate is.
export const PLANT_COUNTS = { wide: 600, tablet: 420, phone: 280 };

// Bubbles, and how far one travels before it loops back to the bed. The rise is
// tank height plus a margin — a bubble that loops inside the frame is a bubble
// the eye catches teleporting.
export const BUBBLES = 240;
export const BUBBLE_RISE = 26;
