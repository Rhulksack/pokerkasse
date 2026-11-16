import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppData, Game, GameEvent, PlayerState, QUICK_AMOUNTS, ROUND_STEP, cashAvailable, computeSettlement,
  deriveState, describeEvent, fmt, fmtDuration, isVoidable, previewCashout, proportionalAdjust, uid,
} from './logic';
import type { Update } from './App';
import { Avatar, EuroInput, Icon, Modal, Money, fmtDate, fmtTime, parseEuro, useNow } from './ui';
import SettlementView from './SettlementView';

type DistEvent = GameEvent extends infer T ? (T extends GameEvent ? Omit<T, 'id' | 'at'> : never) : never;

export default function GameView({ game, data, update, onBack }: { game: Game; data: AppData; update: Update; onBack: () => void }) {
  const s = useMemo(() => deriveState(game), [game]);
  const now = useNow(game.status === 'running');
  const [sel, setSel] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'add' | 'log' | 'cashout' | 'end'>(null);
  const [toast, setToast] = useState<{ text: string; evId: string } | null>(null);
  const [counting, setCounting] = useState(game.status !== 'finished' && !!game.final);

  const mut = useCallback((fn: (g: Game) => void) => update((d) => { fn(d.games.find((x) => x.id === game.id)!); }), [update, game.id]);
  const addEvent = useCallback((ev: DistEvent) => {
    const full = { ...ev, id: uid(), at: Date.now() } as GameEvent;
    mut((g) => { g.events.push(full); });
    return full;
  }, [mut]);
  const voidEvent = (targetId: string) => addEvent({ type: 'void', targetId });

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  if (game.status === 'finished') {
    return <SettlementView game={game} update={update} onBack={onBack}
      onReopen={() => { mut((g) => { g.status = 'running'; g.endedAt = null; }); setCounting(true); }} />;
  }

  const duration = game.startedAt ? now - game.startedAt : 0;
  const player = s.players.find((p) => p.id === sel) ?? null;
  const active = s.players.filter((p) => !p.cashout);
  const out = s.players.filter((p) => p.cashout);

  const start = () => {
    const t = Date.now();
    mut((g) => { g.status = 'running'; g.startedAt = t; g.events.push({ id: uid(), at: t, type: 'game_started' }); });
  };

  const bookBuyin = (p: PlayerState, amount: number, paid: boolean) => {
    if (!(amount > 0)) return;
    const ev = addEvent({ type: 'buyin', playerId: p.id, amount, paid });
    setToast({ text: `${p.name}: Buy-in ${fmt(amount)} ${paid ? 'bar' : 'angeschrieben'}`, evId: ev.id });
  };

  return (
    <div className="game">
      <header className="topbar">
        <button className="btn ghost" onClick={onBack}>{Icon.back} <span className="lbl">Homegames</span></button>
        <div className="title">
          <b>{game.name}</b>
          <span>{fmtDate(game.createdAt)} · {game.players.length} Spieler</span>
        </div>
        <div className="spacer" />
        <div className="timer">
          {game.status === 'running' ? <span className="badge live"><span className="dot" />Live</span> : <span className="badge neutral">Bereit</span>}
          <div>
            <small>Spielzeit</small>
            <div className="clock">{fmtDuration(duration)}</div>
          </div>
          {game.status === 'created' && <button className="btn primary" onClick={start}>{Icon.play} Starten</button>}
        </div>
        <div className="spacer" />
        <div className="actions">
          <button className="btn" onClick={() => setModal('add')}>{Icon.user} Spieler</button>
          <button className="btn" onClick={() => setModal('log')}>{Icon.list} Protokoll</button>
          {!counting
            ? <button className="btn primary" onClick={() => { setCounting(true); setSel(null); }} disabled={game.status !== 'running'}>{Icon.flag} Spiel beenden</button>
            : <button className="btn" onClick={() => setCounting(false)}>{Icon.back} Zurück zum Spiel</button>}
        </div>
      </header>

      <section className="kpis">
        <div className="card kpi cash">
          <div className="label"><span className="ic">{Icon.cash}</span>Bargeld in der Kasse</div>
          <div className="value">{fmt(s.cashBox)}</div>
          <div className="sub">{fmt(s.cashIn)} bar eingezahlt{s.cashOut > 0 && <> · {fmt(s.cashOut)} ausgezahlt</>}</div>
        </div>
        <div className="card kpi total">
          <div className="label"><span className="ic">{Icon.stack}</span>Gesamt-Buy-ins (inkl. angeschrieben)</div>
          <div className="value">{fmt(s.totalIn)}</div>
          <div className="sub">Chips im Spiel: {fmt(s.chipsOnTable)} (inkl. Rake & Tips)</div>
        </div>
        <div className="card kpi open">
          <div className="label"><span className="ic">{Icon.pen}</span>Davon angeschrieben</div>
          <div className={'value' + (s.open > 0 ? ' has' : '')}>{fmt(s.open)}</div>
          <div className="sub">{s.players.filter((p) => p.open > 0).length} Spieler mit offenem Betrag</div>
        </div>
        <div className="card kpi rake">
          <div className="label"><span className="ic">{Icon.users}</span>Spieler am Tisch</div>
          <div className="value">{active.length}<span className="muted" style={{ fontSize: 18, fontWeight: 600 }}> / {s.players.length}</span></div>
          <div className="sub">{out.length > 0 ? `${out.length} früh gegangen · ${fmt(s.cashOut)} ausgezahlt` : 'Rake & Tips werden am Ende gezählt'}</div>
        </div>
      </section>

      {counting ? (
        <CountView game={game} mut={mut} onDone={() => setModal('end')} />
      ) : (
        <div className="main">
          <div className="players-area">
            <div className="players-head">
              <h3>Am Tisch · {active.length}</h3>
              <div className="spacer" />
              <span className="note">Spieler wählen, dann Betrag</span>
            </div>
            {s.players.length === 0 && <div className="empty">Noch keine Spieler. Füge oben über „Spieler“ jemanden hinzu.</div>}
            <div className="players-grid">
              {active.map((p) => <PlayerCard key={p.id} p={p} sel={p.id === sel} onClick={() => setSel(p.id === sel ? null : p.id)} />)}
            </div>
            {out.length > 0 && <>
              <div className="players-head" style={{ marginTop: 22 }}><h3>Ausgecasht · {out.length}</h3></div>
              <div className="players-grid">
                {out.map((p) => <PlayerCard key={p.id} p={p} sel={p.id === sel} onClick={() => setSel(p.id === sel ? null : p.id)} />)}
              </div>
            </>}
          </div>
          {player && <div className="sheet-backdrop" onClick={() => setSel(null)} />}
          <aside className={'card panel' + (player ? ' open' : '')}>
            <div className="sheet-handle" />
            {player
              ? <PlayerPanel key={player.id} p={player} game={game} onBuyin={bookBuyin} onClose={() => setSel(null)}
                  onPay={(amt) => { addEvent({ type: 'payment', playerId: player.id, amount: amt }); setToast({ text: `${player.name}: ${fmt(amt)} nachbezahlt`, evId: '' }); }}
                  onCashout={() => setModal('cashout')} onUndoCashout={() => voidEvent(player.cashout!.id)} />
              : <div className="panel-empty">{Icon.user}<div><b style={{ color: 'var(--text)' }}>Kein Spieler ausgewählt</b><br />Wähle links einen Spieler, um einen Buy-in oder Rebuy zu buchen, Angeschriebenes zu begleichen oder ihn auszucashen.</div></div>}
          </aside>
        </div>
      )}

      {modal === 'add' && <AddPlayerModal game={game} data={data} update={update} onClose={() => setModal(null)} />}
      {modal === 'log' && <LogModal game={game} voided={s.voided} onVoid={voidEvent} onClose={() => setModal(null)} />}
      {modal === 'cashout' && player && (
        <CashoutModal p={player} s={s} onClose={() => setModal(null)}
          onConfirm={(chips, payoutCash) => { addEvent({ type: 'cashout', playerId: player.id, chips, payoutCash }); setModal(null); }} />
      )}
      {modal === 'end' && (
        <Modal title="Homegame beenden und abrechnen?" onClose={() => setModal(null)}
          footer={<>
            <button className="btn" onClick={() => setModal(null)}>Abbrechen</button>
            <button className="btn primary" onClick={() => {
              const t = Date.now();
              mut((g) => { g.status = 'finished'; g.endedAt = t; g.events.push({ id: uid(), at: t, type: 'game_finished' }); });
              setModal(null);
            }}>{Icon.check} Beenden & abrechnen</button>
          </>}>
          <p className="muted" style={{ margin: 0 }}>Der Timer stoppt und die Endabrechnung wird erstellt. Über „Zählung bearbeiten“ kannst du Werte danach noch korrigieren.</p>
        </Modal>
      )}
      {toast && (
        <div className="toast">
          <span>{toast.text}</span>
          {toast.evId && <button className="btn sm" onClick={() => { voidEvent(toast.evId); setToast(null); }}>{Icon.undo} Rückgängig</button>}
        </div>
      )}
    </div>
  );
}

function PlayerCard({ p, sel, onClick }: { p: PlayerState; sel: boolean; onClick: () => void }) {
  const cashPct = p.totalIn > 0 ? (p.paidCash / p.totalIn) * 100 : 0;
  const openPct = p.totalIn > 0 ? (p.open / p.totalIn) * 100 : 0;
  const result = p.cashout ? p.cashout.chips - p.totalIn : 0;
  return (
    <button className={'card pcard' + (sel ? ' sel' : '') + (p.cashout ? ' out' : '')} onClick={onClick}>
      <div className="top">
        <Avatar name={p.name} />
        <div className="name">{p.name}</div>
        {p.cashout
          ? <span className={'badge ' + (result >= 0 ? 'cash' : 'loss')}>{fmt(result, { sign: true })}</span>
          : p.open > 0 ? <span className="badge open">offen</span> : p.totalIn > 0 ? <span className="badge cash">bezahlt</span> : <span className="badge neutral">kein Buy-in</span>}
      </div>
      <div className="big">{fmt(p.totalIn)}<small>{p.buyins.length} Buy-in{p.buyins.length === 1 ? '' : 's'}</small></div>
      <div className="bar"><i className="c" style={{ width: cashPct + '%' }} /><i className="o" style={{ width: openPct + '%' }} /></div>
      <div className="split">
        <span><i className="sq" style={{ background: 'var(--green)' }} />Bar <b className="paid">{fmt(p.paidCash)}</b></span>
        <span><i className="sq" style={{ background: 'var(--amber)' }} />Offen <b className={p.open > 0 ? 'openc' : 'faint'}>{fmt(p.open)}</b></span>
      </div>
    </button>
  );
}

function PlayerPanel({ p, game, onBuyin, onPay, onCashout, onUndoCashout, onClose }: {
  p: PlayerState; game: Game; onBuyin: (p: PlayerState, amount: number, paid: boolean) => void; onPay: (amt: number) => void;
  onCashout: () => void; onUndoCashout: () => void; onClose: () => void;
}) {
  const [paid, setPaid] = useState(true);
  const [custom, setCustom] = useState('');
  const [payAmt, setPayAmt] = useState('');
  const disabled = !!p.cashout;

  const book = (amt: number) => { onBuyin(p, amt, paid); setPaid(true); setCustom(''); };

  useEffect(() => {
    const h = (ev: KeyboardEvent) => {
      if (disabled || (ev.target as HTMLElement).tagName === 'INPUT' || document.querySelector('.overlay')) return;
      const i = ['1', '2', '3'].indexOf(ev.key);
      if (i >= 0) book(QUICK_AMOUNTS[i]);
      if (ev.key.toLowerCase() === 'b') setPaid(true);
      if (ev.key.toLowerCase() === 'a') setPaid(false);
      if (ev.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const customVal = parseEuro(custom);
  const payVal = payAmt === '' ? p.open : parseEuro(payAmt);

  return (
    <>
      <div className="row">
        <Avatar name={p.name} />
        <div style={{ flex: 1 }}><h2>{p.name}</h2><div className="note">{p.cashout ? `Ausgecasht um ${fmtTime(p.cashout.at)}` : 'Am Tisch'}</div></div>
        <button className="btn ghost sm" onClick={onClose}>{Icon.x}</button>
      </div>
      <div className="stats3">
        <div><span>Eingekauft</span><b>{fmt(p.totalIn)}</b></div>
        <div><span>Davon bar</span><b className="paid">{fmt(p.paidCash)}</b></div>
        <div><span>Davon offen</span><b className={p.open > 0 ? 'openc' : 'faint'}>{fmt(p.open)}</b></div>
      </div>

      {!disabled && (
        <div className="section">
          <h3>{p.buyins.length ? 'Rebuy' : 'Buy-in'} buchen</h3>
          <div className="seg full">
            <button className={paid ? 'on cash' : ''} onClick={() => setPaid(true)}>{Icon.cash} Bar bezahlt <span className="kbd">B</span></button>
            <button className={!paid ? 'on open' : ''} onClick={() => setPaid(false)}>{Icon.pen} Anschreiben <span className="kbd">A</span></button>
          </div>
          <div className={'quick ' + (paid ? 'cash' : 'open')}>
            {QUICK_AMOUNTS.map((a, i) => (
              <button key={a} onClick={() => book(a)}><span className="kbd">{i + 1}</span>{a} €</button>
            ))}
          </div>
          <div className="row">
            <EuroInput value={custom} onChange={setCustom} placeholder="Eigener Betrag" onEnter={() => customVal > 0 && book(customVal)} />
            <button className="btn primary" disabled={!(customVal > 0)} onClick={() => book(customVal)}>Buchen</button>
          </div>
        </div>
      )}

      {p.open > 0 && (
        <div className="payoff">
          <p><b className="openc">{fmt(p.open)} angeschrieben.</b> Zahlung als bar erhalten verbuchen (zählt nicht als neuer Buy-in).</p>
          <div className="row">
            <EuroInput value={payAmt} onChange={setPayAmt} placeholder={String(p.open).replace('.', ',')} />
            <button className="btn" disabled={!(payVal > 0 && payVal <= p.open + 1e-9)} onClick={() => { onPay(payVal); setPayAmt(''); }}>{Icon.check} Bezahlt</button>
          </div>
        </div>
      )}

      {p.buyins.length > 0 && (
        <div className="section">
          <h3>Verlauf</h3>
          <div className="history">
            {[...p.buyins].reverse().map((b, i) => (
              <div className="h" key={b.id}>
                <span className="t">{fmtTime(b.at)}</span>
                <span style={{ flex: 1 }}>{i === p.buyins.length - 1 ? 'Buy-in' : 'Rebuy'}</span>
                <b className="num">{fmt(b.amount)}</b>
                <span className={'badge ' + (b.paid ? 'cash' : 'open')}>{b.paid ? 'bar' : 'angeschrieben'}</span>
              </div>
            ))}
            {game.events.filter((ev) => ev.type === 'payment' && ev.playerId === p.id).length > 0 && (
              <div className="note">Nachzahlungen und Stornos findest du im Protokoll.</div>
            )}
          </div>
        </div>
      )}

      <div style={{ marginTop: 'auto' }}>
        {p.cashout ? (
          <div className="calc">
            <div className="l"><span>Cash-out (Chips)</span><b>{fmt(p.cashout.chips)}</b></div>
            <div className="l"><span>Bar ausgezahlt</span><b className="paid">{fmt(p.cashout.payoutCash)}</b></div>
            <div className="l total"><span>Spielergebnis</span><Money v={p.cashout.chips - p.totalIn} sign tone="result" /></div>
            <button className="btn sm" style={{ marginTop: 6 }} onClick={onUndoCashout}>{Icon.undo} Cash-out stornieren</button>
          </div>
        ) : (
          <button className="btn" style={{ width: '100%' }} disabled={p.totalIn === 0} onClick={onCashout}>{Icon.logout} Spieler auscashen (geht früher)</button>
        )}
      </div>
    </>
  );
}

function CashoutModal({ p, s, onClose, onConfirm }: { p: PlayerState; s: ReturnType<typeof deriveState>; onClose: () => void; onConfirm: (chips: number, payoutCash: number) => void }) {
  const [v, setV] = useState('');
  const chips = parseEuro(v);
  const valid = chips >= 0;
  const pv = valid ? previewCashout(s, p, chips) : null;
  return (
    <Modal title={`${p.name} auscashen`} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn primary" disabled={!valid} onClick={() => pv && onConfirm(chips, pv.payoutCash)}>{Icon.check} Cash-out buchen</button>
      </>}>
      <label className="field">Chipwert, mit dem {p.name} aufsteht
        <EuroInput value={v} onChange={setV} autoFocus onEnter={() => pv && onConfirm(chips, pv.payoutCash)} />
      </label>
      {pv && (
        <div className="calc">
          <div className="l"><span>Insgesamt eingekauft</span><span>{fmt(p.totalIn)}</span></div>
          <div className="l"><span>Spielergebnis</span><Money v={pv.result} sign tone="result" /></div>
          <div className="l"><span>Chipwert</span><span>{fmt(chips)}</span></div>
          <div className="l"><span>− noch angeschrieben</span><span className={p.open > 0 ? 'openc' : 'faint'}>{fmt(p.open)}</span></div>
          {pv.debt > 0 ? (
            <div className="l total"><span>{p.name} schuldet noch</span><span className="neg">{fmt(pv.debt)}</span></div>
          ) : (
            <>
              <div className="l"><span>Anspruch exakt</span><span>{fmt(pv.payoutExact)}</span></div>
              <div className="l total"><span>Bar aus der Kasse auszahlen</span><span className="pos">{fmt(pv.payoutCash)}</span></div>
              {pv.payoutRounded !== pv.payoutExact && <div className="note">Auf {ROUND_STEP}-€-Betrag gerundet. Die Differenz von {fmt(pv.payoutRounded - pv.payoutExact, { sign: true })} gleicht die Endabrechnung aus.</div>}
            </>
          )}
          {pv.shortfall > 0 && <div className="warn">In der Kasse sind nur {fmt(cashAvailable(s))} für Auszahlungen verfügbar. {fmt(pv.shortfall)} bekommt {p.name} in der Endabrechnung.</div>}
          {pv.debt > 0 && <div className="note">Die Schuld erscheint in der Endabrechnung: Er zahlt sie in die Kasse oder, im Modus „Zahlungsvorschläge“, direkt an einen Gewinner.</div>}
        </div>
      )}
    </Modal>
  );
}

function AddPlayerModal({ game, data, update, onClose }: { game: Game; data: AppData; update: Update; onClose: () => void }) {
  const [n, setN] = useState('');
  const avail = data.players.filter((p) => !game.players.some((x) => x.id === p.id)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const add = (id: string, name: string, isNew: boolean) => {
    const t = Date.now();
    update((d) => {
      if (isNew) d.players.push({ id, name });
      const g = d.games.find((x) => x.id === game.id)!;
      g.players.push({ id, name });
      g.events.push({ id: uid(), at: t, type: 'player_added', playerId: id });
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
    <Modal title="Spieler hinzufügen" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Fertig</button>}>
      {avail.length > 0 && (
        <div className="section">
          <h3>Aus der Spielerliste</h3>
          <div className="chips-pick">
            {avail.map((p) => <button key={p.id} className="chip" onClick={() => add(p.id, p.name, false)}>{Icon.plus}{p.name}</button>)}
          </div>
        </div>
      )}
      <div className="section">
        <h3>Neuer Name</h3>
        <div className="row">
          <input className="input" autoFocus placeholder="Name" value={n} onChange={(e) => setN(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNew()} />
          <button className="btn" onClick={addNew} disabled={!n.trim()}>{Icon.plus} Hinzufügen</button>
        </div>
        <div className="note">Neue Namen werden automatisch in die Spielerliste übernommen.</div>
      </div>
      <div className="note">Im Spiel: {game.players.map((p) => p.name).join(', ') || 'noch niemand'}</div>
    </Modal>
  );
}

function LogModal({ game, voided, onVoid, onClose }: { game: Game; voided: Set<string>; onVoid: (id: string) => void; onClose: () => void }) {
  const evs = [...game.events].reverse();
  return (
    <Modal title="Protokoll" wide onClose={onClose}>
      <div className="log">
        {evs.map((ev) => (
          <div key={ev.id} className={'e' + (voided.has(ev.id) ? ' void' : '')}>
            <span className="t">{fmtTime(ev.at)}</span>
            <span>{describeEvent(ev, game)}</span>
            {isVoidable(ev) && !voided.has(ev.id) && game.status !== 'finished'
              ? <button className="btn ghost sm danger" onClick={() => onVoid(ev.id)}>{Icon.undo} Stornieren</button>
              : <span />}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function SettleBadge({ row }: { row?: { settle: number; settleExact: number } }) {
  if (!row) return null;
  const exact = row.settleExact !== row.settle ? <div className="note">exakt {fmt(row.settleExact, { sign: true })}</div> : null;
  if (row.settle > 0) return <><span className="badge cash">bekommt {fmt(row.settle)} bar</span>{exact}</>;
  if (row.settle < 0) return <><span className="badge loss">zahlt noch {fmt(-row.settle)}</span>{exact}</>;
  return <><span className="badge neutral">ausgeglichen</span>{exact}</>;
}

function CountView({ game, mut, onDone }: { game: Game; mut: (fn: (g: Game) => void) => void; onDone: () => void }) {
  const s = deriveState(game);
  const final = game.final ?? { chips: {}, adjust: {}, ignoreDiff: false };
  const active = s.players.filter((p) => !p.cashout);
  const early = s.players.filter((p) => p.cashout);
  const [inputs, setInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(active.map((p) => [p.id, final.chips[p.id] != null ? String(final.chips[p.id]).replace('.', ',') : ''])));
  const [adj, setAdj] = useState<Record<string, string>>(() =>
    Object.fromEntries(active.map((p) => [p.id, final.adjust[p.id] ? String(final.adjust[p.id]).replace('.', ',') : ''])));
  const toStr = (v?: number) => (v ? String(v).replace('.', ',') : '');
  const [rakeIn, setRakeIn] = useState(toStr(final.rake));
  const [tipsIn, setTipsIn] = useState(toStr(final.tips));
  const rake = parseEuro(rakeIn) || 0;
  const tips = parseEuro(tipsIn) || 0;

  const chips = Object.fromEntries(active.map((p) => [p.id, parseEuro(inputs[p.id] ?? '')]));
  const adjust = Object.fromEntries(active.map((p) => [p.id, parseEuro(adj[p.id] ?? '') || 0]));
  const allEntered = active.every((p) => chips[p.id] >= 0);
  const chipsClean = Object.fromEntries(active.map((p) => [p.id, chips[p.id] >= 0 ? chips[p.id] : 0]));
  const fc = { chips: chipsClean, adjust, ignoreDiff: final.ignoreDiff, rake, tips };
  const st = computeSettlement(game, fc);
  // nur tatsächlich eingetragene Chipwerte speichern (leere Felder bleiben leer)
  const savedChips = Object.fromEntries(active.filter((p) => chips[p.id] >= 0).map((p) => [p.id, chips[p.id]]));

  useEffect(() => {
    const t = setTimeout(() => mut((g) => { g.final = { ...fc, chips: savedChips }; }), 300);
    return () => clearTimeout(t);
  }, [JSON.stringify(inputs), JSON.stringify(adj), fc.ignoreDiff, rake, tips]);

  const diffOk = Math.abs(st.diff) < 0.005;
  const counted = active.reduce((a, p) => a + chipsClean[p.id], 0);
  const [forceAdj, setForceAdj] = useState(false);
  const showAdj = forceAdj || (allEntered && !diffOk) || Object.values(adjust).some((v) => v !== 0);
  const rowOf = (id: string) => st.rows.find((r) => r.id === id)!;
  const payIn = st.rows.filter((r) => r.settle < 0).reduce((a, r) => a - r.settle, 0);
  const payOut = st.rows.filter((r) => r.settle > 0).reduce((a, r) => a + r.settle, 0);

  return (
    <div className="main count-main" style={{ gridTemplateColumns: '1fr 360px' }}>
      <div className="players-area" style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
        <div className="card table-card" style={{ padding: '6px 8px' }}>
          <table className="table count stack">
            <thead><tr>
              <th>Spieler</th><th>Eingekauft</th><th>Bar bezahlt</th><th>Offen</th><th>Chipwert</th>
              {showAdj && <th>Ausgleich</th>}
              <th>Ergebnis</th><th>{diffOk ? 'Bekommt / zahlt' : 'Bekommt / zahlt (vorläufig)'}</th>
            </tr></thead>
            <tbody>
              {active.map((p, i) => {
                const x = chipsClean[p.id] + adjust[p.id];
                const entered = chips[p.id] >= 0;
                return (
                  <tr key={p.id}>
                    <td><div className="row"><Avatar name={p.name} /><b>{p.name}</b></div></td>
                    <td>{fmt(p.totalIn)}</td>
                    <td className="paid">{fmt(p.paidCash)}</td>
                    <td><Money v={p.open} tone="open" /></td>
                    <td><EuroInput value={inputs[p.id] ?? ''} autoFocus={i === 0} placeholder="—" onChange={(v) => setInputs({ ...inputs, [p.id]: v })} /></td>
                    {showAdj && <td><EuroInput allowNegative value={adj[p.id] ?? ''} placeholder="0" onChange={(v) => setAdj({ ...adj, [p.id]: v })} /></td>}
                    <td>{entered ? <Money v={x - p.totalIn} sign tone="result" /> : <span className="faint">—</span>}</td>
                    <td>{entered ? <SettleBadge row={rowOf(p.id)} /> : <span className="faint">Chips eintragen</span>}</td>
                  </tr>
                );
              })}
              {early.map((p) => (
                <tr key={p.id} style={{ opacity: .7 }}>
                  <td><div className="row"><Avatar name={p.name} /><span>{p.name}</span><span className="badge neutral">früh</span></div></td>
                  <td>{fmt(p.totalIn)}</td>
                  <td className="paid">{fmt(p.paidCash)}</td>
                  <td><Money v={p.open} tone="open" /></td>
                  <td>{fmt(p.cashout!.chips)}</td>
                  {showAdj && <td className="faint">—</td>}
                  <td><Money v={p.cashout!.chips - p.totalIn} sign tone="result" /></td>
                  <td>
                    {rowOf(p.id)?.settle ? <SettleBadge row={rowOf(p.id)} /> : <span className="note">{p.cashout!.payoutCash > 0 ? `hat ${fmt(p.cashout!.payoutCash)} bar erhalten` : 'erledigt'}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              <td>Summe</td><td>{fmt(s.totalIn)}</td><td className="paid">{fmt(s.cashIn)}</td><td className={s.open > 0 ? 'openc' : ''}>{fmt(s.open)}</td>
              <td>{fmt(counted + early.reduce((a, p) => a + p.cashout!.chips, 0))}</td>{showAdj && <td />}<td /><td />
            </tr></tfoot>
          </table>
        </div>
        {!showAdj && <div className="row"><button className="btn sm ghost" onClick={() => setForceAdj(true)}>{Icon.plus} Spalte „Differenz-Ausgleich“ einblenden</button></div>}
        <div className="note">Trage für jeden Spieler am Tisch den Wert seiner Chips ein und rechts bzw. unten den gezählten Rake und die Dealer-Tips. Ergibt die Summe nicht den erwarteten Chipwert, verteilst du die Differenz in der Spalte „Differenz-Ausgleich“ (positiv = bekommt mehr, negativ = bekommt weniger).</div>
      </div>
      <aside className="card panel count-panel">
        <h2>Rake & Dealer-Tips</h2>
        <div className="row" style={{ gap: 12 }}>
          <label className="field" style={{ flex: 1 }}>Rake gezählt<EuroInput value={rakeIn} onChange={setRakeIn} placeholder="0" /></label>
          <label className="field" style={{ flex: 1 }}>Dealer-Tips gezählt<EuroInput value={tipsIn} onChange={setTipsIn} placeholder="0" /></label>
        </div>
        <h2>Abgleich</h2>
        <div className="calc">
          <div className="l"><span>Gesamt-Buy-ins</span><span>{fmt(s.totalIn)}</span></div>
          <div className="l"><span>− früh ausgecasht</span><span>{fmt(early.reduce((a, p) => a + p.cashout!.chips, 0))}</span></div>
          {s.rake + s.tips > 0 && <div className="l"><span>− Rake/Tips (während des Spiels)</span><span>{fmt(s.rake + s.tips)}</span></div>}
          <div className="l total"><span>Chips im Spiel</span><span>{fmt(s.chipsOnTable)}</span></div>
          <div className="l"><span>Gezählt bei Spielern</span><span>{fmt(counted)}</span></div>
          <div className="l"><span>+ Rake</span><span>{fmt(rake)}</span></div>
          <div className="l"><span>+ Dealer-Tips</span><span>{fmt(tips)}</span></div>
          <div className="l"><span>Ausgleich verteilt</span><span>{fmt(Object.values(adjust).reduce((a, b) => a + b, 0), { sign: true })}</span></div>
          <div className="l total"><span>Differenz</span><span className={diffOk ? 'pos' : 'openc'}>{fmt(st.diff, { sign: true })}</span></div>
        </div>
        <h2>Kasse</h2>
        <div className="calc">
          <div className="l"><span>Bargeld in der Kasse</span><span className="paid">{fmt(s.cashBox)}</span></div>
          <div className="l"><span>− Rake & Tips entnehmen</span><span>{fmt(st.rake + st.tips)}</span></div>
          <div className="l"><span>+ noch bar einzuzahlen</span><span className={payIn > 0 ? 'openc' : ''}>{fmt(payIn)}</span></div>
          <div className="l"><span>− bar auszuzahlen</span><span>{fmt(payOut)}</span></div>
          <div className="l total"><span>Rest (Rundung)</span><span className={st.roundingRest < 0 ? 'neg' : ''}>{fmt(st.roundingRest)}</span></div>
        </div>
        {!allEntered && <div className="note">Noch nicht alle Chipwerte eingetragen. Die Kassenwerte sind vorläufig.</div>}
        {allEntered && !diffOk && (
          <div className="warn">
            Es {st.diff > 0 ? 'wurden' : 'fehlen'} {fmt(Math.abs(st.diff))} {st.diff > 0 ? 'mehr Chips gezählt als im Spiel sein dürften' : 'an Chips'}. Verteile die Differenz manuell oder automatisch.
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn sm" onClick={() => {
                const pa = proportionalAdjust(active.map((p) => p.id), chipsClean, st.diff);
                const merged = Object.fromEntries(active.map((p) => [p.id, String(Math.round(((adjust[p.id] || 0) + pa[p.id]) * 100) / 100).replace('.', ',')]));
                setAdj(merged);
              }}>Proportional verteilen</button>
              <label className="row" style={{ fontSize: 13, gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={final.ignoreDiff} onChange={(e) => mut((g) => { g.final = { ...fc, chips: savedChips, ignoreDiff: e.target.checked }; })} />
                Differenz ignorieren
              </label>
            </div>
          </div>
        )}
        {allEntered && diffOk && <div className="badge cash" style={{ height: 30, justifyContent: 'center' }}>{Icon.check} Zählung stimmt</div>}
        <div style={{ marginTop: 'auto' }}>
          <button className="btn primary lg" style={{ width: '100%' }} disabled={!allEntered || (!diffOk && !final.ignoreDiff)} onClick={onDone}>
            {Icon.flag} Abrechnen
          </button>
        </div>
      </aside>
    </div>
  );
}
