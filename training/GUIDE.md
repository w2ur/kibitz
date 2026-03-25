# Kibitz ML Pipeline — Step-by-Step Guide

Everything runs locally on your Mac (M2). No cloud needed.

## Prerequisites

- macOS with Apple Silicon (M2)
- ~5 GB free disk space
- Blender (latest version, installed in Step 1)
- Python 3.11+ (already on your Mac)

---

## Phase 1: Synthetic Data Generation

### Step 1: Install Blender

1. Download the **latest Blender** from https://www.blender.org/download/ (macOS Apple Silicon)
2. Drag to `/Applications`
3. Open it once to clear the macOS Gatekeeper warning, then close it

### Step 2: Install python-chess in Blender's Python

Our `generate.py` imports `chess` to create random legal positions. Blender ships its own Python, so the package must be installed there.

```bash
# Find Blender's Python
find /Applications/Blender.app -name "python3" -type f

# It will be something like:
# /Applications/Blender.app/Contents/Resources/4.2/python/bin/python3
# Use that path below (adjust the version number):

/Applications/Blender.app/Contents/Resources/4.2/python/bin/python3 -m pip install python-chess
```

### Step 3: Test run (10 images)

```bash
cd ~/Dev/kibitz

/Applications/Blender.app/Contents/MacOS/Blender \
  --background \
  --python training/blender/generate.py \
  -- --count 10 --output training/data/synthetic/
```

Expected time: ~30-60 seconds.

Verify the output:

```bash
# Check images were generated
ls training/data/synthetic/images/

# Open one to verify it looks like a chess board
open training/data/synthetic/images/000000.png

# Check a label file
cat training/data/synthetic/labels/000000.json | python3 -m json.tool
```

You should see:
- A 640x640 image of a chess board from a random angle
- Pieces are simplified shapes (cylinders, cubes, spheres) — this is expected for v1
- The JSON label contains `corners` (4 board corners in pixel coords), `fen`, `squares` (64 square bounding boxes), and `params`

**If something fails**, common issues:
- `ModuleNotFoundError: No module named 'chess'` → Step 2 didn't work, check the Python path
- Blender crashes → try reducing resolution: add `--resolution 320` to the command
- Black images → Cycles GPU issue, add `-- --count 10 --output training/data/synthetic/` (note the `--` separator)

### Step 4: Generate the full dataset

Once the test run looks good, generate 5,000 images (start smaller than the 30,000 in the plan — iterate first):

```bash
/Applications/Blender.app/Contents/MacOS/Blender \
  --background \
  --python training/blender/generate.py \
  -- --count 5000 --output training/data/synthetic/ --seed 42
```

**Expected time:** 2-7 hours on M2 (Cycles rendering at 64 samples). Run overnight.

**Disk space:** ~2-4 GB for 5,000 images.

The script prints progress every 100 images. You can safely Ctrl+C and resume later by changing `--count` and `--seed` (the script overwrites existing files based on index, so start from where you left off isn't built in — but partial datasets are fine for training).

---

## Phase 2: Training

Training runs locally using PyTorch with MPS (Apple's Metal GPU acceleration). The models are small enough for your 8 GB RAM.

### Step 5: Set up the Python environment

```bash
cd ~/Dev/kibitz/training
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Verify MPS is available:

```bash
python3 -c "import torch; print('MPS available:', torch.backends.mps.is_available())"
```

Should print `MPS available: True`.

### Step 6: Train the board detector

Open the training notebook:

```bash
source .venv/bin/activate
pip install jupyter
jupyter notebook train.ipynb
```

The notebook (created alongside this guide) walks through each training step with explanations. Follow it cell by cell.

Or run directly from the command line:

```bash
# Train YOLOv8n-pose for board corner detection
python train_detector.py \
  --data data/synthetic/ \
  --epochs 100 \
  --output runs/detector
```

**Expected time:** 30-90 minutes on M2 (depends on dataset size).

**What to watch:** The training prints metrics each epoch. Look for:
- `pose/mAP50` — keypoint detection accuracy. Should climb above 0.7.
- If it plateaus early (<0.5), the data might be too uniform. Try regenerating with a different seed.

### Step 7: Train the piece classifier

```bash
python train_classifier.py \
  --data data/synthetic/ \
  --epochs 50 \
  --output runs/classifier
```

**Expected time:** 20-60 minutes on M2.

**What to watch:**
- `val_acc` — per-square classification accuracy. Should reach >90% on synthetic data.
- The 13 classes are: empty, wP, wR, wN, wB, wQ, wK, bP, bR, bN, bB, bQ, bK.

### Step 8: Export to ONNX

```bash
python export_onnx.py \
  --detector runs/detector/train/weights/best.pt \
  --classifier runs/classifier/best.pt \
  --output ../models/
```

Check the output:

```bash
ls -lh ../models/
```

Expected:
- `board-detect.onnx` — ~6 MB
- `piece-classify.onnx` — ~4 MB

---

## Phase 3: Deploy

### Step 9: Commit and push the models

```bash
cd ~/Dev/kibitz
git add models/board-detect.onnx models/piece-classify.onnx
git commit -m "feat: add trained ONNX models (v1, synthetic data)"
git push
```

The app at https://w2ur.github.io/kibitz/ will now use real recognition.

### Step 10: Test on your phone

1. Open https://w2ur.github.io/kibitz/ on your phone
2. Allow camera access
3. Point at a chess board and tap capture
4. The app should detect the board and show the best move

---

## What to expect

**First model accuracy on real photos will be limited.** The simplified geometric pieces don't look like real Staunton pieces. This is the expected improvement path:

| Iteration | Change | Expected accuracy |
|-----------|--------|-------------------|
| v1 (now) | Geometric shapes, synthetic only | ~40-60% per-square |
| v1.1 | Replace with Staunton 3D models | ~70-85% per-square |
| v1.2 | Fine-tune on ChessReD real photos | ~85-95% per-square |
| v2 | Calibration flow (starting position) | Near-perfect on calibrated boards |

Each step is incremental. Get v1 working end-to-end first, then iterate.

---

## Troubleshooting

### Blender renders are all black
Cycles may not find the GPU. Try adding to the generate.py command:
```bash
-- --count 10 --output training/data/synthetic/
```
Or switch to EEVEE by editing `generate.py`: change `scene.render.engine = 'CYCLES'` to `scene.render.engine = 'BLENDER_EEVEE_NEXT'`. Faster but lower quality — fine for training data.

### Training is very slow
- Verify MPS is being used: the script should print `Using device: mps`
- If it says `cpu`, check your PyTorch version: `pip install --upgrade torch torchvision`
- Reduce batch size if you get memory errors: edit the script to use `batch=8` instead of `batch=16`

### ONNX export fails
- Make sure you trained successfully first (check that `best.pt` files exist)
- Try with `opset_version=13` instead of `17` if you get opset errors

### App doesn't load models
- Check browser console for errors (F12 → Console)
- Verify the model files are actually committed (not just gitignored)
- Hard refresh: Ctrl+Shift+R to bypass service worker cache
