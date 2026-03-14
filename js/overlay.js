export function draw(result) {
  const canvas = document.getElementById('photo-canvas');
  const frozenCanvas = document.getElementById('frozen-frame');

  // Copy frozen frame to photo canvas
  canvas.width = frozenCanvas.width;
  canvas.height = frozenCanvas.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(frozenCanvas, 0, 0);

  if (!result.corners || !result.bestMove) return;

  // Compute 8x8 grid from 4 corners using bilinear interpolation
  const grid = computeGrid(result.corners);

  // Draw best move arrow
  const from = algebraicToIndex(result.bestMove.slice(0, 2));
  const to = algebraicToIndex(result.bestMove.slice(2, 4));

  const fromCenter = gridCenter(grid, from.row, from.col);
  const toCenter = gridCenter(grid, to.row, to.col);

  drawPhotoArrow(ctx, fromCenter, toCenter, '#d4a03c', 0.85, 8);

  // Draw alternative moves (fainter)
  if (result.lines) {
    result.lines.slice(1, 3).forEach(line => {
      if (line.move) {
        const f = algebraicToIndex(line.move.slice(0, 2));
        const t = algebraicToIndex(line.move.slice(2, 4));
        drawPhotoArrow(ctx, gridCenter(grid, f.row, f.col), gridCenter(grid, t.row, t.col), '#d4a03c', 0.35, 5);
      }
    });
  }

  // Update eval bar
  if (result.eval !== null && result.eval !== undefined) {
    updateEvalBar(result.eval);
  }
}

function computeGrid(corners) {
  // corners: [[x,y], [x,y], [x,y], [x,y]]
  // Expected order: top-left, top-right, bottom-right, bottom-left
  const [tl, tr, br, bl] = corners;

  // Bilinear interpolation: for each grid intersection (i,j) where i,j in [0,8]
  const grid = [];
  for (let row = 0; row <= 8; row++) {
    grid[row] = [];
    const t = row / 8;
    for (let col = 0; col <= 8; col++) {
      const s = col / 8;
      // Bilinear interpolation
      const x = (1-t)*(1-s)*tl[0] + (1-t)*s*tr[0] + t*s*br[0] + t*(1-s)*bl[0];
      const y = (1-t)*(1-s)*tl[1] + (1-t)*s*tr[1] + t*s*br[1] + t*(1-s)*bl[1];
      grid[row][col] = [x, y];
    }
  }
  return grid;
}

function gridCenter(grid, row, col) {
  // Center of square (row, col) = average of its 4 corners
  const tl = grid[row][col];
  const tr = grid[row][col + 1];
  const bl = grid[row + 1][col];
  const br = grid[row + 1][col + 1];
  return [
    (tl[0] + tr[0] + bl[0] + br[0]) / 4,
    (tl[1] + tr[1] + bl[1] + br[1]) / 4
  ];
}

function algebraicToIndex(sq) {
  return {
    col: sq.charCodeAt(0) - 97,
    row: 8 - parseInt(sq[1])
  };
}

function drawPhotoArrow(ctx, from, to, color, opacity, width) {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';

  // Arrow body
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const headLen = width * 3;

  ctx.beginPath();
  ctx.moveTo(from[0], from[1]);
  ctx.lineTo(to[0] - headLen * Math.cos(angle), to[1] - headLen * Math.sin(angle));
  ctx.stroke();

  // Arrowhead
  ctx.beginPath();
  ctx.moveTo(to[0], to[1]);
  ctx.lineTo(
    to[0] - headLen * Math.cos(angle - Math.PI / 6),
    to[1] - headLen * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    to[0] - headLen * Math.cos(angle + Math.PI / 6),
    to[1] - headLen * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function updateEvalBar(evalScore) {
  // evalScore is in pawns (e.g., +1.5 means white is ahead by 1.5 pawns)
  // Map to percentage: 0 = black winning, 50 = equal, 100 = white winning
  const clamped = Math.max(-10, Math.min(10, evalScore));
  const pct = 50 + (clamped / 10) * 50; // -10 → 0%, 0 → 50%, +10 → 100%
  const blackPct = 100 - pct;
  document.querySelector('.eval-bar-fill').style.height = `${blackPct}%`;
}
