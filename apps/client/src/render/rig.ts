// Humanoides Rig mit prozeduraler Animation.
// Teile (Kopf, Torso, Gliedmaßen, Haare …) kommen aus dem Blender-Modell „humanoid“,
// sonst aus einfachen Ersatzformen. Posen werden mit Überblendung gemischt;
// die Schrittphase folgt der zurückgelegten Strecke (kein Fußrutschen), und
// die Füße passen sich dem Gelände an.

import * as THREE from 'three';
import { HAIR_COLORS, SKIN_COLORS, EYE_COLORS, ITEMS, type Appearance } from '@pz/shared';
import { getModel, hasModel, namedMaterial } from './models.ts';
import { TEX } from './textures.ts';
import { buildSkinnedParts, hasCharacterModel, headPiece, type SkinPart } from './skinned.ts';
import { buildHuman, eyeMaterial, hairCapMaterial, hairMaterial, hasHumanModel, humanJoints, humanLandmarks, morphMeshes, skinMaterial, type Sex } from './human.ts';
import { addWetness } from './wetness.ts';

export type JointName =
  | 'hips' | 'spine' | 'chest' | 'neck' | 'head'
  | 'shoulderL' | 'upperArmL' | 'foreArmL' | 'handL'
  | 'shoulderR' | 'upperArmR' | 'foreArmR' | 'handR'
  | 'thighL' | 'shinL' | 'footL' | 'thighR' | 'shinR' | 'footR';

const JOINTS: JointName[] = ['hips', 'spine', 'chest', 'neck', 'head', 'shoulderL', 'upperArmL', 'foreArmL', 'handL', 'shoulderR', 'upperArmR', 'foreArmR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];

type Pose = Partial<Record<JointName, [number, number, number]>> & { root?: [number, number, number]; rootRot?: [number, number, number] };

export const OUTFITS: Record<string, { body: number; legs: number; accent: number; robe?: boolean; metal?: boolean; hood?: boolean; plate?: boolean }> = {
  armor_rags: { body: 0x6a6456, legs: 0x3f3a33, accent: 0x5a4a3a },
  armor_gambeson: { body: 0x8c7a5a, legs: 0x4a4034, accent: 0x5c3f28 },
  armor_leather: { body: 0x5a3f2a, legs: 0x3a2c20, accent: 0x2c4a2a, hood: true },
  armor_chain: { body: 0x8a8e94, legs: 0x3e3a36, accent: 0x6a2a24, metal: true },
  armor_robe: { body: 0x2d4468, legs: 0x22324c, accent: 0xc9a14a, robe: true },
  armor_scale: { body: 0x4f8a94, legs: 0x2e3a40, accent: 0x9ff8ff, metal: true, plate: true },
  armor_rooted: { body: 0x3e4a2a, legs: 0x2e3620, accent: 0x6a8a3a, hood: true },
  armor_order: { body: 0xd8d2c2, legs: 0x6a6258, accent: 0xc9a14a, metal: true, plate: true },
  // NSC-Kleidung
  guard: { body: 0x6a2a24, legs: 0x3a3430, accent: 0x9a9ea5, metal: true, plate: true },
  noble: { body: 0x3c2a4a, legs: 0x2a2230, accent: 0xc9a14a },
  priest: { body: 0xd8d2c2, legs: 0xb8b0a0, accent: 0xc9a14a, robe: true },
  merchant: { body: 0x7a5a2a, legs: 0x4a3a26, accent: 0x2a5a4a },
  villager: { body: 0x7a6a50, legs: 0x4a4034, accent: 0x6a4a30 },
  peasant: { body: 0x6e5c42, legs: 0x3e362c, accent: 0x5a4028 },
  maid: { body: 0x8a7e6a, legs: 0x4e3a2e, accent: 0x7a2e28 },
  woodsman: { body: 0x4a5236, legs: 0x3a3228, accent: 0x5c3f28, hood: true },
  smith: { body: 0x4a3a2a, legs: 0x3a3028, accent: 0x2a2a2a },
  fisher: { body: 0x3a4a5a, legs: 0x3a3a3a, accent: 0xd8c27a, hood: true },
  child: { body: 0x9a6a5a, legs: 0x5a4a3a, accent: 0xd8c27a },
  rooted: { body: 0x3e4a2a, legs: 0x2e3620, accent: 0x7ff6ff, robe: true, hood: true },
  miner: { body: 0x5a4a3a, legs: 0x3a3228, accent: 0xd9a441 },
  scholar: { body: 0x3a5a6a, legs: 0x2e3a40, accent: 0xc9a14a },
  bandit: { body: 0x4a3a2a, legs: 0x2a2620, accent: 0x6a2a24, hood: true },
  echo: { body: 0x1a2030, legs: 0x141824, accent: 0x7ff6ff },
  boss: { body: 0x3a4a5a, legs: 0x2a3440, accent: 0x7ff6ff, metal: true, plate: true },
};

/**
 * Kleidung der realistischen Figur: Stoff mit Schimmer (Sheen) und feiner Webung, Leder mit leichtem
 * Glanz, Kettenhemd und Plattenstahl. Texturen wiederholt (sonst liegt eine Kachel über dem ganzen
 * Körper und die Webung verschwimmt), dazu großflächige Abnutzung und Flecken.
 */
export function garment(kind: 'cloth' | 'leather' | 'chain' | 'plate', color: number) {
  const t = kind === 'leather' ? TEX.leather() : kind === 'chain' ? TEX.chain() : kind === 'plate' ? TEX.plate() : TEX.cloth();
  const rep = kind === 'cloth' ? 22 : kind === 'leather' ? 4 : kind === 'chain' ? 90 : 2;
  const c = (x?: THREE.Texture | null) => {
    if (!x) return null;
    const y = x.clone();
    y.wrapS = y.wrapT = THREE.RepeatWrapping;
    y.repeat.set(rep, rep);
    y.needsUpdate = true;
    return y;
  };
  const metal = kind === 'chain' || kind === 'plate';
  const m = new THREE.MeshPhysicalMaterial({
    color: metal ? new THREE.Color(color).lerp(new THREE.Color(0xd6d9de), 0.75) : color,
    map: c(t.map), normalMap: c(t.normalMap), roughnessMap: c(t.roughnessMap),
    roughness: 1, metalness: metal ? 1 : 0,
  });
  if (kind === 'cloth') {
    // Weicher Stoffglanz; Normalen schwächer (feine Webung glitzert sonst an Ärmeln und Kanten)
    m.sheen = 0.7;
    m.sheenRoughness = 0.8;
    m.sheenColor = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.25);
    m.normalScale.set(0.35, 0.35);
  } else if (kind === 'leather') {
    m.clearcoat = 0.18;
    m.clearcoatRoughness = 0.55;
    m.normalScale.set(0.8, 0.8);
  }
  // Schmutz und Blut (je Figur, 0–1) mit Gewichtung je Kleidungsteil (x = Schmutz, y = Blut)
  const u = {
    uRep: { value: rep }, uWear: { value: kind === 'plate' ? 0.35 : kind === 'chain' ? 0.25 : 1 },
    uDirt: { value: 0 }, uBlood: { value: 0 }, uGW: { value: new THREE.Vector2(1, 1) },
    // Nachschwingen unterhalb der Hüfte (Saum, Rock, Robe); nur beim Rumpfstoff gesetzt
    uCloth: { value: new THREE.Vector3() }, uHipY: { value: 1.0 },
  };
  m.userData['grime'] = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    // Ruhelage-Position (Meter, Füße bei y = 0) für Schmutz/Blut – unabhängig von den Kleidungs-UVs
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGPos;\nuniform vec3 uCloth;\nuniform float uHipY;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGPos = position;
        float cf = pow(clamp((uHipY - position.y) / 0.55, 0.0, 1.0), 1.4);
        transformed += uCloth * cf;
        transformed.y += length(uCloth) * cf * 0.25;`);
    sh.fragmentShader = 'varying vec3 vGPos;\n' + sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uRep; uniform float uWear; uniform float uDirt; uniform float uBlood; uniform vec2 uGW;
        float gHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float gNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(gHash(i), gHash(i + vec2(1, 0)), f.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        #ifdef USE_MAP
          // Großflächig: ausgeblichene Stellen, Schmutz und Flecken (im ursprünglichen UV-Raum)
          vec2 guv = vMapUv / uRep;
          float gw = gNoise(guv * 7.0) * 0.6 + gNoise(guv * 19.0) * 0.4;
          float stain = smoothstep(0.62, 0.8, gNoise(guv * 13.0 + 3.7));
          diffuseColor.rgb *= mix(1.0, mix(0.82, 1.1, gw), uWear);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.62, 0.56, 0.48), stain * 0.45 * uWear);
        #endif
        float gDirt = 0.0, gBlood = 0.0;
        {
          // Schmutz: wolkige Flecken, von unten (Stiefel, Hosenbeine, Saum) nach oben
          vec3 gp = vGPos;
          float dA = clamp(uDirt * uGW.x * (0.35 + 1.1 * smoothstep(1.25, 0.1, gp.y)), 0.0, 1.0);
          float dN = gNoise(gp.xy * 7.0 + gp.z * 3.0) * 0.45 + gNoise(gp.zy * 19.0 + 5.0) * 0.35 + gNoise(gp.xz * 53.0 + gp.y * 9.0) * 0.2;
          gDirt = smoothstep(0.8 - dA * 0.42, 0.95 - dA * 0.42, dN) * step(0.01, dA);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.1, 0.07), gDirt * (0.38 + dA * 0.3));
          // Blut: scharf begrenzte Spritzer und Tropfen (Rumpf und Arme vorn stärker)
          float bA = clamp(uBlood * uGW.y * (0.6 + 0.6 * smoothstep(0.6, 1.3, gp.y)), 0.0, 1.0);
          float bN = gNoise(gp.xy * 23.0 + gp.z * 7.0) * 0.5 + gNoise(gp.zy * 61.0 + 13.0) * 0.3 + gNoise(gp.xy * 140.0) * 0.2;
          gBlood = smoothstep(0.8 - bA * 0.26, 0.83 - bA * 0.26, bN) * step(0.01, bA);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.008, 0.006), gBlood * 0.92);
        }`);
    if (kind === 'cloth') {
      // Webmuster nur andeuten: Kontrast zur Durchschnittsfarbe (grobe Mip-Stufe) stark verringern,
      // sonst wirkt der Stoff aus der Nähe wie Karopapier
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D(map, vMapUv);
          vec3 clothAvg = texture2D(map, vMapUv, 7.0).rgb;
          sampledDiffuseColor.rgb = mix(clothAvg, sampledDiffuseColor.rgb, 0.4);
          diffuseColor *= sampledDiffuseColor;
        #endif`);
    }
    if (kind === 'chain') {
      // Kettenhemd: in den Lücken zwischen den Ringen liegt der dunkle Gambeson (Stoff, kein Metall)
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>
          #ifdef USE_MAP
            float ring = smoothstep(0.08, 0.3, dot(texture2D(map, vMapUv).rgb, vec3(0.333)));
          #else
            float ring = 1.0;
          #endif
          diffuseColor.rgb = mix(vec3(0.075, 0.065, 0.055), diffuseColor.rgb, ring);`)
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n          metalnessFactor *= ring;')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n          roughnessFactor = mix(0.9, roughnessFactor, ring);');
    }
  };
  m.onBeforeCompile = ((prev) => (sh: THREE.WebGLProgramParametersWithUniforms, r: THREE.WebGLRenderer) => {
    prev.call(m, sh, r);
    // Schmutz macht stumpf, Blut glänzt feucht
    sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 1.0, gDirt * 0.6);
      roughnessFactor = mix(roughnessFactor, 0.55, gBlood * 0.5);`);
    // Stoff saugt sich im Regen voll (dunkler), Leder und Metall glänzen nass
    addWetness(sh, { strength: kind === 'cloth' ? 0.9 : 0.7 });
  })(m.onBeforeCompile);
  m.customProgramCacheKey = () => `garment-${kind}`;
  return m;
}

function mat(color: number, opts: THREE.MeshStandardMaterialParameters = {}, kind: 'cloth' | 'leather' | 'metal' = 'cloth') {
  const t = kind === 'leather' ? TEX.leather() : kind === 'metal' ? TEX.metal() : TEX.cloth();
  const ao = t.aoMap ? { aoMap: t.aoMap } : {};
  return new THREE.MeshStandardMaterial({ color, map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, ...ao, roughness: 0.85, ...opts });
}

export interface RigOptions {
  appearance?: Partial<Appearance>;
  /** Saat für die Gesichtsform (z. B. NSC-Kennung); ohne: aus dem Aussehen abgeleitet */
  faceSeed?: string;
  outfit?: string;
  echo?: boolean;
  scale?: number;
}

export class HumanoidRig {
  root = new THREE.Group();
  body = new THREE.Group();
  j = {} as Record<JointName, THREE.Object3D>;
  private rest = {} as Record<JointName, THREE.Euler>;
  private cur = {} as Record<JointName, THREE.Quaternion>;
  private from = {} as Record<JointName, THREE.Quaternion>;
  private rootOff = new THREE.Vector3();
  private rootRot = new THREE.Euler();
  anim = 'idle';
  private prevAnim = 'idle';
  animT = 0;
  blend = 1;
  private blendDur = 0.18;
  phase = 0;
  /** Schrittzyklus 0–1 (linker Fuß setzt bei 0 auf, rechter bei 0,5) */
  private cyc = 0;
  /** Zähler der Fußaufsätze (für Schrittgeräusche) */
  footfalls = 0;
  private legLen: [number, number] | null = null;
  speed = 0;
  weapon: THREE.Object3D | null = null;
  offhand: THREE.Object3D | null = null;
  weaponId = '';
  offhandId = '';
  armorId = '';
  skinMat: THREE.MeshStandardMaterial;
  bodyMat: THREE.MeshStandardMaterial;
  legMat: THREE.MeshStandardMaterial;
  accentMat: THREE.MeshStandardMaterial;
  /** Rüstung der realistischen Figur */
  chainMat: THREE.MeshStandardMaterial | null = null;
  plateMat: THREE.MeshStandardMaterial | null = null;
  hoodMat: THREE.MeshStandardMaterial | null = null;
  hairMat: THREE.MeshStandardMaterial;
  /** Durchgehende, gebundene Figur aus dem Blender-Modell „character“ (sonst Einzelteile). */
  private useSkin = hasCharacterModel();
  /** Realistische Figur (tools/blender/human.py) – hat Vorrang vor „character“. */
  private human = false;
  private sex: Sex = 'male';
  private humanParts = new Map<string, THREE.Group>();
  private humanPartsLod1 = new Map<string, THREE.Group>();
  private humanWant = new Map<string, boolean>();
  private lodLevel: 0 | 1 = 0;
  private humanHair: THREE.MeshStandardMaterial[] = [];
  private humanCap: THREE.MeshStandardMaterial | null = null;
  private outfitCur: (typeof OUTFITS)[string] | null = null;
  private pieces = new Map<SkinPart, THREE.Group>();
  private eyeMat = new THREE.MeshStandardMaterial({ color: 0x4b3621, roughness: 0.25 });
  private hairNode = new THREE.Group();
  private beardNode = new THREE.Group();
  private robeNode = new THREE.Group();
  private hoodNode = new THREE.Group();
  private veins: THREE.MeshStandardMaterial[] = [];
  actionDur = 0.6;
  height = 1.8;
  footOffL = 0;
  footOffR = 0;
  hipsDrop = 0;
  appearance: Appearance;
  touch = 0;
  private flinch = 0;
  // ---- Lebendigkeit: Mimik, Blinzeln, Sprechen, Blick, Atmung ----
  private morphs: THREE.Mesh[] = [];
  private face: Record<string, number> = {};
  private blinkT = 1 + Math.random() * 3;
  private blinkK = 0;
  private lifeT = Math.random() * 100;
  private lastBr = 0;
  /** Einmal-Merker: Figur hat gerade ausgeatmet (EntityManager holt ihn ab) */
  exhaled = false;
  /** > 0: Figur spricht (Sekunden), Kiefer und Lippen bewegen sich */
  talking = 0;
  /** Stimmung für die Mimik: -1 (grimmig) … 0 … 1 (freundlich) */
  mood = 0;
  /** Blickziel in Weltkoordinaten (Kopf dreht sich hin), null = geradeaus */
  lookAt: THREE.Vector3 | null = null;
  private lookYaw = 0;
  private lookPitch = 0;
  private faceSeed = '';

  constructor(opts: RigOptions = {}) {
    const a: Appearance = { body: 0.5, height: 1, skin: 1, hair: 0, hairColor: 2, beard: 0, eyes: 0, scar: 0, ...opts.appearance };
    this.appearance = a;
    this.faceSeed = opts.faceSeed ?? JSON.stringify(a);
    const echo = !!opts.echo;
    this.sex = a.sex === 1 ? 'female' : 'male';
    this.human = hasHumanModel(this.sex);
    if (this.human) this.useSkin = true;
    this.skinMat = this.human
      ? skinMaterial(this.sex, new THREE.Color(SKIN_COLORS[a.skin] ?? SKIN_COLORS[1]!), new THREE.Color(HAIR_COLORS[a.hairColor] ?? '#3b2718'), a.hairColor === 5 || a.hairColor === 7, humanLandmarks(this.sex, JOINTS))
      : new THREE.MeshStandardMaterial({ color: new THREE.Color(SKIN_COLORS[a.skin] ?? SKIN_COLORS[1]), roughness: 0.6, map: TEX.skin().map });
    if (this.human && a.hair === 3) (this.skinMat.userData['scalp'] as { value: number }).value = 0; // Glatze
    const outfit = OUTFITS[opts.outfit ?? 'armor_gambeson'] ?? OUTFITS['armor_gambeson']!;
    if (this.human) {
      this.bodyMat = garment('cloth', outfit.body);
      this.legMat = garment('cloth', outfit.legs);
      this.accentMat = garment('leather', outfit.accent);
      this.chainMat = garment('chain', outfit.body);
      this.plateMat = garment('plate', outfit.body);
      this.hoodMat = garment('cloth', outfit.accent);
      const w = (m: THREE.Material, d: number, b: number) => (m.userData['grime'] as { uGW: { value: THREE.Vector2 } }).uGW.value.set(d, b);
      w(this.bodyMat, 0.7, 1); w(this.legMat, 1.1, 0.6); w(this.accentMat, 0.8, 0.5);
      w(this.chainMat, 0.5, 0.8); w(this.plateMat, 0.45, 0.9); w(this.hoodMat, 0.4, 0.35);
    } else {
      this.bodyMat = mat(outfit.body, outfit.metal ? { metalness: 0.7, roughness: 0.55 } : {}, outfit.metal ? 'metal' : 'cloth');
      this.legMat = mat(outfit.legs);
      this.accentMat = mat(outfit.accent, { roughness: 0.75 }, 'leather');
    }
    this.hairMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(HAIR_COLORS[a.hairColor] ?? '#3b2718'), roughness: 0.75 });
    if (echo) {
      for (const m of [this.skinMat, this.bodyMat, this.legMat, this.accentMat, this.hairMat]) {
        m.color.setHex(0x0c1220);
        m.emissive = new THREE.Color(0x2a6a80);
        m.emissiveIntensity = 0.6;
        m.transparent = true;
        m.opacity = 0.8;
        m.map = null;
      }
    }
    this.build(a, outfit);
    // Posen sind im Rig-Raum mit Blickrichtung +Z definiert; die Figur blickt in der Welt nach -Z.
    const flip = new THREE.Group();
    flip.rotation.y = Math.PI;
    flip.add(this.body);
    this.root.add(flip);
    this.root.scale.setScalar((opts.scale ?? 1) * a.height);
    if (this.useSkin) this.bindSkin(outfit);
    this.setAppearance(a);
    for (const n of JOINTS) {
      this.cur[n] = this.j[n].quaternion.clone();
      this.from[n] = this.j[n].quaternion.clone();
    }
  }

  private bw = 1;

  private joint(name: JointName, parent: THREE.Object3D, x: number, y: number, z: number) {
    const o = new THREE.Group();
    o.name = name;
    o.position.set(x, y, z);
    parent.add(o);
    this.j[name] = o;
    this.rest[name] = new THREE.Euler();
    return o;
  }

  private part(parent: THREE.Object3D, name: string, fallback: () => THREE.Mesh, m: THREE.Material) {
    if (this.useSkin) return new THREE.Group();
    const tpl = hasModel('humanoid') ? getModel('humanoid').parts.get(name) : undefined;
    let mesh: THREE.Object3D;
    if (tpl) {
      mesh = tpl.clone(true);
      mesh.position.set(0, 0, 0);
      // Körperbau: Blender-Teile sind für Breite 1 modelliert
      if (!/^(head|neckmesh|hand_)/.test(name)) mesh.scale.set(this.bw, 1, this.bw);
      mesh.traverse((c) => {
        const mm = c as THREE.Mesh;
        if (mm.isMesh) {
          const n = (Array.isArray(mm.material) ? mm.material[0] : mm.material)?.name ?? '';
          mm.material = n.startsWith('skin') ? this.skinMat : n.startsWith('legs') ? this.legMat : n.startsWith('accent') ? this.accentMat : n.startsWith('hair') ? this.hairMat : n.startsWith('eye') ? mm.material : m;
          mm.castShadow = true;
        }
      });
    } else {
      mesh = fallback();
      (mesh as THREE.Mesh).material = m;
      mesh.castShadow = true;
    }
    parent.add(mesh);
    return mesh;
  }

  private build(a: Appearance, outfit: (typeof OUTFITS)[string]) {
    const bw = 0.85 + a.body * 0.3; // Körperbreite
    this.bw = bw;
    const cap = (r: number, l: number) => new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 4, 10));
    const hips = this.joint('hips', this.body, 0, 0.95, 0);
    this.part(hips, 'pelvis', () => { const m = cap(0.16 * bw, 0.12); m.rotation.z = Math.PI / 2; m.scale.set(1, 1, 0.8); return m; }, this.legMat);
    const spine = this.joint('spine', hips, 0, 0.1, 0);
    this.part(spine, 'belly', () => { const m = cap(0.15 * bw, 0.12); m.position.y = 0.1; m.scale.z = 0.75; return m; }, this.bodyMat);
    const chest = this.joint('chest', spine, 0, 0.22, 0);
    this.part(chest, 'torso', () => { const m = cap(0.19 * bw, 0.18); m.position.y = 0.14; m.scale.set(1.05, 1, 0.7); return m; }, this.bodyMat);
    // Gürtel
    this.part(spine, 'belt', () => { const m = new THREE.Mesh(new THREE.TorusGeometry(0.155 * bw, 0.025, 6, 16)); m.rotation.x = Math.PI / 2; m.scale.z = 0.75; return m; }, this.accentMat);
    const neck = this.joint('neck', chest, 0, 0.36, 0);
    this.part(neck, 'neckmesh', () => { const m = cap(0.055, 0.06); m.position.y = 0.04; return m; }, this.skinMat);
    const head = this.joint('head', neck, 0, 0.1, 0);
    this.part(head, 'head', () => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 14)); m.position.y = 0.1; m.scale.set(0.92, 1.1, 1); return m; }, this.skinMat);
    // Augen
    const eyeMat = this.eyeMat;
    eyeMat.color.set(EYE_COLORS[a.eyes] ?? '#4b3621');
    for (const sx of this.useSkin ? [] : [-0.04, 0.04]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), eyeMat);
      e.position.set(sx, 0.12, 0.1);
      head.add(e);
    }
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.05, 6), this.skinMat);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0.09, 0.115);
    if (!this.useSkin) head.add(nose);
    head.add(this.hairNode, this.beardNode, this.hoodNode);
    for (const side of ['L', 'R'] as const) {
      const s = side === 'L' ? 1 : -1;
      const sh = this.joint(`shoulder${side}`, chest, s * 0.21 * bw, 0.3, 0);
      this.part(sh, `shoulderpad_${side.toLowerCase()}`, () => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.075 * bw, 10, 8)); m.scale.set(1.1, 0.8, 1); return m; }, outfit.metal ? this.bodyMat : this.accentMat);
      const ua = this.joint(`upperArm${side}`, sh, s * 0.02, -0.02, 0);
      this.part(ua, `upperarm_${side.toLowerCase()}`, () => { const m = cap(0.05 * bw, 0.2); m.position.y = -0.14; return m; }, this.bodyMat);
      const fa = this.joint(`foreArm${side}`, ua, 0, -0.29, 0);
      this.part(fa, `forearm_${side.toLowerCase()}`, () => { const m = cap(0.043 * bw, 0.18); m.position.y = -0.12; return m; }, outfit.robe ? this.bodyMat : this.skinMat);
      const hand = this.joint(`hand${side}`, fa, 0, -0.26, 0);
      this.part(hand, `hand_${side.toLowerCase()}`, () => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.04)); m.position.y = -0.03; return m; }, this.skinMat);
      const th = this.joint(`thigh${side}`, hips, s * 0.1 * bw, -0.05, 0);
      this.part(th, `thigh_${side.toLowerCase()}`, () => { const m = cap(0.075 * bw, 0.28); m.position.y = -0.2; return m; }, this.legMat);
      const sn = this.joint(`shin${side}`, th, 0, -0.43, 0);
      this.part(sn, `shin_${side.toLowerCase()}`, () => { const m = cap(0.058 * bw, 0.28); m.position.y = -0.2; return m; }, this.legMat);
      const ft = this.joint(`foot${side}`, sn, 0, -0.42, 0);
      this.part(ft, `foot_${side.toLowerCase()}`, () => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.24)); m.position.set(0, -0.03, 0.05); return m; }, this.accentMat);
    }
    // Robe/Rock
    const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * bw, 0.32 * bw, 0.75, 14, 1, true), this.bodyMat);
    robe.position.y = -0.33;
    robe.castShadow = true;
    if (!this.useSkin) this.robeNode.add(robe);
    hips.add(this.robeNode);
    this.robeNode.visible = !!outfit.robe;
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), this.accentMat);
    hood.position.set(0, 0.11, -0.015);
    hood.scale.set(1, 1.1, 1.08);
    if (!this.useSkin) this.hoodNode.add(hood);
    this.hoodNode.visible = !!outfit.hood;
    if (this.human) this.placeHumanJoints(bw);
    // Adern der Berührung (leuchtend, abhängig vom Berührungswert)
    const veinMat = new THREE.MeshStandardMaterial({ color: 0x9ff8ff, emissive: 0x7ff6ff, emissiveIntensity: 0, transparent: true, opacity: 0 });
    this.veins.push(veinMat);
    for (const n of ['foreArmL', 'foreArmR', 'neck'] as JointName[]) {
      const v = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.2, 8, 1, true), veinMat);
      v.position.y = n === 'neck' ? 0.04 : -0.12;
      this.j[n].add(v);
    }
  }

  /** Gelenke auf die Ruhepositionen der realistischen Figur setzen (Körperbau berücksichtigt). */
  private placeHumanJoints(bw: number) {
    const J = humanJoints(this.sex, JOINTS);
    const neckY = J.get('neck')?.y ?? 1.5;
    this.hipY = J.get('hips')?.y ?? 0.95;
    const world = (n: string) => {
      const p = J.get(n)!.clone();
      if (p.y < neckY - 0.02) { p.x *= this.humanBw(bw); p.z *= 0.9 + this.humanBw(bw) * 0.1; }
      return p;
    };
    for (const n of JOINTS) {
      if (!J.has(n)) continue;
      const parent = this.j[n].parent as THREE.Object3D;
      const pw = parent === this.body || !J.has(parent.name) ? new THREE.Vector3() : world(parent.name);
      this.j[n].position.copy(world(n)).sub(pw);
    }
  }

  /** Körperbau der realistischen Figur: nur leicht variieren (Proportionen stammen aus dem Modell). */
  private humanBw(bw: number) {
    return 1 + (bw - 1) * 0.45;
  }

  /** Bindet die durchgehende Figur an die Gelenke (Ruhepose). */
  private bindSkin(outfit: (typeof OUTFITS)[string]) {
    if (this.human) {
      const a = this.appearance;
      const hc = new THREE.Color(HAIR_COLORS[a.hairColor] ?? '#3b2718');
      const hair = hairMaterial(hc, false);
      const curly = hairMaterial(hc, true);
      this.humanHair = [hair, curly];
      this.humanCap = hairCapMaterial(hc.clone().multiplyScalar(0.8), humanJoints(this.sex, JOINTS).get('head') ?? new THREE.Vector3(0, 1.65, 0));
      const eye = eyeMaterial(new THREE.Color(EYE_COLORS[a.eyes] ?? '#4b3621'));
      this.eyeMat = eye;
      const cloth = (n: string): THREE.Material => n.startsWith('legs') ? this.legMat : n.startsWith('accent') ? this.accentMat : this.bodyMat;
      const hm = { skin: this.skinMat, eye, hair, hairCurly: curly, hairCap: this.humanCap, cloth };
      this.humanParts = buildHuman(this.sex, this.j, JOINTS, this.body, this.humanBw(0.85 + a.body * 0.3), hm);
      this.humanPartsLod1 = buildHuman(this.sex, this.j, JOINTS, this.body, this.humanBw(0.85 + a.body * 0.3), hm, 1);
      this.morphs = morphMeshes(this.humanParts);
      this.makeFace();
      this.applyOutfitPieces(outfit);
      return;
    }
    const white = new THREE.MeshStandardMaterial({ color: 0xece6dc, roughness: 0.3 });
    const black = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.2 });
    const matFor = (n: string): THREE.Material => {
      const k = n.toLowerCase();
      if (k.startsWith('skin')) return this.skinMat;
      if (k.startsWith('legs')) return this.legMat;
      if (k.startsWith('accent')) return this.accentMat;
      if (k.startsWith('hair')) return this.hairMat;
      if (k.startsWith('iris')) return this.eyeMat;
      if (k.startsWith('eyewhite')) return white;
      if (k === 'eye' || k.startsWith('eye.')) return black;
      if (k.startsWith('metal')) return namedMaterial('metal');
      return this.bodyMat;
    };
    const bw = 0.85 + this.appearance.body * 0.3;
    const { parts } = buildSkinnedParts(this.j, JOINTS, this.body, bw, matFor);
    this.pieces = parts;
    this.applyOutfitPieces(outfit);
  }

  private applyOutfitPieces(o: (typeof OUTFITS)[string]) {
    this.outfitCur = o;
    if (this.human) {
      const a = this.appearance;
      const want = this.humanWant;
      want.clear();
      const vis = (n: string, v: boolean) => { want.set(n, v); };
      for (const n of ['skin', 'eyes', 'lashes', 'mouth', 'mouth_cavity', 'tunic', 'trousers', 'boots']) vis(n, true);
      vis('tunic_skirt', !o.robe);
      vis('belt', !o.robe);
      vis('robe', !!o.robe);
      vis('hood', !!o.hood);
      vis('hood_cowl', !!o.hood);
      vis('plates', !!o.plate);
      vis('pauldrons', !!o.plate);
      if (!o.hood) { vis(`hair_${a.hair}`, true); vis(`hair_${a.hair}_cap`, true); }
      if (this.sex === 'male' && a.beard) vis(`beard_${a.beard}`, true);
      // Rüstung: Kettenhemd statt Hemd, Brust- und Schulterplatten aus Stahl
      const setMat = (piece: string, m: THREE.Material | null) => {
        if (!m) return;
        for (const map of [this.humanParts, this.humanPartsLod1]) map.get(piece)?.traverse((x) => { const me = x as THREE.Mesh; if (me.isMesh) me.material = m; });
      };
      setMat('tunic', o.metal ? this.chainMat : this.bodyMat);
      setMat('hood', this.hoodMat);
      setMat('hood_cowl', this.hoodMat);
      setMat('plates', this.plateMat);
      setMat('pauldrons', this.plateMat);
      this.applyLod();
      return;
    }
    if (!this.useSkin) return;
    const show = (n: SkinPart, v: boolean) => { const p = this.pieces.get(n); if (p) p.visible = v; };
    show('skin', true);
    show('tunic', true);
    show('trousers', true);
    show('boots', true);
    show('belt', !o.robe);
    show('robe', !!o.robe);
    show('hood', !!o.hood);
    show('plates', !!o.metal);
    // Unter der Kapuze keine langen Haare
    this.hairNode.visible = !o.hood;
  }

  /** Schmutz und Blut auf der Kleidung (Snapshot-Code: Schmutz obere 4 Bit, Blut untere 4 Bit). */
  setGrime(code: number) {
    if (code === this.grimeCode) return;
    this.grimeCode = code;
    const dirt = (code >> 4) / 15, blood = (code & 15) / 15;
    for (const m of [this.bodyMat, this.legMat, this.accentMat, this.chainMat, this.plateMat, this.hoodMat]) {
      const g = m?.userData['grime'] as { uDirt: { value: number }; uBlood: { value: number } } | undefined;
      if (g) { g.uDirt.value = dirt; g.uBlood.value = blood; }
    }
  }
  private grimeCode = 0;
  // Nachschwingen (Haare, Kleidung): gedämpfte Federn im Körperraum
  private hipY = 0.95;
  private swPrev: THREE.Vector3 | null = null;
  private swPrevYaw = 0;
  private turnRate = 0;
  private turnStep = 0;
  private swX = new THREE.Vector3();
  private swV = new THREE.Vector3();
  private clX = new THREE.Vector3();
  private clV = new THREE.Vector3();

  private updateSwing(dt: number) {
    if (dt <= 0 || dt > 0.2) return;
    const p = this.root.getWorldPosition(new THREE.Vector3());
    const q = this.root.getWorldQuaternion(new THREE.Quaternion());
    const yaw = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
    if (!this.swPrev) { this.swPrev = p.clone(); this.swPrevYaw = yaw; return; }
    const vel = p.clone().sub(this.swPrev).divideScalar(dt);
    let dyaw = yaw - this.swPrevYaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.swPrev.copy(p); this.swPrevYaw = yaw;
    if (vel.lengthSq() > 400) vel.set(0, 0, 0); // Teleport
    // in den Körperraum drehen: Haare/Saum bleiben hinter der Bewegung zurück
    const local = vel.applyQuaternion(q.clone().invert());
    const turn = dyaw / dt;
    // Drehrate für das Mittreten beim Drehen auf der Stelle (geglättet)
    this.turnRate += (turn - this.turnRate) * Math.min(1, dt * 8);
    const target = new THREE.Vector3(-local.x * 0.012 + turn * 0.02, 0, -local.z * 0.012);
    target.clampLength(0, 0.07);
    // Feder (leicht unterdämpft): pendelt nach dem Anhalten kurz nach
    const k = 55, c = 7;
    this.swV.addScaledVector(target.clone().sub(this.swX).multiplyScalar(k).addScaledVector(this.swV, -c), dt);
    this.swX.addScaledVector(this.swV, dt);
    const ct = target.clone().multiplyScalar(1.5);
    // Saum: Schritte schwingen ihn zusätzlich seitlich
    ct.x += Math.sin(this.phase) * Math.min(1, this.speed / 3) * 0.025;
    this.clV.addScaledVector(ct.sub(this.clX).multiplyScalar(40).addScaledVector(this.clV, -6), dt);
    this.clX.addScaledVector(this.clV, dt);
    for (const m of this.humanHair) (m.userData['swing'] as { value: THREE.Vector3 } | undefined)?.value.copy(this.swX);
    const g = this.bodyMat?.userData['grime'] as { uCloth: { value: THREE.Vector3 }; uHipY: { value: number } } | undefined;
    if (g) { g.uCloth.value.copy(this.clX); g.uHipY.value = this.hipY; }
  }

  /** Detailstufe: 0 = volle Figur, 1 = vereinfacht (Entfernung). */
  setLod(level: 0 | 1) {
    if (!this.human || level === this.lodLevel || this.humanPartsLod1.size === 0) return;
    this.lodLevel = level;
    this.applyLod();
  }

  private applyLod() {
    for (const [n, g] of this.humanParts) g.visible = this.lodLevel === 0 && !!this.humanWant.get(n);
    for (const [n, g] of this.humanPartsLod1) g.visible = this.lodLevel === 1 && !!this.humanWant.get(n);
  }

  setAppearance(a: Appearance) {
    this.appearance = a;
    if (this.human) {
      const hc = new THREE.Color(HAIR_COLORS[a.hairColor] ?? '#3b2718');
      const skin = new THREE.Color(SKIN_COLORS[a.skin] ?? SKIN_COLORS[1]!);
      const fresh = skinMaterial(this.sex, skin, hc, a.hairColor === 5 || a.hairColor === 7);
      this.skinMat.color.copy(fresh.color);
      if ((this.skinMat as THREE.MeshStandardMaterial).normalScale) (this.skinMat as THREE.MeshStandardMaterial).normalScale.copy(fresh.normalScale);
      fresh.dispose();
      (this.skinMat.userData['hairCol'] as { value: THREE.Color } | undefined)?.value.copy(hc);
      const scalp = this.skinMat.userData['scalp'] as { value: number } | undefined;
      if (scalp) scalp.value = a.hair === 3 ? 0 : 1;
      for (const m of this.humanHair) m.color.copy(hc);
      this.humanCap?.color.copy(hc).multiplyScalar(0.8);
      (this.eyeMat.userData['iris'] as { value: THREE.Color } | undefined)?.value.set(EYE_COLORS[a.eyes] ?? '#4b3621');
      if (this.outfitCur) this.applyOutfitPieces(this.outfitCur);
      return;
    }
    this.skinMat.color.set(SKIN_COLORS[a.skin] ?? SKIN_COLORS[1]!);
    this.hairMat.color.set(HAIR_COLORS[a.hairColor] ?? '#3b2718');
    this.hairNode.clear();
    this.beardNode.clear();
    const add = (g: THREE.BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, parent = this.hairNode) => {
      const m = new THREE.Mesh(g, this.hairMat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    this.eyeMat.color.set(EYE_COLORS[a.eyes] ?? '#4b3621');
    if (this.useSkin) {
      // Frisur und Bart aus Strähnen (Blender), starr am Kopfgelenk
      const headY = 1.73;
      const hp = headPiece(`hair_${a.hair}`, headY, this.hairMat);
      if (hp) this.hairNode.add(hp);
      const bp = a.beard ? headPiece(`beard_${a.beard}`, headY, this.hairMat) : null;
      if (bp) this.beardNode.add(bp);
      if (a.scar) {
        const scarMat = new THREE.MeshStandardMaterial({ color: a.scar === 3 ? 0x9ff8ff : 0x8a4a3a, emissive: a.scar === 3 ? 0x3cc9e0 : 0x000000, emissiveIntensity: 1 });
        const sc = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.05, 0.004), scarMat);
        sc.position.set(a.scar === 2 ? 0.045 : -0.06, a.scar === 2 ? 0.125 : 0.085, 0.106);
        sc.rotation.z = 0.3;
        this.beardNode.add(sc);
      }
      return;
    }
    const cap = new THREE.SphereGeometry(0.122, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
    switch (a.hair) {
      case 0: add(cap, 0, 0.115, 0.01, 1, 1, 1.05); break; // Kurz
      case 1: add(cap, 0, 0.115, 0.01, 1, 1, 1.05); add(new THREE.CapsuleGeometry(0.03, 0.25, 4, 8), 0, -0.02, -0.13); break; // Zopf
      case 2: add(cap, 0, 0.115, 0.01, 1.05, 1.05, 1.1); add(new THREE.CylinderGeometry(0.12, 0.14, 0.3, 14, 1, true, Math.PI * 1.15, Math.PI * 1.7), 0, 0.0, -0.02); break; // Lang
      case 3: break; // Kahl
      case 4: add(cap, 0, 0.115, 0.01, 1, 0.95, 1.02); add(new THREE.SphereGeometry(0.05, 10, 8), 0, 0.22, -0.07); break; // Knoten
      case 5: for (let i = 0; i < 9; i++) add(new THREE.ConeGeometry(0.045, 0.12, 5), Math.cos(i * 0.7) * 0.08, 0.2 + (i % 3) * 0.015, Math.sin(i * 0.7) * 0.08).rotation.set(Math.sin(i) * 0.6, i, Math.cos(i) * 0.6); break; // Wirr
    }
    switch (a.beard) {
      case 1: add(new THREE.SphereGeometry(0.1, 12, 8, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.3), 0, 0.1, 0.005, 1, 1, 1.02, this.beardNode); break;
      case 2: add(new THREE.SphereGeometry(0.105, 12, 10, Math.PI * 0.1, Math.PI * 0.8, Math.PI * 0.45, Math.PI * 0.5), 0, 0.08, 0.0, 1, 1.25, 1.08, this.beardNode); break;
      case 3: add(new THREE.ConeGeometry(0.035, 0.1, 8), 0, 0.0, 0.09, 1, 1, 1, this.beardNode).rotation.x = Math.PI; break;
    }
    if (a.scar) {
      const scarMat = new THREE.MeshStandardMaterial({ color: a.scar === 3 ? 0x9ff8ff : 0x8a4a3a, emissive: a.scar === 3 ? 0x3cc9e0 : 0x000000, emissiveIntensity: 1 });
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.06, 0.004), scarMat);
      s.position.set(a.scar === 2 ? 0.045 : -0.07, a.scar === 2 ? 0.13 : 0.08, 0.1);
      s.rotation.z = 0.3;
      this.beardNode.add(s);
    }
  }

  setTouch(t: number) {
    this.touch = t;
    const on = Math.max(0, (t - 25) / 75);
    for (const v of this.veins) {
      v.opacity = on * 0.6;
      v.emissiveIntensity = on * 2.5;
    }
  }

  setEquipment(weaponId: string, offhandId: string, armorId: string) {
    if (weaponId !== this.weaponId) {
      this.weaponId = weaponId;
      this.weapon?.removeFromParent();
      this.weapon = weaponId ? makeWeapon(weaponId) : null;
      if (this.weapon) {
        // Griff in der geschlossenen Faust (nicht am Handgelenk)
        // Bogen wird links gehalten (rechts zieht die Sehne)
        const bow = ITEMS[weaponId]?.weapon?.type === 'bow';
        if (this.human) this.weapon.position.add(new THREE.Vector3(bow ? -0.01 : 0.01, -0.085, 0.012));
        (bow ? this.j.handL : this.j.handR).add(this.weapon);
      }
    }
    if (offhandId !== this.offhandId) {
      this.offhandId = offhandId;
      this.offhand?.removeFromParent();
      this.offhand = offhandId ? makeWeapon(offhandId) : null;
      if (this.offhand) {
        const kind = ITEMS[offhandId]?.offhand?.type;
        if (kind === 'quiver') { this.offhand.position.set(0.1, 0.15, -0.14); this.offhand.rotation.z = 0.3; this.j.chest.add(this.offhand); }
        else {
          if (this.human) this.offhand.position.add(new THREE.Vector3(-0.01, -0.085, 0.012));
          this.j.handL.add(this.offhand);
        }
      }
    }
    if (armorId !== this.armorId && armorId) {
      this.armorId = armorId;
      const o = OUTFITS[armorId];
      if (o) {
        this.bodyMat.color.setHex(o.body);
        if (this.human) {
          (this.bodyMat as THREE.MeshPhysicalMaterial).sheenColor?.setHex(o.body).lerp(new THREE.Color(0xffffff), 0.35);
          this.chainMat?.color.setHex(o.body).lerp(new THREE.Color(0xd6d9de), 0.75);
          this.plateMat?.color.setHex(o.body).lerp(new THREE.Color(0xd6d9de), 0.75);
          this.hoodMat?.color.setHex(o.accent);
        } else {
          this.bodyMat.metalness = o.metal ? 0.7 : 0;
          this.bodyMat.roughness = o.metal ? 0.4 : 0.85;
        }
        this.legMat.color.setHex(o.legs);
        this.accentMat.color.setHex(o.accent);
        this.robeNode.visible = !!o.robe;
        this.hoodNode.visible = !!o.hood;
        this.applyOutfitPieces(o);
      }
    }
  }

  get weaponType() {
    return ITEMS[this.weaponId]?.weapon?.type ?? 'none';
  }

  play(anim: string, dur?: number) {
    if (anim === this.anim) return;
    const oneShot = anim.startsWith('atk') || anim === 'heavy' || anim === 'bow' || anim === 'cast' || anim.startsWith('skill') || anim === 'hit';
    for (const n of JOINTS) this.from[n].copy(this.j[n].quaternion);
    this.prevAnim = this.anim;
    this.anim = anim;
    this.animT = 0;
    this.blend = 0;
    this.blendDur = anim === 'dodge' ? 0.06 : oneShot ? 0.08 : this.prevAnim === 'dodge' ? 0.12 : 0.2;
    if (dur) this.actionDur = dur;
  }

  hit() {
    this.flinch = 0.25;
  }

  /** speed: horizontale Geschwindigkeit (m/s), groundL/R: Geländehöhe unter den Füßen relativ zur Wurzel */
  update(dt: number, speed: number, groundL = 0, groundR = 0, fwd = 1) {
    this.animT += dt;
    this.blend = Math.min(1, this.blend + dt / this.blendDur);
    this.speed = speed;
    if (this.human) this.updateSwing(dt);
    this.flinch = Math.max(0, this.flinch - dt);
    // Schrittzyklus an die Strecke koppeln: je Zyklus (zwei Schritte) genau so weit, wie die Füße in der
    // Standphase zurücklegen → kein Rutschen. Rückwärts läuft der Zyklus rückwärts.
    // Drehen auf der Stelle: Schrittzyklus läuft mit der Drehung (≈ 0,25 m Fußweg je Radiant)
    const turning = speed < 0.4 && Math.abs(this.turnRate) > 1.0 && (this.anim === 'idle' || this.anim === 'recover');
    this.turnStep += ((turning ? 1 : 0) - this.turnStep) * Math.min(1, dt * (turning ? 10 : 5));
    const before = this.cyc;
    if (this.turnStep > 0.05) this.cyc += Math.abs(this.turnRate) * 0.25 * dt / this.cycleLen(0.8);
    this.cyc += (fwd < -0.3 ? -1 : 1) * (speed * dt) / this.cycleLen(speed);
    // Fußaufsatz (linker Fuß bei 0, rechter bei 0,5) → Schrittgeräusch genau im Takt
    if (Math.floor(before * 2) !== Math.floor(this.cyc * 2)) this.footfalls++;
    this.cyc -= Math.floor(this.cyc);
    this.phase = this.cyc * Math.PI * 2;
    const pose = this.computePose(this.anim, this.animT);
    const tq = new THREE.Quaternion();
    const e = new THREE.Euler();
    const k = easeInOut(this.blend);
    for (const n of JOINTS) {
      const r = pose[n] ?? [0, 0, 0];
      // Beine: in den Posen bedeutet negatives X „Knie nach vorn“, positives „Knie beugen“. Nur die alte
      // Ersatzfigur hat gespiegelte Beingelenke – bei den MakeHuman-Figuren liefen sonst alle Beinposen
      // (Sitzen, Springen, Ausweichen, Gehen) spiegelverkehrt: Oberschenkel beim Sitzen nach hinten.
      const leg = !this.human && (n.startsWith('thigh') || n.startsWith('shin') || n.startsWith('foot'));
      e.set(leg ? -r[0] : r[0], r[1], r[2], 'YXZ');
      tq.setFromEuler(e);
      this.cur[n].slerpQuaternions(this.from[n], tq, k);
      this.j[n].quaternion.copy(this.cur[n]);
    }
    const ro = pose.root ?? [0, 0, 0];
    // Beim Gehen/Laufen folgt das Becken dem Schrittzyklus unmittelbar (sonst hinkt es hinterher und die
    // Füße schweben beim Aufsetzen); sonst weich überblenden
    const gaitAnim = this.anim === 'walk' || this.anim === 'run' || this.anim === 'sprint';
    this.rootOff.lerp(new THREE.Vector3(ro[0], ro[1], ro[2]), gaitAnim && this.blend >= 1 ? 1 : Math.min(1, dt * 14));
    const rr = pose.rootRot ?? [0, 0, 0];
    this.rootRot.x += (rr[0] - this.rootRot.x) * Math.min(1, dt * (this.anim === 'dodge' ? 40 : 10));
    this.rootRot.z += (rr[2] - this.rootRot.z) * Math.min(1, dt * 10);
    // Bodenanpassung: Hüfte auf den tieferen Fuß absenken, Knie beugen
    const lo = Math.min(groundL, groundR, 0);
    this.hipsDrop += (Math.max(-0.35, lo) - this.hipsDrop) * Math.min(1, dt * 12);
    const grounded = !['jump', 'fall', 'dodge', 'swim', 'tread', 'downed', 'dead', 'die', 'emote_sit'].includes(this.anim);
    if (grounded && speed < 1.5) {
      const bendL = Math.max(0, groundL - this.hipsDrop), bendR = Math.max(0, groundR - this.hipsDrop);
      // Gelenkdrehung X: negativ = Oberschenkel nach vorn, positiv am Schienbein = Knie beugen (MakeHuman-Figur;
      // die alte Ersatzfigur ist gespiegelt)
      const fl = this.human ? 1 : -1;
      this.j.thighL.rotateX(-fl * Math.min(0.9, bendL * 2.2));
      this.j.shinL.rotateX(fl * Math.min(1.6, bendL * 4.4));
      this.j.thighR.rotateX(-fl * Math.min(0.9, bendR * 2.2));
      this.j.shinR.rotateX(fl * Math.min(1.6, bendR * 4.4));
    }
    if (this.flinch > 0) this.j.chest.rotateX(-this.flinch * 1.2);
    this.body.position.set(this.rootOff.x, this.rootOff.y + (grounded ? this.hipsDrop : 0), -this.rootOff.z);
    this.body.rotation.set(this.rootRot.x, 0, this.rootRot.z);
    this.life(dt, speed, grounded);
  }

  /** Gesichtsform aus der Saat: jede Figur bekommt eine eigene Mischung der Formvarianten. */
  private makeFace() {
    let h = 2166136261;
    for (let i = 0; i < this.faceSeed.length; i++) { h ^= this.faceSeed.charCodeAt(i); h = Math.imul(h, 16777619); }
    const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
    const pairs: [string, string][] = [['f_nose_big', 'f_nose_small'], ['f_jaw_strong', 'f_narrow'], ['f_gaunt', 'f_round']];
    // Gemäßigte Ausprägung (Extremwerte wirken aufgedunsen/karikiert); Frauen eher schmaler Kiefer, schlanke Wangen
    const bias: Record<string, number> = this.sex === 'female' ? { f_jaw_strong: -0.45, f_gaunt: 0.35 } : {};
    for (const [a, b] of pairs) {
      const x = Math.max(-1, Math.min(1, rnd() * 2 - 1 + (bias[a] ?? 0)));
      this.face[a] = Math.max(0, x) * 0.6; this.face[b] = Math.max(0, -x) * 0.6;
    }
    this.face['f_lips'] = rnd() * (this.sex === 'female' ? 0.8 : 0.4);
    this.face['f_brow'] = rnd() * (this.sex === 'male' ? 0.8 : 0.3);
    this.face['f_old'] = Math.max(0, rnd() * 1.4 - 0.6);
    this.mood = rnd() * 0.6 - 0.2;
  }

  private setMorph(name: string, v: number) {
    for (const m of this.morphs) {
      const i = m.morphTargetDictionary![name];
      if (i !== undefined) m.morphTargetInfluences![i] = v;
    }
  }

  /** Weltposition vor dem Mund und Blickrichtung (für Atemhauch). */
  mouthWorld(pos: THREE.Vector3, dir: THREE.Vector3) {
    this.j.head.updateWorldMatrix(true, false);
    pos.set(0, 0.035, 0.11).applyMatrix4(this.j.head.matrixWorld);
    dir.set(0, -0.15, 1).transformDirection(this.j.head.matrixWorld);
  }

  /**
   * Was eine Figur lebendig wirkt: Atmen, Gewichtsverlagerung, Kopf folgt dem Blickziel,
   * Blinzeln (auch doppelt), Kiefer und Lippen beim Sprechen, Grundstimmung, Griff um die Waffe.
   */
  private life(dt: number, speed: number, grounded: boolean) {
    this.lifeT += dt;
    const t = this.lifeT, s = Math.sin;
    const calm = grounded && speed < 0.3 && (this.anim === 'idle' || this.anim === 'talk' || this.anim === 'recover');
    // Atmung (Brustkorb hebt sich), in Ruhe langsam, nach Bewegung schneller
    const br = s(t * (speed > 3 ? 3.2 : 1.7));
    // Ausatmen beginnt (Brustkorb senkt sich): für den sichtbaren Atemhauch in der Kälte
    if (this.lastBr > 0 && br <= 0) this.exhaled = true;
    this.lastBr = br;
    this.j.chest.rotateX(-br * 0.012);
    this.j.shoulderL.rotateZ(br * 0.01);
    this.j.shoulderR.rotateZ(-br * 0.01);
    if (calm) {
      // Gewicht verlagert sich langsam von einem Bein aufs andere
      const w = s(t * 0.23) * 0.5 + s(t * 0.61) * 0.2;
      this.j.hips.rotateZ(w * 0.035);
      this.j.spine.rotateZ(-w * 0.025);
      // Spielbein: Knie leicht nach vorn gebeugt
      const fl = this.human ? 1 : -1;
      this.j.thighL.rotateX(Math.max(0, w) * -0.06 * fl);
      this.j.shinL.rotateX(Math.max(0, w) * 0.12 * fl);
      this.j.thighR.rotateX(Math.max(0, -w) * -0.06 * fl);
      this.j.shinR.rotateX(Math.max(0, -w) * 0.12 * fl);
    }
    // Kopf zum Blickziel (sanft, begrenzt), sonst leichtes Umsehen
    let yaw = calm ? s(t * 0.31) * 0.12 + s(t * 0.13) * 0.1 : 0, pitch = 0;
    if (this.lookAt) {
      const hp = this.j.head.getWorldPosition(new THREE.Vector3());
      const d = this.lookAt.clone().sub(hp);
      const inv = this.root.getWorldQuaternion(new THREE.Quaternion()).invert();
      d.applyQuaternion(inv);
      const a = Math.atan2(d.x, d.z);
      if (Math.abs(a) < 1.6) { yaw = THREE.MathUtils.clamp(a, -1.0, 1.0); pitch = THREE.MathUtils.clamp(-Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.4, 0.4); }
    }
    const kk = 1 - Math.exp(-dt * 5);
    this.lookYaw += (yaw - this.lookYaw) * kk;
    this.lookPitch += (pitch - this.lookPitch) * kk;
    this.j.neck.rotateY(this.lookYaw * 0.4);
    this.j.head.rotateY(this.lookYaw * 0.6);
    this.j.head.rotateX(this.lookPitch * 0.7);
    if (!this.morphs.length) return;
    // Blinzeln: alle 2–6 s, manchmal doppelt; Lid schließt schnell und öffnet langsamer
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blinkK = 0.0001; this.blinkT = Math.random() < 0.15 ? 0.35 : 2 + Math.random() * 4; }
    let blink = 0;
    if (this.blinkK > 0) {
      this.blinkK += dt;
      const b = this.blinkK;
      blink = b < 0.07 ? b / 0.07 : b < 0.1 ? 1 : Math.max(0, 1 - (b - 0.1) / 0.12);
      if (b > 0.22) this.blinkK = 0;
    }
    const dead = this.anim === 'dead' || this.anim === 'die' || this.anim === 'downed';
    this.setMorph('blink', dead ? 0.85 : Math.max(blink, this.flinch > 0 ? 0.7 : 0));
    // Sprechen: Silbenrhythmus aus überlagerten Schwingungen, dazwischen kurze Pausen
    this.talking = Math.max(0, this.talking - dt);
    let jaw = 0, lips = 0;
    if (this.talking > 0 || this.anim === 'talk') {
      const syl = Math.max(0, s(t * 13.0) * 0.6 + s(t * 7.3 + 1.3) * 0.4);
      const pause = s(t * 1.7) > -0.75 ? 1 : 0.1;
      jaw = syl * pause * 0.55;
      lips = Math.max(0, s(t * 9.1 + 0.4)) * 0.35 * pause;
    }
    const fight = this.anim.startsWith('atk') || this.anim === 'heavy' || this.anim === 'block';
    if (fight) jaw = Math.max(jaw, 0.12);
    this.setMorph('jaw', jaw);
    this.setMorph('lips', lips);
    const mood = fight ? -1 : this.mood;
    this.setMorph('smile', Math.max(0, mood) * 0.45);
    this.setMorph('frown', Math.max(0, -mood) * 0.5 + (fight ? 0.3 : 0));
    this.setMorph('brows', this.talking > 0 ? Math.max(0, s(t * 2.1)) * 0.3 : 0);
    for (const [k, v] of Object.entries(this.face)) this.setMorph(k, v);
    // Griff: Faust um Waffe/Schild/Bogen, sonst locker halb gebeugte Finger
    const wt = this.weaponType;
    const offT = ITEMS[this.offhandId]?.offhand?.type;
    this.setMorph('gripR', wt === 'bow' ? 0.5 : wt !== 'none' ? 1 : 0.45);
    this.setMorph('gripL', offT === 'shield' || offT === 'focus' || wt === 'bow' ? 1 : 0.45);
  }

  /** Schrittlänge (ein Schritt) je Tempo: Gehen ~0,7 m bei 1,4 m/s, Laufen ~1,75 m bei 5 m/s. */
  private stepLen(v: number) {
    const run = smooth(2.3, 3.8, v);
    const L = this.legs()[0] + this.legs()[1];
    const k = L / 0.9;
    return (0.4 + 0.22 * Math.min(v, 2.6)) * k * (1 - run) + (0.9 + 0.17 * v) * k * run;
  }

  private cycleLen(v: number) {
    return Math.max(0.5, 2 * this.stepLen(v));
  }

  /** Ober- und Unterschenkellänge aus den Gelenkversätzen (je Körperbau). */
  private legs(): [number, number] {
    if (!this.legLen) {
      const a = this.j.shinL.position.length(), b = this.j.footL.position.length();
      this.legLen = [a > 0.2 ? a : 0.45, b > 0.2 ? b : 0.43];
    }
    return this.legLen;
  }

  /**
   * Gang aus Fußbahnen und Zwei-Gelenk-IK (Seitenebene): Standfuß bleibt am Boden und wandert mit der
   * Laufgeschwindigkeit nach hinten, Schwungfuß im Bogen nach vorn (beim Rennen mit Fersenkick).
   * Becken reitet beim Gehen auf dem Standbein (höchster Punkt in der Standmitte), beim Rennen federt es in
   * der Standphase ein und steigt in der Flugphase. Becken dreht und kippt mit, Brustkorb dreht gegen,
   * Arme pendeln gegengleich mit Verzögerung, der Kopf bleibt ruhig.
   */
  private gait(v: number, inPlace = false): Pose {
    const [L1, L2] = this.legs();
    const L = L1 + L2, sc = L / 0.9;
    const run = smooth(2.3, 3.8, v), spr = smooth(6.0, 8.0, v);
    const move = Math.min(1, v / 0.9); // beim Anlaufen/Anhalten weniger Schwung
    // Standanteil: Gehen ~60 %, Rennen ~30 % (Bodenkontakt ~0,2 s), Sprint ~18 % (~0,1 s)
    const duty = 0.61 * (1 - run) + (0.31 - 0.13 * spr) * run;
    const C = this.cycleLen(v);
    // halbe Standstrecke des Knöchels: ~10 cm übernimmt das Abrollen über den Fuß (Ferse → Ballen)
    const a = inPlace ? 0.04 * sc : Math.max(0, (C * duty) / 2 - 0.12 * sc) * move;
    const lift = ((0.075 + 0.02 * Math.min(1, v / 2)) * (1 - run) + 0.2 * run + 0.08 * spr) * sc * move * (inPlace ? 0.5 : 1);
    const cyc = this.cyc;
    const P: Pose = {};
    let rootY = 0;
    const foot = (u: number) => {
      // x vorwärts (relativ zur Hüfte), y Anhebung, pitch Fußneigung (+ = Zehen hoch), st = Standanteil
      if (u < duty) {
        const t = u / duty;
        const heel = (1 - smooth(0, 0.18, t)) * (0.22 * (1 - run) + 0.06 * run);
        const toe = smooth(0.62, 1, t) * (0.35 * (1 - run) + 0.5 * run);
        // Abdruck: Ferse hebt sich, der Knöchel steigt um Fußlänge × Neigung
        return { x: a * (1 - 2 * t), y: Math.sin(toe) * 0.19 * sc, pitch: heel - toe, st: Math.sin(Math.PI * t) };
      }
      const t = (u - duty) / (1 - duty);
      const e = t * t * (3 - 2 * t);
      const arc = Math.sin(Math.PI * Math.pow(t, 0.75));
      // Rennen: Ferse zuerst hoch zum Gesäß (hinter der Hüfte), dann Knie nach vorn
      const kick = run * Math.sin(Math.PI * Math.min(1, t * 1.5));
      return { x: -a + 2 * a * e - kick * 0.12 * sc * move, y: lift * arc + kick * 0.12 * sc * move, pitch: -0.5 * (1 - smooth(0, 0.35, t)) + 0.18 * smooth(0.35, 0.8, t) * (1 - smooth(0.9, 1, t)), st: 0 };
    };
    const fl = foot(cyc), fr = foot((cyc + 0.5) % 1);
    // Becken: Gehen – höchster Punkt in der Standmitte (umgekehrtes Pendel); Rennen – tiefster Punkt dort
    const b = Math.cos(4 * Math.PI * (cyc - duty / 2));
    // Beckenhöhe geometrisch: so tief, dass jedes Standbein fast gestreckt (ca. 6° Kniebeuge) den Boden erreicht –
    // ergibt von selbst das Auf und Ab des umgekehrten Pendels; schon 2 % zu tief knickt das Knie sichtbar ein
    const Lr = L * 0.994;
    let need = 0;
    for (const f of [fl, fr]) if (f.st > 0 || f.y < 0.02 * sc) need = Math.min(need, Math.sqrt(Math.max(0, Lr * Lr - f.x * f.x)) + f.y - Lr);
    const spring = (-0.02 - 0.03 * (b + 1) / 2) * sc; // Rennen: Einfedern in der Standmitte
    // Rennen: Knie federt ohnehin – Becken höchstens 7 cm tiefer, der Rest wird über die Kniebeuge aufgenommen
    rootY = Math.min(need, spring * run);
    rootY = (rootY * (1 - run) + Math.max(rootY, (-0.07 + 0.025 * spr) * sc) * run) - 0.004 * sc;
    const leg = (f: { x: number; y: number; pitch: number }, side: 'L' | 'R') => {
      const x = f.x, y = L + rootY - f.y; // Abstand Hüfte → Knöchel nach unten
      let d = Math.hypot(x, y);
      d = Math.min(d, L * 0.9995);
      const phi = Math.atan2(x, y);
      const al = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))));
      const be = Math.acos(Math.max(-1, Math.min(1, (L2 * L2 + d * d - L1 * L1) / (2 * L2 * d))));
      const th1 = phi + al, th2 = phi - be;
      const abd = side === 'L' ? 0.025 : -0.025;
      P[`thigh${side}`] = [-th1, 0, abd];
      P[`shin${side}`] = [th1 - th2, 0, 0];
      P[`foot${side}`] = [th2 + f.pitch, 0, -abd]; // + = Zehen hoch
    };
    leg(fl, 'L');
    leg(fr, 'R');
    // S > 0: linkes Bein hinten (rechtes vorn) – Becken dreht mit, Brustkorb und Arme gegen
    const S = a > 1e-4 ? (fr.x - fl.x) / (2 * a) : 0;
    const lagC = (cyc - 0.05 + 1) % 1;
    const fl2 = foot(lagC), fr2 = foot((lagC + 0.5) % 1);
    const Sa = a > 1e-4 ? (fr2.x - fl2.x) / (2 * a) : 0;
    const roll = fl.st - fr.st; // + = links im Stand
    const walkW = 1 - run;
    const lean = (0.035 + 0.02 * Math.min(1, v / 2)) * walkW + (0.13 + 0.14 * spr) * run;
    const hy = S * (0.07 * walkW + 0.12 * run) * move;
    P.hips = [0, hy, -0.045 * roll * walkW * move];
    P.spine = [lean * 0.45, -hy * 0.45, 0.02 * roll * walkW * move];
    P.chest = [lean * 0.55, -hy * 0.9, 0.015 * roll * walkW * move];
    // Kopf gleicht Neigung und Drehung aus (Blick bleibt geradeaus) und nickt leicht beim Aufsetzen
    P.head = [-lean * 0.75 + (b * 0.012) * move, hy * 0.35, -0.02 * roll * walkW * move];
    const armA = (0.32 * walkW + 0.62 * run + 0.35 * spr) * move;
    const elbow = -0.22 * walkW - 1.35 * run;
    // Arme nah am Körper wie in der Ruhepose (Handflächen zum Oberschenkel), beim Rennen etwas weiter
    P.upperArmL = [-Sa * armA + 0.02, 0.12 * walkW, -0.1 + 0.08 * run];
    P.upperArmR = [Sa * armA + 0.02, -0.12 * walkW, 0.1 - 0.08 * run];
    // Ellbogen beugt sich mehr, wenn der Arm vorn ist
    P.foreArmL = [elbow - Math.max(0, Sa) * (0.35 * walkW + 0.3 * run) * move, 0.25 * walkW, 0];
    P.foreArmR = [elbow - Math.max(0, -Sa) * (0.35 * walkW + 0.3 * run) * move, -0.25 * walkW, 0];
    P.root = [0.018 * roll * walkW * sc * move, rootY, 0];
    return P;
  }

  /**
   * Schwerthiebe aus Schlüsselposen (weich überblendet): Hut → Ausholen → Hieb → Durchschwung → Hut.
   * Achsen (rechter Arm): Oberarm X− = heben/vor, Y+ = quer nach links, Z− = abspreizen; Hand X+ = Spitze
   * nach vorn/unten; Brust/Hüfte Y+ = nach links drehen; Oberschenkel X− = vor; root Z+ = Ausfall nach vorn.
   */
  private swordStrike(anim: string, prog: number): Pose {
    const shield = !!this.offhandId && ITEMS[this.offhandId]?.offhand?.type === 'shield';
    type K = [number, Pose];
    const guard: Pose = {
      upperArmR: [-0.75, -0.15, -0.25], foreArmR: [-1.05, 0, 0], handR: [0.15, 0, 0], chest: [0.06, 0, 0],
      thighL: [-0.12, 0, 0.04], shinL: [0.15, 0, 0], thighR: [0.12, 0, -0.04], shinR: [0.1, 0, 0], root: [0, -0.03, 0],
    };
    let keys: K[];
    if (anim === 'atk3' || anim === 'heavy') {
      // Oberhau: Klinge über den Kopf in den Nacken, Oberkörper streckt sich, dann hinab mit tiefem Ausfall
      const h = anim === 'heavy' ? 1.25 : 1;
      keys = [
        [0, guard],
        [anim === 'heavy' ? 0.45 : 0.38, { upperArmR: [-2.85, -0.15, -0.25], foreArmR: [-0.7, 0, 0], handR: [1.2, 0, 0], chest: [-0.22, -0.12, 0], spine: [-0.08, 0, 0], head: [0.12, 0, 0],
          upperArmL: [-0.95, 0.25, 0.12], foreArmL: [-1.2, 0, 0], thighL: [-0.1, 0, 0.05], shinL: [0.1, 0, 0], thighR: [0.2, 0, -0.05], shinR: [0.2, 0, 0], root: [0, 0.01, -0.04] }],
        [anim === 'heavy' ? 0.6 : 0.54, { upperArmR: [-1.1, 0.2, -0.1], foreArmR: [-0.15, 0, 0], handR: [0.3, 0, 0], chest: [0.42 * h, 0.1, 0], spine: [0.22 * h, 0, 0], head: [-0.3, 0, 0],
          upperArmL: [-0.7, 0.25, 0.12], foreArmL: [-0.7, 0, 0], thighL: [-0.62 * h, 0, 0.06], shinL: [0.75 * h, 0, 0], thighR: [0.32 * h, 0, -0.05], shinR: [0.35, 0, 0], footR: [-0.25, 0, 0], root: [0, -0.1 * h, 0.2 * h] }],
        [0.74, { upperArmR: [-0.75, 0.25, -0.1], foreArmR: [-0.35, 0, 0], handR: [0.5, 0, 0], chest: [0.35 * h, 0.1, 0], spine: [0.18 * h, 0, 0],
          upperArmL: [-0.45, 0.2, 0.15], foreArmL: [-0.8, 0, 0], thighL: [-0.5 * h, 0, 0.06], shinL: [0.6 * h, 0, 0], thighR: [0.28 * h, 0, -0.05], shinR: [0.3, 0, 0], root: [0, -0.08 * h, 0.16 * h] }],
        [1, guard],
      ];
    } else {
      // Diagonalhieb (atk1: rechts oben → links unten) bzw. Rückhand (atk2: links unten → rechts oben)
      const back = anim === 'atk2';
      const cocked: Pose = back
        ? { upperArmR: [-1.05, 1.0, -0.05], foreArmR: [-1.35, 0, 0], handR: [0.75, 0.3, 0], chest: [0.12, 0.55, 0], spine: [0.05, 0.25, 0], hips: [0, 0.15, 0], head: [0, -0.5, 0] }
        : { upperArmR: [-2.3, -0.8, -0.45], foreArmR: [-0.9, 0, 0], handR: [1.1, 0, 0], chest: [-0.06, -0.5, 0], spine: [0, -0.25, 0], hips: [0, -0.15, 0], head: [0, 0.55, 0] };
      const hit: Pose = back
        ? { upperArmR: [-1.9, -0.85, -0.45], foreArmR: [-0.3, 0, 0], handR: [-0.2, -0.2, 0], chest: [0.02, -0.5, 0], spine: [0, -0.25, 0], hips: [0, -0.18, 0], head: [0, 0.45, 0] }
        : { upperArmR: [-1.15, 0.95, -0.15], foreArmR: [-0.2, 0, 0], handR: [0.95, 0.15, 0], chest: [0.22, 0.55, 0], spine: [0.1, 0.25, 0], hips: [0, 0.2, 0], head: [0, -0.5, 0] };
      const follow: Pose = back
        ? { upperArmR: [-2.2, -1.2, -0.6], foreArmR: [-0.6, 0, 0], handR: [-0.5, -0.2, 0], chest: [-0.02, -0.65, 0], spine: [0, -0.3, 0], hips: [0, -0.2, 0] }
        : { upperArmR: [-0.75, 1.35, -0.05], foreArmR: [-0.45, 0, 0], handR: [1.2, 0.3, 0], chest: [0.26, 0.7, 0], spine: [0.12, 0.3, 0], hips: [0, 0.22, 0] };
      const legsWind: Pose = { thighL: [-0.05, 0, 0.05], shinL: [0.12, 0, 0], thighR: [0.2, 0, -0.05], shinR: [0.25, 0, 0], root: [0, -0.02, -0.05] };
      const legsHit: Pose = { thighL: [-0.5, 0, 0.06], shinL: [0.62, 0, 0], thighR: [0.3, 0, -0.05], shinR: [0.3, 0, 0], footR: [-0.2, 0, 0], root: [0, -0.08, 0.17] };
      const offWind: Pose = { upperArmL: back ? [-0.3, 0, 0.35] : [-0.75, 0.45, 0.1], foreArmL: [-0.9, 0, 0] };
      const offHit: Pose = { upperArmL: back ? [-0.8, 0.5, 0.1] : [-0.2, -0.2, 0.45], foreArmL: [-0.5, 0, 0] };
      keys = [
        [0, guard],
        [0.38, { ...legsWind, ...offWind, ...cocked }],
        [0.55, { ...legsHit, ...offHit, ...hit }],
        [0.72, { ...legsHit, ...offHit, ...follow, root: [0, -0.06, 0.14] }],
        [1, guard],
      ];
    }
    const p = sampleKeys(keys, prog);
    if (shield) { p.upperArmL = [-0.95, -0.35, 0.2]; p.foreArmL = [-1.25, 0.2, 0]; }
    return p;
  }

  private computePose(anim: string, t: number): Pose {
    const s = Math.sin, c = Math.cos, ph = this.phase;
    const wt = this.weaponType;
    const armed = wt !== 'none';
    const ready = (p: Pose): Pose => {
      // Waffenhaltung im Ruhezustand
      if (wt === 'bow') { p.upperArmL = [-0.3, 0, 0.15]; p.foreArmL = [-0.3, 0, 0]; }
      else if (wt === 'staff') { p.upperArmR = [-0.25, 0, -0.15]; p.foreArmR = [-0.6, 0, 0]; }
      else if (armed) { p.upperArmR = [-0.15, 0, -0.12]; p.foreArmR = [-0.7, 0, 0]; p.handR = [0.3, 0, 0]; }
      if (this.offhandId && ITEMS[this.offhandId]?.offhand?.type === 'shield') { p.upperArmL = [-0.2, 0, 0.2]; p.foreArmL = [-1.2, 0.2, 0]; }
      return p;
    };
    const locomotion = (amp: number, arm: number, lean: number, bob: number): Pose => ({
      hips: [0, s(ph) * 0.08 * amp, 0],
      spine: [lean * 0.5, -s(ph) * 0.06 * amp, 0],
      chest: [lean * 0.5, -s(ph) * 0.1 * amp, 0],
      head: [-lean * 0.6, s(ph) * 0.04, 0],
      thighL: [s(ph) * 0.75 * amp - 0.05, 0, 0.03],
      shinL: [Math.max(0, -s(ph + 0.9)) * 1.25 * amp + 0.05, 0, 0],
      footL: [Math.max(0, s(ph)) * -0.3 * amp, 0, 0],
      thighR: [-s(ph) * 0.75 * amp - 0.05, 0, -0.03],
      shinR: [Math.max(0, s(ph + 0.9)) * 1.25 * amp + 0.05, 0, 0],
      footR: [Math.max(0, -s(ph)) * -0.3 * amp, 0, 0],
      upperArmL: [-s(ph) * 0.6 * arm, 0, 0.1],
      foreArmL: [-0.3 - Math.max(0, s(ph)) * 0.5 * arm, 0, 0],
      upperArmR: [s(ph) * 0.6 * arm, 0, -0.1],
      foreArmR: [-0.3 - Math.max(0, -s(ph)) * 0.5 * arm, 0, 0],
      root: [0, Math.abs(c(ph)) * bob - bob * 0.5, 0],
    });
    const prog = Math.min(1, t / Math.max(0.1, this.actionDur));
    // Entwicklerhilfe (Vorschau): feste Pose als JSON, z. B. dbg:{"upperArmR":[-1.4,0.5,0]}
    if (anim.startsWith('dbg:')) { try { return JSON.parse(anim.slice(4)) as Pose; } catch { return {}; } }
    switch (anim) {
      case 'idle': case 'recover': case 'idle_boss': {
        // Auf der Stelle drehen: kleine Trippelschritte statt über den Boden gleitender Füße
        if (this.turnStep > 0.05) {
          const g = this.gait(0.8, true);
          const k = Math.min(1, this.turnStep);
          for (const key of ['thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR'] as const) g[key] = g[key]!.map((x) => x * k) as [number, number, number];
          return ready({ ...g, upperArmL: [0.04, 0.12, -0.1], upperArmR: [0.04, -0.12, 0.1], foreArmL: [-0.28, 0.25, 0], foreArmR: [-0.28, -0.25, 0], root: [0, (g.root?.[1] ?? 0) * k, 0] });
        }
        const b = s(t * 1.6);
        // Entspannt stehen: Arme hängen nah am Körper, Ellbogen leicht gebeugt, Füße etwa hüftbreit,
        // Gewicht auf einem Bein (Kontrapost) statt Schaufensterpuppen-Haltung
        return ready({ chest: [b * 0.02, 0, 0], head: [b * 0.015, s(t * 0.4) * 0.1, 0],
          upperArmL: [0.04, 0.12, -0.1 + b * 0.015], upperArmR: [0.04, -0.12, 0.1 - b * 0.015], foreArmL: [-0.28, 0.25, 0], foreArmR: [-0.28, -0.25, 0],
          thighL: [0.03, 0.08, -0.06], thighR: [-0.05, -0.12, 0.0], shinR: [0.1, 0, 0], footR: [-0.05, 0, 0], root: [0, b * 0.005 - 0.004, 0] });
      }
      case 'talk': {
        const g = s(t * 2.3);
        return { head: [s(t * 1.7) * 0.08, s(t * 0.9) * 0.15, 0], upperArmR: [-0.4 - g * 0.2, 0, -0.2], foreArmR: [-1.0 + g * 0.3, 0, 0], upperArmL: [0, 0, 0.12], foreArmL: [-0.2, 0, 0] };
      }
      case 'work': {
        // Handwerk: vorgebeugt, rechter Arm schlägt/zieht im Takt, linker hält das Werkstück
        const k = s(t * 3.1), hit = Math.max(0, k);
        return { spine: [0.18, 0, 0], chest: [0.12 + hit * 0.05, s(t * 1.55) * 0.05, 0], head: [0.25, s(t * 0.5) * 0.1, 0],
          upperArmR: [-0.9 - k * 0.55, 0, -0.25], foreArmR: [-0.9 + k * 0.4, 0, 0], upperArmL: [-0.55, 0, 0.25], foreArmL: [-1.1, 0, 0],
          thighL: [0.08, 0, 0.06], thighR: [-0.08, 0, -0.06], root: [0, -0.02, 0] };
      }
      case 'sit': return ready({ root: [0, -0.5, 0], thighL: [-1.45, 0, 0.12], shinL: [1.45, 0, 0], thighR: [-1.45, 0, -0.12], shinR: [1.45, 0, 0], upperArmL: [-0.55, 0, 0.2], upperArmR: [-0.6, 0, -0.2], foreArmL: [-1.0, 0, 0], foreArmR: [-0.9 + s(t * 0.7) * 0.15, 0, 0], spine: [0.12, 0, 0], head: [0.05, s(t * 0.4) * 0.2, 0] });
      // Gang ergibt sich aus dem tatsächlichen Tempo (Gehen → Laufen → Sprinten fließend)
      case 'walk': return ready(this.gait(Math.max(this.speed, 0.6)));
      case 'run': return ready(this.gait(Math.max(this.speed, 2.5)));
      case 'sprint': return this.gait(Math.max(this.speed, 5));
      case 'swim': return { rootRot: [1.3, 0, 0], root: [0, 0.4, 0], upperArmL: [-2.6 + s(t * 4) * 1.2, 0, 0.3], upperArmR: [-2.6 - s(t * 4) * 1.2, 0, -0.3], thighL: [s(t * 6) * 0.3, 0, 0], thighR: [-s(t * 6) * 0.3, 0, 0] };
      case 'tread': return { root: [0, 0.2 + s(t * 2) * 0.05, 0], upperArmL: [-0.4, 0, 0.9 + s(t * 3) * 0.3], upperArmR: [-0.4, 0, -0.9 - s(t * 3) * 0.3], thighL: [s(t * 3) * 0.4, 0, 0], thighR: [-s(t * 3) * 0.4, 0, 0], shinL: [0.6, 0, 0], shinR: [0.6, 0, 0] };
      case 'jump': return ready({ thighL: [-0.9, 0, 0], shinL: [1.4, 0, 0], thighR: [-0.2, 0, 0], shinR: [0.6, 0, 0], upperArmL: [-0.8, 0, 0.5], upperArmR: [-0.8, 0, -0.5], spine: [0.1, 0, 0] });
      case 'fall': return ready({ thighL: [-0.5, 0, 0.1], shinL: [0.8, 0, 0], thighR: [-0.3, 0, -0.1], shinR: [0.5, 0, 0], upperArmL: [-0.3, 0, 0.9], upperArmR: [-0.3, 0, -0.9] });
      case 'dodge': {
        const k = Math.min(1, t / 0.38);
        return { rootRot: [k * Math.PI * 2, 0, 0], root: [0, -0.35 * s(k * Math.PI), 0], spine: [0.9, 0, 0], chest: [0.5, 0, 0], head: [0.5, 0, 0], thighL: [-1.6, 0, 0], shinL: [2.2, 0, 0], thighR: [-1.6, 0, 0], shinR: [2.2, 0, 0], upperArmL: [-1.2, 0, 0.3], upperArmR: [-1.2, 0, -0.3], foreArmL: [-1.2, 0, 0], foreArmR: [-1.2, 0, 0] };
      }
      case 'block': return { chest: [0.1, -0.3, 0], upperArmL: [-1.0, -0.45, 0.1], foreArmL: [-0.75, -0.55, 0], upperArmR: [-0.4, 0, -0.3], foreArmR: [-1.1, 0, 0], thighL: [-0.3, 0, 0.1], shinL: [0.4, 0, 0], thighR: [0.2, 0, -0.1], shinR: [0.3, 0, 0], root: [0, -0.08, 0] };
      case 'atk1': case 'atk2': case 'atk3': case 'heavy': case 'skill': case 'skill:bash':
        return this.swordStrike(anim, prog);
      case 'bow': case 'skill:bow': {
        const draw = Math.min(1, prog / 0.55), rel = prog > 0.55 ? 1 : 0;
        return { chest: [0, -0.9, 0], head: [0, 0.8, 0], upperArmL: [-1.55, 0.9, 0.1], foreArmL: [0, 0, 0], upperArmR: [-1.5, 0.9 - draw * 0.2, -0.3 + rel * 0.3], foreArmR: [-2.1 * draw * (1 - rel), 0, 0], thighL: [-0.2, 0, 0.1], thighR: [0.2, 0, -0.1] };
      }
      case 'cast': case 'skill:cast': {
        const k1 = Math.min(1, prog / 0.45), k2 = Math.max(0, (prog - 0.45) / 0.55);
        return { chest: [-0.15 * k1 + 0.2 * k2, 0, 0], upperArmR: [-1.4 * k1 - 0.2 * k2, 0.2, -0.3], foreArmR: [-0.8 * (1 - k2), 0, 0], upperArmL: [-1.2 * k1, -0.2, 0.3], foreArmL: [-0.9 * (1 - k2), 0, 0], root: [0, 0, -0.08 * k2] };
      }
      case 'hit': return { chest: [-0.4, 0.2, 0], head: [-0.3, 0, 0], upperArmL: [-0.3, 0, 0.5], upperArmR: [-0.3, 0, -0.5] };
      case 'stun': case 'frozen': return { head: [0.3 + s(t * 3) * 0.2, s(t * 2) * 0.4, 0], chest: [0.2, 0, s(t * 2.5) * 0.1], upperArmL: [0, 0, 0.3], upperArmR: [0, 0, -0.3], thighL: [-0.2, 0, 0], shinL: [0.4, 0, 0], thighR: [-0.2, 0, 0], shinR: [0.4, 0, 0], root: [0, -0.1, 0] };
      case 'die': case 'dead': case 'downed': {
        const k = Math.min(1, t / 0.6);
        return { rootRot: [(-Math.PI / 2) * k * 0.95, 0, 0.2 * k], root: [0, -0.8 * k, 0.4 * k], chest: [0.2, 0.3, 0], head: [0.3, 0.4, 0], upperArmL: [-0.6, 0, 1.1], upperArmR: [anim === 'downed' ? -1.5 : -0.3, 0, -1.0], thighL: [0.1, 0, 0.1], thighR: [-0.3, 0, -0.1], shinR: [0.6, 0, 0] };
      }
      case 'interact': case 'revive': {
        const r = s(t * 5) * 0.1;
        return { spine: [0.45, 0, 0], chest: [0.35, 0, 0], upperArmR: [-1.2 + r, 0, -0.1], foreArmR: [-0.5, 0, 0], upperArmL: [-0.8, 0, 0.2], foreArmL: [-0.8, 0, 0], thighL: [-0.6, 0, 0], shinL: [1.0, 0, 0], thighR: [-0.1, 0, 0], shinR: [0.4, 0, 0], root: [0, -0.2, 0] };
      }
      case 'emote_wave': return { upperArmR: [-0.2, 0, -2.6], foreArmR: [0, 0, -0.4 + s(t * 9) * 0.5], head: [0, 0.15, 0] };
      case 'emote_bow': { const k = Math.min(1, t / 0.5) * (t < 1.6 ? 1 : Math.max(0, 1 - (t - 1.6) / 0.5)); return { spine: [0.6 * k, 0, 0], chest: [0.4 * k, 0, 0], upperArmR: [-0.5 * k, 0, -0.1], foreArmR: [-1.5 * k, 0.5, 0] }; }
      case 'emote_cheer': return { upperArmL: [-0.2, 0, 2.6 + s(t * 8) * 0.2], upperArmR: [-0.2, 0, -2.6 - s(t * 8) * 0.2], root: [0, Math.abs(s(t * 6)) * 0.12, 0], head: [-0.3, 0, 0] };
      case 'emote_sit': { const k = Math.min(1, t / 0.6); return { root: [0, -0.62 * k, 0], thighL: [-1.5 * k, 0, 0.2], shinL: [1.5 * k, 0, 0], thighR: [-1.5 * k, 0, -0.2], shinR: [1.5 * k, 0, 0], upperArmL: [-0.4, 0, 0.3], upperArmR: [-0.4, 0, -0.3], foreArmL: [-0.8, 0, 0], foreArmR: [-0.8, 0, 0], spine: [0.2, 0, 0] }; }
      case 'emote_dance': return { hips: [0, s(t * 5) * 0.4, s(t * 5) * 0.15], chest: [0, -s(t * 5) * 0.3, 0], upperArmL: [-0.5, 0, 1.5 + s(t * 10) * 0.4], upperArmR: [-0.5, 0, -1.5 + s(t * 10) * 0.4], thighL: [s(t * 10) * 0.4, 0, 0.1], shinL: [Math.max(0, s(t * 10)) * 0.8, 0, 0], thighR: [-s(t * 10) * 0.4, 0, -0.1], shinR: [Math.max(0, -s(t * 10)) * 0.8, 0, 0], root: [0, Math.abs(s(t * 10)) * 0.06, 0] };
      case 'emote_point': return { upperArmR: [-1.55, -0.1, -0.1], foreArmR: [0, 0, 0], head: [0, 0, 0] };
      case 'gazed': return { chest: [0.15, 0, 0], head: [0.2, 0, 0.1], upperArmL: [-0.9, 0, 0.3], upperArmR: [-1.1, 0, -0.3], foreArmL: [-0.4, 0, 0], foreArmR: [-0.5, 0, 0], thighL: [0.4, 0, 0], thighR: [-0.4, 0, 0], shinR: [0.5, 0, 0] };
      case 'shielded': return { chest: [0.1, 0, 0], upperArmL: [-0.4, 0, 1.2 + s(t * 2) * 0.1], upperArmR: [-0.4, 0, -1.2 - s(t * 2) * 0.1], head: [-0.3, 0, 0], root: [0, s(t * 1.5) * 0.05, 0] };
      case 'shoot': return { chest: [0, -0.6, 0], upperArmL: [-1.5, 0.5, 0], upperArmR: [-1.5, 0.6, 0], foreArmR: [-0.3, 0, 0] };
      default:
        if (anim.startsWith('w_') || anim.startsWith('a_')) {
          // Gegnerangriffe (Humanoide): Ausholen / Zuschlagen
          const windup = anim.startsWith('w_');
          return windup
            ? { chest: [-0.2, 0.6, 0], upperArmR: [-2.2, 0.5, -0.4], foreArmR: [-0.8, 0, 0], upperArmL: [-0.4, 0, 0.4], thighL: [-0.4, 0, 0], shinL: [0.5, 0, 0], root: [0, -0.1, 0.1] }
            : { chest: [0.3, -0.7, 0], upperArmR: [-0.8, -0.9, -0.6], foreArmR: [-0.2, 0, 0], upperArmL: [-0.3, 0, 0.4], thighL: [-0.5, 0, 0], shinL: [0.4, 0, 0], thighR: [0.3, 0, 0], root: [0, -0.1, -0.25] };
        }
        return ready({});
    }
  }
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/** Waffen- und Nebenhandmodelle (aus Blender „weapons“ oder Ersatzformen). */
export function makeWeapon(id: string): THREE.Object3D {
  const def = ITEMS[id];
  const type = def?.weapon?.type ?? def?.offhand?.type ?? 'sword';
  const tplName = `w_${type}`;
  const g = new THREE.Group();
  const lib = hasModel('weapons') ? getModel('weapons').parts.get(tplName) : undefined;
  const rare = def && ['rare', 'epic', 'legendary'].includes(def.rarity);
  const glassy = id.includes('glass') || id.includes('null') || id.includes('rast') || id.includes('prism');
  if (lib) {
    const m = lib.clone(true);
    m.position.set(0, 0, 0);
    // Materialvarianten wie bei den Ersatzmodellen: Glas-/Nulllicht-Waffen, seltene Stücke, Glutstäbe
    m.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      const swap = (mt: THREE.Material) => {
        if (mt.name === 'metal') return glassy ? namedMaterial('crystal') : rare ? namedMaterial('metal_gold') : mt;
        if (mt.name === 'glow_null' && id.includes('ember')) return namedMaterial('glow_warm');
        if (mt.name === 'wood' && type === 'shield' && id.includes('order')) return namedMaterial('metal_gold');
        return mt;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
    g.add(m);
  } else {
    const metal = namedMaterial(glassy ? 'crystal' : rare ? 'metal_gold' : 'metal');
    const wood = namedMaterial('wood_dark');
    const leather = namedMaterial('leather');
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.rotation.x = rx;
      mesh.castShadow = true;
      g.add(mesh);
      return mesh;
    };
    switch (type) {
      case 'sword':
        add(new THREE.CylinderGeometry(0.018, 0.02, 0.18, 8), leather, 0, -0.03, 0);
        add(new THREE.BoxGeometry(0.2, 0.03, 0.04), metal, 0, -0.13, 0);
        add(new THREE.BoxGeometry(0.055, 0.85, 0.012), metal, 0, -0.57, 0);
        break;
      case 'axe':
        add(new THREE.CylinderGeometry(0.02, 0.022, 0.8, 8), wood, 0, -0.3, 0);
        add(new THREE.BoxGeometry(0.2, 0.16, 0.02), metal, 0.08, -0.62, 0);
        break;
      case 'mace':
        add(new THREE.CylinderGeometry(0.02, 0.022, 0.7, 8), wood, 0, -0.25, 0);
        add(new THREE.DodecahedronGeometry(0.09, 0), metal, 0, -0.62, 0);
        break;
      case 'dagger':
        add(new THREE.CylinderGeometry(0.016, 0.018, 0.12, 8), leather, 0, -0.03, 0);
        add(new THREE.BoxGeometry(0.04, 0.3, 0.01), metal, 0, -0.24, 0);
        break;
      case 'bow': {
        const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.65, 0), new THREE.Vector3(0, 0, -0.28), new THREE.Vector3(0, -0.65, 0));
        add(new THREE.TubeGeometry(curve, 16, 0.018, 6), wood, 0, 0, 0);
        add(new THREE.CylinderGeometry(0.003, 0.003, 1.3, 4), namedMaterial('cloth_white'), 0, 0, 0);
        g.rotation.set(0, 0, 0);
        break;
      }
      case 'staff':
        add(new THREE.CylinderGeometry(0.022, 0.028, 1.7, 8), wood, 0, -0.35, 0);
        add(new THREE.OctahedronGeometry(0.08, 0), namedMaterial(id.includes('ember') ? 'glow_warm' : 'glow_null'), 0, 0.52, 0);
        break;
      case 'shield': {
        const s = add(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 20), id.includes('order') ? namedMaterial('metal_gold') : wood, 0, -0.08, 0.05, Math.PI / 2);
        s.rotation.z = Math.PI / 2;
        add(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 12), metal, -0.02, -0.08, 0.05, Math.PI / 2).rotation.z = Math.PI / 2;
        break;
      }
      case 'quiver':
        add(new THREE.CylinderGeometry(0.06, 0.05, 0.5, 10), leather, 0, 0, 0);
        for (let i = 0; i < 5; i++) add(new THREE.CylinderGeometry(0.006, 0.006, 0.2, 4), wood, Math.cos(i) * 0.03, 0.32, Math.sin(i) * 0.03);
        break;
      case 'focus':
        add(new THREE.OctahedronGeometry(0.07, 0), namedMaterial('crystal'), 0, -0.08, -0.05);
        break;
    }
  }
  if (type !== 'shield' && type !== 'quiver' && type !== 'focus' && type !== 'bow') g.rotation.x = -Math.PI / 2 + 0.2;
  if (type === 'bow') g.rotation.set(0, Math.PI / 2, 0.2);
  // Schild: Vorderseite zeigt entlang des Unterarms (Tragehaltung: Unterarm nach vorn), Griff an der Faust
  if (type === 'shield') { g.rotation.set(0, 0, Math.PI / 2); g.position.set(-0.08, -0.05, -0.05); }
  if (type === 'staff') g.rotation.set(-Math.PI / 2, 0, 0);
  return g;
}

function smooth(a: number, b: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Posen zwischen Schlüsselbildern weich überblenden (fehlende Gelenke = 0). */
function sampleKeys(keys: [number, Pose][], t: number): Pose {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1]![0]) i++;
  const [t0, a] = keys[i]!, [t1, b] = keys[i + 1]!;
  const u = Math.max(0, Math.min(1, (t - t0) / Math.max(1e-4, t1 - t0)));
  const k = u * u * (3 - 2 * u);
  const out: Pose = {};
  const names = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof Pose>;
  for (const n of names) {
    const va = (a[n] ?? [0, 0, 0]) as [number, number, number], vb = (b[n] ?? [0, 0, 0]) as [number, number, number];
    (out as Record<string, [number, number, number]>)[n] = [va[0] + (vb[0] - va[0]) * k, va[1] + (vb[1] - va[1]) * k, va[2] + (vb[2] - va[2]) * k];
  }
  return out;
}
