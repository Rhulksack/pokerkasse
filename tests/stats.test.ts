import { describe, expect, it } from 'vitest';
import { AppData, Game, fmt } from '../src/logic';
import { defaultTourney, entryPrice } from '../src/tourney';
import { collectEntries, filterEntries, playerStats, titles } from '../src/stats';

let n = 0;
const ev = (x: any) => ({ id: 'e' + n++, at: n, ...x });

function cash(id: string, at: number, buy: Record<string, number[]>, chips: Record<string, number>, status: Game['status'] = 'finished'): Game {
  const players = Object.keys(buy).map((p) => ({ id: p, name: p }));
  return {
    id, name: 'Cash ' + id, createdAt: at, startedAt: at, endedAt: status === 'finished' ? at : null, status, players, kind: 'cash',
    events: [ev({ type: 'game_started' }), ...players.map((p) => ev({ type: 'player_added', playerId: p.id })),
      ...Object.entries(buy).flatMap(([p, xs]) => xs.map((a, i) => ev({ type: 'buyin', playerId: p, amount: a, paid: i === 0 })))],
    final: { chips, adjust: {}, ignoreDiff: true }, settleMode: 'overview',
  } as Game;
}

function tourney(id: string, at: number, order: string[], extra: any[] = []): Game {
  const t = { ...defaultTourney(), buyIn: 20, bounty: 5 };
  const players = order.map((p) => ({ id: p, name: p }));
  // order: Sieger zuerst; Ausscheiden vom Letzten zum Zweiten
  const busts = [...order].reverse().slice(0, -1).map((p, i, arr) => ev({ type: 'bust', playerId: p, byId: order[0], final: true }));
  return {
    id, name: 'Turnier ' + id, kind: 'tourney', tourney: t, createdAt: at, startedAt: at, endedAt: at, status: 'finished', players,
    events: [...players.map((p) => ev({ type: 'player_added', playerId: p.id })), ...players.map((p) => ev({ type: 'buyin', playerId: p.id, amount: entryPrice(t), paid: true })), ...extra.map(ev), ...busts],
    final: null, settleMode: 'overview',
  } as Game;
}

describe('Statistik', () => {
  const data: AppData = {
    version: 1, players: ['A', 'B', 'C', 'D'].map((x) => ({ id: x, name: x })),
    games: [
      cash('c1', 1000, { A: [50], B: [50, 50] }, { A: 100, B: 50 }), // A +50, B −50 (zweiter Buy-in angeschrieben)
      cash('c2', 2000, { A: [30], B: [30] }, { A: 0, B: 60 }), // A −30, B +30
      cash('c3', 3000, { A: [30], B: [30] }, { A: 60, B: 0 }, 'running'), // läuft noch → zählt nicht
      tourney('t1', 4000, ['C', 'A', 'B', 'D'], [{ type: 'buyin', playerId: 'D', amount: 25, paid: false, rebuy: true }]),
    ],
  };
  const all = collectEntries(data);

  it('Cash: Chipwert minus Buy-ins, angeschriebene zählen wie bar, nur abgeschlossene', () => {
    const c1 = all.filter((x) => x.gameId === 'c1');
    expect(c1.find((x) => x.playerId === 'A')!.result).toBe(50);
    expect(c1.find((x) => x.playerId === 'B')!.result).toBe(-50);
    expect(all.some((x) => x.gameId === 'c3')).toBe(false);
  });

  it('Turnier: Preisgeld + Bounties − alle Einstiege', () => {
    // 4 Einstiege + 1 Rebuy = 5 × 20 € = 100 € Pool → 50/30/20; Bounties 5 €
    const t = all.filter((x) => x.gameId === 't1');
    const C = t.find((x) => x.playerId === 'C')!; // Sieger, alle 3 Bounties + eigenes
    expect(C.place).toBe(1);
    expect(C.result).toBe(50 + 4 * 5 - 25);
    const D = t.find((x) => x.playerId === 'D')!;
    expect(D.result).toBe(-50); // 2 × 25 €, nichts gewonnen
    expect(D.rebuys).toBe(1);
  });

  it('Summen, Filter und Titel', () => {
    const ps = playerStats(filterEntries(all, 'cash', { from: null, to: null }));
    const A = ps.find((p) => p.id === 'A')!;
    expect(A).toMatchObject({ games: 2, result: 20, best: 50, worst: -30 });
    expect(ps[0].id).toBe('A');
    const onlyLate = playerStats(filterEntries(all, 'all', { from: 1500, to: null }));
    expect(onlyLate.find((p) => p.id === 'A')!.games).toBe(2); // c2 + t1
    const ts = titles(playerStats(all), 'all', (v, s) => fmt(v, { sign: s }));
    expect(ts.find((t) => t.key === 'champ')!.who).toBe('C');
    expect(ts.find((t) => t.key === 'atm')!.who).toBe('B, D'); // Gleichstand: beide
  });
});
