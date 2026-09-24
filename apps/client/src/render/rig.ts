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
import { buildHuman, eyeMaterial, hairCapMaterial, hairMaterial, hasHumanModel, humanJoints, morphMeshes, skinMaterial, type Sex } from './human.ts';

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
  const rep = kind === 'cloth' ? 12 : kind === 'leather' ? 4 : kind === 'chain' ? 42 : 2;
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
    m.sheen = 1;
    m.sheenRoughness = 0.65;
    m.sheenColor = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35);
    m.normalScale.set(0.9, 0.9);
  } else if (kind === 'leather') {
    m.clearcoat = 0.18;
    m.clearcoatRoughness = 0.55;
    m.normalScale.set(0.8, 0.8);
  }
  const u = { uRep: { value: rep }, uWear: { value: kind === 'plate' ? 0.35 : kind === 'chain' ? 0.25 : 1 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uRep; uniform float uWear;
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
        #endif`);
  };
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
      ? skinMaterial(this.sex, new THREE.Color(SKIN_COLORS[a.skin] ?? SKIN_COLORS[1]!), new THREE.Color(HAIR_COLORS[a.hairColor] ?? '#3b2718'))
      : new THREE.MeshStandardMaterial({ color: new THREE.Color(SKIN_COLORS[a.skin] ?? SKIN_COLORS[1]), roughness: 0.6, map: TEX.skin().map });
    const outfit = OUTFITS[opts.outfit ?? 'armor_gambeson'] ?? OUTFITS['armor_gambeson']!;
    if (this.human) {
      this.bodyMat = garment('cloth', outfit.body);
      this.legMat = garment('cloth', outfit.legs);
      this.accentMat = garment('leather', outfit.accent);
      this.chainMat = garment('chain', outfit.body);
      this.plateMat = garment('plate', outfit.body);
      this.hoodMat = garment('cloth', outfit.accent);
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
      for (const n of ['skin', 'eyes', 'mouth', 'mouth_cavity', 'tunic', 'trousers', 'boots']) vis(n, true);
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
      const fresh = skinMaterial(this.sex, skin, hc);
      this.skinMat.color.copy(fresh.color);
      fresh.dispose();
      (this.skinMat.userData['hairCol'] as { value: THREE.Color } | undefined)?.value.copy(hc);
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
  update(dt: number, speed: number, groundL = 0, groundR = 0) {
    this.animT += dt;
    this.blend = Math.min(1, this.blend + dt / this.blendDur);
    this.speed = speed;
    this.flinch = Math.max(0, this.flinch - dt);
    // Schrittphase an Strecke koppeln (Schrittlänge je nach Tempo)
    const stride = speed > 6.5 ? 2.6 : speed > 3.5 ? 1.9 : 1.2;
    this.phase += (speed * dt) / stride * Math.PI * 2 * 0.5;
    const pose = this.computePose(this.anim, this.animT);
    const tq = new THREE.Quaternion();
    const e = new THREE.Euler();
    const k = easeInOut(this.blend);
    for (const n of JOINTS) {
      const r = pose[n] ?? [0, 0, 0];
      // Beine: in den Posen bedeutet negatives X „Knie nach vorn“, positives „Knie beugen“
      const leg = n.startsWith('thigh') || n.startsWith('shin') || n.startsWith('foot');
      e.set(leg ? -r[0] : r[0], r[1], r[2], 'YXZ');
      tq.setFromEuler(e);
      this.cur[n].slerpQuaternions(this.from[n], tq, k);
      this.j[n].quaternion.copy(this.cur[n]);
    }
    const ro = pose.root ?? [0, 0, 0];
    this.rootOff.lerp(new THREE.Vector3(ro[0], ro[1], ro[2]), Math.min(1, dt * 14));
    const rr = pose.rootRot ?? [0, 0, 0];
    this.rootRot.x += (rr[0] - this.rootRot.x) * Math.min(1, dt * (this.anim === 'dodge' ? 40 : 10));
    this.rootRot.z += (rr[2] - this.rootRot.z) * Math.min(1, dt * 10);
    // Bodenanpassung: Hüfte auf den tieferen Fuß absenken, Knie beugen
    const lo = Math.min(groundL, groundR, 0);
    this.hipsDrop += (Math.max(-0.35, lo) - this.hipsDrop) * Math.min(1, dt * 12);
    const grounded = !['jump', 'fall', 'dodge', 'swim', 'tread', 'downed', 'dead', 'die', 'emote_sit'].includes(this.anim);
    if (grounded && speed < 1.5) {
      const bendL = Math.max(0, groundL - this.hipsDrop), bendR = Math.max(0, groundR - this.hipsDrop);
      this.j.thighL.rotateX(Math.min(0.9, bendL * 2.2));
      this.j.shinL.rotateX(-Math.min(1.6, bendL * 4.4));
      this.j.thighR.rotateX(Math.min(0.9, bendR * 2.2));
      this.j.shinR.rotateX(-Math.min(1.6, bendR * 4.4));
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
    for (const [a, b] of pairs) { const x = rnd() * 2 - 1; this.face[a] = Math.max(0, x) * 0.9; this.face[b] = Math.max(0, -x) * 0.9; }
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
    this.j.chest.rotateX(-br * 0.012);
    this.j.shoulderL.rotateZ(br * 0.01);
    this.j.shoulderR.rotateZ(-br * 0.01);
    if (calm) {
      // Gewicht verlagert sich langsam von einem Bein aufs andere
      const w = s(t * 0.23) * 0.5 + s(t * 0.61) * 0.2;
      this.j.hips.rotateZ(w * 0.035);
      this.j.spine.rotateZ(-w * 0.025);
      this.j.thighL.rotateX(Math.max(0, w) * -0.06);
      this.j.shinL.rotateX(Math.max(0, w) * 0.12);
      this.j.thighR.rotateX(Math.max(0, -w) * -0.06);
      this.j.shinR.rotateX(Math.max(0, -w) * 0.12);
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
    this.setMorph('gripR', wt === 'bow' ? 0.5 : wt !== 'none' ? 1 : 0.22);
    this.setMorph('gripL', offT === 'shield' || offT === 'focus' || wt === 'bow' ? 1 : 0.22);
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
    switch (anim) {
      case 'idle': case 'recover': case 'idle_boss': {
        const b = s(t * 1.6);
        return ready({ chest: [b * 0.02, 0, 0], head: [b * 0.015, s(t * 0.4) * 0.1, 0], upperArmL: [0, 0, 0.12 + b * 0.02], upperArmR: [0, 0, -0.12 - b * 0.02], foreArmL: [-0.15, 0, 0], foreArmR: [-0.15, 0, 0], thighL: [0.02, 0, 0.04], thighR: [-0.02, 0, -0.04], root: [0, b * 0.005, 0] });
      }
      case 'talk': {
        const g = s(t * 2.3);
        return { head: [s(t * 1.7) * 0.08, s(t * 0.9) * 0.15, 0], upperArmR: [-0.4 - g * 0.2, 0, -0.2], foreArmR: [-1.0 + g * 0.3, 0, 0], upperArmL: [0, 0, 0.12], foreArmL: [-0.2, 0, 0] };
      }
      case 'walk': return ready(locomotion(0.55, 0.5, 0.03, 0.03));
      case 'run': return ready(locomotion(0.85, 0.8, 0.12, 0.06));
      case 'sprint': { const p = locomotion(1.15, 1.1, 0.3, 0.09); return p; }
      case 'swim': return { rootRot: [1.3, 0, 0], root: [0, 0.4, 0], upperArmL: [-2.6 + s(t * 4) * 1.2, 0, 0.3], upperArmR: [-2.6 - s(t * 4) * 1.2, 0, -0.3], thighL: [s(t * 6) * 0.3, 0, 0], thighR: [-s(t * 6) * 0.3, 0, 0] };
      case 'tread': return { root: [0, 0.2 + s(t * 2) * 0.05, 0], upperArmL: [-0.4, 0, 0.9 + s(t * 3) * 0.3], upperArmR: [-0.4, 0, -0.9 - s(t * 3) * 0.3], thighL: [s(t * 3) * 0.4, 0, 0], thighR: [-s(t * 3) * 0.4, 0, 0], shinL: [0.6, 0, 0], shinR: [0.6, 0, 0] };
      case 'jump': return ready({ thighL: [-0.9, 0, 0], shinL: [1.4, 0, 0], thighR: [-0.2, 0, 0], shinR: [0.6, 0, 0], upperArmL: [-0.8, 0, 0.5], upperArmR: [-0.8, 0, -0.5], spine: [0.1, 0, 0] });
      case 'fall': return ready({ thighL: [-0.5, 0, 0.1], shinL: [0.8, 0, 0], thighR: [-0.3, 0, -0.1], shinR: [0.5, 0, 0], upperArmL: [-0.3, 0, 0.9], upperArmR: [-0.3, 0, -0.9] });
      case 'dodge': {
        const k = Math.min(1, t / 0.38);
        return { rootRot: [k * Math.PI * 2, 0, 0], root: [0, -0.35 * s(k * Math.PI), 0], spine: [0.9, 0, 0], chest: [0.5, 0, 0], head: [0.5, 0, 0], thighL: [-1.6, 0, 0], shinL: [2.2, 0, 0], thighR: [-1.6, 0, 0], shinR: [2.2, 0, 0], upperArmL: [-1.2, 0, 0.3], upperArmR: [-1.2, 0, -0.3], foreArmL: [-1.2, 0, 0], foreArmR: [-1.2, 0, 0] };
      }
      case 'block': return { chest: [0.1, -0.3, 0], upperArmL: [-1.0, -0.45, 0.1], foreArmL: [-0.75, -0.55, 0], upperArmR: [-0.4, 0, -0.3], foreArmR: [-1.1, 0, 0], thighL: [-0.3, 0, 0.1], shinL: [0.4, 0, 0], thighR: [0.2, 0, -0.1], shinR: [0.3, 0, 0], root: [0, -0.08, 0] };
      case 'atk1': case 'atk2': case 'atk3': case 'heavy': case 'skill': case 'skill:bash': {
        // Ausholen → Schlag → Zurückziehen
        const wind = 0.4, strike = 0.55;
        const k1 = Math.min(1, prog / wind), k2 = Math.min(1, Math.max(0, (prog - wind) / (strike - wind))), k3 = Math.max(0, (prog - strike) / (1 - strike));
        const dir = anim === 'atk2' ? -1 : 1;
        const over = anim === 'atk3' || anim === 'heavy';
        if (over) {
          const raise = -2.8 * k1 * (1 - k2) + (-0.3) * k2 * (1 - k3);
          return { spine: [0.3 * k2, 0, 0], chest: [-0.35 * k1 + 0.6 * k2 - 0.25 * k3, 0, 0], upperArmR: [raise, 0, -0.3], foreArmR: [-0.5 * (1 - k2), 0, 0], upperArmL: [raise * 0.8, 0, 0.3], foreArmL: [-0.5, 0, 0], thighL: [-0.5 * k2, 0, 0], shinL: [0.4 * k2, 0, 0], thighR: [0.3 * k2, 0, 0], root: [0, -0.15 * k2 * (1 - k3), -0.25 * k2] };
        }
        const tw = dir * (0.9 * k1 - 1.8 * k2 + 0.9 * k3);
        return { chest: [0.1, tw * 0.6, 0], spine: [0.05, tw * 0.3, 0], upperArmR: [-1.4, dir * (0.9 * k1 - 1.9 * k2 + 1.0 * k3), -0.9 + 0.4 * k2], foreArmR: [-0.5 + 0.4 * k2, 0, 0], handR: [0.2, 0, 0], upperArmL: [-0.2, 0, 0.3], foreArmL: [-0.6, 0, 0], thighL: [-0.35 * k2, 0, 0], shinL: [0.3 * k2, 0, 0], thighR: [0.25 * k2, 0, 0], root: [0, -0.06 * k2, -0.2 * k2] };
      }
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
