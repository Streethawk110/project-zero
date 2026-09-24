import * as THREE from 'three';
import { RIVER, RIVER_WIDTH, riverSurfaceAt, WORLD_HALF, shoreLine } from '@pz/shared';

const vert = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  uniform float uTime;
  varying vec3 vWPos;
  varying vec2 vFlow;
  attribute vec2 flow;
  void main() {
    vec3 p = position;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    float w = sin(wp.x * 0.08 + uTime * 0.9) * 0.12 + sin(wp.z * 0.11 - uTime * 0.7) * 0.1 + sin((wp.x + wp.z) * 0.21 + uTime * 1.6) * 0.04;
    wp.y += w * (1.0 - step(0.5, length(flow)));
    vWPos = wp.xyz;
    vFlow = flow;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const frag = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform vec3 uSkyTop;
  uniform vec3 uSkyHorizon;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform sampler2D tHeight;
  uniform sampler2D tNormal;
  uniform float uWorldHalf;
  uniform float uNight;
  uniform float uRain;
  varying vec3 vWPos;
  varying vec2 vFlow;
  void main() {
    vec2 uv = (vWPos.xz + uWorldHalf) / (uWorldHalf * 2.0);
    float ground = texture2D(tHeight, uv).r;
    float depth = max(0.0, vWPos.y - ground);
    vec2 f = vFlow * uTime;
    float camDist = length(cameraPosition - vWPos);
    float detail = 1.0 - smoothstep(60.0, 260.0, camDist);
    vec3 n1 = texture2D(tNormal, vWPos.xz * 0.018 + vec2(uTime * 0.008, uTime * 0.005) - f * 0.03).xyz * 2.0 - 1.0;
    vec3 n2 = texture2D(tNormal, vWPos.xz * 0.047 - vec2(uTime * 0.014, -uTime * 0.01) - f * 0.08).xyz * 2.0 - 1.0;
    vec3 n3 = texture2D(tNormal, vWPos.xz * 0.13 + vec2(-uTime * 0.03, uTime * 0.021) - f * 0.2).xyz * 2.0 - 1.0;
    vec2 nxy = n1.xy * 0.9 + n2.xy * 0.6 + n3.xy * 0.45 * detail;
    vec3 n = normalize(vec3(nxy.x, 3.2 - uRain * 1.2 + (1.0 - detail) * 3.0, nxy.y));
    vec3 V = normalize(cameraPosition - vWPos);
    float ndv = max(dot(n, V), 0.0);
    float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    vec3 R = reflect(-V, n);
    R.y = abs(R.y);
    vec3 sky = mix(uSkyHorizon, uSkyTop, pow(smoothstep(0.0, 0.8, R.y), 0.6));
    // Flusswasser (vFlow ≠ 0) klarer und grünlich-braun, Meer blaugrün
    float isRiver = step(0.5, length(vFlow));
    vec3 shallow = mix(uShallow, vec3(0.05, 0.075, 0.05), isRiver);
    vec3 deep = mix(uDeep, vec3(0.012, 0.025, 0.022), isRiver);
    vec3 water = mix(shallow, deep, smoothstep(0.0, isRiver > 0.5 ? 2.5 : 7.0, depth));
    // Durchleuchten der Wellenkämme gegen die Sonne
    float sss = pow(max(dot(V, -uSunDir), 0.0), 3.0) * max(n3.z * 0.5 + 0.5, 0.0) * (1.0 - uNight);
    water += vec3(0.05, 0.22, 0.18) * sss * 0.8;
    vec3 col = mix(water, sky, fres * mix(1.0, 0.75, isRiver));
    float spec = pow(max(dot(R, uSunDir), 0.0), 400.0) * 6.0 + pow(max(dot(R, uSunDir), 0.0), 40.0) * 0.25;
    col += uSunColor * spec * (1.0 - uNight * 0.7);
    // Uferschaum
    // Schaum nur an sehr flachen Stellen (Ufersaum), im Fluss schwächer
    float foam = smoothstep(0.3, 0.0, depth) * (0.55 + 0.45 * sin(uTime * 1.8 + vWPos.x * 0.6 + vWPos.z * 0.4)) * mix(1.0, 0.5, isRiver);
    foam *= smoothstep(0.35, 0.65, texture2D(tNormal, vWPos.xz * 0.2 + uTime * 0.03).b);
    col = mix(col, vec3(0.9, 0.94, 0.95), foam * 0.6);
    float alpha = clamp(mix(0.55, 0.35, isRiver) + depth * 0.25 + fres * 0.3, 0.0, 0.96);
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/** Kachelbare Wellen-Normalen aus mehreren Rauschschichten (keine sichtbaren Sinusmuster). */
function waveNormalTexture() {
  const size = 512;
  const data = new Uint8Array(size * size * 4);
  const h = new Float32Array(size * size);
  // Kachelbares Wertrauschen
  const lattice = (period: number, seed: number) => {
    const g = new Float32Array(period * period);
    let a = seed;
    for (let i = 0; i < g.length; i++) { a = (a * 1664525 + 1013904223) >>> 0; g[i] = a / 4294967296; }
    return g;
  };
  const octaves = [[8, 1, 3], [16, 0.55, 5], [32, 0.3, 7], [64, 0.16, 11], [128, 0.08, 13]] as const;
  const grids = octaves.map(([p, , sd]) => lattice(p, sd));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let v = 0;
      octaves.forEach(([p, amp], oi) => {
        const g = grids[oi]!;
        const fx = (x / size) * p, fy = (y / size) * p;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = fx - x0, ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const at = (i: number, j: number) => g[((j % p) + p) % p * p + (((i % p) + p) % p)]!;
        const a0 = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
        const a1 = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
        // „Scharfe“ Wellenkämme: 1 - |2v - 1|
        const n = a0 + (a1 - a0) * sy;
        v += (1 - Math.abs(n * 2 - 1)) * amp;
      });
      h[y * size + x] = v;
    }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)]!, r = h[y * size + ((x + 1) % size)]!;
      const t = h[((y - 1 + size) % size) * size + x]!, b = h[((y + 1) % size) * size + x]!;
      const nx = (l - r) * 5, ny = (t - b) * 5;
      const i = (y * size + x) * 4;
      data[i] = Math.max(0, Math.min(255, (nx * 0.5 + 0.5) * 255));
      data[i + 1] = Math.max(0, Math.min(255, (ny * 0.5 + 0.5) * 255));
      data[i + 2] = Math.max(0, Math.min(255, (h[y * size + x]! / 2.1) * 255));
      data[i + 3] = 255;
    }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export class Water {
  group = new THREE.Group();
  material: THREE.ShaderMaterial;

  constructor(heightTex: THREE.Texture) {
    const uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
        uSkyColor: { value: new THREE.Color(0.55, 0.68, 0.8) },
        uSkyTop: { value: new THREE.Color(0.25, 0.42, 0.72) },
        uSkyHorizon: { value: new THREE.Color(0.7, 0.76, 0.82) },
        uDeep: { value: new THREE.Color(0.02, 0.1, 0.13) },
        uShallow: { value: new THREE.Color(0.12, 0.32, 0.33) },
        tHeight: { value: null },
        tNormal: { value: null },
        uWorldHalf: { value: WORLD_HALF },
        uNight: { value: 0 },
        uRain: { value: 0 },
      },
    ]);
    uniforms['tHeight']!.value = heightTex;
    uniforms['tNormal']!.value = waveNormalTexture();
    // Tiefe schreiben: Umgebungsverdeckung und Nebel sollen die Wasseroberfläche sehen, nicht das
    // Flussbett darunter (sonst dunkle Streifen an steilen Ufern)
    this.material = new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, transparent: true, fog: true, depthWrite: true });

    // Meer: beginnt genau an der Küstenlinie (kein Meer unter dem Fluss), nahe der Küste fein unterteilt
    const sea = new THREE.PlaneGeometry(2400, 1400, 200, 80);
    sea.rotateX(-Math.PI / 2);
    {
      const p = sea.attributes['position']!;
      for (let i = 0; i < p.count; i++) {
        const f = (p.getZ(i) + 700) / 1400;
        p.setZ(i, shoreLine(p.getX(i)) - 3 + Math.pow(f, 1.6) * 1300);
      }
      sea.computeBoundingSphere();
    }
    sea.setAttribute('flow', new THREE.BufferAttribute(new Float32Array(sea.attributes['position']!.count * 2), 2));
    const seaMesh = new THREE.Mesh(sea, this.material);
    seaMesh.renderOrder = 2;
    this.group.add(seaMesh);

    // Fluss als Band entlang des Verlaufs
    const pts = RIVER.map(([x, z]) => new THREE.Vector2(x, z));
    const pos: number[] = [], flow: number[] = [], idx: number[] = [];
    const seg = 6;
    let vi = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!, b = pts[i + 1]!;
      const dir = b.clone().sub(a);
      const len = dir.length();
      dir.normalize();
      const nrm = new THREE.Vector2(-dir.y, dir.x);
      const steps = Math.ceil(len / seg);
      for (let s = 0; s <= steps; s++) {
        if (i > 0 && s === 0) continue;
        const p = a.clone().addScaledVector(dir, (len * s) / steps);
        // Der Fluss endet an der Küste, dort übernimmt das Meer (keine doppelten Wasserflächen)
        if (p.y > shoreLine(p.x) - 1) break;
        const y = riverSurfaceAt(p.y);
        const w = RIVER_WIDTH * 0.5 + 2.5;
        pos.push(p.x + nrm.x * w, y, p.y + nrm.y * w, p.x - nrm.x * w, y, p.y - nrm.y * w);
        flow.push(dir.x, dir.y, dir.x, dir.y);
        if (vi > 0) idx.push(vi - 2, vi, vi - 1, vi - 1, vi, vi + 1);
        vi += 2;
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    rg.setAttribute('flow', new THREE.Float32BufferAttribute(flow, 2));
    rg.setIndex(idx);
    rg.computeBoundingSphere();
    const river = new THREE.Mesh(rg, this.material);
    river.renderOrder = 2;
    this.group.add(river);
  }

  update(t: number, sunDir: THREE.Vector3, sunColor: THREE.Color, skyColor: THREE.Color, night: number, rain: number, skyTop?: THREE.Color, skyHorizon?: THREE.Color) {
    const u = this.material.uniforms;
    u['uSkyTop']!.value.copy(skyTop ?? skyColor);
    u['uSkyHorizon']!.value.copy(skyHorizon ?? skyColor);
    u['uTime']!.value = t;
    u['uSunDir']!.value.copy(sunDir);
    u['uSunColor']!.value.copy(sunColor);
    u['uSkyColor']!.value.copy(skyColor);
    u['uNight']!.value = night;
    u['uRain']!.value = rain;
  }
}
