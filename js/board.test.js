import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseFEN } from './board.js';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const PIECES = 'KQRBNPkqrbnp';

/**
 * Generates a single valid FEN rank string (e.g. "rnbqkbnr", "4P3", "8").
 * The total width of each rank must equal 8.
 */
const fenRankArbitrary = fc.array(
  fc.oneof(
    fc.constantFrom(...PIECES.split('')),
    fc.integer({ min: 1, max: 8 })
  ),
  { minLength: 1, maxLength: 8 }
).filter(tokens => {
  const width = tokens.reduce((sum, t) => sum + (typeof t === 'number' ? t : 1), 0);
  return width === 8;
}).map(tokens => tokens.join(''));

/**
 * Generates a full FEN placement field: 8 ranks joined by "/".
 * Optionally appended with side-to-move and other fields so parseFEN
 * exercises its split(' ')[0] path.
 */
const fenPlacementArbitrary = fc.array(fenRankArbitrary, { minLength: 8, maxLength: 8 })
  .map(ranks => ranks.join('/'));

const fenStringArbitrary = fenPlacementArbitrary.map(
  placement => `${placement} w KQkq - 0 1`
);

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('parseFEN', () => {
  it('returns exactly 8 ranks for any valid FEN', () => {
    fc.assert(
      fc.property(fenStringArbitrary, fen => {
        const board = parseFEN(fen);
        expect(board).toHaveLength(8);
      })
    );
  });

  it('each rank has exactly 8 squares', () => {
    fc.assert(
      fc.property(fenStringArbitrary, fen => {
        const board = parseFEN(fen);
        for (const rank of board) {
          expect(rank).toHaveLength(8);
        }
      })
    );
  });

  it('each square is either null or a valid piece character', () => {
    const validPieces = new Set(PIECES.split(''));
    fc.assert(
      fc.property(fenStringArbitrary, fen => {
        const board = parseFEN(fen);
        for (const rank of board) {
          for (const square of rank) {
            expect(square === null || validPieces.has(square)).toBe(true);
          }
        }
      })
    );
  });

  it('total piece count never exceeds 32', () => {
    fc.assert(
      fc.property(fenStringArbitrary, fen => {
        const board = parseFEN(fen);
        const pieceCount = board.flat().filter(sq => sq !== null).length;
        expect(pieceCount).toBeLessThanOrEqual(32);
      })
    );
  });

  it('ignores extra FEN fields beyond the placement string', () => {
    fc.assert(
      fc.property(fenPlacementArbitrary, placement => {
        const fenWithExtras = `${placement} b - - 5 42`;
        const fenPlacementOnly = placement;
        const boardWithExtras = parseFEN(fenWithExtras);
        const boardPlacementOnly = parseFEN(fenPlacementOnly);
        expect(boardWithExtras).toEqual(boardPlacementOnly);
      })
    );
  });

  it('never throws or returns NaN values on valid input', () => {
    fc.assert(
      fc.property(fenStringArbitrary, fen => {
        expect(() => parseFEN(fen)).not.toThrow();
        const board = parseFEN(fen);
        const flat = board.flat();
        for (const sq of flat) {
          // No square should be NaN or undefined
          expect(sq !== undefined).toBe(true);
          if (typeof sq === 'number') {
            expect(isNaN(sq)).toBe(false);
          }
        }
      })
    );
  });

  // ---------------------------------------------------------------------------
  // Example-based checks for known positions
  // ---------------------------------------------------------------------------

  it('parses the starting position correctly', () => {
    const startFEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const board = parseFEN(startFEN);
    // Rank 8 (board[0]) — black pieces
    expect(board[0]).toEqual(['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r']);
    // Rank 7 (board[1]) — black pawns
    expect(board[1]).toEqual(['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p']);
    // Ranks 6–3 (board[2]–board[5]) — empty
    for (let r = 2; r <= 5; r++) {
      expect(board[r]).toEqual([null, null, null, null, null, null, null, null]);
    }
    // Rank 2 (board[6]) — white pawns
    expect(board[6]).toEqual(['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P']);
    // Rank 1 (board[7]) — white pieces
    expect(board[7]).toEqual(['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']);
  });

  it('parses a position with mixed empty and piece tokens in a rank', () => {
    // "4P3" → [null, null, null, null, 'P', null, null, null]
    const fen = '8/8/8/8/8/8/8/4P3';
    const board = parseFEN(fen);
    expect(board[7]).toEqual([null, null, null, null, 'P', null, null, null]);
  });
});
