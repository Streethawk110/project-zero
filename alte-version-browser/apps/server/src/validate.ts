// Strenge Prüfung eingehender Nachrichten. Alles, was nicht exakt passt, wird verworfen.

import type { ClientMessage, GameCommand, MoveInput } from '@pz/shared';

const isNum = (v: unknown, min = -1e7, max = 1e7): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const isStr = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isId = (v: unknown) => isStr(v, 64) && /^[\w.:-]*$/.test(v as string);
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function validInput(i: unknown): i is MoveInput {
  if (!obj(i)) return false;
  return isNum(i['seq'], 0, 1e12) && isNum(i['mx'], -1.01, 1.01) && isNum(i['mz'], -1.01, 1.01) && isNum(i['yaw'], -1e4, 1e4) &&
    isBool(i['sprint']) && isBool(i['walk']) && isBool(i['jump']) && isBool(i['dodge']) && isBool(i['block']) && isBool(i['aim']);
}

export function validCommand(c: unknown): c is GameCommand {
  if (!obj(c) || !isStr(c['t'], 32)) return false;
  switch (c['t']) {
    case 'attack': return isNum(c['yaw'], -1e4, 1e4) && (c['heavy'] === undefined || isBool(c['heavy']));
    case 'skill': return isId(c['id']) && isNum(c['yaw'], -1e4, 1e4) && (c['tx'] === undefined || isNum(c['tx'])) && (c['tz'] === undefined || isNum(c['tz'])) && (c['target'] === undefined || isNum(c['target'], 0, 1e9));
    case 'interact': return (c['id'] === undefined || isId(c['id'])) && (c['eid'] === undefined || isNum(c['eid'], 0, 1e9));
    case 'dialogue_choose': return isNum(c['idx'], -1, 50);
    case 'equip': return isId(c['uid']) && (c['slot'] === undefined || ['weapon', 'offhand', 'armor', 'accessory1', 'accessory2'].includes(c['slot'] as string));
    case 'unequip': return ['weapon', 'offhand', 'armor', 'accessory1', 'accessory2'].includes(c['slot'] as string);
    case 'use_item': case 'upgrade': return isId(c['uid']);
    case 'drop_item': return isId(c['uid']) && isNum(c['n'], 1, 999);
    case 'hotbar': return isNum(c['idx'], 0, 5) && (c['skill'] === null || isId(c['skill']));
    case 'quick_item': return c['id'] === null || isId(c['id']);
    case 'learn_skill': return isId(c['id']);
    case 'attr': return ['str', 'dex', 'int', 'con'].includes(c['attr'] as string);
    case 'craft': return isId(c['recipe']);
    case 'buy': return isId(c['shop']) && isId(c['item']) && isNum(c['n'], 1, 20) && (c['offer'] === undefined || isNum(c['offer'], 0, 1e6));
    case 'sell': return isId(c['shop']) && isId(c['uid']) && isNum(c['n'], 1, 999);
    case 'travel': return isId(c['rest']);
    case 'sight': return isBool(c['on']);
    case 'track_quest': return c['id'] === null || isId(c['id']);
    case 'loot_take': return isNum(c['eid'], 0, 1e9);
    case 'emote': return isId(c['id']);
    case 'companion': return ['follow', 'wait', 'plate'].includes(c['order'] as string);
    case 'lockpick': return isId(c['id']) && isBool(c['ok']);
    case 'brew': return isId(c['recipe']) && Array.isArray(c['steps']) && c['steps'].length <= 40 && c['steps'].every((st) => {
      const o = st as Record<string, unknown>;
      if (!o || typeof o !== 'object') return false;
      if (o['a'] === 'base') return o['v'] === 'water' || o['v'] === 'wine' || o['v'] === 'oil';
      if (o['a'] === 'add') return isId(o['item']) && isBool(o['ground']);
      return o['a'] === 'boil' || o['a'] === 'bottle';
    });
    case 'wait': return isNum(c['hours'], 1, 24);
    case 'dice': return (c['op'] === 'roll' || c['op'] === 'bank' || c['op'] === 'quit') && (c['keep'] === undefined || (Array.isArray(c['keep']) && c['keep'].length <= 6 && c['keep'].every((k) => Number.isInteger(k) && (k as number) >= 0 && (k as number) < 6)));
    case 'stele': return Array.isArray(c['order']) && c['order'].length <= 3 && c['order'].every((x) => isId(x));
    case 'duel': return isNum(c['target'], 0, 1e9);
    case 'duel_accept': return isNum(c['from'], 0, 1e9);
    case 'trade_offer': return isNum(c['target'], 0, 1e9) && isNum(c['gold'], 0, 1e8) && Array.isArray(c['items']) && c['items'].length <= 12 && c['items'].every((it) => obj(it) && isId(it['uid']) && isNum(it['n'], 1, 999));
    case 'gleichklang': case 'interact_cancel': case 'dialogue_end': case 'switch_set': case 'quick_use': case 'respec': case 'rest': case 'respawn': case 'trade_accept': case 'trade_cancel':
      return true;
    default:
      return false;
  }
}

export function validClientMessage(m: unknown): m is ClientMessage {
  if (!obj(m) || !isStr(m['m'], 20)) return false;
  switch (m['m']) {
    case 'hello': return isStr(m['token'], 120) && isNum(m['version'], 0, 1000) && (m['resume'] === undefined || isStr(m['resume'], 120));
    case 'chars': case 'leave': return true;
    case 'create_char': return isStr(m['name'], 40) && ['guard', 'hunter', 'scholar'].includes(m['origin'] as string) && obj(m['appearance']);
    case 'delete_char': case 'join': return isId(m['id'] ?? m['charId']);
    case 'in': return Array.isArray(m['i']) && m['i'].length <= 8 && m['i'].every(validInput);
    case 'cmd': return validCommand(m['c']);
    case 'chat': return isStr(m['text'], 300) && ['say', 'party', 'world'].includes(m['ch'] as string);
    case 'party': return ['invite', 'accept', 'decline', 'leave', 'kick'].includes(m['op'] as string) && (m['target'] === undefined || isStr(m['target'], 40));
    case 'ping_marker': return isNum(m['x']) && isNum(m['z']) && isStr(m['kind'], 16);
    case 'ping': return isNum(m['t'], 0, 1e13);
    default: return false;
  }
}

/** Chat säubern: Steuerzeichen entfernen, Länge begrenzen. */
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f\\u200b-\\u200f\\u2028-\\u202e]', 'g');
export function cleanChat(t: string) {
  return t.replace(CONTROL_CHARS, '').trim().slice(0, 200);
}

/** Token-Bucket gegen Nachrichtenfluten. */
export class RateLimiter {
  private tokens: number;
  private last = Date.now();
  constructor(private rate: number, private burst: number) {
    this.tokens = burst;
  }
  take(n = 1) {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}
