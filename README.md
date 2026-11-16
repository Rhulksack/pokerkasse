# Pokerkasse

Desktop-App (Windows) zur Verwaltung von Poker-Cashgame-Homegames: Spieler, Buy-ins (bar / angeschrieben), Rake & Dealer-Tips, vorzeitige Cash-outs, Chip-Abgleich und Endabrechnung mit fairer 5-€-Rundung.

## Installation
- `Pokerkasse-Setup-1.2.0.exe`: normaler Installer (Startmenü, Desktop-Verknüpfung).
- `Pokerkasse-Portable-1.2.0.exe`: ohne Installation direkt startbar.

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

## Entwicklung
```
npm install
npm run dev        # UI im Browser (Daten in localStorage)
npm start          # als Electron-App starten
npm test           # Tests der Abrechnungslogik
npm run dist       # Windows-Installer + Portable bauen (unter Windows)
```
Stack: Electron, React, TypeScript, Vite. Logik in `src/logic.ts`.

## iPhone (Web-App)

Die gleiche App läuft als Web-App auf dem iPhone: **https://rhulksack.github.io/pokerkasse/**

1. Link in **Safari** öffnen.
2. **Teilen** → **„Zum Home-Bildschirm“** → Hinzufügen.
3. Ab jetzt nur noch über das Icon auf dem Home-Bildschirm starten.

Die Daten liegen nur auf dem iPhone (kein Server, keine Kosten). GitHub Pages liefert lediglich die App-Dateien aus; nach dem ersten Start funktioniert sie auch offline. Über **Datensicherung** lassen sich alle Daten als JSON-Datei sichern und zwischen Laptop und iPhone übertragen.

Jeder Push auf `main` baut und veröffentlicht die Web-App automatisch (`.github/workflows/pages.yml`).
