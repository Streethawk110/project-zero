# Erinnerungen

Zusammenfassung der bisherigen Claude-Sitzungen. Neueste Einträge oben.

## 2026-09-24 – Cloud-Sitzung: Grafik-Offensive (Fortsetzung)

**Wünsche des Nutzers**
- Chat nur auf Deutsch. Weniger Standbilder bei Ultra (nur dort!), Grafik
  „wie echte Spiele / 4K“, Auflösung + FPS-Limit einstellbar, Wolken.
  Danach Schwerpunkt **Texturen** (Bibliotheken oder Blender erlaubt).
- Keine langen Testläufe ohne Not (Nutzer hat Messläufe abgebrochen).

**Erledigt**
- Ruckler: feste Lichtanzahl (`render/lights.ts`, virtuelle Lichter statt
  `visible`-Umschalten → keine Shader-Neuübersetzung), Vorladen aller
  Geometrie/Shader beim Laden (`Game.prewarm`), Env-Map ohne Neuanlage
  (CubeCamera + `fromCubemap` mit Wiederverwendung), Grafik-Neuaufbau nur
  bei Grafikänderungen (`graphicsKey`).
- Neue Pipeline (`render/renderer.ts`): ScenePass (HDR, MSAA optional) →
  GTAO → Atmosphäre (Höhennebel, Sonnenstreuung, Wolken einsetzen,
  Wolkenschatten, Lichtstrahlen) → Bloom → Grading → SMAA.
- Volumetrische Wolken (`render/clouds.ts`), Rauschtextur vorberechnet
  (`tools/dev/bake-clouds.ts` → `public/assets/textures/cloud-noise-64.bin`).
- Einstellungen: Renderauflösung (nativ/720p–4K), Skalierung 50–200 %,
  FPS-Limit, FPS-Anzeige, Schatten-/Wolken-/Texturqualität, AO,
  Lichtstrahlen, Kantenglättung, Vegetationsdichte.
- Achtung three r180: `GTAOPass` mit eigener Tiefentextur ohne Normalen
  stürzt ab → GTAO rendert eigenen G-Buffer.
- Testen ohne GPU: `tools/dev/shot-game.mjs` (klickt per JS; mit
  `fpsCap` 2–4 und Schatten „niedrig“, sonst zu langsam).

## 2026-09-24 – Cloud-Sitzung: Start „Project Zero“

**Auftrag**
- Großes 3D-Story-RPG „Project Zero“: Browser + installierbare App, Three.js,
  vollständiger Einzelspieler (offline) + echter Online-Multiplayer über den
  eigenen Server des Nutzers. Vollständige Anforderungen stehen im Chat
  (14 Abschnitte); Designentscheidungen in `docs/DESIGN.md`.
- **Nutzerentscheidung:** reines Computerspiel – kein Android/iOS, keine
  Touch-Steuerung. Ziele: Browser, PWA, Desktop (Windows/macOS/Linux).

**Stand**
- Monorepo (npm-Workspaces): `packages/shared` (Simulation, Inhalte,
  Protokoll), `apps/client`, `apps/server`, `tools/blender`, `deploy`.
- Gemeinsame Welt-Simulation fertig und getestet (10 Vitest-Tests):
  Gelände, Kollision, Bewegung, Kampf, Gegner-KI, 3-Phasen-Boss, 39 Skills,
  Inventar/Handwerk/Händler, Quests, Dialoge, Begleiterin Isra,
  Welt-Ereignisse, Rätsel, Erfolge.
- Umgebung: Blender läuft headless über `bpy` (venv `/opt/bpyenv`, nicht im
  Repo). Android-SDK und GitHub-Releases sind hier per Netzwerk gesperrt.

- 3D-Client läuft (in headless Chromium geprüft): Menü mit Weltflug,
  Charaktererstellung, Einzelspieler mit Isra, Kampf, HUD, alle Fenster
  (Inventar, Charakter, Skillbaum, Journal, Karte, Händler, Handwerk, Rast,
  Stele, Handel, Einstellungen mit Tastenbelegung), Speicherplätze mit
  Export/Import, prozedurale Audio-Engine und Musik.
- Test-Hinweis: headless Chromium mit SwiftShader ist sehr langsam; für
  Screenshots das Grafikprofil „niedrig“ setzen (`tools/dev/shot.mjs`, `LOW=1`).
  Playwright ist auf 1.56.0 gepinnt (passt zum vorinstallierten Chromium 1194).

- Mehrspieler-Server fertig (`apps/server`): Konten (scrypt), SQLite mit
  Migrationen, Oberwelt-Shards à 16 Spieler, Dungeon-Instanzen je Gruppe,
  Gruppen, Chat, Markierungen, Duelle, Handel, Wiederverbindung (90 s
  Gnadenfrist), Speicherung alle 20 s, Sicherungen, Rate-Limits.
  9 Server-Integrationstests grün; Browser-Test mit 2 Spielern erfolgreich.
  Testzugänge: tester1/tester2, Passwort „zero-test“ (`PZ_ALLOW_TEST_ACCOUNTS=1`).

- Blender-Modelle fertig (`tools/blender/*.py`, Einstieg `build_all.py`):
  75 Modelle (Gebäude, Requisiten, Natur mit LOD1, Figurenteile, Waffen,
  Kreaturen) → `apps/client/public/assets/models` + `manifest.json`.
  Danach `node tools/models/optimize.mjs` (Meshopt, ~2,7 MB → 1 MB; Rig-Teile
  bleiben unkomprimiert, weil die Quantisierung Knotentransformationen
  einführt). Vorschau-Renderer: `tools/blender/preview.py` (Cycles, CPU).
  Im Spiel geprüft (Dorf, Figuren, Schild-Ausrichtung korrigiert).

- PWA fertig: `manifest.webmanifest`, Symbole (`tools/dev/icons.mjs`),
  `public/sw.js` mit Precache-Liste aus dem Build (Vite-Plugin in
  `vite.config.ts`). Einzelspieler startet offline.
- E2E-Tests (`npm run build && npm run test:e2e`, Playwright): Einzelspieler
  (Pause stoppt die Welt, Speichern/Export/Laden), Offline-PWA, 2 echte
  Online-Spieler mit Chat – alle 3 grün. Der Testserver liefert den gebauten
  Client selbst aus (`tests/e2e/start-test-server.mjs`, Port 8799).
- Behoben: Server-`isMain` griff bei jedem Dateinamen auf „server.mjs“;
  `stop()` schließt jetzt auch Keep-Alive-Verbindungen.
- GitHub-Releases sind inzwischen erreichbar → Electron-Download möglich.

- Desktop-App (`apps/desktop`, Electron, eigenes `app://`-Protokoll, nicht im
  npm-Workspace): Linux-Build gebaut und unter Xvfb gestartet (`--smoke`).
  Windows/macOS nur konfiguriert, nicht getestet.
- Deployment (`deploy/`): nginx-/Apache-Ausschnitte für die BESTEHENDE Seite
  (Spiel unter `/spiel/`, Server unter `/pz/`), systemd, Docker,
  `package.sh`/`install.sh`/`backup.sh`/`restore.sh`. `install.sh` bricht ab,
  wenn WEB_DIR fremde Dateien enthält, und behält `config.json`.
  Geprüft: nginx 1.24 lokal + alle 3 E2E-Tests über nginx grün; Docker-
  Laufzeit-Image gesund; Build-Stufe im Container wegen Proxy ungetestet.
- Server-Bundle enthält jetzt `ws` → auf dem Server nur Node ≥ 22.5 nötig.
- Vite-Dev-Server reicht `/pz` an `localhost:8787` weiter.
- README komplett (Start, Steuerung, Modi, Tests, Modelle, Apps,
  Veröffentlichung, Konfiguration, ehrliche Grenzen).

- Neue Tests: `content.test.ts` (alle Verweise/Flags auflösbar, keine
  Quest-Sackgassen; per Mutation geprüft) und `boss.test.ts` (3 Phasen,
  Säulen, Nullpuls, Skalierung, Zurücksetzen). Jetzt 28 Unit-Tests + 3 E2E.

- Spielbare Web-Fassung (nur Einzelspieler) als privates Artifact:
  https://claude.ai/artifact/5rbSisefuvQXjACC37VpHZ (Modelle dafür als
  eingebettete `.gltf.json`, da `.glb` dort nicht erlaubt ist; nicht im Repo).
- Nutzer will lokal weiterarbeiten: `claude --teleport` im eigenen Terminal
  (im Projektordner), Sitzung `session_014K5hn531XejJHioneCKYqy`.

**Offen**
- Nutzer nach Serverdaten fragen (Hosting-Art, Node verfügbar?, Domain,
  Zugang, bestehende Webseite/Webserver) und dann veröffentlichen.
- Längere Spieltests/Balance; Leistung auf echter GPU messen.
  Serverdaten des Nutzers (Hosting, Domain) noch unbekannt.

## 2026-09-24 – Cloud-Sitzung (claude.ai/code)

**Besprochen**
- Diese Sitzung läuft in einem Cloud-Container. Das Repo wurde frisch von
  GitHub geklont, und der Container ist nur vorübergehend: Nur Gepushtes bleibt.
- Cloud ↔ Desktop funktioniert über Git: Claude pusht hier, lokal `git pull`
  (und umgekehrt). Eine Cloud-Sitzung lässt sich mit `claude --teleport` auf
  den eigenen Rechner holen. Zurück in die Cloud geht es über eine neue
  Cloud-Sitzung auf dem gepushten Branch.
- Remote Control ist **keine** Cloud-Arbeit: Claude läuft dabei weiter auf dem
  eigenen Rechner, Browser/Handy sind nur die Fernbedienung. Der Rechner muss
  dafür an sein.

**Erledigt**
- Branch `claude/eloquent-goodall-v3l62r` auf GitHub gepusht.
- `CLAUDE.md` und diese Datei angelegt: Claude fasst den Chatverlauf vor jedem
  Push hier zusammen.

**Offen**
- Noch kein Projektinhalt, das Repo enthält nur die `README.md`. Wie es mit
  dem Projekt weitergeht, ist noch offen.
