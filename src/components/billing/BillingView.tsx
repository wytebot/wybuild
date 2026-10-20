import React, { useEffect, useState } from 'react';
import { Coins, Sparkles, ShieldCheck, Zap, RefreshCw } from 'lucide-react';
import { api } from '../../services/api';

const PACKS = [
  { id: 'starter', name: 'Starter', credits: 100, usd: '$4.99', ngn: '₦7,500', note: 'For occasional build diagnosis' },
  { id: 'builder', name: 'Builder', credits: 250, usd: '$9.99', ngn: '₦15,000', note: 'Best for regular development' },
  { id: 'studio', name: 'Studio', credits: 700, usd: '$24.99', ngn: '₦37,500', note: 'For frequent AI repair sessions', popular: true },
];
export const BillingView: React.FC = () => {
  const [wallet, setWallet] = useState<{ balance: number; updatedAt?: string | null } | null>(null);
  const [model, setModel] = useState('Gemini');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = async () => { setLoading(true); setError(''); try { const r = await api.creditsBalance(); setWallet(r.wallet); setModel(r.model); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load credits.'); } finally { setLoading(false); } };
  useEffect(() => { void refresh(); }, []);
  const buy = (pack: string) => window.dispatchEvent(new CustomEvent('wybuild:credits-open', { detail: { pack } }));
  return <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
    <header><div className="flex items-center gap-2 text-emerald-300 text-xs font-bold uppercase tracking-widest"><Coins className="w-4 h-4"/> WyBuild Wallet</div><h1 className="mt-2 text-2xl sm:text-3xl font-bold text-white">Pay once. Use credits when you need AI.</h1><p className="mt-2 max-w-2xl text-sm text-slate-400">WyBuild no longer requires a monthly AI subscription. Buy a credit pack once; credits stay in your wallet and are used by Gemini build diagnosis and code repair.</p></header>
    <section className="rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/10 to-slate-950 p-5 sm:p-7 flex flex-col sm:flex-row sm:items-center justify-between gap-4"><div className="flex items-center gap-4"><div className="h-14 w-14 rounded-xl bg-emerald-500/10 border border-emerald-400/20 flex items-center justify-center"><Coins className="w-7 h-7 text-emerald-300"/></div><div><p className="text-xs uppercase tracking-wider text-slate-400">Available credits</p><div className="text-3xl font-bold text-white">{loading ? '…' : wallet?.balance ?? '—'}</div><p className="text-xs text-slate-400 mt-1">AI model: {model}</p></div></div><button onClick={() => void refresh()} className="px-4 py-2 rounded-lg border border-slate-700 text-xs font-bold text-slate-200 hover:bg-slate-900 flex items-center justify-center gap-2"><RefreshCw className="w-3.5 h-3.5"/> Refresh balance</button></section>
    {error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">{error}</div>}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{PACKS.map((p) => <article key={p.id} className={`relative rounded-2xl border p-5 flex flex-col ${p.popular ? 'border-emerald-400/40 bg-emerald-500/[.06]' : 'border-slate-800 bg-slate-950'}`}>{p.popular && <span className="absolute right-4 top-4 rounded-full bg-emerald-400/10 border border-emerald-400/20 px-2 py-1 text-[10px] font-bold text-emerald-200">BEST VALUE</span>}<h2 className="text-base font-bold text-white">{p.name}</h2><div className="mt-3 text-3xl font-bold text-white">{p.usd}</div><div className="text-xs text-slate-400 mt-1">{p.ngn} display equivalent · one-time</div><div className="mt-5 flex items-center gap-2 text-emerald-300"><Zap className="w-4 h-4"/><span className="text-xl font-bold">{p.credits} credits</span></div><p className="mt-2 text-xs text-slate-400 flex-1">{p.note}</p><button onClick={() => buy(p.id)} className={`mt-5 w-full rounded-lg py-3 text-sm font-bold ${p.popular ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400' : 'bg-slate-800 text-white hover:bg-slate-700'}`}>Buy credits</button></article>)}</div>
    <section className="rounded-xl border border-slate-800 bg-slate-950 p-4 sm:p-5"><div className="flex items-start gap-3"><ShieldCheck className="w-5 h-5 text-emerald-300 shrink-0 mt-0.5"/><div><h3 className="text-sm font-bold text-white">Transparent, usage-based AI</h3><p className="mt-1 text-xs leading-relaxed text-slate-400">Each AI request is metered using the provider's reported token usage and configured Gemini token rates. Code changes are only committed after you press Apply AI Fix. Missing Firebase configuration, signing secrets, and account permissions are reported as manual steps instead of being guessed or fabricated.</p></div></div></section>
  </div>;
};
