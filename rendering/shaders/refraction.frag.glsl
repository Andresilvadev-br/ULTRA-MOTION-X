// Refraction: lens-like distortion of the material's own gradient field around the pointer
// (WebGL cannot read DOM pixels; the backdrop itself is blurred by CSS).
void main() {
  vec2 uv = v_uv;
  vec2 ptr = mix(vec2(0.5), u_pointer.xy, u_pointer.z);
  vec2 d = uv - ptr;
  float r = length(d);
  float lens = smoothstep(0.35, 0.0, r);
  vec2 warped = uv + normalize(d + 1e-5) * lens * 0.08 * u_intensity;
  vec4 c = mix(mix(u_color0, u_color1, warped.x), mix(u_color2, u_color3, warped.x), warped.y);
  float caustic = pow(lens, 3.0) * 0.25;
  outColor = vec4(c.rgb + caustic, c.a * u_intensity) * umx_mask(uv);
}
