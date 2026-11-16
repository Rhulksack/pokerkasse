# Pokerkasse

Desktop-App (Windows) und iPhone-Web-App zur Verwaltung von Poker-Homegames – Cash-Game und Turnier. Cash-Game: Spieler, Buy-ins (bar / angeschrieben), Rake & Dealer-Tips, vorzeitige Cash-outs, Chip-Abgleich und Endabrechnung mit fairer 5-€-Rundung.

## Installation
- `Pokerkasse-Setup-1.5.0.exe`: normaler Installer (Startmenü, Desktop-Verknüpfung).
- `Pokerkasse-Portable-1.5.0.exe`: ohne Installation direkt startbar.

Da die App nicht signiert ist, zeigt Windows SmartScreen beim ersten Start evtl. „Der Computer wurde durch Windows geschützt“ → „Weitere Informationen“ → „Trotzdem ausführen“.

Daten liegen lokal unter `%APPDATA%\Pokerkasse\pokerkasse-daten.json` (plus `.bak`-Sicherung). In der Spielerliste gibt es einen Button „Datenordner öffnen“.

## Bedienung im Spiel
- Spieler anklicken → `1` / `2` / `3` bucht 25 / 30 / 50 €, oder eigenen Betrag eingeben + Enter.
- `B` = bar bezahlt (Standard), `A` = anschreiben. Nach jeder Buchung erscheint „Rückgängig“.
- Angeschriebenes im Spielerpanel als „Bezahlt“ verbuchen (Teilbeträge möglich) – zählt nicht als neuer Buy-in.
- Rake / Dealer-Tips: werden erst beim Spielende gezählt und im Abschluss-Bildschirm eingetragen. Sie zählen zum Chip-Abgleich und werden am Ende aus der Kasse entnommen.
- „Spieler auscashen“: Chipwert − angeschriebener Betrag = Barauszahlung (auf 5 € gerundet). Bei Minus bleibt eine Schuld.
- Protokoll: alle Ereignisse mit Uhrzeit, Fehlbuchungen stornierbar.

## Abrechnung
- Spielergebnis = Cash-out − insgesamt eingekauft.
- Abrechnung = Cash-out − noch offen − bereits früh ausgezahlt (positiv = bekommt, negativ = zahlt).
- Rundung auf 5 € nach dem Restgrößenverfahren: Summe bleibt korrekt, jede Person weicht minimal ab. Exakter Betrag wird immer mit angezeigt.
- Modus „Übersicht“: Schuldner zahlen in die Kasse, Gewinner bekommen aus der Kasse.
- Modus „Zahlungsvorschläge“: nur Schuldner (Angeschriebenes, mit Minus raus) bekommen einen Gewinner zugewiesen, Rest bar aus der Kasse.
- Export als PDF oder Text (Zwischenablage / .txt).

## Turnier
- Beim Anlegen „Turnier“ wählen: Buy-in (fest), optional Bounty (z. B. 20 € + 5 € = 25 € pro Einstieg, nur 20 € in den Preispool), Startchips, Chipwerte, Tische.
- Blindstruktur: jedes Level mit Small/Big Blind und Dauer, Pausen an beliebiger Stelle. Big-Blind-Ante (1 BB) ab einem frei wählbaren Level.
- Rebuy und Late Registration jeweils „bis Level X“, optional auch in der Pause danach; maximale Rebuys pro Spieler einstellbar.
- Auszahlung in Prozent (Standard 50 / 30 / 20), Preisgelder auf 5 € gerundet.
- Statt der Tischanzahl wird „Max. Spieler pro Tisch“ eingestellt; die App nimmt so wenige Tische wie nötig und verteilt gleichmäßig.
- Sitzplätze werden ausgelost, der Dealer-Button liegt zum Start an allen Tischen auf demselben ausgelosten Sitz. Späte Spieler kommen an den Tisch mit den wenigsten Spielern (bei vollen Tischen an einen neuen).
- Hinweise beim Host: Tische ausgleichen, Tisch auflösen (Spieler werden zufällig auf freie Plätze verteilt, der Rest bleibt sitzen) und Finaltisch, sobald alle an einen Tisch passen. Beim Finaltisch werden Plätze und Button neu gelost, am TV erscheint ein Pop-up mit der Sitzordnung (30 s oder bis zum Antippen).
- TV: Banner beim Ausscheiden (Platz, Rauswerfer bei Bounty, Preisgeld), Bubble-Anzeige, „Im Geld – um Platz X“ und Heads-up.
- Color-up: Hinweis in der Pause, wenn kleine Chips ab dem nächsten Level nicht mehr gebraucht werden.
- TV-Ansicht: großer Level-Timer, Blinds, nächstes Level, nächste Pause, Preispool, Spieler, Ø Stack, Auszahlung. Die letzten 10 Sekunden blinkt sie rot. Hoch- und Querformat werden automatisch erkannt.
- Windows: Ist ein zweiter Bildschirm angeschlossen, öffnet die TV-Ansicht dort automatisch im Vollbild; das Hauptfenster bleibt die Host-Ansicht. Tastatur in der TV-Ansicht: Leertaste = Pause/Weiter, ←/→ = Level zurück/vor, H = Host.
- iPhone/iPad: TV-Ansicht per AirPlay-Bildschirmsynchronisierung auf den Fernseher spiegeln, über „Host“ in die Verwaltung wechseln.

## Entwicklung
```
npm install
npm run dev        # UI im Browser (Daten in localStorage)
npm start          # als Electron-App starten
npm test           # Tests der Abrechnungslogik
npm run dist       # Windows-Installer + Portable bauen (unter Windows)
```
Stack: Electron, React, TypeScript, Vite. Logik in `src/logic.ts` (Cash-Game) und `src/tourney.ts` (Turnier).

## iPhone (Web-App)

Die gleiche App läuft als Web-App auf dem iPhone: **https://rhulksack.github.io/pokerkasse/**

1. Link in **Safari** öffnen.
2. **Teilen** → **„Zum Home-Bildschirm“** → Hinzufügen.
3. Ab jetzt nur noch über das Icon auf dem Home-Bildschirm starten.

Die Daten liegen nur auf dem iPhone (kein Server, keine Kosten). GitHub Pages liefert lediglich die App-Dateien aus; nach dem ersten Start funktioniert sie auch offline. Über **Datensicherung** lassen sich alle Daten als JSON-Datei sichern und zwischen Laptop und iPhone übertragen.

Jeder Push auf `main` baut und veröffentlicht die Web-App automatisch (`.github/workflows/pages.yml`).
