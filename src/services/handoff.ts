// Tiny in-memory hand-off between screens (no storage involved).
let pendingTwaRepo = '';
export const setPendingTwaRepo = (repo: string) => { pendingTwaRepo = repo; };
export const takePendingTwaRepo = () => { const r = pendingTwaRepo; pendingTwaRepo = ''; return r; };
