// Shared uniforms and helpers for Ultra Motion X materials (GLSL ES 3.00).
precision highp float;
uniform vec2 u_resolution;   // surface size in device pixels
uniform float u_time;        // seconds
uniform vec3 u_pointer;      // xy in [0,1] (top-left origin), z = pointer active 0..1
uniform float u_intensity;   // 0..1
uniform float u_radius;      // corner radius in device pixels
uniform vec4 u_color0;
uniform vec4 u_color1;
uniform vec4 u_color2;
uniform vec4 u_color3;
uniform vec4 u_ripples[4];   // x, y (0..1), start time (s), strength
in vec2 v_uv;
out vec4 outColor;

float umx_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float umx_noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(umx_hash(i), umx_hash(i + vec2(1, 0)), u.x), mix(umx_hash(i + vec2(0, 1)), umx_hash(i + vec2(1, 1)), u.x), u.y);
}
// Rounded-rectangle mask (anti-aliased) so effects follow the element's corners.
float umx_mask(vec2 uv) {
  vec2 p = (uv - 0.5) * u_resolution;
  vec2 b = u_resolution * 0.5 - vec2(u_radius);
  vec2 q = abs(p) - b;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_radius;
  return clamp(0.5 - d, 0.0, 1.0);
}
