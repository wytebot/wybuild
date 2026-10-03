import React from 'react';
import { Github } from 'lucide-react';

export const LoginScreen: React.FC = () => (
  <div className="h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
    <div className="max-w-sm w-full space-y-6 text-center">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">WyBuild</h1>
        <p className="text-sm text-slate-400 mt-2">
          Build Flutter APKs and app bundles, or turn a web app into a signed Android TWA, on GitHub Actions. Sign in with GitHub to pick a repository and start a build.
        </p>
      </div>
      <a
        href="/api/auth/login"
        className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold transition"
      >
        <Github className="w-4 h-4" />
        <span>Continue with GitHub</span>
      </a>
      <p className="text-[11px] text-slate-500">
        Needs the repo and workflow scopes so WyBuild can add its workflow, start runs and store your signing key as encrypted repository secrets.
      </p>
    </div>
  </div>
);
