// Ripple: expanding, decaying rings from interaction points.
void main() {
  vec2 uv = v_uv;
  float m = umx_mask(uv);
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  float v = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 r = u_ripples[i];
    float age = u_time - r.z;
    if (r.w <= 0.0 || age < 0.0 || age > 1.6) continue;
    vec2 d = (uv - r.xy) * vec2(aspect, 1.0);
    float dist = length(d);
    float radius = age * 0.9;
    float ring = exp(-pow((dist - radius) * 18.0, 2.0));
    v += ring * r.w * (1.0 - age / 1.6);
  }
  outColor = vec4(u_color0.rgb, clamp(v * u_intensity * u_color0.a, 0.0, 1.0)) * m;
}
