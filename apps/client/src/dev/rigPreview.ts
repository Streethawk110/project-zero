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
// Umgebung für Spiegelungen (wie im Spiel: Metall braucht etwas zu spiegeln)
{
  const { RoomEnvironment } = await import('three/examples/jsm/environments/RoomEnvironment.js');
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
}
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
// Phasenblatt: ?gait=walk&speed=1.4&frames=8 – dieselbe Figur an gleichmäßig verteilten Stellen des Schrittzyklus
const gait = params.get('gait');
const frames = Number(params.get('frames') ?? 8);
// Übersicht mehrerer Animationen: ?anims=jump:0.2,dodge:0.15,atk1:0.3 (Name:Zeit)
const anims = params.get('poses')
  ? (JSON.parse(params.get('poses')!) as object[]).map((p) => ({ a: 'dbg:' + JSON.stringify(p), t: 0.5 }))
  : params.get('anims')?.split(',').map((x) => { const [a, t] = x.split(':'); return { a: a!, t: Number(t ?? 0.5) }; });
const list = anims
  ? anims.map(({ a, t }) => ({ ...specs[Number(only ?? 0)]!, anim: a, t, speed: 0, weapon: a.startsWith('atk') || a.startsWith('dbg') || a === 'heavy' || a === 'block' ? (params.get('weapon') ?? 'sword_rusty') : undefined, offhand: a === 'block' ? 'shield_wood' : undefined }))
  : gait
  ? Array.from({ length: frames }, () => ({ ...specs[Number(only ?? 0)]!, anim: gait, speed: Number(params.get('speed') ?? 1.4), weapon: undefined, offhand: undefined }))
  : only !== null ? [specs[Number(only)]!] : specs;
const rigs: HumanoidRig[] = [];
(window as unknown as { __rigs: HumanoidRig[] }).__rigs = rigs;
list.forEach((s, i) => {
  const rig = new HumanoidRig({ faceSeed: params.get('seed') ? params.get('seed')! + i : undefined, appearance: { skin: s.skin, hair: params.get('hair') ? Number(params.get('hair')) : s.hair, hairColor: params.get('hc') ? Number(params.get('hc')) : i % 6, beard: params.get('beard') ? Number(params.get('beard')) : s.beard, body: s.body, height: 1, eyes: i % 4, scar: 0, sex: s.sex ?? 0 }, outfit: s.outfit });
  rig.setEquipment(s.weapon ?? '', s.offhand ?? '', s.outfit);
  rig.root.position.set((i - (list.length - 1) / 2) * 1.25, 0, 0);
  rig.root.rotation.y = Math.PI + Number(params.get('turn') ?? 0.35);
  rig.play(s.anim, 0.8);
  // Pose bis zum gewünschten Zeitpunkt vorspulen
  if (gait) {
    const cycT = (rig as unknown as { cycleLen(v: number): number }).cycleLen(s.speed) / s.speed;
    for (let k = 0; k < 100; k++) rig.update(0.02, s.speed);
    const steps = Math.round((cycT * i) / frames / 0.005);
    for (let k = 0; k < steps; k++) rig.update(0.005, s.speed);
    rig.root.position.set((i - (list.length - 1) / 2) * Number(params.get('gap') ?? 0.8), 0, 0);
  } else if (anims) {
    // t = Anteil der Aktionsdauer (0,8 s)
    for (let k = 0; k < 40; k++) rig.update(Math.max(1e-4, s.t * 0.8) / 40, s.speed);
  } else for (let k = 0; k < 40; k++) rig.update(s.t / 40 + (k < 20 ? 0.02 : 0), s.speed);
  if (params.get('talk')) { rig.talking = 5; rig.update(Number(params.get('talk')), 0); }
  if (params.get('lod') === '1') rig.setLod(1);
  if (params.get('grime')) rig.setGrime(Number(params.get('grime')));
  // Fehlersuche: Teile ausblenden (?hide=mouth,mouth_cavity)
  for (const n of (params.get('hide') ?? '').split(',').filter(Boolean)) (rig as unknown as { humanParts: Map<string, THREE.Object3D> }).humanParts?.get(n)?.traverse((o) => { o.visible = false; });
  scene.add(rig.root);
  rigs.push(rig);
});
const close = params.get('close');
function size() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  cam.aspect = w / h;
  const chest = params.get('chest');
  const face = params.get('face');
  if (face && rigs[0]) {
    // Porträt: Kamera auf Kopfhöhe der (ersten) Figur, leicht seitlich
    rigs[0].root.updateMatrixWorld(true);
    const hp = rigs[0].j.head.getWorldPosition(new THREE.Vector3());
    cam.fov = 9;
    cam.position.set(hp.x + 0.35, hp.y + 0.08, hp.z + 2.0);
    cam.lookAt(hp.x, hp.y + 0.06, hp.z);
  } else if (chest) { cam.fov = 22; cam.position.set(0.6, 1.45, 2.6); cam.lookAt(0, 1.3, 0); }
  else if (close) { cam.fov = 18; cam.position.set(0.5, 1.72, 2.2); cam.lookAt(0, 1.62, 0); }
  else { cam.fov = 30; cam.position.set(0, 1.3, 9.5 * Math.max(1, 1.6 / cam.aspect) * (list.length > 1 ? 1 : 0.45)); cam.lookAt(0, 0.95, 0); }
  cam.updateProjectionMatrix();
}
size();
addEventListener('resize', size);
renderer.render(scene, cam);
(window as unknown as { __ready: boolean }).__ready = true;
