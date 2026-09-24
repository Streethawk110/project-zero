import { ZONES } from '../world/region.ts';

export interface CodexEntry {
  id: string;
  cat: 'place' | 'person' | 'faction' | 'event' | 'lore';
  title: string;
  text: string;
}

const entries: CodexEntry[] = [
  // ---------- Personen ----------
  { id: 'person_isra', cat: 'person', title: 'Isra Venn', text: 'Kartografin der Expedition Null. Trocken, neugierig, misstrauisch gegenüber jeder Autorität. Trägt eine Laterne, deren Licht Nachhalle erstarren lässt. Sucht ihren verschollenen Bruder Tobin.' },
  { id: 'person_vogt', cat: 'person', title: 'Vogt Berengar', text: 'Vorsteher von Haldenbruck. Diente einst mit Hauptmann Rast. Erschöpft, pragmatisch und bereit, mit jedem zu verhandeln, der sein Dorf am Leben hält.' },
  { id: 'person_ysolde', cat: 'person', title: 'Präzeptorin Ysolde Harn', text: 'Anführerin des Ordens der Stillen Flamme in der Grenzmark. Kühle Strategin mit einer Narbe über der Wange. Glaubt aufrichtig, dass Feuer Leben rettet – und zählt jede Nacht die Toten, die dieser Glaube gekostet hat.' },
  { id: 'person_aldric', cat: 'person', title: 'Kontormeister Aldric Vey', text: 'Vertreter des Kontors von Vardenfall. Charmant, berechnend und stets freundlich. Er weiß mehr über den Stillen Einsturz, als er zugibt.' },
  { id: 'person_maren', cat: 'person', title: 'Seherin Maren', text: 'Stimme der Verwurzelten. Selbst Berührt: Glasadern ziehen sich über ihre Schläfe. Sanft, geduldig und auf eine Weise unheimlich, die man erst spät bemerkt.' },
  { id: 'person_anselm', cat: 'person', title: 'Bruder Anselm', text: 'Feldpriester des Ordens, der an einer Ruine betet, die nicht zu seinem Glauben gehört. Zweifelt an Ysoldes Methoden, aber nicht an ihrer Absicht.' },
  { id: 'person_rast', cat: 'person', title: 'Hauptmann Corvin Rast', text: 'Leiter der Expedition Null. Verlor vor vierzig Jahren seine Tochter Elin beim Stillen Einsturz. Galt nach dem Blitz am Grubentor als tot.' },

  // ---------- Fraktionen ----------
  { id: 'faction_order', cat: 'faction', title: 'Orden der Stillen Flamme', text: 'Symbol: eine Flamme über gekreuzten Linien. Ziel: das Nullherz versiegeln und alles Berührte reinigen. Methoden: Feuer, Quarantäne, Glaubenseifer. Schwäche: Sie verbrennen Berührte „zu ihrem Heil“ und nutzen Angst als Werkzeug.' },
  { id: 'faction_kontor', cat: 'faction', title: 'Das Kontor von Vardenfall', text: 'Symbol: eine Waage mit Kristall. Ziel: das Nulllicht als Energiequelle und Handelsware nutzen. Methoden: Verträge, Söldner, Bestechung. Schwäche: Gewinn geht vor Menschenleben – und die Wahrheit über den Stillen Einsturz liegt in ihren Büchern.' },
  { id: 'faction_rooted', cat: 'faction', title: 'Die Verwurzelten', text: 'Symbol: eine Wurzel, die einen Kreis umschließt. Ziel: mit dem Nulllicht als lebendigem Wesen koexistieren. Methoden: Rituale, Heilung, Sabotage. Schwäche: Sie „füttern“ die Quelle heimlich mit Leben, und Fremde sind ihnen entbehrlich.' },

  // ---------- Ereignisse ----------
  { id: 'event_collapse', cat: 'event', title: 'Der Stille Einsturz', text: 'Vor vierzig Jahren brach in der Grube Tiefenrast ein Stollen ein. Darunter lag das Nullherz. Das Licht stieg auf wie Schnee, der zurück in den Himmel fällt. Dutzende Bergleute starben, darunter Elin Rast, sieben Jahre alt.' },
  { id: 'event_collapse_truth', cat: 'event', title: 'Die Wahrheit über den Einsturz', text: 'Der Einsturz war kein Unfall. Aldric Vey ließ den Stollen sprengen, um konkurrierende Kontore von der Grube fernzuhalten. Er wusste nicht, was darunter lag. Er hat es vierzig Jahre verschwiegen.' },
  { id: 'event_vision', cat: 'event', title: 'Die Vision am Altar', text: 'Als du den Altar berührtest, sahst du die Expedition von oben: zwölf Menschen im Grubentor, und in ihrer Mitte eine Gestalt in Glas, die die Augen öffnet. Die Gestalt warst du. Auf deinem Siegel stand: 0.' },
  { id: 'event_captain', cat: 'event', title: 'Der Hohle Hauptmann', text: 'Corvin Rast führte die Expedition nicht, um zu messen, sondern um das Herz zu wecken. Er glaubte, das Licht würde Elin als Nachhall zurückbringen. Das Glas nahm ihn stattdessen. In der Kristallkathedrale sprach er bis zuletzt mit einer Tochter, die nicht da war.' },
  { id: 'event_number_zero', cat: 'event', title: 'Nummer Null', text: 'Du standest auf keiner Liste. Rast fand dich drei Wochen vor der Expedition im Glas von Tiefenrast, schlafend. Die neue Welle begann in der Nacht, in der du erwachtest. Was du bist, weiß niemand – vielleicht nicht einmal das Herz.' },

  // ---------- Fundstücke ----------
  { id: 'lore_expedition', cat: 'lore', title: 'Einsatzbefehl – Expedition Null', text: '„Auftrag: Messung der Nullstrahlung im Tal von Haldenbruck. Leitung: Hptm. C. Rast. Teilnehmer: 12 (Liste beigefügt).“\n\nDarunter, in anderer, zittriger Handschrift: „Nr. 0 ist mitzuführen. Unter allen Umständen. – R.“' },
  { id: 'lore_tobin_1', cat: 'lore', title: 'Tobins Tagebuch – Seite 1', text: '„Tag 12. Die Pilze im Flüsterforst leuchten nur dort, wo das Glas unter der Erde verläuft. Ich habe eine Karte der Adern angefangen. Isra würde lachen – meine Karten sind schief. Aber diese hier stimmt. Die Adern laufen alle nach Nordosten. Zur Grube.“ (Am Rand: ein sorgfältig gezeichneter Käfer.)' },
  { id: 'lore_tobin_2', cat: 'lore', title: 'Tobins Tagebuch – Seite 2', text: '„Tag 31. In der Glasnarbe hört man es. Ein Pochen, sehr langsam. Wenn ich die Hand auf das Glas lege, pocht es schneller. Als würde es antworten. Das Licht ruft nicht. Es antwortet.“' },
  { id: 'lore_tobin_3', cat: 'lore', title: 'Tobins Tagebuch – Seite 3', text: '„Tag ?. Ich habe jemanden im Glas gefunden. Einen Menschen, der schläft. Das Herz schlägt in seinem Takt. Ich traue mich nicht, ihn zu wecken. Ich gehe zurück und hole Hilfe. Wenn ich nicht zurückkomme: Isra wird es verstehen.“\n\n(Die Seite ist halb in Glas eingeschlossen.)' },
  { id: 'lore_oda', cat: 'lore', title: 'Steintafel der Gezeitenheiligen', text: '„Als die Flut kam, läutete Oda die Glocken. Erst das Dunkel, dann die Tiefe. Die Mitte wartet auf das Klare, und das Helle schließt den Kreis. So sprach das Meer: genug.“' },
  { id: 'lore_ledger', cat: 'lore', title: 'Kontorbuch, Jahrgang 612', text: 'Einträge in Aldric Veys eleganter Handschrift: „Sprengmeister Harl: 40 Silber, Stollen 7, Schweigepflicht.“ – „Kontor Brenn und Kontor Salm aus der Grube verdrängt.“ – „Verluste: 31. Entschädigung: keine (Unfall).“\n\nDarunter, neueren Datums: „Rotbart – Zahlung für Behinderung der Ordensversorgung, monatlich.“' },
  { id: 'lore_miner', cat: 'lore', title: 'Notiz eines Hauers', text: '„Für Janek, falls ich’s nicht zurück schaffe: Die gute Lore mit dem Silber steht hinter den Brettern in der Nische. Weichen stellen: die erste nach rechts, die zweite nach links, die dritte nach rechts. Dann rollt sie von selbst. Sag dem Kontor nix.“' },
  { id: 'lore_rast', cat: 'lore', title: 'Brief an Elin', text: '„Meine Elin. Vierzig Jahre schreibe ich dir diesen Brief, und nie habe ich ihn abgeschickt. Das Licht hat dich behalten. Ich habe jemanden gefunden, der es wecken kann – eine Nummer, keinen Namen. Wenn das Herz schlägt, wirst du wiederkommen. Ich weiß, was man über Nachhalle sagt. Es ist mir gleich. Ich will nur noch einmal deine Stimme hören. Dein Vater.“' },
  { id: 'lore_sermon', cat: 'lore', title: 'Predigt der Stillen Flamme', text: '„Das Licht, das nach oben fällt, ist gegen die Ordnung der Welt. Was gegen die Ordnung ist, muss ins Feuer. Nicht aus Hass. Aus Liebe zu dem, was bleibt.“ – Präzeptor Anwin, Jahr 613.' },
  { id: 'lore_wreck', cat: 'lore', title: 'Logbuch der Mövenschrei', text: '„Letzter Eintrag. Nebel. Der Steuermann schwört, er habe Lichter über dem Wasser gesehen, eine Reihe wie Trittsteine, bis hinaus zur Felsnadel. Wir sind ihnen gefolgt. Dann die Klippen. An Deck malt jemand Zeichen: eine Muschel und zwei Striche.“' },
  { id: 'lore_rooted', cat: 'lore', title: 'Wurzelzeichen', text: 'In die Rinde geschnittene Zeichen: ein Kreis, umschlungen von einer Wurzel. Darunter frische Kerben – eine für jeden, der „dem Herzen gegeben wurde“. Die jüngste ist kaum eine Woche alt.' },
  { id: 'lore_scar', cat: 'lore', title: 'Vermessungspflock des Kontors', text: 'Ein Pflock mit Messingschild: „Nullstärke 3,1 (Vorjahr: 0,4). Ursache unbekannt. Weitere Grabung empfohlen. – Kontor Vardenfall.“ Jemand hat „IHR WECKT ES“ darunter gekratzt.' },
  { id: 'lore_tidepath_hint', cat: 'lore', title: 'Joruns Erinnerung', text: 'Ein Pfad aus Licht zur Felsnadel, sagte Joruns Vater. Er erscheint nur, wenn man die Zeichen aus Wald, Ruine und Wrack in der richtigen Reihenfolge an die Gezeitenstele legt – die kleinste Zahl zuerst – und nur, wenn der Mond sinkt.' },
  { id: 'glyph_forest', cat: 'lore', title: 'Nullglyphe des Waldes', text: 'Eine Welle, darunter drei Striche.' },
  { id: 'glyph_ruin', cat: 'lore', title: 'Nullglyphe der Ruine', text: 'Ein sinkender Mond, darunter ein Strich.' },
  { id: 'glyph_wreck', cat: 'lore', title: 'Nullglyphe des Wracks', text: 'Eine Muschel, darunter zwei Striche.' },
  { id: 'secret_tidepath', cat: 'event', title: 'Der Gezeitenpfad', text: 'Mond, Muschel, Welle. Die Stele hat geantwortet. In Nächten erscheinen nun Trittsteine aus Licht über dem Wasser, bis hinaus zur Ertrunkenen Kapelle.' },
];

// Orte automatisch aus den Zonen
for (const z of ZONES) entries.push({ id: `place_${z.id}`, cat: 'place', title: z.name, text: z.desc });

export const CODEX: Record<string, CodexEntry> = Object.fromEntries(entries.map((e) => [e.id, e]));
export const CODEX_CATS: Record<CodexEntry['cat'], string> = { place: 'Orte', person: 'Personen', faction: 'Fraktionen', event: 'Ereignisse', lore: 'Fundstücke' };
