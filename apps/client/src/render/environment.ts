// Himmel, Sonne, Mond, Sterne, Nebel, Umgebungslicht, Tag-Nacht-Wechsel und Wetterstimmung.

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { settings } from '../settings.ts';
import type { AtmosphereState } from './renderer.ts';

const tmpC = new THREE.Color();

function lerpColor(stops: [number, number][], t: number, out: THREE.Color) {
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i]!, [b, cb] = stops[i + 1]!;
    if (t >= a && t <= b) {
      const k = (t - a) / (b - a || 1);
      return out.setHex(ca).lerp(tmpC.setHex(cb), k);
    }
  }
  return out.setHex(stops[stops.length - 1]![1]);
}

export class Environment {
  sky: Sky;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  ambient: THREE.AmbientLight;
  stars: THREE.Points;
  moon: THREE.Mesh;
  fog: THREE.FogExp2;
  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envSky: Sky;
  private envRT: THREE.WebGLRenderTarget | null = null;
  // Feste Würfelkarte + wiederverwendetes PMREM-Ziel: keine Speicherreservierung beim Aktualisieren
  private cubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: false });
  private cubeCam = new THREE.CubeCamera(0.1, 200, this.cubeRT);
  private lastEnvKey = '';
  sunDir = new THREE.Vector3();
  nightFactor = 0;
  lightning = 0;
  private lightningT = 5;
  inDungeon = false;
  weather = 'clear';
  wInt = 0;
  onThunder: ((dist: number) => void) | null = null;
  readonly skyTop = new THREE.Color(0.25, 0.42, 0.72);
  readonly skyHorizon = new THREE.Color(0.7, 0.76, 0.82);
  private time = 0;

  /** Schattenauflösung und -bereich nach Qualitätsstufe (auch zur Laufzeit änderbar). */
  applyShadowSettings() {
    const q = settings.shadowQuality;
    const size = q === 'ultra' ? 6144 : q === 'hoch' ? 4096 : q === 'mittel' ? 2048 : 1024;
    const ext = q === 'ultra' ? 80 : q === 'hoch' ? 70 : q === 'mittel' ? 55 : 42;
    const sh = this.sun.shadow;
    if (sh.mapSize.x !== size) {
      sh.map?.dispose();
      sh.map = null as unknown as THREE.WebGLRenderTarget;
      sh.mapSize.set(size, size);
    }
    const cam = sh.camera;
    cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext;
    cam.near = 1; cam.far = 400;
    cam.updateProjectionMatrix();
    // Weichere Kanten bei höherer Auflösung
    sh.radius = q === 'ultra' ? 4 : 3;
    sh.blurSamples = q === 'ultra' ? 16 : 8;
  }

  /** Zustand für Wolken und Atmosphären-Stufe. */
  atmosphere(): AtmosphereState {
    const target = this.weather === 'rain' ? 0.92 : this.weather === 'cloudy' ? 0.75 : this.weather === 'nullstorm' ? 0.85 : this.weather === 'fog' ? 0.6 : 0.36;
    return {
      sunDir: this.sunDir.y > -0.05 ? this.sunDir : tmpV.copy(this.sunDir).multiplyScalar(-1).clone(),
      sunColor: this.sun.color,
      sunIntensity: this.sun.intensity,
      fogColor: this.fog.color,
      fogDensity: this.fog.density,
      skyTop: this.skyTop,
      skyHorizon: this.skyHorizon,
      coverage: 0.36 + (target - 0.36) * this.wInt,
      night: this.nightFactor,
      inDungeon: this.inDungeon,
      time: this.time,
    };
  }

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer) {
    this.sky = new Sky();
    this.sky.scale.setScalar(4500);
    this.sky.frustumCulled = false;
    const u = this.sky.material.uniforms;
    u['turbidity']!.value = 4;
    u['rayleigh']!.value = 1.6;
    u['mieCoefficient']!.value = 0.004;
    u['mieDirectionalG']!.value = 0.82;
    scene.add(this.sky);

    this.envSky = new Sky();
    this.envSky.scale.setScalar(100);
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.sun = new THREE.DirectionalLight(0xfff1d6, 3);
    this.sun.castShadow = settings.shadows;
    this.applyShadowSettings();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbcd3ff, 0x4a3f2c, 0.6);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.05);
    scene.add(this.ambient);

    // Sterne
    const n = 2500;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u1 = Math.random(), v1 = Math.random() * 0.95;
      const th = u1 * Math.PI * 2, ph = Math.acos(1 - v1);
      pos[i * 3] = Math.sin(ph) * Math.cos(th) * 3000;
      pos[i * 3 + 1] = Math.cos(ph) * 3000;
      pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 3000;
      const w = 0.7 + Math.random() * 0.3;
      col[i * 3] = w; col[i * 3 + 1] = w; col[i * 3 + 2] = w + Math.random() * 0.2;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    this.moon = new THREE.Mesh(new THREE.SphereGeometry(60, 24, 16), new THREE.MeshBasicMaterial({ color: 0xdfe8ff, fog: false, transparent: true }));
    this.moon.frustumCulled = false;
    scene.add(this.moon);

    this.fog = new THREE.FogExp2(0x9fb2c4, 0.0022);
    scene.fog = this.fog;
  }

  update(dayTime: number, weather: string, wInt: number, center: THREE.Vector3, camPos: THREE.Vector3, dt: number, inDungeon: boolean) {
    this.inDungeon = inDungeon;
    this.time += dt;
    this.weather = weather;
    this.wInt = wInt;
    // Sonnenstand: 0.25 Aufgang, 0.5 Mittag, 0.75 Untergang
    const ang = (dayTime - 0.25) * Math.PI * 2;
    const elev = Math.sin(ang);
    const az = Math.cos(ang);
    this.sunDir.set(az * 0.8, elev, 0.35).normalize();
    const day = THREE.MathUtils.smoothstep(elev, -0.12, 0.18);
    this.nightFactor = 1 - day;
    const u = this.sky.material.uniforms;
    u['sunPosition']!.value.copy(this.sunDir);
    const storm = weather === 'nullstorm' ? wInt : 0;
    const overcast = (weather === 'rain' || weather === 'cloudy' || weather === 'fog' ? 1 : 0.2) * wInt;
    u['turbidity']!.value = 3 + overcast * 12;
    u['rayleigh']!.value = 1.4 + overcast * 1.5 - storm * 0.8;
    this.sky.visible = !inDungeon;
    this.stars.visible = !inDungeon;
    this.moon.visible = !inDungeon;
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, this.nightFactor - overcast * 0.8) * 0.95;
    this.stars.position.copy(camPos);
    this.sky.position.copy(camPos);
    this.moon.position.copy(camPos).addScaledVector(this.sunDir, -2600);
    (this.moon.material as THREE.MeshBasicMaterial).opacity = this.nightFactor * (1 - overcast * 0.7);

    // Licht folgt dem Spieler (Schattenkamera mit Texel-Einrastung)
    const lightDir = elev > -0.05 ? this.sunDir : tmpV.copy(this.sunDir).multiplyScalar(-1);
    const snap = 1;
    const cx = Math.round(center.x / snap) * snap, cz = Math.round(center.z / snap) * snap;
    this.sun.target.position.set(cx, center.y, cz);
    this.sun.position.set(cx, center.y, cz).addScaledVector(lightDir, 180);
    this.sun.target.updateMatrixWorld();

    // Farben
    const sunCol = lerpColor([[-1, 0x7a8cc8], [-0.05, 0x7a8cc8], [0.04, 0xff9a52], [0.25, 0xffd7a8], [1, 0xfff4e2]], elev, new THREE.Color());
    // Himmelsfarben für die Wolkenbeleuchtung
    lerpColor([[-1, 0x02040a], [-0.08, 0x0a1224], [0.05, 0x46526e], [0.25, 0x3f6ea8], [1, 0x3a6db0]], elev, this.skyTop);
    lerpColor([[-1, 0x05080f], [-0.08, 0x1a2234], [0.04, 0xe39a6a], [0.25, 0xb7c6d6], [1, 0xc4d3e0]], elev, this.skyHorizon);
    const fogDay = lerpColor([[-1, 0x0b1220], [-0.08, 0x141c2c], [0.05, 0xc98a62], [0.25, 0xa9b9c9], [1, 0xb5c7d6]], elev, new THREE.Color());
    let sunI = elev > -0.05 ? THREE.MathUtils.lerp(0.4, 3.2, THREE.MathUtils.smoothstep(elev, -0.05, 0.4)) : 0.35; // Mondlicht
    sunI *= 1 - overcast * 0.55;
    let hemiI = THREE.MathUtils.lerp(0.18, 0.75, day);
    let fogDensity = 0.0018 + overcast * 0.002;
    if (weather === 'fog') fogDensity += 0.014 * wInt;
    if (weather === 'rain') fogDensity += 0.004 * wInt;
    if (storm > 0) {
      fogDay.lerp(tmpC.setHex(0x3a2f5c), storm * 0.6);
      sunCol.lerp(tmpC.setHex(0x9fe9ff), storm * 0.5);
      fogDensity += 0.004 * storm;
    }
    // Blitze bei Regen/Nullsturm
    this.lightningT -= dt;
    if ((weather === 'rain' || weather === 'nullstorm') && wInt > 0.6 && this.lightningT <= 0 && !inDungeon) {
      this.lightningT = 6 + Math.random() * 14;
      if (Math.random() < (weather === 'nullstorm' ? 0.8 : 0.4)) {
        this.lightning = 1;
        this.onThunder?.(200 + Math.random() * 1200);
      }
    }
    this.lightning = Math.max(0, this.lightning - dt * 3.5);
    const flash = this.lightning > 0.6 || (this.lightning > 0.2 && this.lightning < 0.35) ? this.lightning : 0;

    if (inDungeon) {
      // Unter Tage: kein Himmelslicht, dunkler Nebel
      this.sun.intensity = 0;
      this.sun.castShadow = false;
      this.hemi.intensity = 0.12;
      this.hemi.color.setHex(0x6a7a9a);
      this.hemi.groundColor.setHex(0x1a1410);
      this.ambient.intensity = 0.25;
      this.ambient.color.setHex(0x4a5570);
      this.fog.color.setHex(0x05070a);
      this.fog.density = 0.035;
      this.renderer.toneMappingExposure = 1.15;
    } else {
      this.sun.castShadow = settings.shadows;
      this.sun.color.copy(sunCol);
      this.sun.intensity = sunI + flash * 4;
      this.hemi.intensity = hemiI + flash * 1.5;
      this.hemi.color.copy(fogDay).lerp(tmpC.setHex(0xbcd3ff), 0.4);
      this.hemi.groundColor.setHex(0x3b3226).multiplyScalar(0.4 + day * 0.6);
      this.ambient.intensity = 0.04 + this.nightFactor * 0.1;
      this.ambient.color.setHex(0x8aa0d0);
      this.fog.color.copy(fogDay).multiplyScalar(1 + flash * 0.8);
      this.fog.density = fogDensity;
      this.renderer.toneMappingExposure = THREE.MathUtils.lerp(0.62, 0.95, day) + flash * 0.4;
    }

    // Umgebungsreflexionen gelegentlich neu erzeugen – verteilt auf 7 Bilder (je eine Würfelseite,
    // dann die Filterung), damit kein einzelnes Bild die ganze Arbeit trägt (sonst Ruckler).
    const envKey = `${Math.round(dayTime * 60)}-${weather}-${Math.round(wInt * 4)}-${inDungeon}`;
    if (envKey !== this.lastEnvKey && settings.graphics !== 'niedrig' && this.envStage < 0) {
      this.lastEnvKey = envKey;
      const eu = this.envSky.material.uniforms;
      eu['sunPosition']!.value.copy(this.sunDir);
      eu['turbidity']!.value = u['turbidity']!.value;
      eu['rayleigh']!.value = u['rayleigh']!.value;
      eu['mieCoefficient']!.value = 0.004;
      this.envTarget = { dungeon: inDungeon, intensity: THREE.MathUtils.lerp(0.15, 0.7, day) * (1 - overcast * 0.4) };
      if (!this.envRT) {
        // Erstes Mal sofort (sonst startet die Szene ohne Umgebungslicht)
        this.cubeCam.update(this.renderer, this.envScene);
        this.envStage = 6;
      } else this.envStage = 0;
    }
    this.stepEnvironment();
  }

  private envStage = -1;
  private envTarget = { dungeon: false, intensity: 0.5 };

  private stepEnvironment() {
    if (this.envStage < 0) return;
    const r = this.renderer;
    if (this.envStage < 6) {
      const cc = this.cubeCam;
      if (cc.parent === null) cc.updateMatrixWorld();
      if (cc.coordinateSystem !== r.coordinateSystem) {
        cc.coordinateSystem = r.coordinateSystem;
        cc.updateCoordinateSystem();
      }
      const prev = r.getRenderTarget();
      r.setRenderTarget(this.cubeRT, this.envStage);
      r.render(this.envScene, cc.children[this.envStage] as THREE.Camera);
      r.setRenderTarget(prev);
      this.envStage++;
      return;
    }
    this.envRT = this.pmrem.fromCubemap(this.cubeRT.texture, this.envRT);
    this.scene.environment = this.envTarget.dungeon ? null : this.envRT.texture;
    this.scene.environmentIntensity = this.envTarget.intensity;
    this.envStage = -1;
  }
}

const tmpV = new THREE.Vector3();
