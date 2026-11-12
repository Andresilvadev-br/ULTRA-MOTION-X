// Animated four-point mesh gradient with slow organic drift.
void main() {
  vec2 uv = v_uv;
  float t = u_time * 0.15;
  vec2 p0 = vec2(0.2 + 0.1 * sin(t * 1.3), 0.2 + 0.1 * cos(t));
  vec2 p1 = vec2(0.8 + 0.1 * cos(t * 0.9), 0.25 + 0.1 * sin(t * 1.1));
  vec2 p2 = vec2(0.25 + 0.1 * cos(t * 1.2), 0.8 + 0.1 * sin(t * 0.8));
  vec2 p3 = vec2(0.75 + 0.1 * sin(t), 0.75 + 0.1 * cos(t * 1.4));
  float w0 = 1.0 / (pow(distance(uv, p0), 2.0) + 1e-3);
  float w1 = 1.0 / (pow(distance(uv, p1), 2.0) + 1e-3);
  float w2 = 1.0 / (pow(distance(uv, p2), 2.0) + 1e-3);
  float w3 = 1.0 / (pow(distance(uv, p3), 2.0) + 1e-3);
  vec4 c = (u_color0 * w0 + u_color1 * w1 + u_color2 * w2 + u_color3 * w3) / (w0 + w1 + w2 + w3);
  c.rgb += (umx_noise(uv * u_resolution * 0.7) - 0.5) * 0.015;
  outColor = vec4(c.rgb, c.a * u_intensity) * umx_mask(uv);
}
