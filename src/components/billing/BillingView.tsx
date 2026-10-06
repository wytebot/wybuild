import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { BillingCycle } from '../../types';
import {
  CreditCard,
  Check,
  Zap,
  Shield,
  Clock,
  Sparkles,
  Layers,
  ArrowRight,
  Download,
  AlertCircle,
  Server,
  Lock,
} from 'lucide-react';
import { FLUTTERWAVE_PRICING } from '../../services/flutterwave';

export const BillingView: React.FC = () => {
  const { subscription, lifetimeFree, rateLimits, openFlutterwaveCheckout, cancelSubscription } = useApp();
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [cancelling, setCancelling] = useState(false);

  const isPro = subscription.plan === 'pro';
  const isFreeForever = lifetimeFree;
  const cancellationPending = isPro && subscription.status === 'cancelled' && !!subscription.graceUntil;
  const graceLabel = subscription.graceUntil ? new Date(subscription.graceUntil).toLocaleString() : '';

  const cancelNow = async () => {
    if (cancelling || cancellationPending) return;
    setCancelling(true);
    try { await cancelSubscription(); } finally { setCancelling(false); }
  };

  const planComparison = [
    {
      feature: 'Connected GitHub Projects',
      free: 'Unlimited projects',
      pro: 'Unlimited projects',
      highlight: true,
    },
    {
      feature: 'Successful Cloud Builds',
      free: '5 successful builds / month',
      pro: 'Unlimited Builds',
      highlight: true,
    },
    {
      feature: 'Server Runner Tier',
      free: 'Shared Standard (Queued)',
      pro: 'Pro capacity (5 concurrent)',
      highlight: true,
    },
    {
      feature: 'Concurrent Build Slots',
      free: '1 concurrent build',
      pro: '5 concurrent builds',
    },
    {
      feature: 'Build Timeout Limit',
      free: '15 minutes',
      pro: '60 minutes',
    },
    {
      feature: 'Release Keystores',
      free: '1 Keystore Profile',
      pro: 'Unlimited Keystore Profiles',
    },
    {
      feature: 'Advanced build diagnostics',
      free: 'Included',
      pro: 'Included',
    },
    {
      feature: 'Build Error Diagnostics',
      free: 'Pattern-based diagnostics',
      pro: 'Pattern-based diagnostics',
    },
    {
      feature: 'Team Collaboration Seats',
      free: 'Unlimited local workspace members',
      pro: 'Unlimited Team Members',
    },
    {
      feature: 'Free Browser Dev Utilities',
      free: 'Free (Client-side, 0 cost)',
      pro: 'Free (Client-side, 0 cost)',
    },
  ];

  return (
    <div className="p-3 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5 sm:space-y-8">
      {/* Header */}
      <div className="text-center max-w-2xl mx-auto space-y-3">
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Simple, Transparent Cloud CI/CD Pricing
        </h1>
        <p className="text-sm text-slate-400">
          Build web apps into store-ready Android packages without maintaining Android Studio. Free includes 5 successful builds each month; Pro removes the build cap.
        </p>

        {/* Monthly / Yearly Switcher */}
        <div className="inline-flex items-center gap-2 p-1.5 bg-slate-900 border border-slate-800 rounded-lg mt-4">
          <button
            onClick={() => setBillingCycle('monthly')}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition cursor-pointer ${
              billingCycle === 'monthly'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Monthly ($9.99/mo) · ₦15,000
          </button>
          <button
            onClick={() => setBillingCycle('yearly')}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition flex items-center gap-1.5 cursor-pointer ${
              billingCycle === 'yearly'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>Annual ($99/yr) · ₦150,000</span>
            <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded font-bold">
              Save 17%
            </span>
          </button>
        </div>
      </div>

      {/* Active Subscription Status Banner */}
      <div className="p-4 sm:p-6 rounded-xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div
            className={`w-12 h-12 rounded-lg flex items-center justify-center font-bold shrink-0 ${
              isPro
                ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400'
                : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
            }`}
          >
            {isPro ? <Zap className="w-6 h-6 fill-amber-400" /> : <Server className="w-6 h-6" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-white">
                Current Plan: {isFreeForever ? 'Free Forever' : isPro ? 'Pro Developer' : 'Free Developer Tier'}
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded font-mono font-semibold uppercase ${
                  isPro
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {subscription.status}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {isFreeForever
                ? 'WyBuild owner access: all Free + Pro capabilities are permanently unlocked on this GitHub account.'
                : isPro
                ? cancellationPending
                  ? `Cancellation requested. Pro remains active through the 5-day grace period until ${graceLabel}, then the Free billing card returns automatically.`
                  : `Billed via Flutterwave v4 (${subscription.billingCycle}). Next renewal on ${new Date(subscription.nextBillingDate).toLocaleDateString()}.`
                : `5 successful builds/month. Projects are unlimited. Build allowance resets ${rateLimits.resetsAt}.`}
            </p>
          </div>
        </div>

        <div>
          {!isPro && !isFreeForever ? (
            <button
              onClick={() => openFlutterwaveCheckout(billingCycle)}
              className="px-5 py-2.5 text-xs font-bold rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:brightness-110 text-slate-950 transition flex items-center gap-2 shadow-lg cursor-pointer"
            >
              <Sparkles className="w-4 h-4 fill-slate-950" />
              <span>Upgrade to Pro ({FLUTTERWAVE_PRICING[billingCycle].label})</span>
            </button>
          ) : isFreeForever ? (
            <div className="text-right text-xs font-mono text-emerald-400 font-semibold">✓ Free Forever Access</div>
          ) : (
            <div className="min-w-[210px] text-right">
              <div className="text-sm font-bold text-emerald-300">You are now in Pro</div>
              {cancellationPending ? (
                <div className="mt-1 text-[11px] text-amber-300">Cancellation scheduled · Pro ends {graceLabel}</div>
              ) : (
                <button onClick={cancelNow} disabled={cancelling} className="mt-2 px-4 py-2 rounded-lg border border-rose-400/30 text-rose-300 text-xs font-bold disabled:opacity-60">
                  {cancelling ? 'Cancelling…' : 'Cancel subscription'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {isFreeForever && (
        <div className="p-4 rounded-xl bg-emerald-500/[.06] border border-emerald-400/20 flex items-start gap-3">
          <Sparkles className="w-5 h-5 text-emerald-300 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-bold text-emerald-200">Free Forever account</div>
            <div className="text-xs text-slate-400 mt-1">This account bypasses the normal Free build cap and billing. No payment method is required.</div>
          </div>
        </div>
      )}

      {/* Two Plan Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* FREE TIER CARD */}
        <div className="p-7 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-start mb-2">
              <div>
                <h3 className="text-lg font-bold text-white">Free Developer</h3>
                <p className="text-xs text-slate-400">For developers building web apps into Android apps</p>
              </div>
              <span className="text-2xl font-bold font-mono text-white">$0</span>
            </div>

            <p className="text-xs text-slate-400 mt-3 mb-6">
              Free keeps project visibility unrestricted. Only successful cloud builds are metered: 5 per month.
            </p>

            <ul className="space-y-3 text-xs text-slate-300 border-t border-slate-800 pt-5">
              <li className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Unlimited GitHub projects</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>5 successful Cloud builds per month</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>1 Concurrent build runner slot</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Standard shared runner queue</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>All Free Browser Dev Tools (Icons, Pubspec)</span>
              </li>
            </ul>
          </div>

          <div className="mt-8 pt-4 border-t border-slate-800">
            <button
              disabled={!isPro || subscription.autoRenew === false}
              onClick={() => {
                if (window.confirm('Stop auto-renewal? Pro stays active until the end of the period you already paid for.')) cancelSubscription();
              }}
              className="w-full py-2.5 text-xs font-semibold rounded bg-slate-800 text-slate-400 disabled:opacity-70 text-center cursor-pointer"
            >
              {!isPro ? 'Current Plan' : subscription.autoRenew === false ? 'Cancels at period end' : 'Cancel auto-renewal'}
            </button>
          </div>
        </div>

        {/* PRO TIER CARD */}
        <div className="p-7 rounded-xl bg-gradient-to-b from-slate-900 to-slate-900/90 border-2 border-emerald-500/50 flex flex-col justify-between relative shadow-xl">
          <div className="absolute -top-3 right-6 bg-emerald-500 text-slate-950 text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded shadow">
            Flutterwave v4 Powered
          </div>

          <div>
            <div className="flex justify-between items-start mb-2">
              <div>
                <h3 className="text-lg font-bold text-white">Pro Developer</h3>
                <p className="text-xs text-emerald-300">For freelance developers, agencies & production teams</p>
              </div>
              <div className="text-right">
                <span className="text-3xl font-bold font-mono text-white">
                  ${FLUTTERWAVE_PRICING[billingCycle].amount}
                </span>
                <span className="text-xs text-slate-300 block font-mono">
                  {FLUTTERWAVE_PRICING[billingCycle].ngnLabel}
                </span>
                <span className="text-[10px] text-slate-500 block font-mono">
                  / {FLUTTERWAVE_PRICING[billingCycle].interval}
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-300 mt-3 mb-6">
              Higher build capacity, longer build timeouts, unlimited signing profiles and team seats.
            </p>

            <ul className="space-y-3 text-xs text-slate-200 border-t border-slate-800 pt-5">
              <li className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="font-semibold text-white">Unlimited projects in the WyBuild workspace</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="font-semibold text-white">No monthly successful-build cap (server-enforced)</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="font-semibold text-white">5 concurrent build slots (server-enforced)</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-amber-400 shrink-0" />
                <span>60-Minute Build Timeout</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Unlimited Release Keystores & Signing Profiles</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Intelligent Error Telemetry with 1-Click Fixes</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Check className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Unlimited Team Members & RBAC</span>
              </li>
            </ul>
          </div>

          <div className="mt-8 pt-4 border-t border-slate-800">
            <button
              onClick={() => isPro ? (cancellationPending ? undefined : cancelNow()) : openFlutterwaveCheckout(billingCycle)}
              disabled={isPro && cancellationPending}
              className="w-full py-2.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition flex items-center justify-center gap-2 shadow-lg cursor-pointer"
            >
              <CreditCard className="w-4 h-4" />
              <span>{isPro ? (cancellationPending ? 'Cancellation scheduled — Pro active during grace' : 'Cancel subscription') : `Upgrade with Flutterwave ($${FLUTTERWAVE_PRICING[billingCycle].amount} / ${FLUTTERWAVE_PRICING[billingCycle].ngnLabel})`}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Feature Comparison Table */}
      <div className="space-y-4">
        <h2 className="text-base font-bold text-white">Detailed Feature Matrix</h2>
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-xs">
            <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 font-mono text-[10px] uppercase">
              <tr>
                <th className="py-3 px-5">Platform Capability</th>
                <th className="py-3 px-5">Free Developer Tier</th>
                <th className="py-3 px-5 text-emerald-300 font-bold">Pro Developer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {planComparison.map((row, i) => (
                <tr key={i} className="hover:bg-slate-800/30 transition">
                  <td className="py-3 px-5 font-medium text-slate-200">{row.feature}</td>
                  <td className="py-3 px-5 text-slate-400 font-mono">{row.free}</td>
                  <td className="py-3 px-5 font-mono text-emerald-300 font-semibold">{row.pro}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      {/* Low-Cost Architecture & Resource Guard Notice */}
      <div className="p-5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-400 space-y-2">
        <div className="flex items-center gap-2 text-slate-200 font-bold">
          <Shield className="w-4 h-4 text-emerald-400" />
          <span>Platform Cost-Efficiency & Infrastructure Guarantee</span>
        </div>
        <p className="leading-relaxed">
          WyBuild keeps the free experience low-cost by storing project configuration in the browser, keeping developer utilities client-side, using GitHub as the source of truth, and metering only successful cloud builds. Build artifacts remain in the connected GitHub Actions workflow rather than a second WyBuild file store.
        </p>
      </div>
    </div>
  );
};
