# Erinnerungen

Zusammenfassung der bisherigen Claude-Sitzungen. Neueste Einträge oben.

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

**Offen**
- Multiplayer-Server, Blender-Modelle (Figuren/Gebäude sind noch
  Ersatzformen), PWA/Desktop-App, Deployment, README.
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
