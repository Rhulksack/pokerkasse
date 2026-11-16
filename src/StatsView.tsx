import { useMemo, useState } from 'react';
import { AppData, fmt } from './logic';
import { Entry, PlayerStat, Range, StatKind, collectEntries, collectGames, filterEntries, filterGames, houseSummary, playerStats, titles } from './stats';
import { Avatar, Icon, Modal } from './ui';

type Preset = 'all' | 'year' | '365' | '90' | '30' | 'custom';
const DAY = 86400000;
const dshort = (t: number) => new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
const money = (n: number, sign = false) => fmt(n, { sign });
const cls = (n: number) => (n > 0 ? 'pos' : n < 0 ? 'neg' : 'muted');
const isoDay = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function rangeFor(p: Preset, from: string, to: string): Range {
  const now = Date.now();
  if (p === 'year') return { from: new Date(new Date().getFullYear(), 0, 1).getTime(), to: null };
  if (p === '365') return { from: now - 365 * DAY, to: null };
  if (p === '90') return { from: now - 90 * DAY, to: null };
  if (p === '30') return { from: now - 30 * DAY, to: null };
  if (p === 'custom') return {
    from: from ? new Date(from + 'T00:00:00').getTime() : null,
    to: to ? new Date(to + 'T23:59:59').getTime() : null,
  };
  return { from: null, to: null };
}

const e2 = (v: number) => Math.round(v * 100) / 100;

export default function StatsView({ data, onBack }: { data: AppData; onBack: () => void }) {
  const all = useMemo(() => collectEntries(data), [data]);
  const allGames = useMemo(() => collectGames(data), [data]);
  const [showHouse, setShowHouse] = useState(false);
  const [kind, setKind] = useState<StatKind>('all');
  const [preset, setPreset] = useState<Preset>('all');
  const [from, setFrom] = useState(() => (all.length ? isoDay(all[0].at) : isoDay(Date.now())));
  const [to, setTo] = useState(() => isoDay(Date.now()));
  const [open, setOpen] = useState<string | null>(null);

  const range = rangeFor(preset, from, to);
  const entries = filterEntries(all, kind, range);
  const ps = playerStats(entries);
  const ts = titles(ps, kind, money);
  const games = new Set(entries.map((x) => x.gameId)).size;
  const volume = entries.reduce((a, x) => a + x.buyIn, 0);
  const sel = ps.find((p) => p.id === open) ?? null;
  const gms = filterGames(allGames, kind, range).filter((g) => entries.some((x) => x.gameId === g.gameId));
  const house = houseSummary(gms);

  return (
    <div className="page">
      <div className="wrap stats">
        <button className="btn ghost" onClick={onBack} style={{ marginBottom: 18 }}>{Icon.back} Zurück</button>
        <h1 style={{ marginBottom: 18 }}>Statistik</h1>

        <div className="stats-filters">
          <div className="seg full">
            <button className={kind === 'all' ? 'on' : ''} onClick={() => setKind('all')}>Gesamt</button>
            <button className={kind === 'cash' ? 'on' : ''} onClick={() => setKind('cash')}>Cash-Game</button>
            <button className={kind === 'tourney' ? 'on' : ''} onClick={() => setKind('tourney')}>{Icon.trophy} Turnier</button>
          </div>
          <div className="chips-pick">
            {([['all', 'Alle Spiele'], ['year', 'Dieses Jahr'], ['365', '12 Monate'], ['90', '90 Tage'], ['30', '30 Tage'], ['custom', 'Zeitraum']] as [Preset, string][]).map(([k, l]) => (
              <button key={k} className={'chip' + (preset === k ? ' on' : '')} onClick={() => setPreset(k)}>{l}</button>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="row wrap-row stats-dates">
              <label className="field">Von<input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className="field">Bis<input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            </div>
          )}
        </div>

        {entries.length === 0 ? (
          <div className="empty" style={{ marginTop: 18 }}>
            {all.length === 0 ? 'Noch keine abgeschlossenen Homegames. Die Statistik zählt nur abgerechnete Spiele.' : 'Im gewählten Zeitraum gibt es keine abgeschlossenen Spiele dieser Art.'}
          </div>
        ) : (<>
          <div className="stats-kpis">
            <div className="card kpi"><span className="muted">Spiele</span><b className="num">{games}</b></div>
            <div className="card kpi"><span className="muted">Spieler</span><b className="num">{ps.length}</b></div>
            <div className="card kpi"><span className="muted">Insgesamt eingesetzt</span><b className="num">{money(volume)}</b></div>
          </div>

          {house.total > 0 && <>
          <h3 style={{ marginTop: 24 }}>Rake &amp; Dealer-Tips</h3>
          <div className="stats-kpis house-kpis">
            <div className="card kpi"><span className="muted">Rake gesamt</span><b className="num">{money(house.rake)}</b></div>
            <div className="card kpi"><span className="muted">Ø Rake pro Spiel</span><b className="num">{money(house.avgRake)}</b></div>
            <div className="card kpi"><span className="muted">Tips gesamt</span><b className="num">{money(house.tips)}</b></div>
            <div className="card kpi"><span className="muted">Ø Tips pro Spiel</span><b className="num">{money(house.avgTips)}</b></div>
          </div>
          <div className="row wrap-row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
            <span className="note">Zusammen {money(house.total)} aus {house.games} Spiel{house.games === 1 ? '' : 'en'}. Schnitt über alle Spiele im Zeitraum, auch ohne Rake/Tips.</span>
            <button className="btn ghost sm" onClick={() => setShowHouse((v) => !v)}>{showHouse ? 'Liste ausblenden' : 'Pro Spiel anzeigen'}</button>
          </div>
          {showHouse && (
            <div className="card" style={{ marginTop: 8 }}>
              <div className="stats-games">
                {[...gms].reverse().map((g) => (
                  <div key={g.gameId} className="stats-game">
                    <span className="muted num">{dshort(g.at)}</span>
                    <span className="sg-name">{g.gameName}<span className="note">{g.kind === 'tourney' ? 'Turnier' : 'Cash'} · Rake {money(g.rake)} · Tips {money(g.tips)}</span></span>
                    <b className="num">{money(e2(g.rake + g.tips))}</b>
                  </div>
                ))}
              </div>
            </div>
          )}
          </>}

          {ts.length > 0 && <>
            <h3 style={{ marginTop: 24 }}>Titel</h3>
            <div className="titles">
              {ts.map((t) => (
                <div key={t.key} className={'card title-card t-' + t.key}>
                  <div className="title-name">{t.title}</div>
                  <b className="title-who">{t.who}</b>
                  <div className="title-val num">{t.value}</div>
                  <div className="note">{t.desc}</div>
                </div>
              ))}
            </div>
          </>}

          <h3 style={{ marginTop: 24 }}>Rangliste</h3>
          <div className="card table-card" style={{ padding: 6, overflowX: 'auto' }}>
            <table className="table stack stats-table">
              <thead>
                <tr>
                  <th>Spieler</th><th>Plus / Minus</th><th>Spiele</th><th>Ø pro Spiel</th><th>Bestes</th><th>Schlechtestes</th><th>Eingesetzt</th>
                  {kind === 'tourney' && <><th>Siege</th><th>Im Geld</th><th>Bounties</th><th>Rebuys</th></>}
                  {kind === 'cash' && <th>Nachkäufe</th>}
                  {kind === 'all' && <th>Plus-Spiele</th>}
                </tr>
              </thead>
              <tbody>
                {ps.map((p, i) => (
                  <tr key={p.id} className="clickable" onClick={() => setOpen(p.id)}>
                    <td><span className="stats-name"><span className="muted num rank">{i + 1}.</span><Avatar name={p.name} /><b>{p.name}</b></span></td>
                    <td><b className={'num ' + cls(p.result)}>{money(p.result, true)}</b></td>
                    <td className="num">{p.games}</td>
                    <td className={'num ' + cls(p.avg)}>{money(p.avg, true)}</td>
                    <td className={'num ' + cls(p.best)}>{money(p.best, true)}</td>
                    <td className={'num ' + cls(p.worst)}>{money(p.worst, true)}</td>
                    <td className="num">{money(p.buyIn)}</td>
                    {kind === 'tourney' && <><td className="num">{p.wins}</td><td className="num">{p.itm}</td><td className="num">{p.bounties}{p.bountyWon > 0 ? ` · ${money(p.bountyWon)}` : ''}</td><td className="num">{p.rebuys}</td></>}
                    {kind === 'cash' && <td className="num">{p.rebuys}</td>}
                    {kind === 'all' && <td className="num">{p.plusGames} / {p.games}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="note" style={{ marginTop: 10 }}>
            Nur abgeschlossene Spiele. Cash-Game: Chipwert beim Cash-out minus Buy-ins. Turnier: Preisgeld plus Bounties minus alle Einstiege. Angeschriebene Beträge zählen wie bar. Spieler antippen für den Verlauf.
          </div>
        </>)}
      </div>
      {sel && <PlayerDetail p={sel} kind={kind} onClose={() => setOpen(null)} />}
    </div>
  );
}

function PlayerDetail({ p, kind, onClose }: { p: PlayerStat; kind: StatKind; onClose: () => void }) {
  const list = [...p.entries].reverse();
  return (
    <Modal title={`${p.name} · ${kind === 'all' ? 'Gesamt' : kind === 'cash' ? 'Cash-Game' : 'Turnier'}`} wide onClose={onClose} footer={<button className="btn" onClick={onClose}>Schließen</button>}>
      <div className="stats-mini">
        <div><span className="muted">Plus / Minus</span><b className={'num ' + cls(p.result)}>{money(p.result, true)}</b></div>
        <div><span className="muted">Spiele</span><b className="num">{p.games}</b></div>
        <div><span className="muted">Ø pro Spiel</span><b className={'num ' + cls(p.avg)}>{money(p.avg, true)}</b></div>
        {kind !== 'cash' && p.wins + p.itm + p.bounties > 0 && <div><span className="muted">Siege · im Geld · Bounties</span><b className="num">{p.wins} · {p.itm} · {p.bounties}</b></div>}
      </div>
      <ResultChart entries={p.entries} />
      <div className="section">
        <h3>Spiele</h3>
        <div className="stats-games">
          {list.map((x) => (
            <div key={x.gameId} className="stats-game">
              <span className="muted num">{dshort(x.at)}</span>
              <span className="sg-name">{x.gameName}<span className="note">{x.kind === 'tourney' ? `Turnier${x.place ? ` · Platz ${x.place}/${x.field}` : ''}${x.bounties ? ` · ${x.bounties} Bount${x.bounties === 1 ? 'y' : 'ies'}` : ''}${x.rebuys ? ` · ${x.rebuys} Rebuy${x.rebuys === 1 ? '' : 's'}` : ''}` : `Cash · ${money(x.buyIn)} eingekauft`}</span></span>
              <b className={'num ' + cls(x.result)}>{money(x.result, true)}</b>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/** Verlauf: kumuliertes Plus/Minus über die Spiele, Punkte je Spiel (grün = Plus, rot = Minus). */
export function ResultChart({ entries }: { entries: Entry[] }) {
  const [hi, setHi] = useState<number | null>(null);
  const W = 640, H = 220, L = 58, R = 14, T = 14, B = 28;
  let sum = 0;
  const pts = [{ v: 0, x: null as Entry | null }, ...entries.map((x) => ({ v: (sum = Math.round((sum + x.result) * 100) / 100), x }))];
  const vals = pts.map((p) => p.v);
  let lo = Math.min(0, ...vals), up = Math.max(0, ...vals);
  if (lo === up) { lo -= 10; up += 10; }
  const pad = (up - lo) * 0.08; lo -= pad; up += pad;
  const n = pts.length - 1;
  const X = (i: number) => L + (n === 0 ? (W - L - R) / 2 : (i / n) * (W - L - R));
  const Y = (v: number) => T + (1 - (v - lo) / (up - lo)) * (H - T - B);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  const area = `${path}L${X(n).toFixed(1)},${Y(0).toFixed(1)}L${X(0).toFixed(1)},${Y(0).toFixed(1)}Z`;
  const last = vals[vals.length - 1];
  const color = last >= 0 ? 'var(--green)' : 'var(--red)';
  const h = hi != null ? pts[hi] : null;
  const ticks = [up - pad, (up + lo) / 2, lo + pad];
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="result-chart" onMouseLeave={() => setHi(null)}>
        <defs>
          <linearGradient id="rc-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".28" /><stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((v, i) => <g key={i}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} className="grid" /><text x={L - 8} y={Y(v) + 4} textAnchor="end" className="axis">{fmt(Math.round(v))}</text></g>)}
        <line x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} className="zero" />
        <path d={area} fill="url(#rc-fill)" />
        <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => i > 0 && (
          <g key={i} onMouseEnter={() => setHi(i)} onClick={() => setHi(hi === i ? null : i)} style={{ cursor: 'pointer' }}>
            <circle cx={X(i)} cy={Y(p.v)} r="14" fill="transparent" />
            <circle cx={X(i)} cy={Y(p.v)} r={hi === i ? 6 : 4} fill={p.x!.result >= 0 ? 'var(--green)' : 'var(--red)'} stroke="var(--surface)" strokeWidth="2" />
          </g>
        ))}
        {n > 0 && <><text x={X(1)} y={H - 8} textAnchor={n === 1 ? 'middle' : 'start'} className="axis">{dshort(pts[1].x!.at)}</text>
          {n > 1 && <text x={X(n)} y={H - 8} textAnchor="end" className="axis">{dshort(pts[n].x!.at)}</text>}</>}
      </svg>
      <div className="chart-info">
        {h && h.x ? <><b>{h.x.gameName}</b> · {dshort(h.x.at)} · <span className={cls(h.x.result)}>{money(h.x.result, true)}</span> · Stand <span className={cls(h.v)}>{money(h.v, true)}</span></>
          : <span className="muted">Punkt antippen für Details · Linie = Gesamtstand nach jedem Spiel</span>}
      </div>
    </div>
  );
}
