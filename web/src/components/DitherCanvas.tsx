"use client";

import { useEffect, useRef } from "react";

const VERT = `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_scale;
uniform vec3 u_colorFront;
uniform vec3 u_colorBack;

vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float Bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x / 2.0 + a.y * a.y * 0.75);
}
#define Bayer4(a)  (Bayer2(0.5 * (a)) * 0.25 + Bayer2(a))
#define Bayer8(a)  (Bayer4(0.5 * (a)) * 0.25 + Bayer2(a))
#define Bayer16(a) (Bayer8(0.5 * (a)) * 0.25 + Bayer2(a))
#define Bayer32(a) (Bayer16(0.5 * (a)) * 0.25 + Bayer2(a))

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  uv.x *= u_resolution.x / max(u_resolution.y, 1.0);
  float t = u_time * 0.35;
  float n1 = snoise(vec3(uv * 1.5, t));
  float n2 = snoise(vec3(uv * 1.5 + 4.0, t * 1.1));
  float gray = mix(n1, n2, 0.5) * 0.5 + 0.5;
  float d = step(Bayer32(gl_FragCoord.xy * u_scale), gray);
  gl_FragColor = vec4(mix(u_colorFront, u_colorBack, d), 1.0);
}`;

const STATIC_FRAME_T = 6;
const MIN_FRAME_MS = 1000 / 30;

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error("dither shader error:", gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERT);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.detachShader(prog, vs);
  gl.detachShader(prog, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error("dither link error:", gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

type Props = {
  className?: string;
  scale?: number;
  speed?: number;
  front?: string;
  back?: string;
};

/**
 * Animated ordered-dither field. Degrades to a pure-CSS halftone whenever
 * WebGL is unavailable, the shader fails, or the context is lost, so the
 * panel is never a flat empty rectangle.
 */
export default function DitherCanvas({
  className = "dither-soft",
  scale = 0.8,
  speed = 1,
  front = "#1F2DE6",
  back = "#ffffff",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let disposed = false;
    let raf = 0;
    let lastFrame = 0;
    let visible = true;
    let pageVisible = !document.hidden;

    const enableFallback = () => {
      host.classList.add("is-fallback");
    };

    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
    if (!gl) {
      enableFallback();
      return;
    }

    let prog = createProgram(gl);
    if (!prog) {
      enableFallback();
      return;
    }

    let buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    );

    let colors = { front: hexToRgb(front), back: hexToRgb(back) };

    const draw = (now: number) => {
      if (disposed) return;
      const t = reduceMotion ? STATIC_FRAME_T : (now / 1000) * speed;
      gl!.useProgram(prog!);
      gl!.bindBuffer(gl!.ARRAY_BUFFER, buf);
      const aPos = gl!.getAttribLocation(prog!, "aPosition");
      gl!.enableVertexAttribArray(aPos);
      gl!.vertexAttribPointer(aPos, 2, gl!.FLOAT, false, 8, 0);
      gl!.uniform2f(gl!.getUniformLocation(prog!, "u_resolution"), canvas!.width, canvas!.height);
      gl!.uniform1f(gl!.getUniformLocation(prog!, "u_time"), t);
      gl!.uniform1f(gl!.getUniformLocation(prog!, "u_scale"), scale);
      gl!.uniform3fv(gl!.getUniformLocation(prog!, "u_colorFront"), colors.front);
      gl!.uniform3fv(gl!.getUniformLocation(prog!, "u_colorBack"), colors.back);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    };

    const loop = (now: number) => {
      if (disposed || !visible || !pageVisible) return;
      if (now - lastFrame >= MIN_FRAME_MS) {
        lastFrame = now;
        draw(now);
      }
      raf = requestAnimationFrame(loop);
    };

    const startLoop = () => {
      if (reduceMotion) {
        draw(0);
        return;
      }
      if (!raf && visible && pageVisible) raf = requestAnimationFrame(loop);
    };
    const stopLoop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const applyColors = () => {
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      colors = isDark
        ? { front: hexToRgb("#2B3BF0"), back: hexToRgb("#141419") }
        : { front: hexToRgb(front), back: hexToRgb(back) };
      if (reduceMotion) draw(0);
    };
    applyColors();

    const themeObserver = new MutationObserver(applyColors);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const resize = () => {
      const rect = canvas!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.round(rect.width * 0.5 * dpr));
      const h = Math.max(1, Math.round(rect.height * 0.5 * dpr));
      if (canvas!.width !== w || canvas!.height !== h) {
        canvas!.width = w;
        canvas!.height = h;
        gl!.viewport(0, 0, w, h);
      }
      if (reduceMotion) draw(0);
    };
    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    const io =
      "IntersectionObserver" in window
        ? new IntersectionObserver((entries) => {
            visible = entries[0] ? entries[0].isIntersecting : true;
            if (visible) startLoop();
            else stopLoop();
          })
        : null;
    io?.observe(canvas);

    const onVisibility = () => {
      pageVisible = !document.hidden;
      if (pageVisible) startLoop();
      else stopLoop();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      stopLoop();
    };
    const onContextRestored = () => {
      if (disposed) return;
      prog = createProgram(gl);
      if (!prog) {
        enableFallback();
        return;
      }
      // The old buffer object died with the context — rebuild and re-upload.
      buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 3, -1, -1, 3]),
        gl.STATIC_DRAW
      );
      resize();
      startLoop();
    };
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);

    startLoop();

    return () => {
      disposed = true;
      stopLoop();
      resizeObserver.disconnect();
      io?.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    };
  }, [scale, speed, front, back]);

  return (
    <div ref={hostRef} className="dither-host" aria-hidden="true">
      <canvas
        ref={canvasRef}
        className={className}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          imageRendering: "pixelated",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
