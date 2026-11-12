// Glass: specular sheen following the pointer, edge light and fine grain. The blur of the
// content behind is done by CSS `backdrop-filter` (compositor), not by this shader.
void main() {
  vec2 uv = v_uv;
  float m = umx_mask(uv);
  vec2 ptr = mix(vec2(0.3, 0.2), u_pointer.xy, u_pointer.z);
  float sheen = smoothstep(0.65, 0.0, distance(uv, ptr)) * 0.35;
  float edge = smoothstep(0.08, 0.0, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y))) * 0.18;
  float grain = (umx_noise(uv * u_resolution * 0.5 + u_time) - 0.5) * 0.03;
  vec3 tint = u_color0.rgb;
  float a = (u_color0.a * 0.25 + sheen + edge + grain) * u_intensity;
  outColor = vec4(tint + vec3(sheen + edge), clamp(a, 0.0, 1.0)) * m;
}
