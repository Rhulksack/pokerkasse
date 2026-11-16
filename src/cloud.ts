// Cloud-Anbindung (Firebase): Login per Benutzername + Passwort, Daten in Firestore mit Offline-Cache.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword, deleteUser, getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  updatePassword, updateProfile, EmailAuthProvider, reauthenticateWithCredential, User,
} from 'firebase/auth';
import {
  collection, deleteDoc, doc, getDoc, initializeFirestore, onSnapshot, persistentLocalCache, persistentMultipleTabManager,
  runTransaction, setDoc, updateDoc, writeBatch, Firestore, QuerySnapshot, QueryDocumentSnapshot,
} from 'firebase/firestore';
import { AppData, Game, MasterPlayer } from './logic';
import { mergeGame } from './tourneyActions';

const config = {
  apiKey: 'AIzaSyCJN38ZneRIiueVP5YFY8l2AU2fv8xtyeA',
  authDomain: 'pokerkasse-a77a9.firebaseapp.com',
  projectId: 'pokerkasse-a77a9',
  storageBucket: 'pokerkasse-a77a9.firebasestorage.app',
  messagingSenderId: '1078803830723',
  appId: '1:1078803830723:web:5b4d662cf634f9da220f76',
};
const OWNER_NAME = 'max';
const MAIL = '@pokerkasse.invalid';
export const PUBLIC_URL = 'https://rhulksack.github.io/pokerkasse/';

const app = initializeApp(config);
export const auth = getAuth(app);
let db: Firestore;
try {
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch {
  db = initializeFirestore(app, {});
}

// ---------------------------------------------------------------- Benutzername

/** Benutzername → interner Login-Schlüssel (klein, Umlaute ausgeschrieben). */
export function slug(name: string) {
  return name.trim().toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/\s+/g, '.');
}
export function usernameError(name: string) {
  const s = slug(name);
  if (s.length < 3) return 'Benutzername: mindestens 3 Zeichen.';
  if (s.length > 20) return 'Benutzername: höchstens 20 Zeichen.';
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(s)) return 'Benutzername: nur Buchstaben, Ziffern, Punkt, Minus und Unterstrich.';
  return '';
}
const mailOf = (name: string) => slug(name) + MAIL;

function authMsg(e: any) {
  const c = String(e?.code ?? '');
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) return 'Benutzername oder Passwort falsch.';
  if (c.includes('email-already-in-use')) return 'Diesen Benutzernamen gibt es schon.';
  if (c.includes('weak-password')) return 'Passwort: mindestens 6 Zeichen.';
  if (c.includes('too-many-requests')) return 'Zu viele Versuche. Bitte kurz warten.';
  if (c.includes('network')) return 'Keine Internetverbindung.';
  if (c.includes('requires-recent-login')) return 'Bitte ab- und wieder anmelden und erneut versuchen.';
  return 'Fehler: ' + (e?.message ?? c);
}

export async function login(name: string, pw: string) {
  try { await signInWithEmailAndPassword(auth, mailOf(name), pw); return ''; } catch (e) { return authMsg(e); }
}
export async function register(name: string, pw: string) {
  const err = usernameError(name);
  if (err) return err;
  if (pw.length < 6) return 'Passwort: mindestens 6 Zeichen.';
  try {
    const c = await createUserWithEmailAndPassword(auth, mailOf(name), pw);
    await updateProfile(c.user, { displayName: name.trim() });
    await ensureProfile(c.user);
    return '';
  } catch (e) { return authMsg(e); }
}
export const logout = () => signOut(auth);
export async function changePassword(oldPw: string, newPw: string) {
  const u = auth.currentUser;
  if (!u?.email) return 'Nicht angemeldet.';
  if (newPw.length < 6) return 'Neues Passwort: mindestens 6 Zeichen.';
  try {
    await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, oldPw));
    await updatePassword(u, newPw);
    return '';
  } catch (e) { return authMsg(e); }
}
export async function deleteAccount(pw: string) {
  const u = auth.currentUser;
  if (!u?.email) return 'Nicht angemeldet.';
  try {
    await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, pw));
    await deleteDoc(doc(db, 'users', u.uid)).catch(() => {});
    await deleteUser(u);
    return '';
  } catch (e) { return authMsg(e); }
}

// ---------------------------------------------------------------- Konto / Rolle

export type Role = 'owner' | 'admin' | 'member';
export interface Claim { playerId: string | null; name: string; at: number }
export interface Profile {
  uid: string; username: string; role: 'admin' | 'member'; approved: boolean;
  playerId: string | null; claim: Claim | null; createdAt: number;
}
export interface Session { user: User; profile: Profile; role: Role; ownerUid: string | null }

const usernameOf = (u: User) => u.displayName || (u.email ?? '').replace(MAIL, '');

async function ensureProfile(u: User) {
  const ref = doc(db, 'users', u.uid);
  const snap = await getDoc(ref).catch(() => null);
  if (snap && !snap.exists()) {
    await setDoc(ref, { username: usernameOf(u), role: 'member', approved: false, playerId: null, claim: null, createdAt: Date.now() });
  }
  if (u.email === OWNER_NAME + MAIL) {
    const o = await getDoc(doc(db, 'meta', 'owner')).catch(() => null);
    if (o && !o.exists()) await setDoc(doc(db, 'meta', 'owner'), { uid: u.uid, at: Date.now() });
  }
}

/** Login-Zustand + eigenes Konto (live). undefined = lädt, null = abgemeldet. */
export function useSession(): Session | null | undefined {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [ownerUid, setOwnerUid] = useState<string | null | undefined>(undefined);
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  useEffect(() => {
    if (!user) { setProfile(undefined); setOwnerUid(undefined); return; }
    let created = false;
    const offP = onSnapshot(doc(db, 'users', user.uid), (s) => {
      if (s.exists()) setProfile({ uid: s.id, ...(s.data() as any) });
      else if (!s.metadata.fromCache && !created) { created = true; ensureProfile(user).catch(() => {}); }
    }, () => setProfile(undefined));
    const offO = onSnapshot(doc(db, 'meta', 'owner'), (s) => {
      if (s.exists()) setOwnerUid(s.data().uid);
      else { setOwnerUid(null); if (!s.metadata.fromCache && user.email === OWNER_NAME + MAIL) ensureProfile(user).catch(() => {}); }
    }, () => setOwnerUid(null));
    return () => { offP(); offO(); };
  }, [user]);
  if (user === undefined) return undefined;
  if (user === null) return null;
  if (!profile || ownerUid === undefined) return undefined;
  const role: Role = ownerUid === user.uid ? 'owner' : profile.role === 'admin' ? 'admin' : 'member';
  return { user, profile, role, ownerUid };
}

export const isAdminRole = (r: Role) => r === 'owner' || r === 'admin';
export const canSee = (s: Session) => isAdminRole(s.role) || s.profile.approved;

/** Eigenen Spieler beanspruchen (oder als neuer Spieler mit Namen anmelden). */
export function sendClaim(uid: string, claim: Claim | null) {
  return updateDoc(doc(db, 'users', uid), { claim });
}

// ---------------------------------------------------------------- Admin: Mitglieder

export function useMembers(enabled: boolean) {
  const [list, setList] = useState<Profile[]>([]);
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(collection(db, 'users'), (s) => setList(s.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }))), () => {});
  }, [enabled]);
  return list;
}
export async function approveClaim(m: Profile, player: MasterPlayer, isNew: boolean) {
  const b = writeBatch(db);
  if (isNew) b.set(doc(db, 'players', player.id), player);
  b.update(doc(db, 'users', m.uid), { approved: true, playerId: player.id, claim: null });
  await b.commit();
}
export const rejectClaim = (m: Profile) => updateDoc(doc(db, 'users', m.uid), { claim: null });
export const revokeAccess = (m: Profile) => updateDoc(doc(db, 'users', m.uid), { approved: false, playerId: null });
export const setRole = (m: Profile, role: 'admin' | 'member') => updateDoc(doc(db, 'users', m.uid), { role });
export const removeMember = (m: Profile) => deleteDoc(doc(db, 'users', m.uid));

// ---------------------------------------------------------------- Spieldaten

/** Nur Spielernamen (für den Claim, auch ohne Freigabe lesbar). */
export function usePlayers(enabled: boolean) {
  const [list, setList] = useState<MasterPlayer[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(collection(db, 'players'), (s) => setList(s.docs.map((d) => ({ id: d.id, name: d.data().name }))), () => setList([]));
  }, [enabled]);
  return list;
}

export interface SyncState { online: boolean; pending: boolean; error: string }

/** Alle Spieldaten live aus der Cloud (mit Offline-Cache). */
export function useCloudData(enabled: boolean) {
  const [players, setPlayers] = useState<MasterPlayer[] | null>(null);
  const [games, setGames] = useState<Game[] | null>(null);
  const [meta, setMeta] = useState<Pick<AppData, 'tourneyPresets' | 'lastTourney'> | null>(null);
  const [sync, setSync] = useState<SyncState>({ online: true, pending: false, error: '' });
  useEffect(() => {
    if (!enabled) return;
    const opts = { includeMetadataChanges: true };
    const offs = [
      onSnapshot(collection(db, 'players'), opts, (s: QuerySnapshot) => { if (!(s.metadata.fromCache && s.empty && navigator.onLine)) setPlayers(s.docs.map((d: QueryDocumentSnapshot) => ({ id: d.id, name: d.data().name }))); }),
      onSnapshot(collection(db, 'games'), opts, (s) => {
        if (s.metadata.fromCache && s.empty && navigator.onLine) return; // neues Gerät: auf Server warten
        setGames(s.docs.map((d) => { try { return JSON.parse(d.data().json) as Game; } catch { return null; } }).filter(Boolean) as Game[]);
        setSync((x) => ({ ...x, online: !s.metadata.fromCache, pending: s.metadata.hasPendingWrites }));
      }, (e) => setSync((x) => ({ ...x, error: 'Keine Leseberechtigung: ' + e.code }))),
      onSnapshot(doc(db, 'meta', 'presets'), opts, (s) => {
        try { setMeta(s.exists() ? JSON.parse(s.data().json) : {}); } catch { setMeta({}); }
      }, () => setMeta({})),
    ];
    return () => offs.forEach((f) => f());
  }, [enabled]);
  const data = useMemo<AppData | null>(() => (players && games && meta ? { version: 1, players, games, ...meta } : null), [players, games, meta]);
  return { data, sync, setSync };
}

const gameDoc = (g: Game) => ({ json: JSON.stringify(g), kind: g.kind ?? 'cash', status: g.status, updatedAt: Date.now(), by: auth.currentUser?.uid ?? null });
const metaJson = (d: AppData) => JSON.stringify({ tourneyPresets: d.tourneyPresets ?? [], ...(d.lastTourney ? { lastTourney: d.lastTourney } : {}) });

/** Unterschiede zwischen zwei Ständen in die Cloud schreiben. Laufende Spiele per Transaktion zusammenführen. */
export async function pushChanges(prev: AppData, next: AppData) {
  const pIds = new Map(prev.players.map((p) => [p.id, p]));
  const nIds = new Map(next.players.map((p) => [p.id, p]));
  const gPrev = new Map(prev.games.map((g) => [g.id, JSON.stringify(g)]));
  const gNext = new Map(next.games.map((g) => [g.id, g]));
  const ops: { kind: 'game' | 'other'; run: (b: ReturnType<typeof writeBatch>) => void; game?: Game }[] = [];
  for (const [id, p] of nIds) if (pIds.get(id)?.name !== p.name) ops.push({ kind: 'other', run: (b) => b.set(doc(db, 'players', id), { name: p.name }) });
  for (const id of pIds.keys()) if (!nIds.has(id)) ops.push({ kind: 'other', run: (b) => b.delete(doc(db, 'players', id)) });
  for (const [id, g] of gNext) if (gPrev.get(id) !== JSON.stringify(g)) ops.push({ kind: 'game', game: g, run: (b) => b.set(doc(db, 'games', id), gameDoc(g)) });
  for (const id of gPrev.keys()) if (!gNext.has(id)) ops.push({ kind: 'other', run: (b) => b.delete(doc(db, 'games', id)) });
  if (metaJson(prev) !== metaJson(next)) ops.push({ kind: 'other', run: (b) => b.set(doc(db, 'meta', 'presets'), { json: metaJson(next) }) });
  if (!ops.length) return;

  // Einzelnes laufendes Spiel: Transaktion, damit Laptop und Handy sich keine Eingaben überschreiben
  const single = ops.length === 1 && ops[0].kind === 'game' && ops[0].game!.status !== 'finished' ? ops[0].game! : null;
  if (single && navigator.onLine) {
    try {
      await withTimeout(runTransaction(db, async (tx) => {
        const ref = doc(db, 'games', single.id);
        const cur = await tx.get(ref);
        let g = single;
        if (cur.exists()) { try { g = mergeGame(JSON.parse(cur.data().json), single); } catch {} }
        tx.set(ref, gameDoc(g));
      }), 8000);
      return;
    } catch (e: any) {
      if (e?.code === 'permission-denied') throw e;
      // offline/zeitüberschreitung → normal schreiben (wird nachgereicht)
    }
  }
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db);
    ops.slice(i, i + 400).forEach((o) => o.run(b));
    b.commit().catch((e) => window.dispatchEvent(new CustomEvent('cloud-error', { detail: String(e?.code ?? e) })));
  }
}

function withTimeout<T>(p: Promise<T>, ms: number) {
  return new Promise<T>((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), ms); p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); }); });
}


/** Spieldaten für die Oberfläche: Cloud-Stand + sofort sichtbare eigene Änderungen. */
export function useSyncedData(admin: boolean, notify: (msg: string) => void) {
  const { data: remote, sync } = useCloudData(true);
  const [data, setData] = useState<AppData | null>(null);
  const ref = useRef<AppData | null>(null);
  useEffect(() => { if (remote) { ref.current = remote; setData(remote); } }, [remote]);
  useEffect(() => {
    const h = (e: Event) => notify('Speichern fehlgeschlagen: ' + (e as CustomEvent).detail);
    window.addEventListener('cloud-error', h);
    return () => window.removeEventListener('cloud-error', h);
  }, [notify]);
  const update = useCallback((fn: (d: AppData) => void) => {
    const prev = ref.current;
    if (!prev) return;
    if (!admin) { notify('Nur Admins können etwas ändern.'); return; }
    const next = structuredClone(prev) as AppData;
    fn(next);
    ref.current = next;
    setData(next);
    pushChanges(prev, next).catch((e) => notify('Speichern fehlgeschlagen: ' + (e?.code ?? e)));
  }, [admin, notify]);
  const replace = useCallback((next: AppData) => {
    const prev = ref.current;
    if (!prev || !admin) return;
    ref.current = next; setData(next);
    pushChanges(prev, next).catch((e) => notify('Speichern fehlgeschlagen: ' + (e?.code ?? e)));
  }, [admin, notify]);
  return { data, update, replace, sync };
}
