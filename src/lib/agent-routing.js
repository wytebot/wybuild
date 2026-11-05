/**
 * Build a bounded BYOK fallback sequence. The default agent is considered first,
 * but its fallback models must not starve other configured API keys. Candidate
 * order is round-robin by model preference: each agent's primary model first,
 * then each agent's first fallback, then each agent's second fallback, etc.
 * Every model stays paired with the API key and endpoint saved on that agent.
 */
export function interleaveAgentCandidates(agents, limit = 8) {
  const max = Math.max(1, Math.min(32, Number(limit) || 8));
  const normalized = (Array.isArray(agents) ? agents : []).map((agent) => ({
    ...agent,
    models: [...new Set((Array.isArray(agent.models) ? agent.models : [agent.model])
      .map((model) => String(model || '').trim()).filter(Boolean))].slice(0, 8),
  })).filter((agent) => String(agent.key || '').trim() && agent.models.length && String(agent.provider || '').trim());
  const result = [];
  const seen = new Set();
  const maxModels = Math.max(0, ...normalized.map(agent => agent.models.length));
  for (let modelIndex = 0; modelIndex < maxModels && result.length < max; modelIndex++) {
    for (const agent of normalized) {
      if (result.length >= max) break;
      const model = agent.models[modelIndex];
      if (!model) continue;
      const identity = `${agent.provider}\u0000${agent.baseUrl || ''}\u0000${agent.key}\u0000${model}\u0000${agent.task || 'all'}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      result.push({ key: agent.key, model, provider: agent.provider, baseUrl: agent.baseUrl || '', task: agent.task || 'all', ...(agent.modelEnv ? { modelEnv: String(agent.modelEnv) } : {}), ...(agent.keyEnv ? { keyEnv: String(agent.keyEnv) } : {}), ...(agent.fallbackEnv ? { fallbackEnv: String(agent.fallbackEnv) } : {}), ...(agent.agentId ? { agentId: String(agent.agentId) } : {}) });
    }
  }
  return result;
}

/**
 * Strict-priority fallback order. Agents saved for the task come first (default agent first, models
 * round-robined across keys); text-capable agents saved for sibling text tasks on the same API & Agents
 * page follow as a last resort. Nothing outside the saved agents is ever added.
 */
export function buildFallbackSequence(primary, extra = [], limit = 8) {
  const max = Math.max(1, Math.min(32, Number(limit) || 8));
  const first = interleaveAgentCandidates(primary, max);
  if (first.length >= max) return first;
  const seen = new Set(first.map(c => `${c.provider}\u0000${c.baseUrl || ''}\u0000${c.key}\u0000${c.model}`));
  const rest = interleaveAgentCandidates(extra, max).filter(c => !seen.has(`${c.provider}\u0000${c.baseUrl || ''}\u0000${c.key}\u0000${c.model}`));
  return [...first, ...rest].slice(0, max);
}
