import { tourneySettlement } from './tourney';
import { Game, ROUND_STEP, Settlement, computeSettlement, fmt, fmtDuration } from './logic';

const nameOf = (st: Settlement, id: string) => st.rows.find((r) => r.id === id)?.name ?? '?';
const dateStr = (g: Game) => new Date(g.startedAt ?? g.createdAt).toLocaleDateString('de-DE');
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

export function settlementOf(g: Game) {
  return computeSettlement(g, g.final ?? { chips: {}, adjust: {}, ignoreDiff: false });
}

export function paymentLines(g: Game, st: Settlement): string[] {
  const lines: string[] = [];
  if (g.settleMode === 'suggestions') {
    for (const t of st.transfers) lines.push(`${nameOf(st, t.from)} zahlt ${fmt(t.amount)} an ${nameOf(st, t.to)}`);
    for (const p of st.cashPayouts) lines.push(`${nameOf(st, p.id)} bekommt ${fmt(p.amount)} bar aus der Kasse`);
  } else {
    for (const r of st.rows.filter((r) => r.settle < 0)) lines.push(`${r.name} zahlt ${fmt(-r.settle)} in die Kasse`);
    for (const r of st.rows.filter((r) => r.settle > 0)) lines.push(`${r.name} bekommt ${fmt(r.settle)} aus der Kasse`);
  }
  return lines;
}

export function toText(g: Game): string {
  if (g.kind === 'tourney') return toTextTourney(g);
  const st = settlementOf(g);
  const dur = g.startedAt && g.endedAt ? fmtDuration(g.endedAt - g.startedAt) : '–';
  const L: string[] = [];
  L.push(`${g.name} (${dateStr(g)})`);
  L.push(`Spielzeit ${dur} · ${st.rows.length} Spieler`);
  L.push(`Gesamt-Buy-ins ${fmt(st.totalIn)} · bar eingezahlt ${fmt(st.cashIn)}`);
  if (st.rake || st.tips) L.push(`Rake ${fmt(st.rake)} · Dealer-Tips ${fmt(st.tips)}`);
  L.push('');
  L.push('ERGEBNISSE');
  for (const r of [...st.rows].sort((a, b) => b.result - a.result)) {
    L.push(`${fmt(r.result, { sign: true }).padStart(9)}  ${r.name}  (Buy-in ${fmt(r.totalIn)}, Cash-out ${fmt(r.chips)})`);
  }
  L.push('');
  L.push(`ZAHLUNGEN (gerundet auf ${ROUND_STEP} €)`);
  const early = st.rows.filter((r) => r.early && r.earlyPaid > 0);
  for (const r of early) L.push(`${r.name} hat beim Gehen ${fmt(r.earlyPaid)} bar erhalten`);
  const pl = paymentLines(g, st);
  if (pl.length === 0 && early.length === 0) L.push('Keine offenen Zahlungen');
  L.push(...pl);
  if (st.rake || st.tips) L.push(`Rake/Tips ${fmt(st.rake + st.tips)} aus der Kasse entnehmen`);
  if (Math.abs(st.roundingRest) >= 0.01) L.push(`Rundungsrest in der Kasse: ${fmt(st.roundingRest)}`);
  return L.join('\n');
}

export function toHtml(g: Game): string {
  if (g.kind === 'tourney') return toHtmlTourney(g);
  const st = settlementOf(g);
  const dur = g.startedAt && g.endedAt ? fmtDuration(g.endedAt - g.startedAt) : '–';
  const col = (v: number) => (v > 0 ? '#0f8a55' : v < 0 ? '#c2343f' : '#666');
  const rows = [...st.rows].sort((a, b) => b.result - a.result).map((r) => `
    <tr>
      <td>${esc(r.name)}${r.early ? ' <span class="tag">früh</span>' : ''}</td>
      <td>${fmt(r.totalIn)}</td><td>${fmt(r.paidCash)}</td>
      <td style="color:${r.open > 0 ? '#b7791f' : '#999'}">${fmt(r.open)}</td>
      <td>${fmt(r.chips)}</td>
      <td style="color:${col(r.result)};font-weight:700">${fmt(r.result, { sign: true })}</td>
      <td>${r.earlyPaid ? fmt(r.earlyPaid) : '–'}</td>
      <td style="color:${col(r.settle)};font-weight:700">${r.settle ? fmt(r.settle, { sign: true }) : '–'}<div class="ex">exakt ${fmt(r.settleExact, { sign: true })}</div></td>
    </tr>`).join('');
  const pays = paymentLines(g, st).map((l) => `<li>${esc(l)}</li>`).join('') || '<li>Keine offenen Zahlungen</li>';
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
    body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1d24;margin:36px 40px;font-size:12.5px}
    h1{font-size:22px;margin:0 0 4px} .sub{color:#666;margin-bottom:20px}
    .k{display:flex;gap:12px;margin-bottom:22px}.k div{flex:1;border:1px solid #e3e5ea;border-radius:8px;padding:10px 12px}
    .k span{display:block;color:#777;font-size:11px}.k b{font-size:16px}
    table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
    th{font-size:10.5px;color:#777;text-align:right;border-bottom:1px solid #d5d8de;padding:7px 8px}
    td{text-align:right;border-bottom:1px solid #eceef2;padding:8px}
    th:first-child,td:first-child{text-align:left}
    .ex{font-size:10px;color:#999;font-weight:400}.tag{font-size:10px;color:#777;border:1px solid #ccc;border-radius:8px;padding:0 5px}
    h2{font-size:14px;margin:24px 0 8px} li{margin:4px 0;font-size:13px} .n{color:#777;font-size:11px;margin-top:14px}
  </style></head><body>
    <h1>${esc(g.name)}</h1>
    <div class="sub">${dateStr(g)} · Spielzeit ${dur} · ${st.rows.length} Spieler</div>
    <div class="k">
      <div><span>Gesamt-Buy-ins</span><b>${fmt(st.totalIn)}</b></div>
      <div><span>Bar eingezahlt</span><b>${fmt(st.cashIn)}</b></div>
      <div><span>Rake</span><b>${fmt(st.rake)}</b></div>
      <div><span>Dealer-Tips</span><b>${fmt(st.tips)}</b></div>
    </div>
    <table><thead><tr><th>Spieler</th><th>Eingekauft</th><th>Davon bar</th><th>Davon offen</th><th>Cash-out</th><th>Spielergebnis</th><th>Früh erhalten</th><th>Abrechnung</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <h2>Zahlungen ${g.settleMode === 'suggestions' ? '(Zahlungsvorschläge)' : '(über die Kasse)'}</h2>
    <ul>${pays}${st.rake || st.tips ? `<li>Rake/Tips ${fmt(st.rake + st.tips)} aus der Kasse entnehmen</li>` : ''}${Math.abs(st.roundingRest) >= 0.01 ? `<li>Rundungsrest in der Kasse: ${fmt(st.roundingRest)}</li>` : ''}</ul>
    <div class="n">Abrechnung: positiv = bekommt, negativ = zahlt. Beträge fair auf ${ROUND_STEP} € gerundet, exakter Wert jeweils darunter. Erstellt mit Pokerkasse.</div>
  </body></html>`;
}

export const fileBase = (g: Game) => `${g.name.replace(/[\\/:*?"<>|]/g, '-')}`;

// ---------- Turnier ----------

export function toTextTourney(g: Game): string {
  const { st, rows, rest, unassignedBounties } = tourneySettlement(g);
  const t = g.tourney!;
  const dur = g.startedAt && g.endedAt ? fmtDuration(g.endedAt - g.startedAt) : '–';
  const L: string[] = [];
  L.push(`${g.name} – Turnier (${dateStr(g)})`);
  L.push(`Spielzeit ${dur} · ${rows.length} Spieler · ${st.entries} Einträge (${st.rebuys} Rebuys)`);
  L.push(`Buy-in ${fmt(t.buyIn)}${t.bounty ? ` + ${fmt(t.bounty)} Bounty` : ''} · Preispool ${fmt(st.prizePool)}`);
  L.push('');
  L.push('PLATZIERUNG');
  for (const r of rows) {
    const extra = [r.prize ? `Preisgeld ${fmt(r.prize)}` : '', r.bountyWon ? `Bounties ${fmt(r.bountyWon)}` : ''].filter(Boolean).join(', ');
    L.push(`${String(r.place ?? '–').padStart(2)}. ${r.name}  ${fmt(r.result, { sign: true })}${extra ? `  (${extra})` : ''}`);
  }
  L.push('');
  L.push('ZAHLUNGEN');
  const pay = rows.filter((r) => r.settle > 0).map((r) => `${r.name} bekommt ${fmt(r.settle)} aus der Kasse`);
  const owe = rows.filter((r) => r.settle < 0).map((r) => `${r.name} zahlt noch ${fmt(-r.settle)} (angeschrieben)`);
  L.push(...owe, ...pay);
  if (!pay.length && !owe.length) L.push('Keine Zahlungen');
  if (Math.abs(rest) >= 0.01) L.push(`Rest in der Kasse: ${fmt(rest)}`);
  if (unassignedBounties > 0) L.push(`Nicht zugeordnete Bounties: ${fmt(unassignedBounties)}`);
  return L.join('\n');
}

export function toHtmlTourney(g: Game): string {
  const { st, rows, rest } = tourneySettlement(g);
  const t = g.tourney!;
  const dur = g.startedAt && g.endedAt ? fmtDuration(g.endedAt - g.startedAt) : '–';
  const col = (v: number) => (v > 0 ? '#0f8a55' : v < 0 ? '#c2343f' : '#666');
  const body = rows.map((r) => `<tr><td>${r.place ?? '–'}.</td><td style="text-align:left">${esc(r.name)}</td><td>${fmt(r.totalIn)}</td><td>${fmt(r.paidCash)}</td>
    <td style="color:${r.open > 0 ? '#b7791f' : '#999'}">${fmt(r.open)}</td><td>${r.prize ? fmt(r.prize) : '–'}</td>${t.bounty ? `<td>${r.bountyWon ? fmt(r.bountyWon) : '–'}</td>` : ''}
    <td style="color:${col(r.result)};font-weight:700">${fmt(r.result, { sign: true })}</td><td style="color:${col(r.settle)};font-weight:700">${r.settle ? fmt(r.settle, { sign: true }) : '–'}</td></tr>`).join('');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>
    body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1d24;margin:36px 40px;font-size:12.5px}
    h1{font-size:22px;margin:0 0 4px} .sub{color:#666;margin-bottom:20px}
    .k{display:flex;gap:12px;margin-bottom:22px}.k div{flex:1;border:1px solid #e3e5ea;border-radius:8px;padding:10px 12px}
    .k span{display:block;color:#777;font-size:11px}.k b{font-size:16px}
    table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
    th{font-size:10.5px;color:#777;text-align:right;border-bottom:1px solid #d5d8de;padding:7px 8px}
    td{text-align:right;border-bottom:1px solid #eceef2;padding:8px}
    th:first-child,td:first-child{text-align:left} .n{color:#777;font-size:11px;margin-top:14px}
  </style></head><body>
    <h1>${esc(g.name)} – Turnier</h1>
    <div class="sub">${dateStr(g)} · Spielzeit ${dur} · ${rows.length} Spieler · ${st.entries} Einträge (${st.rebuys} Rebuys)</div>
    <div class="k">
      <div><span>Buy-in</span><b>${fmt(t.buyIn)}${t.bounty ? ` + ${fmt(t.bounty)}` : ''}</b></div>
      <div><span>Preispool</span><b>${fmt(st.prizePool)}</b></div>
      ${t.bounty ? `<div><span>Bounties</span><b>${fmt(st.bountyPool)}</b></div>` : ''}
      <div><span>Auszahlung</span><b>${t.payouts.slice(0, st.prizes.length).map((p, i) => `${i + 1}. ${p} %`).join(' · ')}</b></div>
    </div>
    <table><thead><tr><th>Platz</th><th style="text-align:left">Spieler</th><th>Eingezahlt</th><th>Davon bar</th><th>Davon offen</th><th>Preisgeld</th>${t.bounty ? '<th>Bounties</th>' : ''}<th>Ergebnis</th><th>Bekommt / zahlt</th></tr></thead>
    <tbody>${body}</tbody></table>
    <div class="n">Bekommt / zahlt = Preisgeld${t.bounty ? ' + Bounties' : ''} − noch angeschriebener Betrag. Preisgelder auf ${ROUND_STEP} € gerundet${Math.abs(rest) >= 0.01 ? `, Rest in der Kasse ${fmt(rest)}` : ''}. Erstellt mit Pokerkasse.</div>
  </body></html>`;
}
