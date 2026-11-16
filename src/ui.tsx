import { ReactNode, useEffect, useRef, useState } from 'react';
import { fmt } from './logic';

const P = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

export const Icon = {
  back: P('M15 18l-6-6 6-6'),
  plus: P('M12 5v14M5 12h14'),
  user: P('M20 21a8 8 0 10-16 0M12 13a5 5 0 100-10 5 5 0 000 10z'),
  users: P('M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M10 11a4 4 0 100-8 4 4 0 000 8zM21 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75'),
  cash: P('M3 7h18v10H3zM12 15a3 3 0 100-6 3 3 0 000 6zM6 10v4M18 10v4'),
  stack: P('M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5'),
  pen: P('M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z'),
  coin: P('M12 21a9 9 0 100-18 9 9 0 000 18zM9 9h4.5a1.5 1.5 0 010 3H10.5a1.5 1.5 0 000 3H15M12 7v2M12 15v2'),
  list: P('M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'),
  flag: P('M4 22V4M4 4h13l-2 4 2 4H4'),
  logout: P('M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9'),
  play: P('M6 4l14 8-14 8V4z'),
  check: P('M20 6L9 17l-5-5'),
  x: P('M18 6L6 18M6 6l12 12'),
  undo: P('M3 7v6h6M3 13a9 9 0 103-7.7L3 8'),
  pdf: P('M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M8 13h8M8 17h5'),
  copy: P('M9 9h11v11H9zM5 15H4V4h11v1'),
  save: P('M12 3v12M7 10l5 5 5-5M5 21h14'),
  trash: P('M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6'),
  spade: P('M12 2C9 6 4 8.5 4 13a4 4 0 007 2.6L10 20h4l-1-4.4A4 4 0 0020 13c0-4.5-5-7-8-11z'),
  folder: P('M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z'),
  arrow: P('M5 12h14M13 6l6 6-6 6'),
};

export function Modal({ title, onClose, children, footer, wide }: {
  title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const h = (ev: KeyboardEvent) => ev.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(ev) => ev.target === ev.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog">
        <div className="modal-head">
          <h2>{title}</h2>
          <div className="spacer" />
          <button className="btn ghost sm" onClick={onClose} aria-label="Schließen">{Icon.x}</button>
        </div>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function EuroInput({ value, onChange, autoFocus, placeholder, onEnter, allowNegative }: {
  value: string; onChange: (v: string) => void; autoFocus?: boolean; placeholder?: string;
  onEnter?: () => void; allowNegative?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  return (
    <div className="input-euro">
      <input
        ref={ref}
        className="input"
        inputMode={allowNegative ? 'text' : 'decimal'}
        value={value}
        placeholder={placeholder ?? '0'}
        onChange={(ev) => {
          const v = ev.target.value.replace('.', ',');
          const re = allowNegative ? /^-?\d*(,\d{0,2})?$/ : /^\d*(,\d{0,2})?$/;
          if (v === '' || re.test(v)) onChange(v);
        }}
        onKeyDown={(ev) => ev.key === 'Enter' && onEnter?.()}
      />
    </div>
  );
}

export const parseEuro = (v: string) => {
  if (v === '' || v === '-') return NaN;
  return Number(v.replace(',', '.'));
};

export function Money({ v, sign, tone }: { v: number; sign?: boolean; tone?: 'result' | 'open' | 'paid' }) {
  let cls = 'num';
  if (tone === 'result') cls += v > 0 ? ' pos' : v < 0 ? ' neg' : ' muted';
  if (tone === 'open') cls += v > 0 ? ' openc' : ' faint';
  if (tone === 'paid') cls += ' paid';
  return <span className={cls}>{fmt(v, { sign })}</span>;
}

export function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const AV_COLORS = ['#3b3f7a', '#2c5a4a', '#5a3d2c', '#4a2c5a', '#2c4a5a', '#5a2c3d', '#4d5a2c', '#2c3d5a'];
export function Avatar({ name }: { name: string }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const initials = name.trim().split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  return <div className="avatar" style={{ background: AV_COLORS[h % AV_COLORS.length] }}>{initials || '?'}</div>;
}

export const fmtTime = (t: number) =>
  new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
export const fmtDate = (t: number) =>
  new Date(t).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
