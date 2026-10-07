import * as THREE from 'three';

// Sky gradient shared by the dome, the water's reflection and the daytime Moon.
const SKY = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunGlow;

vec3 skyGradient(vec3 d) {
  float h = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uHorizon, uZenith, pow(h, 0.5));
  float s = max(dot(d, uSunDir), 0.0);
  float vis = smoothstep(-0.25, 0.05, uSunDir.y);
  c += uSunColor * (pow(s, 6.0) * 0.35 + pow(s, 48.0) * 0.6) * uSunGlow * vis;
  return c;
}
`;

const RING = /* glsl */ `
uniform float uRing, uRingSpread, uRingCenter, uRingBright, uLat;
// World is x east, y up, z south. Equatorial frame: y is Earth's axis,
// x points to the observer's meridian, east is -z.
vec3 toEq(vec3 w) {
  float s = sin(uLat), c = cos(uLat);
  vec3 up = vec3(c, s, 0.0), north = vec3(-s, c, 0.0), east = vec3(0.0, 0.0, -1.0);
  return east * w.x + up * w.y + north * (-w.z);
}

// Rings in Earth's equatorial plane, radii in Earth radii.
vec4 ring(vec3 dW) {
  if (uRing <= 0.001) return vec4(0.0);
  vec3 d = toEq(dW);
  vec3 O = vec3(cos(uLat), sin(uLat), 0.0);
  if (d.y > -1e-4) return vec4(0.0);
  float t = -O.y / d.y;
  vec3 H = O + t * d;
  float r = length(H.xz);
  float inner = 1.75, outer = 2.7;
  float edge = smoothstep(inner, inner + 0.03, r) * (1.0 - smoothstep(outer - 0.04, outer, r));
  float bands = 0.6 + 0.2 * sin(r * 53.0) + 0.12 * sin(r * 137.0 + 1.3) + 0.08 * sin(r * 291.0 + 0.7);
  float faint = mix(0.32, 1.0, smoothstep(1.95, 2.02, r));          // a dim inner ring
  float gap = 1.0 - 0.92 * (1.0 - smoothstep(0.0, 0.045, abs(r - 2.36)));
  float gap2 = 1.0 - 0.8 * (1.0 - smoothstep(0.0, 0.012, abs(r - 2.6)));
  float dens = edge * bands * faint * gap * gap2;
  // Debris spreads around the orbit from where the Moon broke up.
  float ang = atan(H.z, H.x);
  float da = abs(mod(ang - uRingCenter + 3.14159265, 6.2831853) - 3.14159265);
  float spread = uRingSpread * 3.3;
  dens *= smoothstep(spread, spread - 0.6, da);
  // Earth's shadow falls across the ring at night.
  vec3 S = toEq(uSunDir);
  float along = dot(H, S);
  float perp = length(H - along * S);
  float shade = along < 0.0 ? smoothstep(0.97, 1.03, perp) : 1.0;
  float alpha = clamp(dens, 0.0, 1.0) * uRing * smoothstep(0.0, 0.1, dW.y);
  vec3 col = mix(vec3(0.80, 0.76, 0.70), vec3(0.96, 0.93, 0.87), smoothstep(1.9, 2.5, r)) * uRingBright * mix(0.05, 1.0, shade);
  return vec4(col, alpha);
}

`;

const FOG = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
vec3 applyFog(vec3 c, float dist) {
  float f = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  return mix(c, uFogColor, clamp(f, 0.0, 1.0));
}
`;

const HASH = /* glsl */ `
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
`;

export function skyUniforms() {
  return {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uSunGlow: { value: 1 },
    uFogColor: { value: new THREE.Color() },
    uFogDensity: { value: 0.0002 },
    uRing: { value: 0 },
    uRingSpread: { value: 1 },
    uRingCenter: { value: 0.5 },
    uRingBright: { value: 1 },
    uLat: { value: (19 * Math.PI) / 180 },
  };
}

// --- Sky dome: gradient, sun, stars, and the ring seen from 19°N ----------

export function makeSkyMaterial(shared) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      ...shared,
      uStars: { value: 0 },
      uSunDisc: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      ${SKY}
      ${RING}
      ${HASH}
      uniform vec3 uFogColor;
      uniform float uStars, uSunDisc;
      varying vec3 vDir;

      float stars(vec3 d) {
        vec3 p = d * 260.0;
        vec3 cell = floor(p);
        float h = hash13(cell);
        if (h < 0.982) return 0.0;
        vec3 c = cell + 0.5 + (hash33(cell) - 0.5) * 0.7;
        float r = length(p - c);
        float b = (h - 0.982) / 0.018;
        return smoothstep(0.42, 0.0, r) * (0.35 + 0.65 * b * b);
      }

      void main() {
        vec3 d = normalize(vDir);
        vec3 c = skyGradient(d);
        c += vec3(0.85, 0.9, 1.0) * stars(d) * uStars * smoothstep(0.0, 0.15, d.y) * 1.6;
        float s = dot(d, uSunDir);
        c += uSunColor * smoothstep(0.99955, 0.99975, s) * 6.0 * uSunDisc * step(-0.02, uSunDir.y);
        vec4 rg = ring(d);
        c = mix(c, rg.rgb, rg.a);
        float below = smoothstep(0.02, -0.02, d.y);
        c = mix(c, uFogColor, below);
        c = mix(c, uFogColor, (1.0 - smoothstep(0.0, 0.08, d.y)) * 0.6);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

// --- Water: flat plane, wave normals computed per pixel -------------------

export function makeWaterMaterial(shared) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uTime: { value: 0 },
      uWave: { value: 0.3 },
      uDeep: { value: new THREE.Color('#2d6a8a') },
      uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonGlint: { value: 0 },
      uMoonSize: { value: 0.01 },
      uLampGlint: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${SKY}
      ${RING}
      ${FOG}
      uniform float uTime, uWave, uMoonGlint, uMoonSize;
      uniform vec3 uDeep, uMoonDir;
      varying vec3 vWorld;

      vec2 waveGrad(vec2 p, float dist) {
        vec2 g = vec2(0.0);
        float f = 0.15, a = 1.0;
        // Rough size of one pixel's footprint on the water at this distance.
        float fp = dist * dist * 1.3e-5 + dist * 5e-4;
        for (int i = 0; i < 10; i++) {
          float fi = float(i);
          vec2 dir = normalize(vec2(cos(fi * 2.17 + 0.4), sin(fi * 2.17 + 0.4)));
          float ph = dot(dir, p) * f + uTime * (0.9 + fi * 0.37) * sqrt(f * 9.0);
          // Fade out waves too small to see at this distance.
          float lod = 1.0 - smoothstep(0.25, 0.8, fp * f);
          g += dir * f * a * cos(ph) * lod;
          f *= 1.61; a *= 0.66;
        }
        return g;
      }

      void main() {
        float dist = length(cameraPosition - vWorld);
        vec2 g = waveGrad(vWorld.xz, dist) * uWave * 1.1;
        vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 v = normalize(cameraPosition - vWorld);
        float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
        vec3 r = reflect(-v, n);
        r.y = abs(r.y);
        vec3 refl = skyGradient(r);
        vec4 rg = ring(r);
        refl = mix(refl, rg.rgb, rg.a);
        vec3 col = mix(uDeep, refl, clamp(fres, 0.0, 1.0));
        float sunVis = smoothstep(-0.03, 0.04, uSunDir.y);
        col += uSunColor * pow(max(dot(r, uSunDir), 0.0), 420.0) * 3.0 * sunVis;
        col += uSunColor * pow(max(dot(r, uSunDir), 0.0), 40.0) * 0.12 * sunVis;
        float mg = pow(max(dot(r, uMoonDir), 0.0), mix(1400.0, 260.0, clamp(uMoonSize * 6.0, 0.0, 1.0)));
        col += vec3(0.85, 0.9, 1.0) * mg * uMoonGlint;
        col = applyFog(col, dist);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

// --- Moon: textured, lit from one side, cracks with molten seams ----------

export function makeMoonMaterial(shared, map) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uMap: { value: map },
      uLight: { value: new THREE.Vector3(0, 0, 1) },
      uBright: { value: 1.4 },
      uDay: { value: 0 },
      uCrack: { value: 0 },
      uAlpha: { value: 1 },
    },
    transparent: true,
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vObj;
      varying vec2 vUv;
      varying vec3 vDir;
      void main() {
        vUv = uv;
        vObj = normalize(position);
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vDir = normalize(w.xyz - cameraPosition);
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${SKY}
      ${HASH}
      uniform sampler2D uMap;
      uniform vec3 uLight;
      uniform float uBright, uDay, uCrack, uAlpha;
      varying vec3 vN;
      varying vec3 vObj;
      varying vec2 vUv;
      varying vec3 vDir;

      // Distance to the nearest Voronoi edge on the sphere.
      float voronoiEdge(vec3 p) {
        vec3 b = floor(p);
        float d1 = 8.0, d2 = 8.0;
        for (int x = -1; x <= 1; x++)
        for (int y = -1; y <= 1; y++)
        for (int z = -1; z <= 1; z++) {
          vec3 c = b + vec3(x, y, z);
          vec3 q = c + hash33(c);
          float d = length(p - q);
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
        }
        return d2 - d1;
      }

      void main() {
        vec3 alb = texture2D(uMap, vUv).rgb;
        float ndl = dot(normalize(vN), normalize(uLight));
        float lit = smoothstep(-0.02, 0.18, ndl) * (0.55 + 0.45 * max(ndl, 0.0));
        vec3 col = alb * lit * uBright;
        col += alb * 0.015;
        if (uCrack > 0.0) {
          float e = voronoiEdge(vObj * 3.2);
          float e2 = voronoiEdge(vObj * 9.0 + 4.0);
          float w = 0.02 + 0.09 * uCrack;
          float line = (1.0 - smoothstep(0.0, w, e)) * smoothstep(0.0, 0.35, uCrack);
          line = max(line, (1.0 - smoothstep(0.0, w * 0.6, e2)) * smoothstep(0.45, 0.9, uCrack));
          vec3 hot = mix(vec3(1.0, 0.35, 0.08), vec3(1.0, 0.85, 0.5), line * line);
          col = mix(col, hot * 2.4, line);
        }
        col = col * (1.0 - 0.2 * uDay) + skyGradient(normalize(vDir)) * uDay * (1.0 - 0.55 * lit);
        gl_FragColor = vec4(col, uAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
