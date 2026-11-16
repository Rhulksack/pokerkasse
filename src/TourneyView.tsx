import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppData, Game, GameEvent, deriveState, fmt, fmtDuration, uid } from './logic';
import type { Update } from './App';
import type { TvState } from './storage';
import { Avatar, Icon, Modal, Money, fmtDate, fmtTime, useTick, useWakeLock } from './ui';
import {
  TPlayer, TourneyConfig, anteFor, clockAt, clockOps, colorUpHint, entryPrice, fmtChips, fmtClock, levelNo, nextBreakIdx,
  nextLevelIdx, seatLate, tableAdvice, breakTable, maxPer, tablesInUse, tourneyState, drawSeats, windowOpen, windowText,
  balDiff, balancePlan, balanceTables, neighbors, podium, Move,
} from './tourney';
import { LogModal } from './GameView';
import TourneySettlement from './TourneySettlement';
import { tAct } from './tourneyActions';
import { RemoteCard } from './Remote';

type DistEvent = GameEvent extends infer T ? (T extends GameEvent ? Omit<T, 'id' | 'at'> : never) : never;

// ======================================================================
// TV-Anzeige (zweiter Bildschirm / AirPlay)
// ======================================================================

export interface TvHostActions { onHost?: () => void; onToggle?: () => void; onJump?: (d: 1 | -1) => void; onCloseMoves?: () => void; onEndUndo?: () => void; onEndConfirm?: () => void }

export function TvScreen({ game, onHost, onToggle, onJump, onCloseMoves, onEndUndo, onEndConfirm, viewer }: { game: Game; viewer?: boolean } & TvHostActions) {
  const now = useTick(250);
  const t = game.tourney!;
  const st = useMemo(() => tourneyState(game), [game]);
  const started = game.status !== 'created';
  const cv = clockAt(t, game.clock, now);
  const item = t.structure[cv.idx];
  const isBreak = item?.kind === 'break';
  const lvl = levelNo(t.structure, cv.idx);
  const curLevelIdx = isBreak ? nextLevelIdx(t.structure, cv.idx) : cv.idx;
  const cur = curLevelIdx >= 0 ? (t.structure[curLevelIdx] as any) : null;
  const nIdx = isBreak ? curLevelIdx : nextLevelIdx(t.structure, cv.idx);
  const nxt = nIdx >= 0 ? (t.structure[nIdx] as any) : null;
  const bIdx = nextBreakIdx(t.structure, cv.idx);
  const toBreak = bIdx >= 0 ? cv.remaining + t.structure.slice(cv.idx + 1, bIdx).reduce((a, x) => a + x.minutes * 60000, 0) : null;
  const warn = started && cv.running && cv.remaining <= 10000 && cv.remaining > 0;
  const rebuyOpen = windowOpen(t.rebuy, t.structure, cv.idx, started);
  const lateOpen = windowOpen(t.lateReg, t.structure, cv.idx, started);
  const hint = isBreak ? colorUpHint(t, cv.idx) : null;
  const finished = game.status === 'finished';
  const showPodium = finished || (started && st.alive === 1 && st.players.length >= 2);
  const ft = game.finalTable;
  const showFinal = !!ft && !ft.dismissed && started && !showPodium;
  const mv = game.moveNotice;
  const showMoves = !!mv && !mv.dismissed && started && !showPodium && !showFinal;
  // Letzte Meldung: Ausscheiden (6 s) oder Rebuy (4 s)
  const news = useMemo(() => {
    const voided = new Set(game.events.filter((e) => e.type === 'void').map((e: any) => e.targetId));
    for (let i = game.events.length - 1; i >= 0; i--) {
      const e = game.events[i];
      if (voided.has(e.id)) continue;
      if (e.type === 'bust' && e.final) return { kind: 'bust' as const, ev: e };
      if (e.type === 'buyin' && e.rebuy && !e.relabel) {
        const n = game.events.slice(0, i + 1).filter((x) => x.type === 'buyin' && x.rebuy && !x.relabel && x.playerId === e.playerId && !voided.has(x.id)).length;
        return { kind: 'rebuy' as const, ev: e, n };
      }
    }
    return null;
  }, [game.events]);
  const busy = showPodium || showFinal || showMoves;
  const bustP = news?.kind === 'bust' && now - news.ev.at < 6000 && !busy ? st.players.find((p) => p.bustId === news.ev.id) : null;
  const rebuyP = news?.kind === 'rebuy' && now - news.ev.at < 4000 && !busy ? st.players.find((p) => p.id === (news.ev as any).playerId) : null;
  const status = started && !busy ? moneyStatus(st.alive, st.prizes) : null;
  const pod = showPodium ? podium(st) : [];

  useEffect(() => {
    if (!onToggle) return;
    const h = (ev: KeyboardEvent) => {
      if (document.querySelector('.overlay')) return;
      if (ev.code === 'Space') { ev.preventDefault(); onToggle(); }
      if (ev.key === 'ArrowRight') onJump?.(1);
      if (ev.key === 'ArrowLeft') onJump?.(-1);
      if (ev.key.toLowerCase() === 'h' || ev.key === 'Escape') onHost?.();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const blinds = (x: any, n: number) => x ? <>{fmtChips(x.sb)} / {fmtChips(x.bb)}{anteFor(t, n, x.bb) ? <small> Ante {fmtChips(anteFor(t, n, x.bb))}</small> : null}</> : '–';

  return (
    <div className={'tv' + (warn ? ' alarm' : '') + (isBreak ? ' brk' : '') + (!cv.running && started && !finished ? ' paused' : '')}>
      <div className="tv-head">
        <span className="tv-name">{game.name}</span>
        <span className="tv-tags">
          {started && !showPodium && <span className={'tv-tag' + (rebuyOpen ? ' on' : '')}>{t.rebuy.enabled ? (rebuyOpen ? 'Rebuy offen' : 'Rebuy geschlossen') : 'Freezeout'}</span>}
          {started && !showPodium && t.lateReg.enabled && lateOpen && <span className="tv-tag on">Late Reg offen</span>}
          {t.bounty ? <span className="tv-tag">Bounty {fmt(t.bounty)}</span> : null}
        </span>
      </div>

      {showPodium ? (
        <div className="tv-main tv-center">
          <div className="tv-label">Turnier beendet</div>
          <div className={'podium n' + pod.length}>
            {[2, 1, 3].map((pl) => { const x = pod.find((y) => y.place === pl); return x ? (
              <div key={pl} className={'pod pod' + pl}>
                <div className="pod-name">{x.name}</div>
                <div className="pod-prize num">{fmt(x.prize)}</div>
                <div className="pod-step num">{pl}</div>
              </div>
            ) : null; })}
          </div>
          {!finished && (onEndUndo || onEndConfirm) && (
            <div className="tv-ctrl">
              {onEndUndo && <button className="btn" onClick={onEndUndo}>{Icon.undo} Fehler – Ausscheiden rückgängig</button>}
              {onEndConfirm && <button className="btn primary" onClick={onEndConfirm}>{Icon.check} Turnier beenden & abrechnen</button>}
            </div>
          )}
        </div>
      ) : !started ? (
        <div className="tv-main tv-center">
          <div className="tv-label">Gleich geht’s los</div>
          <div className="tv-blinds">Level 1 · {blinds(t.structure.find((x) => x.kind === 'level'), 1)}</div>
          <Seats game={game} />
          {!viewer && <RemoteCard gameId={game.id} tv />}
        </div>
      ) : (
        <div className="tv-main">
          <div className="tv-timer-box">
            <div className="tv-label">{isBreak ? 'Pause' : `Level ${lvl}`}{!cv.running && <span className="tv-paused"> · pausiert</span>}</div>
            <div className="tv-timer num">{fmtClock(cv.remaining)}</div>
            {!isBreak && <div className="tv-blinds num">{blinds(cur, lvl)}</div>}
            {isBreak && <div className="tv-blinds small num">Danach Level {lvl + 1}: {blinds(cur, lvl + 1)}</div>}
            {hint && <div className="tv-hint">Color-up: Chips à {hint.chips.map(fmtChips).join(', ')} werden nicht mehr gebraucht → in {fmtChips(hint.into)}er tauschen</div>}
            {isBreak && rebuyOpen && <div className="tv-hint green">Rebuy in dieser Pause noch möglich</div>}
          </div>
          <div className="tv-side">
            <div className="tv-stat big"><span>Preispool</span><b className="num">{fmt(st.prizePool)}</b></div>
            <div className="tv-stat"><span>Spieler</span><b className="num">{st.alive} / {st.players.length}</b></div>
            <div className="tv-stat"><span>Ø Stack</span><b className="num">{fmtChips(st.avgStack)}</b></div>
            <div className="tv-stat"><span>Einträge</span><b className="num">{st.entries}{st.rebuys ? <small> ({st.rebuys} Rebuy{st.rebuys > 1 ? "s" : ""})</small> : null}</b></div>
          </div>
          <div className="tv-foot">
            <div className="tv-stat"><span>Nächstes Level</span><b className="num">{nxt ? blinds(nxt, levelNo(t.structure, nIdx)) : 'Letztes Level'}</b></div>
            <div className="tv-stat"><span>Nächste Pause</span><b className="num">{toBreak != null ? `in ${fmtClock(toBreak)}` : '–'}</b></div>
            <div className="tv-stat"><span>Auszahlung</span><b className="num tv-pay">{st.prizes.map((p, i) => <span key={i}>{i + 1}. {fmt(p)}</span>)}</b></div>
          </div>
        </div>
      )}
      {status && <div className={'tv-status ' + status.tone}>{status.text}</div>}
      {rebuyP && (
        <div className="tv-bust rebuy" key={(news!.ev as any).id}>
          <span className="tv-bust-place">Rebuy</span>
          <span><b>{rebuyP.name}</b> kauft sich wieder ein{news?.kind === 'rebuy' && news.n > 1 ? ` (${news.n}.)` : ''}</span>
        </div>
      )}
      {bustP && (
        <div className="tv-bust" key={bustP.bustId!}>
          <span className="tv-bust-place num">{bustP.place}.</span>
          <span><b>{bustP.name}</b> scheidet aus{bustP.byId && t.bounty ? <> – raus durch {st.players.find((x) => x.id === bustP.byId)?.name}</> : null}</span>
          {bustP.place && bustP.place <= st.prizes.length && <span className="tv-bust-prize num">{fmt(st.prizes[bustP.place - 1])}</span>}
        </div>
      )}
      {showFinal && (
        <div className="tv-final">
          <div className="tv-final-title">Finaltisch</div>
          <div className="tv-sub">{st.alive} Spieler · neue Sitzordnung · Uhr pausiert</div>
          <Seats game={game} />
          {onToggle && <div className="tv-ctrl"><button className="btn primary" onClick={onToggle}>{Icon.play} Uhr weiterlaufen lassen</button></div>}
        </div>
      )}
      {showMoves && (
        <div className="tv-final tv-moves">
          <div className="tv-final-title sm">{mv!.title}</div>
          <MoveList game={game} moves={mv!.moves} />
          {onCloseMoves && <div className="tv-ctrl"><button className="btn primary" onClick={onCloseMoves}>{Icon.check} Erledigt – schließen</button></div>}
        </div>
      )}
      {onHost && <button className="tv-host-btn" onClick={onHost}>{Icon.user} Host</button>}
    </div>
  );
}

export function MoveList({ game, moves }: { game: Game; moves: Move[] }) {
  const st = useMemo(() => tourneyState(game), [game]);
  const sg = game.seating;
  const aliveIds = st.players.filter((p) => !p.out).map((p) => p.id);
  const name = (id: string) => st.players.find((p) => p.id === id)?.name ?? '?';
  return (
    <div className="move-list">
      {moves.filter((m) => aliveIds.includes(m.id)).map((m) => {
        const nb = sg ? neighbors(sg, aliveIds, m.id) : [];
        return (
          <div key={m.id} className="move">
            <b>{name(m.id)}</b>
            <span className="move-path">Tisch {m.from} → <em>Tisch {m.table}, Sitz {m.seat}</em></span>
            {nb.length > 0 && <span className="move-nb">{nb.length === 2 ? <>zwischen <b>{name(nb[0])}</b> und <b>{name(nb[1])}</b></> : <>neben <b>{name(nb[0])}</b></>}</span>}
          </div>
        );
      })}
    </div>
  );
}

const rTag = (n: number) => n > 0 ? <small className="rtag">R{n}</small> : null;

function Seats({ game }: { game: Game }) {
  const sg = game.seating;
  const ts = useMemo(() => tourneyState(game), [game]);
  const out = useMemo(() => new Set(ts.players.filter((p) => p.out).map((p) => p.id)), [ts]);
  const reb = (id: string) => ts.players.find((p) => p.id === id)?.rebuys ?? 0;
  if (!sg) return null;
  const alive = Object.keys(sg.seats).filter((id) => !out.has(id) && game.players.some((p) => p.id === id));
  const tables = [...new Set(alive.map((id) => sg.seats[id].table))].sort((a, b) => a - b);
  const name = (id: string) => game.players.find((p) => p.id === id)?.name ?? '?';
  return (
    <div className="tv-seats">
      {tables.map((tb) => {
        const list = alive.map((id) => [id, sg.seats[id]] as const).filter(([, v]) => v.table === tb).sort((a, b) => a[1].seat - b[1].seat);
        return (
          <div key={tb} className="tv-seat-table">
            {tables.length > 1 && <h4>Tisch {tb}</h4>}
            {list.map(([id, v]) => <div key={id}><span className="num">{v.seat}</span>{name(id)}{rTag(reb(id))}{sg.buttons[tb] === v.seat && <i className="dealer">D</i>}</div>)}
          </div>
        );
      })}
    </div>
  );
}

/** Bubble / Geldränge: was gerade auf dem Spiel steht. */
export function moneyStatus(alive: number, prizes: number[]): { text: string; tone: string } | null {
  const paid = prizes.length;
  if (alive < 2 || paid < 1) return null;
  if (alive === 2) return { text: `Heads-up – um den Sieg (${fmt(prizes[0])})${paid >= 2 ? ` · Platz 2: ${fmt(prizes[1])}` : ''}`, tone: 'gold' };
  if (alive === paid + 1) return { text: 'Bubble – der Nächste geht leer aus', tone: 'red' };
  if (alive <= paid) return { text: `Im Geld – es wird um Platz ${alive} gespielt (${fmt(prizes[alive - 1])})`, tone: 'green' };
  return null;
}

/** Reines TV-Fenster (Windows, zweiter Bildschirm). */
export function TvWindow({ gameId, data }: { gameId: string; data: AppData }) {
  const g = data.games.find((x) => x.id === gameId);
  useWakeLock(true);
  if (!g || g.kind !== 'tourney') return <div className="tv"><div className="tv-main tv-center"><div className="tv-label">Kein Turnier ausgewählt</div></div></div>;
  return <TvScreen game={g} />;
}

// ======================================================================
// Host-Ansicht
// ======================================================================

export default function TourneyView({ game, data, update, onBack }: { game: Game; data: AppData; update: Update; onBack: () => void }) {
  const now = useTick(1000);
  const t = game.tourney!;
  const st = useMemo(() => tourneyState(game), [game]);
  const ds = useMemo(() => deriveState(game), [game]);
  const [tvExt, setTvExt] = useState<TvState | null>(null);
  const [tvMode, setTvMode] = useState(true);
  const [modal, setModal] = useState<null | { k: 'rebuy' | 'bust' | 'player'; p: TPlayer } | { k: 'add' | 'log' | 'end' | 'final' | 'endcheck' | 'balance' | 'remote' }>(null);
  const [podiumView, setPodiumView] = useState(false);
  const [toast, setToast] = useState<{ text: string; evIds: string[] } | null>(null);
  const started = game.status !== 'created';
  const running = game.status === 'running';
  useWakeLock(game.status !== 'finished');

  const mut = useCallback((fn: (g: Game) => void) => update((d) => { fn(d.games.find((x) => x.id === game.id)!); }), [update, game.id]);
  const addEvent = (ev: DistEvent, g?: Game) => {
    const full = { ...ev, id: uid(), at: Date.now() } as GameEvent;
    if (g) g.events.push(full); else mut((x) => { x.events.push(full); });
    return full;
  };

  // Windows: zweiten Bildschirm erkennen und TV-Fenster dort öffnen
  useEffect(() => {
    const api = window.api;
    if (!api?.tvOpen || game.status === 'finished') return;
    api.tvOpen(game.id, true).then((s) => { setTvExt(s); if (s.open) setTvMode(false); });
    const off = api.onTvChanged?.((s) => {
      setTvExt(s);
      if (s.external && !s.open) api.tvOpen!(game.id, true).then(setTvExt);
      if (s.open) setTvMode(false);
    });
    return () => off?.();
  }, [game.id, game.status]);

  useEffect(() => { if (!toast) return; const x = setTimeout(() => setToast(null), 6000); return () => clearTimeout(x); }, [toast]);

  // Finaltisch erreicht: Host einmal fragen
  const aliveNow = st.players.filter((p) => !p.out).map((p) => p.id);
  const advice = tableAdvice(game.seating, aliveNow, maxPer(t), balDiff(t));
  const askedFinal = useRef(false);
  useEffect(() => {
    if (advice?.kind === 'final' && game.status === 'running' && !askedFinal.current) { askedFinal.current = true; setModal({ k: 'final' }); setTvMode(false); }
    if (advice?.kind !== 'final') askedFinal.current = false;
  }, [advice?.kind, game.status]);
  // Hat ein anderes Gerät (Handy) die Aktion schon erledigt, veraltete Dialoge schließen
  useEffect(() => {
    setModal((m) => {
      if (m?.k === 'final' && advice?.kind !== 'final') return null;
      if (m?.k === 'balance' && advice?.kind !== 'balance') return null;
      if (m?.k === 'endcheck' && !(game.status === 'running' && st.alive === 1)) return null;
      return m;
    });
  }, [advice?.kind, game.status, st.alive]);

  // Nur noch ein Spieler: Treppchen zeigen, Host prüft
  const endPending = game.status === 'running' && st.alive === 1 && st.players.length >= 2;
  const askedEnd = useRef(false);
  useEffect(() => {
    if (endPending && !askedEnd.current) {
      askedEnd.current = true;
      if (tvExt?.open) { setTvMode(false); setModal({ k: 'endcheck' }); } else { setModal(null); setTvMode(true); }
    }
    if (!endPending) askedEnd.current = false;
  }, [endPending]);

  if (game.status === 'finished') {
    if (podiumView) return <TvScreen game={game} onHost={() => setPodiumView(false)} />;
    return <TourneySettlement game={game} update={update} onBack={onBack} onPodium={() => setPodiumView(true)}
      onReopen={() => mut((g) => { g.status = 'running'; g.endedAt = null; })} />;
  }

  const cv = clockAt(t, game.clock, now);
  const toggle = () => mut((g) => tAct.toggle(g));
  const jump = (dir: 1 | -1) => mut((g) => tAct.jump(g, dir));
  const addTime = (min: number) => mut((g) => tAct.addTime(g, min));
  const closeMoves = () => mut((g) => tAct.closeMoves(g));
  const finish = () => mut((g) => tAct.finish(g));
  const endUndo = () => mut((g) => tAct.endUndo(g));
  if (tvMode) return <TvScreen game={game} onHost={() => setTvMode(false)} onToggle={toggle} onJump={jump} onCloseMoves={closeMoves}
    onEndUndo={endPending ? endUndo : undefined} onEndConfirm={endPending ? finish : undefined} />;

  const item = t.structure[cv.idx];
  const isBreak = item?.kind === 'break';
  const lvl = levelNo(t.structure, cv.idx);
  const lvItem = (isBreak ? t.structure[nextLevelIdx(t.structure, cv.idx)] : item) as any;
  const rebuyOpen = windowOpen(t.rebuy, t.structure, cv.idx, started);
  const lateOpen = windowOpen(t.lateReg, t.structure, cv.idx, started);
  const alive = st.players.filter((p) => !p.out);
  const out = st.players.filter((p) => p.out).sort((a, b) => (a.place ?? 0) - (b.place ?? 0));
  const aliveIds = alive.map((p) => p.id);
  const max = maxPer(t);
  const multi = tablesInUse(game.seating, aliveIds).length > 1;
  const nameOf = (id: string) => st.players.find((x) => x.id === id)?.name ?? '?';
  const finalShown = !!game.finalTable && !game.finalTable.dismissed;
  const movesShown = !!game.moveNotice && !game.moveNotice.dismissed;
  const doBreak = (table: number) => mut((g) => tAct.breakTable(g, table));
  const doBalance = () => { mut((g) => tAct.balance(g)); setModal(null); };
  const plan = advice?.kind === 'balance' ? balancePlan(game.seating, aliveIds) : [];
  const doFinal = () => { mut((g) => tAct.final(g)); setModal(null); };
  const seat = (id: string) => game.seating?.seats[id];
  const hint = isBreak ? colorUpHint(t, cv.idx) : null;
  const warn = started && cv.running && cv.remaining <= 10000;
  const maxed = (p: TPlayer) => t.rebuy.maxPerPlayer != null && p.rebuys >= t.rebuy.maxPerPlayer;
  const canAdd = !started || (t.lateReg.enabled && lateOpen);

  return (
    <div className="game tgame">
      <header className="topbar">
        <button className="btn ghost" onClick={onBack}>{Icon.back} <span className="lbl">Homegames</span></button>
        <div className="title">
          <b>{game.name}</b>
          <span>Turnier · {fmtDate(game.createdAt)} · Spielzeit {game.startedAt ? fmtDuration(now - game.startedAt) : '–'}</span>
        </div>
        <div className="spacer" />
        <div className="actions">
          {window.api?.tvOpen && (tvExt?.open
            ? <button className="btn" onClick={() => window.api!.tvClose!().then(setTvExt)}>{Icon.tv} TV-Fenster schließen</button>
            : <button className="btn" onClick={() => window.api!.tvOpen!(game.id, false).then(setTvExt)}>{Icon.tv} TV-Fenster öffnen</button>)}
          {!tvExt?.open && <button className="btn" onClick={() => setTvMode(true)}>{Icon.tv} TV-Ansicht</button>}
          <button className="btn" disabled={!canAdd} title={canAdd ? '' : 'Late Registration ist geschlossen'} onClick={() => setModal({ k: 'add' })}>{Icon.user} Spieler</button>
          <button className="btn" onClick={() => setModal({ k: 'remote' })}>{Icon.user} Handy</button>
          <button className="btn" onClick={() => setModal({ k: 'log' })}>{Icon.list} Protokoll</button>
          <button className="btn primary" disabled={!started || st.alive > 1} title={st.alive > 1 ? 'Erst möglich, wenn nur noch ein Spieler übrig ist' : ''} onClick={() => setModal({ k: 'end' })}>{Icon.flag} Turnier beenden</button>
        </div>
      </header>

      <div className="tmain">
        <section className={'card tclock' + (warn ? ' alarm' : '') + (isBreak ? ' brk' : '')}>
          <div className="tclock-top">
            <div>
              <div className="tclock-label">{!started ? 'Noch nicht gestartet' : isBreak ? 'Pause' : `Level ${lvl}`}{started && !cv.running && <span className="badge open" style={{ marginLeft: 8 }}>pausiert</span>}</div>
              <div className="tclock-time num">{fmtClock(cv.remaining)}</div>
            </div>
            <div className="tclock-blinds">
              <span>{isBreak ? `Danach Level ${lvl + 1}` : 'Blinds'}</span>
              <b className="num">{lvItem ? `${fmtChips(lvItem.sb)} / ${fmtChips(lvItem.bb)}` : '–'}</b>
              {lvItem && anteFor(t, isBreak ? lvl + 1 : lvl, lvItem.bb) > 0 && <small>BB-Ante {fmtChips(lvItem.bb)}</small>}
            </div>
          </div>
          <div className="tclock-ctrl">
            <button className="btn" disabled={!started} onClick={() => jump(-1)} title="Zurück">{Icon.prev}</button>
            <button className="btn" disabled={!started} onClick={() => addTime(-1)}>−1 Min</button>
            <button className={'btn primary lg'} onClick={toggle}>{!started ? <>{Icon.play} Turnier starten</> : cv.running ? <>{Icon.pause} Pause</> : <>{Icon.play} Weiter</>}</button>
            <button className="btn" disabled={!started} onClick={() => addTime(1)}>+1 Min</button>
            <button className="btn" disabled={!started} onClick={() => jump(1)} title="Level überspringen">{Icon.next}</button>
          </div>
          {hint && <div className="warn">Color-up: Chips à {hint.chips.map(fmtChips).join(', ')} werden ab dem nächsten Level nicht mehr gebraucht. In {fmtChips(hint.into)}er tauschen.</div>}
          <div className="row wrap-row" style={{ gap: 8 }}>
            <span className={'badge ' + (rebuyOpen ? 'cash' : 'neutral')}>{rebuyOpen ? 'Rebuy offen' : t.rebuy.enabled ? 'Rebuy geschlossen' : 'Kein Rebuy'}</span>
            <span className={'badge ' + (lateOpen ? 'cash' : 'neutral')}>{lateOpen ? 'Late Reg offen' : t.lateReg.enabled ? 'Late Reg geschlossen' : 'Keine Late Reg'}</span>
            <span className="note">{windowText(t.rebuy, 'Rebuy')} · {windowText(t.lateReg, 'Late Reg')}</span>
            {started && moneyStatus(st.alive, st.prizes) && <span className={'badge ' + (moneyStatus(st.alive, st.prizes)!.tone === 'red' ? 'loss' : 'cash')}>{moneyStatus(st.alive, st.prizes)!.text}</span>}
          </div>
        </section>

        <section className="kpis tkpis">
          <div className="card kpi total"><div className="label"><span className="ic">{Icon.trophy}</span>Preispool</div><div className="value">{fmt(st.prizePool)}</div><div className="sub">{st.entries} Einträge à {fmt(t.buyIn)}{t.bounty ? ` · Bounties ${fmt(st.bountyPool)}` : ''}</div></div>
          <div className="card kpi cash"><div className="label"><span className="ic">{Icon.cash}</span>Bargeld in der Kasse</div><div className="value">{fmt(ds.cashBox)}</div><div className="sub">von {fmt(ds.totalIn)} gesamt</div></div>
          <div className="card kpi open"><div className="label"><span className="ic">{Icon.pen}</span>Angeschrieben</div><div className={'value' + (ds.open > 0 ? ' has' : '')}>{fmt(ds.open)}</div><div className="sub">{st.players.filter((p) => p.open > 0).length} Spieler offen</div></div>
          <div className="card kpi rake"><div className="label"><span className="ic">{Icon.users}</span>Spieler übrig</div><div className="value">{st.alive}<span className="muted" style={{ fontSize: 18, fontWeight: 600 }}> / {st.players.length}</span></div><div className="sub">Ø Stack {fmtChips(st.avgStack)}</div></div>
        </section>

        <div className="tcols">
          <div className="tplayers">
            {!started && <RemoteCard gameId={game.id} />}
            {advice?.kind === 'final' && <div className="warn row wrap-row">Finaltisch: nur noch {aliveIds.length} Spieler, alle passen an einen Tisch.<div className="spacer" /><button className="btn sm" onClick={() => setModal({ k: 'final' })}>{Icon.shuffle} Finaltisch losen</button></div>}
            {advice?.kind === 'break' && <div className="warn row wrap-row">Tisch {advice.table} auflösen: {advice.count} Spieler passen an die übrigen Tische.<div className="spacer" /><button className="btn sm" onClick={() => doBreak(advice.table)}>{Icon.shuffle} Auflösen & verteilen</button></div>}
            {advice?.kind === 'balance' && <div className="warn row wrap-row">Tische ausgleichen: Tisch {advice.from} hat {advice.fromCount}, Tisch {advice.to} nur {advice.toCount} Spieler.<div className="spacer" /><button className="btn sm" onClick={() => setModal({ k: 'balance' })}>{Icon.shuffle} Ausgleichen</button></div>}
            {finalShown && <div className="note">Finaltisch-Screen läuft am TV. Die Uhr ist pausiert – sobald du sie weiterlaufen lässt, verschwindet er.</div>}
            {movesShown && !finalShown && (
              <div className="card move-card">
                <div className="row"><b>{game.moveNotice!.title} – läuft am TV</b><div className="spacer" /><button className="btn sm primary" onClick={closeMoves}>{Icon.check} Am TV schließen</button></div>
                <MoveList game={game} moves={game.moveNotice!.moves} />
              </div>
            )}
            {endPending && <div className="warn row wrap-row">Nur noch {alive[0]?.name} übrig – am TV steht das Treppchen.<div className="spacer" /><button className="btn sm" onClick={endUndo}>{Icon.undo} Fehler – rückgängig</button><button className="btn sm primary" onClick={finish}>{Icon.check} Beenden & abrechnen</button></div>}
            <h3>Im Turnier · {alive.length}</h3>
            {alive.length === 0 && <div className="empty">Noch keine Spieler. Füge oben über „Spieler“ jemanden hinzu.</div>}
            <div className="tlist">
              {alive.sort((a, b) => ((seat(a.id)?.table ?? 0) * 100 + (seat(a.id)?.seat ?? 0)) - ((seat(b.id)?.table ?? 0) * 100 + (seat(b.id)?.seat ?? 0))).map((p) => (
                <div className="card trow" key={p.id}>
                  <Avatar name={p.name} />
                  <div className="trow-main">
                    <b>{p.name}</b>
                    <span className="note">
                      {seat(p.id) && <>{multi ? `T${seat(p.id)!.table} · ` : ''}Sitz {seat(p.id)!.seat}{game.seating?.buttons[seat(p.id)!.table] === seat(p.id)!.seat && <i className="dealer sm">D</i>} · </>}
                      {p.rebuys ? `${p.rebuys} Rebuy${p.rebuys > 1 ? 's' : ''}` : 'Buy-in'} · <span className="paid">{fmt(p.paidCash)} bar</span>{p.open > 0 && <> · <span className="openc">{fmt(p.open)} offen</span></>}
                      {t.bounty && p.bounties ? ` · ${p.bounties} Bounty` : ''}
                    </span>
                  </div>
                  <div className="trow-act">
                    {started && rebuyOpen && <button className="btn sm" disabled={maxed(p)} title={maxed(p) ? 'Maximale Rebuys erreicht' : ''} onClick={() => setModal({ k: 'rebuy', p })}>{Icon.plus} Rebuy</button>}
                    {started && <button className="btn sm danger" onClick={() => setModal({ k: 'bust', p })}>{Icon.skull} Raus</button>}
                    <button className="btn sm ghost" onClick={() => setModal({ k: 'player', p })} title="Details">{Icon.dots}</button>
                  </div>
                </div>
              ))}
            </div>
            {out.length > 0 && <>
              <h3 style={{ marginTop: 18 }}>Ausgeschieden · {out.length}</h3>
              <div className="tlist">
                {out.map((p) => (
                  <div className="card trow out" key={p.id}>
                    <span className="place num">{p.place}.</span>
                    <div className="trow-main">
                      <b>{p.name}</b>
                      <span className="note">{p.byId ? `raus durch ${st.players.find((x) => x.id === p.byId)?.name}` : 'ausgeschieden'}{p.open > 0 && <> · <span className="openc">{fmt(p.open)} offen</span></>}</span>
                    </div>
                    <div className="trow-act"><button className="btn sm ghost" onClick={() => setModal({ k: 'player', p })}>{Icon.dots}</button></div>
                  </div>
                ))}
              </div>
            </>}
          </div>

          <aside className="tside">
            <div className="card pay-list">
              <h3>Auszahlung</h3>
              {st.prizes.map((p, i) => (
                <div className="pay" key={i}><span className="place num">{i + 1}.</span><span style={{ flex: 1 }}>{t.payouts[i]} %</span><b className="pos">{fmt(p)}</b></div>
              ))}
              {st.prizeRest > 0 && <div className="note">Rundungsrest {fmt(st.prizeRest)} bleibt in der Kasse.</div>}
            </div>
            <div className="card pay-list">
              <div className="row"><h3>Sitzplätze</h3><div className="spacer" />
                <button className="btn sm" onClick={() => mut((g) => tAct.redraw(g))}>{Icon.shuffle} Neu losen</button>
              </div>
              <SeatList game={game} aliveIds={aliveIds} rebuys={(id) => st.players.find((x) => x.id === id)?.rebuys ?? 0} />
            </div>
            <div className="card pay-list">
              <h3>Struktur</h3>
              <div className="struct-mini">
                {t.structure.map((x, i) => (
                  <div key={i} className={i === cv.idx && started ? 'on' : i < cv.idx && started ? 'past' : ''}>
                    {x.kind === 'break' ? <span>Pause</span> : <span>L{levelNo(t.structure, i)}</span>}
                    <span className="num">{x.kind === 'level' ? `${fmtChips(x.sb)}/${fmtChips(x.bb)}${anteFor(t, levelNo(t.structure, i), x.bb) ? ' A' : ''}` : ''}</span>
                    <span className="num muted">{x.minutes}′</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>

      {modal?.k === 'rebuy' && <EntryModal title={`Rebuy: ${modal.p.name}`} t={t} victim={modal.p} others={alive.filter((x) => x.id !== modal.p.id)} onClose={() => setModal(null)}
        onConfirm={(paid, byId) => {
          let ids: string[] = [];
          mut((g) => { ids = tAct.rebuy(g, modal.p.id, paid, byId); });
          setToast({ text: `${modal.p.name}: Rebuy ${fmt(entryPrice(t))} ${paid ? 'bar' : 'angeschrieben'}`, evIds: ids });
          setModal(null);
        }} />}
      {modal?.k === 'bust' && <BustModal p={modal.p} t={t} place={st.alive} rebuyOpen={rebuyOpen && !maxed(modal.p)} others={alive.filter((x) => x.id !== modal.p.id)} onClose={() => setModal(null)}
        onRebuy={() => setModal({ k: 'rebuy', p: modal.p })}
        onConfirm={(byId) => {
          const last = st.alive === 2;
          let ids: string[] = [];
          mut((g) => { ids = tAct.bust(g, modal.p.id, byId).ids; });
          if (!last) setToast({ text: `${modal.p.name} ist raus (Platz ${st.alive})`, evIds: ids });
          setModal(null);
        }} />}
      {modal?.k === 'player' && <PlayerModal game={game} p={st.players.find((x) => x.id === modal.p.id)!} onClose={() => setModal(null)} mut={mut} />}
      {modal?.k === 'add' && <LateRegModal game={game} data={data} t={t} update={update} aliveIds={aliveIds} started={started} onClose={() => setModal(null)} />}
      {modal?.k === 'log' && <LogModal game={game} voided={ds.voided} onVoid={(id) => addEvent({ type: 'void', targetId: id })} onClose={() => setModal(null)} />}
      {modal?.k === 'final' && (
        <Modal title="Finaltisch" onClose={() => setModal(null)} footer={<>
          <button className="btn" onClick={() => setModal(null)}>Später</button>
          <button className="btn primary" onClick={doFinal}>{Icon.shuffle} Finaltisch losen</button>
        </>}>
          <p className="muted" style={{ margin: 0 }}>Nur noch {aliveIds.length} Spieler – alle passen an einen Tisch (max. {max}). Sitzplätze und Dealer-Button werden neu ausgelost, die Uhr pausiert und am TV erscheint „Finaltisch“ mit der neuen Sitzordnung – bis du die Uhr weiterlaufen lässt.</p>
        </Modal>
      )}
      {modal?.k === 'remote' && <Modal title="Mit dem Handy steuern" wide onClose={() => setModal(null)} footer={<button className="btn" onClick={() => setModal(null)}>Schließen</button>}><RemoteCard gameId={game.id} /></Modal>}
      {modal?.k === 'balance' && (
        <Modal title="Tische ausgleichen" onClose={() => setModal(null)} footer={<>
          <button className="btn" onClick={() => setModal(null)}>Abbrechen</button>
          <button className="btn primary" onClick={doBalance}>{Icon.shuffle} Jetzt ausgleichen</button>
        </>}>
          <p className="muted" style={{ margin: 0 }}>
            {[...new Set(plan.map((x) => `${x.from}→${x.to}`))].map((k) => { const [f, to] = k.split('→'); const n = plan.filter((x) => `${x.from}→${x.to}` === k).length; return `${n} Spieler von Tisch ${f} an Tisch ${to}`; }).join(', ')} – zufällig ausgewählt, auf zufällige freie Plätze. Am TV erscheint, wer wohin muss, bis du die Anzeige schließt.
          </p>
        </Modal>
      )}
      {modal?.k === 'endcheck' && (
        <Modal title="Turnier vorbei?" onClose={() => setModal(null)} footer={<>
          <button className="btn" onClick={() => { endUndo(); setModal(null); }}>{Icon.undo} Fehler – Ausscheiden rückgängig</button>
          <button className="btn primary" onClick={() => { finish(); setModal(null); }}>{Icon.check} Beenden & abrechnen</button>
        </>}>
          <p className="muted" style={{ margin: 0 }}>Nur noch {alive[0]?.name} ist übrig. Am TV steht das Treppchen, die Uhr ist pausiert. War das letzte Ausscheiden ein Fehler, wird es rückgängig gemacht und die Uhr läuft weiter.</p>
        </Modal>
      )}
      {modal?.k === 'end' && (
        <Modal title="Turnier beenden?" onClose={() => setModal(null)} footer={<>
          <button className="btn" onClick={() => setModal(null)}>Abbrechen</button>
          <button className="btn primary" onClick={() => { finish(); setModal(null); }}>{Icon.check} Beenden & abrechnen</button>
        </>}>
          <p className="muted" style={{ margin: 0 }}>{alive[0] ? `${alive[0].name} gewinnt das Turnier. ` : ''}Die Spielzeit stoppt und die Abrechnung mit Preisgeldern{t.bounty ? ' und Bounties' : ''} wird erstellt.</p>
        </Modal>
      )}
      {toast && (
        <div className="toast">
          <span>{toast.text}</span>
          {toast.evIds.length > 0 && <button className="btn sm" onClick={() => { mut((g) => { for (const id of toast.evIds) addEvent({ type: 'void', targetId: id }, g); }); setToast(null); }}>{Icon.undo} Rückgängig</button>}
        </div>
      )}
    </div>
  );
}

function SeatList({ game, aliveIds, rebuys }: { game: Game; aliveIds: string[]; rebuys: (id: string) => number }) {
  const sg = game.seating;
  if (!sg) return <div className="muted">Noch nicht gelost.</div>;
  const tables = [...new Set(aliveIds.map((id) => sg.seats[id]?.table).filter(Boolean) as number[])].sort((a, b) => a - b);
  const name = (id: string) => game.players.find((p) => p.id === id)?.name ?? '?';
  return (
    <div className="seat-grid">
      {tables.map((tb) => (
        <div key={tb} className="seat-table">
          {tables.length > 1 && <b>Tisch {tb}</b>}
          {aliveIds.filter((id) => sg.seats[id]?.table === tb).sort((a, b) => sg.seats[a].seat - sg.seats[b].seat).map((id) => (
            <div key={id} className="seat-row"><span className="num muted">{sg.seats[id].seat}</span><span style={{ flex: 1 }}>{name(id)}{rTag(rebuys(id))}</span>{sg.buttons[tb] === sg.seats[id].seat && <i className="dealer sm">D</i>}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function PaidToggle({ paid, setPaid }: { paid: boolean; setPaid: (v: boolean) => void }) {
  return (
    <div className="seg full">
      <button className={paid ? 'on cash' : ''} onClick={() => setPaid(true)}>{Icon.cash} Bar bezahlt</button>
      <button className={!paid ? 'on open' : ''} onClick={() => setPaid(false)}>{Icon.pen} Anschreiben</button>
    </div>
  );
}

export function KnockerPick({ others, by, setBy }: { others: TPlayer[]; by: string | null; setBy: (v: string) => void }) {
  return (
    <div className="section">
      <h3>Rausgeworfen von (bekommt das Bounty)</h3>
      <div className="chips-pick">
        {others.map((o) => <button key={o.id} className={'chip' + (by === o.id ? ' on' : '')} onClick={() => setBy(o.id)}>{o.name}</button>)}
      </div>
    </div>
  );
}

export function EntryModal({ title, t, victim, others, onClose, onConfirm }: { title: string; t: TourneyConfig; victim: TPlayer; others: TPlayer[]; onClose: () => void; onConfirm: (paid: boolean, byId: string | null) => void }) {
  const [paid, setPaid] = useState(true);
  const [by, setBy] = useState<string | null>(null);
  const need = !!t.bounty && others.length > 0;
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Abbrechen</button>
      <button className="btn primary" disabled={need && !by} onClick={() => onConfirm(paid, by)}>{Icon.check} Rebuy {fmt(entryPrice(t))} buchen</button>
    </>}>
      <div className="calc">
        <div className="l"><span>Rebuy-Preis</span><b>{fmt(entryPrice(t))}{t.bounty ? <span className="muted"> ({fmt(t.buyIn)} Pool + {fmt(t.bounty)} Bounty)</span> : null}</b></div>
        <div className="l"><span>{victim.name} bekommt</span><b>{fmtChips(t.rebuyChips)} Chips</b></div>
        {t.rebuy.maxPerPlayer != null && <div className="l"><span>Rebuys bisher</span><span>{victim.rebuys} von {t.rebuy.maxPerPlayer}</span></div>}
      </div>
      <PaidToggle paid={paid} setPaid={setPaid} />
      {need && <KnockerPick others={others} by={by} setBy={setBy} />}
    </Modal>
  );
}

export function BustModal({ p, t, place, rebuyOpen, others, onClose, onConfirm, onRebuy }: { p: TPlayer; t: TourneyConfig; place: number; rebuyOpen: boolean; others: TPlayer[]; onClose: () => void; onConfirm: (byId: string | null) => void; onRebuy: () => void }) {
  const [by, setBy] = useState<string | null>(null);
  const need = !!t.bounty && others.length > 0;
  return (
    <Modal title={`${p.name} scheidet aus`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Abbrechen</button>
      <button className="btn primary" disabled={need && !by} onClick={() => onConfirm(by)}>{Icon.skull} Ausscheiden (Platz {place})</button>
    </>}>
      {rebuyOpen && <div className="warn">Rebuy ist gerade noch möglich. <button className="btn sm" style={{ marginLeft: 8 }} onClick={onRebuy}>Stattdessen Rebuy</button></div>}
      <p className="muted" style={{ margin: 0 }}>{p.name} belegt Platz {place}. {others.length === 1 ? `${others[0].name} gewinnt damit das Turnier.` : ''}</p>
      {need && <KnockerPick others={others} by={by} setBy={setBy} />}
    </Modal>
  );
}

export function PlayerModal({ game, p, onClose, mut }: { game: Game; p: TPlayer; onClose: () => void; mut: (fn: (g: Game) => void) => void }) {
  const s = deriveState(game);
  const ps = s.players.find((x) => x.id === p.id)!;
  const lastPaid = [...ps.buyins].reverse().find((b) => b.paid);
  const voided = s.voided;
  const push = (ev: DistEvent) => mut((g) => { g.events.push({ ...ev, id: uid(), at: Date.now() } as GameEvent); });
  return (
    <Modal title={p.name} onClose={onClose} footer={<button className="btn" onClick={onClose}>Schließen</button>}>
      <div className="stats3">
        <div><span>Eingezahlt</span><b>{fmt(ps.totalIn)}</b></div>
        <div><span>Davon bar</span><b className="paid">{fmt(ps.paidCash)}</b></div>
        <div><span>Davon offen</span><b className={ps.open > 0 ? 'openc' : 'faint'}>{fmt(ps.open)}</b></div>
      </div>
      <div className="history">
        {ps.buyins.map((b, i) => (
          <div className="h" key={b.id}><span className="t">{fmtTime(b.at)}</span><span style={{ flex: 1 }}>{i === 0 ? 'Buy-in' : 'Rebuy'}</span><b className="num">{fmt(b.amount)}</b><span className={'badge ' + (b.paid ? 'cash' : 'open')}>{b.paid ? 'bar' : 'angeschrieben'}</span></div>
        ))}
      </div>
      <div className="row wrap-row">
        {ps.open > 0 && <button className="btn primary" onClick={() => push({ type: 'payment', playerId: p.id, amount: ps.open })}>{Icon.check} {fmt(ps.open)} bar erhalten</button>}
        {lastPaid && game.status !== 'finished' && <button className="btn" onClick={() => mut((g) => {
          const n = Date.now();
          g.events.push({ id: uid(), at: n, type: 'void', targetId: lastPaid.id });
          g.events.push({ id: uid(), at: n, type: 'buyin', playerId: p.id, amount: lastPaid.amount, paid: false, rebuy: ps.buyins[0].id !== lastPaid.id, relabel: true });
        })}>{Icon.pen} Letzten {fmt(lastPaid.amount)} doch anschreiben</button>}
        {p.out && p.bustId && !voided.has(p.bustId) && game.status !== 'finished' && <button className="btn" onClick={() => push({ type: 'void', targetId: p.bustId! })}>{Icon.undo} Ausscheiden rückgängig</button>}
      </div>
    </Modal>
  );
}

export function LateRegModal({ game, data, t, update, aliveIds, started, onClose }: { game: Game; data: AppData; t: TourneyConfig; update: Update; aliveIds: string[]; started: boolean; onClose: () => void }) {
  const [n, setN] = useState('');
  const [paid, setPaid] = useState(true);
  const avail = data.players.filter((p) => !game.players.some((x) => x.id === p.id)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const add = (id: string, name: string, isNew: boolean) => {
    update((d) => { tAct.addPlayer(d, d.games.find((x) => x.id === game.id)!, id, name, paid); });
  };
  const addNew = () => {
    const name = n.trim();
    if (!name) return;
    const ex = data.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (ex && game.players.some((x) => x.id === ex.id)) return;
    if (ex) add(ex.id, ex.name, false); else add(uid(), name, true);
    setN('');
  };
  return (
    <Modal title={started ? 'Late Registration' : 'Spieler hinzufügen'} onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Fertig</button>}>
      <div className="note">Jeder neue Spieler zahlt {fmt(entryPrice(t))} und bekommt {fmtChips(t.startChips)} Chips. Er wird automatisch an den Tisch mit den wenigsten Spielern gesetzt.</div>
      <PaidToggle paid={paid} setPaid={setPaid} />
      {avail.length > 0 && (
        <div className="section">
          <h3>Aus der Spielerliste</h3>
          <div className="chips-pick">{avail.map((p) => <button key={p.id} className="chip" onClick={() => add(p.id, p.name, false)}>{Icon.plus}{p.name}</button>)}</div>
        </div>
      )}
      <div className="section">
        <h3>Neuer Name</h3>
        <div className="row">
          <input className="input" placeholder="Name" value={n} onChange={(e) => setN(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNew()} />
          <button className="btn" onClick={addNew} disabled={!n.trim()}>{Icon.plus} Hinzufügen</button>
        </div>
      </div>
      <div className="note">Im Turnier: {game.players.map((p) => p.name).join(', ') || 'noch niemand'}</div>
    </Modal>
  );
}
