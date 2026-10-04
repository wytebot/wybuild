import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api, repoFromUrl, RepoInspection } from '../../services/api';
import { BuildTarget } from '../../types';
import { setPendingTwaRepo } from '../../services/handoff';
import { Github, X, Loader2, CheckCircle2, AlertCircle, WandSparkles } from 'lucide-react';

interface Props { isOpen:boolean; onClose:()=>void; }
export const NewProjectModal: React.FC<Props> = ({isOpen,onClose}) => {
 const { addProject, repos, subscription, projects, setCurrentTab } = useApp();
 const [repoInput,setRepoInput]=useState(''); const [inspection,setInspection]=useState<RepoInspection|null>(null);
 const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [target,setTarget]=useState<BuildTarget>('apk');
 const [runTests,setRunTests]=useState(true); const [obfuscate,setObfuscate]=useState(false); const [installing,setInstalling]=useState(false);
 const repo = useMemo(()=>repoFromUrl(repoInput),[repoInput]);
 if(!isOpen) return null;
 const inspect=async()=>{ if(!repo){setError('Choose a GitHub repository first.');return;} setBusy(true);setError('');setInspection(null); try{setInspection(await api.inspectRepo(repo));}catch(e:any){setError(e?.message||'Could not inspect repository.');}finally{setBusy(false);} };
 const connect=async()=>{
  if(!inspection||!repo)return;
  setError('');
  if(inspection.framework==='web'){
   // a website / PWA repo is built as an Android Trusted Web Activity, not as Flutter
   setInstalling(true);
   try{
    const ri=await api.inspectRepo(repo,'twa');
    if(!ri.workflowInstalled||!ri.workflowUpToDate) await api.installWorkflow(repo,ri.defaultBranch,'twa');
    setPendingTwaRepo(repo); setCurrentTab('twa'); onClose();
   }catch(e:any){setError(e?.message||'Could not prepare the Web to Android workflow.');}finally{setInstalling(false);}
   return;
  }
  if(inspection.framework!=='flutter'){setError(`Detected ${inspection.framework}. WyBuild builds Flutter repositories (APK/AAB) and websites/PWAs (Web to Android). This repo has no pubspec.yaml with Flutter and no web app, so there is nothing it can build yet.`);return;}
  setInstalling(true); try{ if(!inspection.workflowInstalled||!inspection.workflowUpToDate) await api.installWorkflow(repo,inspection.defaultBranch,'flutter'); const res=addProject({name:inspection.name,description:`${inspection.framework} repository`,repoUrl:`https://github.com/${repo}`,branch:inspection.defaultBranch,config:{target,mode:'release',flutterVersion:inspection.flutterVersion||'stable',dartDefines:[],obfuscate,splitDebugInfo:obfuscate,runTests,customArgs:''}}); if(res.success) onClose(); else setError(res.error||'Could not connect repository.'); }catch(e:any){setError(e?.message||'Could not install workflow.');}finally{setInstalling(false);} };
 const atLimit=subscription.plan!=='pro'&&projects.length>=10;
 return <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center"><div className="w-full sm:max-w-lg max-h-[94dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-[#07100d] border border-emerald-400/15 p-5 space-y-5 shadow-2xl">
  <div className="flex justify-between items-center"><div><h2 className="font-bold text-white">Connect repository</h2><p className="text-xs text-slate-500 mt-1">Pick the repo. WyBuild discovers the rest.</p></div><button onClick={onClose} className="p-2 text-slate-400"><X className="w-5 h-5"/></button></div>
  {atLimit&&<div className="text-xs p-3 rounded-lg border border-amber-400/20 bg-amber-400/[.05] text-amber-200">Free project limit reached.</div>}
  <div><label className="text-xs text-slate-400">GitHub repository</label><div className="flex gap-2 mt-1.5"><input list="wb-repos" value={repoInput} onChange={e=>{setRepoInput(e.target.value);setInspection(null);}} placeholder="owner/repo" className="min-w-0 flex-1 h-11 px-3 rounded-lg bg-black/30 border border-white/10 text-white font-mono outline-none focus:border-emerald-400/40"/><button disabled={busy||!repo} onClick={inspect} className="h-11 px-4 rounded-lg bg-emerald-400 text-black font-bold text-xs disabled:opacity-40">{busy?<Loader2 className="w-4 h-4 animate-spin"/>:'Discover'}</button></div><datalist id="wb-repos">{repos.map(r=><option key={r.fullName} value={r.fullName}/>)}</datalist></div>
  {inspection&&<div className="rounded-xl border border-emerald-400/15 bg-emerald-400/[.035] p-4 space-y-3"><div className="flex items-center gap-2 text-emerald-200 text-sm font-semibold"><WandSparkles className="w-4 h-4"/>Detected automatically</div><div className="grid grid-cols-2 gap-2 text-xs"><div><span className="text-slate-500">Framework</span><div className="text-white capitalize">{inspection.framework}</div></div><div><span className="text-slate-500">Branch</span><div className="text-white font-mono">{inspection.defaultBranch}</div></div><div><span className="text-slate-500">Flutter</span><div className="text-white font-mono">{inspection.flutterVersion}</div></div><div><span className="text-slate-500">Workflow</span><div className={inspection.workflowInstalled?'text-emerald-300':'text-slate-300'}>{inspection.workflowInstalled?(inspection.workflowUpToDate?'Ready':'Update needed'):'Will install'}</div></div></div></div>}
  {inspection?.framework==='web'&&<div className="text-xs p-3 rounded-lg border border-emerald-400/15 bg-emerald-400/[.04] text-emerald-100">This is a web app. WyBuild will install the Web to Android (TWA) workflow and open that screen with this repo selected, so you can build a signed APK of your site.</div>}
  {inspection?.framework==='flutter'&&<div className="space-y-3"><div className="text-xs font-semibold text-slate-300">Only choose what matters</div><div><label className="text-xs text-slate-500">Output</label><select value={target} onChange={e=>setTarget(e.target.value as BuildTarget)} className="w-full h-11 mt-1 bg-black/30 border border-white/10 rounded-lg px-3 text-white"><option value="apk">APK</option><option value="appbundle">AAB for Play Store</option><option value="split-per-abi">Smaller split APKs</option></select></div><label className="flex gap-3 items-center text-sm text-slate-300"><input type="checkbox" checked={runTests} onChange={e=>setRunTests(e.target.checked)}/>Run tests before build</label><label className="flex gap-3 items-center text-sm text-slate-300"><input type="checkbox" checked={obfuscate} onChange={e=>setObfuscate(e.target.checked)}/>Obfuscate release build</label></div>}
  {error&&<div className="flex gap-2 text-xs text-rose-300 p-3 rounded-lg bg-rose-500/[.06] border border-rose-500/20"><AlertCircle className="w-4 h-4 shrink-0"/>{error}</div>}
  <button disabled={!inspection||installing||atLimit} onClick={connect} className="w-full h-12 rounded-xl bg-emerald-400 text-black font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2">{installing?<><Loader2 className="w-4 h-4 animate-spin"/>Installing workflow…</>:<><CheckCircle2 className="w-4 h-4"/>{inspection?.framework==='web'?'Prepare Web to Android build':'Connect & prepare build'}</>}</button>
 </div></div>;
};
