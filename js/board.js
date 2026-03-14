const PIECE_MAP = {
  'K': 'wK', 'Q': 'wQ', 'R': 'wR', 'B': 'wB', 'N': 'wN', 'P': 'wP',
  'k': 'bK', 'q': 'bQ', 'r': 'bR', 'b': 'bB', 'n': 'bN', 'p': 'bP'
};

const SQUARE_SIZE = 50; // Will be scaled via viewBox
const BOARD_SIZE = SQUARE_SIZE * 8;

let svgEl = null;
let arrowLayer = null;
let pieceCache = {};

export function parseFEN(fen) {
  const placement = fen.split(' ')[0];
  const board = [];
  for (const row of placement.split('/')) {
    const rank = [];
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') {
        for (let i = 0; i < parseInt(ch); i++) rank.push(null);
      } else {
        rank.push(ch);
      }
    }
    board.push(rank);
  }
  return board; // board[0] = rank 8, board[7] = rank 1
}

async function loadPieceSVG(name) {
  if (pieceCache[name]) return pieceCache[name];
  const resp = await fetch(`assets/pieces/${name}.svg`);
  const text = await resp.text();
  pieceCache[name] = text;
  return text;
}

export async function preloadPieces() {
  const names = Object.values(PIECE_MAP);
  await Promise.all(names.map(n => loadPieceSVG(n)));
}

export function render(result) {
  const container = document.getElementById('board-container');
  container.innerHTML = '';

  const board = parseFEN(result.fen);

  // Create SVG
  svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgEl.setAttribute('viewBox', `0 0 ${BOARD_SIZE} ${BOARD_SIZE}`);
  svgEl.style.width = '100%';
  svgEl.style.maxWidth = `${BOARD_SIZE}px`;
  svgEl.style.aspectRatio = '1';

  // Draw squares
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const isLight = (row + col) % 2 === 0;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', col * SQUARE_SIZE);
      rect.setAttribute('y', row * SQUARE_SIZE);
      rect.setAttribute('width', SQUARE_SIZE);
      rect.setAttribute('height', SQUARE_SIZE);
      rect.setAttribute('fill', isLight ? '#f5f0e8' : '#3d5a3d');
      svgEl.appendChild(rect);
    }
  }

  // Arrow layer (behind pieces for best-move, or above — we'll put it between)
  arrowLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  arrowLayer.setAttribute('id', 'arrow-layer');
  svgEl.appendChild(arrowLayer);

  // Draw pieces
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (!piece) continue;
      const name = PIECE_MAP[piece];
      if (!name) continue;

      const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
      img.setAttribute('href', `assets/pieces/${name}.svg`);
      img.setAttribute('x', col * SQUARE_SIZE);
      img.setAttribute('y', row * SQUARE_SIZE);
      img.setAttribute('width', SQUARE_SIZE);
      img.setAttribute('height', SQUARE_SIZE);
      svgEl.appendChild(img);
    }
  }

  container.appendChild(svgEl);

  // Draw arrows if analysis is available
  if (result.bestMove) {
    drawBoardArrows(result);
  }
}

function squareToCoords(sq) {
  // "e4" → { col: 4, row: 4 } (row 0 = rank 8)
  const col = sq.charCodeAt(0) - 97; // 'a' = 0
  const row = 8 - parseInt(sq[1]);   // '8' = 0, '1' = 7
  return { col, row };
}

function squareCenter(sq) {
  const { col, row } = squareToCoords(sq);
  return {
    x: col * SQUARE_SIZE + SQUARE_SIZE / 2,
    y: row * SQUARE_SIZE + SQUARE_SIZE / 2
  };
}

export function drawBoardArrows(result) {
  if (!arrowLayer) return;
  arrowLayer.innerHTML = '';

  // Define arrowhead marker
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  marker.setAttribute('id', 'arrowhead');
  marker.setAttribute('markerWidth', '10');
  marker.setAttribute('markerHeight', '7');
  marker.setAttribute('refX', '10');
  marker.setAttribute('refY', '3.5');
  marker.setAttribute('orient', 'auto');
  const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  polygon.setAttribute('points', '0 0, 10 3.5, 0 7');
  polygon.setAttribute('fill', '#d4a03c');
  marker.appendChild(polygon);
  defs.appendChild(marker);
  arrowLayer.appendChild(defs);

  // Best move — bold gold arrow
  if (result.bestMove) {
    const from = result.bestMove.slice(0, 2);
    const to = result.bestMove.slice(2, 4);
    drawArrow(from, to, '#d4a03c', 0.7, 6);
  }

  // Alternative moves — fainter arrows
  if (result.lines) {
    result.lines.slice(1, 3).forEach(line => {
      if (line.move) {
        const from = line.move.slice(0, 2);
        const to = line.move.slice(2, 4);
        drawArrow(from, to, '#d4a03c', 0.3, 4);
      }
    });
  }
}

function drawArrow(from, to, color, opacity, width) {
  const start = squareCenter(from);
  const end = squareCenter(to);
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', start.x);
  line.setAttribute('y1', start.y);
  line.setAttribute('x2', end.x);
  line.setAttribute('y2', end.y);
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', width);
  line.setAttribute('stroke-opacity', opacity);
  line.setAttribute('marker-end', 'url(#arrowhead)');
  line.setAttribute('stroke-linecap', 'round');
  arrowLayer.appendChild(line);
}

// Move playthrough — animate a sequence of moves
export function playLine(fen, moves) {
  const board = parseFEN(fen);
  let currentFen = fen;

  const steps = moves.map((move, i) => ({
    move,
    delay: i * 800
  }));

  steps.forEach(({ move, delay }) => {
    setTimeout(() => {
      // Simplified: just re-render with updated FEN
      // A full implementation would animate the piece sliding
      const from = squareToCoords(move.slice(0, 2));
      const to = squareToCoords(move.slice(2, 4));
      board[to.row][to.col] = board[from.row][from.col];
      board[from.row][from.col] = null;
      // Re-render would go here — for now just highlight
      highlightSquare(move.slice(2, 4));
    }, delay);
  });
}

function highlightSquare(sq) {
  const { col, row } = squareToCoords(sq);
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', col * SQUARE_SIZE);
  rect.setAttribute('y', row * SQUARE_SIZE);
  rect.setAttribute('width', SQUARE_SIZE);
  rect.setAttribute('height', SQUARE_SIZE);
  rect.setAttribute('fill', '#d4a03c');
  rect.setAttribute('opacity', '0.4');
  arrowLayer.appendChild(rect);
}
