// Statische Welt: Requisiten (instanziert, in Chunks mit Detailstufen), Brücke,
// Dungeon-Geometrie, dynamische Lichtquellen und interaktive Objekte.

import * as THREE from 'three';
import { BRIDGE, bridgeSegments, getWorldLayout, PROPS, type PlacedObject, INTERACTABLE_BY_ID } from '@pz/shared';
import { flattenMeshes, getModel, namedMaterial } from './models.ts';
import { TEX } from './textures.ts';
import { settings } from '../settings.ts';
import { VLight } from './lights.ts';

const CHUNKED = new Set(['tree_pine', 'tree_oak', 'tree_dead', 'bush', 'rock_small', 'rock_large', 'palisade', 'cliff_rock']);
const CHUNK = 80;

interface ChunkSet { cx: number; cz: number; lod0: THREE.InstancedMesh[]; lod1: THREE.InstancedMesh[] }

export interface DynObject {
  obj: PlacedObject;
  node: THREE.Object3D;
  glow?: THREE.Mesh;
}

/** Material mit Welt-UV (für skalierte Kästen im Dungeon). */
function worldUvMaterial(set: ReturnType<typeof TEX.rock>, scale: number, color = 0xffffff) {
  const m = new THREE.MeshStandardMaterial({ map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap, color });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec4 wp4 = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vWN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
        #else
          vec4 wp4 = modelMatrix * vec4(position, 1.0);
          vWN = normalize(mat3(modelMatrix) * normal);
        #endif
        vWP = wp4.xyz;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWP; varying vec3 vWN;
        vec2 wuv() { vec3 a = abs(vWN); return (a.y > a.x && a.y > a.z ? vWP.xz : a.x > a.z ? vWP.zy : vWP.xy) * ${scale.toFixed(3)}; }`)
      .replace('#include <map_fragment>', 'vec4 sampledDiffuseColor = texture2D(map, wuv()); diffuseColor *= sampledDiffuseColor;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * texture2D(roughnessMap, wuv()).g;')
      .replace('#include <normal_fragment_maps>', 'vec3 mapN = texture2D(normalMap, wuv()).xyz * 2.0 - 1.0; mapN.xy *= normalScale; normal = normalize(normal + (viewMatrix * vec4(mapN.x, 0.0, mapN.y, 0.0)).xyz * 0.4);');
  };
  m.customProgramCacheKey = () => `worlduv-${scale}-${color}`;
  return m;
}

export class WorldView {
  group = new THREE.Group();
  private chunks: ChunkSet[] = [];
  dyn = new Map<string, DynObject>();
  dynList: DynObject[] = [];
  private lightSources: { x: number; y: number; z: number; color: number; intensity: number; dist: number; dungeon: boolean; flicker: boolean }[] = [];
  private lights: { src: WorldView['lightSources'][number]; v: VLight }[] = [];
  gateObjects = new Map<string, THREE.Object3D[]>();
  sightObjects: THREE.Object3D[] = [];
  tideStones: THREE.Object3D[] = [];
  dungeonGroup = new THREE.Group();

  constructor() {
    const layout = getWorldLayout();
    const byType = new Map<string, PlacedObject[]>();
    for (const o of layout.objects) {
      const def = PROPS[o.t];
      if (def?.light) this.lightSources.push({ x: o.x, y: o.y + def.light.y * o.s, z: o.z, color: def.light.color, intensity: def.light.intensity, dist: def.light.dist, dungeon: o.x > 1000, flicker: def.light.color !== 0x7ff6ff });
      if (o.t === 'bridge') continue;
      if (o.id || o.requires || o.gate || o.hiddenUntilSight) {
        this.addDynamic(o);
        continue;
      }
      let arr = byType.get(o.t);
      if (!arr) byType.set(o.t, (arr = []));
      arr.push(o);
    }
    for (const [t, list] of byType) this.buildInstanced(t, list);
    this.buildBridge();
    this.buildDungeon();
    this.group.add(this.dungeonGroup);
    // Jede Lichtquelle ist ein virtuelles Licht; die Zuteilung echter Lichter übernimmt lightManager
    for (const src of this.lightSources) {
      const v = new VLight(src.color, 0, src.dist, 1.6, 1);
      v.position.set(src.x, src.y, src.z);
      (src.dungeon ? this.dungeonGroup : this.group).add(v);
      this.lights.push({ src, v });
    }
  }

  private matrixFor(o: PlacedObject) {
    const m = new THREE.Matrix4();
    m.compose(new THREE.Vector3(o.x, o.y, o.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.rot), new THREE.Vector3(o.s, o.s, o.s));
    return m;
  }

  private buildInstanced(type: string, list: PlacedObject[]) {
    const tpl = getModel(PROPS[type]?.model ?? type);
    const parts0 = flattenMeshes(tpl.lod0);
    const parts1 = tpl.lod1 ? flattenMeshes(tpl.lod1) : null;
    const groups = new Map<string, PlacedObject[]>();
    if (CHUNKED.has(type)) {
      for (const o of list) {
        const k = `${Math.floor(o.x / CHUNK)},${Math.floor(o.z / CHUNK)}`;
        let a = groups.get(k);
        if (!a) groups.set(k, (a = []));
        a.push(o);
      }
    } else groups.set('all', list);
    const tmp = new THREE.Matrix4();
    for (const [k, objs] of groups) {
      const mk = (parts: ReturnType<typeof flattenMeshes>) => parts.map((p) => {
        const im = new THREE.InstancedMesh(p.geometry, p.material, objs.length);
        objs.forEach((o, i) => im.setMatrixAt(i, tmp.multiplyMatrices(this.matrixFor(o), p.matrix)));
        im.instanceMatrix.needsUpdate = true;
        im.castShadow = p.castShadow && type !== 'bush';
        im.receiveShadow = true;
        im.computeBoundingSphere();
        this.group.add(im);
        return im;
      });
      const lod0 = mk(parts0);
      const lod1 = parts1 ? mk(parts1) : [];
      if (k !== 'all') {
        const [cx, cz] = k.split(',').map(Number) as [number, number];
        this.chunks.push({ cx: (cx + 0.5) * CHUNK, cz: (cz + 0.5) * CHUNK, lod0, lod1 });
      } else {
        this.chunks.push({ cx: NaN, cz: NaN, lod0, lod1 });
      }
    }
  }

  private addDynamic(o: PlacedObject) {
    const tpl = getModel(PROPS[o.t]?.model ?? o.t);
    const node = tpl.lod0.clone(true);
    node.position.set(o.x, o.y, o.z);
    node.rotation.y = o.rot;
    node.scale.setScalar(o.s);
    node.userData['obj'] = o;
    this.group.add(node);
    const d: DynObject = { obj: o, node };
    // Interaktive Objekte bekommen einen dezenten Leuchtring
    if (o.id && INTERACTABLE_BY_ID[o.id]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 32), new THREE.MeshBasicMaterial({ color: 0xd9b26a, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(o.x, o.y + 0.05, o.z);
      this.group.add(ring);
      d.glow = ring;
    }
    if (o.id) this.dyn.set(o.id, d);
    this.dynList.push(d);
    if (o.gate) {
      const arr = this.gateObjects.get(o.gate) ?? [];
      arr.push(node);
      this.gateObjects.set(o.gate, arr);
    }
    if (o.hiddenUntilSight) {
      this.sightObjects.push(node);
      node.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh) m.material = new THREE.MeshStandardMaterial({ color: 0x9ff8ff, emissive: 0x7ff6ff, emissiveIntensity: 2.5, transparent: true, opacity: 0.85 });
      });
    }
    if (o.t === 'tide_stone') {
      node.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh) m.material = new THREE.MeshStandardMaterial({ color: 0xbff9ff, emissive: 0x6fe8ff, emissiveIntensity: 1.8, transparent: true, opacity: 0.75, roughness: 0.1 });
      });
      if (!getModel('tide_stone').fromFile) {
        node.clear();
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.5, 0.3, 20), new THREE.MeshStandardMaterial({ color: 0xbff9ff, emissive: 0x6fe8ff, emissiveIntensity: 1.8, transparent: true, opacity: 0.75 }));
        disc.position.y = -0.15;
        node.add(disc);
      }
      this.tideStones.push(node);
    }
  }

  private buildBridge() {
    const segs = bridgeSegments();
    const plank = namedMaterial('wood_dark');
    const g = new THREE.Group();
    const dir = new THREE.Vector3(Math.sin(BRIDGE.rot), 0, Math.cos(BRIDGE.rot));
    for (const s of segs) {
      const deck = new THREE.Mesh(new THREE.BoxGeometry(BRIDGE.width, 0.25, s.len + 0.05), plank);
      deck.position.set(s.x, s.y - 0.12, s.z);
      deck.rotation.y = BRIDGE.rot;
      deck.castShadow = deck.receiveShadow = true;
      g.add(deck);
    }
    for (const side of [-1, 1]) {
      for (let i = 1; i < segs.length - 1; i++) {
        const s = segs[i]!;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.2, 0.18), plank);
        const off = new THREE.Vector3(Math.cos(BRIDGE.rot), 0, -Math.sin(BRIDGE.rot)).multiplyScalar(side * (BRIDGE.width / 2 + 0.05));
        post.position.set(s.x + off.x, s.y + 0.5, s.z + off.z);
        post.castShadow = true;
        g.add(post);
        const next = segs[i + 1]!;
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, s.len + 0.1), plank);
        rail.position.set((s.x + next.x) / 2 + off.x, (s.y + next.y) / 2 + 1.05, (s.z + next.z) / 2 + off.z);
        rail.lookAt(rail.position.clone().add(dir));
        g.add(rail);
      }
    }
    // Pfeiler im Fluss
    for (const i of [3, 8]) {
      const s = segs[i]!;
      const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 5, 8), namedMaterial('stone'));
      pier.position.set(s.x, s.y - 2.6, s.z);
      g.add(pier);
    }
    this.group.add(g);
  }

  private buildDungeon() {
    const d = getWorldLayout().dungeon;
    const wallMat = worldUvMaterial(TEX.rock(), 0.18, 0x9a8f80);
    const floorMat = worldUvMaterial(TEX.dirt(), 0.2, 0x8a7a6a);
    const ceilMat = worldUvMaterial(TEX.rock(), 0.12, 0x5a5048);
    const box = new THREE.BoxGeometry(1, 1, 1);
    const walls = new THREE.InstancedMesh(box, wallMat, d.walls.length);
    const m = new THREE.Matrix4();
    d.walls.forEach((w, i) => {
      m.compose(new THREE.Vector3(w.x, (w.y0 + w.y1) / 2, w.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), w.rot), new THREE.Vector3(w.hw * 2, w.y1 - w.y0, w.hd * 2));
      walls.setMatrixAt(i, m);
    });
    walls.castShadow = false;
    walls.receiveShadow = true;
    walls.computeBoundingSphere();
    this.dungeonGroup.add(walls);
    for (const r of d.rects) {
      const w = r.x1 - r.x0, h = r.z1 - r.z0;
      const segX = Math.max(1, Math.round(w / 2)), segZ = Math.max(1, Math.round(h / 2));
      const fg = new THREE.PlaneGeometry(w, h, segX, segZ);
      fg.rotateX(-Math.PI / 2);
      fg.translate((r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2);
      const pos = fg.attributes['position']!;
      const hf = getWorldLayout().hf;
      for (let i = 0; i < pos.count; i++) pos.setY(i, hf.height(pos.getX(i), pos.getZ(i)));
      fg.computeVertexNormals();
      const floor = new THREE.Mesh(fg, floorMat);
      floor.receiveShadow = true;
      this.dungeonGroup.add(floor);
      const cg = new THREE.PlaneGeometry(w + 2, h + 2);
      cg.rotateX(Math.PI / 2);
      const ceil = new THREE.Mesh(cg, ceilMat);
      ceil.position.set((r.x0 + r.x1) / 2, r.ceil + 0.5, (r.z0 + r.z1) / 2);
      this.dungeonGroup.add(ceil);
      // Stützbalken
      if (r.ceil <= 7) {
        for (let z = r.z0 + 4; z < r.z1 - 2; z += 8) {
          const beam = new THREE.Mesh(new THREE.BoxGeometry(w, 0.35, 0.35), namedMaterial('wood_dark'));
          beam.position.set((r.x0 + r.x1) / 2, r.ceil - 0.2, z);
          this.dungeonGroup.add(beam);
          for (const sx of [r.x0 + 0.3, r.x1 - 0.3]) {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, r.ceil - r.floor, 0.3), namedMaterial('wood_dark'));
            post.position.set(sx, (r.ceil + r.floor) / 2, z);
            this.dungeonGroup.add(post);
          }
          this.lightSources.push({ x: (r.x0 + r.x1) / 2, y: r.ceil - 0.8, z, color: 0xffa050, intensity: 9, dist: 13, dungeon: true, flicker: true });
        }
      }
    }
    for (const c of d.circles) {
      const fg = new THREE.CircleGeometry(c.r + 1, 48);
      fg.rotateX(-Math.PI / 2);
      const floor = new THREE.Mesh(fg, worldUvMaterial(TEX.glass(), 0.15));
      floor.position.set(c.x, c.floor, c.z);
      floor.receiveShadow = true;
      this.dungeonGroup.add(floor);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(c.r + 1.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), worldUvMaterial(TEX.rock(), 0.1, 0x3a3a4a));
      (dome.material as THREE.MeshStandardMaterial).side = THREE.BackSide;
      dome.scale.y = (c.ceil - c.floor) / (c.r + 1.5);
      dome.position.set(c.x, c.floor, c.z);
      this.dungeonGroup.add(dome);
      // Leuchtende Kristalladern in der Kathedrale
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.6 + (i % 3) * 0.4, 0), namedMaterial('crystal'));
        cr.position.set(c.x + Math.cos(a) * (c.r - 0.5), c.floor + 0.6 + (i % 4) * 1.4, c.z + Math.sin(a) * (c.r - 0.5));
        cr.scale.set(0.6, 2 + (i % 3), 0.6);
        cr.rotation.set(0.2 * (i % 2), a, 0.3);
        this.dungeonGroup.add(cr);
      }
      this.lightSources.push({ x: c.x, y: c.floor + 12, z: c.z, color: 0x7ff6ff, intensity: 40, dist: 45, dungeon: true, flicker: false });
    }
  }

  /** Macht für das Vorladen alles sichtbar; gibt eine Funktion zum Zurücksetzen zurück. */
  showAllForWarmup() {
    const prev: [THREE.Object3D, boolean][] = [];
    const show = (o: THREE.Object3D) => { prev.push([o, o.visible]); o.visible = true; };
    for (const c of this.chunks) { c.lod0.forEach(show); c.lod1.forEach(show); }
    show(this.dungeonGroup);
    return () => { for (const [o, v] of prev) o.visible = v; };
  }

  /** Aktualisiert Detailstufen, Sichtweite und Lichter. */
  update(cam: THREE.Vector3, night: number, dt: number, time: number, inDungeon: boolean) {
    const vd = settings.viewDistance;
    const near = settings.graphics === 'niedrig' ? 60 : settings.graphics === 'mittel' ? 90 : 130;
    for (const c of this.chunks) {
      if (Number.isNaN(c.cx)) continue;
      const d = Math.hypot(c.cx - cam.x, c.cz - cam.z) - CHUNK * 0.7;
      const show = d < vd && !inDungeon;
      const hi = d < near || c.lod1.length === 0;
      for (const m of c.lod0) m.visible = show && hi;
      for (const m of c.lod1) m.visible = show && !hi;
    }
    this.dungeonGroup.visible = inDungeon || cam.x > 900;
    // Lichtstärken (Tag/Nacht, Flackern) nur für Quellen in Reichweite berechnen
    for (const { src: s, v } of this.lights) {
      if (s.dungeon !== inDungeon || (s.x - cam.x) ** 2 + (s.z - cam.z) ** 2 > 140 * 140) { v.intensity = 0; continue; }
      const warm = s.color !== 0x7ff6ff;
      const onFactor = inDungeon || !warm ? 1 : 0.15 + night * 0.85;
      const flick = s.flicker ? 0.85 + Math.sin(time * 13 + s.x) * 0.08 + Math.sin(time * 7.3 + s.z) * 0.07 : 1;
      v.intensity = s.intensity * onFactor * flick;
    }
  }
}
