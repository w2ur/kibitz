// --- Event Bus ---
const bus = {
  _listeners: {},
  on(event, fn) {
    (this._listeners[event] ??= []).push(fn);
  },
  off(event, fn) {
    const list = this._listeners[event];
    if (list) this._listeners[event] = list.filter(f => f !== fn);
  },
  emit(event, data) {
    (this._listeners[event] ?? []).forEach(fn => fn(data));
  }
};

// --- State Machine ---
const STATES = ['camera', 'analyzing', 'photo', 'board', 'error'];

const state = {
  current: null,
  consecutiveFailures: 0,
  sideToMove: 'w',
  lastResult: null, // { fen, confidence, minConfidence, corners, orientation, bestMove, eval, lines }

  transition(to, data) {
    if (!STATES.includes(to)) throw new Error(`Unknown state: ${to}`);
    const from = this.current;
    this.current = to;

    // Hide all, show target
    STATES.forEach(s => {
      document.getElementById(`state-${s}`).classList.toggle('active', s === to);
    });

    bus.emit('state:exit', { from, to, data });
    bus.emit('state:enter', { from, to, data });
    bus.emit(`state:${to}`, data);
  }
};

// --- App Init ---
async function init() {
  // Import modules
  const camera = await import('./camera.js');
  const recognition = await import('./recognition.js');
  const engine = await import('./engine.js');
  const board = await import('./board.js');
  const overlay = await import('./overlay.js');

  // Wire up capture button
  document.getElementById('capture-btn').addEventListener('click', async () => {
    const imageData = camera.capture();
    state.transition('analyzing');

    try {
      const result = await recognition.recognize(imageData);

      if (!result || result.confidence < 0.3) {
        state.consecutiveFailures++;
        const msg = state.consecutiveFailures >= 2
          ? 'Try a different angle or improve the lighting.'
          : "Couldn't find a board — try adjusting the angle.";
        state.transition('camera', { error: msg });
        return;
      }

      state.consecutiveFailures = 0;
      const fen = result.fen.split(' ')[0] + ` ${state.sideToMove} ` +
        inferCastling(result.fen.split(' ')[0]) + ' - 0 1';

      const analysis = await engine.analyze(fen, { depth: 15 });
      state.lastResult = { ...result, fen, ...analysis };
      state.transition('photo');
    } catch (err) {
      state.consecutiveFailures++;
      state.transition('camera', { error: 'Something went wrong. Try again.' });
    }
  });

  // Side-to-move toggle
  const toggleBtn = document.getElementById('side-toggle');
  toggleBtn.addEventListener('click', () => {
    state.sideToMove = state.sideToMove === 'w' ? 'b' : 'w';
    toggleBtn.textContent = state.sideToMove === 'w' ? 'White' : 'Black';
    toggleBtn.classList.toggle('black', state.sideToMove === 'b');
  });

  // Navigation buttons
  document.getElementById('new-capture-photo').addEventListener('click', () => state.transition('camera'));
  document.getElementById('new-capture-board').addEventListener('click', () => state.transition('camera'));
  document.getElementById('back-to-photo').addEventListener('click', () => state.transition('photo'));

  // Photo tap → board
  document.getElementById('photo-canvas').addEventListener('click', () => {
    if (state.lastResult) state.transition('board');
  });

  // Analyze deeper
  document.getElementById('analyze-deeper').addEventListener('click', async () => {
    const btn = document.getElementById('analyze-deeper');
    btn.textContent = 'Analyzing...';
    btn.disabled = true;
    try {
      const deep = await engine.analyze(state.lastResult.fen, { depth: 22, multiPV: 3 });
      Object.assign(state.lastResult, deep);
      bus.emit('analysis:updated', state.lastResult);
    } finally {
      btn.textContent = 'Analyze deeper';
      btn.disabled = false;
    }
  });

  // State event handlers
  bus.on('state:camera', (data) => {
    camera.start();
    if (data?.error) showTemporaryMessage(data.error);
  });

  bus.on('state:photo', () => {
    overlay.draw(state.lastResult);
    document.getElementById('fen-display').textContent =
      state.lastResult.fen.split(' ')[0];
  });

  bus.on('state:board', () => {
    board.render(state.lastResult);
  });

  // Start model preload and camera init in parallel
  const captureBtn = document.getElementById('capture-btn');
  captureBtn.textContent = 'Loading models…';

  const modelsReady = Promise.all([recognition.preload(), engine.preload()]).then(() => {
    captureBtn.disabled = false;
    captureBtn.textContent = '';
  }).catch((err) => {
    console.error('Model preload failed:', err);
    captureBtn.textContent = 'Models failed to load';
    showTemporaryMessage(`Load error: ${err.message}`);
  });

  try {
    await camera.init();
    state.transition('camera');
  } catch (err) {
    state.transition('error', {
      message: 'Camera access is required. Please allow camera permissions in your browser settings.'
    });
  }

  await modelsReady;
}

function expandFENRow(row) {
  // Expand run-length encoded FEN row: "4P3" → [null,null,null,null,"P",null,null,null]
  const result = [];
  for (const ch of row) {
    if (ch >= '1' && ch <= '8') {
      for (let i = 0; i < parseInt(ch); i++) result.push(null);
    } else {
      result.push(ch);
    }
  }
  return result;
}

function inferCastling(placement) {
  // If king and rook are on starting squares, grant castling rights
  const rows = placement.split('/').map(expandFENRow);
  let rights = '';
  // White: row index 7 (rank 1) — K at e1 (index 4), R at a1 (0) and h1 (7)
  const rank1 = rows[7] || [];
  if (rank1[4] === 'K') {
    if (rank1[7] === 'R') rights += 'K';
    if (rank1[0] === 'R') rights += 'Q';
  }
  // Black: row index 0 (rank 8) — k at e8 (index 4), r at a8 (0) and h8 (7)
  const rank8 = rows[0] || [];
  if (rank8[4] === 'k') {
    if (rank8[7] === 'r') rights += 'k';
    if (rank8[0] === 'r') rights += 'q';
  }
  return rights || '-';
}

function showTemporaryMessage(text) {
  // Show a brief overlay message on the camera view
  const el = document.createElement('div');
  el.className = 'message tip';
  el.textContent = text;
  el.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10;';
  document.getElementById('state-camera').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

export { bus, state };

init();
