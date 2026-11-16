// Turnier-Aktionen als reine Mutationen auf einem Game – gemeinsam für Laptop (Host) und Handy (Fernsteuerung).
import { AppData, Game, GameEvent, uid } from './logic';
import {
  balanceTables, breakTable, clockAt, clockOps, drawSeats, entryPrice, levelNo, maxPer, seatLate, tourneyState, Move,
} from './tourney';

const ev = (g: Game, e: Omit<GameEvent, 'id' | 'at'> & { at?: number }) => {
  const full = { id: uid(), at: Date.now(), ...e } as GameEvent;
  g.events.push(full);
  return full;
};
const log = (g: Game, action: string, at = Date.now()) => ev(g, { type: 'clock', action, at } as any);
const aliveIds = (g: Game) => tourneyState(g).players.filter((p) => !p.out).map((p) => p.id);

export const tAct = {
  start(g: Game) {
    const n = Date.now();
    g.status = 'running'; g.startedAt = n; g.clock = clockOps.start(g.tourney!, n);
    ev(g, { type: 'game_started', at: n } as any);
  },
  /** Uhr anhalten / weiterlaufen lassen. Beim Weiterlaufen verschwindet der Finaltisch-Screen. */
  toggle(g: Game) {
    if (g.status === 'created') return tAct.start(g);
    const t = g.tourney!, n = Date.now();
    const running = clockAt(t, g.clock, n).running;
    g.clock = running ? clockOps.pause(t, g.clock, n) : clockOps.resume(t, g.clock, n);
    if (!running && g.finalTable) g.finalTable.dismissed = true;
    log(g, running ? 'pausiert' : 'fortgesetzt', n);
  },
  jump(g: Game, dir: 1 | -1) {
    if (g.status === 'created') return;
    const t = g.tourney!, n = Date.now();
    const cv = clockAt(t, g.clock, n);
    const target = Math.min(t.structure.length - 1, Math.max(0, cv.idx + dir));
    g.clock = clockOps.jump(t, g.clock, n, dir);
    log(g, `${dir > 0 ? 'weiter' : 'zurück'} zu ${t.structure[target].kind === 'break' ? 'Pause' : 'Level ' + levelNo(t.structure, target)}`, n);
  },
  addTime(g: Game, min: number) {
    if (g.status === 'created') return;
    const n = Date.now();
    g.clock = clockOps.add(g.tourney!, g.clock, n, min * 60000);
    log(g, `${min > 0 ? '+' : '−'}${Math.abs(min)} Min`, n);
  },
  /** Spieler scheidet aus. Ist danach nur noch einer übrig: Uhr pausieren, Host muss das Ende bestätigen. */
  bust(g: Game, playerId: string, byId: string | null) {
    const last = tourneyState(g).alive === 2;
    const n = Date.now();
    const e = ev(g, { type: 'bust', playerId, byId, final: true, at: n } as any);
    if (last) {
      const wasRunning = g.clock?.runningSince != null;
      if (wasRunning) { g.clock = clockOps.pause(g.tourney!, g.clock, n); log(g, 'pausiert (Turnierende)', n); }
      g.endCheck = { bustId: e.id, resume: wasRunning };
    }
    return { ids: [e.id], last };
  },
  rebuy(g: Game, playerId: string, paid: boolean, byId: string | null) {
    const t = g.tourney!, n = Date.now();
    const ids: string[] = [];
    if (t.bounty) ids.push(ev(g, { type: 'bust', playerId, byId, final: false, at: n } as any).id);
    ids.push(ev(g, { type: 'buyin', playerId, amount: entryPrice(t), paid, rebuy: true, at: n } as any).id);
    return ids;
  },
  /** Late Registration / Spieler hinzufügen (inkl. Stammliste, falls neu). */
  addPlayer(d: AppData, g: Game, id: string, name: string, paid: boolean) {
    if (!d.players.some((p) => p.id === id)) d.players.push({ id, name });
    if (g.players.some((p) => p.id === id)) return;
    const alive = aliveIds(g);
    const n = Date.now();
    g.players.push({ id, name });
    ev(g, { type: 'player_added', playerId: id, at: n } as any);
    ev(g, { type: 'buyin', playerId: id, amount: entryPrice(g.tourney!), paid, at: n } as any);
    g.seating = seatLate(g.seating, id, alive, maxPer(g.tourney!));
  },
  pay(g: Game, playerId: string, amount: number) { ev(g, { type: 'payment', playerId, amount } as any); },
  void(g: Game, ids: string[]) { for (const id of ids) ev(g, { type: 'void', targetId: id } as any); },
  final(g: Game) {
    const n = Date.now();
    g.seating = drawSeats(aliveIds(g), maxPer(g.tourney!)); g.finalTable = { at: n };
    if (g.moveNotice) g.moveNotice.dismissed = true;
    log(g, 'Finaltisch gelost', n);
    if (g.clock?.runningSince != null) { g.clock = clockOps.pause(g.tourney!, g.clock, n); log(g, 'pausiert (Finaltisch)', n); }
  },
  moves(g: Game, title: string, r: { seating: NonNullable<Game['seating']>; moves: Move[] }) {
    const n = Date.now();
    const name = (id: string) => g.players.find((p) => p.id === id)?.name ?? '?';
    g.seating = r.seating;
    g.moveNotice = { at: n, title, moves: r.moves };
    log(g, `${title}: ` + r.moves.map((m) => `${name(m.id)} T${m.from} → T${m.table} S${m.seat}`).join(', '), n);
  },
  balance(g: Game) { if (g.seating) tAct.moves(g, 'Tische ausgleichen', balanceTables(g.seating, aliveIds(g), maxPer(g.tourney!))); },
  breakTable(g: Game, table: number) { if (g.seating) tAct.moves(g, `Tisch ${table} wird aufgelöst`, breakTable(g.seating, table, aliveIds(g), maxPer(g.tourney!))); },
  closeMoves(g: Game) { if (g.moveNotice) g.moveNotice.dismissed = true; },
  redraw(g: Game) { g.seating = drawSeats(aliveIds(g), maxPer(g.tourney!)); },
  /** Letztes Ausscheiden war ein Fehler: rückgängig, Uhr läuft weiter, falls sie vorher lief. */
  endUndo(g: Game) {
    const n = Date.now();
    const ec = g.endCheck;
    const voided = new Set(g.events.filter((x) => x.type === 'void').map((x: any) => x.targetId));
    const last = ec?.bustId ?? [...g.events].reverse().find((x) => x.type === 'bust' && (x as any).final && !voided.has(x.id))?.id;
    if (last) ev(g, { type: 'void', targetId: last, at: n } as any);
    if (ec?.resume) { g.clock = clockOps.resume(g.tourney!, g.clock, n); log(g, 'fortgesetzt', n); }
    delete g.endCheck;
  },
  finish(g: Game) {
    const n = Date.now();
    g.status = 'finished'; g.endedAt = n; g.clock = clockOps.pause(g.tourney!, g.clock, n); delete g.endCheck;
    ev(g, { type: 'game_finished', at: n } as any);
  },
};

/** Zwei Stände eines Spiels zusammenführen: Events sind nur angehängt, also Vereinigung nach id; alles andere vom neueren Stand. */
export function mergeGame(base: Game, incoming: Game): Game {
  const seen = new Set(incoming.events.map((e) => e.id));
  const extra = base.events.filter((e) => !seen.has(e.id));
  if (!extra.length) return incoming;
  return { ...incoming, events: [...incoming.events, ...extra].sort((a, b) => a.at - b.at) };
}
