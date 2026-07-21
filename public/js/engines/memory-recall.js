// engines/memory-recall.js
// Memory Recall Engine — v1
// Stores and retrieves what worked, in what context

const STORAGE_KEY = 'hfc_memory_v1';

class MemoryRecallEngine {
  constructor() {
    this.local = this.loadLocal();
  }

  loadLocal() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  }

  saveLocal() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.local));
  }

  // Record a new session outcome
  record(session) {
    const entry = {
      id: crypto.randomUUID?.() || String(Date.now()),
      detectedState: session.detectedState,
      mode: session.mode,
      intervention: session.intervention,
      contextSnapshot: session.contextSnapshot,
      outcomeScore: session.outcomeScore, // 1-5
      outcomeNote: session.outcomeNote,
      timestamp: Date.now()
    };
    this.local.unshift(entry);
    // Keep last 200 entries to avoid bloat
    if (this.local.length > 200) this.local.length = 200;
    this.saveLocal();
    return entry;
  }

  // Query: "What worked last time I was in this state?"
  recall(currentState, topN = 3) {
    const matches = this.local
      .filter(e => e.detectedState === currentState.label)
      .filter(e => e.outcomeScore >= 4)
      .sort((a, b) => b.outcomeScore - a.outcomeScore || b.timestamp - a.timestamp);

    // v1: simple exact match. Future: fuzzy context matching (time of day, etc.)
    return matches.slice(0, topN);
  }

  // Human-readable summary of the best match
  bestTip(currentState) {
    const hits = this.recall(currentState, 1);
    if (!hits.length) return null;
    const hit = hits[0];
    const daysAgo = Math.floor((Date.now() - hit.timestamp) / 86400000);
    const timeText = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`;
    return `Last time you felt ${hit.detectedState} (${timeText}), "${hit.intervention}" helped. Want to try that again?`;
  }
}

export const memoryEngine = new MemoryRecallEngine();
