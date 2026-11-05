import { isNative } from './apiBase';

export type WyBuildFileKind = 'apk' | 'aab' | 'archive' | 'log' | 'generic';
const safeName = (value: string) => String(value || 'download.bin').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, '-').slice(0, 150) || 'download.bin';
export function folderForFile(kind: WyBuildFileKind): string {
  if (kind === 'apk' || kind === 'aab') return 'WyBuild/Builds/Installers';
  if (kind === 'archive') return 'WyBuild/Builds/Archives';
  if (kind === 'log') return 'WyBuild/Builds/Logs';
  return 'WyBuild/Downloads';
}

/** Stream a remote artifact into a stable, type-specific app folder. Large APK/ZIP files
 * are never converted to base64 or buffered in the JS heap. */
export async function saveNativeFile(url: string, filename: string, kind: WyBuildFileKind) {
  if (!isNative()) throw new Error('Native file saving is only available inside the Android app.');
  const parsed = new URL(url, window.location.href);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('A secure HTTPS download URL is required.');
  const name = safeName(filename);
  const mimeType = kind === 'apk' ? 'application/vnd.android.package-archive' : kind === 'log' ? 'text/plain' : 'application/octet-stream';
  try {
    const { registerPlugin } = await import('@capacitor/core');
    const Downloads = registerPlugin<any>('WyBuildDownloads');
    const queued = await Downloads.enqueue({ url: parsed.href, filename: name, category: kind, mimeType });
    const requestId = Number(queued?.requestId);
    if (!Number.isFinite(requestId) || requestId < 0) throw new Error('Android did not confirm that the download was queued.');
    // DownloadManager owns the transfer and shows native progress/completion notifications.
    return { ...queued, filename: name, folder: queued.folder || `Downloads/${folderForFile(kind)}`, directory: 'Downloads' as const, queued: true, requestId };
  } catch (downloadManagerError) {
    // Compatibility fallback for older URL-shell builds without the custom DownloadManager plugin.
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const folder = folderForFile(kind);
    await Filesystem.mkdir({ path: folder, directory: Directory.Documents, recursive: true }).catch(() => {});
    const saved = await Filesystem.downloadFile({ url: parsed.href, path: `${folder}/${name}`, directory: Directory.Documents, recursive: true } as any);
    const uri = (saved as any)?.uri || (saved as any)?.path;
    if (!uri) throw downloadManagerError;
    await Share.share({ title: name, text: `Saved in app Documents/${folder}`, url: uri, dialogTitle: 'Export or share downloaded file' }).catch(() => {});
    return { uri, filename: name, folder: `Documents/${folder}`, directory: 'Documents' as const, fallback: true };
  }
}

export function classifyArtifact(filename: string): WyBuildFileKind {
  const ext = String(filename).toLowerCase().split('.').pop();
  if (ext === 'apk') return 'apk';
  if (ext === 'aab') return 'aab';
  if (['zip', 'tar', 'gz', 'tgz'].includes(ext || '')) return 'archive';
  if (['txt', 'log'].includes(ext || '')) return 'log';
  return 'generic';
}
