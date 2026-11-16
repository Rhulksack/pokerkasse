import { AppData, emptyData } from './logic';

declare global {
  interface Window {
    api?: {
      load: () => Promise<AppData | null>;
      save: (json: string) => Promise<boolean>;
      openDataFolder: () => Promise<void>;
      exportPdf: (html: string, fileName: string) => Promise<boolean>;
      exportTxt: (text: string, fileName: string) => Promise<boolean>;
    };
  }
}

const KEY = 'pokerkasse-daten';

export async function loadData(): Promise<AppData> {
  if (window.api) return (await window.api.load()) ?? emptyData();
  const raw = localStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : emptyData();
}

export async function saveData(d: AppData) {
  const json = JSON.stringify(d, null, 2);
  if (window.api) await window.api.save(json);
  else localStorage.setItem(KEY, json);
}
