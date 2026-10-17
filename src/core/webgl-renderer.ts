/**
 * WebGL2 Skinning + FFD + Heatmap Renderer (`src/core/webgl-renderer.ts`)
 *
 * Renders:
 * 1. Premultiplied 4-bone Linear Blend Skinning (LBS) + per-vertex FFD offsets (`aDeform`)
 * 2. Optional live weight-painting thermal/bone heatmap blend (`uHeatmapMix`)
 * 3. Additive power flash and rim light
 */

import { buildPartMesh } from "./weights";
import type { PartMeshData, SpineForgeProject } from "./schema";
import type { BuiltSkeleton } from "./solver";

const VERTEX_SHADER = `#version 300 es
in vec2 aPos;
in vec2 aDeform;
in vec2 aUv;
in vec4 aJoint;
in vec4 aWeight;
in vec4 aHeatColor;

uniform vec4 uBones[64];
uniform vec4 uView;

out vec2 vUv;
out vec4 vHeatColor;

vec2 skin(float j, vec2 p) {
  int i = int(j) * 2;
  vec4 m = uBones[i];
  vec4 t = uBones[i + 1];
  return vec2(m.x * p.x + m.z * p.y + t.x, m.y * p.x + m.w * p.y + t.y);
}

void main() {
  vec2 basePos = aPos + aDeform;
  vec2 p = skin(aJoint.x, basePos) * aWeight.x
         + skin(aJoint.y, basePos) * aWeight.y
         + skin(aJoint.z, basePos) * aWeight.z
         + skin(aJoint.w, basePos) * aWeight.w;
  vUv = aUv;
  vHeatColor = aHeatColor;
  gl_Position = vec4(p.x * uView.x + uView.z, p.y * uView.y + uView.w, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec2 vUv;
in vec4 vHeatColor;

uniform sampler2D uTex;
uniform vec3 uRim;
uniform vec3 uFlashTint;
uniform float uFlash;
uniform float uHeatmapMix;
uniform float uPartOpacity;

out vec4 outColor;

void main() {
  vec4 c = texture(uTex, vUv);
  c.rgb += uFlashTint * uFlash * 0.25 * c.a;
  if (uHeatmapMix > 0.01 && c.a > 0.02) {
    vec3 heatPremult = vHeatColor.rgb * c.a;
    c.rgb = mix(c.rgb, heatPremult, uHeatmapMix * vHeatColor.a);
  }
  c.rgb = min(c.rgb, vec3(c.a));
  outColor = c * uPartOpacity;
}`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "WebGL2 shader compile failed");
  }
  return shader;
}

function hexToRgbNorm(hex: string): [number, number, number] {
  const value = parseInt(hex.replace("#", "").slice(0, 6), 16) || 0;
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

type PartGlState = {
  name: string;
  mesh: PartMeshData;
  vao: WebGLVertexArrayObject;
  posBuffer: WebGLBuffer;
  deformBuffer: WebGLBuffer;
  weightBuffer: WebGLBuffer;
  jointBuffer: WebGLBuffer;
  heatBuffer: WebGLBuffer;
  indexBuffer: WebGLBuffer;
  indexCount: number;
  vertexCount: number;
  texture: WebGLTexture;
};

export class SpineForgeWebGLRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private parts = new Map<string, PartGlState>();
  private allBuffers: WebGLBuffer[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private skeleton: BuiltSkeleton,
    images: Record<string, HTMLImageElement | ImageBitmap>,
    options?: { preserveDrawingBuffer?: boolean },
  ) {
    const gl = canvas.getContext("webgl2", {
      premultipliedAlpha: true,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: options?.preserveDrawingBuffer ?? true,
    });
    if (!gl) throw new Error("WebGL2 context unavailable");
    this.gl = gl;

    const program = gl.createProgram()!;
    gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? "WebGL2 program link failed");
    }
    this.program = program;

    this.uniforms = Object.fromEntries(
      ["uBones", "uView", "uTex", "uRim", "uFlashTint", "uFlash", "uHeatmapMix", "uPartOpacity"].map((n) => [
        n,
        gl.getUniformLocation(program, n),
      ]),
    );

    gl.useProgram(program);
    gl.uniform1i(this.uniforms.uTex!, 0);
    gl.uniform3fv(this.uniforms.uRim!, hexToRgbNorm(skeleton.project.palette.rim));
    gl.uniform3fv(this.uniforms.uFlashTint!, hexToRgbNorm(skeleton.project.palette.flash));

    this.rebuildParts(skeleton.project, images);
  }

  rebuildParts(project: SpineForgeProject, images: Record<string, HTMLImageElement | ImageBitmap>): void {
    const { gl, program } = this;
    for (const part of project.parts) {
      const image = images[part.name];
      if (!image) continue;
      const mesh = part.mesh ?? buildPartMesh(project, part);
      part.mesh = mesh;
      const vCount = mesh.positions.length / 2;

      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);

      const makeAttr = (name: string, data: Float32Array, size: number, usage: number = gl.DYNAMIC_DRAW) => {
        const buf = gl.createBuffer()!;
        this.allBuffers.push(buf);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, data, usage);
        const loc = gl.getAttribLocation(program, name);
        if (loc >= 0) {
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
        }
        return buf;
      };

      const posBuffer = makeAttr("aPos", new Float32Array(mesh.positions), 2);
      const deformBuffer = makeAttr("aDeform", new Float32Array(vCount * 2), 2);
      makeAttr("aUv", new Float32Array(mesh.uvs), 2, gl.STATIC_DRAW);
      const jointBuffer = makeAttr("aJoint", new Float32Array(mesh.joints), 4);
      const weightBuffer = makeAttr("aWeight", new Float32Array(mesh.weights), 4);
      const heatBuffer = makeAttr("aHeatColor", new Float32Array(vCount * 4), 4);

      const indexBuffer = gl.createBuffer()!;
      this.allBuffers.push(indexBuffer);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(mesh.indices), gl.STATIC_DRAW);
      gl.bindVertexArray(null);

      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      this.parts.set(part.name, {
        name: part.name,
        mesh,
        vao,
        posBuffer,
        deformBuffer,
        weightBuffer,
        jointBuffer,
        heatBuffer,
        indexBuffer,
        indexCount: mesh.indices.length,
        vertexCount: vCount,
        texture,
      });
    }
  }

  updatePartWeightsAndHeatmap(partName: string, mesh: PartMeshData, heatColors?: Float32Array): void {
    const { gl } = this;
    const state = this.parts.get(partName);
    if (!state) return;
    state.mesh = mesh;
    gl.bindBuffer(gl.ARRAY_BUFFER, state.jointBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.joints), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, state.weightBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.weights), gl.DYNAMIC_DRAW);
    if (heatColors) {
      gl.bindBuffer(gl.ARRAY_BUFFER, state.heatBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, heatColors, gl.DYNAMIC_DRAW);
    }
  }

  /**
   * Computes the viewport transform mapping rig pixel coordinates `(0..artW, 0..artH)` into canvas pixels.
   */
  getViewMetrics(width: number, height: number) {
    const { width: artW, height: artH, frame } = this.skeleton.project;
    const leftM = frame.left ?? 0.25;
    const rightM = frame.right ?? 0.25;
    const topM = frame.top ?? 0.2;
    const bottomM = frame.bottom ?? 0.05;
    const spanW = artW * (1 + leftM + rightM);
    const spanH = artH * (1 + topM + bottomM);
    const scale = Math.min(width / spanW, height / spanH);
    const offsetX = (width - spanW * scale) / 2 + leftM * artW * scale;
    const offsetY = (height - spanH * scale) / 2 + topM * artH * scale;
    return { scale, offsetX, offsetY, artW, artH };
  }

  draw(options: {
    skin: Float32Array;
    order?: readonly string[];
    deforms?: Record<string, number[] | undefined>;
    flash?: number;
    heatmapMix?: number;
    selectedPart?: string | null;
    isolateSelectedPart?: boolean;
    fixedSize?: { width: number; height: number };
  }): void {
    const { gl, canvas } = this;
    const width = options.fixedSize
      ? options.fixedSize.width
      : Math.max(1, Math.round(canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 2)));
    const height = options.fixedSize
      ? options.fixedSize.height
      : Math.max(1, Math.round(canvas.clientHeight * Math.min(window.devicePixelRatio || 1, 2)));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const { scale, offsetX, offsetY } = this.getViewMetrics(width, height);

    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.useProgram(this.program);
    gl.uniform4fv(this.uniforms.uBones!, options.skin);
    gl.uniform4f(
      this.uniforms.uView!,
      (2 * scale) / width,
      (-2 * scale) / height,
      (2 * offsetX) / width - 1,
      1 - (2 * offsetY) / height,
    );
    gl.uniform1f(this.uniforms.uFlash!, options.flash ?? 0);

    gl.activeTexture(gl.TEXTURE0);
    const drawList = options.order ?? Array.from(this.parts.keys());

    for (const name of drawList) {
      const part = this.parts.get(name);
      if (!part) continue;
      if (options.isolateSelectedPart && options.selectedPart && options.selectedPart !== name) {
        gl.uniform1f(this.uniforms.uPartOpacity!, 0.18);
      } else {
        gl.uniform1f(this.uniforms.uPartOpacity!, 1.0);
      }

      const showHeat =
        (options.heatmapMix ?? 0) > 0 && (!options.selectedPart || options.selectedPart === name)
          ? (options.heatmapMix ?? 0)
          : 0;
      gl.uniform1f(this.uniforms.uHeatmapMix!, showHeat);

      const deform = options.deforms?.[name];
      gl.bindBuffer(gl.ARRAY_BUFFER, part.deformBuffer);
      if (deform && deform.length === part.vertexCount * 2) {
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(deform));
      } else {
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(part.vertexCount * 2));
      }

      gl.bindTexture(gl.TEXTURE_2D, part.texture);
      gl.bindVertexArray(part.vao);
      gl.drawElements(gl.TRIANGLES, part.indexCount, gl.UNSIGNED_SHORT, 0);
    }
    gl.bindVertexArray(null);
  }

  destroy(): void {
    const { gl } = this;
    this.allBuffers.forEach((b) => gl.deleteBuffer(b));
    for (const part of this.parts.values()) {
      gl.deleteVertexArray(part.vao);
      gl.deleteTexture(part.texture);
    }
    gl.deleteProgram(this.program);
  }
}
