import type { LinkMode, LinkRule } from '../types';

/** Same rules as the server (api/index.js cleanLinkRules) so mistakes show up while typing, not after a failed build. */
const SCHEME_RE = /^[a-z][a-z0-9+.-]*$/;
const BLOCKED_SCHEMES = new Set(['http', 'https', 'javascript', 'data', 'file', 'blob', 'about', 'vbscript', 'content', 'intent']);
const HOST_RE = /^(\*\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
const PATH_RE = /^\/[A-Za-z0-9\-._~%/]*$/;

export type ParsedLink =
  | { kind: 'scheme'; scheme: string; pattern: string }
  | { kind: 'host'; host: string; wildcard: boolean; path: string; pattern: string };

/** Returns the parsed rule, or a message explaining what is wrong. */
export function parseLinkPattern(input: string, mode: LinkMode): ParsedLink | string {
  const orig = input.trim();
  const t = orig.toLowerCase();
  if (!t) return 'Enter a domain such as shop.example.com, or a link type such as tel:';
  if (t.length > 200) return 'That is too long';
  const bare = t.replace(/:\/\/$/, ':');
  if (!/[/.]/.test(bare.replace(/:$/, '')) && SCHEME_RE.test(bare.replace(/:$/, ''))) {
    const scheme = bare.replace(/:$/, '');
    if (BLOCKED_SCHEMES.has(scheme)) return `"${scheme}:" cannot be used here. For websites, enter the domain instead.`;
    if (mode !== 'other') return 'Link types like tel: or mailto: can only be set to "Other (hand to Android)".';
    return { kind: 'scheme', scheme, pattern: scheme + ':' };
  }
  const rest = orig.replace(/^https?:\/\//i, '');
  const slash = rest.indexOf('/');
  const host = (slash === -1 ? rest : rest.slice(0, slash)).toLowerCase();
  let path = slash === -1 ? '' : rest.slice(slash).replace(/[?#].*$/, '').replace(/\*+$/, ''); // paths are case-sensitive
  if (!HOST_RE.test(host)) return 'Use a domain like shop.example.com or *.example.com (no port or login)';
  if (path === '/') path = '';
  if (path && !PATH_RE.test(path)) return 'The path may only contain letters, numbers and - . _ ~ % /';
  return { kind: 'host', host: host.replace(/^\*\./, ''), wildcard: host.startsWith('*.'), path, pattern: (host + path) };
}

export function checkLinkRule(rule: LinkRule): string {
  const r = parseLinkPattern(rule.pattern, rule.mode);
  return typeof r === 'string' ? r : '';
}

export const LINK_MODES: { id: LinkMode; label: string; hint: string }[] = [
  { id: 'internal', label: 'Internal', hint: 'Stays inside the app. Your own domains and custom domains: the app also opens when someone taps a link to them.' },
  { id: 'external', label: 'External', hint: "Opens in the phone's browser, so the user leaves the app." },
  { id: 'other', label: 'Other', hint: 'Handed to Android, which opens the right app: tel:, mailto:, sms:, WhatsApp, Maps, UPI...' },
];

export const LINK_PRESETS: { pattern: string; mode: LinkMode; label: string }[] = [
  { pattern: 'tel:', mode: 'other', label: 'Phone calls' },
  { pattern: 'mailto:', mode: 'other', label: 'Email' },
  { pattern: 'sms:', mode: 'other', label: 'Text messages' },
  { pattern: 'wa.me', mode: 'other', label: 'WhatsApp' },
  { pattern: 'maps.google.com', mode: 'other', label: 'Google Maps' },
];
