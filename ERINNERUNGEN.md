# Erinnerungen

Zusammenfassung der bisherigen Claude-Sitzungen. Neueste Einträge oben.

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
