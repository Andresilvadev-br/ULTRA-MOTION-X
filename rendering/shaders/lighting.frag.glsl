// Dynamic lighting: soft specular highlight tracking the pointer plus ambient rim.
void main() {
  vec2 uv = v_uv;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 d = (uv - u_pointer.xy) * vec2(aspect, 1.0);
  float spot = exp(-dot(d, d) * 6.0) * u_pointer.z;
  float rim = smoothstep(0.12, 0.0, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y))) * 0.08;
  float a = (spot * 0.45 + rim) * u_intensity;
  outColor = vec4(u_color0.rgb, a * u_color0.a) * umx_mask(uv);
}
