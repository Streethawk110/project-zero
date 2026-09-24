// Verwitterung für statische Gebäude und Requisiten: Spritzschmutz und Feuchte am Sockel,
// leichte Vergrauung nach unten. Gerechnet in Modellhöhe (Ursprung = Bodenpunkt des Objekts),
// daher nur für in der Welt platzierte Objekte – nicht für Waffen oder Figuren.

import * as THREE from 'three';

const WEATHERED = /^(plaster|stone_block|stoneblock|wood|wood_dark|lower|door)/;

export function isWeatherable(name: string) {
  return WEATHERED.test(name.toLowerCase());
}

/** Kopie des Materials mit Sockelschmutz; partMatrix = Lage des Teils im Modell. */
export function weatheredMaterial(base: THREE.MeshStandardMaterial, partMatrix: THREE.Matrix4) {
  const m = base.clone();
  m.name = base.name;
  const uPart = { value: partMatrix.clone() };
  m.onBeforeCompile = (shader) => {
    shader.uniforms['uPart'] = uPart;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform mat4 uPart;
        varying float vModelY;
        varying vec3 vWPosW;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vModelY = (uPart * vec4(position, 1.0)).y;
        #ifdef USE_INSTANCING
          vWPosW = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
        #else
          vWPosW = (modelMatrix * vec4(position, 1.0)).xyz;
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vModelY;
        varying vec3 vWPosW;
        float wHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float wNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(wHash(i), wHash(i + vec2(1, 0)), f.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        // Horizontale Koordinate entlang der Wand (x+z), damit der Rand auf allen Seiten unregelmäßig ist
        float wAlong = vWPosW.x + vWPosW.z;
        float wEdge = wNoise(vec2(wAlong * 1.7, 0.5)) * 0.35 + wNoise(vec2(wAlong * 6.0, 3.1)) * 0.15;
        float splash = 1.0 - smoothstep(0.1, 0.75 + wEdge, vModelY);
        float speck = step(0.62, wNoise(vWPosW.xz * 9.0 + vWPosW.y * 7.0));
        vec3 mud = vec3(0.23, 0.19, 0.14);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * mud * 2.2, clamp(splash * (0.55 + speck * 0.3), 0.0, 1.0));
        // Leichte Vergrauung zum Boden hin über die ganze Wand
        diffuseColor.rgb *= mix(0.86, 1.0, smoothstep(0.0, 3.5, vModelY));
        float wWet = splash;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, min(1.0, roughnessFactor + 0.08), wWet);`);
  };
  m.customProgramCacheKey = () => `pz-weathered-${base.customProgramCacheKey()}`;
  return m;
}
