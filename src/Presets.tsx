import { useState } from 'react';
import { AppData, TourneyPreset, uid } from './logic';
import { TourneyConfig, defaultTourney } from './tourney';
import { Icon, Modal } from './ui';

type Update = (fn: (d: AppData) => void) => void;

const norm = (t: TourneyConfig) => JSON.stringify({ ...defaultTourney(), ...t, tables: undefined });
export const fromPreset = (p: TourneyPreset): TourneyConfig => ({ ...defaultTourney(), ...structuredClone(p.config) });

/** Presets beim Einrichten: laden, speichern, umbenennen, löschen. Ohne Auswahl gelten die letzten Einstellungen. */
export function PresetBar({ data, update, tc, setTc, sel, setSel }: {
  data: AppData; update: Update; tc: TourneyConfig; setTc: (t: TourneyConfig) => void; sel: string | null; setSel: (id: string | null) => void;
}) {
  const list = [...(data.tourneyPresets ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const cur = list.find((p) => p.id === sel) ?? null;
  const changed = !!cur && norm(cur.config) !== norm(tc);
  const [modal, setModal] = useState<null | { k: 'new' | 'rename'; name: string } | { k: 'delete' }>(null);
  const nameTaken = (n: string, except?: string) => list.some((p) => p.id !== except && p.name.trim().toLowerCase() === n.trim().toLowerCase());

  const saveNew = (name: string) => {
    const id = uid();
    update((d) => { (d.tourneyPresets ??= []).push({ id, name: name.trim(), config: structuredClone(tc), updatedAt: Date.now() }); });
    setSel(id); setModal(null);
  };
  const overwrite = () => cur && update((d) => { const p = d.tourneyPresets!.find((x) => x.id === cur.id)!; p.config = structuredClone(tc); p.updatedAt = Date.now(); });
  const rename = (name: string) => { if (cur) update((d) => { const p = d.tourneyPresets!.find((x) => x.id === cur.id)!; p.name = name.trim(); p.updatedAt = Date.now(); }); setModal(null); };
  const remove = () => { if (cur) update((d) => { d.tourneyPresets = d.tourneyPresets!.filter((x) => x.id !== cur.id); }); setSel(null); setModal(null); };

  return (
    <div className="section preset-bar">
      <div className="row"><h3>Preset</h3><div className="spacer" />
        {changed && <span className="badge open">geändert</span>}
      </div>
      <div className="chips-pick">
        <button className={'chip' + (!sel ? ' on' : '')} onClick={() => { setSel(null); setTc({ ...defaultTourney(), ...structuredClone(data.lastTourney ?? {}) }); }}>Letzte Einstellungen</button>
        {list.map((p) => (
          <button key={p.id} className={'chip' + (sel === p.id ? ' on' : '')} onClick={() => { setSel(p.id); setTc(fromPreset(p)); }}>{p.name}</button>
        ))}
      </div>
      <div className="row wrap-row">
        {cur && <button className="btn sm" disabled={!changed} onClick={overwrite}>{Icon.save} „{cur.name}“ überschreiben</button>}
        <button className="btn sm" onClick={() => setModal({ k: 'new', name: '' })}>{Icon.plus} Als neues Preset speichern</button>
        {cur && <button className="btn sm ghost" onClick={() => setModal({ k: 'rename', name: cur.name })}>{Icon.pen} Umbenennen</button>}
        {cur && <button className="btn sm ghost danger" onClick={() => setModal({ k: 'delete' })}>{Icon.trash} Löschen</button>}
      </div>
      {list.length === 0 && <div className="note">Stell unten alles ein und speichere es als Preset, z. B. „Turbo Bounty“. Danach lädst du es hier mit einem Klick.</div>}

      {modal && modal.k !== 'delete' && (() => {
        const n = modal.name;
        const taken = nameTaken(n, modal.k === 'rename' ? cur?.id : undefined);
        const ok = n.trim().length > 0 && !taken;
        const go = () => { if (ok) (modal.k === 'new' ? saveNew(n) : rename(n)); };
        return (
          <Modal title={modal.k === 'new' ? 'Als Preset speichern' : 'Preset umbenennen'} onClose={() => setModal(null)} footer={<>
            <button className="btn" onClick={() => setModal(null)}>Abbrechen</button>
            <button className="btn primary" disabled={!ok} onClick={go}>{Icon.check} Speichern</button>
          </>}>
            <label className="field">Name
              <input className="input" autoFocus placeholder="z. B. Turbo Bounty" value={n} onChange={(e) => setModal({ ...modal, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && go()} />
            </label>
            {taken && <div className="warn">Ein Preset mit diesem Namen gibt es schon.</div>}
            {modal.k === 'new' && <div className="note">Gespeichert werden alle Turnier-Einstellungen (Buy-in, Bounty, Chips, Blind-Struktur, Ante, Rebuy, Late Reg, Auszahlung, Tische), aber keine Spieler.</div>}
          </Modal>
        );
      })()}
      {modal?.k === 'delete' && cur && (
        <Modal title="Preset löschen?" onClose={() => setModal(null)} footer={<>
          <button className="btn" onClick={() => setModal(null)}>Abbrechen</button>
          <button className="btn danger" onClick={remove}>{Icon.trash} Löschen</button>
        </>}>
          <p className="muted" style={{ margin: 0 }}>„{cur.name}“ wird entfernt. Bereits gespielte Turniere bleiben unverändert.</p>
        </Modal>
      )}
    </div>
  );
}
