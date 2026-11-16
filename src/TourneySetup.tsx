import { TourneyConfig, StructItem, entryPrice, levelNo, maxPer, tablesNeeded, uselessDenoms } from './tourney';
import { fmt } from './logic';
import { Icon, NumInput } from './ui';

type Set = (fn: (t: TourneyConfig) => void) => void;

export function tourneyErrors(t: TourneyConfig): string[] {
  const e: string[] = [];
  if (!(t.buyIn > 0)) e.push('Buy-in fehlt.');
  if (t.bounty != null && !(t.bounty > 0)) e.push('Bounty-Betrag fehlt.');
  if (!(t.startChips > 0)) e.push('Startchips fehlen.');
  if (!t.structure.some((x) => x.kind === 'level')) e.push('Mindestens ein Blind-Level anlegen.');
  if (t.structure.some((x) => !(x.minutes > 0))) e.push('Jedes Level und jede Pause braucht eine Dauer.');
  if (t.structure.some((x) => x.kind === 'level' && (!(x.bb > 0) || !(x.sb > 0) || x.sb > x.bb))) e.push('Small Blind muss zwischen 1 und Big Blind liegen.');
  const sum = t.payouts.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 0.001) e.push(`Auszahlung ergibt ${sum} % statt 100 %.`);
  if (t.rebuy.enabled && !(t.rebuyChips > 0)) e.push('Rebuy-Chips fehlen.');
  if (!(t.maxPerTable >= 2)) e.push('Max. Spieler pro Tisch muss mindestens 2 sein.');
  if (!((t.balanceDiff ?? 2) >= 2)) e.push('Ausgleichen ab Unterschied von mindestens 2 Spielern (1 lässt sich nicht vermeiden).');
  return e;
}

export default function TourneySetup({ t, set, players }: { t: TourneyConfig; set: Set; players: number }) {
  const levels = t.structure.filter((x) => x.kind === 'level').length;
  const setItem = (i: number, fn: (x: StructItem) => void) => set((c) => fn(c.structure[i]));
  const move = (i: number, d: number) => set((c) => { const j = i + d; if (j < 0 || j >= c.structure.length) return; [c.structure[i], c.structure[j]] = [c.structure[j], c.structure[i]]; });
  const addLevel = () => set((c) => {
    const last = [...c.structure].reverse().find((x) => x.kind === 'level');
    const mins = last?.minutes ?? 20;
    c.structure.push(last && last.kind === 'level' ? { kind: 'level', sb: last.bb, bb: last.bb * 2, minutes: mins } : { kind: 'level', sb: 25, bb: 50, minutes: mins });
  });
  const allMinutes = (m: number | null) => set((c) => { if (m) for (const x of c.structure) if (x.kind === 'level') x.minutes = m; });
  const firstLevelMin = (t.structure.find((x) => x.kind === 'level') as { minutes: number } | undefined)?.minutes ?? null;
  const sum = t.payouts.reduce((a, b) => a + b, 0);
  const useless = t.denominations.length > 1 ? uselessDenoms(t, 0).useless : [];

  return (
    <div style={{ display: 'grid', gap: 22 }}>
      <div className="section">
        <h3>Buy-in und Chips</h3>
        <div className="form-grid">
          <label className="field">Buy-in (Preispool)<NumInput value={t.buyIn} onChange={(v) => set((c) => { c.buyIn = v ?? 0; })} suffix="€" /></label>
          <label className="field">Startchips<NumInput value={t.startChips} onChange={(v) => set((c) => { c.startChips = v ?? 0; })} /></label>
          <label className="field">Chipwerte (mit Komma getrennt)
            <input className="input" defaultValue={t.denominations.join(', ')} onChange={(e) => set((c) => { c.denominations = e.target.value.split(/[,;\s]+/).map(Number).filter((x) => x > 0).sort((a, b) => a - b); })} />
          </label>
          <label className="field">Max. Spieler pro Tisch<NumInput value={t.maxPerTable} onChange={(v) => set((c) => { c.maxPerTable = Math.min(12, v ?? 0); })} /></label>
          <label className="field">Tische ausgleichen ab Unterschied von<NumInput value={t.balanceDiff ?? 2} onChange={(v) => set((c) => { c.balanceDiff = v ?? 0; })} suffix="Spielern" /></label>
        </div>
        <label className="check">
          <input type="checkbox" checked={t.bounty != null} onChange={(e) => set((c) => { c.bounty = e.target.checked ? 5 : null; })} />
          <span>Bounties</span>
          {t.bounty != null && <NumInput value={t.bounty} onChange={(v) => set((c) => { c.bounty = v ?? 0; })} suffix="€" width={110} />}
        </label>
        {players > 0 && t.maxPerTable >= 2 && <div className="note">{players} Spieler → {tablesNeeded(players, maxPer(t))} Tisch{tablesNeeded(players, maxPer(t)) > 1 ? 'e' : ''}. Sitzplätze und ein Dealer-Button-Platz (gleich für alle Tische) werden ausgelost. Finaltisch, sobald alle an einen Tisch passen.</div>}
        <div className="note">Pro Einstieg zahlt jeder <b>{fmt(entryPrice(t))}</b>{t.bounty != null ? ` – davon ${fmt(t.buyIn)} in den Preispool und ${fmt(t.bounty)} Bounty. Die Bounty bekommt, wer den Spieler rauswirft.` : '.'}</div>
        {useless.length > 0 && <div className="note">Chips {useless.join(', ')} werden schon ab Level 1 nicht gebraucht.</div>}
      </div>

      <div className="section">
        <div className="row wrap-row"><h3>Blindstruktur</h3><div className="spacer" />
          <label className="field inline">Level-Dauer für alle<NumInput value={firstLevelMin} onChange={allMinutes} suffix="Min" width={110} /></label>
        </div>
        <div className="struct">
          <div className="struct-head"><span>#</span><span>Small Blind</span><span>Big Blind</span><span>Minuten</span><span /></div>
          {t.structure.map((it, i) => (
            <div key={i} className={'struct-row' + (it.kind === 'break' ? ' brk' : '')}>
              <span className="struct-no">{it.kind === 'level' ? levelNo(t.structure, i) : Icon.pause}</span>
              {it.kind === 'level' ? <>
                <NumInput value={it.sb} onChange={(v) => setItem(i, (x) => { if (x.kind === 'level') x.sb = v ?? 0; })} />
                <NumInput value={it.bb} onChange={(v) => setItem(i, (x) => { if (x.kind === 'level') { const old = x.bb; x.bb = v ?? 0; if (x.sb === old / 2 || !x.sb) x.sb = Math.floor((v ?? 0) / 2); } })} />
              </> : <span className="struct-brk">Pause</span>}
              <NumInput value={it.minutes} onChange={(v) => setItem(i, (x) => { x.minutes = v ?? 0; })} suffix="Min" />
              <span className="struct-act">
                <button className="btn ghost sm" title="Nach oben" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                <button className="btn ghost sm" title="Nach unten" onClick={() => move(i, 1)} disabled={i === t.structure.length - 1}>↓</button>
                <button className="btn ghost sm danger" title="Entfernen" onClick={() => set((c) => { c.structure.splice(i, 1); })}>{Icon.trash}</button>
              </span>
            </div>
          ))}
        </div>
        <div className="row wrap-row">
          <button className="btn" onClick={addLevel}>{Icon.plus} Level</button>
          <button className="btn" onClick={() => set((c) => { c.structure.push({ kind: 'break', minutes: 10 }); })}>{Icon.pause} Pause</button>
        </div>
        <label className="check">
          <input type="checkbox" checked={t.anteFromLevel != null} onChange={(e) => set((c) => { c.anteFromLevel = e.target.checked ? Math.min(4, levels || 1) : null; })} />
          <span>Big-Blind-Ante ab Level</span>
          {t.anteFromLevel != null && <NumInput value={t.anteFromLevel} onChange={(v) => set((c) => { c.anteFromLevel = v ?? 1; })} width={90} />}
        </label>
        <div className="note">Neues Level übernimmt die Dauer des letzten und verdoppelt den Big Blind – Werte danach einfach anpassen. Ab dem Ante-Level zahlt der Big Blind zusätzlich eine Ante in Höhe eines Big Blinds.</div>
      </div>

      <div className="section">
        <h3>Rebuy und Late Registration</h3>
        <WindowRow label="Rebuy bis Level" w={t.rebuy} levels={levels} set={(fn) => set((c) => fn(c.rebuy))} />
        {t.rebuy.enabled && (
          <div className="form-grid">
            <label className="field">Chips pro Rebuy<NumInput value={t.rebuyChips} onChange={(v) => set((c) => { c.rebuyChips = v ?? 0; })} /></label>
            <label className="field">Max. Rebuys pro Spieler<NumInput value={t.rebuy.maxPerPlayer} onChange={(v) => set((c) => { c.rebuy.maxPerPlayer = v || null; })} placeholder="unbegrenzt" /></label>
          </div>
        )}
        <WindowRow label="Late Registration bis Level" w={t.lateReg} levels={levels} set={(fn) => set((c) => fn(c.lateReg))} />
      </div>

      <div className="section">
        <div className="row"><h3>Auszahlung</h3><div className="spacer" /><span className={sum === 100 ? 'muted' : 'neg'} style={{ fontSize: 13 }}>Summe {sum} %</span></div>
        <div className="payouts">
          {t.payouts.map((p, i) => (
            <div key={i} className="row">
              <span className="place">{i + 1}.</span>
              <NumInput value={p} onChange={(v) => set((c) => { c.payouts[i] = v ?? 0; })} suffix="%" width={110} />
              <button className="btn ghost sm danger" onClick={() => set((c) => { c.payouts.splice(i, 1); })} disabled={t.payouts.length <= 1}>{Icon.trash}</button>
            </div>
          ))}
        </div>
        <div className="row wrap-row">
          <button className="btn" onClick={() => set((c) => { c.payouts.push(0); })}>{Icon.plus} Platz</button>
          <button className="btn ghost" onClick={() => set((c) => { c.payouts = [50, 30, 20]; })}>50 / 30 / 20</button>
        </div>
        <div className="note">Preisgelder werden auf 5 € gerundet. Gibt es weniger Spieler als bezahlte Plätze, wird auf die vorhandenen Plätze verteilt.</div>
      </div>
    </div>
  );
}

function WindowRow({ label, w, levels, set }: { label: string; w: { enabled: boolean; untilLevel: number; inBreakAfter: boolean }; levels: number; set: (fn: (w: { enabled: boolean; untilLevel: number; inBreakAfter: boolean }) => void) => void }) {
  return (
    <div className="row wrap-row">
      <label className="check">
        <input type="checkbox" checked={w.enabled} onChange={(e) => set((x) => { x.enabled = e.target.checked; })} />
        <span>{label}</span>
      </label>
      {w.enabled && <>
        <NumInput value={w.untilLevel} onChange={(v) => set((x) => { x.untilLevel = Math.max(1, v ?? 1); })} width={90} />
        {levels > 0 && w.untilLevel > levels && <span className="note">(nur {levels} Level angelegt)</span>}
        <label className="check">
          <input type="checkbox" checked={w.inBreakAfter} onChange={(e) => set((x) => { x.inBreakAfter = e.target.checked; })} />
          <span>auch in der Pause danach</span>
        </label>
      </>}
    </div>
  );
}
