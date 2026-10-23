import React, { useState } from 'react';
import { Github, KeyRound, ChevronDown, Loader2, Check, UserRound } from 'lucide-react';
import { api, ApiError } from '../services/api';

export const LoginScreen: React.FC = () => {
  const [showToken, setShowToken] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState<Array<{login:string;name:string;avatar?:string}>>(() => { try { return JSON.parse(localStorage.getItem('wybuild:githubAccounts') || '[]').filter((a: any) => a && typeof a.login === 'string').slice(0,5); } catch { return []; } });
  const [selectedAccount, setSelectedAccount] = useState('');
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  // The APK built from this very app serves the UI from https://localhost with no server behind it, so /api links lead nowhere.
  const isLocalBundle = typeof window !== 'undefined' && window.location.protocol === 'https:' && window.location.hostname === 'localhost' && !!(window as any).Capacitor?.isNativePlatform?.();
  const githubLoginUrl = selectedAccount ? `/api/auth/login?login=${encodeURIComponent(selectedAccount)}` : '/api/auth/login';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.loginWithToken(token.trim());
      setToken('');
      window.location.reload();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not sign in with that token.');
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100 flex items-center justify-center p-4 sm:p-6">
      <div className="max-w-sm w-full space-y-6 text-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">WyBuild</h1>
          <p className="text-sm text-slate-400 mt-2">
            Turn your web app or PWA into a signed Android app with Web → Android, powered by GitHub Actions. Sign in with GitHub to pick a repository and build.
          </p>
        </div>
        {isLocalBundle && <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3 text-left text-xs text-amber-200">This app copy has no WyBuild server inside it, so sign-in cannot work here. Build WyBuild with the Trusted Web Activity shell (shell: "twa") so it opens the live site, or use the web version at wybuild.app.</div>
        }
        {accounts.length > 0 && <div className="wy-account-chooser">
          <div className="wy-account-eyebrow">PREVIOUSLY USED ACCOUNTS</div>
          <button type="button" className="wy-account-trigger" aria-haspopup="listbox" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen(v => !v)}>
            <span className="wy-account-avatar">{accounts.find(a => a.login === selectedAccount)?.avatar ? <img src={accounts.find(a => a.login === selectedAccount)?.avatar} alt="" /> : <UserRound size={19} />}</span>
            <span className="wy-account-copy"><strong>{accounts.find(a => a.login === selectedAccount)?.name || 'Choose an account'}</strong><small>{selectedAccount ? `@${selectedAccount}` : 'Select a saved GitHub account'}</small></span>
            <ChevronDown className={`wy-account-chevron ${accountMenuOpen ? 'is-open' : ''}`} size={18} />
          </button>
          {accountMenuOpen && <div className="wy-account-menu" role="listbox" aria-label="Saved GitHub accounts" onKeyDown={e => { if (e.key === 'Escape') setAccountMenuOpen(false); }}>
            {accounts.map(a => <button type="button" role="option" aria-selected={selectedAccount === a.login} className={`wy-account-option ${selectedAccount === a.login ? 'is-selected' : ''}`} key={a.login} onClick={() => { setSelectedAccount(a.login); setAccountMenuOpen(false); }}>
              <span className="wy-account-avatar">{a.avatar ? <img src={a.avatar} alt="" /> : <UserRound size={18} />}</span><span className="wy-account-copy"><strong>{a.name || a.login}</strong><small>@{a.login}</small></span>{selectedAccount === a.login && <Check size={17} className="wy-account-check" />}
            </button>)}
          </div>}
          <a href={githubLoginUrl} aria-disabled={!selectedAccount} onClick={e => { if (!selectedAccount) e.preventDefault(); }} className={`wy-account-continue ${selectedAccount ? '' : 'is-disabled'}`}><Github className="w-4 h-4" /><span>Continue as @{selectedAccount || '…'}</span></a>
        </div>}
        <a href="/api/auth/login?account=other" className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-md border border-white/10 hover:bg-white/5 text-white text-sm font-semibold transition"><Github className="w-4 h-4" /><span>Continue with another GitHub account</span></a>
        <p className="text-[11px] text-slate-500">Previously used account names are stored on this device only. "Continue with another GitHub account" opens GitHub's account picker so you can switch to, or sign in as, a different account.</p>
        <p className="text-[11px] text-slate-500">
          Needs the repo and workflow scopes so WyBuild can add its workflow, start runs and store your signing key as encrypted repository secrets.
        </p>

        <div className="text-left rounded-lg border border-white/[.07]">
          <button type="button" onClick={() => setShowToken((v) => !v)} aria-expanded={showToken} className="w-full px-3 py-2.5 flex items-center gap-2 text-xs text-slate-300">
            <KeyRound className="w-4 h-4 text-emerald-300" />
            <span className="flex-1">Use a personal access token instead</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${showToken ? 'rotate-180' : ''}`} />
          </button>
          {showToken && (
            <form onSubmit={submit} className="px-3 pb-3 space-y-2.5">
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Use this when GitHub sign-in cannot grant enough access. Create a <b className="text-slate-300">classic</b> token with <b className="text-slate-300">repo</b> and <b className="text-slate-300">workflow</b> ticked, on the account that has write access to your repository.{' '}
                <a className="text-emerald-300 underline" target="_blank" rel="noreferrer" href="https://github.com/settings/tokens/new?scopes=repo,workflow&description=WyBuild">Create token</a>.
                A token cannot give an account more access than it already has. The token is stored only in an encrypted, 7-day session cookie.
              </p>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_… or github_pat_…"
                className="w-full h-10 px-3 rounded-md bg-black/30 border border-white/10 text-white text-sm font-mono"
              />
              {error && <div role="alert" className="text-[11px] text-rose-300 leading-relaxed">{error}</div>}
              <button disabled={busy || token.trim().length < 20} type="submit" className="w-full h-10 rounded-md bg-emerald-400 text-black text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}Verify and sign in
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
