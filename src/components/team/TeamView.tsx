import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { UserRole } from '../../types';
import {
  Users2,
  UserPlus,
  Shield,
  Trash2,
  Copy,
  Check,
  Bell,
  Activity,
  Key,
} from 'lucide-react';

export const TeamView: React.FC = () => {
  const { teamMembers, inviteMember, removeMember, auditLogs } = useApp();
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('Developer');
  const [copiedLink, setCopiedLink] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('https://hooks.slack.com/services/T00/B00/XXXX');
  const [webhookSaved, setWebhookSaved] = useState(false);

  const handleSendInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteName || !inviteEmail) return;
    inviteMember(inviteName, inviteEmail, inviteRole);
    setInviteName('');
    setInviteEmail('');
    setShowInviteModal(false);
  };

  const handleCopyInviteLink = () => {
    navigator.clipboard.writeText('https://wybuild.app/invite/join-team-9482');
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleSaveWebhook = () => {
    setWebhookSaved(true);
    setTimeout(() => setWebhookSaved(false), 2000);
  };

  return (
    <div className="p-3 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Team Collaboration & RBAC</h1>
          <p className="text-sm text-slate-400 mt-1">
            Manage developer access, assign role-based permissions, configure Slack/Discord alerts, and review audit trails.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleCopyInviteLink}
            className="px-3.5 py-2 text-xs font-semibold rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition flex items-center gap-1.5 cursor-pointer"
          >
            {copiedLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-emerald-400" />}
            <span>{copiedLink ? 'Invite Link Copied' : 'Copy Invite Link'}</span>
          </button>

          <button
            onClick={() => setShowInviteModal(true)}
            className="px-4 py-2 text-xs font-semibold rounded bg-emerald-600 hover:bg-emerald-500 text-white transition flex items-center gap-1.5 cursor-pointer shadow-sm"
          >
            <UserPlus className="w-4 h-4" />
            <span>Invite Member</span>
          </button>
        </div>
      </div>

      {/* Members Grid */}
      <div className="space-y-4">
        <h2 className="text-sm font-bold text-white flex items-center gap-2">
          <Users2 className="w-4 h-4 text-emerald-400" />
          <span>Active Workspace Members ({teamMembers.length})</span>
        </h2>

        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-xs">
            <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 uppercase font-mono text-[10px]">
              <tr>
                <th className="py-3 px-4">Member</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Joined</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {teamMembers.map((member) => (
                <tr key={member.id} className="hover:bg-slate-800/40 transition">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-white text-xs">
                        {member.name
                          .split(' ')
                          .map((n) => n[0])
                          .join('')
                          .toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold text-white">{member.name}</p>
                        <p className="text-slate-400 text-[11px] font-mono">{member.email}</p>
                      </div>
                    </div>
                  </td>

                  <td className="py-3 px-4">
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded font-mono ${
                        member.role === 'Owner'
                          ? 'bg-amber-500/10 text-amber-300 border border-amber-500/30'
                          : member.role === 'Admin'
                          ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {member.role}
                    </span>
                  </td>

                  <td className="py-3 px-4">
                    <span
                      className={`inline-flex items-center gap-1.5 text-[11px] ${
                        member.status === 'active' ? 'text-emerald-400' : 'text-amber-400'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${member.status === 'active' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                      <span className="capitalize">{member.status}</span>
                    </span>
                  </td>

                  <td className="py-3 px-4 text-slate-400 font-mono text-[11px]">
                    {new Date(member.joinedAt).toLocaleDateString()}
                  </td>

                  <td className="py-3 px-4 text-right">
                    {member.role !== 'Owner' && (
                      <button
                        onClick={() => removeMember(member.id)}
                        className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition cursor-pointer"
                        title="Remove member"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      {/* Role-Based Access Control Matrix */}
      <div className="p-4 sm:p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-4 text-xs">
        <h2 className="text-sm font-bold text-white flex items-center gap-2">
          <Shield className="w-4 h-4 text-emerald-400" />
          <span>Role Permissions Matrix</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="p-4 rounded bg-slate-950 border border-slate-800 space-y-2">
            <span className="font-bold text-amber-300 font-mono">Owner</span>
            <p className="text-slate-400">Full workspace ownership, billing management, deletion, all signing keys.</p>
          </div>
          <div className="p-4 rounded bg-slate-950 border border-slate-800 space-y-2">
            <span className="font-bold text-emerald-300 font-mono">Admin</span>
            <p className="text-slate-400">Invite members, configure repos, upload keystores, manage pipeline triggers.</p>
          </div>
          <div className="p-4 rounded bg-slate-950 border border-slate-800 space-y-2">
            <span className="font-bold text-slate-200 font-mono">Developer</span>
            <p className="text-slate-400">Trigger builds, view logs, run automated tests, download signed APK/AAB artifacts.</p>
          </div>
          <div className="p-4 rounded bg-slate-950 border border-slate-800 space-y-2">
            <span className="font-bold text-slate-400 font-mono">Viewer</span>
            <p className="text-slate-400">Read-only access to build logs, test coverage reports, and QR download codes.</p>
          </div>
        </div>
      </div>

      {/* Webhook Notifications */}
      <div className="p-4 sm:p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-4 text-xs">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-emerald-400" />
          <h2 className="text-sm font-bold text-white">Slack / Discord Build Notifications</h2>
        </div>
        <p className="text-slate-400">
          Receive real-time notifications on build successes, test failures, or APK artifact releases.
        </p>

        <div className="flex gap-3 max-w-xl">
          <input
            type="url"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            className="flex-1 bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-mono text-xs focus:border-emerald-500 focus:outline-none"
          />
          <button
            onClick={handleSaveWebhook}
            className="px-4 py-2 font-semibold rounded bg-emerald-600 hover:bg-emerald-500 text-white transition cursor-pointer"
          >
            {webhookSaved ? 'Saved!' : 'Save Webhook'}
          </button>
        </div>
      </div>

      {/* Audit Logs */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-white flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          <span>Audit Trail & Activity Log</span>
        </h2>

        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <div className="divide-y divide-slate-800/60 font-mono text-xs">
            {auditLogs.map((log) => (
              <div key={log.id} className="p-3 flex items-center justify-between text-slate-300">
                <div className="flex items-center gap-3">
                  <span className="text-emerald-400 font-semibold">{log.actor}</span>
                  <span className="text-slate-400">{log.action}:</span>
                  <span className="text-white font-medium">{log.target}</span>
                </div>
                <div className="flex items-center gap-3 text-slate-500 text-[11px]">
                  <span>IP: {log.ipAddress}</span>
                  <span>·</span>
                  <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Invite Member Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-xl p-4 sm:p-6 max-w-md w-full max-h-[92dvh] overflow-y-auto overscroll-contain space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white">Invite Team Member</h3>

            <form onSubmit={handleSendInvite} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="e.g. Alex Morgan"
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="alex@company.com"
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1">Role Assignment</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as UserRole)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white focus:border-emerald-500 focus:outline-none"
                >
                  <option value="Admin">Admin (Full project & runner configuration)</option>
                  <option value="Developer">Developer (Trigger builds, test runner, logs)</option>
                  <option value="Viewer">Viewer (Read-only)</option>
                </select>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="px-4 py-2 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-semibold rounded bg-emerald-600 hover:bg-emerald-500 text-white transition cursor-pointer shadow-sm"
                >
                  Send Invitation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
