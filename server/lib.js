import crypto from 'node:crypto';
import { DAILY_FREE_CREDITS, DAILY_FREE_INTERVAL_MS, shouldChargeForAiWorkflow } from './credit-policy.js';
import { sealData, unsealData } from './iron.js';
import { getApps, initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { grantDocumentId } from './billing-safety.js';
import { decideOperation } from './operation-state.js';
import { starterGrantEligibility } from './starter-credit-policy.js';
import {grantCreditsOnce, reserveCreditReservation,commitCreditReservation as commitReservation,releaseCreditReservation as releaseReservation} from './credit-reservations.js';
import {storeSignedObject,signStoredObject} from './signed-media.js';
import {freeForeverMatch,freeForeverConfigured} from './free-forever-policy.js';
import {FREE_DAILY_ACTIONS,isAgentAction,subscriptionState} from './plans.js';
import {consumeAgentAction,refundAgentAction,readSubscription,readUsage,activatePlan} from './usage-quota.js';

function parseServiceAccount(rawValue){
  if(rawValue && typeof rawValue === 'object') return rawValue;
  const raw=String(rawValue||'').trim();
  if(!raw) return null;
  const candidates=[];
  const unquoted=raw.replace(/^['"]|['"]$/g,'').trim();
  candidates.push(unquoted);
  if(unquoted.startsWith('base64:')) candidates.push(Buffer.from(unquoted.slice(7),'base64').toString('utf8'));
  // Support deployments that store the whole JSON document as base64.
  if(!unquoted.startsWith('{') && /^[A-Za-z0-9+/=_-]+$/.test(unquoted)) {
    try { candidates.push(Buffer.from(unquoted,'base64').toString('utf8')); } catch {}
  }
  candidates.push(unquoted.replace(/\\n/g,'\n'));
  let lastError;
  for(const candidate of candidates){
    try {
      const parsed=JSON.parse(candidate);
      if(!parsed || typeof parsed!=='object' || Array.isArray(parsed)) throw new Error('service account JSON must be an object');
      return parsed;
    } catch(e){ lastError=e; }
  }
  throw new Error(`FIREBASE_SERVICE_ACCOUNT_JSON is malformed: ${lastError?.message||'could not parse JSON'}`);
}

function initFirebaseAdmin(){
  if(getApps().length) return getApps()[0];
  const raw=process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const projectId=String(process.env.FIREBASE_PROJECT_ID||'').trim();
  if(String(raw||'').trim()){
    const parsed=parseServiceAccount(raw);
    if(!parsed.project_id && !projectId) throw new Error('Firebase service account is missing project_id; set FIREBASE_PROJECT_ID if the JSON omits it.');
    if(!parsed.client_email || !parsed.private_key) throw new Error('Firebase service account JSON must include client_email and private_key.');
    initializeApp({credential:cert(parsed), ...(projectId?{projectId}:{}), storageBucket:process.env.FIREBASE_STORAGE_BUCKET||`${parsed.project_id||projectId}.firebasestorage.app`});
  } else {
    // ADC is supported, but failure is captured below and never crashes import.
    initializeApp({credential:applicationDefault(), ...(projectId?{projectId}:{}), ...(process.env.FIREBASE_STORAGE_BUCKET?{storageBucket:process.env.FIREBASE_STORAGE_BUCKET}:projectId?{storageBucket:`${projectId}.firebasestorage.app`}:{})});
  }
  return getApps()[0];
}
let firestoreInstance=null, firebaseInitError=null;
function ensureFirebaseInitialized(){
  if(firestoreInstance) return firestoreInstance;
  try {
    initFirebaseAdmin();
    const instance=getFirestore();
    // Session/profile documents can contain optional fields that are undefined;
    // without this Firestore throws "Cannot use undefined as a Firestore value".
    try { instance.settings({ignoreUndefinedProperties:true}); } catch { /* settings already applied */ }
    firestoreInstance=instance;
    firebaseInitError=null;
    // ES module live bindings: importers see the updated values after a late/retried init.
    firestore=instance; databaseReady=true;
    return firestoreInstance;
  } catch(e) {
    firebaseInitError=e;
    console.error('[Pothub Firebase Admin initialization]', String(e?.message||e).slice(0,300));
    return null;
  }
}
// Attempt initialization once at cold start to preserve existing Firestore flows;
// failures are captured and reported only by routes that need Firebase.
export let firestore=null;
export let databaseReady=false;
ensureFirebaseInitialized();
export function databaseError(){return firebaseInitError;}
export function ensureDatabase(){ensureFirebaseInitialized();return databaseReady;}
export function firebaseAdminStatus(){
  const configured=!!String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON||'').trim();
  if(firebaseInitError) return {configured,error:String(firebaseInitError.message||'Firebase Admin initialization failed').slice(0,220)};
  return {configured,ready:!!firestoreInstance,error:null};
}
export function getAdminAuth(){
  ensureFirebaseInitialized();
  if(!firestoreInstance) throw new Error('Firebase Admin is not configured or JSON is malformed');
  return getAuth();
}
const primaryKeys={profiles:'github_id',credit_orders:'reference',credit_ledger:'id',repair_tasks:'id'};
function docId(table,row){
  const k=primaryKeys[table]||'id';
  if(row[k]!==undefined&&row[k]!==null) return String(row[k]);
  return crypto.randomUUID();
}
function clean(value){const out={...value};delete out._id;delete out._table;return out;}
class Query {
  constructor(table){this.table=table;this.filters=[];this.sort=null;this.max=null;this.projection=null;this.action='select';this.payload=null;this.conflict=null;this.single=false;}
  select(fields='*'){this.projection=fields==='*'?null:String(fields).split(',').map(x=>x.trim());return this;}
  eq(k,v){this.filters.push([k,'==',v]);return this;}
  gt(k,v){this.filters.push([k,'>',v]);return this;}
  order(k,{ascending=true}={}){this.sort=[k,ascending?'asc':'desc'];return this;}
  limit(n){this.max=n;return this;}
  maybeSingle(){this.single=true;return this;}
  insert(value){this.action='insert';this.payload=value;return this;}
  upsert(value,{onConflict}={}){this.action='upsert';this.payload=value;this.conflict=onConflict;return this;}
  update(value){this.action='update';this.payload=value;return this;}
  delete(){this.action='delete';return this;}
  async execute(){
    ensureFirebaseInitialized();
    if(!firestoreInstance) return {data:null,error:new Error('Firebase Admin/Firestore is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or configure Application Default Credentials.')};
    try {
      const col=firestoreInstance.collection(this.table);
      if(this.action==='insert'||this.action==='upsert'){
        const rows=Array.isArray(this.payload)?this.payload:[this.payload]; const results=[];
        for(const row0 of rows){const row={...row0};const id=docId(this.table,row);const ref=col.doc(id);if(this.action==='insert'&&(await ref.get()).exists)return {data:null,error:Object.assign(new Error('Duplicate record.'),{code:'already-exists'})};
          if(this.action==='upsert') await ref.set(row,{merge:true}); else await ref.create(row);results.push({...row});}
        return {data:Array.isArray(this.payload)?results:results[0],error:null};
      }
      let q=col; for(const [k,op,v] of this.filters) q=q.where(k,op,v);
      if(this.sort) q=q.orderBy(this.sort[0],this.sort[1]); if(this.max!==null) q=q.limit(this.max);
      const snap=await q.get(); const docs=snap.docs;
      if(this.action==='select'){
        const rows=docs.map(d=>({...d.data(),_id:d.id})).map(row=>{delete row._id;return row;}).map(row=>this.projection?Object.fromEntries(this.projection.filter(k=>k in row).map(k=>[k,row[k]])):row);
        return {data:this.single?(rows[0]||null):rows,error:null};
      }
      if(this.action==='update'){
        const batch=firestoreInstance.batch(); for(const d of docs) batch.set(d.ref,this.payload,{merge:true}); await batch.commit(); return {data:docs.map(d=>({...d.data(),...this.payload})),error:null};
      }
      if(this.action==='delete'){
        const batch=firestoreInstance.batch();for(const d of docs)batch.delete(d.ref);await batch.commit();return {data:docs.map(d=>d.data()),error:null};
      }
      return {data:null,error:new Error('Unsupported database operation.')};
    } catch(error){return {data:null,error};}
  }
  then(resolve,reject){return this.execute().then(resolve,reject);}
}
class FirebaseDatabase {
  from(table){return new Query(table);}
  async rpc(name,args={}){
    ensureFirebaseInitialized();
    if(!firestoreInstance)return {data:null,error:new Error('Firebase Firestore is not configured.')};
    try{
      const db=firestoreInstance;
      if(name==='initialize_profile'){
        const id=String(args.p_github_id),ref=db.collection('profiles').doc(id);
        const result=await db.runTransaction(async tx=>{
          const existing=await tx.get(ref);
          if(existing.exists){const old=existing.data();const update={github_login:args.p_github_login,display_name:args.p_display_name,email:args.p_email||null,avatar_url:args.p_avatar_url||null,updated_at:new Date().toISOString()};tx.set(ref,update,{merge:true});return {ok:true,credits:Number(old.credits||0),starter_credits_remaining:Number(old.starter_credits_remaining||0),duplicate_device:false};}
          const signals=args.p_device_hash&&typeof args.p_device_hash==='object'?args.p_device_hash:{};const deviceHash=String(signals.deviceHash||''),ipHash=String(signals.ipHash||''),day=String(signals.day||new Date().toISOString().slice(0,10).replace(/-/g,''));const deviceRef=deviceHash?db.collection('starter_device_claims').doc(deviceHash):null,ipRef=ipHash?db.collection('starter_ip_claims').doc(`${ipHash}_${day}`):null;const [deviceClaim,ipClaim]=await Promise.all([deviceRef?tx.get(deviceRef):Promise.resolve(null),ipRef?tx.get(ipRef):Promise.resolve(null)]);const ipCount=Number(ipClaim?.data()?.count||0),eligible=starterGrantEligibility({deviceClaimExists:!!deviceClaim?.exists,ipClaimsToday:ipCount}),credits=eligible?5:0;
          tx.create(ref,{github_id:id,github_login:args.p_github_login,display_name:args.p_display_name,email:args.p_email||null,avatar_url:args.p_avatar_url||null,credits,starter_credits_remaining:credits,created_at:new Date().toISOString(),updated_at:new Date().toISOString()});
          if(deviceRef&&!deviceClaim?.exists)tx.create(deviceRef,{github_id:id,createdAt:new Date(),policy:eligible?'starter-grant-device-claim':'device-claim-rate-limited'});if(ipRef&&eligible)tx.set(ipRef,{count:ipCount+1,updatedAt:new Date(),expiresAt:new Date(Date.now()+24*60*60*1000)},{merge:true});
          return {ok:true,credits,starter_credits_remaining:credits,duplicate_device:!eligible};
        });return {data:result,error:null};
      }
      if(name==='spend_credits'){
        const id=String(args.p_github_id),amount=Number(args.p_amount);if(!Number.isSafeInteger(amount)||amount<=0)return {data:{ok:false,message:'Invalid credit amount.'},error:null};
        const result=await db.runTransaction(async tx=>{const ref=db.collection('profiles').doc(id),snap=await tx.get(ref);if(!snap.exists)return {ok:false,message:'Profile is not initialized.'};const p=snap.data(),balance=Number(p.credits||0);if(balance<amount)return {ok:false,message:'Not enough credits.'};const next=balance-amount,now=new Date().toISOString(),starter=Math.max(0,Number(p.starter_credits_remaining||0)-Math.min(Number(p.starter_credits_remaining||0),amount));tx.update(ref,{credits:next,starter_credits_remaining:starter,updated_at:now});const led=db.collection('credit_ledger').doc();tx.create(led,{github_id:id,delta:-amount,balance_before:balance,balance_after:next,reason:String(args.p_reason||'AI operation'),operation_id:String(args.p_metadata?.operationId||''),metadata:args.p_metadata||{},created_at:now});return {ok:true,credits:next};});return {data:result,error:null};
      }
      if(name==='spend_credits_once'){
        const id=String(args.p_github_id),amount=Number(args.p_amount),reference=String(args.p_reference||'');
        if(!Number.isSafeInteger(amount)||amount<=0||reference.length<5||reference.length>180)return {data:{ok:false,message:'Invalid credit charge reference.'},error:null};
        const chargeId=grantDocumentId(id,`spend:${reference}`);
        const result=await db.runTransaction(async tx=>{const profile=db.collection('profiles').doc(id),charge=db.collection('credit_spends').doc(chargeId);const [pref,chargeSnap]=await Promise.all([tx.get(profile),tx.get(charge)]);if(!pref.exists)return {ok:false,message:'Profile is not initialized.'};if(chargeSnap.exists)return {ok:true,duplicate:true,credits:Number(pref.data().credits||0)};const p=pref.data(),balance=Number(p.credits||0);if(balance<amount)return {ok:false,message:'Not enough credits.'};const next=balance-amount,now=new Date().toISOString();tx.update(profile,{credits:next,starter_credits_remaining:Math.max(0,Number(p.starter_credits_remaining||0)-Math.min(Number(p.starter_credits_remaining||0),amount)),updated_at:now});tx.create(charge,{github_id:id,reference,amount,reason:String(args.p_reason||'AI operation'),created_at:now});tx.create(db.collection('credit_ledger').doc(chargeId),{github_id:id,delta:-amount,balance_before:balance,balance_after:next,reason:String(args.p_reason||'AI operation'),reference,operation_id:String(args.p_metadata?.operationId||reference),charge_id:chargeId,metadata:args.p_metadata||{},created_at:now});return {ok:true,duplicate:false,credits:next};});return {data:result,error:null};
      }
      if(name==='reserve_credits'){
        const id=String(args.p_github_id),amount=Number(args.p_amount),reference=String(args.p_reference||'');
        if(!Number.isSafeInteger(amount)||amount<=0||reference.length<5||reference.length>180)return {data:{ok:false,message:'Invalid reservation.'},error:null};
        const reservationId=grantDocumentId(id,`reservation:${reference}`);
        const result=await db.runTransaction(async tx=>{
          const profile=db.collection('profiles').doc(id),reservation=db.collection('credit_reservations').doc(reservationId);
          const [pref,rs]=await Promise.all([tx.get(profile),tx.get(reservation)]);
          if(!pref.exists)return {ok:false,message:'Profile is not initialized.'};
          if(rs.exists){const row=rs.data();if(row.github_id!==id||Number(row.amount)!==amount||String(row.metadata?.payloadHash||'')!==String(args.p_metadata?.payloadHash||''))return {ok:false,message:'This operation ID was already used with a different request payload.'};if(row.state==='reserved'||row.state==='committed')return {ok:true,duplicate:true,state:row.state,credits:Number(pref.data().credits||0),reservationId,result:row.result||null};if(row.state==='released'){const p=pref.data(),before=Number(p.credits||0);if(before<amount)return {ok:false,message:'Not enough credits.'};const starterUsed=Math.min(Number(p.starter_credits_remaining||0),amount),after=before-amount,now=new Date().toISOString(),attempt=Number(row.attempt||1)+1;tx.update(profile,{credits:after,starter_credits_remaining:Math.max(0,Number(p.starter_credits_remaining||0)-starterUsed),updated_at:now});tx.update(reservation,{state:'reserved',starterUsed,attempt,created_at:now,updated_at:now,expiresAt:new Date(Date.now()+15*60*1000)});tx.create(db.collection('credit_ledger').doc(`${reservationId}_reserve_${attempt}`),{github_id:id,delta:-amount,balance_before:before,balance_after:after,reason:`Reserved retry: ${String(row.reason||'AI operation')}`,reference,operation_id:reference,reservation_id:reservationId,state:'reserved',metadata:args.p_metadata||{},created_at:now});return {ok:true,duplicate:false,state:'reserved',credits:after,reservationId};}return {ok:false,message:'This operation cannot be retried.'};}
          const p=pref.data(),before=Number(p.credits||0);if(before<amount)return {ok:false,message:'Not enough credits.'};
          const starterUsed=Math.min(Number(p.starter_credits_remaining||0),amount),after=before-amount,now=new Date().toISOString();
          tx.update(profile,{credits:after,starter_credits_remaining:Math.max(0,Number(p.starter_credits_remaining||0)-starterUsed),updated_at:now});
          tx.create(reservation,{github_id:id,reference,amount,starterUsed,state:'reserved',reason:String(args.p_reason||'AI operation'),metadata:args.p_metadata||{},created_at:now,updated_at:now,attempt:1,expiresAt:new Date(Date.now()+15*60*1000)});
          tx.create(db.collection('credit_ledger').doc(`${reservationId}_reserve_1`),{github_id:id,delta:-amount,balance_before:before,balance_after:after,reason:`Reserved: ${String(args.p_reason||'AI operation')}`,reference,operation_id:reference,reservation_id:reservationId,state:'reserved',metadata:args.p_metadata||{},created_at:now});
          return {ok:true,duplicate:false,state:'reserved',credits:after,reservationId};
        });return {data:result,error:null};
      }
      if(name==='commit_credit_reservation'){
        const id=String(args.p_github_id),reference=String(args.p_reference||''),reservationId=grantDocumentId(id,`reservation:${reference}`);
        const result=await db.runTransaction(async tx=>{const ref=db.collection('credit_reservations').doc(reservationId),snap=await tx.get(ref);if(!snap.exists)return {ok:false,message:'Credit reservation not found.'};const row=snap.data();if(row.github_id!==id)return {ok:false,message:'Credit reservation owner mismatch.'};if(row.state==='committed')return {ok:true,duplicate:true,state:'committed'};if(row.state!=='reserved')return {ok:false,message:'Credit reservation is no longer active.'};tx.update(ref,{state:'committed',result:args.p_result??null,updated_at:new Date().toISOString()});return {ok:true,duplicate:false,state:'committed'};});return {data:result,error:null};
      }
      if(name==='release_credit_reservation'){
        const id=String(args.p_github_id),reference=String(args.p_reference||''),reservationId=grantDocumentId(id,`reservation:${reference}`);
        const result=await db.runTransaction(async tx=>{const ref=db.collection('credit_reservations').doc(reservationId),profile=db.collection('profiles').doc(id);const [rs,ps]=await Promise.all([tx.get(ref),tx.get(profile)]);if(!rs.exists)return {ok:true,duplicate:true,state:'missing'};const row=rs.data();if(row.github_id!==id)return {ok:false,message:'Credit reservation owner mismatch.'};if(row.state==='released')return {ok:true,duplicate:true,state:'released',credits:Number(ps.data()?.credits||0)};if(row.state==='committed')return {ok:false,message:'A committed operation cannot be released automatically.'};if(!ps.exists)return {ok:false,message:'Profile is not initialized.'};const before=Number(ps.data().credits||0),amount=Number(row.amount||0),after=before+amount,now=new Date().toISOString();tx.update(profile,{credits:after,starter_credits_remaining:Math.max(0,Number(ps.data().starter_credits_remaining||0)+Number(row.starterUsed||0)),updated_at:now});tx.update(ref,{state:'released',released_at:now,updated_at:now});tx.create(db.collection('credit_ledger').doc(`${reservationId}_release_${Number(row.attempt||1)}`),{github_id:id,delta:amount,balance_before:before,balance_after:after,reason:`Released: ${String(row.reason||'Failed operation')}`,reference,operation_id:reference,reservation_id:reservationId,state:'released',metadata:row.metadata||{},created_at:now});return {ok:true,duplicate:false,state:'released',credits:after};});return {data:result,error:null};
      }
      if(name==='grant_credits'){
        const id=String(args.p_github_id),amount=Number(args.p_amount),reference=String(args.p_reference||'');
        if(!Number.isSafeInteger(amount)||amount<=0||reference.length<5||reference.length>180)return {data:null,error:new Error('Invalid credit grant.')};
        // Deterministic grant marker prevents duplicate webhook/verify requests from
        // granting twice, without depending on a composite Firestore query/index.
        const grantId=grantDocumentId(id,reference);
        const result=await db.runTransaction(async tx=>{
          const profile=db.collection('profiles').doc(id),grant=db.collection('credit_grants').doc(grantId);
          const [pref,grantSnap]=await Promise.all([tx.get(profile),tx.get(grant)]);
          if(!pref.exists)throw new Error('Profile not found.');
          if(grantSnap.exists)return {ok:true,duplicate:true,credits:Number(pref.data().credits||0)};
          const next=Number(pref.data().credits||0)+amount,now=new Date().toISOString();
          tx.update(profile,{credits:next,updated_at:now});
          tx.create(grant,{github_id:id,reference,amount,reason:String(args.p_reason||'Credit pack purchase'),created_at:now});
          tx.create(db.collection('credit_ledger').doc(grantId),{github_id:id,delta:amount,balance_before:Number(pref.data().credits||0),balance_after:next,reason:String(args.p_reason||'Credit pack purchase'),reference,grant_id:grantId,metadata:{},created_at:now});
          return {ok:true,duplicate:false,credits:next};
        });return {data:result,error:null};
      }
      return {data:null,error:new Error(`Unsupported database operation: ${name}`)};
    }catch(error){return {data:null,error};}
  }
}
export const db=new FirebaseDatabase();
export const flwBase=process.env.FLW_MODE==='production'?'https://f4bexperience.flutterwave.com':'https://developersandbox-api.flutterwave.com';
export function origin(req){
  const configured=String(process.env.APP_URL||'').trim();
  if(configured){let u;try{u=new URL(configured)}catch{throw Error('APP_URL must be a valid absolute URL.')}if(process.env.NODE_ENV==='production'&&u.protocol!=='https:')throw Error('APP_URL must use HTTPS in production.');return u.origin}
  const host=String(req?.headers?.['x-forwarded-host']||req?.headers?.host||'').split(',')[0].trim();
  if(host && /^[A-Za-z0-9.:[\]-]+$/.test(host)) return `${process.env.NODE_ENV==='production'?'https':'http'}://${host}`;
  return process.env.NODE_ENV==='production'?'https://localhost':'http://localhost:3000';
}
export function randomRef(p='fp'){return `${p}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`}
const secure=()=>process.env.NODE_ENV==='production'?'; Secure':'';
function appendSetCookie(res,value){const current=res.getHeader('Set-Cookie');const rows=current==null?[]:Array.isArray(current)?current:[String(current)];res.setHeader('Set-Cookie',[...rows,value]);}
export async function setSession(res,data){if(!process.env.SESSION_SECRET||process.env.SESSION_SECRET.length<32)throw Error('SESSION_SECRET must be at least 32 characters.');const value=await sealData({...data,kind:'session'},{password:process.env.SESSION_SECRET,ttl:SESSION_TTL_MS});appendSetCookie(res,`kithub_session=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure()}`)}
// Device abuse signals are derived only from server-observed request metadata.
// The raw IP and user-agent are never persisted; only an HMAC fingerprint is stored.
export function getOrCreateDeviceId(req,res){const cookies=String(req?.headers?.cookie||'').split(';').map(x=>x.trim()),found=cookies.find(x=>x.startsWith('pothub_device_id='));let id=found?decodeURIComponent(found.slice('pothub_device_id='.length)):'';if(!/^[A-Za-z0-9_-]{32,80}$/.test(id)){id=crypto.randomBytes(32).toString('base64url');if(res)appendSetCookie(res,`pothub_device_id=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure()}`)}return id}
export function serverDeviceFingerprints(req,serverIssuedId=''){
  const pepper=String(process.env.DEVICE_FINGERPRINT_SECRET||process.env.SESSION_SECRET||'');
  if(pepper.length<32)throw new Error('DEVICE_FINGERPRINT_SECRET or SESSION_SECRET (32+ chars) is required for starter-credit abuse prevention.');
  const ip=String(req?.ip||req?.socket?.remoteAddress||'').replace(/^::ffff:/,'').slice(0,80),ua=String(req?.headers?.['user-agent']||'').slice(0,300);
  if(!ip||!ua)throw new Error('Unable to establish server-side device signals.');
  const deviceId=String(serverIssuedId||getOrCreateDeviceId(req,null));
  const deviceHash=crypto.createHmac('sha256',pepper).update(`device\n${deviceId}\n${ua}`).digest('hex');
  const ipHash=crypto.createHmac('sha256',pepper).update(`ipua\n${ip}\n${ua}`).digest('hex');
  return {deviceHash,ipHash,day:new Date().toISOString().slice(0,10).replace(/-/g,'')};
}
// Browser sessions use an opaque random ID. Provider tokens remain server-side in Firestore.
export async function exchangeFirebaseSessionOnce(idToken,data,store=firestore){if(store===firestore)ensureFirebaseInitialized();if(!store)throw new Error('Firebase session storage requires Firestore.');const tokenHash=crypto.createHash('sha256').update(String(idToken)).digest('hex'),exchangeRef=store.collection('firebase_session_exchanges').doc(tokenHash);return store.runTransaction(async tx=>{const snap=await tx.get(exchangeRef);if(snap.exists&&snap.data().sessionId){const existingSid=String(snap.data().sessionId),sessionHash=crypto.createHash('sha256').update(existingSid).digest('hex'),sessionRef=store.collection('browser_sessions').doc(sessionHash),sessionSnap=await tx.get(sessionRef),expires=sessionSnap?.data()?.expiresAt,expiry=typeof expires?.toMillis==='function'?expires.toMillis():Number(expires||0);if(sessionSnap.exists&&expiry>Date.now())return existingSid;}const sid=crypto.randomBytes(32).toString('base64url'),sessionHash=crypto.createHash('sha256').update(sid).digest('hex'),expiresAt=new Date(Date.now()+SESSION_TTL_MS);tx.set(store.collection('browser_sessions').doc(sessionHash),{session:{...data,kind:'session'},createdAt:Date.now(),expiresAt});tx.set(exchangeRef,{sessionId:sid,createdAt:new Date(),expiresAt:new Date(Date.now()+60*60*1000)});return sid;});}
export async function createBrowserSession(data){ensureFirebaseInitialized();if(!firestore)throw new Error('Browser session storage requires Firestore.');const sid=crypto.randomBytes(32).toString('base64url'),hash=crypto.createHash('sha256').update(sid).digest('hex'),expiresAt=new Date(Date.now()+SESSION_TTL_MS);await firestore.collection('browser_sessions').doc(hash).create({session:{...data,kind:'session'},createdAt:Date.now(),expiresAt});return sid}
export async function setBrowserSession(res,data){ensureFirebaseInitialized();if(!firestore)throw Error('Browser session storage requires Firestore.');const sid=crypto.randomBytes(32).toString('base64url'),hash=crypto.createHash('sha256').update(sid).digest('hex'),expiresAt=new Date(Date.now()+SESSION_TTL_MS);await firestore.collection('browser_sessions').doc(hash).create({session:{...data,kind:'session'},createdAt:Date.now(),expiresAt});appendSetCookie(res,`pothub_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure()}`);return sid}
export async function updateBrowserSession(req,data){ensureFirebaseInitialized();if(!firestore)throw Error('Browser session storage requires Firestore.');const cookie=String(req?.headers?.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('pothub_sid='));const bearer=String(req?.headers?.authorization||'').replace(/^Bearer\s+/i,'');const sid=cookie?decodeURIComponent(cookie.slice('pothub_sid='.length)):bearer;if(!/^[A-Za-z0-9_-]{40,80}$/.test(sid))throw Object.assign(new Error('Browser session is missing; sign in again.'),{status:401});const hash=crypto.createHash('sha256').update(sid).digest('hex'),ref=firestore.collection('browser_sessions').doc(hash),snap=await ref.get();if(!snap.exists)throw Object.assign(new Error('Browser session expired; sign in again.'),{status:401});const expiry=new Date(Date.now()+SESSION_TTL_MS);await ref.update({session:{...data,kind:'session'},updatedAt:Date.now(),expiresAt:expiry});return sid}
async function browserSessionById(sid){ensureFirebaseInitialized();if(!firestore||!/^[A-Za-z0-9_-]{40,80}$/.test(String(sid||'')))return null;const hash=crypto.createHash('sha256').update(sid).digest('hex'),snap=await firestore.collection('browser_sessions').doc(hash).get();if(!snap.exists)return null;const row=snap.data(),expires=typeof row.expiresAt?.toMillis==='function'?row.expiresAt.toMillis():Number(row.expiresAt||0);if(!expires||expires<Date.now()){await snap.ref.delete().catch(()=>{});return null}if(!row.session||row.session.kind!=='session')return null;const session={...row.session};if(session.githubTokenEncrypted){try{const {decryptWorkspaceSecret}=await import('./workspace-vault.js');session.githubToken=decryptWorkspaceSecret(session.githubTokenEncrypted)}catch{return null}}return session}
export async function googleSessionFromIdToken(token,deviceHash=''){
  if(!firestoreInstance||!token||token.length>12000)return null;
  let decoded;
  try{decoded=await getAdminAuth().verifyIdToken(token,true)}catch{return null}
  if(!decoded?.uid||String(decoded.firebase?.sign_in_provider||'')!=='google.com')return null;
  const id=`google_${decoded.uid}`,name=String(decoded.name||decoded.email?.split('@')[0]||'Creator').slice(0,160),email=decoded.email||null,avatar=decoded.picture||null,now=new Date().toISOString();
  const profileRef=firestoreInstance.collection('profiles').doc(id),grantId=grantDocumentId(id,`google-starter:${decoded.uid}`),grantRef=firestoreInstance.collection('credit_grants').doc(grantId),ledgerRef=firestoreInstance.collection('credit_ledger').doc(grantId);
  await firestoreInstance.runTransaction(async tx=>{
    const signals=deviceHash&&typeof deviceHash==='object'?deviceHash:{},deviceId=String(signals.deviceHash||''),ipHash=String(signals.ipHash||''),day=String(signals.day||new Date().toISOString().slice(0,10).replace(/-/g,''));const deviceRef=deviceId?firestoreInstance.collection('starter_device_claims').doc(deviceId):null,ipRef=ipHash?firestoreInstance.collection('starter_ip_claims').doc(`${ipHash}_${day}`):null;
    const [profileSnap,grantSnap,deviceSnap,ipSnap]=await Promise.all([tx.get(profileRef),tx.get(grantRef),deviceRef?tx.get(deviceRef):Promise.resolve(null),ipRef?tx.get(ipRef):Promise.resolve(null)]);
    if(!profileSnap.exists){const ipCount=Number(ipSnap?.data()?.count||0),eligible=starterGrantEligibility({deviceClaimExists:!!deviceSnap?.exists,ipClaimsToday:ipCount}),credits=eligible?5:0;tx.create(profileRef,{github_id:id,github_login:`google:${decoded.uid}`,display_name:name,email,avatar_url:avatar,credits,starter_credits_remaining:credits,created_at:now,updated_at:now});if(deviceRef&&!deviceSnap?.exists)tx.create(deviceRef,{github_id:id,createdAt:new Date(),policy:eligible?'starter-grant-device-claim':'device-claim-rate-limited'});if(ipRef&&eligible)tx.set(ipRef,{count:ipCount+1,updatedAt:new Date(),expiresAt:new Date(Date.now()+24*60*60*1000)},{merge:true});if(eligible){tx.create(grantRef,{github_id:id,reference:`google-starter:${decoded.uid}`,amount:5,reason:'Google creator starter credits',created_at:now});tx.create(ledgerRef,{github_id:id,delta:5,balance_after:5,reason:'Google creator starter credits',reference:`google-starter:${decoded.uid}`,grant_id:grantId,metadata:{provider:'google'},created_at:now});}return;}
    const patch={display_name:name,email,avatar_url:avatar,updated_at:now};tx.set(profileRef,patch,{merge:true});
  });
  return {kind:'session',user:{id,provider:'google',name,email,avatar_url:avatar},authProvider:'google',firebaseUid:decoded.uid,createdAt:Date.now()};
}
async function hydrateLinkedAccounts(session){if(!session?.user?.id)return session;try{const store=firestoreInstance;if(!store)return session;const owner=crypto.createHash('sha256').update(String(session.user.id)).digest('hex'),ref=store.collection('github_connections').doc(owner),snap=await ref.get();if(snap.exists){const row=snap.data()||{};if(row.tokenEncrypted){const {decryptWorkspaceSecret}=await import('./workspace-vault.js');session.githubToken=decryptWorkspaceSecret(row.tokenEncrypted);session.githubTokenEncrypted=row.tokenEncrypted;session.githubScopes=Array.isArray(row.scopes)?row.scopes:[];session.workflowScopeRequested=!!row.workflowScopeRequested;session.workflowScopeGranted=!!row.workflowScopeGranted;session.user={...session.user,login:row.login||session.user.login,githubLogin:row.login||'',githubId:row.githubId||''};session.linkedAccounts={...(session.linkedAccounts||{}),github:{connected:true,login:row.login||'',id:String(row.githubId||'')}}}}}catch(e){session.linkedLookupFailed=true;console.warn('[Pothub linked account hydration] GitHub link could not be loaded:',String(e?.message||e).slice(0,120))}return session}
export async function getSession(req){try{const auth=String(req.headers.authorization||'');if(auth.startsWith('Bearer ')){const bearer=auth.slice(7);if(process.env.SESSION_SECRET){try{const d=await unsealData(bearer,{password:process.env.SESSION_SECRET,ttl:SESSION_TTL_MS});if(d.kind==='session')return await hydrateLinkedAccounts(d)}catch{}}const s=await browserSessionById(bearer);if(s)return await hydrateLinkedAccounts(s)}const cookies=String(req.headers.cookie||'').split(';').map(x=>x.trim()),sidCookie=cookies.find(x=>x.startsWith('pothub_sid='));if(sidCookie){const s=await browserSessionById(decodeURIComponent(sidCookie.slice('pothub_sid='.length)));if(s)return await hydrateLinkedAccounts(s)}const c=cookies.find(x=>x.startsWith('kithub_session='));if(!c||!process.env.SESSION_SECRET)return null;const d=await unsealData(decodeURIComponent(c.slice('kithub_session='.length)),{password:process.env.SESSION_SECRET,ttl:SESSION_TTL_MS});return d.kind==='session'?await hydrateLinkedAccounts(d):null}catch{return null}}
export function clearSession(res){appendSetCookie(res,`kithub_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure()}`);appendSetCookie(res,`pothub_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure()}`)}
export function redactSecrets(t='',max=25000){const s=String(t);return (Number.isFinite(max)?s.slice(0,max):s).replace(/gh[pousr]_[A-Za-z0-9_]{20,}/g,'[REDACTED_GITHUB_TOKEN]').replace(/AIza[0-9A-Za-z_-]{30,}/g,'[REDACTED_GOOGLE_KEY]').replace(/FLWSECK[^\s"']+/g,'[REDACTED_FLUTTERWAVE_KEY]').replace(/(Bearer\s+)[A-Za-z0-9._-]{20,}/gi,'$1[REDACTED]').replace(/((?:password|secret|token|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi,'$1[REDACTED]')}
export async function requireUser(req,res){const s=await getSession(req);if(!s?.user?.id||(!s?.githubToken&&!['google','vercel'].includes(s?.authProvider))){res.status(401).json({error:'Sign in to Pothub to continue.'});return null}return s}
// Free-forever accounts (server/free-forever-policy.js). Fails closed: any lookup error means "charge normally".
const freeForeverCache=new Map();
export async function freeForeverState(id){
  const userId=String(id||'');if(!userId||!ensureDatabase())return null;
  const hit=freeForeverCache.get(userId);if(hit&&Date.now()-hit.at<60000)return hit.value;
  let value=null;
  try{const {data:profile,error}=await db.from('profiles').select('credits,github_login,email').eq('github_id',userId).maybeSingle();
    if(!error&&profile){const reason=freeForeverMatch(profile,userId,null);if(reason)value={credits:Number(profile.credits||0),reason}}
  }catch{value=null}
  if(!value){
    // The GitHub account connected to this account counts too (OAuth-verified login/id, never email).
    try{const owner=crypto.createHash('sha256').update(userId).digest('hex'),snap=await firestore.collection('github_connections').doc(owner).get();
      if(snap.exists){const row=snap.data()||{},reason=freeForeverMatch(null,userId,{githubId:row.githubId,login:row.login});if(reason)value={credits:0,reason}}
    }catch{value=null}
  }
  if(freeForeverCache.size>500)freeForeverCache.clear();
  freeForeverCache.set(userId,{at:Date.now(),value});return value;
}
// Credits are retired. Every metered AI operation now goes through this guard:
//  - plain chat is never limited; free-forever and Premium accounts are unlimited;
//  - everyone else gets FREE_DAILY_ACTIONS agent actions per UTC day (429 daily_limit_reached beyond that).
export async function agentQuotaGuard(id,reference,reason){
  if(!isAgentAction(reason))return{unlimited:true,credits:0};
  if(await freeForeverState(id))return{unlimited:true,credits:0};
  const sub=subscriptionState(await readSubscription(firestore,id));
  if(sub.premium)return{unlimited:true,credits:0};
  const usage=await consumeAgentAction(firestore,{userId:String(id),reference:String(reference||crypto.randomUUID())});
  return{unlimited:false,credits:usage.remaining,usage};
}
export async function getBillingStatus(id){
  if(!ensureDatabase())throw Error('Billing storage is unavailable. Firebase Firestore is not configured.');
  const free=await freeForeverState(id),sub=subscriptionState(await readSubscription(firestore,id));
  const usage=await readUsage(firestore,{userId:String(id)});
  return{freeForever:!!free,freeForeverReason:free?.reason||null,freeForeverConfigured:freeForeverConfigured(),subscription:sub,unlimited:!!free||sub.premium,usage,dailyLimit:FREE_DAILY_ACTIONS};
}
export async function activatePlanPayment(id,plan,reference,paidAt=Date.now()){
  if(!ensureDatabase())throw Error('Billing storage is unavailable. Firebase Firestore is not configured.');
  return activatePlan(firestore,{userId:String(id),plan,reference:String(reference),paidAt});
}
export async function getCredits(id){
  if(!ensureDatabase())throw Error('Credit accounting is unavailable. Configure Firebase Admin and Firestore.');
  const userId=String(id||'');if(!userId)throw Error('A signed-in account is required to check credits.');
  const {data:profile,error:profileError}=await db.from('profiles').select('credits,starter_credits_remaining').eq('github_id',userId).maybeSingle();
  if(profileError)throw profileError;if(!profile)throw Error('Your Pothub profile is not initialized. Sign out and reconnect.');
  // Per-account rolling 24-hour window. The pending reference makes a grant
  // recoverable if the process stops between claiming the window and the SQL grant.
  const windowRef=firestore.collection('daily_free_credit_windows').doc(crypto.createHash('sha256').update(userId).digest('hex'));
  const now=Date.now();
  // Migrate the last UTC-day grant into the rolling window so deployment does not
  // accidentally award a second five-credit grant to an account within 24 hours.
  let legacyLastGrantedAt=0;
  try{for(const offset of [0,1]){const day=new Date(now-offset*DAILY_FREE_INTERVAL_MS).toISOString().slice(0,10),legacyRef=`daily-free-10:${day}`,legacySnap=await firestore.collection('credit_grants').doc(grantDocumentId(userId,legacyRef)).get();if(legacySnap.exists){const parsed=Date.parse(String(legacySnap.data()?.created_at||''));if(Number.isFinite(parsed))legacyLastGrantedAt=Math.max(legacyLastGrantedAt,parsed);}}}catch{}
  const claim=await firestore.runTransaction(async tx=>{
    const snap=await tx.get(windowRef),row=snap.exists?snap.data():{};
    if(row.pendingReference)return {reference:String(row.pendingReference),pending:true};
    const last=Number(row.lastGrantedAt||legacyLastGrantedAt||0);
    if(last&&now-last<DAILY_FREE_INTERVAL_MS)return {reference:'',nextGrantAt:last+DAILY_FREE_INTERVAL_MS};
    const reference=`daily-free-rolling:${crypto.createHash('sha256').update(userId).digest('hex').slice(0,24)}:${now}`;
    tx.set(windowRef,{userId,lastGrantedAt:last,pendingReference:reference,pendingAt:now,nextGrantAt:now+24*60*60*1000,updatedAt:now},{merge:true});
    return {reference,pending:true};
  });
  if(claim.reference){
    await grantCreditsOnce(db,userId,DAILY_FREE_CREDITS,claim.reference,'Daily free Express credits');
    await firestore.runTransaction(async tx=>{const snap=await tx.get(windowRef);if(snap.exists&&snap.data().pendingReference===claim.reference)tx.set(windowRef,{lastGrantedAt:now,pendingReference:null,pendingAt:null,nextGrantAt:now+DAILY_FREE_INTERVAL_MS,updatedAt:Date.now()},{merge:true});});
  }
  const {data,error}=await db.from('profiles').select('credits,starter_credits_remaining').eq('github_id',userId).maybeSingle();
  if(error)throw error;if(!data)throw Error('Your Pothub profile is not initialized. Sign out and reconnect.');
  return{credits:Number(data.credits||0),starter_credits_remaining:Number(data.starter_credits_remaining||0),daily_free_credits:DAILY_FREE_CREDITS,daily_free_next_at:claim.nextGrantAt?new Date(claim.nextGrantAt).toISOString():new Date(now+24*60*60*1000).toISOString(),daily_free_policy:'rolling-24-hours',demo:false}
}

// Serialize AI credit-meter updates per account so concurrent requests cannot
// claim the same batch-start charge. One credit is reserved at the first workflow
// successful AI action; failed workflows release reservations and do not advance the count.
export async function beginAiWorkflowBilling(userId,operationId,store=firestore){
  if(!store)throw new Error('AI workflow billing storage is unavailable.');
  const key=crypto.createHash('sha256').update(String(userId)).digest('hex'),ref=store.collection('ai_workflow_meters').doc(key),now=Date.now();
  return store.runTransaction(async tx=>{const snap=await tx.get(ref),row=snap.exists?snap.data():{},lockUntil=Number(row.lockUntil||0),owner=String(row.lockOperationId||'');
    if(owner&&lockUntil>now&&owner!==String(operationId))throw Object.assign(new Error('Another AI workflow is still running for this account. Wait for it to finish, then retry.'),{status:409,code:'AI_WORKFLOW_IN_PROGRESS'});
    const completed=Math.max(0,Number(row.completedWorkflows)||0);
    tx.set(ref,{userId:String(userId),completedWorkflows:completed,lockOperationId:String(operationId),lockUntil:now+30*60*1000,updatedAt:now},{merge:true});
    return {reference:key,operationId:String(operationId),completedBefore:completed,charge:shouldChargeForAiWorkflow(completed)};
  });
}
export async function completeAiWorkflowBilling(userId,lease,store=firestore){
  if(!lease||!store)return;
  const ref=store.collection('ai_workflow_meters').doc(String(lease.reference));
  await store.runTransaction(async tx=>{const snap=await tx.get(ref);if(!snap.exists||String(snap.data().lockOperationId||'')!==String(lease.operationId))throw new Error('AI workflow billing lock expired. Retry only after checking operation history.');const row=snap.data();tx.set(ref,{completedWorkflows:Math.max(0,Number(row.completedWorkflows)||0)+1,lockOperationId:null,lockUntil:0,lastCompletedAt:Date.now(),updatedAt:Date.now()},{merge:true});});
}
export async function failAiWorkflowBilling(lease,store=firestore){
  if(!lease||!store)return;
  const ref=store.collection('ai_workflow_meters').doc(String(lease.reference));
  await store.runTransaction(async tx=>{const snap=await tx.get(ref);if(snap.exists&&String(snap.data().lockOperationId||'')===String(lease.operationId))tx.set(ref,{lockOperationId:null,lockUntil:0,updatedAt:Date.now()},{merge:true});});
}
export async function spendCredits(id,amount,reason,metadata={}){if(!ensureDatabase())throw Error('Credit accounting is unavailable. Firebase Firestore is not configured.');{const g=await agentQuotaGuard(id,crypto.randomUUID(),reason);return{credits:g.credits,demo:false}}const{data,error}=await db.rpc('spend_credits',{p_github_id:String(id),p_amount:amount,p_reason:reason,p_metadata:metadata});if(error)throw Error(error.message||'Unable to reserve credits.');if(!data?.ok)throw Error(data?.message||'Not enough credits.');return{credits:Number(data.credits),demo:false}}
export async function beginOperation(userId,operationId,payloadHash,{ttlMs=20*60*1000,store=firestore}={}){
  if(store===firestore&&!ensureDatabase())throw new Error('Operation storage is unavailable.');if(!store)throw new Error('Operation storage is unavailable.');
  const id=grantDocumentId(userId,`operation:${operationId}`),ref=store.collection('ai_operations').doc(id);
  return store.runTransaction(async tx=>{const snap=await tx.get(ref),decision=decideOperation(snap.exists?snap.data():null,{userId,operationId,payloadHash,ttlMs});if(decision.action==='return')return {state:'succeeded',result:decision.result,duplicate:true};if(decision.action==='create')tx.create(ref,decision.record);else tx.set(ref,decision.record,{merge:true});return {state:'running',attempt:decision.attempt,duplicate:false};});
}
export async function finishOperation(userId,operationId,payloadHash,result,store=firestore){if(store===firestore&&!ensureDatabase())throw new Error('Operation storage is unavailable.');if(!store)throw new Error('Operation storage is unavailable.');const ref=store.collection('ai_operations').doc(grantDocumentId(userId,`operation:${operationId}`));await store.runTransaction(async tx=>{const snap=await tx.get(ref);if(!snap.exists||snap.data().payloadHash!==String(payloadHash))throw new Error('Operation record changed before completion.');tx.update(ref,{state:'succeeded',result,updatedAt:new Date(),expiresAt:new Date(Date.now()+SESSION_TTL_MS)});});}
export async function failOperation(userId,operationId,payloadHash,error,store=firestore){if(store===firestore&&!ensureDatabase())return;if(!store)return;const ref=store.collection('ai_operations').doc(grantDocumentId(userId,`operation:${operationId}`));await ref.set({userId:String(userId),operationId:String(operationId),payloadHash:String(payloadHash),state:'failed',error:String(error||'Operation failed').slice(0,300),updatedAt:new Date(),expiresAt:new Date(Date.now()+24*60*60*1000)},{merge:true});}
export function selectStaleReservationRows(rows,cutoff){return rows.filter(row=>{const v=row.expiresAt,ms=typeof v?.toMillis==='function'?v.toMillis():v instanceof Date?v.getTime():Number(v||0);return ms>0&&ms<=cutoff})}
export async function reconcileStaleCreditReservations({olderThanMinutes=15,limit=200,dryRun=true}={}){if(!ensureDatabase())throw Error('Credit accounting is unavailable.');const cutoff=Date.now()-Math.max(15,Math.min(10080,Number(olderThanMinutes)||60))*60000;const snap=await firestore.collection('credit_reservations').where('state','==','reserved').limit(Math.max(1,Math.min(500,Number(limit)||200))).get();const rows=selectStaleReservationRows(snap.docs.map(d=>({...d.data(),_doc:d})),cutoff).map(x=>x._doc);const results=[];for(const doc of rows){const row=doc.data();if(dryRun){results.push({id:doc.id,reference:row.reference,state:'would_release'});continue;}const released=await db.rpc('release_credit_reservation',{p_github_id:String(row.github_id),p_reference:String(row.reference)});if(released.error||!released.data?.ok)throw Error(released.error?.message||released.data?.message||`Could not release reservation ${doc.id}`);results.push({id:doc.id,reference:row.reference,state:released.data.state});}return{cutoff:new Date(cutoff).toISOString(),checked:snap.size,stale:rows.length,dryRun,results};}
export async function reserveCredits(id,amount,reference,reason='AI operation',metadata={}){if(!ensureDatabase())throw Error('Credit accounting is unavailable. Firebase Firestore is not configured.');{const g=await agentQuotaGuard(id,reference,reason);return{credits:g.credits,duplicate:false,state:'reserved',reservationId:`quota:${String(reference)}`,result:null,demo:false}}return reserveCreditReservation(db,id,amount,reference,reason,metadata)}
export async function commitCreditReservation(id,reference,result=null){if(!ensureDatabase())throw Error('Credit accounting is unavailable.');return{ok:true,duplicate:true,state:'committed'}}
export async function releaseCreditReservation(id,reference){if(!ensureDatabase())throw Error('Credit accounting is unavailable.');try{await refundAgentAction(firestore,{userId:String(id),reference:String(reference)})}catch(e){console.error('[Pothub] Could not refund an agent action:',String(e?.message||e).slice(0,160))}return{ok:true,duplicate:false,state:'released'}}
export async function spendCreditsOnce(id,amount,reference,reason='AI operation',metadata={}){if(!ensureDatabase())throw Error('Credit accounting is unavailable. Firebase Firestore is not configured.');{const g=await agentQuotaGuard(id,reference,reason);return{credits:g.credits,duplicate:false,demo:false}}const{data,error}=await db.rpc('spend_credits_once',{p_github_id:String(id),p_amount:amount,p_reference:String(reference),p_reason:reason,p_metadata:metadata});if(error)throw Error(error.message||'Unable to charge credits.');if(!data?.ok)throw Error(data?.message||'Not enough credits.');return{credits:Number(data.credits),duplicate:!!data.duplicate,demo:false}}
export async function addCredits(id,amount,reference,reason='Credit pack purchase'){if(!ensureDatabase())throw Error('Configure Firebase Firestore before enabling real credit purchases.');return grantCreditsOnce(db,id,amount,reference,reason)}
export async function storeSignedMedia({buffer,mimeType,userId,kind='image',expiresMs=60*60*1000}){
  ensureFirebaseInitialized();if(!firestoreInstance)throw new Error('Media storage requires Firebase Admin.');
  const app=getApps()[0],bucketName=String(process.env.FIREBASE_STORAGE_BUCKET||app?.options?.storageBucket||'');if(!bucketName)throw new Error('Set FIREBASE_STORAGE_BUCKET to enable signed media delivery.');
  const bucket=getStorage(app).bucket(bucketName);return storeSignedObject(bucket,{buffer,mimeType,userId,kind,expiresMs});
}
export async function signStoredMedia(path,{expiresMs=60*60*1000}={}){ensureFirebaseInitialized();const app=getApps()[0],bucketName=String(process.env.FIREBASE_STORAGE_BUCKET||app?.options?.storageBucket||'');if(!bucketName)throw new Error('Stored media reference is invalid.');return signStoredObject(getStorage(app).bucket(bucketName),path,{expiresMs})}
export async function createUserResumableUpload({userId,uploadId,fileName,mimeType,maxBytes=100*1024*1024}){
  ensureFirebaseInitialized();if(!firestoreInstance)throw new Error('Large uploads require Firebase Admin.');
  const app=getApps()[0],bucketName=String(process.env.FIREBASE_STORAGE_BUCKET||app?.options?.storageBucket||'');if(!bucketName)throw new Error('Set FIREBASE_STORAGE_BUCKET to enable large uploads.');
  const uidHash=crypto.createHash('sha256').update(String(userId)).digest('hex'),safeName=String(fileName||'file').replace(/[^A-Za-z0-9._-]/g,'_').slice(-120)||'file';
  const allowed=/^(?:image\/(?:png|jpeg|webp|gif)|video\/(?:mp4|webm|quicktime)|application\/(?:pdf|zip|vnd\.openxmlformats-officedocument\.(?:wordprocessingml\.document|spreadsheetml\.sheet)|vnd\.ms-excel|vnd\.ms-word)|text\/(?:plain|markdown|csv|html|css|javascript)|application\/octet-stream)$/i;
  if(!allowed.test(String(mimeType||'')))throw Object.assign(new Error('This file type is not supported for large uploads.'),{status:415});
  const path=`user-uploads/${uidHash}/${String(uploadId).replace(/[^A-Za-z0-9_-]/g,'')}/${safeName}`;
  const file=getStorage(app).bucket(bucketName).file(path);const [uri]=await file.createResumableUpload({metadata:{contentType:String(mimeType),metadata:{pothubOwner:uidHash,pothubUploadId:String(uploadId)}},origin:process.env.POTHUB_APP_ORIGIN||process.env.APP_ORIGIN||undefined});
  return {path,uri,ownerHash:uidHash,bucket:bucketName};
}
export async function verifyUserUploadedObject({userId,path,maxBytes=100*1024*1024}){
  ensureFirebaseInitialized();const app=getApps()[0],bucketName=String(process.env.FIREBASE_STORAGE_BUCKET||app?.options?.storageBucket||'');if(!bucketName)throw new Error('Storage is unavailable.');
  const uidHash=crypto.createHash('sha256').update(String(userId)).digest('hex');if(typeof path!=='string'||!path.startsWith(`user-uploads/${uidHash}/`)||path.includes('..'))throw Object.assign(new Error('Upload does not belong to this account.'),{status:403});
  const file=getStorage(app).bucket(bucketName).file(path),[exists]=await file.exists();if(!exists)throw Object.assign(new Error('Upload is not complete yet.'),{status:409});const [meta]=await file.getMetadata();const size=Number(meta.size||0);if(!size||size>maxBytes)throw Object.assign(new Error('Uploaded file is empty or exceeds the permitted size.'),{status:413});if(meta.metadata?.pothubOwner!==uidHash)throw Object.assign(new Error('Upload ownership could not be verified.'),{status:403});return {path,size,mimeType:String(meta.contentType||'application/octet-stream'),name:path.split('/').pop(),generation:String(meta.generation||'')};
}

// Read only bounded, plain-text uploads from the authenticated user's own Storage path.
// Binary media stays in Storage and is never copied wholesale into a serverless function.
export async function readUserUploadedText({userId,path,maxChars=60000,maxBytes=1024*1024}){
  const meta=await verifyUserUploadedObject({userId,path,maxBytes:100*1024*1024});
  const name=String(meta.name||'').toLowerCase(),mime=String(meta.mimeType||'').toLowerCase();
  const textLike=/^(text\/(plain|markdown|csv|html|css|javascript)|application\/json)$/i.test(mime)||/\.(txt|md|csv|json|js|jsx|ts|tsx|html|css|xml|yml|yaml|sh|py|java|go|rs|sql|log)$/i.test(name);
  if(!textLike)return {text:'',metadata:meta,skipped:'binary-or-unsupported'};
  const app=getApps()[0],bucketName=String(process.env.FIREBASE_STORAGE_BUCKET||app?.options?.storageBucket||'');
  const file=getStorage(app).bucket(bucketName).file(path);
  const cap=Math.max(1024,Math.min(Number(maxBytes)||1024*1024,1024*1024));
  const chunks=[];let bytes=0;
  await new Promise((resolve,reject)=>{const stream=file.createReadStream();stream.on('data',chunk=>{const remaining=cap-bytes;if(remaining<=0){stream.destroy();return}const part=chunk.length>remaining?chunk.subarray(0,remaining):chunk;chunks.push(part);bytes+=part.length;if(bytes>=cap)stream.destroy()});stream.on('end',resolve);stream.on('close',resolve);stream.on('error',e=>{if(bytes>=cap)resolve();else reject(e)})});
  const text=Buffer.concat(chunks).toString('utf8').replace(/\u0000/g,'').slice(0,Math.max(1,Math.min(Number(maxChars)||60000,60000)));
  return {text,metadata:meta,truncated:meta.size>bytes};
}
let flwCachedToken='',flwTokenExpiresAt=0,flwTokenPromise=null;
export async function flwToken(){
  const flwId=String(process.env.FLW_CLIENT_ID||'').trim().replace(/^["'`]+|["'`]+$/g,'').trim(),flwSecret=String(process.env.FLW_CLIENT_SECRET||'').trim().replace(/^["'`]+|["'`]+$/g,'').trim();if(!flwId||!flwSecret)throw Error('Flutterwave v4 credentials are not configured.');
  if(flwCachedToken&&flwTokenExpiresAt>Date.now()+30000)return flwCachedToken;
  if(flwTokenPromise)return flwTokenPromise;
  flwTokenPromise=(async()=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);try{const r=await fetch('https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:flwId,client_secret:flwSecret,grant_type:'client_credentials'})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.access_token)throw Error(`Flutterwave v4 authentication failed (${r.status}). Check FLW_CLIENT_ID and FLW_CLIENT_SECRET are the v4 keys for the same mode as FLW_MODE (${process.env.FLW_MODE==='production'?'production':'sandbox'}).`);flwCachedToken=d.access_token;flwTokenExpiresAt=Date.now()+Math.max(60,Number(d.expires_in)||300)*1000;return flwCachedToken;}catch(e){if(e.name==='AbortError')throw Error('Flutterwave authentication timed out. Please retry.');throw e;}finally{clearTimeout(timer);flwTokenPromise=null;}})();return flwTokenPromise;
}
export async function flwFetch(path,token,options={}){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);try{const r=await fetch(`${flwBase}${path}`,{...options,signal:controller.signal,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Trace-Id':randomRef('trace'),'X-Idempotency-Key':randomRef('idem'),...(options.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.message||d.error||`Flutterwave v4 returned ${r.status}`);return d;}catch(e){if(e.name==='AbortError')throw Error('Flutterwave request timed out. Verify the payment status before retrying.');throw e;}finally{clearTimeout(timer)}}

// How long a sign-in lasts before the person must sign in again. People stay signed in until they sign out or this passes.
export const SESSION_TTL_MS = Math.max(1, Number(process.env.SESSION_TTL_DAYS) || 365) * 24 * 60 * 60 * 1000;
