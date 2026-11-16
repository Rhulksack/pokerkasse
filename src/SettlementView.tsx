import { useState } from 'react';
import { Game, ROUND_STEP, deriveState, describeEvent, fmt, fmtDuration } from './logic';
import type { Update } from './App';
import { Avatar, Icon, Modal, Money, fmtDate, fmtTime } from './ui';
import { fileBase, settlementOf, toHtml, toText } from './exporter';
import { printHtml, shareOrDownload, shareText } from './platform';

export default function SettlementView({ game, update, onBack, onReopen }: { game: Game; update: Update; onBack: () => void; onReopen?: () => void }) {
  const st = settlementOf(game);
  const s = deriveState(game);
  const [msg, setMsg] = useState('');
  const [log, setLog] = useState(false);
  const mode = game.settleMode;
  const setMode = (m: Game['settleMode']) => update((d) => { d.games.find((x) => x.id === game.id)!.settleMode = m; });
  const name = (id: string) => st.rows.find((r) => r.id === id)!.name;
  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(''), 2500); };

  const copy = async () => {
    const r = await shareText(toText(game));
    if (r === 'copied') flash('Abrechnung in die Zwischenablage kopiert');
  };
  const pdf = async () => {
    if (window.api) { if (await window.api.exportPdf(toHtml(game), fileBase(game) + '.pdf')) flash('PDF gespeichert'); }
    else printHtml(toHtml(game), fileBase(game));
  };
  const txt = async () => {
    if (window.api) { if (await window.api.exportTxt(toText(game), fileBase(game) + '.txt')) flash('Textdatei gespeichert'); }
    else { const r = await shareOrDownload(fileBase(game) + '.txt', toText(game), 'text/plain'); if (r === 'downloaded') flash('Textdatei gespeichert'); }
  };

  const sorted = [...st.rows].sort((a, b) => b.result - a.result);
  const debtors = st.rows.filter((r) => r.settle < 0);
  const winners = st.rows.filter((r) => r.settle > 0);
  const earlyPaid = st.rows.filter((r) => r.early && r.earlyPaid > 0);

  return (
    <div className="page">
      <header className="topbar">
        <button className="btn ghost" onClick={onBack}>{Icon.back} <span className="lbl">Homegames</span></button>
        <div className="title"><b>{game.name} · Endabrechnung</b><span>{fmtDate(game.createdAt)} · {game.source ? 'importiert aus Stack-Tracker' : `${fmtTime(game.startedAt ?? game.createdAt)}–${fmtTime(game.endedAt!)}`}</span></div>
        <div className="spacer" />
        <div className="actions">
          <button className="btn" onClick={() => setLog(true)}>{Icon.list} Protokoll</button>
          {onReopen && <button className="btn" onClick={onReopen}>{Icon.pen} Zählung bearbeiten</button>}
          <button className="btn" onClick={copy}>{Icon.copy} {window.api ? 'Text kopieren' : 'Text teilen'}</button>
          <button className="btn" onClick={txt}>{Icon.save} Als .txt</button>
          <button className="btn primary" onClick={pdf}>{Icon.pdf} PDF exportieren</button>
        </div>
      </header>

      <div className="wrap" style={{ maxWidth: 1240, display: 'grid', gap: 18, paddingTop: 22 }}>
        <div className="summary">
          <div className="card"><span>Spielzeit</span><b>{game.startedAt ? fmtDuration(game.endedAt! - game.startedAt) : '–'}</b></div>
          <div className="card"><span>Spieler</span><b>{st.rows.length}</b></div>
          <div className="card"><span>Gesamt-Buy-ins</span><b>{fmt(st.totalIn)}</b></div>
          <div className="card"><span>Bar eingezahlt</span><b className="paid">{fmt(st.cashIn)}</b></div>
          <div className="card"><span>Angeschrieben (vor Abrechnung)</span><b className={s.open > 0 ? 'openc' : ''}>{fmt(s.open)}</b></div>
          <div className="card"><span>Rake / Dealer-Tips</span><b>{fmt(st.rake)} / {fmt(st.tips)}</b></div>
        </div>

        {Math.abs(st.diff) >= 0.005 && <div className="warn">Chip-Differenz von {fmt(st.diff, { sign: true })} wurde ignoriert. Die Kasse geht deshalb nicht exakt auf.</div>}

        <div className="card table-card" style={{ padding: '6px 8px' }}>
          <table className="table stack">
            <thead><tr>
              <th>Spieler</th><th>Eingekauft</th><th>Davon bar</th><th>Davon offen</th><th>Cash-out</th>
              <th>Spielergebnis</th><th>Früh bar erhalten</th><th>Abrechnung exakt</th><th>Abrechnung ({ROUND_STEP}-€-Rundung)</th>
            </tr></thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id}>
                  <td><div className="row"><Avatar name={r.name} /><b>{r.name}</b>{r.early && <span className="badge neutral">früh</span>}</div></td>
                  <td>{fmt(r.totalIn)}</td>
                  <td className="paid">{fmt(r.paidCash)}</td>
                  <td><Money v={r.open} tone="open" /></td>
                  <td>{fmt(r.chips)}{r.adjust !== 0 && <div className="note">inkl. {fmt(r.adjust, { sign: true })} Ausgleich</div>}</td>
                  <td><b><Money v={r.result} sign tone="result" /></b></td>
                  <td>{r.earlyPaid ? fmt(r.earlyPaid) : <span className="faint">–</span>}</td>
                  <td className="muted">{r.settleExact ? fmt(r.settleExact, { sign: true }) : '–'}</td>
                  <td>
                    {r.settle > 0 && <span className="badge cash">bekommt {fmt(r.settle)}</span>}
                    {r.settle < 0 && <span className="badge loss">zahlt {fmt(-r.settle)}</span>}
                    {r.settle === 0 && <span className="badge neutral">ausgeglichen</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr>
              <td>Summe</td><td>{fmt(st.totalIn)}</td><td className="paid">{fmt(st.cashIn)}</td><td>{fmt(s.open)}</td>
              <td>{fmt(st.rows.reduce((a, r) => a + r.chips, 0))}</td>
              <td><Money v={st.rows.reduce((a, r) => a + r.result, 0)} sign tone="result" /></td>
              <td>{fmt(st.rows.reduce((a, r) => a + r.earlyPaid, 0))}</td><td /><td />
            </tr></tfoot>
          </table>
        </div>
        <div className="note" style={{ marginTop: -8 }}>
          Spielergebnis = Cash-out − Eingekauft (Gewinn/Verlust am Tisch). Abrechnung = was nach Verrechnung mit angeschriebenen Beträgen und früheren Auszahlungen noch fließen muss. Die Summe der Spielergebnisse entspricht minus Rake und Tips.
        </div>

        <div className="row wrap-row">
          <h2>Zahlungen am Ende</h2>
          <div className="spacer" />
          <div className="seg">
            <button className={mode === 'overview' ? 'on' : ''} onClick={() => setMode('overview')}>Übersicht (über die Kasse)</button>
            <button className={mode === 'suggestions' ? 'on' : ''} onClick={() => setMode('suggestions')}>Zahlungsvorschläge</button>
          </div>
        </div>

        {mode === 'overview' ? (
          <div className="pay-grid">
            <div className="card pay-list">
              <h3>In die Kasse zahlen</h3>
              {debtors.length === 0 && <div className="muted">Niemand muss etwas nachzahlen.</div>}
              {debtors.map((r) => <div className="pay" key={r.id}><Avatar name={r.name} /><span style={{ flex: 1 }}>{r.name}</span><b className="neg">{fmt(-r.settle)}</b></div>)}
            </div>
            <div className="card pay-list">
              <h3>Aus der Kasse auszahlen</h3>
              {winners.length === 0 && <div className="muted">Keine Auszahlungen offen.</div>}
              {winners.map((r) => <div className="pay" key={r.id}><Avatar name={r.name} /><span style={{ flex: 1 }}>{r.name}</span><b className="pos">{fmt(r.settle)}</b></div>)}
            </div>
          </div>
        ) : (
          <div className="pay-grid">
            <div className="card pay-list">
              <h3>Angeschriebene Schulden: wer zahlt wem</h3>
              {st.transfers.length === 0 && <div className="muted">Keine offenen Schulden zwischen Spielern.</div>}
              {st.transfers.map((t, i) => (
                <div className="pay" key={i}>
                  <span className="neg" style={{ fontWeight: 650 }}>{name(t.from)}</span><span className="arrow">{Icon.arrow}</span>
                  <span className="pos" style={{ fontWeight: 650, flex: 1 }}>{name(t.to)}</span><b>{fmt(t.amount)}</b>
                </div>
              ))}
              {st.transfers.length > 0 && <div className="note">Die Schuldner zahlen direkt an die genannten Gewinner, auch später, falls sie gerade nicht flüssig sind.</div>}
            </div>
            <div className="card pay-list">
              <h3>Bar aus der Kasse</h3>
              {st.cashPayouts.length === 0 && <div className="muted">Keine Barauszahlungen offen.</div>}
              {st.cashPayouts.map((p) => <div className="pay" key={p.id}><Avatar name={name(p.id)} /><span style={{ flex: 1 }}>{name(p.id)}</span><b className="pos">{fmt(p.amount)}</b></div>)}
            </div>
          </div>
        )}

        <div className="card pay-list">
          <h3>Kasse</h3>
          <div className="calc" style={{ background: 'transparent', border: 0, padding: 0 }}>
            <div className="l"><span>Bargeld in der Kasse vor der Abrechnung</span><b>{fmt(st.cashBox)}</b></div>
            {earlyPaid.length > 0 && <div className="l"><span className="muted">bereits früh ausgezahlt: {earlyPaid.map((r) => `${r.name} ${fmt(r.earlyPaid)}`).join(', ')}</span><span /></div>}
            {(st.rake > 0 || st.tips > 0) && <div className="l"><span>− Rake & Dealer-Tips entnehmen</span><span>{fmt(st.rake + st.tips)}</span></div>}
            {mode === 'overview' && debtors.length > 0 && <div className="l"><span>+ Nachzahlungen in die Kasse</span><span>{fmt(-debtors.reduce((a, r) => a + r.settle, 0))}</span></div>}
            <div className="l"><span>− Auszahlungen bar</span><span>{fmt(mode === 'overview' ? winners.reduce((a, r) => a + r.settle, 0) : st.cashPayouts.reduce((a, p) => a + p.amount, 0))}</span></div>
            <div className="l total"><span>Rest in der Kasse (Rundung)</span><span>{fmt(st.roundingRest)}</span></div>
          </div>
          <div className="note">Gerundet wird fair auf {ROUND_STEP}-€-Beträge: Die Summe stimmt exakt und jeder Einzelne weicht so wenig wie möglich vom exakten Betrag ab. Offene Zahlungen regeln die Spieler selbst, die App dokumentiert sie nur.</div>
        </div>
      </div>
      {msg && <div className="toast" style={{ paddingRight: 16 }}>{Icon.check}<span>{msg}</span></div>}
      {log && (
        <Modal title="Protokoll" wide onClose={() => setLog(false)}>
          <div className="log">
            {[...game.events].reverse().map((ev) => (
              <div key={ev.id} className={'e' + (s.voided.has(ev.id) ? ' void' : '')}><span className="t">{fmtTime(ev.at)}</span><span>{describeEvent(ev, game)}</span><span /></div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
