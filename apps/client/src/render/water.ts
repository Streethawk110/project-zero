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
    vec3 n1 = texture2D(tNormal, vWPos.xz * 0.035 + vec2(uTime * 0.012, uTime * 0.008) - f * 0.05).xyz * 2.0 - 1.0;
    vec3 n2 = texture2D(tNormal, vWPos.xz * 0.09 - vec2(uTime * 0.02, -uTime * 0.013) - f * 0.12).xyz * 2.0 - 1.0;
    vec3 n = normalize(vec3(n1.x + n2.x, 6.0 - uRain * 2.0, n1.y + n2.y));
    vec3 V = normalize(cameraPosition - vWPos);
    float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
    fres = mix(0.03, 1.0, fres);
    vec3 R = reflect(-V, n);
    vec3 sky = mix(uSkyColor * 0.8, uSkyColor * 1.15, smoothstep(0.0, 0.6, R.y));
    vec3 water = mix(uShallow, uDeep, smoothstep(0.0, 6.0, depth));
    vec3 col = mix(water, sky, fres * 0.85);
    float spec = pow(max(dot(R, uSunDir), 0.0), 220.0) * (1.0 - uNight * 0.7);
    col += uSunColor * spec * 3.0;
    // Uferschaum
    float foam = smoothstep(0.9, 0.0, depth) * (0.55 + 0.45 * sin(uTime * 1.8 + vWPos.x * 0.6 + vWPos.z * 0.4));
    foam *= smoothstep(0.35, 0.65, texture2D(tNormal, vWPos.xz * 0.2 + uTime * 0.03).b);
    col = mix(col, vec3(0.9, 0.94, 0.95), foam * 0.6);
    float alpha = clamp(0.55 + depth * 0.22 + fres * 0.3, 0.0, 0.96);
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

function waveNormalTexture() {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2, v = (y / size) * Math.PI * 2;
      h[y * size + x] = Math.sin(u * 3 + Math.sin(v * 2) * 1.5) * 0.5 + Math.sin(v * 5 + u) * 0.3 + Math.sin(u * 7 - v * 4) * 0.15 + Math.sin(u * 11 + v * 9) * 0.08;
    }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)]!, r = h[y * size + ((x + 1) % size)]!;
      const t = h[((y - 1 + size) % size) * size + x]!, b = h[((y + 1) % size) * size + x]!;
      const nx = (l - r) * 1.5, ny = (t - b) * 1.5;
      const i = (y * size + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (h[y * size + x]! * 0.4 + 0.5) * 255;
      data[i + 3] = 255;
    }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
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
    this.material = new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, transparent: true, fog: true, depthWrite: false });

    // Meer: fein unterteilt nahe der Küste
    const sea = new THREE.PlaneGeometry(2400, 1400, 200, 80);
    sea.rotateX(-Math.PI / 2);
    sea.translate(0, 0, shoreLine(0) + 560);
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

  update(t: number, sunDir: THREE.Vector3, sunColor: THREE.Color, skyColor: THREE.Color, night: number, rain: number) {
    const u = this.material.uniforms;
    u['uTime']!.value = t;
    u['uSunDir']!.value.copy(sunDir);
    u['uSunColor']!.value.copy(sunColor);
    u['uSkyColor']!.value.copy(skyColor);
    u['uNight']!.value = night;
    u['uRain']!.value = rain;
  }
}
