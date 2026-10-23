import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);

// PWA: offline shell + installability. Production only, so dev servers never get a stale worker.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => { /* unsupported or blocked: the site works without it */ });
  });
}

// Network status toast. Use the native bridge / Capacitor Network plugin where available,
// because navigator.onLine alone is unreliable in some Android WebViews.
(function installNetworkStatusToast() {
  if (typeof window === 'undefined' || document.getElementById('wybuild-network-toast')) return;
  const toast = document.createElement('div');
  toast.id = 'wybuild-network-toast';
  toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite');
  Object.assign(toast.style, { position:'fixed', top:'max(10px, env(safe-area-inset-top))', left:'50%', transform:'translate(-50%, -150%)', zIndex:'2147483647', padding:'10px 16px', borderRadius:'999px', background:'#b45309', color:'#fff', font:'600 13px system-ui, sans-serif', boxShadow:'0 8px 28px rgba(0,0,0,.28)', transition:'transform 220ms ease', pointerEvents:'none', maxWidth:'calc(100vw - 24px)', textAlign:'center' });
  document.body.appendChild(toast);
  let timer: number | undefined;
  let currentOnline: boolean | undefined;
  const show = (message: string, offline: boolean) => {
    toast.textContent = message; toast.style.background = offline ? '#b45309' : '#047857'; toast.style.transform = 'translate(-50%, 0)';
    if (timer) window.clearTimeout(timer);
    if (!offline) timer = window.setTimeout(() => { toast.style.transform = 'translate(-50%, -150%)'; }, 2600);
  };
  const update = (online: boolean) => {
    if (currentOnline === undefined) { currentOnline = online; if (!online) show("You're offline", true); return; }
    if (currentOnline === online) return;
    currentOnline = online;
    show(online ? "You're back online" : "You're offline", !online);
  };
  window.addEventListener('offline', () => update(false));
  window.addEventListener('online', () => update(true));
  // WyBuild's standalone Android WebView emits this from ConnectivityManager.
  window.addEventListener('wybuild:network', (event: Event) => {
    const detail = (event as CustomEvent<{online?: boolean}>).detail;
    if (typeof detail?.online === 'boolean') update(detail.online);
  });
  // Capacitor builds use the official Network plugin. It is dynamically loaded so the
  // browser/PWA version does not depend on native runtime availability.
  const cap = (window as any).Capacitor;
  if (cap?.isNativePlatform?.()) {
    import('@capacitor/network').then(async ({ Network }) => {
      const status = await Network.getStatus(); update(!!status.connected);
      await Network.addListener('networkStatusChange', state => update(!!state.connected));
    }).catch(() => update(navigator.onLine));
  } else {
    update(navigator.onLine);
  }
})();
