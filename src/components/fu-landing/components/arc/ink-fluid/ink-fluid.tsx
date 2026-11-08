"use client";

import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import styles from "./ink-fluid.module.css";

/**
 * A real time fluid simulation (stable fluids, solved on the GPU on a small grid and drawn smoothly upscaled) that sits behind
 * your content. The pointer stirs soft ink tinted with the accent colour that settles to neutral as it spreads; left alone it breathes
 * slowly. It pauses when it scrolls out of view or the tab is hidden, and holds one still frame for reduced motion.
 */
export interface InkFluidProps {
  /** Content drawn above the ink, such as a hero heading. */
  children?: ReactNode;
  /** How dark the ink gets, from 0 to 1. Defaults to 0.5. */
  intensity?: number;
  /** How much fresh ink takes the accent colour (`--accent`), from 0 to 1. It fades to neutral as it spreads. Defaults to 0.8. */
  tint?: number;
  /** How hard the pointer stirs, from 0 to 1. Defaults to 0.5. */
  force?: number;
  /** A slow, calm stir while nobody interacts. Defaults to true. */
  ambient?: boolean;
  /** Lets the pointer stir the ink. Defaults to true. */
  interactive?: boolean;
  /** Simulation grid resolution. Defaults to "medium". */
  quality?: "low" | "medium" | "high";
  className?: string;
  style?: CSSProperties;
}

const VS = `#version 300 es
in vec2 aPos; uniform vec2 uTexel;
out vec2 vUv; out vec2 vL; out vec2 vR; out vec2 vT; out vec2 vB;
void main() {
  vUv = aPos * 0.5 + 0.5;
  vL = vUv - vec2(uTexel.x, 0.0); vR = vUv + vec2(uTexel.x, 0.0);
  vT = vUv + vec2(0.0, uTexel.y); vB = vUv - vec2(0.0, uTexel.y);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;
const HEAD = `#version 300 es
precision highp float; precision highp sampler2D;
in vec2 vUv; in vec2 vL; in vec2 vR; in vec2 vT; in vec2 vB; out vec4 o;
`;
const FS = {
  splat: `${HEAD}uniform sampler2D uTarget; uniform float uAspect; uniform vec3 uColor; uniform vec2 uPoint; uniform float uRadius;
void main() { vec2 p = vUv - uPoint; p.x *= uAspect; vec3 s = exp(-dot(p, p) / uRadius) * uColor; o = vec4(texture(uTarget, vUv).xyz + s, 1.0); }`,
  advect: `${HEAD}uniform sampler2D uVelocity; uniform sampler2D uSource; uniform vec2 uVelTexel; uniform float uDt; uniform float uDissipation; uniform float uTintFade;
void main() {
  vec2 coord = vUv - uDt * texture(uVelocity, vUv).xy * uVelTexel;
  vec4 c = texture(uSource, coord) / (1.0 + uDissipation * uDt);
  // The accent share hands its ink to the neutral share as it spreads, so fresh strokes carry colour and old wisps go grey.
  float moved = c.g * uTintFade * uDt;
  o = vec4(c.r + moved * 0.85, c.g - moved, c.b, c.a);
}`,
  divergence: `${HEAD}uniform sampler2D uVelocity;
void main() {
  float L = texture(uVelocity, vL).x, R = texture(uVelocity, vR).x, T = texture(uVelocity, vT).y, B = texture(uVelocity, vB).y;
  vec2 C = texture(uVelocity, vUv).xy;
  if (vL.x < 0.0) L = -C.x; if (vR.x > 1.0) R = -C.x; if (vT.y > 1.0) T = -C.y; if (vB.y < 0.0) B = -C.y;
  o = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`,
  curl: `${HEAD}uniform sampler2D uVelocity;
void main() { o = vec4(0.5 * (texture(uVelocity, vR).y - texture(uVelocity, vL).y - texture(uVelocity, vT).x + texture(uVelocity, vB).x), 0.0, 0.0, 1.0); }`,
  vorticity: `${HEAD}uniform sampler2D uVelocity; uniform sampler2D uCurl; uniform float uCurlStrength; uniform float uDt;
void main() {
  float L = texture(uCurl, vL).x, R = texture(uCurl, vR).x, T = texture(uCurl, vT).x, B = texture(uCurl, vB).x, C = texture(uCurl, vUv).x;
  vec2 f = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  f /= length(f) + 0.0001; f *= uCurlStrength * C; f.y *= -1.0;
  vec2 v = texture(uVelocity, vUv).xy + f * uDt;
  o = vec4(clamp(v, -1000.0, 1000.0), 0.0, 1.0);
}`,
  pressure: `${HEAD}uniform sampler2D uPressure; uniform sampler2D uDivergence;
void main() {
  float L = texture(uPressure, vL).x, R = texture(uPressure, vR).x, T = texture(uPressure, vT).x, B = texture(uPressure, vB).x;
  o = vec4((L + R + B + T - texture(uDivergence, vUv).x) * 0.25, 0.0, 0.0, 1.0);
}`,
  gradient: `${HEAD}uniform sampler2D uPressure; uniform sampler2D uVelocity;
void main() {
  float L = texture(uPressure, vL).x, R = texture(uPressure, vR).x, T = texture(uPressure, vT).x, B = texture(uPressure, vB).x;
  o = vec4(texture(uVelocity, vUv).xy - vec2(R - L, T - B), 0.0, 1.0);
}`,
  scale: `${HEAD}uniform sampler2D uTexture; uniform float uValue; void main() { o = uValue * texture(uTexture, vUv); }`,
  display: `${HEAD}uniform sampler2D uDye; uniform vec3 uInk; uniform vec3 uAccent; uniform float uStrength; uniform float uShade; uniform vec2 uRes;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 d = texture(uDye, vUv).rgb;
  float L = dot(texture(uDye, vL).rg, vec2(1.0)), R = dot(texture(uDye, vR).rg, vec2(1.0));
  float T = dot(texture(uDye, vT).rg, vec2(1.0)), B = dot(texture(uDye, vB).rg, vec2(1.0));
  vec3 n = normalize(vec3(R - L, T - B, 0.35));
  float light = clamp(dot(n, normalize(vec3(-0.4, 0.5, 0.75))), 0.0, 1.0);
  float an = (1.0 - exp(-max(d.r, 0.0) * 1.3)) * uStrength;
  // Accent ink reads a touch stronger than neutral ink, so fresh strokes carry real colour before they settle.
  float aa = min(1.0, (1.0 - exp(-max(d.g, 0.0) * 1.3)) * uStrength * 1.8);
  float a = clamp(an + aa * (1.0 - an), 0.0, 1.0);
  vec3 col = (uInk * an + uAccent * aa) / max(an + aa, 0.0001);
  col = mix(col, col * (0.82 + 0.3 * light), uShade);
  a += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  a = clamp(a, 0.0, 1.0);
  o = vec4(col * a, a);
}`,
};

type GL = WebGL2RenderingContext;
type Program = { p: WebGLProgram; u: (name: string) => WebGLUniformLocation | null };
type Target = { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number };
type Double = { read: Target; write: Target; swap: () => void; w: number; h: number };

function compile(gl: GL, fs: string): Program {
  const make = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const p = gl.createProgram()!;
  gl.attachShader(p, make(gl.VERTEX_SHADER, VS)); gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, "aPos");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
  const cache = new Map<string, WebGLUniformLocation | null>();
  return { p, u: name => { if (!cache.has(name)) cache.set(name, gl.getUniformLocation(p, name)); return cache.get(name)!; } };
}

function target(gl: GL, w: number, h: number, internal: number, format: number): Target {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.HALF_FLOAT, null);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  return { tex, fbo, w, h };
}
function double(gl: GL, w: number, h: number, internal: number, format: number): Double {
  const pair = { read: target(gl, w, h, internal, format), write: target(gl, w, h, internal, format), w, h, swap: () => {} };
  pair.swap = () => { const tmp = pair.read; pair.read = pair.write; pair.write = tmp; };
  return pair;
}
function destroy(gl: GL, ...targets: Target[]) { for (const t of targets) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); } }

function toRgb(color: string, fallback: [number, number, number]): [number, number, number] {
  const c = document.createElement("canvas"); c.width = c.height = 1;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx || !color) return fallback;
  ctx.fillStyle = "#000"; ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255];
}

const GRID = { low: 96, medium: 128, high: 192 } as const;
const DYE = { low: 256, medium: 512, high: 768 } as const;

export function InkFluid({ children, intensity = .5, tint = .8, force = .5, ambient = true, interactive = true, quality = "medium", className, style }: InkFluidProps) {
  const reduced = !!useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settings = useRef({ intensity, tint, force, ambient, interactive });
  useEffect(() => { settings.current = { intensity, tint, force, ambient, interactive }; });

  useEffect(() => {
    const root = rootRef.current, canvas = canvasRef.current;
    if (!root || !canvas) return;
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!gl || !gl.getExtension("EXT_color_buffer_float")) { root.dataset.fallback = ""; return; }
    let programs: Record<keyof typeof FS, Program>;
    try { programs = Object.fromEntries(Object.entries(FS).map(([k, src]) => [k, compile(gl, src)])) as Record<keyof typeof FS, Program>; }
    catch { root.dataset.fallback = ""; return; }
    const reducedNow = () => reduced;
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    let velocity: Double, dye: Double, pressure: Double, divergence: Target, curl: Target;
    let width = 0, height = 0, allocated = false;
    const allocate = () => {
      const rect = root.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(1, Math.round(rect.width * dpr)); height = Math.max(1, Math.round(rect.height * dpr));
      canvas.width = width; canvas.height = height;
      const aspect = width / height;
      const short = (n: number) => aspect >= 1 ? [Math.round(n * aspect), n] : [n, Math.round(n / aspect)];
      const [sw, sh] = short(GRID[quality]), [dw, dh] = short(DYE[quality]);
      if (allocated) destroy(gl, velocity.read, velocity.write, dye.read, dye.write, pressure.read, pressure.write, divergence, curl);
      velocity = double(gl, sw, sh, gl.RG16F, gl.RG);
      dye = double(gl, dw, dh, gl.RGBA16F, gl.RGBA);
      pressure = double(gl, sw, sh, gl.R16F, gl.RED);
      divergence = target(gl, sw, sh, gl.R16F, gl.RED);
      curl = target(gl, sw, sh, gl.R16F, gl.RED);
      allocated = true;
    };
    allocate();

    const blit = (out: Target | null) => {
      if (out) { gl.viewport(0, 0, out.w, out.h); gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo); }
      else { gl.viewport(0, 0, width, height); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const bindProgram = (prog: Program, texel: [number, number]) => { gl.useProgram(prog.p); gl.uniform2f(prog.u("uTexel"), texel[0], texel[1]); return prog; };
    const bind = (prog: Program, name: string, unit: number, t: Target) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t.tex); gl.uniform1i(prog.u(name), unit); };

    const splat = (x: number, y: number, dx: number, dy: number, ink: number, accent: number, radius: number) => {
      const p = bindProgram(programs.splat, [1 / velocity.w, 1 / velocity.h]);
      gl.uniform1f(p.u("uAspect"), width / height); gl.uniform2f(p.u("uPoint"), x, y); gl.uniform1f(p.u("uRadius"), radius / 100);
      bind(p, "uTarget", 0, velocity.read); gl.uniform3f(p.u("uColor"), dx, dy, 0); blit(velocity.write); velocity.swap();
      bind(p, "uTarget", 0, dye.read); gl.uniform3f(p.u("uColor"), ink, accent, 0); blit(dye.write); dye.swap();
    };

    const step = (dt: number) => {
      const texel: [number, number] = [1 / velocity.w, 1 / velocity.h];
      let p = bindProgram(programs.curl, texel); bind(p, "uVelocity", 0, velocity.read); blit(curl);
      p = bindProgram(programs.vorticity, texel); bind(p, "uVelocity", 0, velocity.read); bind(p, "uCurl", 1, curl);
      gl.uniform1f(p.u("uCurlStrength"), 14); gl.uniform1f(p.u("uDt"), dt); blit(velocity.write); velocity.swap();
      p = bindProgram(programs.divergence, texel); bind(p, "uVelocity", 0, velocity.read); blit(divergence);
      p = bindProgram(programs.scale, texel); bind(p, "uTexture", 0, pressure.read); gl.uniform1f(p.u("uValue"), .8); blit(pressure.write); pressure.swap();
      p = bindProgram(programs.pressure, texel); bind(p, "uDivergence", 1, divergence);
      for (let i = 0; i < 20; i++) { bind(p, "uPressure", 0, pressure.read); blit(pressure.write); pressure.swap(); }
      p = bindProgram(programs.gradient, texel); bind(p, "uPressure", 0, pressure.read); bind(p, "uVelocity", 1, velocity.read); blit(velocity.write); velocity.swap();
      p = bindProgram(programs.advect, texel); gl.uniform2f(p.u("uVelTexel"), texel[0], texel[1]); gl.uniform1f(p.u("uDt"), dt);
      bind(p, "uVelocity", 0, velocity.read); bind(p, "uSource", 1, velocity.read); gl.uniform1f(p.u("uDissipation"), .3); gl.uniform1f(p.u("uTintFade"), 0); blit(velocity.write); velocity.swap();
      p = bindProgram(programs.advect, [1 / dye.w, 1 / dye.h]); gl.uniform2f(p.u("uVelTexel"), texel[0], texel[1]); gl.uniform1f(p.u("uDt"), dt);
      bind(p, "uVelocity", 0, velocity.read); bind(p, "uSource", 1, dye.read); gl.uniform1f(p.u("uDissipation"), 1.1); gl.uniform1f(p.u("uTintFade"), .22); blit(dye.write); dye.swap();
    };

    let ink: [number, number, number] = [0, 0, 0], accent: [number, number, number] = [0, 0, 0], dark = false;
    const readColors = () => {
      const cs = getComputedStyle(root);
      ink = toRgb(cs.getPropertyValue("--ink-color").trim(), [.1, .1, .1]);
      accent = toRgb(cs.getPropertyValue("--ink-accent").trim(), [.2, .2, .2]);
      dark = cs.getPropertyValue("--ink-dark").trim() === "1";
    };
    readColors();
    const render = () => {
      const p = bindProgram(programs.display, [1 / dye.w, 1 / dye.h]);
      bind(p, "uDye", 0, dye.read);
      gl.uniform3f(p.u("uInk"), ...ink); gl.uniform3f(p.u("uAccent"), ...accent);
      gl.uniform1f(p.u("uStrength"), Math.min(1, settings.current.intensity * (dark ? .44 : .34)));
      gl.uniform1f(p.u("uShade"), .8);
      blit(null);
    };

    // Pointer stirring.
    const pointer = { x: 0, y: 0, dx: 0, dy: 0, moved: false, last: 0, has: false };
    const onMove = (event: PointerEvent) => {
      if (!settings.current.interactive || reducedNow()) return;
      const rect = root.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width, y = 1 - (event.clientY - rect.top) / rect.height;
      if (pointer.has) { pointer.dx += (x - pointer.x) * (rect.width / rect.height); pointer.dy += y - pointer.y; }
      pointer.x = x; pointer.y = y; pointer.has = true; pointer.moved = true; pointer.last = performance.now();
    };
    const onLeave = () => { pointer.has = false; };
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerleave", onLeave);
    root.addEventListener("pointerdown", onMove);

    let seed = Math.random() * 100;
    const breathe = (time: number, dt: number) => {
      const t = time / 1000 * .16 + seed;
      const x = .5 + .34 * Math.sin(t * 1.3) * Math.cos(t * .7), y = .5 + .28 * Math.sin(t * .9 + 1.7);
      const vx = Math.cos(t * 1.1) * 60, vy = Math.sin(t * 1.7) * 60;
      splat(x, y, vx * dt * 9, vy * dt * 9, 2 * dt * (1 - settings.current.tint * .85), 2 * dt * settings.current.tint * .85, .45);
    };

    let raf = 0, running = false, visible = true, lastTime = performance.now(), accentFlip = 0;
    const frame = (time: number) => {
      raf = 0;
      const dt = Math.min(.033, (time - lastTime) / 1000); lastTime = time;
      if (pointer.moved) {
        const speed = Math.hypot(pointer.dx, pointer.dy);
        const f = 5200 * (.4 + settings.current.force * 1.2);
        const amount = Math.min(.32, speed * 5);
        accentFlip = (accentFlip + speed * 3) % 1;
        const share = settings.current.tint;
        splat(pointer.x, pointer.y, pointer.dx * f, pointer.dy * f, amount * (1 - share), amount * share * (.75 + .25 * Math.sin(accentFlip * Math.PI * 2)), .22);
        pointer.dx = pointer.dy = 0; pointer.moved = false;
      }
      if (settings.current.ambient && time - pointer.last > 1200) breathe(time, dt);
      step(dt);
      render();
      if (running) raf = requestAnimationFrame(frame);
    };
    const update = () => {
      const should = visible && !document.hidden && !reducedNow();
      if (should && !running) { running = true; lastTime = performance.now(); raf = requestAnimationFrame(frame); }
      if (!should && running) { running = false; cancelAnimationFrame(raf); raf = 0; }
    };
    const still = () => {
      // One composed still frame for reduced motion.
      seed = 3.2;
      for (let i = 0; i < 140; i++) { breathe(i * 16.7 * 2.4, 1 / 60); step(1 / 60); }
      render();
    };
    if (reduced) still();

    const io = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? true; update(); });
    io.observe(root);
    const onVisibility = () => update();
    document.addEventListener("visibilitychange", onVisibility);
    let resizeTimer = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        // The observer also fires once on mount; reallocating at the same size would wipe the ink that just started to flow.
        const rect = root.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        if (Math.max(1, Math.round(rect.width * dpr)) === width && Math.max(1, Math.round(rect.height * dpr)) === height) return;
        allocate(); if (reducedNow()) still(); else render();
      }, 120);
    });
    ro.observe(root);
    const mo = new MutationObserver(() => { readColors(); if (!running) render(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-accent", "class"] });
    update();

    return () => {
      running = false; cancelAnimationFrame(raf);
      io.disconnect(); ro.disconnect(); mo.disconnect(); window.clearTimeout(resizeTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      root.removeEventListener("pointermove", onMove); root.removeEventListener("pointerleave", onLeave); root.removeEventListener("pointerdown", onMove);
      destroy(gl, velocity.read, velocity.write, dye.read, dye.write, pressure.read, pressure.write, divergence, curl);
      Object.values(programs).forEach(p => gl.deleteProgram(p.p));
      gl.deleteBuffer(quad);
    };
  }, [quality, reduced]);

  return <div ref={rootRef} className={[styles.root, className].filter(Boolean).join(" ")} style={style}>
    <canvas ref={canvasRef} className={styles.canvas} aria-hidden />
    {children != null && <div className={styles.content}>{children}</div>}
  </div>;
}

export default InkFluid;
