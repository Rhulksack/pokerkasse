// Anmeldung, Spieler-Claim, Freigabe und Mitgliederverwaltung.
import { useState } from 'react';
import { MasterPlayer, uid } from './logic';
import {
  Profile, Session, approveClaim, changePassword, deleteAccount, login, logout, register, rejectClaim, removeMember,
  revokeAccess, sendClaim, setRole, useMembers, usePlayers,
} from './cloud';
import { Avatar, Icon, Modal } from './ui';

function Brand({ sub }: { sub: string }) {
  return (
    <div className="brand" style={{ marginBottom: 26 }}>
      <div className="brand-logo">{Icon.spade}</div>
      <div><h1>Pokerkasse</h1><div className="muted" style={{ fontSize: 13.5 }}>{sub}</div></div>
    </div>
  );
}

export function LoginScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim() || !pw) return;
    if (mode === 'register' && pw !== pw2) { setErr('Die Passwörter stimmen nicht überein.'); return; }
    setBusy(true); setErr('');
    const e = mode === 'login' ? await login(name, pw) : await register(name, pw);
    setBusy(false); setErr(e);
  };
  const key = (e: React.KeyboardEvent) => e.key === 'Enter' && submit();
  return (
    <div className="page auth-page">
      <div className="wrap" style={{ maxWidth: 420 }}>
        <Brand sub="Homegames, Buy-ins und Abrechnung" />
        <div className="card" style={{ padding: 22, display: 'grid', gap: 16 }}>
          <div className="seg full">
            <button className={mode === 'login' ? 'on' : ''} onClick={() => { setMode('login'); setErr(''); }}>Anmelden</button>
            <button className={mode === 'register' ? 'on' : ''} onClick={() => { setMode('register'); setErr(''); }}>Registrieren</button>
          </div>
          <label className="field">Benutzername
            <input className="input" autoComplete="username" autoCapitalize="none" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={key} />
          </label>
          <label className="field">Passwort
            <input className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={key} />
          </label>
          {mode === 'register' && (
            <label className="field">Passwort wiederholen
              <input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={key} />
            </label>
          )}
          {err && <div className="warn">{err}</div>}
          <button className="btn primary lg" disabled={busy || !name.trim() || !pw} onClick={submit}>
            {busy ? 'Bitte warten …' : mode === 'login' ? 'Anmelden' : 'Konto erstellen'}
          </button>
          {mode === 'register'
            ? <div className="note">Benutzername: 3–20 Zeichen (Buchstaben, Ziffern, Punkt, Minus). Passwort: mindestens 6 Zeichen. Es gibt keine E-Mail, ein vergessenes Passwort lässt sich nicht zurücksetzen.</div>
            : <div className="note">Noch kein Konto? Oben auf „Registrieren“ tippen. Danach wählst du deinen Spieler aus und wartest auf die Freigabe.</div>}
        </div>
      </div>
    </div>
  );
}

/** Angemeldet, aber noch nicht freigegeben: Spieler wählen, auf Freigabe warten. */
export function PendingScreen({ s }: { s: Session }) {
  const players = usePlayers(true);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const claim = s.profile.claim;
  const send = async (playerId: string | null, name: string) => { setBusy(true); await sendClaim(s.user.uid, { playerId, name, at: Date.now() }).catch(() => {}); setBusy(false); };
  const sorted = [...(players ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return (
    <div className="page auth-page">
      <div className="wrap" style={{ maxWidth: 620 }}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <Brand sub={`Angemeldet als ${s.profile.username}`} />
          <div className="spacer" />
          <button className="btn ghost" onClick={logout}>Abmelden</button>
        </div>
        {claim ? (
          <div className="card" style={{ padding: 22, display: 'grid', gap: 14 }}>
            <h3 style={{ margin: 0 }}>Warte auf Freigabe</h3>
            <p className="muted" style={{ margin: 0 }}>
              Du hast dich als <b>{claim.name}</b>{claim.playerId ? '' : ' (neuer Spieler)'} gemeldet. Sobald ein Admin das bestätigt, siehst du alle Homegames und Statistiken. Die Seite aktualisiert sich von selbst.
            </p>
            <div><button className="btn" disabled={busy} onClick={() => sendClaim(s.user.uid, null)}>{Icon.undo} Auswahl ändern</button></div>
          </div>
        ) : (
          <div className="card" style={{ padding: 22, display: 'grid', gap: 16 }}>
            <h3 style={{ margin: 0 }}>Welcher Spieler bist du?</h3>
            <p className="muted" style={{ margin: 0 }}>Tippe auf deinen Namen. Ein Admin bestätigt das, danach hast du Zugriff.</p>
            {players === null ? <div className="muted">Lade Spielerliste …</div> : (
              <div className="chips-pick">
                {sorted.map((p) => <button key={p.id} className="chip" disabled={busy} onClick={() => send(p.id, p.name)}>{Icon.user}{p.name}</button>)}
              </div>
            )}
            <div className="section">
              <div className="muted" style={{ fontSize: 13.5 }}>Nicht dabei? Dann als neuer Spieler melden:</div>
              <div className="row">
                <input className="input" placeholder="Dein Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
                <button className="btn" disabled={busy || !newName.trim()} onClick={() => send(null, newName.trim())}>Melden</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const roleLabel = (s: Session, m: Profile) => (m.uid === s.ownerUid ? 'Owner' : m.role === 'admin' ? 'Admin' : m.approved ? 'Mitglied' : 'Nicht freigegeben');

/** Admin-Ansicht: Claims freigeben, Rollen vergeben (nur Owner). */
export function MembersView({ s, players, onBack }: { s: Session; players: MasterPlayer[]; onBack: () => void }) {
  const members = useMembers(true);
  const [assign, setAssign] = useState<Profile | null>(null);
  const [confirm, setConfirm] = useState<{ m: Profile; k: 'remove' | 'revoke' } | null>(null);
  const [err, setErr] = useState('');
  const owner = s.role === 'owner';
  const run = (p: Promise<unknown>) => p.then(() => setErr('')).catch((e) => setErr('Nicht erlaubt oder offline: ' + (e?.code ?? e)));
  const name = (id: string | null) => players.find((p) => p.id === id)?.name ?? null;
  const claims = members.filter((m) => m.claim);
  const rest = members.filter((m) => !m.claim).sort((a, b) => a.username.localeCompare(b.username, 'de'));
  const takenBy = (pid: string) => members.find((m) => m.playerId === pid && m.uid !== assign?.uid);

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 760 }}>
        <button className="btn ghost" onClick={onBack} style={{ marginBottom: 18 }}>{Icon.back} Zurück</button>
        <h1 style={{ marginBottom: 24 }}>Mitglieder</h1>
        {err && <div className="warn" style={{ marginBottom: 14 }}>{err}</div>}

        <h3>Offene Anfragen</h3>
        {claims.length === 0 ? <div className="empty">Keine offenen Anfragen.</div> : (
          <div className="card" style={{ padding: 14, display: 'grid', gap: 10, marginBottom: 10 }}>
            {claims.map((m) => {
              const p = m.claim!.playerId ? players.find((x) => x.id === m.claim!.playerId) : null;
              const taken = p ? members.find((x) => x.playerId === p.id && x.uid !== m.uid) : null;
              return (
                <div className="h member" key={m.uid}>
                  <Avatar name={m.claim!.name} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>{m.username}</b> möchte <b>{m.claim!.name}</b> sein{p ? '' : ' (neuer Spieler)'}
                    {taken && <div className="note">Achtung: {taken.username} ist schon mit {p!.name} verknüpft.</div>}
                  </div>
                  <button className="btn primary sm" onClick={() => run(p ? approveClaim(m, p, false) : approveClaim(m, { id: uid(), name: m.claim!.name }, true))}>{Icon.check} Bestätigen</button>
                  <button className="btn ghost sm" title="Anderen Spieler zuordnen" onClick={() => setAssign(m)}>{Icon.pen}</button>
                  <button className="btn ghost sm danger" title="Ablehnen" onClick={() => run(rejectClaim(m))}>{Icon.x}</button>
                </div>
              );
            })}
          </div>
        )}

        <h3 style={{ marginTop: 26 }}>Konten ({rest.length})</h3>
        <div className="card" style={{ padding: 14, display: 'grid', gap: 8 }}>
          {rest.map((m) => {
            const isOwnerAcc = m.uid === s.ownerUid;
            const me = m.uid === s.user.uid;
            return (
              <div className="h member" key={m.uid}>
                <Avatar name={name(m.playerId) ?? m.username} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{m.username}</b>{me && <span className="muted"> (du)</span>}
                  <div className="muted" style={{ fontSize: 12.5 }}>{roleLabel(s, m)}{name(m.playerId) ? ' · Spieler: ' + name(m.playerId) : ''}</div>
                </div>
                <button className="btn ghost sm" title="Spieler zuordnen" onClick={() => setAssign(m)}>{Icon.user}</button>
                {owner && !isOwnerAcc && (m.role === 'admin'
                  ? <button className="btn sm" onClick={() => run(setRole(m, 'member'))}>Admin entziehen</button>
                  : <button className="btn sm" onClick={() => run(setRole(m, 'admin'))}>Zum Admin</button>)}
                {!isOwnerAcc && !me && (owner || m.role !== 'admin') && m.approved && (
                  <button className="btn sm" title="Freigabe entziehen" onClick={() => setConfirm({ m, k: 'revoke' })}>Sperren</button>
                )}
                {!isOwnerAcc && !me && (owner || m.role !== 'admin') && (
                  <button className="btn ghost sm danger" title="Konto entfernen" onClick={() => setConfirm({ m, k: 'remove' })}>{Icon.trash}</button>
                )}
              </div>
            );
          })}
        </div>
        <div className="note" style={{ marginTop: 10 }}>
          Mitglieder sehen alle Homegames und Statistiken, ändern aber nichts. Admins verwalten Spiele, Spieler und Freigaben und steuern Turniere per Handy.{owner ? ' Nur du als Owner vergibst Admin-Rechte.' : ''}
        </div>
      </div>

      {assign && (
        <Modal title={`Spieler für ${assign.username}`} onClose={() => setAssign(null)} footer={<button className="btn" onClick={() => setAssign(null)}>Abbrechen</button>}>
          <div className="chips-pick">
            {[...players].sort((a, b) => a.name.localeCompare(b.name, 'de')).map((p) => {
              const t = takenBy(p.id);
              return (
                <button key={p.id} className={'chip' + (assign.playerId === p.id ? ' on' : '')} title={t ? `schon mit ${t.username} verknüpft` : ''}
                  onClick={() => { run(approveClaim(assign, p, false)); setAssign(null); }}>
                  {Icon.user}{p.name}{t ? ' *' : ''}
                </button>
              );
            })}
          </div>
          <div className="note">* bereits mit einem anderen Konto verknüpft. Zuordnen gibt das Konto gleichzeitig frei.</div>
        </Modal>
      )}
      {confirm && (
        <Modal title={confirm.k === 'remove' ? 'Konto entfernen?' : 'Freigabe entziehen?'} onClose={() => setConfirm(null)}
          footer={<>
            <button className="btn" onClick={() => setConfirm(null)}>Abbrechen</button>
            <button className="btn danger" onClick={() => { run(confirm.k === 'remove' ? removeMember(confirm.m) : revokeAccess(confirm.m)); setConfirm(null); }}>
              {confirm.k === 'remove' ? 'Entfernen' : 'Entziehen'}
            </button>
          </>}>
          <p className="muted" style={{ margin: 0 }}>
            {confirm.k === 'remove'
              ? `${confirm.m.username} verliert sofort den Zugriff. Meldet sich das Konto wieder an, muss es neu einen Spieler wählen und freigegeben werden.`
              : `${confirm.m.username} sieht keine Homegames mehr, bis jemand das Konto wieder freigibt.`}
          </p>
        </Modal>
      )}
    </div>
  );
}

export function AccountModal({ s, onClose }: { s: Session; onClose: () => void }) {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [msg, setMsg] = useState('');
  const [del, setDel] = useState(false);
  const roleTxt = s.role === 'owner' ? 'Owner' : s.role === 'admin' ? 'Admin' : 'Mitglied';
  return (
    <Modal title="Konto" onClose={onClose} footer={<>
      <button className="btn danger" onClick={() => { logout(); onClose(); }}>Abmelden</button>
      <button className="btn" onClick={onClose}>Schließen</button>
    </>}>
      <div className="calc">
        <div className="l"><span>Benutzername</span><b>{s.profile.username}</b></div>
        <div className="l"><span>Rolle</span><b>{roleTxt}</b></div>
      </div>
      <div className="section">
        <h3>Passwort ändern</h3>
        <input className="input" type="password" placeholder="Aktuelles Passwort" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
        <input className="input" type="password" placeholder="Neues Passwort (mind. 6 Zeichen)" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
        <div>
          <button className="btn" disabled={!oldPw || newPw.length < 6} onClick={async () => {
            const e = await changePassword(oldPw, newPw);
            setMsg(e || 'Passwort geändert.'); if (!e) { setOldPw(''); setNewPw(''); }
          }}>Ändern</button>
        </div>
      </div>
      {s.role !== 'owner' && (
        <div className="section">
          {!del ? <div><button className="btn ghost danger" onClick={() => setDel(true)}>{Icon.trash} Konto löschen</button></div> : (
            <>
              <div className="muted" style={{ fontSize: 13.5 }}>Zum Löschen das aktuelle Passwort oben eintragen.</div>
              <div><button className="btn danger" disabled={!oldPw} onClick={async () => { const e = await deleteAccount(oldPw); setMsg(e || 'Konto gelöscht.'); }}>Endgültig löschen</button></div>
            </>
          )}
        </div>
      )}
      {msg && <div className="badge cash" style={{ height: 'auto', padding: '8px 12px', whiteSpace: 'normal' }}>{msg}</div>}
    </Modal>
  );
}
