// WebGPU (WGSL) version of the gradient material. Same uniform semantics as the GLSL
// sources; used by the experimental WebGPU backend.
struct Uniforms {
  resolution: vec2f, time: f32, intensity: f32,
  pointer: vec4f, radius: f32, _pad0: f32, _pad1: f32, _pad2: f32,
  color0: vec4f, color1: vec4f, color2: vec4f, color3: vec4f,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var o: VOut;
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x * 0.5, 1.0 - p.y * 0.5);
  return o;
}

fn mask(uv: vec2f) -> f32 {
  let p = (uv - 0.5) * u.resolution;
  let b = u.resolution * 0.5 - vec2f(u.radius);
  let q = abs(p) - b;
  let d = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - u.radius;
  return clamp(0.5 - d, 0.0, 1.0);
}

@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let t = u.time * 0.15;
  let p0 = vec2f(0.2 + 0.1 * sin(t * 1.3), 0.2 + 0.1 * cos(t));
  let p1 = vec2f(0.8 + 0.1 * cos(t * 0.9), 0.25 + 0.1 * sin(t * 1.1));
  let p2 = vec2f(0.25 + 0.1 * cos(t * 1.2), 0.8 + 0.1 * sin(t * 0.8));
  let p3 = vec2f(0.75 + 0.1 * sin(t), 0.75 + 0.1 * cos(t * 1.4));
  let w0 = 1.0 / (pow(distance(in.uv, p0), 2.0) + 1e-3);
  let w1 = 1.0 / (pow(distance(in.uv, p1), 2.0) + 1e-3);
  let w2 = 1.0 / (pow(distance(in.uv, p2), 2.0) + 1e-3);
  let w3 = 1.0 / (pow(distance(in.uv, p3), 2.0) + 1e-3);
  let c = (u.color0 * w0 + u.color1 * w1 + u.color2 * w2 + u.color3 * w3) / (w0 + w1 + w2 + w3);
  return vec4f(c.rgb, c.a * u.intensity) * mask(in.uv);
}
