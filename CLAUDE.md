# Kibitz

## Project Overview

Chess position recognition PWA. Point your phone camera at a chessboard, tap to capture, and see the best move overlaid on the photo as arrows. Flip to an interactive digital board to explore the engine's suggested line move by move. Audience: casual players wanting a quick hint, with show-off demo appeal.

## Tech Stack

- **App:** Vanilla JS, no framework, no build step
- **ML Training:** Python 3.11+, Blender (latest version), Ultralytics (YOLOv8), PyTorch, timm (MobileNetV3)
- **Browser Inference:** ONNX Runtime Web (WebGPU primary, WASM fallback)
- **Chess Engine:** Stockfish WASM (single-threaded build)
- **Deployment:** GitHub Pages

## User-Facing Language

English.

## Development

### App (Vanilla JS)

No build step. Open `index.html` in a browser, or use any static server:

```bash
npx serve .
```

Camera access requires HTTPS. For local development, `npx serve` works on localhost (treated as secure context by browsers).

### ML Pipeline (Python)

```bash
cd training
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Blender 4.x must be installed separately. The data generation script runs via Blender's Python:

```bash
blender --background --python blender/generate.py -- --count 30000 --output data/synthetic/
```

## Project Structure

- `js/` — App modules (state machine, camera, board, engine, overlay, recognition)
- `js/workers/` — Web Workers for ONNX inference and Stockfish
- `css/` — Club Green theme (fixed palette, no dark/light mode)
- `models/` — ONNX model files committed directly (~10MB total, no Git LFS)
- `assets/pieces/` — SVG chess piece images (CBurnett set, public domain)
- `training/` — Python ML pipeline (not deployed to GitHub Pages)
- `vendor/` — Third-party JS/WASM files (Stockfish, ONNX Runtime Web)

## Testing

- **App:** Manual browser testing (vanilla JS, no test framework in v1)
- **ML Pipeline:** pytest for data pipeline and evaluation scripts

## Dark/Light Mode

Opted out. Fixed "Club Green" palette inspired by chess club vinyl boards:
- Background: `#2c2c2c`
- Light squares: `#f5f0e8` (cream)
- Dark squares: `#3d5a3d` (deep green)
- Accent: `#d4a03c` (gold, used for arrows)

Justification: the artistic direction requires a fixed chess-themed palette.

## Deployment

GitHub Pages from `main` branch at `https://w2ur.github.io/kibitz/`. Models committed directly (no Git LFS — GitHub Pages serves LFS pointer files, not actual blobs). No custom HTTP headers available, so Stockfish runs single-threaded (SharedArrayBuffer unavailable).

## Project-Specific Rules

- Models (`.onnx` files in `models/`) are committed directly — do NOT use Git LFS.
- The `training/` directory is never deployed — GitHub Pages serves only app files.
- The `recognize()` interface in `js/recognition.js` is the contract between ML and app. Do not bypass it.
- Implementation plan: `~/.claude/plans/2026-03-13-kibitz-implementation.md`
- Design spec: `~/.claude/plans/2026-03-13-kibitz-design.md`
