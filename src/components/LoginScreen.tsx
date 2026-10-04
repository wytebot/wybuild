import React, { useState } from 'react';
import { Github, KeyRound, ChevronDown, Loader2 } from 'lucide-react';
import { api, ApiError } from '../services/api';

export const LoginScreen: React.FC = () => {
  const [showToken, setShowToken] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
        <a
          href="/api/auth/login"
          className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition"
        >
          <Github className="w-4 h-4" />
          <span>Continue with GitHub</span>
        </a>
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
