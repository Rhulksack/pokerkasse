// Fernsteuerung: Das Handy öffnet die Web-App mit #remote=<Spiel>, meldet sich als Admin an
// und steuert das laufende Turnier über die Cloud – zeitgleich mit dem Laptop.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { AppData, Game, fmt } from './logic';
import type { Update } from './App';
import { PUBLIC_URL, isAdminRole, logout, useSession, useSyncedData } from './cloud';
import { LoginScreen } from './Auth';
import { Icon, Modal, useTick } from './ui';
import {
  TPlayer, anteFor, balDiff, balancePlan, clockAt, colorUpHint, entryPrice, fmtChips, fmtClock, levelNo, maxPer,
  nextLevelIdx, podium, tableAdvice, tablesInUse, tourneyState, windowOpen,
} from './tourney';
import { BustModal, EntryModal, LateRegModal, MoveList, PlayerModal, moneyStatus } from './TourneyView';
import { tAct } from './tourneyActions';

// ---------------------------------------------------------------- Laptop-Seite: QR-Code

export const remoteUrl = (gameId: string) => `${PUBLIC_URL}#remote=${encodeURIComponent(gameId)}`;

export function QrCode({ text, size = 220 }: { text: string; size?: number }) {
  const [src, setSrc] = useState('');
  useEffect(() => { QRCode.toDataURL(text, { margin: 1, width: size * 2, color: { dark: '#000000', light: '#ffffff' } }).then(setSrc).catch(() => setSrc('')); }, [text, size]);
  return src ? <img className="qr" src={src} width={size} height={size} alt="QR-Code zur Fernsteuerung" /> : <div className="qr" style={{ width: size, height: size }} />;
}

/** Karte mit QR-Code (Host-Ansicht und TV vor dem Start). */
export function RemoteCard({ gameId, tv }: { gameId: string; tv?: boolean }) {
  const url = remoteUrl(gameId);
  if (tv) return (
    <div className="tv-remote">
      <QrCode text={url} size={170} />
      <div><b>Host-Handy verbinden</b><span>QR-Code scannen, mit Admin-Konto anmelden</span></div>
    </div>
  );
  return (
    <div className="card remote-card">
      <QrCode text={url} size={170} />
      <div className="remote-txt">
        <h3>Mit dem Handy steuern</h3>
        <p className="muted">QR-Code mit der Kamera scannen und mit einem Admin-Konto anmelden. Läuft über die Cloud, also per WLAN oder mobilen Daten. Laptop und Handy können gleichzeitig bedienen.</p>
        <code>{url}</code>
        <p className="note">Tipp: Am iPhone die automatische Sperre für den Abend auf „Nie“ stellen (Einstellungen → Anzeige & Helligkeit), sonst geht das Display aus.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Handy-Seite

export function RemoteApp({ gameId }: { gameId: string }) {
  const s = useSession();
  if (s === undefined) return <div className="rm"><div className="rm-empty">Lade …</div></div>;
  if (s === null) return <LoginScreen />;
  if (!isAdminRole(s.role)) return (
    <div className="rm"><div className="rm-empty">
      Die Fernsteuerung ist nur für Admins. Angemeldet als {s.profile.username}.
      <div style={{ marginTop: 16 }}><button className="btn" onClick={() => { location.hash = ''; location.reload(); }}>Zur Übersicht</button> <button className="btn ghost" onClick={logout}>Abmelden</button></div>
    </div></div>
  );
  return <RemoteCloud gameId={gameId} />;
}

function RemoteCloud({ gameId }: { gameId: string }) {
  const [err, setErr] = useState('');
  const notify = useCallback((m: string) => setErr(m), []);
  useEffect(() => { if (!err) return; const t = setTimeout(() => setErr(''), 6000); return () => clearTimeout(t); }, [err]);
  const { data, update, sync } = useSyncedData(true, notify);
  if (!data) return <div className="rm"><div className="rm-empty">{sync.error || 'Verbinde mit der Cloud …'}</div></div>;
  const g = data.games.find((x) => x.id === gameId);
  if (!g || g.kind !== 'tourney') return <div className="rm"><div className="rm-empty">Turnier nicht gefunden. QR-Code am Laptop neu scannen.</div></div>;
  return <RemoteView game={g} data={data} update={update} online={sync.online} err={err || (sync.online ? '' : 'Offline – Eingaben werden gesendet, sobald wieder Netz da ist.')} />;
}

function RemoteView({ game, data, update, online, err }: { game: Game; data: AppData; update: Update; online: boolean; err: string }) {
  const now = useTick(500);
  const t = game.tourney!;
  const st = useMemo(() => tourneyState(game), [game]);
  const mut = useCallback((fn: (g: Game) => void) => update((d) => { fn(d.games.find((x) => x.id === game.id)!); }), [update, game.id]);
  const [modal, setModal] = useState<null | { k: 'rebuy' | 'bust' | 'player'; p: TPlayer } | { k: 'add' | 'final' | 'balance' }>(null);
  const [toast, setToast] = useState<{ text: string; ids: string[] } | null>(null);
  const [showOut, setShowOut] = useState(false);
  useEffect(() => { if (!toast) return; const x = setTimeout(() => setToast(null), 6000); return () => clearTimeout(x); }, [toast]);

  const started = game.status !== 'created';
  const finished = game.status === 'finished';
  const cv = clockAt(t, game.clock, now);
  const item = t.structure[cv.idx];
  const isBreak = item?.kind === 'break';
  const lvl = levelNo(t.structure, cv.idx);
  const lvItem = (isBreak ? t.structure[nextLevelIdx(t.structure, cv.idx)] : item) as any;
  const rebuyOpen = windowOpen(t.rebuy, t.structure, cv.idx, started);
  const lateOpen = windowOpen(t.lateReg, t.structure, cv.idx, started);
  const canAdd = !started || (t.lateReg.enabled && lateOpen);
  const alive = st.players.filter((p) => !p.out);
  const out = st.players.filter((p) => p.out).sort((a, b) => (a.place ?? 0) - (b.place ?? 0));
  const aliveIds = alive.map((p) => p.id);
  const max = maxPer(t);
  const multi = tablesInUse(game.seating, aliveIds).length > 1;
  const advice = tableAdvice(game.seating, aliveIds, max, balDiff(t));
  const plan = advice?.kind === 'balance' ? balancePlan(game.seating, aliveIds) : [];
  const endPending = game.status === 'running' && st.alive === 1 && st.players.length >= 2;
  const finalShown = !!game.finalTable && !game.finalTable.dismissed && !endPending;
  const movesShown = !!game.moveNotice && !game.moveNotice.dismissed && !finalShown && !endPending;
  const money = started && !finished && !endPending ? moneyStatus(st.alive, st.prizes) : null;
  const hint = isBreak ? colorUpHint(t, cv.idx) : null;
  const warn = started && cv.running && cv.remaining <= 10000;
  const maxed = (p: TPlayer) => t.rebuy.maxPerPlayer != null && p.rebuys >= t.rebuy.maxPerPlayer;
  const seat = (id: string) => game.seating?.seats[id];
  const sortKey = (id: string) => (seat(id)?.table ?? 0) * 100 + (seat(id)?.seat ?? 0);

  // Finaltisch erreicht: einmal nachfragen (wie am Laptop)
  const askedFinal = useRef(false);
  useEffect(() => {
    if (advice?.kind === 'final' && game.status === 'running' && !askedFinal.current) { askedFinal.current = true; setModal({ k: 'final' }); }
    if (advice?.kind !== 'final') askedFinal.current = false;
  }, [advice?.kind, game.status]);
  // Am Laptop schon erledigt: veraltete Dialoge schließen
  useEffect(() => {
    setModal((m) => (m?.k === 'final' && advice?.kind !== 'final') || (m?.k === 'balance' && advice?.kind !== 'balance') ? null : m);
  }, [advice?.kind]);

  if (finished) {
    const pod = podium(st);
    return (
      <div className="rm">
        <RmHead game={game} online={online} sub="Turnier beendet" />
        <div className="rm-card rm-center">
          <div className="rm-label">Ergebnis</div>
          {pod.map((x) => <div key={x.place} className="rm-pod"><span className="num">{x.place}.</span><b>{x.name}</b><span className="pos num">{fmt(x.prize)}</span></div>)}
          <p className="muted">Die Abrechnung findest du am Laptop.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rm">
      <RmHead game={game} online={online} sub={`${st.alive} / ${st.players.length} Spieler · Pool ${fmt(st.prizePool)}`} />
      {err && <div className="rm-alert red">{err}</div>}

      <section className={'rm-card rm-clock' + (warn ? ' alarm' : '') + (isBreak ? ' brk' : '')}>
        <div className="rm-clock-top">
          <span className="rm-label">{!started ? 'Noch nicht gestartet' : isBreak ? 'Pause' : `Level ${lvl}`}{started && !cv.running && <span className="badge open" style={{ marginLeft: 8 }}>pausiert</span>}</span>
          <span className="rm-blinds num">{lvItem ? `${fmtChips(lvItem.sb)} / ${fmtChips(lvItem.bb)}` : '–'}{lvItem && anteFor(t, isBreak ? lvl + 1 : lvl, lvItem.bb) > 0 ? <small> Ante</small> : null}</span>
        </div>
        <div className="rm-time num">{fmtClock(cv.remaining)}</div>
        {isBreak && <div className="note">Danach Level {lvl + 1}</div>}
        <button className={'btn lg rm-main ' + (!started || !cv.running ? 'primary' : '')} onClick={() => mut((g) => tAct.toggle(g))}>
          {!started ? <>{Icon.play} Turnier starten</> : cv.running ? <>{Icon.pause} Uhr anhalten</> : <>{Icon.play} Weiter</>}
        </button>
        {started && (
          <div className="rm-ctrl">
            <button className="btn" onClick={() => mut((g) => tAct.jump(g, -1))} aria-label="Zurück">{Icon.prev}</button>
            <button className="btn" onClick={() => mut((g) => tAct.addTime(g, -1))}>−1 Min</button>
            <button className="btn" onClick={() => mut((g) => tAct.addTime(g, 1))}>+1 Min</button>
            <button className="btn" onClick={() => mut((g) => tAct.jump(g, 1))} aria-label="Weiter">{Icon.next}</button>
          </div>
        )}
        <div className="rm-badges">
          <span className={'badge ' + (rebuyOpen ? 'cash' : 'neutral')}>{rebuyOpen ? 'Rebuy offen' : t.rebuy.enabled ? 'Rebuy zu' : 'Freezeout'}</span>
          {t.lateReg.enabled && <span className={'badge ' + (lateOpen ? 'cash' : 'neutral')}>{lateOpen ? 'Late Reg offen' : 'Late Reg zu'}</span>}
          {money && <span className={'badge ' + (money.tone === 'red' ? 'loss' : 'cash')}>{money.text}</span>}
        </div>
        {hint && <div className="note">Color-up: {hint.chips.map(fmtChips).join(', ')} → {fmtChips(hint.into)}er</div>}
      </section>

      {endPending && (
        <div className="rm-alert gold">
          <b>Nur noch {alive[0]?.name} übrig – am TV steht das Treppchen.</b>
          <div className="rm-btns">
            <button className="btn" onClick={() => mut((g) => tAct.endUndo(g))}>{Icon.undo} Fehler – rückgängig</button>
            <button className="btn primary" onClick={() => mut((g) => tAct.finish(g))}>{Icon.check} Turnier beenden</button>
          </div>
        </div>
      )}
      {!endPending && advice?.kind === 'final' && <div className="rm-alert"><span>Finaltisch: alle {aliveIds.length} passen an einen Tisch.</span><button className="btn primary" onClick={() => setModal({ k: 'final' })}>{Icon.shuffle} Finaltisch losen</button></div>}
      {advice?.kind === 'break' && <div className="rm-alert"><span>Tisch {advice.table} auflösen ({advice.count} Spieler).</span><button className="btn primary" onClick={() => mut((g) => tAct.breakTable(g, advice.table))}>{Icon.shuffle} Auflösen & verteilen</button></div>}
      {advice?.kind === 'balance' && <div className="rm-alert"><span>Tisch {advice.from}: {advice.fromCount}, Tisch {advice.to}: {advice.toCount} Spieler.</span><button className="btn primary" onClick={() => setModal({ k: 'balance' })}>{Icon.shuffle} Ausgleichen</button></div>}
      {finalShown && <div className="rm-alert green"><span>Finaltisch-Screen läuft am TV. Er verschwindet, sobald du die Uhr weiterlaufen lässt.</span></div>}
      {movesShown && (
        <div className="rm-alert gold">
          <b>{game.moveNotice!.title} – läuft am TV</b>
          <MoveList game={game} moves={game.moveNotice!.moves} />
          <button className="btn primary" onClick={() => mut((g) => tAct.closeMoves(g))}>{Icon.check} Erledigt – am TV schließen</button>
        </div>
      )}

      <div className="rm-sec">
        <h3>Im Turnier · {alive.length}</h3>
        {canAdd && <button className="btn sm" onClick={() => setModal({ k: 'add' })}>{Icon.plus} {started ? 'Late Reg' : 'Spieler'}</button>}
      </div>
      <div className="rm-list">
        {[...alive].sort((a, b) => sortKey(a.id) - sortKey(b.id)).map((p) => (
          <div className="rm-row" key={p.id}>
            <button className="rm-who" onClick={() => setModal({ k: 'player', p })}>
              <b>{p.name}{p.rebuys > 0 && <small className="rtag">R{p.rebuys}</small>}{seat(p.id) && game.seating?.buttons[seat(p.id)!.table] === seat(p.id)!.seat && <i className="dealer sm">D</i>}</b>
              <span className="note">{seat(p.id) ? `${multi ? `Tisch ${seat(p.id)!.table} · ` : ''}Sitz ${seat(p.id)!.seat}` : 'ohne Sitz'}{p.open > 0 && <> · <span className="openc">{fmt(p.open)} offen</span></>}{t.bounty && p.bounties ? ` · ${p.bounties} Bounty` : ''}</span>
            </button>
            {started && rebuyOpen && <button className="btn" disabled={maxed(p)} onClick={() => setModal({ k: 'rebuy', p })}>{Icon.plus} Rebuy</button>}
            {started && <button className="btn danger" onClick={() => setModal({ k: 'bust', p })}>{Icon.skull} Raus</button>}
          </div>
        ))}
        {alive.length === 0 && <div className="muted">Noch keine Spieler.</div>}
      </div>

      {out.length > 0 && <>
        <button className="rm-sec rm-toggle" onClick={() => setShowOut(!showOut)}><h3>Ausgeschieden · {out.length}</h3><span className="muted">{showOut ? 'ausblenden' : 'anzeigen'}</span></button>
        {showOut && <div className="rm-list">
          {out.map((p) => (
            <button className="rm-row out" key={p.id} onClick={() => setModal({ k: 'player', p })}>
              <span className="place num">{p.place}.</span>
              <span className="rm-who"><b>{p.name}</b><span className="note">{p.byId ? `raus durch ${st.players.find((x) => x.id === p.byId)?.name}` : 'ausgeschieden'}{p.open > 0 && <> · <span className="openc">{fmt(p.open)} offen</span></>}</span></span>
            </button>
          ))}
        </div>}
      </>}

      {modal?.k === 'rebuy' && <EntryModal title={`Rebuy: ${modal.p.name}`} t={t} victim={modal.p} others={alive.filter((x) => x.id !== modal.p.id)} onClose={() => setModal(null)}
        onConfirm={(paid, byId) => {
          let ids: string[] = [];
          mut((g) => { ids = tAct.rebuy(g, modal.p.id, paid, byId); });
          setToast({ text: `${modal.p.name}: Rebuy ${fmt(entryPrice(t))} ${paid ? 'bar' : 'angeschrieben'}`, ids });
          setModal(null);
        }} />}
      {modal?.k === 'bust' && <BustModal p={modal.p} t={t} place={st.alive} rebuyOpen={rebuyOpen && !maxed(modal.p)} others={alive.filter((x) => x.id !== modal.p.id)} onClose={() => setModal(null)}
        onRebuy={() => setModal({ k: 'rebuy', p: modal.p })}
        onConfirm={(byId) => {
          const last = st.alive === 2;
          let ids: string[] = [];
          mut((g) => { ids = tAct.bust(g, modal.p.id, byId).ids; });
          if (!last) setToast({ text: `${modal.p.name} ist raus (Platz ${st.alive})`, ids });
          setModal(null);
        }} />}
      {modal?.k === 'player' && <PlayerModal game={game} p={st.players.find((x) => x.id === modal.p.id)!} onClose={() => setModal(null)} mut={mut} />}
      {modal?.k === 'add' && <LateRegModal game={game} data={data} t={t} update={update} aliveIds={aliveIds} started={started} onClose={() => setModal(null)} />}
      {modal?.k === 'final' && (
        <Modal title="Finaltisch" onClose={() => setModal(null)} footer={<>
          <button className="btn" onClick={() => setModal(null)}>Später</button>
          <button className="btn primary" onClick={() => { mut((g) => tAct.final(g)); setModal(null); }}>{Icon.shuffle} Finaltisch losen</button>
        </>}>
          <p className="muted" style={{ margin: 0 }}>Nur noch {aliveIds.length} Spieler. Plätze und Dealer-Button werden neu gelost, die Uhr pausiert und am TV erscheint der Finaltisch, bis du die Uhr weiterlaufen lässt.</p>
        </Modal>
      )}
      {modal?.k === 'balance' && (
        <Modal title="Tische ausgleichen" onClose={() => setModal(null)} footer={<>
          <button className="btn" onClick={() => setModal(null)}>Abbrechen</button>
          <button className="btn primary" onClick={() => { mut((g) => tAct.balance(g)); setModal(null); }}>{Icon.shuffle} Jetzt ausgleichen</button>
        </>}>
          <p className="muted" style={{ margin: 0 }}>{plan.length} Spieler werden zufällig vom größten an den kleinsten Tisch gesetzt. Am TV steht, wer wohin muss, bis du die Anzeige schließt.</p>
        </Modal>
      )}
      {toast && (
        <div className="toast">
          <span>{toast.text}</span>
          {toast.ids.length > 0 && <button className="btn sm" onClick={() => { mut((g) => tAct.void(g, toast.ids)); setToast(null); }}>{Icon.undo} Rückgängig</button>}
        </div>
      )}
    </div>
  );
}

function RmHead({ game, online, sub }: { game: Game; online: boolean; sub: string }) {
  return (
    <header className="rm-head">
      <div><b>{game.name}</b><span className="note">{sub}</span></div>
      <span className={'rm-dot' + (online ? ' on' : '')}>{online ? 'online' : 'offline'}</span>
    </header>
  );
}
