# Kibitz

> Your phone sees the board. You see the best move.

Kibitz is a chess position recognition app that runs entirely in your browser. Point your phone camera at a chessboard, tap to capture, and see the best move overlaid as arrows on the photo. Flip to an interactive digital board to explore the engine's suggested line move by move.

The name comes from the chess term *kibitz* — an onlooker who offers unsolicited advice. That's literally what this app does.

## How it works

1. **Point** your phone at a chessboard
2. **Tap** to capture
3. **See** the best move as gold arrows overlaid on your photo
4. **Flip** to an interactive board to explore the engine's line

## Tech stack

- **Recognition:** Custom-trained YOLOv8n-pose (board corner detection) + MobileNetV3-Small (piece classification), running client-side via ONNX Runtime Web
- **Engine:** Stockfish WASM — the world's strongest open-source chess engine, compiled to WebAssembly
- **App:** Vanilla JavaScript, no framework, no server
- **Training data:** 30,000+ synthetic renders generated with Blender, fine-tuned on real-world photos

## Run locally

```bash
npx serve .
# Open http://localhost:3000 in your browser
# Camera requires a secure context — localhost qualifies
```

No build step. No dependencies to install for the app itself.

## ML training pipeline

```bash
cd training
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Generate synthetic training data (requires Blender)
blender --background --python blender/generate.py -- --count 30000 --output data/synthetic/

# Train board detector
python train_detector.py --data data/synthetic/ --epochs 100

# Train piece classifier
python train_classifier.py --data data/synthetic/ --epochs 50

# Export to ONNX
python export_onnx.py --detector runs/detector/train/weights/best.pt --classifier runs/classifier/best.pt --output ../models/
```

## Status

🚧 In development.

---

Made with care by [William](https://william.revah.paris)
