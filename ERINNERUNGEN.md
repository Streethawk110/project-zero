# Erinnerungen

Zusammenfassung der bisherigen Claude-Sitzungen. Neueste Einträge oben.

## 2026-09-24 – Cloud-Sitzung: Realismus + Leistung („wie KCD2“)

**Wunsch**: Grafik viel realistischer (Ziel Kingdom Come Deliverance 2), weniger
Stottern auch auf schwächerer Grafik, „sehr ausführlich, nicht schnell“. Spielzeit-
Frage beantwortet: geschätzt 3–5 h alle Geschichten (nicht gemessen).

**Gemessen** (`tools/dev/profile.mjs`, zählt Zeichenaufrufe/Dreiecke je Durchgang):
Ultra vorher ~2600 Aufrufe / 8,5 Mio. Dreiecke pro Bild; GTAO renderte die Szene
ein zweites Mal; alte Blattkarten ~880k Dreiecke im Bild; Gras ~1 Mio. (wurde im
Profiler nicht mitgezählt – behoben).

**Erledigt**
- `render/ao.ts`: AO aus dem Tiefenbild (halbe Auflösung, kantenerhaltend),
  in der Atmosphären-Stufe tiefenbewusst hochskaliert → GTAOPass entfernt
  (Aufrufe/Dreiecke halbiert).
- `tools/blender/foliage_bake.py`: modellierte Zweige (Eiche, Hasel, Fichte,
  Kiefer) und Grasbüschel (grün, trocken) → `foliage_<art>_{color,normal}.webp`.
  Vorschau: `preview_foliage.py`. Achtung: Blender-Pixel sind linear → vor dem
  Speichern nach sRGB wandeln.
- `tools/blender/trees.py`: verzweigte Bäume (Fichte = tree_pine, Eiche, Hasel =
  bush, toter Baum) mit Zweigkarten, Punktfarbe R=Wind G=Verdeckung B=Tönung,
  gebogene Normalen; eigenes LOD1 (`lib.export(..., lod1_objs=)`). Vorschau:
  `preview_tree.py`. Alte Bäume aus `nature.py` entfernt.
- Client: `foliage.ts` (Blattmaterial: Wind, Durchscheinen, keine Rückseiten-
  Normalenumkehr, Alpha-Mip-Ausgleich), `impostor.ts` (8 Ansichten je Baumtyp
  zur Laufzeit gebacken, ferne Bäume = 1 Viereck), Baum-Chunks 48 m mit 3
  Stufen (`treeLodRanges`), dynamische Auflösung (Einstellung, Stufen 100–56 %),
  Umgebungs-Spiegelung auf 7 Bilder verteilt, neues Gras (`grass.ts`: Lambert →
  bekommt Schatten, 2 Ringe, trockene Flecken, Durchscheinen).
- WICHTIGER FUND: `tools/models/optimize.mjs` hat mit `prune()` alle UVs
  entfernt (Materialien ohne Bildtextur) → Häuser/Felsen/Bäume ohne richtige
  Texturen. Jetzt `prune({ keepAttributes: true })`, alle Modelle neu gebaut.
- Bäume verschlankt (Fichte 3,5k, Eiche 4,6k Dreiecke; Äste im Laub dreikantig).
- AgX-Tonemapping statt ACES (Belichtung angepasst, Sättigung 1,16).
- Gras: Rückseiten-Normalen nicht umdrehen (sonst schwarze Büschel).
- Nutzer: Kamera „nicht premium“ → Drehung ~30 ms geglättet, Verfolgung gefedert,
  Rohdaten-Maus (`unadjustedMovement`); nach Fenster-Schließen wird die Maus
  automatisch wieder gefangen.
- Nächster Schwerpunkt laut Nutzer: MENSCHEN wie in KCD2. Plan: MakeHuman-
  Basisfigur (CC0, raw.githubusercontent.com erreichbar) als Körper/Kopf.
- MENSCHEN NEU (`tools/blender/human.py`): MakeHuman-Basisfigur + Formvorgaben +
  Game-Engine-Gewichte (alles CC0, wird nach `tools/blender/.mh_cache` geladen,
  nicht im Repo). Mann 1,81 m / Frau 1,69 m, Arme per Skinning in Ruhehaltung,
  Armatur mit den 19 Spiel-Gelenken → `human_male/female.glb` (NICHT quantisieren:
  verzerrt Normalen bei Skin-Modellen → in optimize.mjs SKIP).
  Kleidung aus MakeHuman-Hilfsnetzen (tights/skirt): tunic, tunic_skirt, trousers,
  boots, belt, robe, hood (eigene Schale + Gewichtsübertragung), hood_cowl, plates,
  pauldrons; Haut unter Kleidung entfernt. Haare: Karten + Kappe (Stile 0–5),
  Bärte 2/3 (1 = Stoppeln in der Haut). Haut: `skin_bake.py` (Poren, Rötung,
  Brauen, Stoppeln, Falten; B-Kanal = Haarmaske), Augen `eye_color.webp`.
  Vorschauen: preview_human.py / preview_face.py.
- Client: `render/human.ts` (Ruhepose = Knochen×inverse Bindung×Bindung,
  Gelenkpositionen aus dem Modell, Haut-/Augen-/Haarshader), Rig nutzt es
  automatisch; Aussehen hat jetzt `sex` (0/1), weibliche NSC markiert, Auswahl
  in der Charaktererstellung. Texturen werden vorab geladen (`loadHumanTextures`).
- Fluss-Streifen behoben: Meer lag 140 m vor der Küste unter dem Fluss (dunkle
  Doppelfläche) → Meer beginnt an `shoreLine`, Fluss endet dort, Flussbett 30 m
  durch den Strand (terrain.ts); Wasser schreibt Tiefe (AO/Nebel sahen sonst das
  Flussbett). Erdwege waren fast schwarz → `mat_dirt` heller gebacken. Flusswasser
  klarer/grünlich, Schaum nur bei < 30 cm Tiefe.
- Automatische Belichtung (`ExposurePass` in renderer.ts, GPU, ohne Zurücklesen):
  gemessen Wald ≈ 0,045 / Strand ≈ 0,14 → Ausgleich (0,05/L)^0,65, 0,45–1,7.
- Menschen-LOD: `human_*_lod1.glb` (Netze ~25 %, Haare nur Kappe, keine Bärte),
  Umschaltung ab 16 m (`rig.setLod`, EntityManager.camPos).
- Offen (Nutzerliste, Stand vorher): begehbare Häuser, Gebäude/Requisiten/Berge realistischer, ALLE Texturen
  gründlich überarbeiten; Menschen: LOD für Leistung, Waffenhaltung prüfen.
- Tests ohne GPU: gegen statischen Build testen (Vite-Dev-Server lädt bei
  Codeänderungen neu → Screenshots brechen ab).
- Begehbare Häuser: `house_a`, `house_b`, `inn` haben im Erdgeschoss echte
  Wände mit Tür-/Fensteröffnungen, offene Tür, Dielen, Decke/Balken und
  Einrichtung (`_furnish_home`/`_furnish_inn` in `tools/blender/buildings.py`).
  Kollision: `walkIn()` in `packages/shared/src/world/props.ts` (Sockel als
  begehbarer Boden, Stufe, Wände mit Türlücke, Möbel). `PropDef.interior`
  (Rechteck + Deckenhöhe) → Kamera-Decke und gedämpftes Himmelslicht drinnen
  (`Game.interiorAt`, `env.indoor`); Herdlichter per `light` (jetzt auch
  Liste mit ox/oz). Gras wird in Innenräumen ausgeblendet (`uRooms`).
  Im Spiel geprüft (Gasthaus, Wohnhaus). Vorschau: `preview_interior.py`.
- Gebirge neu (`mountains()` in `packages/shared/src/world/terrain.ts`):
  Massive + verzerrtes Grat-Multifraktal + Erosionsrinnen, Gipfel bis
  ~180 m. Fels/Schnee setzt jetzt der Geländeshader pro Pixel (Neigung,
  Höhe, Rauschen, Gesteinsschichten); Schneegrenze 96–118 m (`snowAt`).
- Texturen-Überarbeitung läuft (`tools/blender/textures.py`): Stein als
  Bruchsteinmauerwerk, Putz, Holz, Ziegel, Stroh, Metall (Farbe ohne Metallic
  backen, sonst schwarz; PBR-hell), Gelände mit gestreckten Rauschwerten
  (`g.st`), Hohlraumverschattung in der Grundfarbe (`g.cavity`). Vorschau:
  `PZ_TEX_SIZE=512 PZ_TEX_OUT=… textures.py` + `preview_tex.py`.
  2K-Bake dauert ~30–40 min (4 Kerne); Stand beim Commit ggf. teilweise.
- Gebäude: Dach mit Durchhang, Firstziegel/Strohwulst, behauene Balken
  (`hewn`), Dach-UVs hangaufwärts (`box_uv`), Hof-Details `_yard` +
  `homeExtras`-Kollision; Sockelschmutz im Client (`render/weathering.ts`).
- 2K-Bake aller 18 Texturen fertig, Metall heller neu gebacken.
- GROSSER FUND: `main.ts` lud die Modelle VOR den gebackenen Texturen →
  alle Modellmaterialien (Gebäude, Requisiten) nutzten dauerhaft die
  prozeduralen Ersatztexturen (weiße „Fliesen“ an der Kapelle). Reihenfolge
  umgedreht (auch in `dev/rigPreview.ts`).
- Web-Artifact Version 6 (gleicher Link), Texturen dort auf 1024 verkleinert
  (sonst über 64 MB je Version).
- Neuer Nutzerauftrag (Nutzer ist weg, alles selbstständig): Menschen viel besser
  und lebendig (Blinzeln!), Figuren reden, Waffen in der Hand, Schloss-Mechanik
  statt überall begehbar, Türen statt Pfosten, Tutorial, bessere Übergänge,
  viele Komfortfunktionen, VOLLER Grafik-Umbau wie KCD2 (größter Punkt).
- Asset-Quellen: Poly Haven/ambientCG/Sketchfab gesperrt; GitHub (git + raw),
  npm, PyPI gehen. Brauchbar: MPFB2-Targets (Mimik `expression/units`,
  Gesichtsformen), HDRIs in `pmndrs/assets` und `gkjohnson/3d-demo-data`.
- Menschen: Formziele in `human.py` (`SHAPES`, `grip_deltas`): blink, jaw,
  smile, frown, brows, lips, 9 Gesichtsvarianten (f_*), gripL/gripR; Zähne +
  Zunge (`mouth`) und dunkle Mundhöhle (`mouth_cavity`). Client: Morphs in
  `human.ts` übernommen, `rig.ts` `life()`: Atmen, Gewichtsverlagerung,
  Blickziel (`rig.lookAt`), Blinzeln, Sprechen (`rig.talking`), Stimmung,
  Gesicht je `faceSeed`, Faust um Waffen. Waffen sitzen in der Handfläche,
  Bogen in der linken Hand, Blockhaltung mit Schild vor dem Körper.
- Figuren sprechen: `audio/voice.ts` (Web Speech API, de-DE, Stimmlage je
  Figur), Dialoge und Zurufe (`bark`) werden vorgelesen, Mund bewegt sich,
  Einstellung „Sprachausgabe“. Gesprächskamera über die Schulter
  (`cam.focus`, `Game.updateGaze`), NSCs schauen den Spieler an.
  NSCs stehen jetzt auf Dielenböden (`groundHeight` beim Erzeugen), Hedda
  steht an ihrer Theke im Gasthaus.
- Türen und Schlösser: `world/houses.ts` (HOUSES mit lock 0/1/2, nightLock,
  Besitzer), Türflügel `door_leaf` als eigenes Objekt (Kollision nur
  geschlossen, Collider.door), `World.useDoor/lockpickResult/witness`,
  Snapshot `doors`/`locked`, Befehl `lockpick` (Server prüft Mindestdauer).
  Dietrich (`lockpick`) bei Pell, Truhen in Häusern (`hchest_i`, Loot
  `chest_home`, `owned` → Zeugen, Wachen verhängen Strafe).
  Minispiel `ui/lockpick.ts`. Im Spiel geprüft (Tür öffnen, Minispiel).
- Einführung `ui/tutorial.ts` (10 Schritte, wartet auf echte Handlungen,
  zeigt belegte Tasten, überspringbar; `settings.tutorialDone`, Schalter in
  den Einstellungen). Spielstart blendet aus Schwarz auf + Ortstitel
  (`showLocationTitle`), neue Gegend → Titel „Entdeckt“, weite Teleports →
  Schwarzblende (`fadeThrough`).
- Kleidung neu (`garment()` in rig.ts): Stoff mit Sheen + feiner Webung
  (Wiederholung 12), Leder, Kettenhemd (`chain`-Textur), Plattenstahl
  (`plate`, nur Outfits mit `plate: true`), Stoffkapuze neu (Falten, Zipfel,
  runder Ausschnitt), Haarkappe mit Strähnen-Maserung (`hairCapMaterial`).
- Bart gebaut und geprüft (Koteletten nur seitlich/unten, Mund = Mitte der
  Zahnreihen, `beard_follow_jaw`). Stimmen: `voiceProfile()` (Geschlecht,
  Größe/Statur → hell/dunkel, graues Haar → alt), Laute für Schmerz/Anstrengung/
  Tod per Formant-Synthese (`audio.vocal`). Filmkamera: `DofPass`
  (Tiefenschärfe) + Kinobalken, `renderer.setCinematic` im Dialog.
  Kein Gras mehr auf Pflaster/Wegen.
- Komfort (Aufgabe 27), im Spiel geprüft: Autolauf [O], Schnellspeichern [F5],
  Schnellladen [F9], Anzeigen aus [F1], Fotomodus [F10] (freie Kamera, Schärfe
  per Mausrad, Balken, Linksklick speichert PNG), Wegmarke per Doppelklick auf
  der Karte (Kompass ⚑, verschwindet bei Ankunft), Pause beim Fensterwechsel
  (Einstellung). Belegte F-Tasten werden nicht mehr an den Browser gegeben
  (F5 hätte sonst die Seite neu geladen).
- Filmreif/Menschen (Nacht 24./25.9.): GRAS-FEHLER behoben – ausgeblendete Halme wurden nur in der
  Höhe auf 0 gesetzt und lagen als 1 m lange dunkle Striche überall auf Pflaster/Wiese (grass.ts,
  `wsc`). Graswuchs-Sperre am Pflasterrand um eine Zelle ausgeweitet. Kopfsteinpflaster neu
  (`mat_cobble`: ~15 cm Feldsteine, breite Erdfugen). Fels: grobe zweite Abtastung, Rinnen, Flechten.
  Tag etwas dunkler belichtet (1,55), Kontrast 1,18.
- Menschen: Lippenrot/Wangenröte saßen unter der Nase (skin_bake nahm „joint-mouth“, 3 cm zu hoch →
  jetzt Mitte der Zahnreihen). Haaransatz 2 cm höher (Strähnen lagen auf der Stirn), Kappe/Strähnen/
  Bart übernehmen die Gesichts-Formziele (`follow_keys`, `add_keys_after_offset`), Haut-Shader tönt die
  Kopfhaut in Haarfarbe (`scalpMask`, `humanLandmarks`; aus bei Glatze), Kappe mit Tiefenversatz.
  Frei hängende Strähnen fallen jetzt nach unten. Haar: weniger Himmelsglanz, Gegenlicht-Saum,
  Alpha-to-Coverage bei MSAA. Falten je Alter (graues Haar → kräftiger). Kettenhemd: Lücken zeigen
  dunklen Gambeson statt schwarzem Metall, feinere Ringe. Gesprächskamera: Gesicht höher im Bild.
- Haare: Kajiya-Kay-Glanz (2 Bänder), Strähnenvariation; Formziele nur Schädel (`SKULL_KEYS`), Bart
  `BEARD_KEYS`, Export ohne Formnormalen (`export_morph_normal=False`) → human_male 11,3 MB statt 17,6.
  Web-Artifact Version 7 (59 MB, Texturen 1024), danach Version 8 (Nacht, Haare, Kleidung).
- Tageshimmel klarer (Trübung 2,4, Rayleigh 1,8, weniger Wolken bei klarem Wetter 0,3, bläulicherer
  Dunst). E2E: SP + Offline grün; MP im Gesamtlauf wieder am Menü-Timeout (Last), einzeln grün (3,3 min) →
  Testseiten jetzt mit fpsCap 15.
- Menschen: Iris gedämpft (leuchtete), Stoff-Glitzern reduziert (Sheen/Normalen), Dutt (Frisur 4) als
  runde Kugel aus gewickelten Strähnen, Schläfen-Haaransatz bis Augenhöhe (Modell + `scalpMask`).
- Kleidung: Webung gedämpft (kein Karomuster), Kettenhemd Wiederholung 90, Gürtel weiter außen.
  Wände: Regenspuren/Flecken (weathering.ts). Nacht filmischer: Belichtung nachts begrenzt (uMax 1,05),
  Nachthimmel blau getönt, Mondlicht 0,55, feinere Sterne, Fenster leuchten nachts (`windowMaterial`,
  `setWindowGlow`, ~2/3 der Fenster je Lage). Im Spiel geprüft (Tag, Abend, Nacht).
- NUTZER (25.9. morgens): „Menschen sehen immer noch nicht echt aus, soll hochentwickelt sein, ich will
  nicht alles sagen müssen“. Umgesetzt: fotografische Gesichtshaut aus dem Kopfscan „Lee Perry-Smith“
  (CC BY 3.0, three.js-Repo; `tools/blender/scan_skin.py`: Landmarken-Anpassung, Strahlprojektion je Texel,
  Farbe + Faltennormalen, Brauen/Bart als Haarmaske, Lippen der Figur, Frauen ohne Bartschatten,
  Lücken per Dilatation gefüllt, Füllflächen der Scan-Textur verworfen). Wimpern aus den MakeHuman-
  Hilfsstreifen (`eyelashes()`), Mundinneres folgt Gesichtsformen, Haare dichter/dünner/voluminöser
  (Figuren jetzt ~16/12 MB). Porträt-Vorschau: `rig-preview.html?only=N&face=1&seed=x`, `hide=teil,…`.
- NUTZER-AUFTRAG danach (Aufgabe 31): KCD2-Umbau mit ausgewählten Features, u. a. NSCs laufen in
  Dorf/Burg umher (Tagesabläufe), nicht alles, nur was passt.
- KCD2-Umbau Teil 1 (Aufgabe 31): Tagesabläufe. `world/routines.ts`: Wegpunkte im Dorf (Platz, Markt,
  Werkstätten, Tore, Felder, je Haus außen/innen, Gasthausplätze), Wegenetz automatisch per Sichtlinie
  (Knie-/Brusthöhe über Boden inkl. Dielen), Dijkstra-Wege, `routineStep`. Sim (`updateRoutine`): Wege
  laufen, Türen selbst öffnen/schließen (`npcDoors`), Schlafen = im Haus verschwinden (`hidden`, nicht im
  Snapshot/Interaktion), Arbeit/Sitzen/Reden als Animation (`work`, `sit` im Rig), Festlauf-Erkennung.
  Benannte NSCs mit Plänen (Vogt, Oswin, Pell 7–19 am Stand → Händler handeln nur dann, Hedda, Brann,
  Lina, Ute, Ysolde, Aldric, Tam), 10 Dorfbewohner (eigene Häuser, Arbeit, Gerüchte-Dialoge folk_a/b/c)
  und 4 Dorfwachen (Tore, zwei Nachtstreifen mit Fackeln `torch`, verhängen Strafen). Questmarkierungen
  folgen sichtbaren NSCs (`liveNpcMarker`). Test `routines.test.ts` (kein Festlaufen, nachts schlafen).
- KCD2-Umbau Teil 2: Grundbedürfnisse (Sättigung/Ausgeruhtheit, `CharacterData.needs`, `needsOf`,
  sinken mit der Zeit, schneller bei Kampf/Sprint; hungrig −25 %/ausgehungert −40 % Ausdauer, müde/
  erschöpft langsamere Erholung; Hinweise; HUD 🍞 💤). Essen: Brot/Apfel/Käse/Räucherfisch (`use.food`),
  Hedda: Suppe 4 Gold (`need:food:70`), Bett 10 Gold (`sleep`: ausgeruht, EP bis 7 Uhr). Rasten am Feuer =
  ausgeschlafen. NSCs drehen sich beim Plaudern zueinander. Test `needs.test.ts` (31 Unit-Tests).
- KCD2-Umbau Teil 3: BURG HALDENSTEIN (`castle()` in buildings.py: Ringmauer 36 m mit Zinnen,
  4 Rundtürme, Torhaus mit Fallgatter/Bannern, Bergfried mit Treppe, Palas, Stand, Übungspuppen).
  Welt: `CASTLE` (75,−58, Drehung 2,63) in region.ts, Plateau im Gelände, Zone „haldenstein“,
  Kollision in props.ts, Brunnen/Stand/Laternen in layout.ts, Weg vom Südweg (außerhalb der
  Palisade – sonst entsteht eine Palisadenlücke!) zum Tor. Wegpunkte `c_*` (Burgkoordinaten →
  `castleToWorld`). Bewohner: Hauptmann (Dialog `captain_root`), 4 Soldaten (Wache am Tor, Übung,
  Streife außen um die Mauer), Köchin, Stallknecht, Magd. Test „Weg zur Burg“ (32 Unit-Tests).
- KCD2-Umbau Teil 4: RUF „Haldenbruck“ (neue Fraktion `folk`): Dorf-Nebenquests +10, Straftat vor
  Zeugen −8/−5, Wachen (`isGuard`, auch Burgbesatzung) strafen je Ruf (≥40 halb, ≤−30 doppelt),
  Händler Pell/Oswin/Jorun Preise nach Ruf, Bewohner/Burgleute mit `faction: 'folk'` (≤−40 kein
  Gespräch). Grüße im Vorbeigehen (`World.greet`, 3,2 m, je nach Ruf/Wache/Nacht, sonst eigene
  `bark`-Sätze, die vorher nie benutzt wurden). Test `reputation.test.ts` (34 Unit-Tests).
- KCD2-Umbau Teil 5: WÜRFELN (`sim/dice.ts`: Wertung wie KCD, Ziel 2000, Gegner-KI `opponentTurn`).
  Dialog der Bewohner (folk_a/b/c): „Runde Würfel? (10/30 Gold)“ → Effekt `dice:N`. Server prüft
  jede Auswahl (`World.diceCmd`, Befehl `dice` roll/bank/quit, validate.ts), Gewinn = doppelter
  Einsatz. Client `ui/dice.ts` (Holztisch, anklickbare Würfel, Tasten 1–6/Leertaste/Enter/Esc,
  Gegnerzüge werden Wurf für Wurf gezeigt), Klang `dice_roll`. Test `dice.test.ts` (37 Unit-Tests).
- NEU auf der Liste (Nutzer): 1) FOKUS Grafik „wie im Film“ (filmreifes
  Licht, Farbgebung, Kamera, Nachbearbeitung). 2) Sound/Stimmen: deutlich
  unterscheidbare Männer- und Frauenstimmen, hell/dunkel, verschiedene Klänge.
- Auftrag für 1:30: erst Aufgaben planen; Menschen noch deutlich mehr wie im
  Film/KCD2, alles nochmal besser machen, viele QoL-Funktionen.
- E2E: Einzelspieler + Offline grün; Mehrspieler im Gesamtlauf einmal im Menü
  hängen geblieben (Last), einzeln grün (4 min).
- Test-Hinweis: Grafik „hoch“ ist ohne GPU hier so langsam (0,8 s Spielzeit
  in 30 s), dass Abläufe noch nicht begonnen haben → für Ablauf-Tests
  „niedrig“/„mittel“ nehmen.

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
- Bäume: Kronen aus Blattkarten mit Wind (`render/foliage.ts`), Blatt-
  Atlanten per Canvas; Kiefernstamm gekürzt. Wasser: Rausch-Normalen,
  Himmelsspiegelung, Durchleuchten.
- Texturen: Poly Haven/ambientCG sind per Netzwerkrichtlinie gesperrt
  (Nutzer kann Domains freigeben). Stattdessen `tools/blender/textures.py`:
  18 prozedurale Blender-Materialien, 4D-Torus-kachelbar, gebacken zu
  2K-WebP (color/normal/arm = AO,Rauheit,Höhe) in
  `public/assets/textures`. Vorschau: `tools/blender/preview_tex.py`.
  Gelände-Shader v3: Höhen-Überblendung, echte Tangenten-Normalen, AO,
  Kachelbruch. Laden: `loadBakedTextures(settings.textureQuality)`.
- Figuren neu (`tools/blender/character.py` → Modell `character`): Kopf mit
  modelliertem Gesicht (Augen/Iris/Lider/Brauen, Nase, Lippen, Ohren), Hände
  mit Fingern, Kleidungsschichten (tunic, trousers, boots, belt, robe, hood,
  plates), 6 Frisuren + 3 Bärte aus Strähnen. Client: `render/skinned.ts`
  bindet die Teile als SkinnedMesh direkt an die Rig-Gelenke (Gewichte aus
  Abstand zu Knochenstrecken, Kopf/Hände/Füße starr); alte Einzelteile nur
  noch als Ersatz ohne Modell. Im Spiel geprüft.
- E2E: Einzelspieler-Test braucht im Gesamtlauf ohne GPU länger (Timeout
  auf 180 s erhöht); einzeln 54 s grün, MP und Offline grün.

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

- Figuren überarbeitet (Nutzer: „Hals zu lang, kein Handgelenk“): Kopf tiefer
  (HEAD_C y 1.808), kurzer Hals, Handgelenk + Bündchen, größere gekrümmte
  Finger, weicheres Kinn, Tunika/Hose mit getrennten Ärmeln/Beinen.
  Körperzonen als Vertexfarbe („zone“, Rot = Code/10+0,05) → `skinned.ts`
  wählt je Zone die erlaubten Knochen (Gürtel/Umhang/Schulterstücke fliegen
  nicht mehr weg). Prüfseite `apps/client/rig-preview.html` +
  `tools/dev/shot-rigs.mjs` (Parameter `only`, `close`, `turn`).

- Web-Artifact (gleicher Link) mit neuer Grafik/Figuren aktualisiert
  (Version 3). Nutzer sah trotzdem „alte Grafik“ → Menü zeigt jetzt
  „Version 0.2.0 · Build <Datum> UTC“ zur Kontrolle. Lokal geprüft: die
  Web-Fassung lädt alle Texturen, die neue Figur und die Wolken.
- Nutzer sieht weiterhin „alte Grafik“ → Diagnosezeile im Menü (`src/diag.ts`):
  Grafikprofil, Modelle x/y, Texturen x/18, Figur neu/alt, GPU, Ladefehler.
  Nutzer meldete „Fehler“. Vermutete Ursache: Artifact-CSP sperrt
  `data:`-Adressen (glTF-Puffer) und WebAssembly (Meshopt) → Modelle fielen
  still auf Ersatzformen zurück. Web-Fassung nutzt jetzt `.glb.json`
  (entpacktes GLB als Base64, Client parst selbst) und
  `cloud-noise-64.json`. Unter nachgestellter strenger CSP geprüft:
  65/65 Modelle, 18/18 Texturen, Figur neu. Artifact Version 5.

**Offen**
- Nutzer nach Serverdaten fragen (Hosting-Art, Node verfügbar?, Domain,
  Zugang, bestehende Webseite/Webserver) und dann veröffentlichen.
- Figuren weiter verfeinern (Mund/Nase, Schulternaht Ärmel).
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
