// Full-screen triangle (no vertex buffers needed).
out vec2 v_uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = vec2(p.x * 0.5, 1.0 - p.y * 0.5);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
