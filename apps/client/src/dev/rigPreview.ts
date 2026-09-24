// Entwickler-Vorschau: mehrere Figuren in verschiedenen Outfits und Posen, mit der Spiel-Engine
// gerendert (http://localhost:5173/rig-preview.html). Nicht Teil des Spiel-Builds.
import * as THREE from 'three';
import { loadManifest, preloadModels } from '../render/models.ts';
import { loadBakedTextures, loadFoliageTextures } from '../render/textures.ts';
import { loadHumanTextures } from '../render/human.ts';
import { HumanoidRig } from '../render/rig.ts';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
(window as unknown as { __scene: THREE.Scene }).__scene = scene;
scene.background = new THREE.Color(0x8fa3b8);
const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x4a3f2c, 1.2));
const sun = new THREE.DirectionalLight(0xfff0d8, 3);
sun.position.set(3, 6, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 6, bottom: -2 });
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.MeshStandardMaterial({ color: 0x6b6250, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

await loadManifest();
await loadBakedTextures(512);
await preloadModels(() => {});
await loadFoliageTextures(1024);
await loadHumanTextures();

const specs: { outfit: string; hair: number; beard: number; anim: string; t: number; speed: number; weapon?: string; offhand?: string; skin: number; body: number; sex?: number }[] = [
  { outfit: 'armor_gambeson', hair: 0, beard: 0, anim: 'idle', t: 1, speed: 0, skin: 1, body: 0.5 },
  { outfit: 'villager', hair: 2, beard: 0, anim: 'walk', t: 0.6, speed: 2, skin: 2, body: 0.3, sex: 1 },
  { outfit: 'armor_chain', hair: 1, beard: 1, anim: 'run', t: 0.4, speed: 5, weapon: 'sword_rusty', offhand: 'shield_wood', skin: 1, body: 0.8 },
  { outfit: 'armor_robe', hair: 4, beard: 2, anim: 'cast', t: 0.35, speed: 0, weapon: 'staff_oak', skin: 3, body: 0.5 },
  { outfit: 'armor_leather', hair: 1, beard: 0, anim: 'atk1', t: 0.25, speed: 0, weapon: 'sword_rusty', skin: 1, body: 0.6, sex: 1 },
  { outfit: 'guard', hair: 0, beard: 1, anim: 'block', t: 0.5, speed: 0, weapon: 'sword_steel', offhand: 'shield_guard', skin: 0, body: 0.9 },
  { outfit: 'scholar', hair: 4, beard: 0, anim: 'idle', t: 1, speed: 0, weapon: 'bow_short', skin: 1, body: 0.35, sex: 1 },
];
const only = params.get('only');
const list = only !== null ? [specs[Number(only)]!] : specs;
const rigs: HumanoidRig[] = [];
list.forEach((s, i) => {
  const rig = new HumanoidRig({ faceSeed: params.get('seed') ? params.get('seed')! + i : undefined, appearance: { skin: s.skin, hair: s.hair, hairColor: i % 6, beard: s.beard, body: s.body, height: 1, eyes: i % 4, scar: 0, sex: s.sex ?? 0 }, outfit: s.outfit });
  rig.setEquipment(s.weapon ?? '', s.offhand ?? '', s.outfit);
  rig.root.position.set((i - (list.length - 1) / 2) * 1.25, 0, 0);
  rig.root.rotation.y = Math.PI + Number(params.get('turn') ?? 0.35);
  rig.play(s.anim, 0.8);
  // Pose bis zum gewünschten Zeitpunkt vorspulen
  for (let k = 0; k < 40; k++) rig.update(s.t / 40 + (k < 20 ? 0.02 : 0), s.speed);
  if (params.get('talk')) { rig.talking = 5; rig.update(Number(params.get('talk')), 0); }
  if (params.get('lod') === '1') rig.setLod(1);
  scene.add(rig.root);
  rigs.push(rig);
});
const close = params.get('close');
function size() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  cam.aspect = w / h;
  if (close) { cam.fov = 18; cam.position.set(0.5, 1.72, 2.2); cam.lookAt(0, 1.62, 0); }
  else { cam.fov = 30; cam.position.set(0, 1.3, 9.5 * Math.max(1, 1.6 / cam.aspect) * (list.length > 1 ? 1 : 0.45)); cam.lookAt(0, 0.95, 0); }
  cam.updateProjectionMatrix();
}
size();
addEventListener('resize', size);
renderer.render(scene, cam);
(window as unknown as { __ready: boolean }).__ready = true;
