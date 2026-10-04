import React, { useMemo, useState } from 'react';
import { Braces, Binary, Link2, Regex, FileText, Copy, Check } from 'lucide-react';

export const DevToolsView: React.FC = () => {
  const [json, setJson] = useState('');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [pattern, setPattern] = useState('');
  const [sample, setSample] = useState('');
  const [copied, setCopied] = useState(false);
  const encoded = useMemo(() => { try { return btoa(unescape(encodeURIComponent(text))); } catch { return ''; } }, [text]);
  const decoded = useMemo(() => { try { return decodeURIComponent(escape(atob(encoded))); } catch { return ''; } }, [encoded]);
  const formatted = useMemo(() => { try { return JSON.stringify(JSON.parse(json), null, 2); } catch { return ''; } }, [json]);
  const regexResult = useMemo(() => { if (!pattern) return []; try { const r = new RegExp(pattern, 'g'); return sample.match(r) || []; } catch { return []; } }, [pattern, sample]);
  const copy = async (v: string) => { await navigator.clipboard?.writeText(v); setCopied(true); setTimeout(() => setCopied(false), 1000); };
  const Tool = ({ icon: Icon, title, children }: any) => <section className="rounded-xl border border-white/[.06] bg-white/[.02] p-4 space-y-3"><div className="flex items-center gap-2 text-white font-semibold"><Icon className="w-4 h-4 text-emerald-300"/>{title}</div>{children}</section>;
  return <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4"><div><h1 className="text-2xl font-bold text-white">Free developer tools</h1><p className="text-sm text-slate-500 mt-1">Runs locally in your browser. No API calls, storage uploads, or usage charges.</p></div>
    <Tool icon={Braces} title="JSON Formatter"><textarea value={json} onChange={e=>setJson(e.target.value)} placeholder="Paste JSON" className="w-full min-h-24 rounded-lg bg-slate-950 border border-white/[.06] p-3 text-xs font-mono"/><textarea value={formatted} readOnly placeholder="Formatted JSON" className="w-full min-h-24 rounded-lg bg-slate-950 border border-white/[.06] p-3 text-xs font-mono"/></Tool>
    <Tool icon={Binary} title="Base64"><textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Text" className="w-full min-h-20 rounded-lg bg-slate-950 border border-white/[.06] p-3 text-xs"/><div className="text-xs font-mono text-slate-400 break-all">{encoded || 'Encoded output appears here'}</div><div className="text-xs font-mono text-slate-400 break-all">{decoded || 'Decoded output appears here'}</div></Tool>
    <Tool icon={Link2} title="URL Encoder"><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="Text or URL" className="w-full rounded-lg bg-slate-950 border border-white/[.06] p-3 text-xs"/><div className="text-xs font-mono text-slate-400 break-all">{url ? encodeURIComponent(url) : 'Encoded output appears here'}</div></Tool>
    <Tool icon={Regex} title="Regex Tester"><input value={pattern} onChange={e=>setPattern(e.target.value)} placeholder="Regular expression" className="w-full rounded-lg bg-slate-950 border border-white/[.06] p-3 text-xs font-mono"/><textarea value={sample} onChange={e=>setSample(e.target.value)} placeholder="Sample text" className="w-full min-h-20 rounded-lg bg-slate-950 border border-white/[.06] p-3 text-xs"/><div className="text-xs text-slate-400">Matches: {regexResult.length ? regexResult.join(', ') : 'none'}</div></Tool>
    <Tool icon={FileText} title="Text Analyzer"><textarea value={sample} onChange={e=>setSample(e.target.value)} placeholder="Paste text" className="w-full min-h-24 rounded-lg bg-slate-950 border border-white/[.06] p-3 text-xs"/><div className="grid grid-cols-3 gap-2 text-xs text-slate-400"><span>Chars: {sample.length}</span><span>Words: {sample.trim() ? sample.trim().split(/\s+/).length : 0}</span><span>Lines: {sample ? sample.split(/\r?\n/).length : 0}</span></div></Tool>
    <button onClick={()=>copy(formatted || encoded || url)} className="min-h-11 px-4 rounded-lg bg-emerald-500 text-black font-semibold text-sm flex items-center gap-2">{copied ? <Check className="w-4 h-4"/> : <Copy className="w-4 h-4"/>}Copy latest output</button>
  </div>;
};
