// Statistik über abgeschlossene Homegames: Ergebnis je Spieler und Spiel, Summen, Titel.
import { AppData, Game, activeEvents, c, computeSettlement, e } from './logic';
import { tourneySettlement } from './tourney';

export type StatKind = 'all' | 'cash' | 'tourney';

export interface Entry {
  gameId: string; gameName: string; at: number; kind: 'cash' | 'tourney';
  playerId: string; name: string;
  result: number; // Plus/Minus in Euro (angeschriebene Beträge zählen wie bar)
  buyIn: number; // insgesamt eingesetzt
  buyins: number; // Anzahl Einkäufe (Cash) bzw. Einstiege (Turnier)
  // nur Turnier
  place?: number | null; prize?: number; bountyWon?: number; bounties?: number; rebuys?: number;
  paidPlaces?: number; field?: number;
}

export const gameDate = (g: Game) => g.endedAt ?? g.startedAt ?? g.createdAt;

/** Alle Einzelergebnisse aus abgeschlossenen Spielen. */
export function collectEntries(data: AppData): Entry[] {
  const out: Entry[] = [];
  for (const g of data.games) {
    if (g.status !== 'finished') continue;
    const at = gameDate(g);
    const nameOf = (id: string, fb: string) => data.players.find((p) => p.id === id)?.name ?? fb;
    if (g.kind === 'tourney' && g.tourney) {
      const { rows, st } = tourneySettlement(g);
      const paidPlaces = st.prizes.filter((x) => x > 0).length;
      for (const r of rows) {
        out.push({
          gameId: g.id, gameName: g.name, at, kind: 'tourney', playerId: r.id, name: nameOf(r.id, r.name),
          result: r.result, buyIn: r.totalIn, buyins: r.entries,
          place: r.place, prize: r.prize, bountyWon: r.bountyWon, bounties: r.bounties + (r.place === 1 ? 1 : 0), rebuys: r.rebuys,
          paidPlaces, field: st.players.length,
        });
      }
    } else {
      const final = g.final ?? { chips: {}, adjust: {}, ignoreDiff: true };
      const s = computeSettlement(g, final);
      const ev = activeEvents(g).events;
      for (const r of s.rows) {
        const n = ev.filter((x) => x.type === 'buyin' && x.playerId === r.id).length;
        if (n === 0 && r.result === 0) continue; // nur zugeschaut / nie eingekauft
        out.push({ gameId: g.id, gameName: g.name, at, kind: 'cash', playerId: r.id, name: nameOf(r.id, r.name), result: r.result, buyIn: r.totalIn, buyins: n });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

export interface PlayerStat {
  id: string; name: string;
  games: number; result: number; avg: number; best: number; worst: number; buyIn: number;
  wins: number; itm: number; bubbles: number; bounties: number; bountyWon: number; rebuys: number; buyins: number;
  plusGames: number; streakPlus: number; streakMinus: number;
  entries: Entry[];
}

export function playerStats(entries: Entry[]): PlayerStat[] {
  const m = new Map<string, PlayerStat>();
  for (const x of entries) {
    let p = m.get(x.playerId);
    if (!p) {
      p = { id: x.playerId, name: x.name, games: 0, result: 0, avg: 0, best: -Infinity, worst: Infinity, buyIn: 0, wins: 0, itm: 0, bubbles: 0, bounties: 0, bountyWon: 0, rebuys: 0, buyins: 0, plusGames: 0, streakPlus: 0, streakMinus: 0, entries: [] };
      m.set(x.playerId, p);
    }
    p.games++;
    p.result = e(c(p.result) + c(x.result));
    p.buyIn = e(c(p.buyIn) + c(x.buyIn));
    p.best = Math.max(p.best, x.result);
    p.worst = Math.min(p.worst, x.result);
    if (x.result > 0) p.plusGames++;
    p.buyins += x.buyins;
    if (x.kind === 'tourney') {
      if (x.place === 1) p.wins++;
      if ((x.prize ?? 0) > 0) p.itm++;
      if (x.paidPlaces && x.place === x.paidPlaces + 1) p.bubbles++;
      p.bounties += x.bounties ?? 0;
      p.bountyWon = e(c(p.bountyWon) + c(x.bountyWon ?? 0));
      p.rebuys += x.rebuys ?? 0;
    } else p.rebuys += Math.max(0, x.buyins - 1);
    p.entries.push(x);
  }
  for (const p of m.values()) {
    p.avg = p.games ? Math.round((p.result / p.games) * 100) / 100 : 0;
    let cp = 0, cm = 0;
    for (const x of p.entries) {
      cp = x.result > 0 ? cp + 1 : 0; cm = x.result < 0 ? cm + 1 : 0;
      p.streakPlus = Math.max(p.streakPlus, cp); p.streakMinus = Math.max(p.streakMinus, cm);
    }
  }
  return [...m.values()].sort((a, b) => b.result - a.result || a.name.localeCompare(b.name, 'de'));
}

export interface Title { key: string; title: string; desc: string; who: string; value: string }

const best = (xs: PlayerStat[], f: (x: PlayerStat) => number, ok = (v: number) => v > 0) => {
  let v = -Infinity;
  for (const x of xs) v = Math.max(v, f(x));
  if (!xs.length || !ok(v)) return null;
  const top = xs.filter((x) => Math.abs(f(x) - v) < 0.005);
  return { x: top[0], all: top, v };
};

/** Spaßtitel mit Poker-Begriffen. Es erscheinen nur Titel, für die es einen klaren Kandidaten gibt. */
export function titles(ps: PlayerStat[], kind: StatKind, money: (n: number, sign?: boolean) => string): Title[] {
  const t: Title[] = [];
  const add = (key: string, title: string, desc: string, r: { x: PlayerStat; all: PlayerStat[]; v: number } | null, value: (v: number, p: PlayerStat) => string) => {
    if (r) t.push({ key, title, desc, who: r.all.map((p) => p.name).join(', '), value: value(r.v, r.x) });
  };
  add('chipleader', 'Chipleader', 'Höchstes Plus insgesamt', best(ps, (p) => p.result), (v) => money(v, true));
  add('loser', 'Biggest Loser', 'Höchstes Minus insgesamt', best(ps, (p) => -p.result), (v) => money(-v, true));
  const reg = ps.filter((p) => p.games >= 3);
  add('shark', 'Shark', 'Bestes Ø pro Spiel (ab 3 Spielen)', best(reg, (p) => p.avg), (v) => money(v, true) + ' / Spiel');
  add('fish', 'Fisch', 'Schlechtestes Ø pro Spiel (ab 3 Spielen)', best(reg, (p) => -p.avg), (v) => money(-v, true) + ' / Spiel');
  add('monster', 'Monster Pot', 'Größter Gewinn an einem Abend', best(ps, (p) => p.best), (v) => money(v, true));
  add('badbeat', 'Bad Beat', 'Größter Verlust an einem Abend', best(ps, (p) => -p.worst), (v) => money(-v, true));
  add('heater', 'Heater', 'Längste Serie mit Plus', best(ps, (p) => p.streakPlus, (v) => v >= 2), (v) => `${v} Spiele in Folge`);
  add('tilt', 'Auf Tilt', 'Längste Serie mit Minus', best(ps, (p) => p.streakMinus, (v) => v >= 2), (v) => `${v} Spiele in Folge`);
  add('atm', 'ATM', kind === 'tourney' ? 'Meiste Rebuys' : kind === 'cash' ? 'Meiste Nachkäufe' : 'Meiste Rebuys und Nachkäufe', best(ps, (p) => p.rebuys), (v) => `${v}×`);
  add('grinder', 'Grinder', 'Meiste Spiele', best(ps, (p) => p.games, (v) => v >= 2), (v) => `${v} Spiele`);
  if (kind !== 'cash') {
    add('champ', 'Champion', 'Meiste Turniersiege', best(ps, (p) => p.wins), (v) => `${v} Sieg${v === 1 ? '' : 'e'}`);
    add('hunter', 'Bounty Hunter', 'Meiste Bounties', best(ps, (p) => p.bounties), (v, p) => `${v} Bount${v === 1 ? 'y' : 'ies'} · ${money(p.bountyWon)}`);
    add('itm', 'In the Money', 'Am häufigsten im Geld', best(ps, (p) => p.itm), (v) => `${v}×`);
    add('bubble', 'Bubble Boy', 'Am häufigsten knapp am Geld vorbei', best(ps, (p) => p.bubbles), (v) => `${v}×`);
  }
  return t;
}

export interface Range { from: number | null; to: number | null }

export function filterEntries(es: Entry[], kind: StatKind, r: Range) {
  return es.filter((x) => (kind === 'all' || x.kind === kind) && (r.from == null || x.at >= r.from) && (r.to == null || x.at <= r.to));
}
