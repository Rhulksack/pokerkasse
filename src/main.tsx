import { createRoot } from 'react-dom/client';
import App from './App';
import { autoLabelTables, isElectron } from './platform';
import './styles.css';
createRoot(document.getElementById('root')!).render(<App />);
autoLabelTables();
if (!isElectron() && (location.protocol === 'https:' || location.hostname === 'localhost') && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  (navigator as any).storage?.persist?.().catch(() => {});
}
