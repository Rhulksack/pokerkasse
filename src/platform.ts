import { AppData } from './logic';

export const isElectron = () => !!window.api;
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Datei teilen (iPhone: Teilen-Menü → In Dateien sichern, AirDrop, WhatsApp) oder herunterladen. */
export async function shareOrDownload(name: string, content: string, type: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([content], name, { type });
  const nav = navigator as any;
  if (nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: name }); return 'shared'; }
    catch (e: any) { if (e?.name === 'AbortError') return 'cancelled'; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}

/** Text teilen (z. B. WhatsApp) – Fallback: Zwischenablage. */
export async function shareText(text: string): Promise<'shared' | 'copied' | 'cancelled'> {
  const nav = navigator as any;
  if (nav.share && isIOS()) {
    try { await nav.share({ text }); return 'shared'; }
    catch (e: any) { if (e?.name === 'AbortError') return 'cancelled'; }
  }
  await navigator.clipboard.writeText(text);
  return 'copied';
}

/** Druckt ein komplettes HTML-Dokument über den Druckdialog (iPhone: Teilen → In Dateien sichern = PDF). */
export function printHtml(html: string, title: string) {
  document.getElementById('print-root')?.remove();
  const host = document.createElement('div');
  host.id = 'print-root';
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  root.innerHTML = [...doc.head.querySelectorAll('style')].map((s) => s.outerHTML).join('')
    .replace(/\bbody\s*\{/g, '.body{') + `<div class="body">${doc.body.innerHTML}</div>`;
  const oldTitle = document.title;
  document.title = title;
  const cleanup = () => { host.remove(); document.title = oldTitle; window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => window.print(), 50);
}

export function isAppData(x: any): x is AppData {
  return x && typeof x === 'object' && Array.isArray(x.players) && Array.isArray(x.games)
    && x.games.every((g: any) => g && typeof g.id === 'string' && Array.isArray(g.events) && Array.isArray(g.players));
}

/** Zusammenführen: fehlende Spieler/Homegames übernehmen; bei gleicher ID gewinnt die Version mit mehr Ereignissen. */
export function mergeData(cur: AppData, inc: AppData): { data: AppData; added: number; updated: number } {
  const data = structuredClone(cur);
  let added = 0, updated = 0;
  for (const p of inc.players) if (!data.players.some((x) => x.id === p.id || x.name.toLowerCase() === p.name.toLowerCase())) data.players.push(p);
  for (const g of inc.games) {
    const i = data.games.findIndex((x) => x.id === g.id);
    if (i < 0) { data.games.push(g); added++; }
    else if (g.events.length > data.games[i].events.length || (g.status === 'finished' && data.games[i].status !== 'finished')) { data.games[i] = g; updated++; }
  }
  return { data, added, updated };
}

/** Füllt data-label der Tabellenzellen aus dem Tabellenkopf (für die Kartenansicht auf dem Handy). */
export function autoLabelTables() {
  const run = () => {
    document.querySelectorAll<HTMLTableElement>('table.table').forEach((t) => {
      const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent ?? '');
      t.querySelectorAll('tbody tr, tfoot tr').forEach((tr) =>
        [...tr.children].forEach((td, i) => { if (td.getAttribute('data-label') !== heads[i]) td.setAttribute('data-label', heads[i] ?? ''); }));
    });
  };
  new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
  run();
}
