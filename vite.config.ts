import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Erzeugt einen Service Worker, der alle Dateien der App vorab speichert (offline nutzbar).
function serviceWorker(): Plugin {
  return {
    name: 'pokerkasse-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
        ...Object.keys(bundle)];
      const version = Date.now().toString(36);
      const code = `const CACHE='pokerkasse-${version}';
const FILES=${JSON.stringify(files)};
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const r=e.request; if(r.method!=='GET'||new URL(r.url).origin!==location.origin) return;
  e.respondWith(caches.match(r,{ignoreSearch:true}).then(hit=>hit||fetch(r).catch(()=>r.mode==='navigate'?caches.match('index.html'):undefined)));
});`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: code });
    },
  };
}

export default defineConfig({ base: './', plugins: [react(), serviceWorker()], server: { port: 5173 } });
