import {db,uid} from './db';
import {Capacitor} from '@capacitor/core';
import {SecureStorage} from '@aparajita/capacitor-secure-storage';
const enc=new TextEncoder(),dec=new TextDecoder();
const NATIVE_KEY='pothub-agent-aes-key-v1';
const toB64=bytes=>btoa(String.fromCharCode(...bytes));
async function keyForStore(){
  if(Capacitor.isNativePlatform()){
    const legacy=await db.settings.get('crypto-key-v1');
    let stored='';
    try{stored=await SecureStorage.get(NATIVE_KEY)||''}catch(e){
      if(legacy?.value||legacy?.key instanceof CryptoKey)return legacy.value||(legacy.key instanceof CryptoKey?legacy.key:null);
      if(!/not found|missing|does not exist/i.test(String(e?.message||'')))throw new Error('Android secure storage is unavailable. Update/sync the native Secure Storage plugin before saving API keys.');
    }
    // While migration is pending, keep using the legacy key. This prevents a
    // partially completed native-key migration from making existing agents unreadable.
    if(legacy?.value||legacy?.key instanceof CryptoKey)return legacy.value||(legacy.key instanceof CryptoKey?legacy.key:null);
    if(typeof stored==='string'&&stored){const raw=Uint8Array.from(atob(stored),c=>c.charCodeAt(0));return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt'])}
    const agents=await db.agents.toArray();
    if(agents.length)throw new Error('Saved API keys need recovery: the Android secure-storage key is missing. Do not overwrite or clear app data; restore a PotHub backup or contact support.');
    const raw=crypto.getRandomValues(new Uint8Array(32));await SecureStorage.set(NATIVE_KEY,toB64(raw));
    return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']);
  }
  let row=await db.settings.get('crypto-key-v1');if(row?.value)return row.value;if(row?.key instanceof CryptoKey)return row.key;
  const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);await db.settings.put({key:'crypto-key-v1',value:key});return key;
}

export async function migrateNativeAgentKeys(){
  if(!Capacitor.isNativePlatform())return {migrated:0};
  const legacy=await db.settings.get('crypto-key-v1');
  const oldKey=legacy?.value||(legacy?.key instanceof CryptoKey?legacy.key:null);
  let saved='';
  try{saved=await SecureStorage.get(NATIVE_KEY)||''}catch(e){if(!/not found|missing|does not exist/i.test(String(e?.message||'')))throw new Error('Android secure storage is unavailable. Agent keys were not changed.')}
  if(!oldKey){
    if(saved)return {migrated:0};
    const agents=await db.agents.toArray();
    if(agents.length)throw new Error('Saved API keys exist but their encryption key is missing. No key was replaced. Restore a backup before continuing.');
    const raw=crypto.getRandomValues(new Uint8Array(32));await SecureStorage.set(NATIVE_KEY,toB64(raw));return {migrated:0};
  }
  const raw=saved?Uint8Array.from(atob(saved),c=>c.charCodeAt(0)):crypto.getRandomValues(new Uint8Array(32));
  const nextKey=await crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']);
  const agents=await db.agents.toArray(),prepared=[];
  // Decode every record before writing either the new key or any new ciphertext.
  // A corrupt record therefore cannot leave a half-migrated vault.
  for(const agent of agents){
    if(!agent.secret?.iv||!agent.secret?.cipher)throw new Error(`Saved API agent ${agent.label||agent.id} has an invalid encrypted-key record. No keys were changed.`);
    let plain,alreadyNew=false;
    try{plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(agent.secret.iv)},oldKey,new Uint8Array(agent.secret.cipher))}
    catch{
      if(!saved)throw new Error(`Could not decrypt API key for ${agent.label||agent.id}. No keys were changed.`);
      try{plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(agent.secret.iv)},nextKey,new Uint8Array(agent.secret.cipher));alreadyNew=true}
      catch{throw new Error(`Could not decrypt API key for ${agent.label||agent.id}. No keys were changed.`)}
    }
    if(alreadyNew){prepared.push(agent);continue}
    const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},nextKey,plain);
    prepared.push({...agent,secret:{iv:Array.from(iv),cipher:Array.from(new Uint8Array(cipher))},keyVersion:'native-secure-v1'});
  }
  if(!saved)await SecureStorage.set(NATIVE_KEY,toB64(raw));
  await db.transaction('rw',db.agents,db.settings,async()=>{
    if(prepared.length)await db.agents.bulkPut(prepared);
    await db.settings.delete('crypto-key-v1');
  });
  return {migrated:prepared.filter((row,index)=>row!==agents[index]).length};
}
export async function encryptSecret(secret){const key=await keyForStore(),iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,enc.encode(secret));return {iv:Array.from(iv),cipher:Array.from(new Uint8Array(cipher))};}
export async function decryptSecret(payload){const key=await keyForStore(),plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(payload.iv)},key,new Uint8Array(payload.cipher));return dec.decode(plain);}
export async function saveAgent(input){const secret=await encryptSecret(input.key);const now=new Date().toISOString();const models=[...new Set([...(Array.isArray(input.models)?input.models:[]),...String(input.modelVariants||'').split(/[\n,;]+/),input.model].map(x=>String(x||'').trim()).filter(Boolean))].slice(0,8);const agent={id:input.id||uid(),function:input.function,provider:input.provider,baseUrl:input.baseUrl||'',model:models[0]||input.model,models,modelEnv:String(input.modelEnv||''),keyEnv:String(input.keyEnv||''),fallbackEnv:String(input.fallbackEnv||''),label:input.label,default:!!input.default,secret,updatedAt:now};await db.transaction('rw',db.agents,async()=>{if(agent.default)await db.agents.where('function').equals(agent.function).modify(a=>{a.default=false;a.updatedAt=now});await db.agents.put(agent)});return {...agent,secret:undefined};}
export async function defaultAgent(fn){return (await db.agents.where('function').equals(fn).toArray()).find(a=>a.default)||null;}

export async function clearAgentSecrets(){await db.agents.clear();await db.settings.delete('crypto-key-v1');if(Capacitor.isNativePlatform()){try{await SecureStorage.remove(NATIVE_KEY)}catch{}}}
