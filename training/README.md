# Kibitz Training Pipeline

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Blender 4.x must be installed separately.

## Pipeline

1. **Generate synthetic data:** `blender --background --python blender/generate.py -- --count 30000 --output data/synthetic/`
2. **Train board detector:** `python train_detector.py --data data/synthetic/ --epochs 100`
3. **Train piece classifier:** `python train_classifier.py --data data/synthetic/ --epochs 50`
4. **Export to ONNX:** `python export_onnx.py --detector runs/detector/best.pt --classifier runs/classifier/best.pt --output ../models/`
5. **Evaluate:** `python evaluate.py --models ../models/ --data data/chessred/`

## Data

- `data/synthetic/` — Blender-generated training images (gitignored)
- `data/chessred/` — ChessReD real-world evaluation set (download separately, gitignored)
