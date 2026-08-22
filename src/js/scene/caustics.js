// Shared caustic field, used by the backdrop and by the fish bodies so the same
// light plays across both — one function, two consumers, no drift between them.
//
// Built from RIDGED SINES, deliberately not from a hash. The usual
// `fract(sin(dot(p, vec2(...))) * 43758.5453)` loses precision at large coordinates
// and the result reads as uniform film grain across every frame — a defect that is
// very hard to attribute after the fact, because it looks like a post-process bug.
// Interfering sines have no precision cliff and are cheaper.
export const CAUSTIC_GLSL = /* glsl */`
  float shoalCaustic(vec2 p, float t) {
    float a = sin(p.x * 0.62 + t * 0.90) + sin(p.y * 0.71 - t * 0.70);
    float b = sin((p.x + p.y) * 0.48 + t * 1.10) + sin((p.x - p.y) * 0.41 - t * 0.80);
    float v = (a + b) * 0.25;
    // Sharpened into ridges: caustics are thin bright lines over a dark field, so
    // the exponent is what separates "underwater" from "wobbly gradient".
    return pow(abs(v), 3.0);
  }
`;
