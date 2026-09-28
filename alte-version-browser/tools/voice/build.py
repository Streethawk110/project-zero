#!/usr/bin/env python3
"""Sprachaufnahmen für alle Figuren vorab erzeugen (neuronale Sprachsynthese Piper, deutsche Stimmen).

  npx tsx tools/voice/lines.ts > tools/voice/.cache/lines.json
  python3 tools/voice/build.py            # → apps/client/public/assets/voice/<stimme>.json

Benötigt: pip install piper-tts soundfile; Stimmmodelle (Piper v0.0.2, GitHub-Release rhasspy/piper) in
tools/voice/.cache/voices/<modell>/<modell>.onnx. Genutzt werden nur frei lizenzierte Stimmen: Thorsten und
Kerstin (CC0), Karlsson, Eva K. und Ramona (M-AILABS-Datensatz).

Tonhöhe je Stimme: mit length_scale = Tonhöhe gesprochen und im Spiel mit playbackRate = Tonhöhe abgespielt
→ Stimme höher/tiefer bei gleicher Dauer. Ausgabe je Stimme: {Schlüssel: [MP3 als Base64, Dauer]}.
"""
import base64, io, json, os, sys
import numpy as np
import soundfile as sf
from piper import PiperVoice, SynthesisConfig

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '.cache')
OUT = os.path.join(HERE, '..', '..', 'apps', 'client', 'public', 'assets', 'voice')
SLOTS = {  # wie VOICE_SLOTS in packages/shared/src/voices.ts
    'm0': ('de-thorsten-low', 1.0), 'm1': ('de-thorsten-low', 0.9), 'm2': ('de-karlsson-low', 1.0), 'm3': ('de-karlsson-low', 0.9),
    'm4': ('de-thorsten-low', 1.07), 'f0': ('de-kerstin-low', 1.0), 'f1': ('de-eva_k-x-low', 1.0), 'f2': ('de-ramona-low', 1.0),
    'f3': ('de-kerstin-low', 1.08), 'f4': ('de-ramona-low', 0.93),
}
# Grundtempo je Modell (manche sprechen hastig)
TEMPO = {'de-thorsten-low': 0.82, 'de-karlsson-low': 0.88, 'de-kerstin-low': 0.87, 'de-eva_k-x-low': 1.1, 'de-ramona-low': 0.84}


def key(text: str) -> str:
    """Wie voiceKey() im Client (FNV-1a + djb2 über UTF-16-Codeeinheiten)."""
    h, h2 = 2166136261, 5381
    for c in text.encode('utf-16-le').decode('utf-16-le'):
        for u in ([ord(c)] if ord(c) < 0x10000 else [0xD800 + ((ord(c) - 0x10000) >> 10), 0xDC00 + ((ord(c) - 0x10000) & 0x3FF)]):
            h = ((h ^ u) * 16777619) & 0xFFFFFFFF
            h2 = ((h2 * 33) & 0xFFFFFFFF) ^ u
    def b36(n):
        s = ''
        while True:
            n, r = divmod(n, 36)
            s = '0123456789abcdefghijklmnopqrstuvwxyz'[r] + s
            if n == 0:
                return s
    return b36(h) + b36(h2)


def clean(a: np.ndarray, sr: int) -> np.ndarray:
    """Stille an den Rändern kürzen (50 ms Rest), leise ein- und ausblenden, Lautstärke angleichen."""
    env = np.abs(a) > 0.02
    idx = np.nonzero(env)[0]
    if len(idx):
        a = a[max(0, idx[0] - int(0.05 * sr)): idx[-1] + int(0.12 * sr)]
    rms = np.sqrt(np.mean(a ** 2)) + 1e-9
    a = a * min(0.12 / rms, 0.95 / (np.abs(a).max() + 1e-9))
    f = int(0.01 * sr)
    a[:f] *= np.linspace(0, 1, f)
    a[-f:] *= np.linspace(1, 0, f)
    return a


def main(only=None):
    lines = json.load(open(os.path.join(CACHE, 'lines.json')))
    os.makedirs(OUT, exist_ok=True)
    models = {}
    for slot, (model, pitch) in SLOTS.items():
        if only and slot not in only:
            continue
        todo = [l['text'] for l in lines if l['slot'] == slot]
        if model not in models:
            models[model] = PiperVoice.load(os.path.join(CACHE, 'voices', model, model + '.onnx'))
        v = models[model]
        cfg = SynthesisConfig(length_scale=pitch / TEMPO[model], noise_scale=0.6, noise_w_scale=0.8)
        bundle, total = {}, 0.0
        for i, text in enumerate(todo):
            chunks = list(v.synthesize(text, syn_config=cfg))
            sr = chunks[0].sample_rate
            a = np.concatenate([c.audio_float_array for c in chunks]).astype(np.float32)
            a = clean(a, sr)
            buf = io.BytesIO()
            sf.write(buf, a, sr, format='MP3', subtype='MPEG_LAYER_III', compression_level=0.75)
            dur = len(a) / sr / pitch
            total += dur
            bundle[key(text)] = [base64.b64encode(buf.getvalue()).decode(), round(dur, 2)]
            if i % 25 == 0:
                print(f'{slot} {i}/{len(todo)}', file=sys.stderr)
        path = os.path.join(OUT, f'{slot}.json')
        with open(path, 'w') as f:
            json.dump({'pitch': pitch, 'lines': bundle}, f, separators=(',', ':'))
        print(f'{slot}: {len(bundle)} Zeilen, {total / 60:.1f} min, {os.path.getsize(path) / 1e6:.2f} MB')


if __name__ == '__main__':
    main(sys.argv[1:] or None)
