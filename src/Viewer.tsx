// Nur-Lesen-Ansichten für Mitglieder (ohne Admin-Rechte).
import { AppData, Game, deriveState, fmt, fmtDuration } from './logic';
import type { Update } from './App';
import { Avatar, Icon, useNow } from './ui';
import SettlementView from './SettlementView';
import TourneySettlement from './TourneySettlement';
import { TvScreen } from './TourneyView';

export function ViewGame({ game, update, onBack }: { game: Game; data: AppData; update: Update; onBack: () => void }) {
  if (game.status === 'finished')
    return game.kind === 'tourney'
      ? <TourneySettlement game={game} update={update} onBack={onBack} />
      : <SettlementView game={game} update={update} onBack={onBack} />;
  if (game.kind === 'tourney') return (
    <div className="viewer-tv">
      <TvScreen game={game} viewer />
      <button className="btn viewer-back" onClick={onBack}>{Icon.back} Zurück</button>
    </div>
  );
  return <CashLive game={game} onBack={onBack} />;
}

function CashLive({ game, onBack }: { game: Game; onBack: () => void }) {
  const now = useNow(true);
  const s = deriveState(game);
  const rows = [...s.players].sort((a, b) => b.totalIn - a.totalIn);
  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 760 }}>
        <button className="btn ghost" onClick={onBack} style={{ marginBottom: 18 }}>{Icon.back} Zurück</button>
        <div className="row" style={{ marginBottom: 6 }}>
          <h1>{game.name}</h1><div className="spacer" />
          {game.status === 'running' ? <span className="badge live"><span className="dot" />Läuft</span> : <span className="badge neutral">Nicht gestartet</span>}
        </div>
        <div className="muted" style={{ marginBottom: 20 }}>Nur ansehen · Spielzeit {game.startedAt ? fmtDuration(now - game.startedAt) : '–'}</div>
        <div className="stats-kpis house-kpis" style={{ marginBottom: 18 }}>
          <div className="card kpi"><span className="muted">Buy-ins gesamt</span><b className="num">{fmt(s.totalIn)}</b></div>
          <div className="card kpi"><span className="muted">Kasse (bar)</span><b className="num">{fmt(s.cashBox)}</b></div>
          <div className="card kpi"><span className="muted">Angeschrieben</span><b className="num">{fmt(s.open)}</b></div>
          <div className="card kpi"><span className="muted">Spieler</span><b className="num">{game.players.length}</b></div>
        </div>
        <div className="card" style={{ padding: 14, display: 'grid', gap: 8 }}>
          {rows.map((p) => (
            <div className="h member" key={p.id}>
              <Avatar name={p.name} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{p.name}</b>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {p.buyins.length} Buy-in{p.buyins.length === 1 ? '' : 's'}{p.cashout ? ' · ausgecasht ' + fmt(p.cashout.payoutCash) : ''}
                </div>
              </div>
              {p.open > 0 && <span className="num openc">{fmt(p.open)} offen</span>}
              <b className="num">{fmt(p.totalIn)}</b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
