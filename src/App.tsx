import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { AppData, Game, MasterPlayer, deriveState, emptyData, fmt, fmtDuration, uid } from './logic';
import { loadData } from './storage';
import { Session, canSee, isAdminRole, useMembers, useSession, useSyncedData } from './cloud';
import { AccountModal, LoginScreen, MembersView, PendingScreen } from './Auth';
import { ViewGame } from './Viewer';
import { Avatar, Icon, Modal, fmtDate, useNow } from './ui';
import GameView from './GameView';
import TourneyView, { TvWindow } from './TourneyView';
import { PresetBar } from './Presets';
import StatsView from './StatsView';
import TourneySetup, { tourneyErrors } from './TourneySetup';
import { TourneyConfig, defaultTourney, drawSeats, entryPrice, maxPer, tourneyState } from './tourney';
import { isAppData, isElectron, isIOS, isStandalone, mergeData, shareOrDownload } from './platform';

export type Update = (fn: (d: AppData) => void) => void;

type Route = { view: 'home' } | { view: 'new' } | { view: 'players' } | { view: 'stats' } | { view: 'members' } | { view: 'game'; id: string };

export default function App() {
  const s = useSession();
  if (s === undefined) return <div className="page"><div className="wrap muted" style={{ paddingTop: 60, textAlign: 'center' }}>Lade …</div></div>;
  if (s === null) return <LoginScreen />;
  if (!canSee(s)) return <PendingScreen s={s} />;
  return <Main s={s} />;
}

function Main({ s }: { s: Session }) {
  const admin = isAdminRole(s.role);
  const [toast, setToast] = useState('');
  const notify = useCallback((m: string) => setToast(m), []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t); }, [toast]);
  const { data, update, replace, sync } = useSyncedData(admin, notify);
  const [route, setRoute] = useState<Route>({ view: 'home' });
  const members = useMembers(admin);
  const openClaims = members.filter((m) => m.claim).length;

  if (!data) return <div className="page"><div className="wrap muted" style={{ paddingTop: 60, textAlign: 'center' }}>{sync.error || 'Lade Daten …'}</div></div>;

  const tv = location.hash.match(/^#tv=(.+)$/);
  if (tv) return <TvWindow gameId={decodeURIComponent(tv[1])} data={data} />;

  const home = () => setRoute({ view: 'home' });
  let view: JSX.Element;
  const g = route.view === 'game' ? data.games.find((x) => x.id === route.id) : undefined;
  if (g && !admin) view = <ViewGame game={g} data={data} update={update} onBack={home} />;
  else if (g && g.kind === 'tourney') view = <TourneyView game={g} data={data} update={update} onBack={home} />;
  else if (g) view = <GameView game={g} data={data} update={update} onBack={home} />;
  else if (route.view === 'new' && admin) view = <NewGame data={data} update={update} onCancel={home} onCreated={(id) => setRoute({ view: 'game', id })} />;
  else if (route.view === 'stats') view = <StatsView data={data} onBack={home} />;
  else if (route.view === 'players' && admin) view = <PlayersView data={data} update={update} onBack={home} />;
  else if (route.view === 'members' && admin) view = <MembersView s={s} players={data.players} onBack={home} />;
  else view = <Home s={s} data={data} update={update} replace={replace} open={(id) => setRoute({ view: 'game', id })} go={setRoute} openClaims={openClaims} online={sync.online} />;
  return <>{view}{toast && <div className="toast cloud-toast">{toast}</div>}</>;
}

function Home({ s, data, update, replace, open, go, openClaims, online }: { s: Session; data: AppData; update: Update; replace: (d: AppData) => void; open: (id: string) => void; go: (r: Route) => void; openClaims: number; online: boolean }) {
  const admin = isAdminRole(s.role);
  const [account, setAccount] = useState(false);
  const running = data.games.filter((g) => g.status !== 'finished').sort((a, b) => b.createdAt - a.createdAt);
  const finished = data.games.filter((g) => g.status === 'finished').sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  const now = useNow(running.length > 0);
  const [del, setDel] = useState<Game | null>(null);
  const [backup, setBackup] = useState(false);

  return (
    <div className="page">
      <div className="wrap">
        {!isElectron() && isIOS() && !isStandalone() && (
          <div className="warn" style={{ marginBottom: 18 }}>
            Tipp: Über <b>Teilen → „Zum Home-Bildschirm“</b> hinzufügen. Dann startet die Pokerkasse wie eine App, auch ohne Netz mit dem zuletzt geladenen Stand.
          </div>
        )}
        <div className="row home-head" style={{ marginBottom: 30 }}>
          <div className="brand">
            <div className="brand-logo">{Icon.spade}</div>
            <div>
              <h1>Pokerkasse</h1>
              <div className="muted" style={{ fontSize: 13.5 }}>
                <span className={'sync-dot' + (online ? ' on' : '')} title={online ? 'Mit der Cloud verbunden' : 'Keine Verbindung – Änderungen werden nachgereicht'} />{online ? 'Online' : 'Offline'} · {s.profile.username}
              </div>
            </div>
          </div>
          <div className="spacer" />
          <button className="btn" onClick={() => setAccount(true)}>{Icon.user} Konto</button>
          <button className="btn" onClick={() => setBackup(true)}>{Icon.save} Datensicherung</button>
          <button className="btn" onClick={() => go({ view: 'stats' })}>{Icon.chart} Statistik</button>
          {admin && <button className="btn" onClick={() => go({ view: 'members' })}>{Icon.users} Mitglieder{openClaims > 0 && <span className="pill-count">{openClaims}</span>}</button>}
          {admin && <button className="btn" onClick={() => go({ view: 'players' })}>{Icon.users} Spielerliste ({data.players.length})</button>}
          {admin && <button className="btn primary lg" onClick={() => go({ view: 'new' })}>{Icon.plus} Neues Homegame</button>}
        </div>

        <h3>Laufende Homegames</h3>
        {running.length === 0 ? (
          <div className="empty">Kein laufendes Homegame.{admin ? ' Lege oben rechts ein neues an.' : ''}</div>
        ) : (
          <div className="game-list">
            {running.map((g) => <GameItem key={g.id} g={g} now={now} onOpen={() => open(g.id)} />)}
          </div>
        )}

        <h3 style={{ marginTop: 34 }}>Beendete Homegames</h3>
        {finished.length === 0 ? (
          <div className="empty">Noch keine abgeschlossenen Homegames.</div>
        ) : (
          <div className="game-list">
            {finished.map((g) => <GameItem key={g.id} g={g} now={now} onOpen={() => open(g.id)} onDelete={admin ? () => setDel(g) : undefined} />)}
          </div>
        )}
      </div>
      {backup && <BackupModal data={data} replace={replace} admin={admin} onClose={() => setBackup(false)} />}
      {account && <AccountModal s={s} onClose={() => setAccount(false)} />}
      {del && (
        <Modal title="Homegame löschen?" onClose={() => setDel(null)}
          footer={<>
            <button className="btn" onClick={() => setDel(null)}>Abbrechen</button>
            <button className="btn danger" onClick={() => { update((d) => { d.games = d.games.filter((x) => x.id !== del.id); }); setDel(null); }}>{Icon.trash} Endgültig löschen</button>
          </>}>
          <p className="muted" style={{ margin: 0 }}>„{del.name}“ und das komplette Protokoll werden dauerhaft entfernt.</p>
        </Modal>
      )}
    </div>
  );
}

function GameItem({ g, now, onOpen, onDelete }: { g: Game; now: number; onOpen: () => void; onDelete?: () => void }) {
  const s = deriveState(g);
  const dur = g.startedAt ? (g.endedAt ?? now) - g.startedAt : 0;
  return (
    <div className="card game-item" onClick={onOpen}>
      <div className="row">
        <div style={{ minWidth: 0 }}>
          <b style={{ fontSize: 16 }}>{g.name}</b>
          <div className="muted" style={{ fontSize: 12.5 }}>{fmtDate(g.createdAt)}{g.kind === 'tourney' ? ' · Turnier' : ' · Cash-Game'}</div>
        </div>
        <div className="spacer" />
        {g.status === 'running' && <span className="badge live"><span className="dot" />Läuft</span>}
        {g.status === 'created' && <span className="badge neutral">Nicht gestartet</span>}
        {g.status === 'finished' && onDelete && (
          <button className="btn ghost sm" title="Löschen" onClick={(ev) => { ev.stopPropagation(); onDelete(); }}>{Icon.trash}</button>
        )}
      </div>
      <div className="meta">
        <div><span>Spielzeit</span><span className="num">{g.source ? '–' : fmtDuration(dur)}</span></div>
        <div><span>Spieler</span><span>{g.players.length}</span></div>
        {g.kind === 'tourney'
          ? <div><span>Preispool</span><span className="num">{fmt(tourneyState(g).prizePool)}</span></div>
          : <div><span>Buy-ins</span><span className="num">{fmt(s.totalIn)}</span></div>}
        {s.open > 0 && g.status !== 'finished' && <div><span>Angeschrieben</span><span className="num openc">{fmt(s.open)}</span></div>}
      </div>
    </div>
  );
}

function NewGame({ data, update, onCancel, onCreated }: { data: AppData; update: Update; onCancel: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('Homegame ' + new Date().toLocaleDateString('de-DE'));
  const [sel, setSel] = useState<string[]>([]);
  const [newName, setNewName] = useState('');
  const [extra, setExtra] = useState<MasterPlayer[]>([]);
  const all = [...data.players, ...extra];
  const [kind, setKind] = useState<'cash' | 'tourney'>('cash');
  const [tc, setTc] = useState<TourneyConfig>(() => ({ ...defaultTourney(), ...structuredClone(data.lastTourney ?? {}) }));
  const [preset, setPreset] = useState<string | null>(null);
  const setT = (fn: (t: TourneyConfig) => void) => setTc((p) => { const n = structuredClone(p); fn(n); return n; });
  const errs = kind === 'tourney' ? tourneyErrors(tc) : [];

  const addNew = () => {
    const n = newName.trim();
    if (!n) return;
    const existing = all.find((p) => p.name.toLowerCase() === n.toLowerCase());
    if (existing) { if (!sel.includes(existing.id)) setSel([...sel, existing.id]); }
    else { const p = { id: uid(), name: n }; setExtra([...extra, p]); setSel([...sel, p.id]); }
    setNewName('');
  };

  const create = (start: boolean) => {
    const id = uid();
    const now = Date.now();
    if (kind === 'tourney') {
      if (errs.length) return;
      update((d) => {
        for (const p of extra) if (sel.includes(p.id)) d.players.push(p);
        const players = sel.map((pid) => ({ id: pid, name: all.find((p) => p.id === pid)!.name }));
        d.lastTourney = structuredClone(tc);
        d.games.push({
          id, kind: 'tourney', tourney: structuredClone(tc), name: name.trim() || 'Turnier', createdAt: now, startedAt: null, endedAt: null,
          status: 'created', players, seating: drawSeats(players.map((p) => p.id), maxPer(tc)),
          events: [
            ...players.map((p) => ({ id: uid(), at: now, type: 'player_added' as const, playerId: p.id })),
            ...players.map((p) => ({ id: uid(), at: now, type: 'buyin' as const, playerId: p.id, amount: entryPrice(tc), paid: true })),
          ],
          final: null, settleMode: 'overview',
        });
      });
      onCreated(id);
      return;
    }
    update((d) => {
      for (const p of extra) if (sel.includes(p.id)) d.players.push(p);
      const players = sel.map((pid) => ({ id: pid, name: all.find((p) => p.id === pid)!.name }));
      d.games.push({
        id, name: name.trim() || 'Homegame', createdAt: now, startedAt: start ? now : null, endedAt: null,
        status: start ? 'running' : 'created', players,
        events: [
          ...(start ? [{ id: uid(), at: now, type: 'game_started' as const }] : []),
          ...players.map((p) => ({ id: uid(), at: now, type: 'player_added' as const, playerId: p.id })),
        ],
        final: null, settleMode: 'overview',
      });
    });
    onCreated(id);
  };

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 760 }}>
        <button className="btn ghost" onClick={onCancel} style={{ marginBottom: 18 }}>{Icon.back} Zurück</button>
        <h1 style={{ marginBottom: 24 }}>Neues Homegame</h1>
        <div className="card" style={{ padding: 22, display: 'grid', gap: 22 }}>
          <div className="seg full">
            <button className={kind === 'cash' ? 'on' : ''} onClick={() => { setKind('cash'); if (name.startsWith('Turnier ')) setName(name.replace('Turnier ', 'Homegame ')); }}>Cash-Game</button>
            <button className={kind === 'tourney' ? 'on' : ''} onClick={() => { setKind('tourney'); if (name.startsWith('Homegame ')) setName(name.replace('Homegame ', 'Turnier ')); }}>{Icon.trophy} Turnier</button>
          </div>
          <label className="field">Name des Homegames
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="section">
            <div className="row"><h3>Spieler auswählen</h3><div className="spacer" /><span className="muted" style={{ fontSize: 13 }}>{sel.length} ausgewählt</span></div>
            {all.length === 0 && <div className="muted" style={{ fontSize: 14 }}>Deine Spielerliste ist noch leer. Füge unten Namen hinzu, sie werden automatisch gespeichert.</div>}
            <div className="chips-pick">
              {all.map((p) => {
                const on = sel.includes(p.id);
                return (
                  <button key={p.id} className={'chip' + (on ? ' on' : '')} onClick={() => setSel(on ? sel.filter((x) => x !== p.id) : [...sel, p.id])}>
                    {on ? Icon.check : Icon.plus}{p.name}
                  </button>
                );
              })}
            </div>
            <div className="row">
              <input className="input" placeholder="Neuer Spielername" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNew()} />
              <button className="btn" onClick={addNew} disabled={!newName.trim()}>{Icon.plus} Hinzufügen</button>
            </div>
          </div>
          {kind === 'tourney' && <PresetBar data={data} update={update} tc={tc} setTc={setTc} sel={preset} setSel={setPreset} />}
          {kind === 'tourney' && <TourneySetup t={tc} set={setT} players={sel.length} />}
          {errs.length > 0 && <div className="warn">{errs.map((x) => <div key={x}>{x}</div>)}</div>}
          {kind === 'tourney' ? (
            <div className="row wrap-row" style={{ justifyContent: 'flex-end' }}>
              <span className="note" style={{ marginRight: 'auto' }}>Ausgewählte Spieler zahlen je {fmt(entryPrice(tc))} bar (änderbar). Sitzplätze werden ausgelost, die Uhr startest du im Turnier.</span>
              <button className="btn primary lg" disabled={errs.length > 0} onClick={() => create(false)}>{Icon.shuffle} Turnier anlegen</button>
            </div>
          ) : (
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <span className="note" style={{ marginRight: 'auto' }}>Weitere Spieler kannst du jederzeit während des Spiels hinzufügen.</span>
            <button className="btn" onClick={() => create(false)}>Nur anlegen</button>
            <button className="btn primary lg" onClick={() => create(true)}>{Icon.play} Anlegen & starten</button>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PlayersView({ data, update, onBack }: { data: AppData; update: Update; onBack: () => void }) {
  const [n, setN] = useState('');
  const [edit, setEdit] = useState<{ id: string; name: string } | null>(null);
  const add = () => {
    const name = n.trim();
    if (!name || data.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) return;
    update((d) => { d.players.push({ id: uid(), name }); });
    setN('');
  };
  const sorted = [...data.players].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 760 }}>
        <button className="btn ghost" onClick={onBack} style={{ marginBottom: 18 }}>{Icon.back} Zurück</button>
        <div className="row" style={{ marginBottom: 24 }}>
          <h1>Spielerliste</h1><div className="spacer" />
        </div>
        <div className="card" style={{ padding: 22, display: 'grid', gap: 16 }}>
          <div className="row">
            <input className="input" placeholder="Name hinzufügen" value={n} onChange={(e) => setN(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
            <button className="btn primary" onClick={add}>{Icon.plus} Hinzufügen</button>
          </div>
          {sorted.length === 0 && <div className="muted">Noch keine Spieler gespeichert.</div>}
          <div className="history">
            {sorted.map((p) => {
              const games = data.games.filter((g) => g.players.some((x) => x.id === p.id)).length;
              return (
                <div className="h" key={p.id} style={{ padding: '8px 10px' }}>
                  <Avatar name={p.name} />
                  {edit?.id === p.id ? (
                    <input className="input" autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && edit.name.trim()) { update((d) => { d.players.find((x) => x.id === p.id)!.name = edit.name.trim(); }); setEdit(null); }
                        if (e.key === 'Escape') setEdit(null);
                      }} />
                  ) : <b style={{ flex: 1 }}>{p.name}</b>}
                  <span className="muted" style={{ fontSize: 12.5 }}>{games} Homegame{games === 1 ? '' : 's'}</span>
                  <button className="btn ghost sm" title="Umbenennen" onClick={() => setEdit({ id: p.id, name: p.name })}>{Icon.pen}</button>
                  <button className="btn ghost sm danger" title="Aus Liste entfernen" onClick={() => update((d) => { d.players = d.players.filter((x) => x.id !== p.id); })}>{Icon.trash}</button>
                </div>
              );
            })}
          </div>
          <div className="note">Entfernen löscht den Namen nur aus der Vorschlagsliste. Vergangene Homegames bleiben unverändert.</div>
        </div>
      </div>
    </div>
  );
}

function BackupModal({ data, replace, admin, onClose }: { data: AppData; replace: (d: AppData) => void; admin: boolean; onClose: () => void }) {
  const [local, setLocal] = useState<AppData | null>(null);
  useEffect(() => { if (admin) loadData().then((d) => setLocal(d && d.games.length + d.players.length > 0 ? d : null)).catch(() => {}); }, [admin]);
  const [msg, setMsg] = useState('');
  const [pending, setPending] = useState<AppData | null>(null);
  const exportAll = async () => {
    const d = new Date();
    const name = `Pokerkasse-Sicherung-${d.toISOString().slice(0, 10)}.json`;
    const r = await shareOrDownload(name, JSON.stringify(data, null, 2), 'application/json');
    if (r !== 'cancelled') setMsg(r === 'shared' ? 'Sicherung geteilt.' : `Sicherung „${name}“ gespeichert.`);
  };
  const pick = (f?: File | null) => {
    if (!f) return;
    f.text().then((t) => {
      try {
        const d = JSON.parse(t);
        if (!isAppData(d)) throw new Error();
        setPending(d); setMsg('');
      } catch { setMsg('Die Datei ist keine gültige Pokerkasse-Sicherung.'); }
    });
  };
  return (
    <Modal title="Datensicherung" onClose={onClose} footer={<button className="btn" onClick={onClose}>Schließen</button>}>
      <p className="muted" style={{ margin: 0 }}>
        Alle Daten liegen in der Cloud und sind auf jedem Gerät nach dem Anmelden da. Eine Sicherungsdatei ist eine zusätzliche Kopie für den Notfall.
      </p>
      <div className="section">
        <h3>Exportieren</h3>
        <button className="btn primary" onClick={exportAll}>{Icon.save} Sicherung erstellen ({data.games.length} Homegames, {data.players.length} Spieler)</button>
      </div>
      {admin && <>
      <div className="section">
        <h3>Importieren</h3>
        <label className="btn" style={{ position: 'relative' }}>
          {Icon.folder} Sicherungsdatei wählen
          <input type="file" accept=".json,application/json" style={{ position: 'absolute', inset: 0, opacity: 0 }} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {pending && (
          <div className="calc">
            <div className="l"><span>Datei enthält</span><b>{pending.games.length} Homegames · {pending.players.length} Spieler</b></div>
            <div className="row wrap-row" style={{ marginTop: 6 }}>
              <button className="btn primary" onClick={() => {
                const m = mergeData(data, pending); replace(m.data); setPending(null);
                setMsg(`Zusammengeführt: ${m.added} neu, ${m.updated} aktualisiert.`);
              }}>Zusammenführen</button>
              <button className="btn danger" onClick={() => { replace(pending); setPending(null); setMsg('Alle Daten wurden durch die Sicherung ersetzt.'); }}>Alles ersetzen</button>
            </div>
            <div className="note">Zusammenführen übernimmt neue Homegames und Spieler und behält deine vorhandenen. Ersetzen löscht alle Homegames in der Cloud, die nicht in der Datei sind.</div>
          </div>
        )}
      </div>
      </>}
      {local && (
        <div className="section">
          <h3>Alte Daten dieses Geräts</h3>
          <div className="muted" style={{ fontSize: 13.5 }}>Hier liegen noch {local.games.length} Homegames und {local.players.length} Spieler aus der Zeit vor der Cloud.</div>
          <div><button className="btn" onClick={() => { const m = mergeData(data, local); replace(m.data); setLocal(null); setMsg(`In die Cloud übernommen: ${m.added} neu, ${m.updated} aktualisiert.`); }}>{Icon.save} In die Cloud übernehmen</button></div>
        </div>
      )}
      {msg && <div className="badge cash" style={{ height: 'auto', padding: '8px 12px', whiteSpace: 'normal' }}>{msg}</div>}
    </Modal>
  );
}
