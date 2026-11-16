import { createRoot } from 'react-dom/client';
import App from './App';
import { RemoteApp } from './Remote';
import { autoLabelTables, isElectron } from './platform';
import './styles.css';
const remote = location.hash.match(/^#remote=(.+)$/);
createRoot(document.getElementById('root')!).render(remote ? <RemoteApp gameId={decodeURIComponent(remote[1])} /> : <App />);
autoLabelTables();
if (!isElectron() && (location.protocol === 'https:' || location.hostname === 'localhost') && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  (navigator as any).storage?.persist?.().catch(() => {});
}
