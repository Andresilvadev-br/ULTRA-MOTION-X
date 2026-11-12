// Film grain / texture overlay.
void main() {
  vec2 uv = v_uv;
  float n = umx_noise(uv * u_resolution * 0.9 + floor(u_time * 24.0) * 13.0);
  outColor = vec4(vec3(n), 0.06 * u_intensity) * umx_mask(uv);
}
