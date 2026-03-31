// Stockfish engine worker
// Communicates via UCI protocol
// Wraps stockfish.js v18 (single-threaded WASM build)

// stockfish.js v18 is a self-contained worker script that:
// - Accepts UCI commands via postMessage(string) to itself
// - Sends UCI output via the native postMessage(string) back to the main thread
//
// We intercept this by:
// 1. Replacing the global postMessage so stockfish.js output is captured locally
// 2. Using r.processCommand (set by stockfish.js on load) to send UCI commands
// 3. Exposing our own structured message API on top

let stockfishLoaded = false;
let uciMessageListeners = [];
let pendingQueue = [];

// Intercept postMessage BEFORE importing stockfish.js
// stockfish.js calls the native postMessage for UCI output lines
const nativePostMessage = self.postMessage.bind(self);
self.postMessage = function (data) {
  const line = typeof data === 'string' ? data : String(data);
  // Dispatch to all registered UCI listeners
  uciMessageListeners.forEach(fn => fn(line));
};

function addUciListener(fn) {
  uciMessageListeners.push(fn);
}

function removeUciListener(fn) {
  uciMessageListeners = uciMessageListeners.filter(l => l !== fn);
}

function sendUci(cmd) {
  if (self.processCommand) {
    self.processCommand(cmd);
  } else {
    pendingQueue.push(cmd);
  }
}

function waitFor(prefix, onLine) {
  return new Promise(resolve => {
    const handler = line => {
      if (onLine) onLine(line);
      if (line.startsWith(prefix)) {
        removeUciListener(handler);
        resolve(line);
      }
    };
    addUciListener(handler);
  });
}

function uci(cmd, waitForPrefix, onLine) {
  if (!waitForPrefix) {
    sendUci(cmd);
    return Promise.resolve(null);
  }
  const p = waitFor(waitForPrefix, onLine);
  sendUci(cmd);
  return p;
}

// ─── App message handler ──────────────────────────────────────────────────────

self.onmessage = async function (e) {
  const { type, id, payload } = e.data;

  if (type === 'init') {
    // Load stockfish.js — it will set self.processCommand and start the engine
    // Stockfish resolves its .wasm from self.location (the worker's URL),
    // so engine.worker.wasm must be co-located with this worker file.
    importScripts('../../vendor/stockfish.js');

    // Flush any commands sent before processCommand was ready
    while (pendingQueue.length && self.processCommand) {
      self.processCommand(pendingQueue.shift());
    }

    await uci('uci', 'uciok');
    await uci('isready', 'readyok');

    nativePostMessage({ type: 'ready' });
  }

  if (type === 'analyze') {
    const { fen, depth = 15, multiPV = 1 } = payload;

    await uci(`setoption name MultiPV value ${multiPV}`, null);
    await uci(`position fen ${fen}`, null);

    const lines = [];

    const output = await uci(`go depth ${depth}`, 'bestmove', line => {
      if (line.startsWith('info') && line.includes(' pv ')) {
        lines.push(parseInfoLine(line));
      }
    });

    const bestMove = output.split(' ')[1];
    const evalScore = lines.length > 0 ? lines[lines.length - 1].score : null;

    nativePostMessage({
      type: 'analysis',
      id,
      payload: { bestMove, eval: evalScore, lines },
    });
  }
};

// ─── UCI info line parser ─────────────────────────────────────────────────────

function parseInfoLine(line) {
  const parts = line.split(' ');
  const result = {};

  const depthIdx = parts.indexOf('depth');
  if (depthIdx !== -1) result.depth = parseInt(parts[depthIdx + 1], 10);

  const scoreIdx = parts.indexOf('score');
  if (scoreIdx !== -1) {
    const scoreType = parts[scoreIdx + 1]; // cp or mate
    const scoreVal = parseInt(parts[scoreIdx + 2], 10);
    result.score =
      scoreType === 'cp' ? scoreVal / 100 : scoreVal > 0 ? 999 : -999;
  }

  const pvIdx = parts.indexOf('pv');
  if (pvIdx !== -1) {
    result.moves = parts.slice(pvIdx + 1);
    result.move = result.moves[0];
  }

  const multipvIdx = parts.indexOf('multipv');
  if (multipvIdx !== -1) result.pvIndex = parseInt(parts[multipvIdx + 1], 10);

  return result;
}
