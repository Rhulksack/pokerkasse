// Kernlogik: Datenmodell, Ableitung des Spielstands aus dem Ereignisprotokoll, Endabrechnung.
// Alle Beträge in Euro (Chipwert 1:1). Intern wird in Cent gerechnet, um Float-Fehler zu vermeiden.

export const ROUND_STEP = 5; // Auszahlungen werden auf 5-€-Beträge gerundet
export const QUICK_AMOUNTS = [25, 30, 50];

export interface MasterPlayer {
  id: string;
  name: string;
}

interface BaseEvent {
  id: string;
  at: number;
}

export type GameEvent =
  | (BaseEvent & { type: 'game_started' })
  | (BaseEvent & { type: 'player_added'; playerId: string })
  | (BaseEvent & { type: 'buyin'; playerId: string; amount: number; paid: boolean; rebuy?: boolean })
  | (BaseEvent & { type: 'bust'; playerId: string; byId?: string | null; final: boolean })
  | (BaseEvent & { type: 'clock'; action: string })
  | (BaseEvent & { type: 'payment'; playerId: string; amount: number })
  | (BaseEvent & { type: 'rake'; amount: number })
  | (BaseEvent & { type: 'tip'; amount: number })
  | (BaseEvent & {
      type: 'cashout';
      playerId: string;
      chips: number; // gezählter Chipwert
      payoutCash: number; // tatsächlich bar ausgezahlt
    })
  | (BaseEvent & { type: 'game_finished' })
  | (BaseEvent & { type: 'void'; targetId: string });

export interface GamePlayer {
  id: string; // = MasterPlayer.id
  name: string;
}

export interface FinalCount {
  chips: Record<string, number>; // Chipwert der bis zum Ende gebliebenen Spieler
  adjust: Record<string, number>; // manuelle Verteilung der Chip-Differenz
  ignoreDiff: boolean;
  rake?: number; // am Ende gezählter Rake
  tips?: number; // am Ende gezählte Dealer-Tips
}

export interface Game {
  id: string;
  name: string;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  status: 'created' | 'running' | 'finished';
  players: GamePlayer[];
  events: GameEvent[];
  final: FinalCount | null;
  settleMode: 'overview' | 'suggestions';
  kind?: 'cash' | 'tourney';
  tourney?: import('./tourney').TourneyConfig;
  clock?: import('./tourney').Clock;
  seating?: import('./tourney').Seating;
}

export interface AppData {
  version: 1;
  players: MasterPlayer[];
  games: Game[];
  lastTourney?: import('./tourney').TourneyConfig;
}

export const emptyData = (): AppData => ({ version: 1, players: [], games: [] });

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------- Hilfsfunktionen für Geld ----------

export const c = (eur: number) => Math.round(eur * 100); // Euro -> Cent
export const e = (cent: number) => cent / 100; // Cent -> Euro

export function fmt(eur: number, opts: { sign?: boolean } = {}) {
  const v = Math.round(eur * 100) / 100;
  const abs = Math.abs(v);
  const s = abs.toLocaleString('de-DE', {
    minimumFractionDigits: Number.isInteger(abs) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  const sign = v < 0 ? '−' : opts.sign && v > 0 ? '+' : '';
  return `${sign}${s} €`;
}

export function fmtDuration(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ---------- Ableitung des Live-Zustands ----------

export interface PlayerState {
  id: string;
  name: string;
  buyins: { id: string; amount: number; paid: boolean; at: number }[];
  totalIn: number; // insgesamt eingekauft
  paidCash: number; // davon bar (inkl. Nachzahlungen)
  open: number; // davon noch offen
  cashout: { id: string; chips: number; payoutCash: number; at: number } | null;
}

export interface GameState {
  players: PlayerState[];
  totalIn: number; // Gesamt-Buy-ins inkl. angeschrieben
  cashIn: number; // tatsächlich eingezahltes Bargeld
  cashOut: number; // bar ausgezahlt (vorzeitige Cash-outs)
  cashBox: number; // physisch in der Kasse
  open: number; // insgesamt angeschrieben
  rake: number;
  tips: number;
  chipsOnTable: number; // erwarteter Chipwert noch am Tisch
  voided: Set<string>;
}

export function activeEvents(game: Game) {
  const voided = new Set(
    game.events.filter((ev) => ev.type === 'void').map((ev) => (ev as any).targetId as string),
  );
  return { voided, events: game.events.filter((ev) => ev.type !== 'void' && !voided.has(ev.id)) };
}

export function deriveState(game: Game): GameState {
  const { voided, events } = activeEvents(game);
  const map = new Map<string, PlayerState>();
  for (const p of game.players) {
    map.set(p.id, {
      id: p.id,
      name: p.name,
      buyins: [],
      totalIn: 0,
      paidCash: 0,
      open: 0,
      cashout: null,
    });
  }
  let rake = 0,
    tips = 0,
    cashOutC = 0;
  const totals = new Map<string, { inC: number; paidC: number }>();
  for (const p of game.players) totals.set(p.id, { inC: 0, paidC: 0 });

  for (const ev of events) {
    switch (ev.type) {
      case 'buyin': {
        const ps = map.get(ev.playerId);
        const t = totals.get(ev.playerId);
        if (!ps || !t) break;
        ps.buyins.push({ id: ev.id, amount: ev.amount, paid: ev.paid, at: ev.at });
        t.inC += c(ev.amount);
        if (ev.paid) t.paidC += c(ev.amount);
        break;
      }
      case 'payment': {
        const t = totals.get(ev.playerId);
        if (t) t.paidC += c(ev.amount);
        break;
      }
      case 'rake':
        rake += c(ev.amount);
        break;
      case 'tip':
        tips += c(ev.amount);
        break;
      case 'cashout': {
        const ps = map.get(ev.playerId);
        if (ps) ps.cashout = { id: ev.id, chips: ev.chips, payoutCash: ev.payoutCash, at: ev.at };
        cashOutC += c(ev.payoutCash);
        break;
      }
    }
  }

  let totalInC = 0,
    cashInC = 0,
    earlyChipsC = 0;
  for (const ps of map.values()) {
    const t = totals.get(ps.id)!;
    ps.totalIn = e(t.inC);
    ps.paidCash = e(t.paidC);
    ps.open = e(t.inC - t.paidC);
    totalInC += t.inC;
    cashInC += t.paidC;
    if (ps.cashout) earlyChipsC += c(ps.cashout.chips);
  }

  return {
    players: [...map.values()],
    totalIn: e(totalInC),
    cashIn: e(cashInC),
    cashOut: e(cashOutC),
    cashBox: e(cashInC - cashOutC),
    open: e(totalInC - cashInC),
    rake: e(rake),
    tips: e(tips),
    chipsOnTable: e(totalInC - rake - tips - earlyChipsC),
    voided,
  };
}

/** Verfügbares Bargeld für Auszahlungen (Rake/Tips liegen zwar physisch in der Kasse, gehören aber nicht den Spielern). */
export const cashAvailable = (s: GameState) => e(c(s.cashBox) - c(s.rake) - c(s.tips));

/** Vorschau für einen vorzeitigen Cash-out: Chipwert wird mit angeschriebenem Betrag verrechnet. */
export function previewCashout(s: GameState, p: PlayerState, chips: number) {
  const netC = c(chips) - c(p.open);
  const result = e(c(chips) - c(p.totalIn));
  if (netC <= 0) {
    return { net: e(netC), result, payoutExact: 0, payoutRounded: 0, payoutCash: 0, debt: e(-netC), shortfall: 0 };
  }
  const roundedC = roundNearest(netC, c(ROUND_STEP));
  const availC = Math.max(0, c(cashAvailable(s)));
  const cashC = Math.min(roundedC, Math.floor(availC / c(ROUND_STEP)) * c(ROUND_STEP));
  return {
    net: e(netC),
    result,
    payoutExact: e(netC),
    payoutRounded: e(roundedC),
    payoutCash: e(cashC),
    debt: 0,
    shortfall: e(roundedC - cashC),
  };
}

const roundNearest = (vC: number, stepC: number) => Math.round(vC / stepC) * stepC;

// ---------- Faire Rundung (Restgrößenverfahren) ----------

/**
 * Rundet Werte (in Cent) auf Vielfache von stepC, sodass die Summe exakt targetC ergibt
 * und die Abweichungen der Einzelnen möglichst klein bleiben.
 */
export function roundToSum(valuesC: number[], stepC: number, targetC: number): number[] {
  const base = valuesC.map((v) => Math.floor(v / stepC) * stepC);
  const rem = valuesC.map((v, i) => v - base[i]);
  let k = Math.round((targetC - base.reduce((a, b) => a + b, 0)) / stepC);
  const res = [...base];
  if (valuesC.length === 0) return res;
  // Positive Korrektur: zuerst die mit dem größten Rest aufrunden
  while (k > 0) {
    const order = res
      .map((_, i) => i)
      .sort((a, b) => valuesC[b] - res[b] - (valuesC[a] - res[a]));
    for (const i of order) {
      if (k <= 0) break;
      res[i] += stepC;
      k--;
    }
  }
  // Negative Korrektur: die abrunden, bei denen es am wenigsten wehtut
  while (k < 0) {
    const order = res
      .map((_, i) => i)
      .sort((a, b) => res[a] - valuesC[a] - (res[b] - valuesC[b]));
    for (const i of order) {
      if (k >= 0) break;
      res[i] -= stepC;
      k++;
    }
  }
  void rem;
  return res;
}

// ---------- Endabrechnung ----------

export interface SettlementRow {
  id: string;
  name: string;
  totalIn: number;
  paidCash: number;
  open: number;
  chips: number; // Cash-out-Wert inkl. Differenzausgleich
  adjust: number;
  result: number; // spielerischer Gewinn/Verlust = chips - totalIn
  early: boolean;
  earlyPaid: number; // bei vorzeitigem Gehen bereits bar erhalten
  settleExact: number; // noch zu begleichen: >0 bekommt, <0 zahlt
  settle: number; // gerundet auf 5 €
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

export interface Settlement {
  rows: SettlementRow[];
  expectedChips: number; // Chipwert, der laut Buy-ins minus Rake/Tips existieren müsste
  countedChips: number; // gezählt (inkl. früh gegangener)
  diff: number; // gezählt + Ausgleich − erwartet
  rake: number;
  tips: number;
  totalIn: number;
  cashIn: number;
  cashBox: number;
  cashForPlayers: number;
  roundingRest: number; // Rest in der Kasse durch 5-€-Rundung (bzw. negativ = Fehlbetrag)
  // Übersicht: wer bekommt bar, wer zahlt in die Kasse
  // Vorschläge: Schuldner zahlen direkt an Gewinner, Rest bar aus der Kasse
  transfers: Transfer[];
  cashPayouts: { id: string; amount: number }[];
}

export function computeSettlement(game: Game, final: FinalCount): Settlement {
  const s = deriveState(game);
  const step = c(ROUND_STEP);

  const rows: SettlementRow[] = s.players.map((p) => {
    const early = !!p.cashout;
    const adjust = early ? 0 : final.adjust[p.id] ?? 0;
    const chipsRaw = early ? p.cashout!.chips : final.chips[p.id] ?? 0;
    const chipsC = c(chipsRaw) + c(adjust);
    const earlyPaidC = early ? c(p.cashout!.payoutCash) : 0;
    let settleC = chipsC - c(p.open) - earlyPaidC;
    // Früh Gegangene mit reiner Rundungsdifferenz (< 5 €) gelten als erledigt
    if (early && Math.abs(settleC) < step && c(chipsRaw) - c(p.open) > 0) settleC = 0;
    return {
      id: p.id,
      name: p.name,
      totalIn: p.totalIn,
      paidCash: p.paidCash,
      open: p.open,
      chips: e(chipsC),
      adjust,
      result: e(chipsC - c(p.totalIn)),
      early,
      earlyPaid: e(earlyPaidC),
      settleExact: e(settleC),
      settle: 0,
    };
  });

  // Rake und Tips werden am Ende gezählt (alte Spiele: zusätzlich während des Spiels erfasste Beträge)
  const rakeC = c(s.rake) + c(final.rake ?? 0);
  const tipsC = c(s.tips) + c(final.tips ?? 0);
  const expectedC = c(s.totalIn) - rakeC - tipsC;
  const countedC = rows.reduce((a, r) => a + c(r.chips) - c(r.adjust), 0);
  const adjustSumC = rows.reduce((a, r) => a + c(r.adjust), 0);
  const diffC = countedC + adjustSumC - expectedC;

  const availC = c(s.cashBox) - rakeC - tipsC;
  const sumExactC = rows.reduce((a, r) => a + c(r.settleExact), 0);
  // Ziel: Kasse geht (bis auf < 5 € Rundungsrest) auf. Bei großer Abweichung (Differenz ignoriert)
  // wird stattdessen die Summe der Ansprüche gerundet.
  const targetC =
    Math.abs(sumExactC - availC) < step
      ? Math.floor(availC / step) * step
      : Math.round(sumExactC / step) * step;

  const idx = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.settleExact !== 0);
  const rounded = roundToSum(
    idx.map(({ r }) => c(r.settleExact)),
    step,
    targetC,
  );
  idx.forEach(({ i }, k) => (rows[i].settle = e(rounded[k])));

  // Zahlungsvorschläge: Schuldner -> Gewinner, möglichst wenige Überweisungen
  const debtors = rows.filter((r) => r.settle < 0).map((r) => ({ id: r.id, amt: -c(r.settle) }));
  const winners = rows.filter((r) => r.settle > 0).map((r) => ({ id: r.id, amt: c(r.settle) }));
  const transfers: Transfer[] = [];
  // 1) exakte Treffer zuerst
  for (const d of debtors) {
    const w = winners.find((w) => w.amt === d.amt && d.amt > 0);
    if (w) {
      transfers.push({ from: d.id, to: w.id, amount: e(d.amt) });
      w.amt = 0;
      d.amt = 0;
    }
  }
  // 2) größte Schuld an größten offenen Gewinn
  for (const d of debtors.sort((a, b) => b.amt - a.amt)) {
    while (d.amt > 0) {
      const w = winners.filter((w) => w.amt > 0).sort((a, b) => b.amt - a.amt)[0];
      if (!w) break;
      const x = Math.min(w.amt, d.amt);
      transfers.push({ from: d.id, to: w.id, amount: e(x) });
      w.amt -= x;
      d.amt -= x;
    }
  }
  const cashPayouts = winners.filter((w) => w.amt > 0).map((w) => ({ id: w.id, amount: e(w.amt) }));

  return {
    rows,
    expectedChips: e(expectedC),
    countedChips: e(countedC),
    diff: e(diffC),
    rake: e(rakeC),
    tips: e(tipsC),
    totalIn: s.totalIn,
    cashIn: s.cashIn,
    cashBox: s.cashBox,
    cashForPlayers: e(availC),
    roundingRest: e(availC - targetC),
    transfers,
    cashPayouts,
  };
}

/** Differenz proportional zum Chipwert auf die bis zum Ende gebliebenen Spieler verteilen. */
export function proportionalAdjust(
  ids: string[],
  chips: Record<string, number>,
  diff: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (ids.length === 0) return out;
  const total = ids.reduce((a, id) => a + c(chips[id] ?? 0), 0);
  const diffC = -c(diff);
  const shares = ids.map((id) =>
    total > 0 ? (diffC * c(chips[id] ?? 0)) / total : diffC / ids.length,
  );
  // in ganzen Euro verteilen, wenn möglich (kein Kleingeld), sonst centgenau
  const step = diffC % 100 === 0 ? 100 : 1;
  const r = roundToSum(shares, step, diffC);
  ids.forEach((id, i) => (out[id] = e(r[i])));
  return out;
}

// ---------- Protokolltexte ----------

export function describeEvent(ev: GameEvent, game: Game): string {
  const name = (id: string) => game.players.find((p) => p.id === id)?.name ?? '?';
  switch (ev.type) {
    case 'game_started':
      return game.kind === 'tourney' ? 'Turnier gestartet' : 'Homegame gestartet';
    case 'game_finished':
      return game.kind === 'tourney' ? 'Turnier beendet' : 'Homegame beendet und abgerechnet';
    case 'player_added':
      return `${name(ev.playerId)} ist dem Spiel beigetreten`;
    case 'buyin':
      return `${name(ev.playerId)}: ${ev.rebuy ? 'Rebuy' : 'Buy-in'} ${fmt(ev.amount)} (${ev.paid ? 'bar' : 'angeschrieben'})`;
    case 'payment':
      return `${name(ev.playerId)}: ${fmt(ev.amount)} Angeschriebenes bar nachbezahlt`;
    case 'rake':
      return `Rake ${fmt(ev.amount)} vom Tisch genommen`;
    case 'tip':
      return `Dealer-Tip ${fmt(ev.amount)} vom Tisch genommen`;
    case 'cashout':
      return `${name(ev.playerId)}: Cash-out mit ${fmt(ev.chips)} Chips, ${fmt(ev.payoutCash)} bar ausgezahlt`;
    case 'bust': {
      const by = ev.byId ? ` (von ${name(ev.byId)})` : '';
      return ev.final ? `${name(ev.playerId)} ist ausgeschieden${by}` : `${name(ev.playerId)} wurde rausgeworfen${by} und macht Rebuy`;
    }
    case 'clock':
      return `Uhr: ${ev.action}`;
    case 'void': {
      const t = game.events.find((x) => x.id === ev.targetId);
      return `Storniert: ${t ? describeEvent(t, game) : 'Eintrag'}`;
    }
  }
}

export const isVoidable = (ev: GameEvent) =>
  ['buyin', 'payment', 'rake', 'tip', 'cashout', 'bust'].includes(ev.type);
