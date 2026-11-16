import { describe, expect, it } from 'vitest';
import { Game, GameEvent } from '../src/logic';
import { TourneyConfig, breakTable, clockAt, clockOps, colorUpHint, defaultTourney, drawSeats, entryPrice, seatLate, tableAdvice, tourneySettlement, tourneyState, windowOpen , balancePlan, balanceTables, neighbors, podium } from '../src/tourney';
import { moneyStatus } from '../src/TourneyView';

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
  it('Sitzplätze: Tische aus max. pro Tisch, ausgeglichen, gleicher Button-Platz', () => {
    const ids = Array.from({ length: 13 }, (_, i) => 'p' + i);
    const s = drawSeats(ids, 9);
    expect(Object.keys(s.seats).length).toBe(13);
    const c1 = ids.filter((i) => s.seats[i].table === 1).length;
    expect([6, 7]).toContain(c1);
    expect(s.buttons[1]).toBe(s.buttons[2]);
    expect(s.buttons[1]).toBeLessThanOrEqual(6);
    expect(Object.keys(drawSeats(ids.slice(0, 6), 9).buttons).length).toBe(1);
    for (let k = 0; k < 2; k++) { const t = ids.filter((i) => s.seats[i].table === k + 1).map((i) => s.seats[i].seat).sort((a, b) => a - b); expect(new Set(t).size).toBe(t.length); }
  });
  it('Tisch-Hinweise: auflösen, ausgleichen, Finaltisch', () => {
    const sg: any = { seats: {}, buttons: { 1: 1, 2: 1, 3: 1 } };
    const put = (id: string, table: number, seat: number) => { sg.seats[id] = { table, seat }; };
    ['a', 'b', 'c', 'd', 'e'].forEach((x, i) => put(x, 1, i + 1));
    ['f', 'g', 'h', 'i', 'j'].forEach((x, i) => put(x, 2, i + 2));
    put('k', 3, 1); put('l', 3, 4);
    const alive = Object.keys(sg.seats);
    const adv = tableAdvice(sg, alive, 6);
    expect(adv).toEqual({ kind: 'break', table: 3, count: 2 });
    const r = breakTable(sg, 3, alive, 6);
    expect(r.moves.length).toBe(2);
    expect(new Set(r.moves.map((m) => m.table))).toEqual(new Set([1, 2]));
    for (const tb of [1, 2]) { const seats = alive.filter((x) => r.seating.seats[x].table === tb).map((x) => r.seating.seats[x].seat); expect(new Set(seats).size).toBe(6); expect(Math.max(...seats)).toBe(6); }
    expect(r.seating.seats.a).toEqual(sg.seats.a);
    expect(tableAdvice(sg, ['a', 'b', 'c', 'd', 'f', 'g'], 6)).toEqual({ kind: 'final' });
    expect(tableAdvice(sg, ['a', 'b', 'c', 'd', 'e', 'f', 'k'], 6)?.kind).toBe('break');
    expect(tableAdvice(sg, ['a', 'b', 'c', 'd', 'e', 'f'], 5)).toEqual({ kind: 'balance', from: 1, to: 2, fromCount: 5, toCount: 1 });
  });
  it('Late Reg eröffnet neuen Tisch, wenn alle voll', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const s = drawSeats(ids, 4);
    const s2 = seatLate(s, 'e', [...ids, 'e'], 4);
    expect(s2.seats.e.table).toBe(2);
  });
  it('Bubble und Geldränge', () => {
    const pr = [70, 40, 30];
    expect(moneyStatus(5, pr)).toBeNull();
    expect(moneyStatus(4, pr)?.text).toContain('Bubble');
    expect(moneyStatus(3, pr)?.text).toContain('Platz 3');
    expect(moneyStatus(2, pr)?.text).toContain('Heads-up');
  });
});

describe('v1.6 Ausgleichen, Nachbarn, Treppchen', () => {
  const mk = (spec: Record<string, [number, number]>) => ({ seats: Object.fromEntries(Object.entries(spec).map(([k, [table, seat]]) => [k, { table, seat }])), buttons: { 1: 1, 2: 1 } });
  it('gleicht aus, bis max. 1 Unterschied, nur vom großen an den kleinen Tisch', () => {
    const spec: Record<string, [number, number]> = {};
    for (let i = 1; i <= 8; i++) spec['a' + i] = [1, i];
    for (let i = 1; i <= 4; i++) spec['b' + i] = [2, i];
    const sg = mk(spec); const ids = Object.keys(spec);
    expect(tableAdvice(sg, ids, 9, 3)?.kind).toBe('balance');
    expect(tableAdvice(sg, ids, 9, 5)).toBeNull();
    expect(balancePlan(sg, ids)).toHaveLength(2);
    const r = balanceTables(sg, ids, 9);
    expect(r.moves).toHaveLength(2);
    for (const m of r.moves) { expect(m.from).toBe(1); expect(m.table).toBe(2); expect(m.id.startsWith('a')).toBe(true); }
    const t2 = ids.filter((x) => r.seating.seats[x].table === 2).map((x) => r.seating.seats[x].seat);
    expect(new Set(t2).size).toBe(6);
  });
  it('Nachbarn im Kreis', () => {
    const sg = mk({ x: [1, 2], y: [1, 5], z: [1, 8] });
    expect(neighbors(sg, ['x', 'y', 'z'], 'y')).toEqual(['x', 'z']);
    expect(neighbors(sg, ['x', 'y', 'z'], 'x')).toEqual(['z', 'y']);
    expect(neighbors(sg, ['x', 'y'], 'x')).toEqual(['y']);
  });
  it('Treppchen nur bezahlte Plätze', () => {
    const st: any = { prizes: [70, 30], players: [{ name: 'A', out: false, place: null }, { name: 'B', out: true, place: 2 }, { name: 'C', out: true, place: 3 }] };
    expect(podium(st).map((x) => x.place + x.name)).toEqual(['1A', '2B']);
  });
});
