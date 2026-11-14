import { Capacitor, registerPlugin } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { iconId, normalizeIcon } from './app-icon-data';
export const native=()=>Capacitor.isNativePlatform();
// Android: a Chrome Custom Tab that slides over the app (not a separate browser app) and returns through the ai.pothub.app deep link.
function nativeReturnScheme(){ try{ const s=String(window.__WYBUILD_RUNTIME_CONFIG__?.returnScheme||'').toLowerCase(); return /^[a-z][a-z0-9+.-]{1,30}$/.test(s)?s:'' }catch{ return '' } }
export async function openAuth(url){ if(native()){ const scheme=nativeReturnScheme(); if(scheme){ try{ const u=new URL(url); if(u.searchParams.get('native')==='1'&&!u.searchParams.has('scheme')){ u.searchParams.set('scheme',scheme); url=u.toString() } }catch{} } try{ return await Browser.open({url,presentationStyle:'popover',toolbarColor:'#0d1117'}) }catch{ return Browser.open({url}) } } window.location.assign(url); }
export async function copyText(value){const text=String(value||'');try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return true}}catch{}const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();const ok=document.execCommand('copy');area.remove();if(!ok)throw new Error('Copy is unavailable in this browser. Select and copy the text manually.');return true}
export async function shareText(title,text,url){ if(native()) return Share.share({title,text,url,dialogTitle:title}); if(navigator.share){try{return await navigator.share({title,text,url})}catch(e){if(e?.name==='AbortError')return {cancelled:true}}}await copyText(url||text);return {copied:true} }
const PublicDownloads=registerPlugin('PublicDownloads');
export async function saveFile(source, name, mime = 'application/octet-stream') {
  const safeName = String(name || 'download').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180) || 'download';
  let blob;
  if (source instanceof Blob) blob = source;
  else if (typeof source === 'string') {
    const response = await fetch(source, { credentials: 'omit', redirect: 'follow' });
    if (!response.ok) throw new Error('The file could not be downloaded. Check the link and retry.');
    blob = await response.blob();
  } else throw new Error('Choose a file or a valid download link first.');
  if (!blob.type && mime) blob = new Blob([blob], { type: mime });
  if (native()) {
    let sessionId = '';
    try {
      const session = await PublicDownloads.begin({ filename: safeName, mimeType: blob.type || mime || 'application/octet-stream' });
      sessionId = session.id;
      const chunkSize = 1024 * 1024;
      for (let offset = 0; offset < blob.size; offset += chunkSize) {
        const bytes = new Uint8Array(await blob.slice(offset, Math.min(blob.size, offset + chunkSize)).arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        await PublicDownloads.append({ id: sessionId, data: btoa(binary) });
      }
      return await PublicDownloads.finish({ id: sessionId });
    } catch (error) {
      if (sessionId) try { await PublicDownloads.abort({ id: sessionId }); } catch {}
      if (blob.size > 20 * 1024 * 1024) throw new Error('Android could not save this large file. Retry or use the browser download.');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return Filesystem.writeFile({ path: safeName, directory: Directory.Documents, data: btoa(binary), recursive: true });
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a'); a.href = url; a.download = safeName; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  return { ok: true, filename: safeName };
}
export async function saveBlob(blob, name) { return saveFile(blob, name, blob?.type || 'application/octet-stream'); }


export async function getNativeSession(){if(!native())return '';try{return (await SecureStorage.get('pothub-session-v1'))||''}catch{return ''}}
export async function setNativeSession(token){if(!native())return;await SecureStorage.set('pothub-session-v1',token)}
export async function clearNativeSession(){if(!native())return;try{await SecureStorage.remove('pothub-session-v1')}catch{}}

// Android launcher icon (Capacitor APK only). Resolves to { ok, message }.
const AppIcon=registerPlugin('AppIcon');
export async function setLauncherIcon(choice){
  if(!native())return {ok:false,unsupported:true,message:''};
  try{await AppIcon.setIcon({id:iconId(normalizeIcon(choice))});return {ok:true,message:'Android launcher icon updated. Your launcher can take a few seconds to refresh.'}}
  catch(error){const text=String(error?.message||error||'');const missing=/not implemented|not available|unimplemented/i.test(text);return {ok:false,message:missing?'This APK was built before launcher-icon support was added. Rebuild the APK to change the launcher icon; the in-app color and icon already changed.':`The launcher icon could not be changed: ${text.slice(0,140)}`}}
}
