import { describe, expect, it } from 'vitest';
import { Game, GameEvent } from '../src/logic';
import { TourneyConfig, clockAt, clockOps, colorUpHint, defaultTourney, drawSeats, entryPrice, tourneySettlement, tourneyState, windowOpen } from '../src/tourney';

const cfg = (o: Partial<TourneyConfig> = {}): TourneyConfig => ({
  ...defaultTourney(),
  structure: [
    { kind: 'level', sb: 25, bb: 50, minutes: 10 },
    { kind: 'level', sb: 50, bb: 100, minutes: 10 },
    { kind: 'break', minutes: 5 },
    { kind: 'level', sb: 100, bb: 200, minutes: 10 },
  ],
  ...o,
});
let n = 0;
const ev = (x: any): GameEvent => ({ id: 'e' + n++, at: n, ...x });
function game(t: TourneyConfig, names: string[], extra: any[] = [], status: Game['status'] = 'running'): Game {
  const players = names.map((name) => ({ id: name, name }));
  return {
    id: 'g', name: 'T', kind: 'tourney', tourney: t, createdAt: 0, startedAt: 0, endedAt: status === 'finished' ? 1 : null, status, players,
    events: [...players.map((p) => ev({ type: 'player_added', playerId: p.id })), ...players.map((p) => ev({ type: 'buyin', playerId: p.id, amount: entryPrice(t), paid: true })), ...extra.map(ev)],
    final: null, settleMode: 'overview',
  } as Game;
}

describe('Turnier', () => {
  it('Uhr läuft automatisch ins nächste Level und in die Pause', () => {
    const t = cfg();
    const c = clockOps.start(t, 0);
    expect(clockAt(t, c, 5 * 60000)).toMatchObject({ idx: 0, remaining: 5 * 60000 });
    expect(clockAt(t, c, 21 * 60000)).toMatchObject({ idx: 2, remaining: 4 * 60000 });
    const p = clockOps.pause(t, c, 21 * 60000);
    expect(clockAt(t, p, 99 * 60000)).toMatchObject({ idx: 2, running: false });
    expect(clockAt(t, clockOps.jump(t, p, 0, 1), 0).idx).toBe(3);
  });
  it('Rebuy-Fenster inkl. Pause danach', () => {
    const t = cfg();
    const w = { enabled: true, untilLevel: 2, inBreakAfter: true };
    expect(windowOpen(w, t.structure, 1, true)).toBe(true);
    expect(windowOpen(w, t.structure, 2, true)).toBe(true);
    expect(windowOpen({ ...w, inBreakAfter: false }, t.structure, 2, true)).toBe(false);
    expect(windowOpen(w, t.structure, 3, true)).toBe(false);
  });
  it('Plätze, Preispool und 50/30/20 auf 5 € gerundet', () => {
    const t = cfg({ buyIn: 15 });
    const g = game(t, ['A', 'B', 'C', 'D', 'E'], [
      { type: 'buyin', playerId: 'A', amount: 15, paid: true, rebuy: true },
      { type: 'bust', playerId: 'E', final: true },
      { type: 'bust', playerId: 'D', final: true },
      { type: 'bust', playerId: 'C', final: true },
      { type: 'bust', playerId: 'B', final: true },
    ], 'finished');
    const st = tourneyState(g);
    expect(st.prizePool).toBe(90);
    expect(st.prizes.reduce((a, b) => a + b, 0)).toBe(90);
    expect(st.prizes.every((x) => x % 5 === 0)).toBe(true);
    expect(st.prizes).toEqual([45, 25, 20]);
    const places = Object.fromEntries(st.players.map((p) => [p.id, p.place]));
    expect(places).toEqual({ A: 1, B: 2, C: 3, D: 4, E: 5 });
    expect(st.avgStack).toBe(60000);
  });
  it('Bounties gehen an den Rauswerfer, Sieger behält seine', () => {
    const t = cfg({ buyIn: 20, bounty: 5 });
    const g = game(t, ['A', 'B', 'C'], [
      { type: 'bust', playerId: 'C', byId: 'B', final: true },
      { type: 'bust', playerId: 'B', byId: 'A', final: true },
    ], 'finished');
    const s = tourneySettlement(g);
    const r = Object.fromEntries(s.rows.map((x) => [x.id, x]));
    expect(s.st.prizePool).toBe(60);
    expect(r.A.bountyWon).toBe(10);
    expect(r.B.bountyWon).toBe(5);
    expect(r.C.bountyWon).toBe(0);
    expect(s.unassignedBounties).toBe(0);
    expect(s.rest).toBe(0);
  });
  it('Angeschriebenes wird mit dem Preisgeld verrechnet', () => {
    const t = cfg({ buyIn: 20, payouts: [100] });
    const g = game(t, ['A', 'B'], [
      { type: 'buyin', playerId: 'B', amount: 20, paid: false, rebuy: true },
      { type: 'bust', playerId: 'A', final: true },
    ], 'finished');
    const s = tourneySettlement(g);
    const B = s.rows.find((x) => x.id === 'B')!;
    expect(B.prize).toBe(60);
    expect(B.settle).toBe(40);
    expect(s.rest).toBe(0);
  });
  it('Color-up-Hinweis in der Pause', () => {
    const t = cfg({ denominations: [25, 100, 500] });
    expect(colorUpHint(t, 2)).toEqual({ chips: [25], into: 100 });
  });
  it('Sitzplätze: alle verteilt, Tische ausgeglichen, Button gesetzt', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const s = drawSeats(ids, 2);
    expect(Object.keys(s.seats).length).toBe(7);
    const c1 = ids.filter((i) => s.seats[i].table === 1).length;
    expect(Math.abs(c1 - (7 - c1))).toBeLessThanOrEqual(1);
    expect(Object.keys(s.buttons).length).toBe(2);
  });
});
