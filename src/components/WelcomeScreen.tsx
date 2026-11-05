import React, { useEffect, useState } from 'react';
import { ArrowRight, Code2, Layers3, ShieldCheck, Zap } from 'lucide-react';

const phrases = ['Build Android apps.', 'Ship with confidence.', 'Diagnose real failures.'];

export const WelcomeScreen: React.FC<{ onStart: () => void }> = ({ onStart }) => {
  const [phrase, setPhrase] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setPhrase((v) => (v + 1) % phrases.length), 2600);
    return () => window.clearInterval(id);
  }, []);

  return (
    <main className="wy-welcome min-h-dvh relative flex items-center justify-center overflow-hidden bg-[#030706] px-6 py-12 text-white">
      <div className="wy-welcome-orb wy-welcome-orb-a" aria-hidden="true" />
      <div className="wy-welcome-orb wy-welcome-orb-b" aria-hidden="true" />
      <div className="relative z-10 mx-auto w-full max-w-xl text-center">
        <div className="wy-welcome-mark mx-auto mb-8 grid h-20 w-20 place-items-center rounded-[26px] border border-emerald-300/25 bg-emerald-300/[0.08] text-emerald-300 shadow-[0_0_70px_rgba(16,185,129,.12)]">
          <Code2 size={38} strokeWidth={1.7} />
        </div>
        <p className="mb-4 text-[11px] font-bold uppercase tracking-[.34em] text-emerald-300/80">Your build workspace</p>
        <h1 className="text-5xl font-black tracking-[-.06em] sm:text-6xl">WyBuild<span className="text-emerald-300">.</span></h1>
        <div className="mt-5 h-9 overflow-hidden" aria-live="polite">
          <p key={phrase} className="wy-welcome-phrase text-lg font-semibold text-slate-200 sm:text-xl">{phrases[phrase]}</p>
        </div>
        <p className="mx-auto mt-5 max-w-md text-sm leading-7 text-slate-400 sm:text-base">A focused workspace to turn repositories into installable Android apps, manage releases and find the errors that stop your builds.</p>
        <div className="mt-9 grid grid-cols-3 gap-2 text-left sm:gap-3">
          {[{ icon: Zap, label: 'Fast builds' }, { icon: ShieldCheck, label: 'Safer releases' }, { icon: Layers3, label: 'Native tools' }].map(({ icon: Icon, label }) => (
            <div key={label} className="rounded-2xl border border-white/[0.07] bg-white/[0.025] px-2 py-4 text-center sm:px-4">
              <Icon className="mx-auto mb-2 h-5 w-5 text-emerald-300" />
              <span className="text-[11px] font-semibold text-slate-300 sm:text-xs">{label}</span>
            </div>
          ))}
        </div>
        <button onClick={onStart} className="wy-welcome-start mt-9 inline-flex min-h-14 w-full max-w-sm items-center justify-center gap-3 rounded-2xl bg-emerald-300 px-7 py-4 text-sm font-extrabold text-[#04100c] shadow-[0_12px_42px_rgba(16,185,129,.18)] transition hover:-translate-y-0.5 hover:bg-emerald-200 active:translate-y-0">
          Start <ArrowRight size={18} />
        </button>
        <p className="mt-5 text-[10px] tracking-wide text-slate-600">Developer tools, built for the way you ship.</p>
      </div>
    </main>
  );
};
