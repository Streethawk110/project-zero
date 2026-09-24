# Project Zero

Ein 3D-Story-RPG für **Browser, installierbare Web-App (PWA) und Desktop** (Windows, macOS, Linux),
gebaut mit Three.js. Es gibt einen vollständigen **Einzelspieler**, der ohne Internet läuft, und einen
echten **Online-Mehrspieler** über deinen eigenen Server.

Die Geschichte spielt in der Aschenmark rund um das Dorf Haldenbruck: Ein Riss aus „Nulllicht“ hat das
Tal verändert, drei Fraktionen streiten um seine Deutung, und du hast keine Erinnerung daran, wer du warst.
Welt, Figuren, Fraktionen, Kreaturen, Wendungen und das Geheimnis stehen in [`docs/DESIGN.md`](docs/DESIGN.md).

---

## Inhalt

- [Schnellstart (lokal)](#schnellstart-lokal)
- [Steuerung](#steuerung)
- [Spielmodi](#spielmodi)
- [Projektaufbau](#projektaufbau)
- [Tests](#tests)
- [3D-Modelle (Blender)](#3d-modelle-blender)
- [Installierbare App (PWA) und Desktop-App](#installierbare-app-pwa-und-desktop-app)
- [Veröffentlichen auf dem eigenen Server](#veröffentlichen-auf-dem-eigenen-server)
- [Konfiguration](#konfiguration)
- [Bekannte Grenzen](#bekannte-grenzen)

---

## Schnellstart (lokal)

Voraussetzung: **Node.js 22.5 oder neuer** (der Server nutzt das eingebaute `node:sqlite`).

```bash
npm install
npm run dev          # Spiel-Client auf http://localhost:5173
npm run dev:server   # Spielserver auf http://localhost:8787 (in einem zweiten Terminal)
```

- **Einzelspieler:** Im Hauptmenü „Einzelspieler“ → „Neues Spiel“. Der Server wird dafür nicht gebraucht.
- **Mehrspieler zu zweit testen, ohne Konten anzulegen:** `npm run dev:server` schaltet Testzugänge frei.
  Öffne das Spiel in zwei Browserfenstern (z. B. eines davon privat), wähle „Online-Mehrspieler“ und melde
  dich mit `tester1` bzw. `tester2` an, Passwort `zero-test`. Der Entwicklungsserver reicht `/pz` an den
  Spielserver weiter, die Serveradresse muss also nicht eingetragen werden.
  Testzugänge sind nur aktiv, wenn `PZ_ALLOW_TEST_ACCOUNTS=1` gesetzt ist, nie in der Beispielkonfiguration.

Produktions-Build:

```bash
npm run build        # apps/client/dist (Web-Client) und apps/server/dist/server.mjs (Server, eine Datei)
npm start            # Server aus dem Build starten
```

## Steuerung

Alle Tasten lassen sich unter **Einstellungen → Steuerung** neu belegen. Controller (Xbox-Layout) wird erkannt.

| Aktion | Tastatur/Maus | Controller |
|---|---|---|
| Bewegen / Kamera | W A S D / Maus | linker / rechter Stick |
| Angriff (halten = schwer) | linke Maustaste | RT |
| Blocken | rechte Maustaste | LT |
| Ausweichen | Alt links oder V | B |
| Springen / Sprinten / Gehen | Leertaste / Umschalt links / Feststell | A / L3 / – |
| Interagieren | E | Y |
| Fähigkeiten 1–6 | 1–6 | X, LB, Steuerkreuz |
| Heiltrank | Q | RB |
| Nullsicht | F | R3 |
| Gleichklang (Koop-Kombo) | G | – |
| Waffenset wechseln | X | – |
| Inventar / Charakter / Fähigkeiten | I oder Tab / C / K | – |
| Aufträge / Kodex / Karte | L / J / M | – / – / Select |
| Gruppe / Chat / Emotes | P / Eingabe / T | – |
| Befehl an Isra (Begleiterin) | R | – |
| Pause und Menü | Esc | Start |

Einstellungen: Grafikprofile (Ultra/Hoch/Mittel/Niedrig), Auflösungsskala, Sichtweite, Schatten, Bloom,
Gras, Sichtfeld, Lautstärken (Gesamt/Musik/Effekte/Umgebung/Stimmen), Untertitel, reduzierte Effekte
(weniger Wackeln/Blitze), Maus-Empfindlichkeit, Y-Achse umkehren, Serveradresse.

## Spielmodi

**Einzelspieler** – die ganze Hauptgeschichte ist allein spielbar. Die Welt läuft vollständig im Browser.
Isra Venn begleitet dich (markiert Ziele, heilt in Grenzen, lenkt ab, hilft beim Wiederaufstehen).
Pause hält die Welt wirklich an. Spielstände: 5 Plätze plus automatische Sicherung (alle 2 Minuten und beim
Verlassen), Export und Import als JSON-Datei mit Prüfsumme.

**Online-Mehrspieler** – der Server ist maßgeblich: Er berechnet Bewegung, Kampf, Beute und Fortschritt,
der Client zeigt nur an und sagt die eigene Bewegung voraus. Oberwelt-Instanzen mit bis zu 16 Spielern,
Dungeon-Instanzen pro Gruppe, Gruppen bis 5, Chat (Umgebung/Gruppe/Welt), Emotes, Kartenmarkierungen,
Wiederbeleben, faire Beute (jeder sieht eigene Beute), Gleichklang-Kombos, Zwillingstür für zwei Spieler,
freiwillige Duelle, Handel, dauerhafte Charaktere, Wiederverbindung innerhalb von 90 Sekunden.

**Trennung:** Einzelspieler-Spielstände und Online-Charaktere sind vollständig getrennt. Es gibt bewusst
keine Übertragung zwischen beiden – ein lokaler Spielstand lässt sich beliebig bearbeiten und darf deshalb
nie Online-Fortschritt erzeugen.

## Projektaufbau

```
packages/shared   Gemeinsame Spielregeln: Welt, Gelände, Kollision, Kampf, KI, Boss, Fähigkeiten,
                  Gegenstände, Aufträge, Dialoge, Ereignisse, Rätsel, Protokoll (läuft in Browser und Server)
apps/client       Three.js-Client: Rendering, UI, Audio, Eingabe, Spielstände, PWA
apps/server       Node.js-Spielserver: Konten, SQLite + Migrationen, Instanzen, WebSocket, HTTP-API
apps/desktop      Electron-Hülle für Windows, macOS und Linux
tools/blender     Reproduzierbare Blender-Skripte für alle 3D-Modelle
tools/models      Kompression der Modelle (meshopt)
tools/dev         Hilfsskripte (Screenshots, Symbole, Zwei-Spieler-Test)
tests/e2e         Playwright-Tests (Einzelspieler, Offline, zwei Online-Spieler)
deploy            nginx, Apache, systemd, Docker, Installations- und Sicherungsskripte
docs/DESIGN.md    Entscheidungen, Welt, Geschichte, Fraktionen, Figuren, Kreaturen, Mechaniken
```

## Tests

```bash
npm run typecheck      # TypeScript in allen Paketen
npm test               # 28 Vitest-Tests: Simulation (10), Inhaltsprüfung (6), Boss (3), Server (9)
npm run build && npm run test:e2e   # 3 Playwright-Tests im Browser
```

Die Inhaltsprüfung löst jeden Verweis in Aufträgen, Dialogen, Objekten, Beute, Rezepten und Händlern
auf und stellt sicher, dass jedes abgefragte Flag irgendwo gesetzt wird – so fallen Sackgassen in Aufträgen
sofort auf. Die E2E-Tests starten einen echten Spielserver mit frischer Datenbank, der auch den gebauten Client
ausliefert. Geprüft werden: neues Einzelspiel, Pause stoppt die Welt, Speichern/Export/Laden; Offline-Start
über den Service Worker; zwei echte Online-Spieler sehen sich und chatten. Gegen eine laufende Installation,
z. B. hinter nginx: `PZ_E2E_BASE_URL=https://example.de/spiel/ npx playwright test`.

## 3D-Modelle (Blender)

Alle Modelle entstehen aus Python-Skripten in `tools/blender` (Gebäude, Requisiten, Ruinen, Bäume, Felsen
mit LOD-Stufe, Figurenteile für das Rig, Waffen, Kreaturen). Ergebnis: GLB-Dateien und `manifest.json` in
`apps/client/public/assets/models`. Die fertigen Dateien liegen im Repository, Blender wird nur zum Ändern
gebraucht.

```bash
# Mit Blender (4.2 oder neuer) im Hintergrundmodus:
blender -b -P tools/blender/build_all.py            # alle Modelle
blender -b -P tools/blender/build_all.py -- inn well # nur einzelne
# oder mit dem bpy-Python-Modul:  python3 tools/blender/build_all.py
npm run models:optimize                              # meshopt-Kompression (~2,7 MB → 1 MB)
```

`tools/blender/preview.py` rendert Vorschaubilder (Cycles). Fehlt ein Modell, zeigt das Spiel automatisch
eine einfache Ersatzform – es bleibt also immer spielbar. Materialnamen aus Blender (z. B. `wood`, `plaster`,
`stone_moss`, `crystal`) werden im Client durch prozedurale PBR-Materialien ersetzt.

## Texturen (Blender)

Alle Oberflächen sind nahtlos kachelbare 2K-PBR-Texturen, gebacken aus prozeduralen Blender-Materialien
(`tools/blender/textures.py`): 8 Bodenarten (Wiese, Erde, Fels, Sand, Waldboden, Glasnarbe, Schnee,
Kopfsteinpflaster) und 10 Bau-/Objektmaterialien (Holzbohlen, Kalkputz, Stroh, Tonziegel, Mauerwerk, Rinde,
Eisen, Stoff, Leder, Haut). Je Material: Farbe, Normalen, sowie R = Umgebungsverdeckung, G = Rauheit,
B = Höhe. Das Gelände mischt die Schichten höhenbasiert (Gras in Pflasterfugen, Sand in Felsspalten) und
bricht die Kachelwiederholung auf.

```bash
python3 tools/blender/textures.py              # alle (2048 px, ~20 min auf der CPU)
PZ_TEX_SIZE=1024 python3 tools/blender/textures.py grass rock   # einzelne, kleiner
python3 tools/blender/preview_tex.py apps/client/public/assets/textures vorschau.png grass rock
```

## Installierbare App (PWA) und Desktop-App

**PWA:** Der Web-Build ist installierbar (Manifest, Symbole, Service Worker). Nach dem ersten Besuch sind
alle Dateien gespeichert, der Einzelspieler startet dann auch ohne Internet. Installieren: in Chrome/Edge
über das Installationssymbol in der Adressleiste. Nach einem Update lädt der Service Worker die neue
Version im Hintergrund; sie gilt beim nächsten Start.

**Desktop-App** (`apps/desktop`, Electron): lädt denselben Web-Build über ein eigenes, sicheres Protokoll,
mit Vollbild (F11) und „Beenden“ im Hauptmenü.

```bash
npm run build                          # Web-Client bauen
npm --prefix apps/desktop install      # einmalig (lädt Electron, ~100 MB)
npm --prefix apps/desktop start        # App starten
npm --prefix apps/desktop run dist:linux   # AppImage + tar.gz in apps/desktop/release
npm --prefix apps/desktop run dist:win     # Installer + portable .exe (am besten unter Windows bauen)
npm --prefix apps/desktop run dist:mac     # .dmg (nur unter macOS möglich)
```

Für Online-Spiel in der Desktop-App die Serveradresse in den Einstellungen eintragen
(z. B. `wss://example.de/pz`) oder vor dem Bauen in `apps/client/public/config.json` als `serverUrl` setzen.

## Veröffentlichen auf dem eigenen Server

Empfohlener Aufbau: Die **bestehende Webseite bleibt unverändert**. Das Spiel liegt unter `/spiel/`, der
Spielserver läuft lokal auf Port 8787 und wird vom Webserver unter `/pz/` (HTTPS + WebSocket) erreichbar
gemacht. Der Client findet den Server dann automatisch (`wss://deine-domain/pz`).

### Variante A: Linux-Server mit systemd (nginx oder Apache)

```bash
# Auf deinem Rechner:
bash deploy/scripts/package.sh        # → release/project-zero-<version>-<commit>.tar.gz
scp release/project-zero-*.tar.gz deploy/scripts/install.sh server:/tmp/

# Auf dem Server (Node.js ≥ 22.5 muss installiert sein):
sudo WEB_DIR=/var/www/project-zero bash /tmp/install.sh /tmp/project-zero-*.tar.gz
sudo nano /etc/project-zero/env       # PZ_ALLOWED_ORIGINS=https://deine-domain setzen
sudo systemctl restart project-zero
```

`install.sh` legt ein Dienstkonto an, entpackt nach `/opt/project-zero/releases/…` (Umschalten über den Link
`current`, die letzten 5 Versionen bleiben erhalten), kopiert den Web-Client nach `WEB_DIR`, sichert vor
jedem Update die Datenbank, führt Migrationen aus, richtet den systemd-Dienst ein und prüft `/healthz`.
**Schutz:** In ein Verzeichnis mit fremden Dateien schreibt das Skript nicht, eine vorhandene
`config.json` bleibt bei Updates erhalten.

Webserver einbinden (in den **bestehenden** HTTPS-Server-Block, nichts wird ersetzt):

- **nginx:** `deploy/nginx/project-zero-http.conf` nach `/etc/nginx/conf.d/`, `deploy/nginx/project-zero.conf`
  nach `/etc/nginx/snippets/` und im `server { … }` der Domain `include snippets/project-zero.conf;`
  ergänzen, dann `nginx -t && systemctl reload nginx`.
- **Apache:** `a2enmod proxy proxy_http proxy_wstunnel rewrite headers`, dann
  `Include /etc/apache2/project-zero.conf` (aus `deploy/apache/`) im `<VirtualHost *:443>`.

HTTPS: Das vorhandene Zertifikat der Domain wird mitbenutzt (z. B. Let's Encrypt/certbot).

### Variante B: Docker

```bash
cp deploy/.env.example deploy/.env    # anpassen
docker compose -f deploy/docker-compose.yml up -d --build
```

Der Container lauscht nur auf `127.0.0.1:8787`, speichert Daten im Volume `pzdata` und liefert den
Web-Client selbst mit aus. Davor wie oben nginx/Apache für HTTPS auf `/pz/` (und optional `/spiel/`).

### Betrieb

| Aufgabe | Befehl |
|---|---|
| Status | `curl https://deine-domain/pz/healthz` · `systemctl status project-zero` |
| Protokoll | `journalctl -u project-zero -f` |
| Sicherung (automatisch alle 6 h, 28 behalten) | manuell: `sudo /opt/project-zero/current/deploy/scripts/backup.sh` |
| Wiederherstellen | `sudo /opt/project-zero/current/deploy/scripts/restore.sh /var/lib/project-zero/backups/<datei>.db` |
| Migrationen | laufen automatisch vor jedem Start (`server.mjs --migrate-only`) |
| Update | neues Archiv bauen und `install.sh` erneut ausführen |

Beim Stoppen (SIGTERM) speichert der Server alle Charaktere. Passwörter werden mit scrypt gehasht,
Sitzungen nur als Hash gespeichert. Es gibt keine Schlüssel im Browser-Code oder im Repository; die
Serverkonfiguration liegt nur auf dem Server (`/etc/project-zero/env`, Vorlage `deploy/.env.example`).

## Konfiguration

**Client** (`config.json` neben `index.html`, wird zur Laufzeit gelesen, kein Neubau nötig):

```json
{ "serverUrl": "", "serverName": "Project Zero", "allowOnline": true }
```

`serverUrl` leer = gleicher Host wie die Webseite unter `/pz`. Spieler können die Adresse zusätzlich in
den Einstellungen ändern.

**Server** (Umgebungsvariablen, siehe `deploy/.env.example`): `PZ_PORT`, `PZ_HOST`, `PZ_DB`,
`PZ_BACKUP_DIR`, `PZ_BACKUP_HOURS`, `PZ_BACKUP_KEEP`, `PZ_ALLOWED_ORIGINS`, `PZ_SERVER_NAME`, `PZ_MOTD`,
`PZ_ALLOW_REGISTRATION`, `PZ_ALLOW_TEST_ACCOUNTS`, `PZ_MAX_PER_INSTANCE`, `PZ_MAX_CHARS`,
`PZ_RECONNECT_GRACE`, `PZ_SAVE_INTERVAL`, `PZ_SESSION_DAYS`, `PZ_TRUST_PROXY`, `PZ_PUBLIC_DIR`.

## Bekannte Grenzen

Ehrlich festgehalten, was geprüft ist und was nicht:

- **Grafikleistung auf echter Hardware ist nicht gemessen.** Entwickelt und getestet wurde in einer
  Cloud-Umgebung ohne Grafikkarte (Software-WebGL). Dort läuft das Spiel, aber langsam; Bildraten auf
  echten Rechnern sind unbekannt. Bei Ruckeln das Grafikprofil senken.
- **Grafikstil:** realistisch angelehnt (PBR-Materialien, Licht, Wetter, Tag/Nacht), aber mit prozedural
  erzeugten Modellen und Texturen – kein fotorealistisches AAA-Niveau.
- **Desktop-App:** der Linux-Build wurde gebaut und gestartet. Windows- und macOS-Pakete sind konfiguriert,
  aber hier nicht gebaut oder getestet (macOS-Builds gehen nur auf einem Mac).
- **Docker:** das Laufzeit-Image wurde gebaut und getestet (Health-Check, Auslieferung, Speichern beim
  Stoppen). Die Build-Stufe (`npm ci` im Container) konnte in dieser Umgebung wegen des Netzwerk-Proxys nicht
  durchlaufen und ist daher ungetestet.
- **nginx:** die Konfiguration wurde mit nginx 1.24 geprüft, alle E2E-Tests liefen erfolgreich über `/spiel/`
  und `/pz/`. Die Apache-Konfiguration ist ungetestet.
- **Umfang:** Hauptgeschichte, Nebenaufträge und Systeme sind vollständig umgesetzt und automatisiert
  getestet, aber noch nicht ausgiebig von Menschen durchgespielt – Balance und Feinschliff brauchen Spieltests.
