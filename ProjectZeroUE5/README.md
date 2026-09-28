# Project Zero – Unreal Engine 5

Stand: Aufbau begonnen (Cloud-Sitzung 28.09.2026). Weiter geht es lokal am PC des Nutzers, wo Unreal Engine 5.8.3
installiert ist – dort kann das Projekt angelegt, kompiliert und getestet werden.

## Bereits vorhanden
- `Content/Data/*.json` – Spielinhalte aus der Browser-Fassung (Gegner, Spawns, NSC, Dialoge, Gegenstände, Quests,
  Welt mit Startpunkt/Fluss/Zonen, Platzierungen: 4823 Objekte + 70 Lichter). Koordinaten schon in UE-Einheiten:
  X = x, Y = z, Z = y, Zentimeter; Gieren = −rot in Grad.
- `Import/Landscape/Heightmap_1009.png` – 16-Bit-Höhenkarte (900 × 900 m): Landschaft 1009 × 1009,
  XY-Maßstab 89,29, Z-Maßstab 100, Lage (−45000, −45000, 0).
- `Import/Landscape/Layer_*.png` – Masken der 8 Bodenschichten (Gras, Erde, Fels, Sand, Wald, Glas, Schnee, Pflaster).
- `Import/Textures/` (nicht im Repo, lokal erzeugen): `python3 alte-version-browser/tools/ue-export/textures.py`

Neu erzeugen der Daten: im Ordner `alte-version-browser` → `npm install` → `npx tsx tools/ue-export/export.ts`.

## Plan (nächste Schritte, lokal)
1. C++-Projekt „ProjectZero“ anlegen (UE 5.8, Enhanced Input), kompilieren.
2. Modelle als glTF exportieren (ohne Meshopt, ein Mesh je Modell, Materialien mit den Texturen) und importieren.
3. Landschaft aus Höhenkarte + Schichtmasken, Landschaftsmaterial.
4. Kern in C++: Spielfigur (Kamera, Bewegung), Kampf (3er-Kombo, schwerer Hieb, Block/perfekte Parade, Konter,
   Ausweichen mit Unverwundbarkeit, Haltung/Taumeln/Gnadenstoß, Trefferstopp, Ragdoll-Tod), Gegner + KI,
   Platzierung aus `Layout.json`, NSC + Dialoge, HUD.
5. Danach: Quests, Inventar, Tagesabläufe, MetaHuman-Figuren, Glas-Reh (Glasläufer) als Skelett-Modell mit Animationen.
