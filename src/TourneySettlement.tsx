import { useState } from 'react';
import { Game, deriveState, describeEvent, fmt, fmtDuration } from './logic';
import type { Update } from './App';
import { Avatar, Icon, Modal, Money, fmtDate, fmtTime } from './ui';
import { fileBase, toHtmlTourney, toTextTourney } from './exporter';
import { printHtml, shareOrDownload, shareText } from './platform';
import { tourneySettlement } from './tourney';

export default function TourneySettlement({ game, onBack, onReopen }: { game: Game; update: Update; onBack: () => void; onReopen: () => void }) {
  const { st, rows, payIn, payOut, rest, unassignedBounties } = tourneySettlement(game);
  const t = game.tourney!;
  const s = deriveState(game);
  const [msg, setMsg] = useState('');
  const [log, setLog] = useState(false);
  const flash = (x: string) => { setMsg(x); setTimeout(() => setMsg(''), 2500); };
  const copy = async () => { if (window.api) { await navigator.clipboard.writeText(toTextTourney(game)); flash('Abrechnung kopiert'); } else if ((await shareText(toTextTourney(game))) === 'copied') flash('Abrechnung kopiert'); };
  const pdf = async () => {
    if (window.api) { if (await window.api.exportPdf(toHtmlTourney(game), fileBase(game) + '.pdf')) flash('PDF gespeichert'); }
    else printHtml(toHtmlTourney(game), fileBase(game));
  };
  const txt = async () => {
    if (window.api) { if (await window.api.exportTxt(toTextTourney(game), fileBase(game) + '.txt')) flash('Textdatei gespeichert'); }
    else if ((await shareOrDownload(fileBase(game) + '.txt', toTextTourney(game), 'text/plain')) === 'downloaded') flash('Textdatei gespeichert');
  };
  const winners = rows.filter((r) => r.settle > 0);
  const debtors = rows.filter((r) => r.settle < 0);

  return (
    <div className="page">
      <header className="topbar">
        <button className="btn ghost" onClick={onBack}>{Icon.back} <span className="lbl">Homegames</span></button>
        <div className="title"><b>{game.name} · Turnier-Abrechnung</b><span>{fmtDate(game.createdAt)} · {fmtTime(game.startedAt ?? game.createdAt)}–{fmtTime(game.endedAt!)}</span></div>
        <div className="spacer" />
        <div className="actions">
          <button className="btn" onClick={() => setLog(true)}>{Icon.list} Protokoll</button>
          <button className="btn" onClick={onReopen}>{Icon.undo} Turnier fortsetzen</button>
          <button className="btn" onClick={copy}>{Icon.copy} {window.api ? 'Text kopieren' : 'Text teilen'}</button>
          <button className="btn" onClick={txt}>{Icon.save} Als .txt</button>
          <button className="btn primary" onClick={pdf}>{Icon.pdf} PDF exportieren</button>
        </div>
      </header>
      <div className="wrap" style={{ maxWidth: 1240, display: 'grid', gap: 18, paddingTop: 22 }}>
        <div className="summary">
          <div className="card"><span>Spielzeit</span><b>{game.startedAt ? fmtDuration(game.endedAt! - game.startedAt) : '–'}</b></div>
          <div className="card"><span>Spieler / Einträge</span><b>{rows.length} / {st.entries}</b></div>
          <div className="card"><span>Preispool</span><b>{fmt(st.prizePool)}</b></div>
          <div className="card"><span>{t.bounty ? 'Bounty-Pool' : 'Rebuys'}</span><b>{t.bounty ? fmt(st.bountyPool) : st.rebuys}</b></div>
          <div className="card"><span>Bargeld in der Kasse</span><b className="paid">{fmt(s.cashBox)}</b></div>
          <div className="card"><span>Angeschrieben</span><b className={s.open > 0 ? 'openc' : ''}>{fmt(s.open)}</b></div>
        </div>
        <div className="card table-card" style={{ padding: '6px 8px' }}>
          <table className="table stack">
            <thead><tr><th>Spieler</th><th>Platz</th><th>Eingezahlt</th><th>Davon bar</th><th>Davon offen</th><th>Preisgeld</th>{t.bounty ? <th>Bounties</th> : null}<th>Ergebnis</th><th>Bekommt / zahlt</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><div className="row"><Avatar name={r.name} /><b>{r.name}</b>{r.place === 1 && <span className="badge cash">{Icon.trophy} Sieger</span>}</div></td>
                  <td>{r.place ? `${r.place}.` : '–'}</td>
                  <td>{fmt(r.totalIn)}</td>
                  <td className="paid">{fmt(r.paidCash)}</td>
                  <td><Money v={r.open} tone="open" /></td>
                  <td>{r.prize ? <b>{fmt(r.prize)}</b> : <span className="faint">–</span>}</td>
                  {t.bounty ? <td>{r.bountyWon ? fmt(r.bountyWon) : <span className="faint">–</span>}</td> : null}
                  <td><b><Money v={r.result} sign tone="result" /></b></td>
                  <td>{r.settle > 0 ? <span className="badge cash">bekommt {fmt(r.settle)}</span> : r.settle < 0 ? <span className="badge loss">zahlt noch {fmt(-r.settle)}</span> : <span className="badge neutral">ausgeglichen</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pay-grid">
          <div className="card pay-list">
            <h3>Aus der Kasse auszahlen</h3>
            {winners.length === 0 && <div className="muted">Keine Auszahlungen.</div>}
            {winners.map((r) => <div className="pay" key={r.id}><Avatar name={r.name} /><span style={{ flex: 1 }}>{r.name}</span><b className="pos">{fmt(r.settle)}</b></div>)}
            {debtors.length > 0 && <>
              <h3 style={{ marginTop: 8 }}>Noch offen (angeschrieben)</h3>
              {debtors.map((r) => <div className="pay" key={r.id}><Avatar name={r.name} /><span style={{ flex: 1 }}>{r.name}</span><b className="neg">{fmt(-r.settle)}</b></div>)}
            </>}
          </div>
          <div className="card pay-list">
            <h3>Kasse</h3>
            <div className="calc" style={{ background: 'transparent', border: 0, padding: 0 }}>
              <div className="l"><span>Bargeld in der Kasse</span><b className="paid">{fmt(st.cashBox)}</b></div>
              <div className="l"><span>+ noch bar einzuzahlen</span><span className={payIn > 0 ? 'openc' : ''}>{fmt(payIn)}</span></div>
              <div className="l"><span>− bar auszuzahlen</span><span>{fmt(payOut)}</span></div>
              <div className="l total"><span>Rest in der Kasse</span><span className={rest < 0 ? 'neg' : ''}>{fmt(rest)}</span></div>
            </div>
            <div className="note">Preisgeld = Preispool × Prozent, fair auf 5 € gerundet{st.prizeRest > 0 ? ` (Rundungsrest ${fmt(st.prizeRest)})` : ''}. Wer angeschrieben hat, bekommt sein Preisgeld abzüglich des offenen Betrags.{unassignedBounties > 0 ? ` ${fmt(unassignedBounties)} Bounties sind keinem Spieler zugeordnet.` : ''}</div>
          </div>
        </div>
      </div>
      {msg && <div className="toast" style={{ paddingRight: 16 }}>{Icon.check}<span>{msg}</span></div>}
      {log && (
        <Modal title="Protokoll" wide onClose={() => setLog(false)}>
          <div className="log">{[...game.events].reverse().map((ev) => <div key={ev.id} className={'e' + (s.voided.has(ev.id) ? ' void' : '')}><span className="t">{fmtTime(ev.at)}</span><span>{describeEvent(ev, game)}</span><span /></div>)}</div>
        </Modal>
      )}
    </div>
  );
}
