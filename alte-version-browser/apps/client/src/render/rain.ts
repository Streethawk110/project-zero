// Regen als Streifen (Bewegungsunschärfe der Tropfen) statt runder Punkte: ein Kasten voller Tropfen
// um die Kamera, komplett auf der GPU. Tropfen liegen fest im Weltraster (sie wandern nicht mit der
// Kamera), fallen schräg im Wind und enden am Boden – und unter den Dächern begehbarer Häuser gar
// nicht erst. Helligkeit folgt dem Himmelslicht, nahe Tropfen sind deutlicher als ferne.

import * as THREE from 'three';
import { WORLD_HALF } from '@pz/shared';
import { wetness, MAX_DRY_ROOMS, buildRooms } from './wetness.ts';

const BOX = 26; // Kantenlänge des Tropfenkastens (m)
const HEIGHT = 16;

export class Rain {
  mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor(heightTex: THREE.Texture, count = 9000) {
    buildRooms();
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) seeds.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = count;
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uCam: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uAmount: { value: 0 },
        uWind: { value: new THREE.Vector2(0.8, 0.3) },
        uLight: { value: new THREE.Color(0.6, 0.65, 0.7) },
        tHeight: { value: heightTex },
        uWorldHalf: { value: WORLD_HALF },
        uDryRoom: wetness.uDryRoom,
        uDryTop: wetness.uDryTop,
      },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform vec3 uCam; uniform float uTime; uniform float uAmount; uniform vec2 uWind;
        uniform sampler2D tHeight; uniform float uWorldHalf;
        uniform vec4 uDryRoom[${MAX_DRY_ROOMS}];
        uniform float uDryTop[${MAX_DRY_ROOMS}];
        varying float vA; varying float vU;
        void main() {
          // nur ein Teil der Tropfen bei leichtem Regen
          float on = step(aSeed.w, uAmount);
          vec3 fall = normalize(vec3(uWind.x, -9.0, uWind.y));
          float speed = 8.5 + aSeed.w * 2.0;
          // Weltfestes Raster: Lage im Kasten um die Kamera, beim Verlassen auf der anderen Seite wieder
          vec2 base = aSeed.xy * ${BOX.toFixed(1)};
          float y0 = mod(aSeed.z * ${HEIGHT.toFixed(1)} - uTime * speed, ${HEIGHT.toFixed(1)});
          vec3 p = vec3(base.x, y0 + uCam.y - ${(HEIGHT * 0.35).toFixed(2)}, base.y);
          // Windversatz über die Fallhöhe
          p.xz += fall.xz / -fall.y * (${HEIGHT.toFixed(1)} - y0);
          p.xz = uCam.xz + mod(p.xz - uCam.xz + ${(BOX / 2).toFixed(1)}, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)};
          // Boden und Dächer: darunter kein Tropfen
          vec2 tuv = (p.xz + uWorldHalf) / (uWorldHalf * 2.0);
          float ground = texture2D(tHeight, tuv).r;
          float vis = on * step(ground, p.y);
          for (int i = 0; i < ${MAX_DRY_ROOMS}; i++) {
            vec4 r = uDryRoom[i];
            if (p.x > r.x - 0.4 && p.x < r.z + 0.4 && p.z > r.y - 0.4 && p.z < r.w + 0.4 && p.y < uDryTop[i] + 1.5) vis = 0.0;
          }
          float len = 0.45 + aSeed.w * 0.35;
          // Streifen entlang der Fallrichtung, quer zur Blickrichtung aufgespannt
          vec3 toCam = normalize(cameraPosition - p);
          vec3 side = normalize(cross(fall, toCam));
          float d = length(cameraPosition - p);
          float w = 0.006 + d * 0.0009; // ferne Tropfen nicht unter Pixelbreite schrumpfen lassen
          vec3 wp = p + side * position.x * w + fall * (position.y + 0.5) * len;
          vA = vis * (1.0 - smoothstep(${(BOX * 0.3).toFixed(1)}, ${(BOX * 0.5).toFixed(1)}, d)) * smoothstep(0.4, 1.5, d);
          vU = position.x * 2.0;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uLight; uniform float uAmount;
        varying float vA; varying float vU;
        void main() {
          float a = vA * (1.0 - vU * vU) * 0.28;
          if (a < 0.004) discard;
          gl_FragColor = vec4(uLight, a);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.name = 'Regen';
    this.mesh.visible = false;
  }

  /** amount 0–1 (Regenstärke), indoor 0–1 (Kamera im Haus), light = Himmelslicht */
  update(cam: THREE.Vector3, time: number, amount: number, indoor: number, light: THREE.Color) {
    const a = amount * (1 - indoor);
    this.mesh.visible = a > 0.02;
    const u = this.mat.uniforms;
    u['uCam']!.value.copy(cam);
    u['uTime']!.value = time;
    u['uAmount']!.value = a;
    u['uLight']!.value.copy(light);
  }
}
