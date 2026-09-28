"""Texturen der Browser-Fassung für Unreal: WebP → JPEG/PNG in ProjectZeroUE5/Import/Textures.
Farbe (sRGB) und Normalen als JPEG, ORM (R = Umgebungsverdeckung, G = Rauheit, B = Metall-Maske 255) als JPEG,
Blattkarten mit Alpha als PNG.  Aufruf: python3 tools/ue-export/textures.py"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '../../apps/client/public/assets/textures')
OUT = os.path.join(HERE, '../../../ProjectZeroUE5/Import/Textures')
os.makedirs(OUT, exist_ok=True)

PBR = ['bark', 'cloth', 'leather', 'metal', 'plaster', 'roof', 'rock', 'stone', 'thatch', 'wood', 'chain', 'plate',
       'grass', 'dirt', 'sand', 'forest', 'glass', 'snow', 'cobble']
FOLIAGE = ['bush', 'oak', 'spruce', 'pine', 'grass', 'dry', 'curly']
total = 0
for s in PBR:
    col = Image.open(f'{SRC}/{s}_color.webp').convert('RGB')
    col.save(f'{OUT}/T_{s}_color.jpg', quality=90)
    Image.open(f'{SRC}/{s}_normal.webp').convert('RGB').save(f'{OUT}/T_{s}_normal.jpg', quality=94)
    arm = Image.open(f'{SRC}/{s}_arm.webp').convert('RGB')
    r, g, _ = arm.split()
    Image.merge('RGB', (r, g, Image.new('L', arm.size, 255))).save(f'{OUT}/T_{s}_orm.jpg', quality=90)
for f in FOLIAGE:
    Image.open(f'{SRC}/foliage_{f}_color.webp').convert('RGBA').save(f'{OUT}/T_foliage_{f}_color.png', optimize=True)
    Image.open(f'{SRC}/foliage_{f}_normal.webp').convert('RGB').save(f'{OUT}/T_foliage_{f}_normal.jpg', quality=94)
for f in os.listdir(OUT):
    total += os.path.getsize(os.path.join(OUT, f))
print(f'{len(os.listdir(OUT))} Texturen, {total / 1e6:.1f} MB')
