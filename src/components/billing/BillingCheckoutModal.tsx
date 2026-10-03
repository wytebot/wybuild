import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, CreditCard, Loader2, Lock, X } from 'lucide-react';
import { BillingCycle } from '../../types';
import { api } from '../../services/api';
import { FLUTTERWAVE_PRICING } from '../../services/flutterwave';
import { useApp } from '../../context/AppContext';

type Props = { isOpen: boolean; initialCycle: BillingCycle; onClose: () => void };

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function nonce12() {
  const a = new Uint32Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => alphabet[n % alphabet.length]).join('');
}

function toB64(bytes: Uint8Array) {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}

async function encryptAES(value: string, keyB64: string, nonce: string) {
  const raw = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: new TextEncoder().encode(nonce) },
    key,
    new TextEncoder().encode(value)
  );
  return toB64(new Uint8Array(encrypted));
}

function nextActionType(action: any): string {
  return String(
    action?.type ||
    (action?.requires_pin ? 'requires_pin' : '') ||
    (action?.requires_otp ? 'requires_otp' : '') ||
    ''
  ).toLowerCase();
}

export const BillingCheckoutModal: React.FC<Props> = ({ isOpen, initialCycle, onClose }) => {
  const [cycle, setCycle] = useState<BillingCycle>(initialCycle);
  const [step, setStep] = useState<'card' | 'pin' | 'otp' | 'processing'>('card');
  const [chargeId, setChargeId] = useState('');
  const [encryptionKey, setEncryptionKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState({ number: '', month: '', year: '', cvv: '' });
  const [pin, setPin] = useState('');
  const [otp, setOtp] = useState('');

  useEffect(() => {
    if (isOpen) {
      setCycle(initialCycle);
      setStep('card');
      setError('');
      setChargeId('');
      setPin('');
      setOtp('');
      setCard({ number: '', month: '', year: '', cvv: '' });
    }
  }, [isOpen, initialCycle]);

  const price = useMemo(() => FLUTTERWAVE_PRICING[cycle], [cycle]);

  if (!isOpen) return null;

  const loadKey = async () => {
    if (encryptionKey) return encryptionKey;
    const config = await api.billingConfig();
    setEncryptionKey(config.encryptionKey);
    return config.encryptionKey;
  };

  const submitCard = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const number = card.number.replace(/\D/g, '');
      const month = card.month.replace(/\D/g, '');
      const year = card.year.replace(/\D/g, '');
      const cvv = card.cvv.replace(/\D/g, '');
      if (!/^\d{12,19}$/.test(number)) throw new Error('Enter a valid card number.');
      if (!/^(0[1-9]|1[0-2])$/.test(month)) throw new Error('Expiry month must be MM.');
      if (!/^\d{2}$/.test(year) && !/^\d{4}$/.test(year)) throw new Error('Expiry year must be YY or YYYY.');
      if (!/^\d{3,4}$/.test(cvv)) throw new Error('Enter a valid CVV.');

      const key = await loadKey();
      const nonce = nonce12();
      const [encryptedNumber, encryptedMonth, encryptedYear, encryptedCvv] = await Promise.all([
        encryptAES(number, key, nonce),
        encryptAES(month, key, nonce),
        encryptAES(year.slice(-2), key, nonce),
        encryptAES(cvv, key, nonce),
      ]);

      const result = await api.checkout({
        cycle,
        card: {
          nonce,
          encrypted_card_number: encryptedNumber,
          encrypted_expiry_month: encryptedMonth,
          encrypted_expiry_year: encryptedYear,
          encrypted_cvv: encryptedCvv,
        },
      });

      setChargeId(result.chargeId);
      const type = nextActionType(result.nextAction);
      if (result.redirectUrl) {
        window.location.href = result.redirectUrl;
        return;
      }
      if (result.status === 'succeeded') {
        window.location.href = '/?billing=success';
        return;
      }
      if (type.includes('pin')) setStep('pin');
      else if (type.includes('otp')) setStep('otp');
      else setStep('processing');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment could not be started.');
    } finally {
      setBusy(false);
    }
  };

  const submitAuth = async (type: 'pin' | 'otp') => {
    setBusy(true);
    setError('');
    try {
      if (!chargeId) throw new Error('Payment session expired. Start checkout again.');
      if (type === 'otp') {
        if (!/^\d{4,8}$/.test(otp)) throw new Error('Enter the OTP sent by your bank.');
        const result = await api.authorizeBilling({ chargeId, type, otp });
        if (result.redirectUrl) {
          window.location.href = result.redirectUrl;
          return;
        }
        const action = nextActionType(result.nextAction);
        if (result.status === 'succeeded') {
          window.location.href = '/?billing=success';
          return;
        }
        if (action.includes('pin')) setStep('pin');
        else if (action.includes('otp')) setStep('otp');
        else setStep('processing');
      } else {
        if (!/^\d{4,6}$/.test(pin)) throw new Error('Enter your card PIN.');
        const key = await loadKey();
        const nonce = nonce12();
        const encryptedPin = await encryptAES(pin, key, nonce);
        const result = await api.authorizeBilling({
          chargeId,
          type,
          pin: { nonce, encrypted_pin: encryptedPin },
        });
        if (result.redirectUrl) {
          window.location.href = result.redirectUrl;
          return;
        }
        const action = nextActionType(result.nextAction);
        if (result.status === 'succeeded') {
          window.location.href = '/?billing=success';
          return;
        }
        if (action.includes('otp')) setStep('otp');
        else if (action.includes('pin')) setStep('pin');
        else setStep('processing');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Authorization failed.');
    } finally {
      setBusy(false);
    }
  };

  const pollStatus = async () => {
    if (!chargeId) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.billingStatus(chargeId);
      if (result.status === 'succeeded') {
        window.location.href = '/?billing=success';
        return;
      }
      const action = nextActionType(result.nextAction);
      if (action.includes('pin')) setStep('pin');
      else if (action.includes('otp')) setStep('otp');
      else if (result.redirectUrl) window.location.href = result.redirectUrl;
      else setError(`Payment status: ${result.status}. Please try again.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check payment status.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl bg-slate-950 border border-slate-800 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-white">Upgrade to WyBuild Pro</h2>
            <p className="text-xs text-slate-400 mt-1">Secure Flutterwave v4 checkout</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-900 text-slate-400" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {step === 'card' && (
            <form onSubmit={submitCard} className="space-y-4">
              <div className="grid grid-cols-2 gap-2 p-1 rounded-lg bg-slate-900 border border-slate-800">
                {(['monthly', 'yearly'] as BillingCycle[]).map((x) => (
                  <button key={x} type="button" onClick={() => setCycle(x)}
                    className={`py-2 rounded-md text-xs font-semibold ${cycle === x ? 'bg-cyan-600 text-white' : 'text-slate-400'}`}>
                    {x === 'monthly' ? '$10 / month' : '$100 / year'}
                  </button>
                ))}
              </div>

              <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 text-xs text-slate-300 flex gap-2">
                <Lock className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                Card number, expiry and CVV are encrypted in your browser before they leave it.
              </div>

              <label className="block text-xs text-slate-300">Card number
                <input value={card.number} onChange={(e) => setCard({ ...card, number: e.target.value })} inputMode="numeric" autoComplete="cc-number"
                  className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-3 text-sm text-white outline-none focus:border-cyan-500" placeholder="1234 5678 9012 3456" />
              </label>
              <div className="grid grid-cols-3 gap-3">
                <label className="block text-xs text-slate-300">MM
                  <input value={card.month} onChange={(e) => setCard({ ...card, month: e.target.value })} inputMode="numeric" autoComplete="cc-exp-month"
                    className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-3 text-sm text-white outline-none focus:border-cyan-500" placeholder="MM" />
                </label>
                <label className="block text-xs text-slate-300">YY
                  <input value={card.year} onChange={(e) => setCard({ ...card, year: e.target.value })} inputMode="numeric" autoComplete="cc-exp-year"
                    className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-3 text-sm text-white outline-none focus:border-cyan-500" placeholder="YY" />
                </label>
                <label className="block text-xs text-slate-300">CVV
                  <input value={card.cvv} onChange={(e) => setCard({ ...card, cvv: e.target.value })} inputMode="numeric" autoComplete="cc-csc" type="password"
                    className="mt-1 w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-3 text-sm text-white outline-none focus:border-cyan-500" placeholder="CVV" />
                </label>
              </div>

              {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 flex gap-2"><AlertCircle className="w-4 h-4 shrink-0" />{error}</div>}
              <button disabled={busy} className="w-full rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 py-3 text-sm font-bold text-white flex items-center justify-center gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                {busy ? 'Processing securely…' : `Pay $${price.amount}`}
              </button>
            </form>
          )}

          {step === 'pin' && (
            <div className="space-y-4">
              <div><h3 className="font-bold text-white">Card PIN required</h3><p className="text-xs text-slate-400 mt-1">Your bank requires PIN authorization for this payment.</p></div>
              <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" type="password"
                className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-3 text-sm text-white" placeholder="Enter card PIN" />
              {error && <div className="text-xs text-red-300">{error}</div>}
              <button disabled={busy} onClick={() => submitAuth('pin')} className="w-full rounded-lg bg-cyan-600 py-3 text-sm font-bold text-white flex items-center justify-center gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} Authorize payment
              </button>
            </div>
          )}

          {step === 'otp' && (
            <div className="space-y-4">
              <div><h3 className="font-bold text-white">Bank OTP required</h3><p className="text-xs text-slate-400 mt-1">Enter the one-time code sent by your bank.</p></div>
              <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" autoComplete="one-time-code"
                className="w-full rounded-lg bg-slate-900 border border-slate-800 px-3 py-3 text-sm text-white" placeholder="Enter OTP" />
              {error && <div className="text-xs text-red-300">{error}</div>}
              <button disabled={busy} onClick={() => submitAuth('otp')} className="w-full rounded-lg bg-cyan-600 py-3 text-sm font-bold text-white flex items-center justify-center gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} Verify OTP
              </button>
            </div>
          )}

          {step === 'processing' && (
            <div className="space-y-4 text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-cyan-400" />
              <div><h3 className="font-bold text-white">Waiting for payment confirmation</h3><p className="text-xs text-slate-400 mt-1">We will not activate Pro until Flutterwave confirms the charge.</p></div>
              {error && <div className="text-xs text-red-300">{error}</div>}
              <button disabled={busy} onClick={pollStatus} className="w-full rounded-lg bg-slate-800 py-3 text-sm font-bold text-white">
                {busy ? 'Checking…' : 'Check payment status'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
