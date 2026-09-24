// Einzelspieler-Spielstände: lokal im Browser (localStorage), getrennt von
// Online-Charakteren, die ausschließlich auf dem Server liegen.

import { hashString, validateCharacter, ZONES, zoneAt, type CharacterData, type World } from '@pz/shared';

export const SLOT_COUNT = 5;
export const AUTO_SLOT = 0; // Platz 0 = automatische Sicherung
const PREFIX = 'pz.sp.save.';

export interface SaveMeta {
  slot: number;
  name: string;
  level: number;
  origin: string;
  zone: string;
  playtime: number;
  savedAt: number;
  quest: string;
}

export interface SaveFile {
  format: 'project-zero-save';
  version: 1;
  savedAt: number;
  char: CharacterData;
  world: ReturnType<World['exportState']>;
  checksum: string;
}

function checksum(char: CharacterData, world: unknown) {
  return hashString(JSON.stringify(char) + '|' + JSON.stringify(world)).toString(36);
}

function storage(): Storage {
  try {
    const s = window.localStorage;
    const k = '__pz_test__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    throw new Error('Der lokale Speicher ist nicht verfügbar (privates Fenster oder blockierte Websitedaten). Spielstände können dann nur exportiert werden.');
  }
}

export function storageAvailable() {
  try {
    storage();
    return true;
  } catch {
    return false;
  }
}

export function metaOf(slot: number, f: SaveFile): SaveMeta {
  const z = zoneAt(f.char.pos.x, f.char.pos.z);
  const main = Object.entries(f.char.quests).find(([id, q]) => id.startsWith('mq_') && !q.done);
  return {
    slot, name: f.char.name, level: f.char.level, origin: f.char.origin, zone: z?.name ?? ZONES[0]!.name,
    playtime: f.char.playtime, savedAt: f.savedAt, quest: main ? main[0] : 'mq_done',
  };
}

export function listSlots(): (SaveMeta | null)[] {
  const out: (SaveMeta | null)[] = [];
  for (let i = 0; i <= SLOT_COUNT; i++) {
    try {
      const raw = storage().getItem(PREFIX + i);
      if (!raw) { out.push(null); continue; }
      out.push(metaOf(i, JSON.parse(raw) as SaveFile));
    } catch {
      out.push(null);
    }
  }
  return out;
}

export function makeSave(char: CharacterData, world: ReturnType<World['exportState']>): SaveFile {
  const c = structuredClone(char);
  return { format: 'project-zero-save', version: 1, savedAt: Date.now(), char: c, world, checksum: checksum(c, world) };
}

export function writeSlot(slot: number, f: SaveFile) {
  try {
    storage().setItem(PREFIX + slot, JSON.stringify(f));
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Der lokale Speicher')) throw e;
    throw new Error('Speichern fehlgeschlagen: Der Speicherplatz des Browsers ist voll. Exportiere oder lösche alte Spielstände.');
  }
}

export function readSlot(slot: number): SaveFile {
  const raw = storage().getItem(PREFIX + slot);
  if (!raw) throw new Error('Dieser Speicherplatz ist leer.');
  return parseSave(raw);
}

export function deleteSlot(slot: number) {
  storage().removeItem(PREFIX + slot);
}

export function parseSave(raw: string): SaveFile {
  let f: SaveFile;
  try {
    f = JSON.parse(raw) as SaveFile;
  } catch {
    throw new Error('Die Datei ist kein gültiger Spielstand (kein lesbares JSON).');
  }
  if (f?.format !== 'project-zero-save') throw new Error('Die Datei ist kein Project-Zero-Spielstand.');
  if (f.version !== 1) throw new Error(`Spielstandversion ${String(f.version)} wird nicht unterstützt.`);
  if (f.checksum !== checksum(f.char, f.world)) throw new Error('Die Prüfsumme stimmt nicht. Der Spielstand ist beschädigt oder wurde verändert.');
  const v = validateCharacter(f.char);
  if (!v.ok) throw new Error(`Der Spielstand ist ungültig: ${v.error}`);
  f.char = v.char;
  return f;
}

export function exportSlot(slot: number) {
  const f = readSlot(slot);
  const blob = new Blob([JSON.stringify(f, null, 1)], { type: 'application/json' });
  const date = new Date(f.savedAt).toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `project-zero_${f.char.name.replace(/[^\p{L}\d_-]/gu, '_')}_${date}.pzsave.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export async function importFile(file: File, slot: number) {
  if (file.size > 2_000_000) throw new Error('Die Datei ist zu groß für einen Spielstand.');
  const text = await file.text();
  const f = parseSave(text);
  writeSlot(slot, f);
  return metaOf(slot, f);
}
