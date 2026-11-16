// Turnier-Logik: Blindstruktur, Uhr, Rebuy/Late-Reg-Fenster, Platzierungen, Bounties, Auszahlung, Sitzplätze, Color-up.
import { Game, ROUND_STEP, activeEvents, c, deriveState, e, roundToSum } from './logic';

export interface LevelItem { kind: 'level'; sb: number; bb: number; minutes: number }
export interface BreakItem { kind: 'break'; minutes: number }
export type StructItem = LevelItem | BreakItem;

export interface Window { enabled: boolean; untilLevel: number; inBreakAfter: boolean }

export interface TourneyConfig {
  buyIn: number; // Betrag, der in den Preispool geht
  bounty: number | null; // zusätzlich pro Einstieg, null = keine Bounties
  startChips: number;
  rebuyChips: number;
  denominations: number[];
  structure: StructItem[];
  anteFromLevel: number | null; // Big-Blind-Ante (1 BB) ab diesem Level
  rebuy: Window & { maxPerPlayer: number | null };
  lateReg: Window;
  payouts: number[]; // Prozent je Platz
  tables: number;
}

export interface Clock { idx: number; remainingMs: number; runningSince: number | null }
export interface Seating { seats: Record<string, { table: number; seat: number }>; buttons: Record<number, number> }

export const defaultTourney = (): TourneyConfig => ({
  buyIn: 20,
  bounty: null,
  startChips: 10000,
  rebuyChips: 10000,
  denominations: [25, 100, 500, 1000, 5000],
  structure: [{ kind: 'level', sb: 25, bb: 50, minutes: 20 }],
  anteFromLevel: null,
  rebuy: { enabled: true, untilLevel: 6, inBreakAfter: true, maxPerPlayer: null },
  lateReg: { enabled: true, untilLevel: 6, inBreakAfter: true },
  payouts: [50, 30, 20],
  tables: 1,
});

export const entryPrice = (t: TourneyConfig) => t.buyIn + (t.bounty ?? 0);

// ---------- Struktur ----------

/** Levelnummer (1-basiert) an Position idx. Bei einer Pause: Nummer des letzten Levels davor (0 = vor Level 1). */
export function levelNo(structure: StructItem[], idx: number) {
  let n = 0;
  for (let i = 0; i <= idx && i < structure.length; i++) if (structure[i].kind === 'level') n++;
  return n;
}

export function anteFor(t: TourneyConfig, lvlNo: number, bb: number) {
  return t.anteFromLevel != null && lvlNo >= t.anteFromLevel ? bb : 0;
}

export function nextLevelIdx(structure: StructItem[], idx: number) {
  for (let i = idx + 1; i < structure.length; i++) if (structure[i].kind === 'level') return i;
  return -1;
}

export function nextBreakIdx(structure: StructItem[], idx: number) {
  for (let i = idx + 1; i < structure.length; i++) if (structure[i].kind === 'break') return i;
  return -1;
}

// ---------- Uhr ----------

export interface ClockView { idx: number; remaining: number; running: boolean; ended: boolean }

export function clockAt(t: TourneyConfig, clock: Clock | undefined, now: number): ClockView {
  const st = t.structure;
  if (!clock) return { idx: 0, remaining: (st[0]?.minutes ?? 0) * 60000, running: false, ended: false };
  let idx = clock.idx;
  let rem = clock.remainingMs - (clock.runningSince != null ? now - clock.runningSince : 0);
  while (rem <= 0 && idx < st.length - 1) { idx++; rem += st[idx].minutes * 60000; }
  const ended = rem <= 0 && idx >= st.length - 1;
  return { idx, remaining: Math.max(0, rem), running: clock.runningSince != null && !ended, ended };
}

const freeze = (t: TourneyConfig, clock: Clock | undefined, now: number): Clock => {
  const v = clockAt(t, clock, now);
  return { idx: v.idx, remainingMs: v.remaining, runningSince: v.running ? now : null };
};

export const clockOps = {
  start: (t: TourneyConfig, now: number): Clock => ({ idx: 0, remainingMs: t.structure[0].minutes * 60000, runningSince: now }),
  pause: (t: TourneyConfig, cl: Clock | undefined, now: number): Clock => ({ ...freeze(t, cl, now), runningSince: null }),
  resume: (t: TourneyConfig, cl: Clock | undefined, now: number): Clock => ({ ...freeze(t, cl, now), runningSince: now }),
  jump: (t: TourneyConfig, cl: Clock | undefined, now: number, dir: 1 | -1): Clock => {
    const f = freeze(t, cl, now);
    const idx = Math.min(t.structure.length - 1, Math.max(0, f.idx + dir));
    return { idx, remainingMs: t.structure[idx].minutes * 60000, runningSince: f.runningSince };
  },
  add: (t: TourneyConfig, cl: Clock | undefined, now: number, ms: number): Clock => {
    const f = freeze(t, cl, now);
    return { ...f, remainingMs: Math.max(1000, f.remainingMs + ms) };
  },
};

// ---------- Rebuy / Late Registration ----------

export function windowOpen(w: Window, structure: StructItem[], idx: number, started: boolean) {
  if (!w.enabled) return false;
  if (!started) return true;
  const item = structure[idx];
  const n = levelNo(structure, idx);
  if (!item) return false;
  if (item.kind === 'level') return n <= w.untilLevel;
  if (n < w.untilLevel) return true;
  return n === w.untilLevel && w.inBreakAfter;
}

export function windowText(w: Window, label: string) {
  if (!w.enabled) return `Kein ${label}`;
  return `${label} bis Ende Level ${w.untilLevel}${w.inBreakAfter ? ' + Pause danach' : ''}`;
}

// ---------- Spielstand ----------

export interface TPlayer {
  id: string; name: string;
  entries: number; rebuys: number;
  totalIn: number; paidCash: number; open: number;
  out: boolean; place: number | null; bustId: string | null; byId: string | null;
  bounties: number; // Anzahl gewonnener Bounties
}

export interface TState {
  players: TPlayer[];
  entries: number; rebuys: number;
  prizePool: number; bountyPool: number;
  alive: number; chipsInPlay: number; avgStack: number;
  cashBox: number; open: number; totalIn: number;
  prizes: number[]; // je Platz, auf 5 € gerundet
  prizesExact: number[];
  prizeRest: number;
}

export function tourneyState(game: Game): TState {
  const t = game.tourney!;
  const s = deriveState(game);
  const { events } = activeEvents(game);
  const map = new Map<string, TPlayer>();
  for (const p of s.players) {
    map.set(p.id, {
      id: p.id, name: p.name, entries: 0, rebuys: 0, totalIn: p.totalIn, paidCash: p.paidCash, open: p.open,
      out: false, place: null, bustId: null, byId: null, bounties: 0,
    });
  }
  const added: string[] = [];
  let alive = 0;
  for (const ev of events) {
    if (ev.type === 'player_added') { if (!added.includes(ev.playerId)) { added.push(ev.playerId); alive++; } }
    if (ev.type === 'buyin') { const p = map.get(ev.playerId); if (p) { p.entries++; if (ev.rebuy) p.rebuys++; } }
    if (ev.type === 'bust') {
      const p = map.get(ev.playerId);
      if (ev.byId && map.get(ev.byId)) map.get(ev.byId)!.bounties++;
      if (p && ev.final && !p.out) { p.out = true; p.place = alive; p.bustId = ev.id; p.byId = ev.byId ?? null; alive--; }
    }
  }
  const players = [...map.values()];
  const entries = players.reduce((a, p) => a + p.entries, 0);
  const rebuys = players.reduce((a, p) => a + p.rebuys, 0);
  const prizePool = entries * t.buyIn;
  const bountyPool = entries * (t.bounty ?? 0);
  const chipsInPlay = (entries - rebuys) * t.startChips + rebuys * t.rebuyChips;
  const aliveN = players.filter((p) => !p.out).length;
  if (game.status === 'finished') {
    const last = players.filter((p) => !p.out);
    if (last.length === 1) last[0].place = 1;
  }
  // Auszahlung: Prozente auf die bezahlten Plätze, höchstens so viele Plätze wie Spieler
  const places = Math.min(t.payouts.length, Math.max(1, players.length));
  const pct = t.payouts.slice(0, places);
  const pctSum = pct.reduce((a, b) => a + b, 0) || 1;
  const exactC = pct.map((x) => (c(prizePool) * x) / pctSum);
  const targetC = Math.floor(c(prizePool) / (ROUND_STEP * 100)) * ROUND_STEP * 100;
  const roundedC = roundToSum(exactC.map(Math.round), ROUND_STEP * 100, targetC);
  return {
    players, entries, rebuys, prizePool, bountyPool,
    alive: aliveN, chipsInPlay, avgStack: aliveN ? Math.round(chipsInPlay / aliveN) : 0,
    cashBox: s.cashBox, open: s.open, totalIn: s.totalIn,
    prizes: roundedC.map(e), prizesExact: exactC.map((x) => e(Math.round(x))),
    prizeRest: e(c(prizePool) - roundedC.reduce((a, b) => a + b, 0)),
  };
}

export interface TRow extends TPlayer { prize: number; bountyWon: number; result: number; settle: number }

/** Endabrechnung: Preisgeld + Bounties − noch offen = bekommt (>0) bzw. zahlt noch (<0). */
export function tourneySettlement(game: Game) {
  const t = game.tourney!;
  const st = tourneyState(game);
  const rows: TRow[] = st.players.map((p) => {
    const prize = p.place && p.place <= st.prizes.length ? st.prizes[p.place - 1] : 0;
    // Bounties: gewonnene + die eigene, falls er das Turnier gewinnt
    const bountyWon = (t.bounty ?? 0) * (p.bounties + (p.place === 1 ? 1 : 0));
    const result = e(c(prize) + c(bountyWon) - c(p.totalIn));
    const settle = e(c(prize) + c(bountyWon) - c(p.open));
    return { ...p, prize, bountyWon, result, settle };
  }).sort((a, b) => (a.place ?? 999) - (b.place ?? 999));
  const payOut = rows.filter((r) => r.settle > 0).reduce((a, r) => a + c(r.settle), 0);
  const payIn = rows.filter((r) => r.settle < 0).reduce((a, r) => a - c(r.settle), 0);
  const unassignedBounties = e(c(st.bountyPool) - rows.reduce((a, r) => a + c(r.bountyWon), 0));
  return { st, rows, payOut: e(payOut), payIn: e(payIn), rest: e(c(st.cashBox) + payIn - payOut), unassignedBounties };
}

// ---------- Sitzplätze ----------

const shuffle = <T,>(a: T[]) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };

export function drawSeats(ids: string[], tables: number): Seating {
  const n = Math.max(1, Math.min(tables, ids.length || 1));
  const seats: Seating['seats'] = {};
  const byTable: string[][] = Array.from({ length: n }, () => []);
  shuffle(ids).forEach((id, i) => byTable[i % n].push(id));
  const buttons: Seating['buttons'] = {};
  byTable.forEach((list, ti) => {
    const nums = shuffle(list.map((_, i) => i + 1));
    list.forEach((id, i) => { seats[id] = { table: ti + 1, seat: nums[i] }; });
    if (list.length) buttons[ti + 1] = nums[Math.floor(Math.random() * nums.length)];
  });
  return { seats, buttons };
}

/** Neuen Spieler an den Tisch mit den wenigsten aktiven Spielern setzen (freier Platz mit kleinster Nummer). */
export function seatLate(seating: Seating | undefined, id: string, aliveIds: string[], tables: number): Seating {
  const sg: Seating = seating ? structuredClone(seating) : { seats: {}, buttons: {} };
  const count = (tb: number) => aliveIds.filter((x) => sg.seats[x]?.table === tb).length;
  let best = 1;
  for (let tb = 1; tb <= Math.max(1, tables); tb++) if (count(tb) < count(best)) best = tb;
  const taken = new Set(aliveIds.filter((x) => sg.seats[x]?.table === best).map((x) => sg.seats[x].seat));
  let seat = 1; while (taken.has(seat)) seat++;
  sg.seats[id] = { table: best, seat };
  if (sg.buttons[best] == null) sg.buttons[best] = seat;
  return sg;
}

export function tableBalance(seating: Seating | undefined, aliveIds: string[], tables: number) {
  if (!seating || tables < 2) return null;
  const counts = Array.from({ length: tables }, (_, i) => aliveIds.filter((x) => seating.seats[x]?.table === i + 1).length);
  const max = Math.max(...counts), min = Math.min(...counts);
  if (max - min < 2) return null;
  return { from: counts.indexOf(max) + 1, to: counts.indexOf(min) + 1, counts };
}

// ---------- Color-up ----------

/** Chipwerte, die ab Position fromIdx nicht mehr gebraucht werden (alle künftigen Blinds/Antes sind durch den nächsthöheren Chip teilbar). */
export function uselessDenoms(t: TourneyConfig, fromIdx: number) {
  const d = [...t.denominations].filter((x) => x > 0).sort((a, b) => a - b);
  const vals: number[] = [];
  t.structure.forEach((it, i) => {
    if (i < fromIdx || it.kind !== 'level') return;
    vals.push(it.sb, it.bb, anteFor(t, levelNo(t.structure, i), it.bb));
  });
  const useless: number[] = [];
  for (let i = 0; i < d.length - 1; i++) {
    if (vals.length && vals.every((v) => v === 0 || v % d[i + 1] === 0)) useless.push(d[i]); else break;
  }
  return { useless, next: d[useless.length] };
}

/** Hinweis für eine Pause an Position idx: welche Chips ab dem nächsten Level wegfallen. */
export function colorUpHint(t: TourneyConfig, idx: number) {
  if (t.structure[idx]?.kind !== 'break' || t.denominations.length < 2) return null;
  let pb = -1;
  for (let i = idx - 1; i >= 0; i--) if (t.structure[i].kind === 'break') { pb = i; break; }
  const before = uselessDenoms(t, pb + 1).useless;
  const after = uselessDenoms(t, idx + 1);
  const fresh = after.useless.filter((x) => !before.includes(x));
  if (!fresh.length) return null;
  return { chips: fresh, into: after.next };
}


export const fmtChips = (n: number) => n.toLocaleString('de-DE');
export const fmtClock = (ms: number) => {
  const t = Math.ceil(ms / 1000);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m).padStart(2, '0')) + ':' + String(s).padStart(2, '0');
};
