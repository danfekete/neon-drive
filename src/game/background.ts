/**
 * The night drive: a full-screen shader with a striped sunset, mountains with
 * neon ridges, stars, and a perspective grid road scrolling toward the
 * horizon. One draw call. `hot` shifts it to the Overdrive palette.
 */
import { Geometry, Mesh, Shader } from 'pixi.js';

const vertex = /* glsl */ `
in vec2 aPosition;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec2 uRes;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition * uRes, 1.0)).xy, 0.0, 1.0);
  vUV = aPosition;
}
`;

const fragment = /* glsl */ `
precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform vec2 uRes;
uniform float uTime;
uniform float uHorizon;
uniform float uSunR;
uniform float uHot;
uniform float uSpeed;
uniform float uPulse;
uniform float uTravel;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 px = vUV * uRes;
  float H = uRes.y;
  vec2 p = vec2((px.x - uRes.x * 0.5) / H, (px.y - uHorizon * H) / H);

  vec3 night = mix(vec3(0.055, 0.016, 0.15), vec3(0.07, 0.0, 0.07), uHot);
  vec3 glowC = mix(vec3(1.0, 0.18, 0.53), vec3(1.0, 0.09, 0.2), uHot);
  vec3 cyan = mix(vec3(0.18, 0.89, 0.9), vec3(0.72, 0.32, 1.0), uHot);
  vec3 col;

  if (p.y < 0.0) {
    float h = -p.y;
    col = mix(glowC * 0.42, night, smoothstep(0.0, 0.5, h));
    col += glowC * 0.3 * exp(-h * 10.0);

    // Stars.
    vec2 sp = px / 26.0;
    vec2 ci = floor(sp);
    vec2 fr = fract(sp) - 0.5;
    float rnd = hash(ci);
    vec2 off = (vec2(hash(ci + 1.3), hash(ci + 2.7)) - 0.5) * 0.7;
    float star = step(0.9, rnd) * smoothstep(0.09, 0.0, length(fr - off));
    star *= 0.55 + 0.45 * sin(uTime * (1.0 + rnd * 2.0) + rnd * 40.0);
    col += vec3(0.92, 0.86, 1.0) * star * smoothstep(0.08, 0.4, h);

    // Sun: striped lower half, stripes slowly drift down.
    vec2 sc = vec2(0.0, -uSunR * 0.6);
    float d = length(p - sc);
    float sy = (p.y - sc.y) / uSunR;
    float band = fract(sy * 7.0 - uTime * 0.12);
    float gap = smoothstep(-0.1, 1.0, sy) * 0.62;
    float cut = sy > -0.05 ? step(band, gap) : 0.0;
    float disc = smoothstep(uSunR, uSunR - 0.0025, d);
    vec3 sunCol = mix(vec3(1.0, 0.86, 0.32), glowC, smoothstep(-0.9, 0.85, sy));
    col = mix(col, sunCol, disc * (1.0 - cut));
    col += sunCol * 0.28 * exp(-max(d - uSunR, 0.0) * 7.0);

    // Mountains, opening a valley for the sun.
    float mx = p.x;
    float mh = 0.075 + 0.045 * sin(mx * 6.0 + 1.3) + 0.03 * sin(mx * 15.0 + 0.4) + 0.012 * sin(mx * 43.0);
    mh *= smoothstep(0.12, 0.75, abs(mx));
    if (h < mh) {
      col = mix(vec3(0.03, 0.0, 0.08), vec3(0.11, 0.03, 0.2), h / max(mh, 0.001));
      col += cyan * 0.9 * smoothstep(0.005, 0.0, mh - h);
    }
  } else {
    // Ground grid.
    float y = max(p.y, 0.0005);
    float z = 0.32 / y;
    vec2 g = vec2(p.x * z * 2.2, z + uTravel);
    // Screen-space derivatives of g, worked out by hand (no fwidth, so WebGL1 works too).
    float dzdy = 0.32 / (y * y * H);
    vec2 fw = vec2(z * 2.2 / H + abs(p.x) * 2.2 * dzdy, dzdy);
    vec2 dist = 0.5 - abs(fract(g) - 0.5);
    float lx = 1.0 - smoothstep(0.0, fw.x * 1.6, dist.x);
    float lz = 1.0 - smoothstep(0.0, fw.y * 1.6, dist.y);
    float line = max(lx, lz);
    float near = smoothstep(0.0, 0.3, y);
    col = mix(vec3(0.04, 0.0, 0.1), night * 0.8, 0.5);
    col += glowC * 0.32 * exp(-y * 14.0);
    vec3 lineCol = mix(glowC, cyan, smoothstep(0.0, 0.35, y));
    float far = 1.0 - 0.55 * smoothstep(0.35, 1.2, y);
    col += lineCol * line * (0.25 + 0.75 * near) * far * (1.0 + uPulse * 1.5);
    col += lineCol * 0.06 * (lx + lz) * near;
  }

  // Scanlines and vignette.
  col *= 0.9 + 0.1 * sin(px.y * 3.14159);
  vec2 vq = vUV - 0.5;
  col *= 1.0 - dot(vq, vq) * 0.85;
  finalColor = vec4(col, 1.0);
}
`;

export class Background {
  readonly view: Mesh<Geometry, Shader>;
  private uniforms: Record<string, unknown>;
  /** 0 = normal night, 1 = Overdrive. */
  hot = 0;
  /** Extra grid brightness, eased back to 0 after win pulses. */
  pulse = 0;
  /** Road speed multiplier (spins speed it up). */
  speed = 1;
  private travel = 0;
  horizon = 0.62;
  sunRadius = 0.34;

  constructor() {
    const geometry = new Geometry({
      attributes: { aPosition: [0, 0, 1, 0, 1, 1, 0, 1] },
      indexBuffer: [0, 1, 2, 0, 2, 3],
    });
    const shader = Shader.from({
      gl: { vertex, fragment, name: 'neon-background' },
      resources: {
        bg: {
          uRes: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
          uTime: { value: 0, type: 'f32' },
          uHorizon: { value: 0.62, type: 'f32' },
          uSunR: { value: 0.34, type: 'f32' },
          uHot: { value: 0, type: 'f32' },
          uSpeed: { value: 1, type: 'f32' },
          uPulse: { value: 0, type: 'f32' },
          uTravel: { value: 0, type: 'f32' },
        },
      },
    });
    this.view = new Mesh({ geometry, shader });
    this.uniforms = (shader.resources.bg as { uniforms: Record<string, unknown> }).uniforms;
  }

  resize(width: number, height: number): void {
    const res = this.uniforms.uRes as Float32Array;
    res[0] = width;
    res[1] = height;
  }

  update(time: number, dt: number): void {
    this.travel += dt * 0.55 * this.speed;
    const u = this.uniforms;
    u.uTime = time;
    u.uTravel = this.travel;
    u.uHorizon = this.horizon;
    u.uSunR = this.sunRadius;
    u.uHot = this.hot;
    u.uPulse = this.pulse;
  }
}
