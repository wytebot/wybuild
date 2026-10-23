import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

type BoundaryState = { error: Error | null };
class StartupErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): BoundaryState { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[WyBuild startup] React render failed:', error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      const message = this.state.error?.message || String(this.state.error);
      return <main style={{ minHeight: '100dvh', boxSizing: 'border-box', padding: '28px 20px', background: '#020617', color: '#e2e8f0', fontFamily: 'system-ui,sans-serif' }}>
        <section style={{ maxWidth: 560, margin: '8vh auto', padding: 24, border: '1px solid #334155', borderRadius: 16, background: '#0f172a' }}>
          <h1 style={{ margin: '0 0 10px', fontSize: 22 }}>WyBuild couldn't start</h1>
          <p style={{ color: '#cbd5e1', lineHeight: 1.55 }}>The app encountered a startup error instead of loading the dashboard. Your saved app data has not been intentionally cleared.</p>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: 12, borderRadius: 8, background: '#020617', color: '#fca5a5', fontSize: 12 }}>{message}</pre>
          <button onClick={() => window.location.reload()} style={{ marginTop: 12, padding: '11px 16px', border: 0, borderRadius: 9, background: '#10b981', color: '#022c22', fontWeight: 700 }}>Reload WyBuild</button>
          <p style={{ marginTop: 16, color: '#94a3b8', fontSize: 12 }}>If this keeps happening, send a screenshot of this error to support.</p>
        </section>
      </main>;
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  document.body.innerHTML = '<main style="padding:24px;background:#020617;color:#fca5a5;font:16px system-ui">WyBuild could not start: the root app element is missing.</main>';
} else {
  try {
    createRoot(rootElement).render(<StartupErrorBoundary><App /></StartupErrorBoundary>);
  } catch (error) {
    console.error('[WyBuild startup] Failed to mount React:', error);
    rootElement.innerHTML = '<main style="padding:24px;background:#020617;color:#fca5a5;font:16px system-ui">WyBuild could not start. Please reload the app. If the problem continues, send a screenshot to support.</main>';
  }
}

// Display startup-time JavaScript failures instead of leaving a silent black screen.
(function installStartupErrorOverlay() {
  if (typeof window === 'undefined' || document.getElementById('wybuild-startup-error')) return;
  const show = (reason: unknown) => {
    if (document.getElementById('wybuild-startup-error')) return;
    const panel = document.createElement('section');
    panel.id = 'wybuild-startup-error';
    Object.assign(panel.style, { position: 'fixed', inset: '0', zIndex: '2147483647', overflow: 'auto', boxSizing: 'border-box', padding: '28px 20px', background: '#020617', color: '#e2e8f0', font: '14px system-ui,sans-serif' });
    const card = document.createElement('div');
    Object.assign(card.style, { maxWidth: '560px', margin: '8vh auto', padding: '24px', border: '1px solid #334155', borderRadius: '16px', background: '#0f172a' });
    const title = document.createElement('h1'); title.textContent = 'WyBuild startup error';
    Object.assign(title.style, { fontSize: '22px', margin: '0 0 12px' });
    const detail = document.createElement('pre'); detail.textContent = String((reason as any)?.stack || (reason as any)?.message || reason);
    Object.assign(detail.style, { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: '12px', borderRadius: '8px', background: '#020617', color: '#fca5a5', fontSize: '12px' });
    const button = document.createElement('button'); button.textContent = 'Reload WyBuild'; button.onclick = () => window.location.reload();
    Object.assign(button.style, { marginTop: '12px', padding: '11px 16px', border: '0', borderRadius: '9px', background: '#10b981', color: '#022c22', fontWeight: '700' });
    card.append(title, document.createTextNode('The app failed during startup. This diagnostic is shown instead of a blank screen.'), detail, button);
    panel.appendChild(card); (document.body || document.documentElement).appendChild(panel);
  };
  window.addEventListener('error', (event) => {
    // Resource errors can be harmless (for example a missing optional icon); show uncaught script errors.
    if (event.error) show(event.error);
  });
  window.addEventListener('unhandledrejection', (event) => show(event.reason));
})();

// PWA: offline shell + installability. Production only, so dev servers never get a stale worker.
if (import.meta.env.PROD && 'serviceWorker' in navigator && !(window as any).Capacitor?.isNativePlatform?.()) {
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
  window.addEventListener('wybuild:network', (event: Event) => {
    const detail = (event as CustomEvent<{online?: boolean}>).detail;
    if (typeof detail?.online === 'boolean') update(detail.online);
  });
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
