import assert from "node:assert/strict";
import { test } from "node:test";
import { fragmentSource, MATERIALS, SHADER_SOURCES, vertexSource } from "../src/index.ts";

test("every material has a GLSL ES 3.00 fragment shader with the shared prelude", () => {
  for (const m of MATERIALS) {
    const src = fragmentSource(m);
    assert.ok(src.startsWith("#version 300 es"));
    assert.ok(src.includes("uniform float u_time"));
    assert.ok(src.includes("void main()"));
    assert.ok(src.includes("umx_mask"), `${m} must respect corner masks`);
  }
  assert.ok(vertexSource().includes("gl_VertexID"));
  assert.ok(SHADER_SOURCES["gradient.wgsl"]?.includes("@fragment"));
  assert.throws(() => fragmentSource("nope" as never));
});
