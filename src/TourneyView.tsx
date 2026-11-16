import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppData, Game, GameEvent, deriveState, fmt, fmtDuration, uid } from './logic';
import type { Update } from './App';
import type { TvState } from './storage';
import { Avatar, Icon, Modal, Money, fmtDate, fmtTime, useTick, useWakeLock } from './ui';
import {
  TPlayer, TourneyConfig, anteFor, clockAt, clockOps, colorUpHint, entryPrice, fmtChips, fmtClock, levelNo, nextBreakIdx,
  nextLevelIdx, seatLate, tableBalance, tourneyState, drawSeats, windowOpen, windowText,
} from './tourney';
import { LogModal } from './GameView';
import TourneySettlement from './TourneySettlement';

type DistEvent = GameEvent extends infer T ? (T extends GameEvent ? Omit<T, 'id' | 'at'> : never) : never;

// ======================================================================
// TV-Anzeige (zweiter Bildschirm / AirPlay)
// ======================================================================

export function TvScreen({ game, onHost, onToggle, onJump }: { game: Game; onHost?: () => void; onToggle?: () => void; onJump?: (d: 1 | -1) => void }) {
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
  const winner = st.players.find((p) => !p.out);

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
          {started && !finished && <span className={'tv-tag' + (rebuyOpen ? ' on' : '')}>{t.rebuy.enabled ? (rebuyOpen ? 'Rebuy offen' : 'Rebuy geschlossen') : 'Freezeout'}</span>}
          {started && !finished && t.lateReg.enabled && lateOpen && <span className="tv-tag on">Late Reg offen</span>}
          {t.bounty ? <span className="tv-tag">Bounty {fmt(t.bounty)}</span> : null}
        </span>
      </div>

      {finished ? (
        <div className="tv-main tv-center">
          <div className="tv-label">Gewinner</div>
          <div className="tv-winner">{winner?.name ?? '–'}</div>
          <div className="tv-sub">{fmt(st.prizes[0] ?? 0)} Preisgeld</div>
        </div>
      ) : !started ? (
        <div className="tv-main tv-center">
          <div className="tv-label">Gleich geht’s los</div>
          <div className="tv-blinds">Level 1 · {blinds(t.structure.find((x) => x.kind === 'level'), 1)}</div>
          <Seats game={game} />
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
      {onHost && <button className="tv-host-btn" onClick={onHost}>{Icon.user} Host</button>}
    </div>
  );
}

function Seats({ game }: { game: Game }) {
  const sg = game.seating;
  if (!sg) return null;
  const tables = [...new Set(Object.values(sg.seats).map((x) => x.table))].sort();
  const name = (id: string) => game.players.find((p) => p.id === id)?.name ?? '?';
  return (
    <div className="tv-seats">
      {tables.map((tb) => {
        const list = Object.entries(sg.seats).filter(([, v]) => v.table === tb).sort((a, b) => a[1].seat - b[1].seat);
        return (
          <div key={tb} className="tv-seat-table">
            {tables.length > 1 && <h4>Tisch {tb}</h4>}
            {list.map(([id, v]) => <div key={id}><span className="num">{v.seat}</span>{name(id)}{sg.buttons[tb] === v.seat && <i className="dealer">D</i>}</div>)}
          </div>
        );
      })}
    </div>
  );
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
  const [modal, setModal] = useState<null | { k: 'rebuy' | 'bust' | 'player'; p: TPlayer } | { k: 'add' | 'log' | 'end' }>(null);
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

  if (game.status === 'finished') {
    return <TourneySettlement game={game} update={update} onBack={onBack}
      onReopen={() => mut((g) => { g.status = 'running'; g.endedAt = null; })} />;
  }

  const cv = clockAt(t, game.clock, now);
  const clockDo = (action: string, fn: (g: Game, n: number) => void) => mut((g) => { const n = Date.now(); fn(g, n); g.events.push({ id: uid(), at: n, type: 'clock', action }); });
  const toggle = () => {
    if (!started) return start();
    clockDo(cv.running ? 'pausiert' : 'fortgesetzt', (g, n) => { g.clock = cv.running ? clockOps.pause(t, g.clock, n) : clockOps.resume(t, g.clock, n); });
  };
  const jump = (dir: 1 | -1) => {
    if (!started) return;
    const target = Math.min(t.structure.length - 1, Math.max(0, cv.idx + dir));
    const it = t.structure[target];
    clockDo(`${dir > 0 ? 'weiter' : 'zurück'} zu ${it.kind === 'break' ? 'Pause' : 'Level ' + levelNo(t.structure, target)}`, (g, n) => { g.clock = clockOps.jump(t, g.clock, n, dir); });
  };
  const addTime = (min: number) => clockDo(`${min > 0 ? '+' : '−'}${Math.abs(min)} Min`, (g, n) => { g.clock = clockOps.add(t, g.clock, n, min * 60000); });
  const start = () => mut((g) => {
    const n = Date.now();
    g.status = 'running'; g.startedAt = n; g.clock = clockOps.start(t, n);
    g.events.push({ id: uid(), at: n, type: 'game_started' });
  });

  if (tvMode) return <TvScreen game={game} onHost={() => setTvMode(false)} onToggle={toggle} onJump={jump} />;

  const item = t.structure[cv.idx];
  const isBreak = item?.kind === 'break';
  const lvl = levelNo(t.structure, cv.idx);
  const lvItem = (isBreak ? t.structure[nextLevelIdx(t.structure, cv.idx)] : item) as any;
  const rebuyOpen = windowOpen(t.rebuy, t.structure, cv.idx, started);
  const lateOpen = windowOpen(t.lateReg, t.structure, cv.idx, started);
  const alive = st.players.filter((p) => !p.out);
  const out = st.players.filter((p) => p.out).sort((a, b) => (a.place ?? 0) - (b.place ?? 0));
  const aliveIds = alive.map((p) => p.id);
  const bal = tableBalance(game.seating, aliveIds, t.tables);
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
            {bal && <div className="warn">Tische ausgleichen: Tisch {bal.from} hat {bal.counts[bal.from - 1]}, Tisch {bal.to} nur {bal.counts[bal.to - 1]} Spieler. Einen Spieler umsetzen.</div>}
            <h3>Im Turnier · {alive.length}</h3>
            {alive.length === 0 && <div className="empty">Noch keine Spieler. Füge oben über „Spieler“ jemanden hinzu.</div>}
            <div className="tlist">
              {alive.sort((a, b) => ((seat(a.id)?.table ?? 0) * 100 + (seat(a.id)?.seat ?? 0)) - ((seat(b.id)?.table ?? 0) * 100 + (seat(b.id)?.seat ?? 0))).map((p) => (
                <div className="card trow" key={p.id}>
                  <Avatar name={p.name} />
                  <div className="trow-main">
                    <b>{p.name}</b>
                    <span className="note">
                      {seat(p.id) && <>{t.tables > 1 ? `T${seat(p.id)!.table} · ` : ''}Sitz {seat(p.id)!.seat}{game.seating?.buttons[seat(p.id)!.table] === seat(p.id)!.seat && <i className="dealer sm">D</i>} · </>}
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
                <button className="btn sm" onClick={() => mut((g) => { g.seating = drawSeats(aliveIds, t.tables); })}>{Icon.shuffle} Neu losen</button>
              </div>
              <SeatList game={game} aliveIds={aliveIds} />
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
          const at = Date.now();
          const evs: GameEvent[] = [];
          if (t.bounty) evs.push({ id: uid(), at, type: 'bust', playerId: modal.p.id, byId, final: false });
          evs.push({ id: uid(), at, type: 'buyin', playerId: modal.p.id, amount: entryPrice(t), paid, rebuy: true });
          mut((g) => { g.events.push(...evs); });
          setToast({ text: `${modal.p.name}: Rebuy ${fmt(entryPrice(t))} ${paid ? 'bar' : 'angeschrieben'}`, evIds: evs.map((x) => x.id) });
          setModal(null);
        }} />}
      {modal?.k === 'bust' && <BustModal p={modal.p} t={t} place={st.alive} rebuyOpen={rebuyOpen && !maxed(modal.p)} others={alive.filter((x) => x.id !== modal.p.id)} onClose={() => setModal(null)}
        onRebuy={() => setModal({ k: 'rebuy', p: modal.p })}
        onConfirm={(byId) => {
          const ev = addEvent({ type: 'bust', playerId: modal.p.id, byId, final: true });
          setToast({ text: `${modal.p.name} ist raus (Platz ${st.alive})`, evIds: [ev.id] });
          setModal(null);
        }} />}
      {modal?.k === 'player' && <PlayerModal game={game} p={st.players.find((x) => x.id === modal.p.id)!} onClose={() => setModal(null)} mut={mut} />}
      {modal?.k === 'add' && <LateRegModal game={game} data={data} t={t} update={update} aliveIds={aliveIds} started={started} onClose={() => setModal(null)} />}
      {modal?.k === 'log' && <LogModal game={game} voided={ds.voided} onVoid={(id) => addEvent({ type: 'void', targetId: id })} onClose={() => setModal(null)} />}
      {modal?.k === 'end' && (
        <Modal title="Turnier beenden?" onClose={() => setModal(null)} footer={<>
          <button className="btn" onClick={() => setModal(null)}>Abbrechen</button>
          <button className="btn primary" onClick={() => {
            mut((g) => { const n = Date.now(); g.status = 'finished'; g.endedAt = n; g.clock = clockOps.pause(t, g.clock, n); g.events.push({ id: uid(), at: n, type: 'game_finished' }); });
            setModal(null);
          }}>{Icon.check} Beenden & abrechnen</button>
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

function SeatList({ game, aliveIds }: { game: Game; aliveIds: string[] }) {
  const sg = game.seating;
  if (!sg) return <div className="muted">Noch nicht gelost.</div>;
  const tables = [...new Set(aliveIds.map((id) => sg.seats[id]?.table).filter(Boolean) as number[])].sort();
  const name = (id: string) => game.players.find((p) => p.id === id)?.name ?? '?';
  return (
    <div className="seat-grid">
      {tables.map((tb) => (
        <div key={tb} className="seat-table">
          {tables.length > 1 && <b>Tisch {tb}</b>}
          {aliveIds.filter((id) => sg.seats[id]?.table === tb).sort((a, b) => sg.seats[a].seat - sg.seats[b].seat).map((id) => (
            <div key={id} className="seat-row"><span className="num muted">{sg.seats[id].seat}</span><span style={{ flex: 1 }}>{name(id)}</span>{sg.buttons[tb] === sg.seats[id].seat && <i className="dealer sm">D</i>}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

function PaidToggle({ paid, setPaid }: { paid: boolean; setPaid: (v: boolean) => void }) {
  return (
    <div className="seg full">
      <button className={paid ? 'on cash' : ''} onClick={() => setPaid(true)}>{Icon.cash} Bar bezahlt</button>
      <button className={!paid ? 'on open' : ''} onClick={() => setPaid(false)}>{Icon.pen} Anschreiben</button>
    </div>
  );
}

function KnockerPick({ others, by, setBy }: { others: TPlayer[]; by: string | null; setBy: (v: string) => void }) {
  return (
    <div className="section">
      <h3>Rausgeworfen von (bekommt das Bounty)</h3>
      <div className="chips-pick">
        {others.map((o) => <button key={o.id} className={'chip' + (by === o.id ? ' on' : '')} onClick={() => setBy(o.id)}>{o.name}</button>)}
      </div>
    </div>
  );
}

function EntryModal({ title, t, victim, others, onClose, onConfirm }: { title: string; t: TourneyConfig; victim: TPlayer; others: TPlayer[]; onClose: () => void; onConfirm: (paid: boolean, byId: string | null) => void }) {
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

function BustModal({ p, t, place, rebuyOpen, others, onClose, onConfirm, onRebuy }: { p: TPlayer; t: TourneyConfig; place: number; rebuyOpen: boolean; others: TPlayer[]; onClose: () => void; onConfirm: (byId: string | null) => void; onRebuy: () => void }) {
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

function PlayerModal({ game, p, onClose, mut }: { game: Game; p: TPlayer; onClose: () => void; mut: (fn: (g: Game) => void) => void }) {
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
          g.events.push({ id: uid(), at: n, type: 'buyin', playerId: p.id, amount: lastPaid.amount, paid: false, rebuy: ps.buyins[0].id !== lastPaid.id });
        })}>{Icon.pen} Letzten {fmt(lastPaid.amount)} doch anschreiben</button>}
        {p.out && p.bustId && !voided.has(p.bustId) && game.status !== 'finished' && <button className="btn" onClick={() => push({ type: 'void', targetId: p.bustId! })}>{Icon.undo} Ausscheiden rückgängig</button>}
      </div>
    </Modal>
  );
}

function LateRegModal({ game, data, t, update, aliveIds, started, onClose }: { game: Game; data: AppData; t: TourneyConfig; update: Update; aliveIds: string[]; started: boolean; onClose: () => void }) {
  const [n, setN] = useState('');
  const [paid, setPaid] = useState(true);
  const avail = data.players.filter((p) => !game.players.some((x) => x.id === p.id)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const add = (id: string, name: string, isNew: boolean) => {
    const at = Date.now();
    update((d) => {
      if (isNew) d.players.push({ id, name });
      const g = d.games.find((x) => x.id === game.id)!;
      g.players.push({ id, name });
      g.events.push({ id: uid(), at, type: 'player_added', playerId: id });
      g.events.push({ id: uid(), at, type: 'buyin', playerId: id, amount: entryPrice(t), paid });
      g.seating = seatLate(g.seating, id, aliveIds, t.tables);
    });
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
