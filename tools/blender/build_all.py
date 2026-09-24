"""Erzeugt alle GLB-Modelle und die manifest.json für den Client.

Aufruf (Blender als Python-Modul oder im Blender-Hintergrundmodus):
    python tools/blender/build_all.py [name ...]
    blender -b -P tools/blender/build_all.py -- [name ...]
Ohne Namen werden alle Modelle gebaut. Ausgabeordner: apps/client/public/assets/models
(überschreibbar mit PZ_MODEL_OUT).
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import lib  # noqa: E402
import buildings  # noqa: E402
import props  # noqa: E402
import nature  # noqa: E402
import characters  # noqa: E402
import creatures  # noqa: E402
import character  # noqa: E402
import trees  # noqa: E402

REGISTRY = {}
for mod in (buildings, props, nature, characters, creatures, character, trees):
    REGISTRY.update(mod.ASSETS)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    wanted = [a for a in argv if not a.startswith("-")] or list(REGISTRY)
    unknown = [n for n in wanted if n not in REGISTRY]
    if unknown:
        raise SystemExit(f"Unbekannte Modelle: {', '.join(unknown)}")
    manifest_path = os.path.join(lib.OUT_DIR, "manifest.json")
    manifest = {}
    if os.path.exists(manifest_path):
        with open(manifest_path) as f:
            manifest = json.load(f)
    t0 = time.time()
    for name in wanted:
        fn, lod = REGISTRY[name]
        lib.reset()
        result = fn()
        if isinstance(result, dict):
            manifest[name] = lib.export(name, result["lod0"], None, lod1_objs=result["lod1"])
            continue
        objs = result if isinstance(result, list) else None
        manifest[name] = lib.export(name, objs, lod)
    manifest = {k: manifest[k] for k in sorted(manifest)}
    os.makedirs(lib.OUT_DIR, exist_ok=True)
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=1)
        f.write("\n")
    print(f"[blender] {len(wanted)} Modelle in {time.time() - t0:.1f}s -> {manifest_path}")


main()
