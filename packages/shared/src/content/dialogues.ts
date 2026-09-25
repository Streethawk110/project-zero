import type { DialogueChoice, DialogueNode } from '../types.ts';

const N = (id: string, text: string, choices: DialogueChoice[], extra: Partial<DialogueNode> = {}): DialogueNode => ({ id, speaker: 'npc', text, choices, ...extra });
const back = (to: string, text = '[Zurück]'): DialogueChoice => ({ text, next: to });
const end = (text = '[Gehen]'): DialogueChoice => ({ text, next: null });

const nodes: DialogueNode[] = [
  // ============================ ISRA ============================
  N('isra_root', 'Brauchst du was? Ich halte die Augen offen.', [
    { text: 'Wer bist du noch mal?', cond: '!flag:isra_intro', next: 'isra_intro' },
    { text: 'Was ist mit der Expedition passiert?', next: 'isra_expedition' },
    { text: 'Hier sind Tobins Seiten.', cond: 'quest:c_tobin=talk', next: 'isra_tobin_done' },
    { text: 'Hast du etwas von deinem Bruder gehört?', cond: '!quest:c_tobin:any & quest:mq_1:done', next: 'isra_tobin_start' },
    { text: 'Was denkst du über den Herzsplitter?', cond: 'quest:mq_2=decide', next: 'isra_splitter' },
    { text: 'Wir müssen reden. Über mich.', cond: 'quest:mq_4=isra', next: 'isra_epilogue' },
    { text: 'Wie geht es dir?', cond: 'quest:mq_1:done', next: 'isra_mood' },
    end('Nichts. Gehen wir.'),
  ], {
    speaker: 'isra',
    variants: [
      { cond: 'quest:mq_1=wake', text: 'Du lebst. Gut. Ich dachte schon, ich müsste mit den Toten allein reden. Durchsuch den Wagen – vielleicht ist noch etwas zu retten.' },
      { cond: 'quest:mq_4=isra', text: 'Da bist du. Setz dich. Nein – bleib stehen. Das hier ist leichter, wenn ich dich nicht ansehen muss.' },
      { cond: 'companion>=15', text: 'Na, Partner? Ich hab die Karte schon wieder ergänzt. Du läufst schneller, als ich zeichnen kann.' },
    ],
  }),
  N('isra_intro', 'Isra Venn. Kartografin der Expedition. Die, die dich aus dem Wagen gezogen hat, bevor das Glas ihn gefressen hat. Du erinnerst dich nicht?', [
    { text: 'Nicht an viel.', next: 'isra_intro2' },
    { text: 'Danke, dass du mich gerettet hast.', effects: ['companion:+3'], next: 'isra_intro2' },
  ], { speaker: 'isra', effects: ['flag:isra_intro', 'codex:person_isra'] }),
  N('isra_intro2', 'Das Nulllicht nimmt Erinnerungen. Manchmal gibt es sie zurück. Meistens nicht. Haldenbruck ist nicht weit – wenn der Vogt noch lebt, weiß er, wem wir diesen Schlamassel zu verdanken haben.', [back('isra_root')], { speaker: 'isra' }),
  N('isra_expedition', 'Zwölf Leute, drei Wagen, ein Auftrag: messen, wie stark das Licht wieder geworden ist. Hauptmann Rast hat uns direkt zum Grubentor geführt, obwohl das nicht der Plan war. Dann kam der Blitz. Weißes Licht, das nach oben fiel. Als ich aufwachte, gab es nur noch dich und mich.', [
    { text: 'Rast hat den Plan geändert?', next: 'isra_rast' },
    back('isra_root'),
  ], { speaker: 'isra' }),
  N('isra_rast', 'Er hatte es eilig. Als käme er zu spät zu einer Verabredung. Er hat die ganze Fahrt einen Brief in der Hand gehalten und ihn nie geöffnet.', [back('isra_root')], { speaker: 'isra', effects: ['flag:rast_hint'] }),
  N('isra_mood', 'Ehrlich? Ich zeichne Karten, damit ich nicht nachdenken muss. Solange du weiterläufst, habe ich genug zu zeichnen.', [
    { text: 'Du bist nicht allein.', effects: ['companion:+2'], next: 'isra_mood2' },
    back('isra_root'),
  ], {
    speaker: 'isra',
    variants: [
      { cond: 'touch>=40', text: 'Ich schaue dir auf die Hände, wenn du schläfst. Sie leuchten. Ich sage es nur, weil du es wissen solltest – nicht, weil ich Angst habe. Na gut. Ein bisschen.' },
      { cond: 'flag:choice_kontor', text: 'Du hast es Aldric verkauft. Ich verstehe es sogar. Aber jedes Mal, wenn ich eine Kontorlampe sehe, denke ich an Tobin.' },
      { cond: 'flag:choice_order', text: 'Der Orden versiegelt das Herz. Gut. Hoffentlich versiegeln sie nicht auch uns.' },
    ],
  }),
  N('isra_mood2', 'Hm. Sag das nicht zu laut, sonst gewöhne ich mich dran.', [back('isra_root')], { speaker: 'isra' }),
  N('isra_tobin_start', 'Tobin. Mein kleiner Bruder. Er hat für die Akademie Pilze kartiert, vor einem Jahr, genau hier. Dann kam nichts mehr. Wenn du Seiten mit einer unordentlichen Handschrift findest, die Ränder voller Käferzeichnungen … das ist er.', [
    { text: 'Ich halte die Augen offen.', effects: ['quest:start:c_tobin', 'companion:+2'], next: null },
  ], { speaker: 'isra' }),
  N('isra_tobin_done', 'Das sind … seine. Alle drei. „Das Licht ruft nicht, es antwortet.“ Das hat er geschrieben. Und dann: „Isra wird es verstehen.“ Ich verstehe gar nichts, Tobin.', [
    { text: 'Er hat dir vertraut.', effects: ['flag:tobin_done', 'companion:+5'], next: 'isra_tobin_end' },
    { text: 'Vielleicht lebt er noch.', effects: ['flag:tobin_done', 'companion:+3'], next: 'isra_tobin_end' },
  ], { speaker: 'isra' }),
  N('isra_tobin_end', 'Hier. Sein Kompass. Die Nadel zeigt nie nach Norden, nur auf Dinge, die jemand versteckt hat. Er hätte gewollt, dass ihn jemand trägt, der noch sucht.', [end('[Den Kompass annehmen]')], { speaker: 'isra' }),
  N('isra_splitter', 'Ysolde will ihn verbrennen, Aldric verkaufen, Maren … füttern. Und du hältst ihn fest, als würde er dir gehören. Vielleicht tut er das.', [
    { text: 'Ich behalte ihn. Niemand bekommt das Herz.', cond: 'item:herzsplitter', tag: 'Entscheidung', effects: ['touch:+20', 'flag:choice_self', 'flag:splitter_decided', 'flag:mine_open', 'item:+mine_key:1', 'rep:order-10', 'rep:kontor-10', 'rep:rooted-5', 'companion:+2', 'quest:choice:mq_2:Behalten – du trägst das Licht selbst', 'quest:start:mq_3'], next: 'isra_keep' },
    { text: 'Ich habe mich noch nicht entschieden.', next: null },
  ], { speaker: 'isra' }),
  N('isra_keep', 'Dann tragen wir das jetzt beide. Wenn du anfängst zu leuchten, kippe ich dir einen Eimer Wasser über den Kopf. … Emrik am Grubentor hatte übrigens einen Schlüssel. Hatte.', [end()], { speaker: 'isra' }),
  N('isra_epilogue', 'Ich habe die Expeditionsliste nie verloren. Ich habe sie versteckt. Zwölf Namen. Deiner ist nicht dabei. Die Nummer auf deinem Siegel – Null – gehört zu keinem Menschen. Rast hat dich nicht angeworben, {name}. Er hat dich gefunden. In der Grube. Vor drei Wochen. Du lagst im Glas, als hättest du dort geschlafen.', [
    { text: 'Dann bin ich … was?', next: 'isra_epi2' },
    { text: 'Warum hast du es mir nicht gesagt?', effects: ['companion:-1'], next: 'isra_epi2' },
  ], { speaker: 'isra', effects: ['codex:event_number_zero'] }),
  N('isra_epi2', 'Ich weiß es nicht. Das Licht wurde stärker in der Nacht, als du die Augen aufgeschlagen hast. Maren sagt, das Herz hat sich jemanden gesucht, der es hört. Ysolde würde sagen, du bist die Wunde. Ich sage: Du hast mir mehr als einmal das Leben gerettet. Das reicht mir.', [
    { text: 'Dann finden wir gemeinsam heraus, wer ich bin.', effects: ['flag:epilogue_isra', 'companion:+5', 'achieve:number_zero'], next: 'isra_epi_end' },
    { text: 'Ich muss das allein herausfinden.', effects: ['flag:epilogue_isra', 'achieve:number_zero'], next: 'isra_epi_alone' },
  ], { speaker: 'isra' }),
  N('isra_epi_end', 'Gemeinsam. Dann hole ich meine Karten. Ein ganzer Norden wartet darauf, falsch gezeichnet zu werden. Und Vardenfall … Vardenfall hat noch ein paar Antworten für uns.', [end('[Ende der Hauptgeschichte – die Welt bleibt offen]')], { speaker: 'isra' }),
  N('isra_epi_alone', 'Allein kommt niemand weit in diesem Land. Aber gut. Wenn du zurückkommst – ich bin in der Laterne. Ich warte.', [end('[Ende der Hauptgeschichte – die Welt bleibt offen]')], { speaker: 'isra' }),

  // ============================ VOGT ============================
  N('vogt_root', 'Wieder da, {name}? Haldenbruck hat seine Tore für dich offen – vorerst.', [
    { text: 'Ich bin {name}. Ich erinnere mich an kaum etwas.', cond: '!flag:met_vogt', next: 'vogt_meet1' },
    { text: 'Wo finde ich die Fraktionen?', cond: 'quest:mq_2=voices', next: 'vogt_voices' },
    { text: 'Die Grube ist offen.', cond: 'quest:mq_3=gate | quest:mq_3=seal', next: 'vogt_mine' },
    { text: 'Der Hauptmann ist tot.', cond: 'quest:mq_4=report', next: 'vogt_epi' },
    { text: 'Wie steht es um das Dorf?', cond: 'flag:met_vogt', next: 'vogt_status' },
    end('Leb wohl.'),
  ], { variants: [{ cond: '!flag:met_vogt', text: 'Halt. Du trägst die Farben der Expedition. Der Expedition, die vor drei Tagen durch mein Tor zog und nicht zurückkam. Wer bist du – und warum lebst du?' }] }),
  N('vogt_meet1', 'Kaum etwas. Wie praktisch. Isra bürgt für dich? … Gut. Dann hör zu: Seit ihr in der Grube wart, leuchtet das Glas wieder. Tiere werden krank, Kinder träumen dasselbe. Und drei Gruppen in meinem Dorf wollen alle dasselbe – dich.', [
    { text: 'Mich?', next: 'vogt_meet2' },
  ], { effects: ['codex:person_vogt'] }),
  N('vogt_meet2', 'Du bist der einzige Überlebende, der dort etwas gesehen haben könnte. Der Orden, das Kontor und die Verwurzelten. Sprich mit allen dreien, bevor sie sich deinetwegen die Köpfe einschlagen. Und such dir einen Schlafplatz – Hedda in der Laterne hat noch Betten.', [
    { text: 'Ich höre sie an.', effects: ['flag:met_vogt', 'quest:start:mq_2'], next: null },
  ]),
  N('vogt_voices', 'Ysolde sitzt in der Kapelle im Norden des Dorfes, Aldric im Kontor, als gehörte ihm alles schon. Maren kommt nicht mehr hinter die Palisade. Du findest sie im Flüsterforst, an einem Schrein aus Wurzeln – westlich, jenseits der Brücke.', [back('vogt_root')]),
  N('vogt_status', 'Wir halten durch. Die Palisade ist alt, die Wachen sind müde. Rotbarts Plünderer werden frecher. Wenn du helfen willst – Brann am Westtor kann jede Klinge brauchen.', [back('vogt_root')], {
    variants: [
      { cond: 'flag:choice_order', text: 'Der Orden bewacht jetzt die Tore. Sicherer ist es. Aber die Leute flüstern, wenn eine Kutte vorbeigeht.' },
      { cond: 'flag:choice_kontor', text: 'Das Kontor zahlt gut. Die Grube frisst wieder Männer. Ich kann nicht sagen, ob das ein guter Tausch ist.' },
      { cond: 'flag:choice_rooted', text: 'Überall wachsen Wurzeln aus den Wänden. Die Kinder lachen wieder. Die Alten beten.' },
      { cond: 'flag:choice_self', text: 'Die Leute schauen dich an wie ein Gewitter, das noch nicht entschieden hat, wo es einschlägt.' },
    ],
  }),
  N('vogt_mine', 'Dann geht es also wieder los. Vierzig Jahre war das Tor zu. Bring zurück, was dort unten ist – oder sorge dafür, dass es dort bleibt.', [back('vogt_root')]),
  N('vogt_epi', 'Tot. Rast. Ich habe mit ihm gedient, weißt du. Vor dem Einsturz. Er hat seine Tochter in Tiefenrast verloren – Elin. Sieben Jahre alt. Die Kontorleute haben sie nie gefunden.', [
    { text: 'Er wollte sie zurückholen. Mit dem Licht.', next: 'vogt_epi2' },
  ]),
  N('vogt_epi2', 'Und das Herz? Es schlägt weiter, sagen alle. Nur keiner weiß, für wen.', [
    { text: 'Was wird jetzt aus Haldenbruck?', effects: ['flag:epilogue_vogt'], next: 'vogt_epi3' },
  ], {
    variants: [
      { cond: 'flag:choice_order', text: 'Nun wacht der Orden über das Herz. Sie sagen, sie werden es versiegeln. Ich hoffe, sie meinen nur das Herz.' },
      { cond: 'flag:choice_kontor', text: 'Das Kontor wird aus dem Herzen Lampen machen, Geld und Waffen. Vardenfall wird leuchten. Ich frage mich, womit wir bezahlen.' },
      { cond: 'flag:choice_rooted', text: 'Die Verwurzelten sagen, das Herz schläft jetzt ruhig. Der Wald wächst schneller als die Felder. Wir werden lernen müssen, mit ihm zu leben.' },
      { cond: 'flag:choice_self', text: 'Und das Herz? Es schlägt in dir, sagt Isra. Ich weiß nicht, ob ich dir danken oder dich aus dem Dorf werfen soll.' },
    ],
  }),
  N('vogt_epi3', 'Haldenbruck bleibt. Das tut es immer. Sprich mit Isra. Sie hat etwas auf dem Herzen, das sie seit Wochen mit sich herumträgt.', [end()]),

  // ============================ YSOLDE (Orden) ============================
  N('ysolde_root', 'Die Flamme sieht dich, {name}.', [
    { text: 'Was will der Orden?', cond: '!flag:heard_order', next: 'ys_intro' },
    { text: 'Ich habe den Herzsplitter.', cond: 'item:herzsplitter & quest:mq_2=decide & touch<60', tag: 'Entscheidung', next: 'ys_splitter' },
    { text: 'Gibt es Arbeit für mich?', cond: 'flag:heard_order & !quest:o_fires:any & touch<60', next: 'ys_fires' },
    { text: 'Die Feuer brennen.', cond: 'quest:o_fires=return', next: 'ys_fires_done' },
    { text: 'Aldric Vey hat den Einsturz befohlen. Hier ist der Beweis.', cond: 'quest:s_ledger=decide', tag: 'Entscheidung', next: 'ys_ledger' },
    { text: 'Linas Katze ist aus Glas.', cond: 'quest:s_cat=choose', next: 'ys_cat' },
    { text: 'Zeig mir die Ordenskammer.', cond: 'touch<60', effects: ['shop:order'], next: null },
    end('Leb wohl.'),
  ], {
    variants: [
      { cond: 'touch>=60', text: 'Bleib, wo du bist. Ich sehe das Licht in deinen Adern. Sprich schnell – und dann geh.' },
      { cond: '!flag:heard_order', text: 'Du. Der Überlebende. Setz dich nicht, wir haben keine Zeit für Höflichkeiten.' },
    ],
  }),
  N('ys_intro', 'Vor vierzig Jahren brannte das Licht diese Region fast leer. Der Orden hat damals Feuer gegen Feuer gesetzt. Es hat funktioniert. Es hat auch … Opfer gefordert. Nun ist das Licht zurück. Wir wollen das Herz versiegeln – in Stein und Flamme – bevor es noch mehr Seelen frisst.', [
    { text: 'Opfer?', next: 'ys_victims' },
    { text: 'Ich werde darüber nachdenken.', next: null },
  ], { effects: ['flag:heard_order', 'codex:faction_order', 'codex:person_ysolde'] }),
  N('ys_victims', 'Berührte. Menschen, deren Adern leuchten. Wir haben sie … gereinigt. Es war notwendig. Glaub nicht, ich schliefe gut deswegen.', [
    { text: 'Ihr habt Menschen verbrannt.', effects: ['rep:order-2'], next: 'ys_victims2' },
    { text: 'Manchmal gibt es keine gute Wahl.', effects: ['rep:order+3'], next: null },
  ]),
  N('ys_victims2', 'Wir haben Dörfer gerettet. Frag die Leute in Haldenbruck, ob sie lieber eine Kutte oder ein Glaswesen an ihrer Tür sehen.', [end()]),
  N('ys_splitter', 'Er pulsiert. Wie ein Herz. Gib ihn mir, {name}. Unter der Kapelle liegt ein Ofen, heißer als jedes Nulllicht. Dort endet er – und mit ihm diese Welle.', [
    { text: 'Nimm ihn. Versiegle das Herz.', tag: 'Entscheidung', effects: ['item:-herzsplitter:1', 'flag:choice_order', 'flag:splitter_decided', 'flag:mine_open', 'item:+order_writ:1', 'rep:order+25', 'rep:kontor-10', 'rep:rooted-15', 'touch:-10', 'quest:choice:mq_2:Dem Orden übergeben – das Herz soll versiegelt werden', 'quest:start:mq_3'], next: 'ys_splitter_done' },
    { text: 'Noch nicht.', next: null },
  ]),
  N('ys_splitter_done', 'Die Flamme dankt dir. Nimm diesen Brief – Emrik am Grubentor wird dir öffnen. Und {name} … wenn deine Adern zu leuchten beginnen, komm zu mir. Bevor es zu spät ist.', [end()]),
  N('ys_fires', 'Drei alte Feuerschalen säumen die Wege – am Nordweg, am Ostweg, am Fluss. Entzünde sie. Licht gegen Licht. Die Kreaturen meiden unser Feuer.', [{ text: 'Ich kümmere mich darum.', effects: ['quest:start:o_fires'], next: null }]),
  N('ys_fires_done', 'Ich sehe den Rauch vom Kapellendach. Gut. Die Flamme vergisst nicht, wer sie genährt hat.', [end()], { effects: ['flag:fires_done'] }),
  N('ys_ledger', 'Zeig her. … Bei der Flamme. Die Handschrift ist seine. Vierzig Jahre haben wir Berührte verbrannt für ein Feuer, das er gelegt hat.', [
    { text: 'Stell ihn vor Gericht.', tag: 'Entscheidung', effects: ['flag:ledger_decided', 'flag:ledger_order', 'rep:order+15', 'rep:kontor-30', 'quest:choice:s_ledger:Den Beweis dem Orden gegeben – Aldric wird angeklagt', 'achieve:truth'], next: 'ys_ledger2' },
    { text: 'Ich will erst mit ihm selbst reden.', next: null },
  ]),
  N('ys_ledger2', 'Das werde ich. Und ich werde lernen müssen, womit ich meine eigenen Sünden bezahle.', [end()]),
  N('ys_cat', 'Eine Glaskatze. Ein Kind wird damit spielen, bis es selbst leuchtet. Bring sie mir. Ich mache es schnell und schmerzlos.', [
    { text: 'Gut. Nimm sie.', tag: 'Entscheidung', effects: ['flag:cat_decided', 'flag:cat_order', 'rep:order+8', 'rep:rooted-5', 'quest:choice:s_cat:Glimmer dem Orden übergeben'], next: 'ys_cat2' },
    { text: 'Niemals.', next: null },
  ]),
  N('ys_cat2', 'Du hast ein Kind heute vor etwas bewahrt, das es noch nicht versteht. Es wird dich hassen. Das ist der Preis.', [end()]),

  // ============================ ALDRIC (Kontor) ============================
  N('aldric_root', 'Ah, {name}. Zeit ist Geld. Deine und meine.', [
    { text: 'Was will das Kontor?', cond: '!flag:heard_kontor', next: 'al_intro' },
    { text: 'Ich habe den Herzsplitter.', cond: 'item:herzsplitter & quest:mq_2=decide & !flag:ledger_order', tag: 'Entscheidung', next: 'al_splitter' },
    { text: 'Brauchst du Hilfe?', cond: 'flag:heard_kontor & !quest:k_probes:any & !flag:ledger_order', next: 'al_probes' },
    { text: 'Hier sind die Messdaten.', cond: 'quest:k_probes=return', next: 'al_probes_done' },
    { text: 'Ich habe dein Buch gelesen.', cond: 'quest:s_ledger=decide & !flag:ledger_order', next: 'al_ledger' },
    { text: 'Was hast du zu verkaufen?', cond: '!flag:ledger_order', effects: ['shop:kontor'], next: null },
    end('Leb wohl.'),
  ], {
    variants: [
      { cond: 'flag:ledger_order', text: 'Du hast mich verraten. Die Präzeptorin hat mir einen Brief geschickt. Ich reise ab, bevor ihre Kutten kommen. Sag, was du willst, und dann geh.' },
      { cond: 'flag:ledger_blackmail', text: 'Mein liebster Geschäftspartner. Solange du schweigst, bin ich dein bester Freund.' },
      { cond: '!flag:heard_kontor', text: 'Der Überlebende! Setz dich, setz dich. Wein? Nein? Recht so, der hier ist schlecht. Also, geschäftlich.' },
    ],
  }),
  N('al_intro', 'Das Nulllicht ist die größte Energiequelle, die dieses Land je gesehen hat. Vardenfall könnte damit Lampen betreiben, Schmieden, Pumpen. Kein Holz mehr, keine Kohle. Der Orden will es verbrennen, die Baumkuschler wollen es anbeten. Ich will es nutzen. Das ist alles.', [
    { text: 'Und die Menschen, die es verändert?', next: 'al_people' },
    { text: 'Klingt vernünftig.', effects: ['rep:kontor+3'], next: null },
  ], { effects: ['flag:heard_kontor', 'codex:faction_kontor', 'codex:person_aldric'] }),
  N('al_people', 'Menschen sterben auch in Kohlegruben, mein Freund. Der Fortschritt hatte schon immer Opfer. Der Unterschied ist: Ich zähle sie. Der Orden zählt nur Seelen.', [end()]),
  N('al_splitter', 'Oh. Oh, sieh dir das an. Weißt du, was das wert ist? Nicht in Gold – in Jahren. Gib ihn mir, und das Kontor öffnet die Grube, bezahlt jede Familie in Haldenbruck und lässt dich an allem teilhaben, was daraus entsteht.', [
    { text: 'Einverstanden. Nimm ihn.', tag: 'Entscheidung', effects: ['item:-herzsplitter:1', 'flag:choice_kontor', 'flag:splitter_decided', 'flag:mine_open', 'item:+mine_key:1', 'gold:+200', 'rep:kontor+25', 'rep:order-15', 'rep:rooted-10', 'quest:choice:mq_2:Dem Kontor verkauft – das Herz soll genutzt werden', 'quest:start:mq_3'], next: 'al_splitter_done' },
    { text: 'Nicht für Gold.', next: null },
  ]),
  N('al_splitter_done', 'Kluge Wahl. Der Schlüssel zum Grubentor. Emrik weiß Bescheid. Ach – und falls du da unten etwas über den alten Einsturz findest … bring es zuerst zu mir. Nur zu mir.', [end()]),
  N('al_probes', 'Meine Leute haben drei Messsonden in der Glasnarbe zurückgelassen, als die Glasläufer kamen. Lies sie aus. Ohne Daten kein Geschäft, ohne Geschäft kein Dorf.', [{ text: 'Abgemacht.', effects: ['quest:start:k_probes'], next: null }]),
  N('al_probes_done', 'Hervorragend! Siehst du die Kurve? Die Welle steigt nicht gleichmäßig, sie pulsiert – etwa sechzig Schläge in der Minute. Wie ein … nun ja. Hier, dein Anteil.', [end()], { effects: ['flag:probes_done'] }),
  N('al_ledger', 'Ah. Das Buch. Vor vierzig Jahren stritten drei Kontore um die Grube. Ich habe den Stollen sprengen lassen, um die anderen aufzuhalten. Ich wusste nicht, was darunter lag. Niemand wusste es.', [
    { text: 'Zahl mir mein Schweigen.', tag: 'Entscheidung', effects: ['flag:ledger_decided', 'flag:ledger_blackmail', 'gold:+300', 'rep:kontor+5', 'quest:choice:s_ledger:Aldric erpresst – Schweigen für 300 Gold'], next: 'al_ledger_pay' },
    { text: 'Du wirst dich stellen. [Stärke 10 oder Intellekt 10]', cond: 'attr:str>=10 | attr:int>=10', tag: 'Probe', effects: ['flag:ledger_decided', 'flag:ledger_confess', 'rep:kontor-10', 'rep:order+10', 'quest:choice:s_ledger:Aldric zum Geständnis gezwungen', 'achieve:truth'], next: 'al_ledger_confess' },
    { text: 'Ich überlege es mir.', next: null },
  ], { effects: ['codex:event_collapse_truth'] }),
  N('al_ledger_pay', 'Dreihundert. Und du vergisst, dass du lesen kannst. Wir verstehen uns.', [end()]),
  N('al_ledger_confess', 'Du … hast recht. Vierzig Jahre lang habe ich alles gezählt. Nur mich selbst nicht. Ich werde zu Ysolde gehen. Morgen. Vielleicht übermorgen.', [end()]),

  // ============================ MAREN (Verwurzelte) ============================
  N('maren_root', 'Die Wurzeln haben dich angekündigt.', [
    { text: 'Wer seid ihr?', cond: '!flag:heard_rooted', next: 'ma_intro' },
    { text: 'Ich habe den Herzsplitter.', cond: 'item:herzsplitter & quest:mq_2=decide', tag: 'Entscheidung', next: 'ma_splitter' },
    { text: 'Kann ich helfen?', cond: 'flag:heard_rooted & !quest:r_seed:any', next: 'ma_seed' },
    { text: 'Der Samen ist gepflanzt.', cond: 'quest:r_seed=return', next: 'ma_seed_done' },
    { text: 'Das Kontorbuch beweist Aldrics Schuld.', cond: 'quest:s_ledger=decide', tag: 'Entscheidung', next: 'ma_ledger' },
    { text: 'Linas Katze ist aus Glas.', cond: 'quest:s_cat=choose', next: 'ma_cat' },
    { text: 'Zeig mir deine Gaben.', effects: ['shop:maren'], next: null },
    end('Leb wohl.'),
  ], {
    variants: [
      { cond: '!flag:heard_rooted', text: 'Du bist es. Das Herz hat deinen Namen geflüstert, bevor du ihn selbst wusstest. Setz dich zu mir.' },
      { cond: 'touch>=30', text: 'Du leuchtest, Schwester des Lichts. Hab keine Angst davor.' },
    ],
  }),
  N('ma_intro', 'Wir sind die, die geblieben sind, als der Orden brannte und das Kontor floh. Wir haben gelernt, dass das Licht lebt. Es hat Hunger, es hat Angst, es träumt. Wenn man es nährt, wird es ruhig. Wenn man es angreift, schlägt es zurück.', [
    { text: 'Nährt? Womit?', next: 'ma_feed' },
    { text: 'Das klingt friedlich.', effects: ['rep:rooted+3'], next: null },
  ], { effects: ['flag:heard_rooted', 'codex:faction_rooted', 'codex:person_maren'] }),
  N('ma_feed', 'Mit Leben. Ein wenig Blut. Ein Tier, dann und wann. Und manchmal jemand, der sich verirrt hat und nicht mehr gefunden werden will.', [
    { text: 'Ihr opfert Menschen?', effects: ['rep:rooted-2'], next: 'ma_feed2' },
    { text: 'Ich verstehe.', next: null },
  ]),
  N('ma_feed2', 'Wir geben zurück, was das Land uns gibt. Du hältst mich für ein Ungeheuer. Frag dich, wie viele der Orden verbrannt hat und wie viele wir gegeben haben. Dann entscheide.', [end()]),
  N('ma_splitter', 'Da ist es. Ein Stück seines Herzens. Es ruft nach Hause. Gib es mir, und ich trage es zurück zu den Wurzeln – die Welle wird sich legen, das Land wird heilen. Auf seine Weise.', [
    { text: 'Bring es heim.', tag: 'Entscheidung', effects: ['item:-herzsplitter:1', 'flag:choice_rooted', 'flag:splitter_decided', 'flag:mine_open', 'item:+mine_key:1', 'rep:rooted+25', 'rep:order-15', 'rep:kontor-10', 'touch:+5', 'quest:choice:mq_2:Den Verwurzelten gegeben – das Herz soll ruhen', 'quest:start:mq_3'], next: 'ma_splitter_done' },
    { text: 'Noch nicht.', next: null },
  ]),
  N('ma_splitter_done', 'Die Wurzeln danken dir. Unter der Grube schläft etwas, das nicht schlafen will – ein Mann, der das Herz festhält. Emrik hatte einen Schlüssel, den ich ihm … abgenommen habe. Er gehört jetzt dir.', [end()]),
  N('ma_seed', 'Ein Samen des Herzbaums will gepflanzt werden, am Schrein hinter mir. Aber er braucht Borke, die das Licht getrunken hat. Die Wurzelkolosse an den Nordhängen tragen sie.', [{ text: 'Ich hole sie.', effects: ['quest:start:r_seed'], next: null }]),
  N('ma_seed_done', 'Er keimt. Hörst du? Er singt. Nimm dies – einen Samen, den du bei dir tragen kannst.', [end()], { effects: ['flag:seed_done', 'item:+relic_seed:1'] }),
  N('ma_ledger', 'Aldric. Natürlich. Die Wurzeln haben ihn nie gemocht. Gib mir das Buch, und jede Familie in Vardenfall erfährt, wem sie ihre leuchtenden Kinder verdankt.', [
    { text: 'Nimm es. Die Wahrheit gehört allen.', tag: 'Entscheidung', effects: ['flag:ledger_decided', 'flag:ledger_rooted', 'rep:rooted+15', 'rep:kontor-25', 'quest:choice:s_ledger:Den Verwurzelten gegeben – die Wahrheit wird verbreitet', 'achieve:truth'], next: 'ma_ledger2' },
    { text: 'Noch nicht.', next: null },
  ]),
  N('ma_ledger2', 'Wahrheit ist wie Wasser. Sie findet ihren Weg.', [end()]),
  N('ma_cat', 'Ein Kind des Lichts. Es gehört zu uns. Lass sie bei mir, und sie wird wachsen, ohne jemandem zu schaden.', [
    { text: 'Nimm Glimmer auf.', tag: 'Entscheidung', effects: ['flag:cat_decided', 'flag:cat_rooted', 'rep:rooted+8', 'quest:choice:s_cat:Glimmer den Verwurzelten anvertraut'], next: 'ma_cat2' },
    { text: 'Nein.', next: null },
  ]),
  N('ma_cat2', 'Lina darf sie besuchen. Wenn sie mutig genug ist, in den Wald zu kommen.', [end()]),

  // ============================ OSWIN ============================
  N('oswin_root', 'Na? Brauchst du Stahl oder Rat? Stahl ist billiger.', [
    { text: 'Warum ist die Esse kalt?', cond: '!quest:s_smith:any', next: 'os_quest' },
    { text: 'Hier sind Erz und Holz.', cond: 'quest:s_smith=return & item:iron_ore>=6 & item:wood>=4', effects: ['item:-iron_ore:6', 'item:-wood:4', 'flag:smith_done'], next: 'os_done' },
    { text: 'Zeig mir deine Waren.', effects: ['shop:oswin'], next: null },
    { text: 'Ich will etwas herstellen oder verbessern.', effects: ['craft'], next: null },
    { text: 'Erzähl mir von Haldenbruck.', next: 'os_lore' },
    end('Bis dann.'),
  ]),
  N('os_quest', 'Kein Erz mehr! Die Nordhänge sind voller Glasviecher, und keiner traut sich hin. Bring mir sechs Brocken Eisenerz und vier Scheite Hartholz – dann schmiede ich dir, was du willst.', [{ text: 'Mache ich.', effects: ['quest:start:s_smith'], next: null }]),
  N('os_done', 'Ha! Gutes Erz, rot wie ein Sonnenuntergang. Hier, drei Barren für dich – und ab jetzt verbessere ich deine Waffen an der Werkbank, wenn du Material bringst.', [end()]),
  N('os_lore', 'Haldenbruck heißt so, weil hier die Halden der alten Grube lagen. Erz, Schlacke, Staub. Dann kam der Einsturz, und aus den Halden wuchs Glas. Mein Vater hat daraus Messer gemacht. Sie haben geleuchtet, bis er starb.', [back('oswin_root')]),

  // ============================ PELL ============================
  N('pell_root', 'Pell, Krämer, Händler, Retter in der Not! Was darf’s sein?', [
    { text: 'Zeig mir deine Waren.', effects: ['shop:pell'], next: null },
    { text: 'Was gibt’s Neues?', next: 'pell_news' },
    end('Nichts.'),
  ]),
  N('pell_news', 'Neues? Die Preise steigen, der Mut sinkt. Und angeblich leuchten die Rüben vom alten Tam.', [back('pell_root')], {
    variants: [
      { cond: 'flag:choice_kontor', text: 'Das Kontor liefert jetzt Kristalltrunk und Feuertöpfe! Gefährlich? Ach was, nur wenn man sie benutzt.' },
      { cond: 'flag:choice_order', text: 'Seit der Orden am Tor steht, kaufen die Leute vor allem Läuterungstonikum. Gut fürs Geschäft, schlecht für die Stimmung.' },
      { cond: 'flag:choice_rooted', text: 'Die Verwurzelten tauschen jetzt Kräuter gegen Salz. Ich habe noch nie so viel Silberwurz gesehen.' },
    ],
  }),

  // ============================ HEDDA ============================
  N('hedda_root', 'Willkommen in der Letzten Laterne. Die Suppe ist warm, die Betten sind kalt.', [
    { text: 'Du wirkst besorgt.', cond: '!quest:s_hedda:any & quest:mq_1:done', next: 'he_quest' },
    { text: 'Die Stimme ist verstummt.', cond: 'quest:s_hedda=return', next: 'he_done' },
    { text: 'Erzähl mir Gerüchte.', next: 'he_rumor' },
    { text: 'Eine Schüssel Suppe, bitte. (4 Gold)', cond: 'gold>=4', effects: ['gold:-4', 'need:food:70'], next: 'he_soup' },
    { text: 'Ein Bett für die Nacht. (10 Gold)', cond: 'gold>=10', effects: ['gold:-10', 'sleep'], next: 'he_rest' },
    { text: 'Ein heißes Bad. (3 Gold)', cond: 'gold>=3', effects: ['gold:-3', 'wash:bath'], next: 'he_bath' },
    end('Tschüss.'),
  ]),
  N('he_quest', 'Jede Nacht, wenn es still wird, flüstert jemand meinen Namen. Es klingt wie Bertram, mein Mann. Er ist vor zwei Wintern im Wald geblieben. Ich weiß, dass er tot ist. Aber … könntest du nachsehen? Nachts, im Flüsterforst, bei den alten Eichen östlich von Marens Schrein.', [{ text: 'Ich sehe nach.', effects: ['quest:start:s_hedda'], next: null }]),
  N('he_done', 'Es war … nur ein Nachhall? Ein Schatten, der seine Stimme trug. Danke. Ich glaube, heute Nacht werde ich schlafen.', [end()], { effects: ['flag:hedda_done'] }),
  N('he_rumor', 'Man sagt, auf der Felsnadel draußen im Meer steht eine Kapelle. Die alte Oda soll dort gebetet haben, bis die Flut kam. Keiner weiß, wie man hinkommt – Jorun an der Küste murmelt was von leuchtenden Zeichen.', [back('hedda_root')], {
    variants: [
      { cond: 'flag:tidepath_open', text: 'Du warst draußen auf der Felsnadel? Dann bist du entweder ein Heiliger oder ein Narr. Trink was, geht aufs Haus.' },
      { cond: 'quest:mq_3:any', text: 'Die Leute sagen, in Tiefenrast singt nachts jemand ein Kinderlied. Ich glaube, ich will nicht wissen, wer.' },
    ],
  }),
  N('he_rest', 'Die Kammer oben links. Das Bett ist hart, aber trocken. Schlaf gut – und wenn du nachts etwas kratzen hörst … schlaf trotzdem.', [end()]),
  N('he_bath', 'Der Zuber steht hinten, das Wasser ist heiß. Seife liegt daneben – nimm sie auch.', [back('hedda_root', 'Danke.'), end()]),
  N('he_soup', 'Rübensuppe mit Speck. Die Rüben leuchten nicht, versprochen. Iss, solange sie warm ist.', [back('hedda_root', 'Danke.'), end()]),

  // ============================ BRANN ============================
  N('brann_root', 'Westtor. Augen offen.', [
    { text: 'Brauchst du Hilfe?', cond: '!quest:s_ledger:any & quest:mq_1:done', next: 'br_quest' },
    { text: 'Rotbart ist erledigt. Er trug einen Schlüssel.', cond: 'quest:s_ledger=ledger', next: 'br_chief' },
    { text: 'Wie ist die Lage?', next: 'br_status' },
    end('Bis dann.'),
  ]),
  N('br_quest', 'Rotbart und seine Plünderer. Sie überfallen Wagen im Westwald – aber nur die vom Orden und von freien Händlern. Kontorwagen lassen sie fahren. Seltsam, oder? Ihr Lager liegt westlich im Forst. Wenn du Rotbart erledigst, schau nach, was er bei sich trägt.', [{ text: 'Ich kümmere mich um Rotbart.', effects: ['quest:start:s_ledger'], next: null }]),
  N('br_chief', 'Ein Kontorschlüssel? Bei Rotbart? … Das Kontorbuch steht in Aldrics Schreibstube, gleich neben der Tür. Ich habe nichts gesagt.', [end()], { effects: ['flag:ledger_key'] }),
  N('br_status', 'Tagsüber ruhig. Nachts kommen die Nachhalle bis an die Palisade. Sieh ihnen in die Augen, dann bleiben sie stehen. Dreh dich nie um.', [back('brann_root')], {
    variants: [{ cond: 'flag:raid_defended', text: 'Seit wir den Überfall zurückgeschlagen haben, grüßen mich die Leute wieder. Das hast du gut gemacht.' }],
  }),

  // ============================ LINA / UTE / TAM ============================
  N('lina_root', 'Hallo! Bist du ein Ritter?', [
    { text: 'Was ist los, Kleine?', cond: '!quest:s_cat:any', next: 'li_quest' },
    { text: 'Ich habe Glimmer gefunden.', cond: 'quest:s_cat=choose', next: 'li_cat' },
    end('Kein Ritter. Tut mir leid.'),
  ], { variants: [{ cond: 'flag:cat_lina', text: 'Glimmer schläft auf meinem Kopfkissen und summt! Mama schimpft, aber nur ein bisschen.' }] }),
  N('li_quest', 'Glimmer ist weg! Meine Katze! Sie ist in den Wald gelaufen, dorthin, wo ich nicht hindarf. Sie ist grau und … ein bisschen durchsichtig geworden. Und sie summt. Bitte!', [{ text: 'Ich suche sie.', effects: ['quest:start:s_cat'], next: null }]),
  N('li_cat', 'GLIMMER! Oh … sie leuchtet. Mama sagt, leuchtende Sachen muss man zum Orden bringen. Aber sie ist doch meine Katze.', [
    { text: 'Behalte sie. Pass gut auf sie auf.', tag: 'Entscheidung', effects: ['flag:cat_decided', 'flag:cat_lina', 'rep:order-3', 'quest:choice:s_cat:Glimmer bei Lina gelassen'], next: 'li_keep' },
    { text: 'Ich frage jemanden, der sich auskennt.', next: null },
  ]),
  N('li_keep', 'Danke! Danke! Du bist doch ein Ritter!', [end()]),
  N('ute_root', 'Hast du Lina gesehen? Das Kind treibt mich in den Wahnsinn.', [end()], { variants: [{ cond: 'quest:s_cat:done', text: 'Lina redet nur noch von dir und dieser Katze. Danke. Glaube ich.' }] }),
  N('tam_root', 'Tam. Bauer. Leuchtende Rüben. Frag nicht.', [
    { text: 'Leuchtende Rüben?', next: 'tam2' },
    end('Bis dann.'),
  ]),
  N('tam2', 'Sie schmecken nach Kupfer und machen komische Träume. Meine Frau isst sie trotzdem. Sagt, sie träumt vom Meer.', [end()]),

  // ============================ DORFBEWOHNER ============================
  N('folk_a', 'Hm? Ich hab zu tun. Aber sag schon.', [
    { text: 'Was gibt es Neues im Dorf?', next: 'folk_a_news' },
    { text: 'Lust auf eine Runde Würfel? (10 Gold Einsatz)', cond: 'gold>=10', effects: ['dice:10'], next: null },
    { text: 'Würfeln um 30 Gold?', cond: 'gold>=30', effects: ['dice:30'], next: null },
    { text: 'Wo finde ich hier was?', next: 'folk_where' },
    end('Nichts. Mach weiter.'),
  ]),
  N('folk_a_news', 'Seit die Expedition kam, schläft keiner mehr richtig. Nachts leuchtet es über dem Nordwald, und der Vogt tut, als wäre nichts. Frag ihn mal, ob er selbst noch schläft.', [back('folk_a', 'Und sonst?'), end()]),
  N('folk_b', 'Na, Fremder. Suchst du Arbeit oder Ärger?', [
    { text: 'Gerüchte?', next: 'folk_b_news' },
    { text: 'Lust auf eine Runde Würfel? (10 Gold Einsatz)', cond: 'gold>=10', effects: ['dice:10'], next: null },
    { text: 'Würfeln um 30 Gold?', cond: 'gold>=30', effects: ['dice:30'], next: null },
    { text: 'Wo finde ich hier was?', next: 'folk_where' },
    end('Weder noch.'),
  ]),
  N('folk_b_news', 'Rotbarts Leute sind am Fluss gesehen worden. Und der Kontor kauft jedes Stück Nullglas, das man ihm bringt – zu Preisen, die zu gut sind, um ehrlich zu sein.', [back('folk_b', 'Noch was?'), end()]),
  N('folk_c', 'Oh – hallo. Brauchst du was?', [
    { text: 'Was erzählt man sich?', next: 'folk_c_news' },
    { text: 'Lust auf eine Runde Würfel? (10 Gold Einsatz)', cond: 'gold>=10', effects: ['dice:10'], next: null },
    { text: 'Würfeln um 30 Gold?', cond: 'gold>=30', effects: ['dice:30'], next: null },
    { text: 'Wo finde ich hier was?', next: 'folk_where' },
    end('Nein, danke.'),
  ]),
  N('folk_c_news', 'Hedda sagt, im Keller der Laterne kratzt es nachts. Die Wachen gehen jetzt mit Fackeln Streife, jede Nacht zwei Runden ums Dorf. Hilft es? Wer weiß.', [back('folk_c', 'Noch etwas?'), end()]),
  N('folk_where', 'Oswin schmiedet an der Esse bis zum Abend, mittags isst er in der Laterne. Pell steht tagsüber am Markt, nachts ist sein Laden zu. Den Vogt findest du am Vogthaus im Norden – abends sitzt er meist im Gasthaus. Und nachts schlafen anständige Leute.', [end('Danke.')]),
  // ============================ BURG HALDENSTEIN ============================
  N('captain_root', 'Hauptmann Gerold, Grenzwacht. Wenn du keine Botschaft hast, halt die Leute nicht vom Üben ab.', [
    { text: 'Was ist das für eine Burg?', next: 'cap_castle' },
    { text: 'Was macht die Grenzwacht gegen das Nulllicht?', next: 'cap_null' },
    end('Ich gehe schon.'),
  ]),
  N('cap_castle', 'Haldenstein. Früher saß hier der Vogt, bevor er ins Dorf zog, wo es wärmer ist. Jetzt ist es Kaserne, Pferdestall und Wachturm in einem. Von den Türmen sieht man bis zur Glasnarbe.', [back('captain_root', 'Und sonst?'), end()]),
  N('cap_null', 'Wir halten die Straßen offen und zählen die Nächte. Tagsüber üben die Männer, nachts gehen zwei Mann mit Fackeln um die Mauern. Mehr kann Stahl gegen Licht nicht tun.', [back('captain_root', 'Verstehe.'), end()]),

  // ============================ DORFWACHE ============================
  N('watch_root', 'Halt. Was willst du?', [
    { text: 'Nur vorbei.', next: null },
    { text: 'Ist es sicher im Dorf?', next: 'watch_safe' },
    end('Nichts.'),
  ]),
  // Ertappt (Wache stellt den Spieler; Strafe in flag:fine, Probe-Ergebnis in flag:fine_ok)
  N('caught_root', 'Stehen bleiben! Ich hab genau gesehen, was du da getrieben hast. Das macht {fine} Gold – oder du kommst mit ins Loch.', [
    { text: 'Schon gut, ich zahle. ({fine} Gold)', cond: 'canpay', effects: ['fine:pay'], next: 'caught_paid' },
    { text: '[Überreden] Das ist ein Missverständnis. Ich wollte nur nach dem Rechten sehen …', cond: '!flag:fine_try', effects: ['fine:talk'], next: 'caught_talk' },
    { text: '[Einschüchtern] Überleg dir gut, mit wem du dich anlegst.', cond: '!flag:fine_try & attr:str>=6', effects: ['fine:scare'], next: 'caught_scare' },
    { text: 'So viel hab ich nicht. Dann steck mich eben ein.', effects: ['fine:jail'], next: 'caught_jail' },
    end('[Davonlaufen]'),
  ]),
  N('caught_paid', 'Na also. Und jetzt Finger weg von fremdem Eigentum, sonst wird’s teurer.', [end('Verstanden.')]),
  N('caught_talk', 'Die Wache mustert dich lange.', [
    { text: '[Weiter]', cond: 'flag:fine_ok', next: 'caught_talk_ok' },
    { text: '[Weiter]', cond: '!flag:fine_ok', next: 'caught_talk_fail' },
  ]),
  N('caught_talk_ok', 'Hm. Na gut. Diesmal glaub ich dir. Aber ich hab dein Gesicht gesehen.', [end('Danke.')]),
  N('caught_talk_fail', 'Nach dem Rechten sehen, ja? Netter Versuch. {fine} Gold. Jetzt.', [
    { text: 'Schon gut, ich zahle. ({fine} Gold)', cond: 'canpay', effects: ['fine:pay'], next: 'caught_paid' },
    { text: 'So viel hab ich nicht. Dann steck mich eben ein.', effects: ['fine:jail'], next: 'caught_jail' },
    end('[Davonlaufen]'),
  ]),
  N('caught_scare', 'Die Wache greift zum Schwert – und zögert.', [
    { text: '[Weiter]', cond: 'flag:fine_ok', next: 'caught_scare_ok' },
    { text: '[Weiter]', cond: '!flag:fine_ok', next: 'caught_scare_fail' },
  ]),
  N('caught_scare_ok', 'Schon gut, schon gut … Verschwinde einfach. Und lass dich hier nicht so schnell wieder blicken.', [end('Klug von dir.')]),
  N('caught_scare_fail', 'Du drohst mir? Einer Wache? Das kostet jetzt {fine} Gold, und zwar sofort.', [
    { text: 'Schon gut, ich zahle. ({fine} Gold)', cond: 'canpay', effects: ['fine:pay'], next: 'caught_paid' },
    { text: 'So viel hab ich nicht. Dann steck mich eben ein.', effects: ['fine:jail'], next: 'caught_jail' },
    end('[Davonlaufen]'),
  ]),
  N('caught_jail', 'Dann komm. Eine Nacht bei Wasser und Brot hat noch keinem geschadet.', [end('[Mitgehen]')]),
  N('watch_safe', 'Sicher? Tagsüber ja. Nachts gehen wir Streife, zwei Runden, Fackeln an. Wer nachts in fremde Häuser steigt, zahlt – oder sitzt. Merk dir das.', [end('Verstanden.')]),

  // ============================ JORUN ============================
  N('jorun_root', 'Salz in den Taschen? Gut. Dann kannst du bleiben.', [
    { text: 'Kann ich helfen?', cond: '!quest:s_nets:any', next: 'jo_quest' },
    { text: 'Deine Netze sind frei.', cond: 'quest:s_nets=return', next: 'jo_done' },
    { text: 'Erzähl mir von der Felsnadel.', next: 'jo_needle' },
    { text: 'Was verkaufst du?', effects: ['shop:jorun'], next: null },
    end('Mach’s gut.'),
  ]),
  N('jo_quest', 'Meine Netze hängen am Strand fest, eins im Westen, eins im Osten. Und am Wrack hausen Plünderer, die mir die Fische klauen. Mach das eine und das andere, und du kriegst was Gutes.', [{ text: 'Abgemacht.', effects: ['quest:start:s_nets'], next: null }]),
  N('jo_done', 'Die Netze! Und die Plünderer hab ich rennen sehen. Nimm das, hält dich auf den Beinen.', [end()], { effects: ['flag:nets_done'] }),
  N('jo_needle', 'Die Kapelle da draußen? Als ich jung war, sah ich nachts Lichter über dem Wasser. Ein Pfad, sagte mein Vater, der nur erscheint, wenn man die Zeichen in der richtigen Reihenfolge an die Stele legt. Wald, Ruine, Wrack. Die kleinste Zahl zuerst. Und nur, wenn der Mond sinkt.', [back('jorun_root')], { effects: ['codex:lore_tidepath_hint'] }),

  // ============================ EMRIK ============================
  N('emrik_root', 'Grubenwart Emrik. Vierzig Jahre Wache vor einem Loch.', [
    { text: 'Öffne das Tor.', cond: '!flag:mine_open & quest:mq_2:any', next: 'em_locked' },
    { text: 'Kann ich helfen?', cond: '!quest:s_emrik:any', next: 'em_quest' },
    { text: 'Hier sind Splitter und Staub.', cond: 'quest:s_emrik=return & item:glass_shard>=5 & item:moth_dust>=2', effects: ['item:-glass_shard:5', 'item:-moth_dust:2', 'flag:emrik_done'], next: 'em_done' },
    { text: 'Was ist damals passiert?', next: 'em_past' },
    { text: 'Ich möchte die Werkbank benutzen.', effects: ['craft'], next: null },
    end('Bis dann.'),
  ], { variants: [{ cond: 'flag:mine_open', text: 'Das Tor ist offen. Pass auf dich auf da unten. Und wenn du Rast siehst … sag ihm, Emrik hat nie aufgehört zu graben.' }] }),
  N('em_locked', 'Ohne Siegel, Schlüssel oder Befehl öffne ich nicht. Das Kontor zahlt mich, der Orden bedroht mich, und die Verwurzelten … die klauen mir die Schlüssel. Entscheide dich, wem du traust, dann reden wir.', [back('emrik_root')]),
  N('em_quest', 'Die Nachhalle da unten hassen Licht. Richtiges Licht. Bring mir fünf Glassplitter und zwei Prisen Irrlichtstaub, dann baue ich Lampen, die sie blenden.', [{ text: 'Ich besorge sie.', effects: ['quest:start:s_emrik'], next: null }]),
  N('em_done', 'Gut. Das reicht für ein Dutzend Lampen. Nimm die Tränke. Du wirst sie brauchen.', [end()]),
  N('em_past', 'Ich war siebzehn. Wir hörten die Sprengung, dann das Licht. Es fiel nach oben, wie Schnee, der zurück in den Himmel will. Rast hat drei Tage gegraben. Mit den Händen. Seine Tochter war da unten.', [back('emrik_root')], { effects: ['codex:event_collapse'] }),

  // ============================ ANSELM ============================
  N('anselm_root', 'Friede der Flamme mit dir. Du bist weit von der Straße entfernt.', [
    { text: 'Was tust du hier?', next: 'an_here' },
    { text: 'Wie löse ich das Glockenrätsel?', cond: '!flag:oda_bells_solved', next: 'an_bells' },
    end('Leb wohl.'),
  ]),
  N('an_here', 'Ich bete. Sankt Oda ist keine Heilige des Ordens, aber sie hat einst das Meer aufgehalten. Vielleicht hält sie auch das Licht auf. Bisher hat sie nicht geantwortet.', [back('anselm_root')], { effects: ['codex:person_anselm'] }),
  N('an_bells', 'Die Steintafel am Eingang. Lies sie. Oda hat in Rätseln gepredigt, weil sie glaubte, dass nur, wer sucht, auch findet. Ein falscher Ton weckt die Schatten – sei vorsichtig.', [back('anselm_root')]),
  N('anselm_mine', 'Du gehst hinunter? Dann nimm meinen Segen – auch wenn du ihn nicht willst.', [
    { text: 'Danke, Bruder.', effects: ['restore'], next: 'an_mine2' },
    end('Brauch ich nicht.'),
  ]),
  N('an_mine2', 'Die Flamme sei deine Laterne. Und wenn du dem Hauptmann begegnest … er war ein guter Mann. Einst.', [end()]),

  // ============================ Wachen nach Entscheidung ============================
  N('order_guard', 'Halt. Zeig deine Hände. … Gut, kein Leuchten. Weiter.', [end()], { variants: [{ cond: 'touch>=30', text: 'Deine Adern leuchten. Der Orden behält dich im Auge, Berührter. Geh weiter – langsam.' }] }),
  N('kontor_foreman', 'Schichtwechsel! Wenn du nicht arbeitest, steh nicht im Weg. Das Kontor hat die Grube übernommen – mit deiner Hilfe, wie ich höre.', [end()]),
  N('rooted_keeper', 'Die Wurzeln sind jetzt im Dorf. Keine Angst – sie beißen nur die, die Äxte tragen.', [end()]),
];

export const DIALOGUES: Record<string, DialogueNode> = Object.fromEntries(nodes.map((n) => [n.id, n]));
