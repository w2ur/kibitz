// Engine worker — wraps Stockfish as a sub-worker
// Stockfish.js is designed as a standalone worker, so we load it in its
// own Worker and communicate via UCI strings.

let sf = null;
let uciListeners = [];

function addUciListener(fn) { uciListeners.push(fn); }
function removeUciListener(fn) { uciListeners = uciListeners.filter(l => l !== fn); }

function sendUci(cmd) {
  sf.postMessage(cmd);
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
    // Stockfish.js is a self-contained worker script
    sf = new Worker('../../vendor/stockfish.js');
    sf.onmessage = (evt) => {
      const line = typeof evt.data === 'string' ? evt.data : String(evt.data);
      uciListeners.forEach(fn => fn(line));
    };

    await uci('uci', 'uciok');
    await uci('isready', 'readyok');

    self.postMessage({ type: 'ready' });
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

    self.postMessage({
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
