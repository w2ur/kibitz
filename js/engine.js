// Main-thread wrapper for the Stockfish engine Web Worker.
// Usage:
//   import { preload, analyze } from './engine.js';
//   await preload();  // optional — called automatically by analyze()
//   const result = await analyze(fen, { depth: 15, multiPV: 3 });

let worker = null;
let ready = false;
let readyPromise = null;
const pendingCallbacks = new Map();
let nextId = 0;

export function preload() {
  if (worker) return readyPromise;

  worker = new Worker('js/workers/engine.worker.js');

  // Route incoming messages by type / id
  worker.onmessage = e => {
    const { type, id, payload } = e.data;

    if (type === 'ready') {
      ready = true;
      const resolve = pendingCallbacks.get('init');
      if (resolve) {
        pendingCallbacks.delete('init');
        resolve();
      }
    } else if (type === 'analysis' && pendingCallbacks.has(id)) {
      const resolve = pendingCallbacks.get(id);
      pendingCallbacks.delete(id);
      resolve(payload);
    }
  };

  worker.onerror = err => {
    console.error('[engine] worker error:', err);
  };

  readyPromise = new Promise(resolve => {
    pendingCallbacks.set('init', resolve);
  });

  worker.postMessage({ type: 'init' });
  return readyPromise;
}

/**
 * Analyze a position.
 *
 * @param {string} fen - FEN string of the position.
 * @param {object} options
 * @param {number} [options.depth=15]   - Search depth.
 * @param {number} [options.multiPV=1]  - Number of principal variations.
 * @returns {Promise<{bestMove: string, eval: number|null, lines: object[]}>}
 */
export async function analyze(fen, options = {}) {
  if (!ready) await preload();

  const id = nextId++;
  return new Promise(resolve => {
    pendingCallbacks.set(id, resolve);
    worker.postMessage({ type: 'analyze', id, payload: { fen, ...options } });
  });
}
