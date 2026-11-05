import React from 'react';
import {saveAgent,decryptSecret} from '../lib/agents';
import {db} from '../lib/db';

const DEFAULTS={keyEnv:'GEMINI_API_KEY',modelEnv:'GEMINI_MODEL',fallbackEnv:'GEMINI_FALLBACK_MODELS'};
const cleanUrl=value=>String(value||'').trim().replace(/\/+$/,'');
const parseModels=value=>[...new Set(String(value||'').split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean))].slice(0,7);

export default function VercelBackendWorkspace({api,onReconnect,onNotice,onSaved,locked=false,onUnlock}){
 const [connected,setConnected]=React.useState(false),[projects,setProjects]=React.useState([]),[selected,setSelected]=React.useState('');
 const [config,setConfig]=React.useState(null),[redirectInfo,setRedirectInfo]=React.useState(null),[backendUrl,setBackendUrl]=React.useState(''),[keyEnv,setKeyEnv]=React.useState(DEFAULTS.keyEnv),[modelEnv,setModelEnv]=React.useState(DEFAULTS.modelEnv),[fallbackEnv,setFallbackEnv]=React.useState(DEFAULTS.fallbackEnv);
 const [apiKey,setApiKey]=React.useState(''),[model,setModel]=React.useState(''),[fallbacks,setFallbacks]=React.useState(''),[targets,setTargets]=React.useState(['production','preview','development']);
 const [busy,setBusy]=React.useState(''),[message,setMessage]=React.useState(''),[error,setError]=React.useState(''),[configured,setConfigured]=React.useState(false);
 const notify=(text)=>{setMessage(text);setError('');onNotice?.(text)};
 const fail=(e)=>{setError(String(e?.message||e||'The operation could not be completed.'));setMessage('')};
 const load=React.useCallback(async()=>{
  setBusy('load');setError('');
  try{
   const [status,projectData,meta,redirect]=await Promise.all([api('/api/vercel/status'),api('/api/vercel/projects'),api('/api/vercel/backend/config'),api('/api/vercel/redirect-info').catch(e=>({ok:false,error:e?.message||'Callback URL could not be determined.'}))]);
   setRedirectInfo(redirect);setConnected(!!status.connected);setProjects(projectData.projects||[]);setSelected(meta.projectId||projectData.selectedProjectId||'');setConfig(meta.config||null);
   if(meta.config){setBackendUrl(meta.config.backendUrl||'');setKeyEnv(meta.config.keyEnv||DEFAULTS.keyEnv);setModelEnv(meta.config.modelEnv||DEFAULTS.modelEnv);setFallbackEnv(meta.config.fallbackEnv||DEFAULTS.fallbackEnv);setModel(meta.config.model||'');setFallbacks((meta.config.fallbackModels||[]).join('\n'));setTargets(meta.config.targets||['production','preview','development']);setConfigured(String(meta.config.projectId||'')===String(meta.projectId||''))}
   else setConfigured(false);
  }catch(e){fail(e)}finally{setBusy('')}
 },[api]);
 React.useEffect(()=>{load()},[load]);
 async function chooseProject(p){
  setBusy('project');setError('');
  try{await api('/api/vercel/project',{method:'POST',body:JSON.stringify({projectId:p.id,teamId:p.teamId||null})});setSelected(p.id);setConfigured(String(config?.projectId||'')===String(p.id));notify(`Selected ${p.name}.`)}
  catch(e){fail(e)}finally{setBusy('')}
 }
 function toggleTarget(value){setTargets(old=>old.includes(value)?old.filter(x=>x!==value):[...old,value])}
 async function configure(e){
  e?.preventDefault?.();setError('');setMessage('');
  const url=cleanUrl(backendUrl),fallbackModels=parseModels(fallbacks);
  if(!url.startsWith('https://'))return fail('Enter a public HTTPS backend URL.');
  if(!selected)return fail('Select a Vercel project first.');
  if(!apiKey.trim())return fail('Enter the provider API key to store in the selected Vercel project.');
  if(!model.trim())return fail('Enter the primary model ID.');
  if(!targets.length)return fail('Select at least one deployment target.');
  setBusy('save');
  try{
   const result=await api('/api/vercel/backend/configure',{method:'POST',body:JSON.stringify({backendUrl:url,keyEnv:keyEnv.trim(),modelEnv:modelEnv.trim(),fallbackEnv:fallbackEnv.trim(),model:model.trim(),fallbackModels,apiKey:apiKey.trim(),targets})});
   const token=result.backendToken;
   for(const fn of ['Chat','Diagnosis','Fix generation']){
    const old=await db.agents.where('function').equals(fn).filter(a=>a.label==='Vercel Backend'&&a.provider==='openai-compatible').first();
    await saveAgent({id:old?.id,function:fn,provider:'openai-compatible',baseUrl:url,model:model.trim(),models:[model.trim(),...fallbackModels],modelVariants:fallbackModels.join('\n'),modelEnv:modelEnv.trim(),keyEnv:keyEnv.trim(),fallbackEnv:fallbackEnv.trim(),key:token,label:'Vercel Backend',default:true});
   }
   setApiKey('');setConfig(result.config);setConfigured(true);notify('Backend settings saved to Vercel and the Vercel Backend agent was added for Chat, Diagnosis and Fix. Redeploy the selected project to activate its environment variables.');
   await onSaved?.();
  }catch(e){fail(e)}finally{setBusy('')}
 }
 async function testBackend(){
  setBusy('test');setError('');setMessage('');
  try{
   const agent=await db.agents.where('function').equals('Chat').filter(a=>a.label==='Vercel Backend'&&a.provider==='openai-compatible').first();
   if(!agent?.secret)throw new Error('Save the backend configuration first on this device so its encrypted access token is available.');
   const token=await decryptSecret(agent.secret);
   const result=await api('/api/vercel/backend/test',{method:'POST',body:JSON.stringify({backendUrl:cleanUrl(backendUrl),backendToken:token}),timeoutMs:18000,noRetry:true});
   notify(result.note||'Backend endpoint is responding.');
  }catch(e){fail(e)}finally{setBusy('')}
 }
 const selectedProject=projects.find(p=>p.id===selected);
 if(locked)return <section className="vercel-backend-page"><div className="panel"><h2>Backend settings are protected</h2><p>Verify your device authenticator or PotHub passcode before changing backend credentials.</p><button type="button" className="primary" onClick={onUnlock}>Unlock backend settings</button></div></section>;
 return <section className="vercel-backend-page">
  <div className="page-heading"><div><h1>Vercel Backend</h1><p>Configure a private AI backend and keep provider credentials in your own Vercel project.</p></div><button type="button" className="secondary" onClick={load} disabled={!!busy}>Refresh</button></div>
  <div className="panel vb-callback-guide">
   <div className="vb-section-head"><div><h2>Vercel OAuth callback</h2><p>This exact URL must be registered in your Vercel OAuth app's Authorization Callback URLs. A mismatch causes Vercel's “Invalid redirect” error before PotHub can receive the login response.</p></div></div>
   <div className="vb-callback-value"><code>{redirectInfo?.redirectUri||'Callback URL unavailable — check APP_URL / VERCEL_REDIRECT_URI settings.'}</code><button type="button" className="secondary" disabled={!redirectInfo?.redirectUri} onClick={async()=>{try{await navigator.clipboard.writeText(redirectInfo.redirectUri);notify('Vercel callback URL copied.')}catch{fail('Could not copy automatically. Select and copy the callback URL above.')}}}>Copy URL</button></div>
   <p className="vb-muted">In Vercel → your Sign in with Vercel app → Manage → Authorization Callback URLs, add the URL above exactly. Use the same HTTPS domain, path and spelling; do not add a trailing slash. Do not register <code>/api/vercel/connect</code> or a preview deployment URL.</p>
   {redirectInfo?.registeredDomain&&<p className={redirectInfo.isValid?'vb-muted':'vb-error-inline'}>{redirectInfo.isValid?'Registered domain matches the resolved callback.':`Domain mismatch: Vercel is configured for ${redirectInfo.registeredDomain}, but PotHub resolves ${redirectInfo.redirectUri}.`}</p>}
   {redirectInfo&&!redirectInfo.registeredDomain&&<p className="vb-muted">To enable automatic domain comparison, set <code>VERCEL_REGISTERED_DOMAIN</code> in PotHub to the domain registered in the Vercel OAuth console.</p>}
   {redirectInfo?.error&&<p className="vb-error-inline">{redirectInfo.error}</p>}
  </div>
  {!connected?<div className="panel vb-connect"><h2>Connect your Vercel account</h2><p>PotHub will open Vercel's own authorization page. If Vercel requests an email verification code, enter it there; PotHub will not ask you to copy that code into the app.</p><button className="primary" onClick={onReconnect} disabled={!!busy}>Connect / reauthorize Vercel</button></div>:<>
   <div className="panel vb-projects"><div className="vb-section-head"><div><h2>1. Choose your Vercel project</h2><p>Only projects available to the connected Vercel account are listed.</p></div><span className="vb-state">Vercel connected</span></div>
    {projects.length?<div className="vb-project-list">{projects.map(p=><button type="button" key={`${p.id}:${p.teamId||''}`} className={`vb-project ${selected===p.id?'active':''}`} onClick={()=>chooseProject(p)} disabled={!!busy}><span className="vb-project-icon">▲</span><span className="vb-project-copy"><strong>{p.name}</strong><small>{p.framework||'Vercel project'}{p.domains?.[0]?` · ${p.domains[0]}`:''}</small></span><span className="vb-project-check">{selected===p.id?'Selected':'Select'}</span></button>)}</div>:<p className="vb-muted">{busy==='load'?'Loading projects…':'No projects found. Refresh or reconnect Vercel.'}</p>}
    {selectedProject&&<p className="vb-selected-note">Current project: <strong>{selectedProject.name}</strong></p>}
   </div>
   <form className="panel vb-config" onSubmit={configure}>
    <div className="vb-section-head"><div><h2>2. Backend configuration</h2><p>PotHub sends AI requests to this URL. The endpoint must implement the OpenAI-compatible API.</p></div></div>
    <label>Backend base URL<input value={backendUrl} onChange={e=>setBackendUrl(e.target.value)} placeholder="https://your-project.vercel.app/v1" autoCapitalize="none" autoCorrect="off" spellCheck="false" inputMode="url"/></label>
    <div className="vb-two-col"><label>Provider API-key variable<input value={keyEnv} onChange={e=>setKeyEnv(e.target.value.toUpperCase())} placeholder="GEMINI_API_KEY" autoCapitalize="characters"/></label><label>Model variable<input value={modelEnv} onChange={e=>setModelEnv(e.target.value.toUpperCase())} placeholder="GEMINI_MODEL" autoCapitalize="characters"/></label></div>
    <label>Provider API key<input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder={configured?'Enter a new key to rotate the stored key':'Paste the provider key to store in Vercel'} autoComplete="new-password"/></label>
    <label>Primary model ID<input value={model} onChange={e=>setModel(e.target.value)} placeholder="Enter the exact active model ID" autoCapitalize="none" autoCorrect="off" spellCheck="false"/></label>
    <label>Fallback model IDs<textarea rows={3} value={fallbacks} onChange={e=>setFallbacks(e.target.value)} placeholder="One model ID per line"/></label>
    <label>Fallback-model environment variable<input value={fallbackEnv} onChange={e=>setFallbackEnv(e.target.value.toUpperCase())}/></label>
    <div className="vb-targets"><strong>Apply environment variables to</strong><div>{['production','preview','development'].map(t=><label key={t}><input type="checkbox" checked={targets.includes(t)} onChange={()=>toggleTarget(t)}/>{t[0].toUpperCase()+t.slice(1)}</label>)}</div></div>
    <div className="vb-security-note"><strong>Credential protection</strong><p>The provider key is sent directly to Vercel over HTTPS and is not saved in PotHub's database. Vercel stores it as an encrypted environment variable. A separate generated backend token is stored in the local encrypted agent vault and as a secret environment variable. Never add either secret to a NEXT_PUBLIC_ variable.</p></div>
    <button className="primary" type="submit" disabled={!!busy||!selected}>{busy==='save'?'Saving securely…':'Save backend to Vercel'}</button>
   </form>
   {configured&&<div className="panel vb-status"><div className="vb-section-head"><div><h2>3. Backend status</h2><p>Configuration metadata is saved. Secret values are never read back into this page.</p></div><span className="vb-state">Configured</span></div><div className="vb-meta"><span>Backend URL</span><strong>{config?.backendUrl||backendUrl}</strong><span>API key variable</span><strong>{config?.keyEnv||keyEnv}</strong><span>Model variable</span><strong>{config?.modelEnv||modelEnv}</strong><span>Fallbacks</span><strong>{(config?.fallbackModels||parseModels(fallbacks)).join(', ')||'None configured'}</strong><span>Targets</span><strong>{(config?.targets||targets).join(', ')}</strong></div><button type="button" className="secondary" onClick={testBackend} disabled={!!busy}>{busy==='test'?'Testing endpoint…':'Test backend endpoint'}</button><p className="vb-muted">After saving environment variables, redeploy the selected Vercel project. The endpoint must expose GET /models and POST /chat/completions, and validate the generated Bearer token against POTHUB_BACKEND_TOKEN. PotHub's own server also needs POTHUB_ALLOW_CUSTOM_AGENT_ENDPOINTS=true before it can call a custom backend URL.</p></div>}
   <div className="vb-warning"><strong>Vercel permission requirement</strong><p>Environment-variable writes require a Vercel Integration with the <code>project-env-vars</code> scope. If Vercel denies the request, approve that scope for the integration and reconnect. The email verification step, if requested, stays on Vercel's own page.</p><button type="button" className="quiet" onClick={onReconnect}>Reauthorize Vercel</button></div>
  </>}
  {error&&<div className="vb-feedback error" role="alert">{error}{/401|authorization|token|expired/i.test(error)&&<button type="button" onClick={onReconnect}>Reauthorize</button>}</div>}
  {message&&<div className="vb-feedback success" role="status">{message}</div>}
 </section>;
}
