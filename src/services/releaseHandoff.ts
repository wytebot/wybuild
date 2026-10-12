// Hands a build/artifact from the Logs page to the Releases page without routing state.
// Read with peek during render (pure) and clear in an effect, so React StrictMode's double render cannot lose it.
export interface ReleaseHandoff { repo: string; buildId: string; artifactId?: number }
let pending: ReleaseHandoff | null = null;
export const setReleaseHandoff = (h: ReleaseHandoff) => { pending = h; };
export const peekReleaseHandoff = (): ReleaseHandoff | null => pending;
export const clearReleaseHandoff = () => { pending = null; };
