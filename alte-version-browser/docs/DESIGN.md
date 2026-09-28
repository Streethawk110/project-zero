# Project Zero – Entscheidungen, Struktur, Spielideen

## 1. Technische Entscheidungsliste

| Bereich | Entscheidung | Begründung |
|---|---|---|
| Sprache | TypeScript überall | Eine Sprache für Client, Server und gemeinsame Regeln |
| 3D | Three.js (WebGL2), eigene Render-Pipeline | Feste Vorgabe; WebGL2 läuft in allen Desktop-Browsern |
| UI | DOM/CSS-Overlay in Vanilla-TS | Schnell, barrierearm, skalierbar (UI-Skalierung), kein Framework-Overhead im Render-Loop |
| Build | Vite (Client), esbuild (Server), npm-Workspaces | Schnelle Builds, eine Codebasis |
| Gemeinsame Regeln | `packages/shared`: deterministische Welt-Simulation (`World`) | **Dieselbe** Simulation läuft im Einzelspieler lokal und im Multiplayer auf dem Server |
| Physik | Eigene, geteilte Kollision (Höhenfeld + Kreis-/Box-Kollider, Spatial Hash) | Server und Client rechnen identisch; Server kann Bewegungen selbst simulieren |
| Netzwerk | WebSocket (`ws`), JSON-Nachrichten, 30-Hz-Simulation, 15-Hz-Snapshots | Autoritativer Server; Client-Vorhersage + Abgleich für eigene Figur, Interpolation für andere |
| Datenbank | SQLite (`node:sqlite`) mit SQL-Migrationen hinter einer Repository-Schicht | Keine Zusatzdienste nötig; austauschbar gegen PostgreSQL |
| Auth | Benutzername + Passwort (scrypt), Sitzungstoken | Keine externen Konten; Test-Zugänge per Skript |
| Einzelspieler-Speicher | `localStorage`, 5 Speicherplätze + Autosave, Export/Import als JSON mit Prüfsumme | Funktioniert offline in Browser, PWA und Electron |
| 3D-Assets | Blender-Python-Skripte (`tools/blender`) → GLB, optimiert mit glTF-Transform | Reproduzierbar, eigene Assets ohne Lizenzfragen |
| Audio | WebAudio-Synthese (Klangkulisse, Effekte, generative Musik) | Selbst erzeugt, keine Lizenzfragen, räumlich über PannerNodes |
| PWA | Web-Manifest + eigener Service Worker (Precache) | Installierbar, offline spielbar im Einzelspieler |
| Desktop | Electron (Windows/macOS/Linux) | Reife Toolchain, WebGL identisch zum Browser |
| Mobil | **entfällt** (Nutzerentscheidung: reines Computerspiel) | Fokus auf Browser, PWA und Desktop |
| Tests | Vitest (Regeln, Server-Integration), Playwright (Browser-E2E) | Automatisch prüfbare Kernfunktionen |

## 2. Projektstruktur

```
packages/shared/     Spielregeln, Simulation, Inhalte (Quests, Items, Skills, Dialoge), Protokoll
apps/client/         Browser-Client (Vite + Three.js), PWA
apps/server/         Autoritativer Multiplayer-Server (ws + SQLite), HTTP-API, Health-Check
apps/desktop/        Electron-Hülle
tools/blender/       Blender-Skripte für Gebäude, Gelände, Requisiten, Kreaturen, Figuren
tools/assets/        Asset-Optimierung (glTF-Transform)
deploy/              nginx, systemd, Docker, Backup/Restore
tests/e2e/           Playwright-Tests
```

## 3. Welt: Die Aschenmark

Vor 40 Jahren stieß die Bergbaugilde tief unter der Grenzstadt **Vardenfall** auf eine fremde Energiequelle, das **Nullherz**. Die Grabung hieß schlicht „Grabung Null“. Seit dem „Stillen Einsturz“ strahlt das **Nulllicht**: ein kaltes, weiß-türkises Leuchten, dessen Partikel *nach oben fallen*. Wo es stark ist, wächst Glas aus dem Boden, Tiere bekommen kristalline Adern, und Tote hinterlassen **Nachhalle**, stumme Wiederholungen ihrer letzten Momente.

**Visuelle Sprache der Energie:** türkis-weißes Leuchten mit violettem Rand, aufsteigende Funken, sechseckige Kristallfacetten und ein leises, tiefes Summen im Ton. Wiederkehrendes Symbol: ein **Kreis mit senkrechtem Strich** (Ø), die „Null“.

### Startregion: Das Tal von Haldenbruck
| Ort | Identität / Mechanik |
|---|---|
| **Haldenbruck** (Dorf) | Palisadendorf mit Schmiede, Schänke, Markt, Kapelle; Ruhepunkt, Händler, Werkbank, Dorfleben mit Tagesablauf |
| **Flüsterforst** (Waldweg) | Dichter Nadelwald mit Nebel. Versteckte Pilzkreise und Glyphen, die nur mit *Nullsicht* sichtbar sind |
| **Sankt Odas Wacht** (Ruine) | Altes Heiligtum auf einem Hügel. **Resonanzrätsel**: Glockensäulen in der richtigen Reihenfolge anschlagen |
| **Die Glasnarbe** (Kampfgebiet) | Aufgerissene Ebene voller Glaskristalle; Energieausbrüche, starke Gegner, Welt-Ereignisse |
| **Grube Tiefenrast** (Dungeon) | Verlassenes Bergwerk, Zwillingssiegel-Tür, Loren-Rätsel, Bossarena „Kristallkathedrale“ |
| **Rabenkanzel** (Aussichtspunkt) | Klippe über dem Meer, deckt die halbe Karte auf, Blick auf Vardenfall am Horizont |
| **Salzküste** | Raue Küste, Schiffswrack, Fischerhütte, Salzabbau |
| **Die Ertrunkene Kapelle** (optionales Geheimgebiet) | Nur über den unsichtbaren *Gezeitenpfad* erreichbar (Hinweise: drei Nullglyphen) |

## 4. Fraktionen

| Fraktion | Ziel | Methoden | Moralische Schwäche |
|---|---|---|---|
| **Orden der Stillen Flamme** (Symbol: Flamme über gekreuzten Linien) | Das Nullherz versiegeln und alles „Berührte“ reinigen | Feuer, Quarantäne, Glaubenseifer, Schutz der Dörfer | Verbrennt Berührte Menschen „zu ihrem Heil“; Angst als Werkzeug |
| **Das Kontor von Vardenfall** (Symbol: Waage mit Kristall) | Das Nulllicht als Energiequelle und Ware nutzen | Verträge, Söldner, Grabungen, Bestechung | Vertuscht die wahre Ursache des Stillen Einsturzes; Gewinn vor Menschenleben |
| **Die Verwurzelten** (Symbol: Wurzel, die einen Kreis umschließt) | Mit dem Nulllicht als lebendigem Wesen koexistieren | Rituale, Sabotage, Heilung von Tieren, Schutz des Waldes | „Füttern“ die Quelle heimlich mit Leben; Fremde sind für sie entbehrlich |

## 5. Wichtige Figuren (mehrfach auftretend)

- **Isra Venn**: Kartografin der Expedition, **Begleiterin** im Einzelspieler. Trocken, neugierig, misstraut Autoritäten. Trägt die *Resonanzlaterne*. Persönliche Quest: das Tagebuch ihres Bruders Tobin.
- **Vogt Berengar**: Dorfvorsteher von Haldenbruck, erschöpft und pragmatisch. Will sein Dorf retten, egal mit wem.
- **Präzeptorin Ysolde Harn** (Orden): kühle Strategin. Glaubt aufrichtig, dass Feuer Leben rettet.
- **Kontormeister Aldric Vey** (Kontor): charmant und berechnend, wusste vom Einsturz mehr, als er zugibt.
- **Seherin Maren** (Verwurzelte): Selbst Berührt, sanft und unheimlich. Hört „das Herz“ atmen.
- **Hauptmann Corvin Rast**: Leiter der Expedition, gilt als tot.

## 6. Hauptgeschichte „Der Nullpunkt“ (Akte)

1. **Asche und Glas**: Erwachen am zerstörten Expeditionswagen, Isra findet dich. Weg nach Haldenbruck, erster Kampf, der Vogt.
2. **Drei Stimmen**: Jede Fraktion will die Ursache der neuen Welle. Spuren in der Ruine (Resonanzrätsel), im Wald und in der Glasnarbe. Der **Herzsplitter** wird gefunden.
3. **Die Entscheidung**: Wem gibst du den Herzsplitter? Das verändert Dorf, Gegner, Preise, Quests und Dialoge sichtbar.
4. **Tiefenrast**: Abstieg in die Grube, Zwillingssiegel, Loren-Rätsel.
5. **Der Hohle Hauptmann**: Bosskampf in der Kristallkathedrale, danach der Epilog.

**Wendung 1:** Hauptmann Corvin Rast ist nicht tot. Er hat die Expedition absichtlich ins Nullherz geführt, um seine verstorbene Tochter als Nachhall zurückzuholen, und ist nun der **Hohle Hauptmann**.
**Wendung 2:** Du hast den Einsturz nicht zufällig überlebt: Das Nulllicht hat **dich** ausgewählt. Die „Echos“, die du siehst, sind deine eigenen verlorenen Erinnerungen, und die neue Welle begann in dem Moment, als du erwachtest. Du bist „Nummer Null“.
**Wendung 3 (Fraktion):** Aldric Vey hat den Stillen Einsturz vor 40 Jahren ausgelöst, um die Konkurrenz zu vernichten (Beweis in der Grube).

## 7. Kreaturen

| Kreatur | Rolle | Besonderheit |
|---|---|---|
| **Glasläufer** | Schneller Angreifer | Hirschartig, halb Kristall. Springt in Sprüngen an, bricht bei Feuer schneller |
| **Wurzelkoloss** | Widerstandsfähig | Bär, von Borke und Stein überwuchert. Frontal fast unverwundbar, **Schwachstelle**: leuchtender Kristall im Rücken |
| **Irrlichtmotte** | Fernkämpfer | Schwebt außer Reichweite und schießt Lichtpfeile; blendet bei Tod |
| **Nachhall** | Ungewöhnliches Verhalten | Schattenkopie eines Toten. **Bewegt sich nur, wenn niemand hinsieht**, und ahmt den letzten Angriff nach |
| **Plünderer** | Menschliche Nahkämpfer | Banditen aus der Grenzregion, fliehen bei niedrigem Leben |
| **Der Hohle Hauptmann** | Boss (3 Phasen) | Kristallschwert, Nachhall-Beschwörung, Kristallsäulen-Schild, Energiepulse |

## 8. Eigene Mechaniken

1. **Nullsicht** (Erkundung): Umschaltbarer Blick, der versteckte Glyphen, unsichtbare Plattformen, geheime Wege und Schwachstellen zeigt. Kostet Mana und erhöht die *Berührung*.
2. **Berührung** (Entscheidung mit Folgen): Wer Nullkraft nutzt oder Nullkristalle verzehrt, wird *Berührt* (0–100). Das stärkt Arkan-Fähigkeiten und öffnet Dialoge mit den Verwurzelten. Dafür verlangt der Orden höhere Preise und verweigert ab 60 Quests. Ab 30 leuchten die Adern der Figur sichtbar.
3. **Gleichklang** (Zusammenarbeit): Treffen zwei Spieler denselben Gegner innerhalb von 1,5 s mit verschiedenen Pfaden (z. B. Wächter + Arkanist), lädt sich ein gemeinsamer Resonanzbalken. Voll → **Gleichklang-Entladung** (Flächenschaden und Betäubung, abhängig von den Pfaden). Im Einzelspieler lädt Isras Laterne den Balken langsamer.
4. **Zwillingssiegel** (Zusammenarbeit): Türen und Mechanismen mit zwei Druckplatten, die gleichzeitig belegt sein müssen. Im Einzelspieler übernimmt Isra auf Befehl eine Platte.
5. **Herzsplitter-Entscheidung**: sichtbare Weltveränderung (Banner, Wachen, Gegnerdichte, Händlerwaren, Dialoge).
6. **Relikte mit Geschichte**: z. B. *Odas Gezeitenglocke* (verlangsamt Gegner in der Nähe), *Tobins Kompass* (zeigt versteckte Truhen), *Rasts Siegelring* (Bonus nach Parade).

## 9. Geheimnis: Der Gezeitenpfad

Drei **Nullglyphen** (Ruine, Flüsterforst, Wrack) sind nur mit Nullsicht lesbar. Jede zeigt ein Gezeitensymbol und eine Zahl. In der richtigen Reihenfolge an der Küstenstele „aktiviert“, erscheint in der Nacht der unsichtbare Gezeitenpfad über dem Wasser zur **Ertrunkenen Kapelle** mit einem optionalen Wächter und *Odas Gezeitenglocke*.
