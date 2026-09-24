// Impostor für ferne Bäume: Jeder Baumtyp wird beim Laden aus 8 Richtungen in einen Atlas
// gerendert (Grundfarbe mit Verdeckung + Normalen im Baumraum). In der Ferne steht pro Baum nur
// noch ein Viereck, das sich zur Kamera dreht, das passende Bild wählt (zwischen zwei
// Nachbarrichtungen überblendet) und mit Sonne und Himmelslicht beleuchtet wird.
// Das ersetzt Tausende Zweigkarten pro Baum durch zwei Dreiecke.

import * as THREE from 'three';

const FRAMES = 8;

/** Licht für alle Impostor (einmal pro Bild aus der Umgebung übernommen). */
export const impostorUniforms = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uSkyColor: { value: new THREE.Color(0.5, 0.6, 0.7) },
  uGroundColor: { value: new THREE.Color(0.2, 0.18, 0.12) },
  uAmbient: { value: 1 },
};

export function setImpostorLight(sunDir: THREE.Vector3, sunColor: THREE.Color, sunIntensity: number, hemi: THREE.HemisphereLight, envIntensity: number) {
  const u = impostorUniforms;
  u.uSunDir.value.copy(sunDir);
  u.uSunColor.value.copy(sunColor).multiplyScalar(sunIntensity);
  u.uSkyColor.value.copy(hemi.color).multiplyScalar(hemi.intensity);
  u.uGroundColor.value.copy(hemi.groundColor).multiplyScalar(hemi.intensity);
  u.uAmbient.value = 1 + envIntensity * 0.8;
}

export interface Impostor {
  color: THREE.Texture;
  normal: THREE.Texture;
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
}

const BAKE_VERT = /* glsl */ `
  attribute vec4 color;
  varying vec2 vUv;
  varying vec4 vCol;
  varying vec3 vN;
  void main() {
    vUv = uv;
    vCol = color;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`;

const BAKE_FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 tint;
  uniform float leafy;
  uniform float normalPass;
  varying vec2 vUv;
  varying vec4 vCol;
  varying vec3 vN;
  void main() {
    vec4 c = texture2D(map, vUv);
    if (leafy > 0.5 && c.a < 0.45) discard;
    if (normalPass > 0.5) {
      vec3 n = normalize(vN);
      if (!gl_FrontFacing && leafy < 0.5) n = -n;
      gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
      return;
    }
    vec3 col = c.rgb * tint;
    // Verdeckung im Kroneninneren wie beim Nahmaterial
    if (leafy > 0.5) col *= mix(0.32, 1.0, vCol.g);
    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * Baut den Impostor aus den fertigen Modellteilen (Geometrie, Spielmaterial, Matrix im Baumraum;
 * Y oben, Ursprung am Stammfuß).
 */
export function bakeImpostor(renderer: THREE.WebGLRenderer, parts: { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; matrix: THREE.Matrix4 }[]): Impostor {
  const root = new THREE.Group();
  for (const p of parts) {
    const mesh = new THREE.Mesh(p.geometry, p.material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(p.matrix);
    root.add(mesh);
  }
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const radius = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z)) * 1.04;
  const w = radius * 2;
  const bottom = Math.min(0, box.min.y);
  const h = (box.max.y - bottom) * 1.02;
  const cellW = 256;
  const cellH = Math.min(512, Math.max(128, Math.round((cellW * h) / w / 64) * 64));
  // Bake-Materialien: Grundfarbe bzw. Normalen, Alpha-Test wie im Spiel
  const scene = new THREE.Scene();
  scene.add(root);
  const bakeMats: THREE.ShaderMaterial[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const src = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    const leafy = src.alphaTest > 0 || src.side === THREE.DoubleSide;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: src.map ?? whiteTex() },
        tint: { value: src.color?.clone() ?? new THREE.Color(1, 1, 1) },
        leafy: { value: leafy ? 1 : 0 },
        normalPass: { value: 0 },
      },
      vertexShader: BAKE_VERT,
      fragmentShader: BAKE_FRAG,
      side: THREE.DoubleSide,
    });
    m.material = mat;
    bakeMats.push(mat);
  });
  const mk = () => new THREE.WebGLRenderTarget(cellW * FRAMES, cellH, {
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, depthBuffer: true,
  });
  const colorRT = mk();
  const normalRT = mk();
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 0.1, radius * 4 + 10);
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevTone = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 0);
  const shadowAuto = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
  for (const [rt, pass] of [[colorRT, 0], [normalRT, 1]] as const) {
    for (const bm of bakeMats) bm.uniforms['normalPass']!.value = pass;
    renderer.setRenderTarget(rt);
    renderer.clear();
    for (let f = 0; f < FRAMES; f++) {
      const a = (f / FRAMES) * Math.PI * 2;
      cam.position.set(Math.sin(a) * (radius * 2 + 5), bottom + h / 2, Math.cos(a) * (radius * 2 + 5));
      cam.lookAt(0, bottom + h / 2, 0);
      cam.updateMatrixWorld();
      rt.viewport.set(f * cellW, 0, cellW, cellH);
      rt.scissor.set(f * cellW, 0, cellW, cellH);
      rt.scissorTest = true;
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
    }
    rt.scissorTest = false;
    rt.viewport.set(0, 0, cellW * FRAMES, cellH);
    rt.scissor.set(0, 0, cellW * FRAMES, cellH);
  }
  renderer.shadowMap.autoUpdate = shadowAuto;
  renderer.toneMapping = prevTone;
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.setRenderTarget(prevTarget);
  for (const bm of bakeMats) bm.dispose();

  const geometry = new THREE.PlaneGeometry(w, h);
  geometry.translate(0, bottom + h / 2, 0);
  const material = impostorMaterial(colorRT.texture, normalRT.texture);
  return { color: colorRT.texture, normal: normalRT.texture, geometry, material };
}

let white: THREE.Texture | null = null;
function whiteTex() {
  if (!white) {
    white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    white.needsUpdate = true;
  }
  return white;
}

const IMP_VERT = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv0;
  varying vec2 vUv1;
  varying float vBlend;
  varying float vYaw;
  varying vec3 vWorld;
  void main() {
    vec3 origin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 ax = (modelMatrix * instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz;
    float scale = length(ax);
    float yaw = atan(-ax.z, ax.x);
    vec2 toCam = cameraPosition.xz - origin.xz;
    float len = max(length(toCam), 1e-3);
    toCam /= len;
    // Um die Hochachse zur Kamera drehen
    vec3 right = vec3(toCam.y, 0.0, -toCam.x);
    vec3 wp = origin + right * position.x * scale + vec3(0.0, position.y * scale, 0.0);
    // Blickrichtung im Baumraum → Bild aus dem Atlas
    float phi = atan(toCam.x, toCam.y) - yaw;
    float f = fract(phi / 6.2831853) * ${FRAMES}.0;
    float f0 = floor(f);
    vBlend = f - f0;
    float f1 = mod(f0 + 1.0, ${FRAMES}.0);
    vUv0 = vec2((f0 + uv.x) / ${FRAMES}.0, uv.y);
    vUv1 = vec2((f1 + uv.x) / ${FRAMES}.0, uv.y);
    vYaw = yaw;
    vWorld = wp;
    vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
    #include <fog_vertex>
  }
`;

const IMP_FRAG = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D tColor;
  uniform sampler2D tNormal;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform vec3 uGroundColor;
  uniform float uAmbient;
  varying vec2 vUv0;
  varying vec2 vUv1;
  varying float vBlend;
  varying float vYaw;
  varying vec3 vWorld;
  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  void main() {
    #include <logdepthbuf_fragment>
    vec4 c0 = texture2D(tColor, vUv0);
    vec4 c1 = texture2D(tColor, vUv1);
    // Überblenden per Rauschmuster (kein doppeltes Bild durch halbtransparente Mischung)
    bool second = ign(gl_FragCoord.xy) < vBlend;
    vec4 c = second ? c1 : c0;
    vec4 nn = second ? texture2D(tNormal, vUv1) : texture2D(tNormal, vUv0);
    if (c.a < 0.5) discard;
    // Mipmaps mitteln mit durchsichtigem Schwarz → Deckung herausrechnen
    vec3 albedo = c.rgb / c.a;
    vec3 nl = normalize(nn.rgb / max(nn.a, 1e-3) * 2.0 - 1.0);
    float cs = cos(vYaw), sn = sin(vYaw);
    vec3 n = normalize(vec3(nl.x * cs + nl.z * sn, nl.y, -nl.x * sn + nl.z * cs));
    float ndl = max(dot(n, uSunDir), 0.0);
    // Wie MeshStandardMaterial (Lambert): Sonne teils durch die Krone gefiltert, Himmelslicht
    vec3 hemi = mix(uGroundColor, uSkyColor, n.y * 0.5 + 0.5);
    vec3 col = albedo * (uSunColor * (ndl * 0.8 + 0.08) + hemi * uAmbient) * RECIPROCAL_PI;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

function impostorMaterial(color: THREE.Texture, normal: THREE.Texture) {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { tColor: { value: null }, tNormal: { value: null } }]),
    vertexShader: IMP_VERT,
    fragmentShader: IMP_FRAG,
    fog: true,
  });
  // Texturen erst nach dem Zusammenführen setzen (merge würde sie kopieren)
  m.uniforms['tColor']!.value = color;
  m.uniforms['tNormal']!.value = normal;
  // Licht teilen: dieselben Objekte → Änderungen gelten sofort für alle Impostor
  Object.assign(m.uniforms, impostorUniforms);
  return m;
}
