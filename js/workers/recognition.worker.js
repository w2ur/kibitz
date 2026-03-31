// Recognition Web Worker
// Runs ONNX models for board detection and piece classification

importScripts('../../vendor/ort.min.js');

let detectorSession = null;
let classifierSession = null;

const CLASS_NAMES = [
  'empty', 'wP', 'wR', 'wN', 'wB', 'wQ', 'wK',
  'bP', 'bR', 'bN', 'bB', 'bQ', 'bK'
];

const FEN_MAP = {
  empty: null, wP: 'P', wR: 'R', wN: 'N', wB: 'B', wQ: 'Q', wK: 'K',
  bP: 'p', bR: 'r', bN: 'n', bB: 'b', bQ: 'q', bK: 'k',
};

self.onmessage = async function(e) {
  const { type, payload } = e.data;

  if (type === 'init') {
    try {
      // Configure ONNX Runtime
      ort.env.wasm.wasmPaths = '../../vendor/';
      // Single-threaded: avoids SharedArrayBuffer requirement
      // (GitHub Pages can't set COOP/COEP headers)
      ort.env.wasm.numThreads = 1;

      const providers = ['wasm'];

      detectorSession = await ort.InferenceSession.create(
        '../../models/board-detect.onnx',
        { executionProviders: providers }
      );

      classifierSession = await ort.InferenceSession.create(
        '../../models/piece-classify.onnx',
        { executionProviders: providers }
      );

      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', payload: err.message });
    }
  }

  if (type === 'recognize') {
    try {
      const { imageData, width, height } = payload;
      const result = await runPipeline(imageData, width, height);
      self.postMessage({ type: 'result', payload: result });
    } catch (err) {
      self.postMessage({ type: 'error', payload: err.message });
    }
  }
};

async function runPipeline(imageData, width, height) {
  // Step 1: Preprocess for detector (resize to 640x640)
  const detectorInput = await preprocessForDetector(imageData, width, height);

  // Step 2: Run board detection
  const detectorOutput = await detectorSession.run({ images: detectorInput });
  const corners = parseDetectorOutput(detectorOutput, width, height);

  if (!corners) {
    return { error: 'no_board' };
  }

  // Step 3: Perspective transform + crop 64 squares
  const crops = extractSquareCrops(imageData, width, height, corners);

  // Step 4: Batch classify
  const classifierInput = new ort.Tensor('float32', crops.data, [64, 3, 64, 64]);
  const classifierOutput = await classifierSession.run({ input: classifierInput });
  const logits = classifierOutput.output.data;

  // Step 5: Parse results
  const predictions = [];
  const confidences = [];
  for (let i = 0; i < 64; i++) {
    const squareLogits = logits.slice(i * 13, (i + 1) * 13);
    const probs = softmax(squareLogits);
    const maxIdx = probs.indexOf(Math.max(...probs));
    predictions.push(CLASS_NAMES[maxIdx]);
    confidences.push(probs[maxIdx]);
  }

  // Step 6: Build FEN
  const fen = predictionsToFEN(predictions);
  const avgConf = confidences.reduce((a, b) => a + b, 0) / 64;
  const minConf = Math.min(...confidences);

  // Step 7: Infer orientation and adjust FEN rank ordering if needed
  const orientation = inferOrientation(predictions);

  // If black is closest to camera, the image rows are reversed relative to
  // standard FEN (which starts from rank 8). Reverse the FEN rows.
  const finalFen = orientation === 'black'
    ? fen.split('/').reverse().join('/')
    : fen;

  return { fen: finalFen, confidence: avgConf, minConfidence: minConf, corners, orientation };
}

async function preprocessForDetector(imageData, width, height) {
  // Resize to 640x640 and normalize to [0, 1]
  const imgData = new ImageData(new Uint8ClampedArray(imageData), width, height);
  const bitmap = await createImageBitmap(imgData);

  const canvas = new OffscreenCanvas(640, 640);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, 640, 640);
  bitmap.close();
  const resized = ctx.getImageData(0, 0, 640, 640);

  // Convert to CHW float32 [1, 3, 640, 640]
  const float32 = new Float32Array(3 * 640 * 640);
  for (let i = 0; i < 640 * 640; i++) {
    float32[i] = resized.data[i * 4] / 255;                       // R
    float32[640 * 640 + i] = resized.data[i * 4 + 1] / 255;       // G
    float32[2 * 640 * 640 + i] = resized.data[i * 4 + 2] / 255;   // B
  }

  return new ort.Tensor('float32', float32, [1, 3, 640, 640]);
}

function parseDetectorOutput(output, origWidth, origHeight) {
  // YOLOv8n-pose output: tensor of shape [1, 13, num_predictions]
  // 13 = 4 (bbox: cx, cy, w, h) + 1 (confidence) + 4*2 (4 keypoints, x,y each)
  // All coordinates are in 640x640 input space — scale to original image size.
  //
  // NOTE: The exact output tensor shape depends on the YOLO export.
  // After exporting the model (Task 13), verify the output shape with:
  //   const output = await detectorSession.run({images: input});
  //   console.log(Object.keys(output), output[Object.keys(output)[0]].dims);
  // Then adapt this parser. The logic below assumes the standard ultralytics
  // pose export format.

  const data = output[Object.keys(output)[0]].data;
  const dims = output[Object.keys(output)[0]].dims;

  // Find the detection with highest confidence
  const numPreds = dims[2];
  let bestConf = 0;
  let bestIdx = -1;

  for (let i = 0; i < numPreds; i++) {
    const conf = data[4 * numPreds + i]; // confidence row
    if (conf > bestConf) {
      bestConf = conf;
      bestIdx = i;
    }
  }

  if (bestConf < 0.5 || bestIdx === -1) return null;

  // Extract 4 keypoints (corners)
  const scaleX = origWidth / 640;
  const scaleY = origHeight / 640;
  const corners = [];

  for (let k = 0; k < 4; k++) {
    const kpX = data[(5 + k * 2) * numPreds + bestIdx] * scaleX;
    const kpY = data[(6 + k * 2) * numPreds + bestIdx] * scaleY;
    corners.push([kpX, kpY]);
  }

  return corners; // [[x,y], [x,y], [x,y], [x,y]]
}

function extractSquareCrops(imageData, width, height, corners) {
  // Bilinear interpolation to get flat board, then slice into 64 crops
  // Each crop is 64x64, normalized with ImageNet stats
  // Returns Float32Array of shape [64, 3, 64, 64]

  const CROP = 64;
  const BOARD = CROP * 8;
  const result = new Float32Array(64 * 3 * CROP * CROP);

  // Compute perspective transform matrix from corners
  // Using a simple bilinear interpolation approach
  const [tl, tr, br, bl] = corners;

  for (let sq = 0; sq < 64; sq++) {
    const row = Math.floor(sq / 8);
    const col = sq % 8;

    for (let py = 0; py < CROP; py++) {
      for (let px = 0; px < CROP; px++) {
        // Map crop pixel to board space
        const bx = (col * CROP + px) / BOARD;
        const by = (row * CROP + py) / BOARD;

        // Bilinear interpolation to original image space
        const imgX = (1-by)*(1-bx)*tl[0] + (1-by)*bx*tr[0] + by*bx*br[0] + by*(1-bx)*bl[0];
        const imgY = (1-by)*(1-bx)*tl[1] + (1-by)*bx*tr[1] + by*bx*br[1] + by*(1-bx)*bl[1];

        // Sample pixel from original image (nearest neighbor)
        const ix = Math.round(imgX);
        const iy = Math.round(imgY);

        if (ix >= 0 && ix < width && iy >= 0 && iy < height) {
          const srcIdx = (iy * width + ix) * 4;
          const r = imageData[srcIdx] / 255;
          const g = imageData[srcIdx + 1] / 255;
          const b = imageData[srcIdx + 2] / 255;

          // ImageNet normalization
          const offset = sq * 3 * CROP * CROP;
          result[offset + py * CROP + px] = (r - 0.485) / 0.229;
          result[offset + CROP * CROP + py * CROP + px] = (g - 0.456) / 0.224;
          result[offset + 2 * CROP * CROP + py * CROP + px] = (b - 0.406) / 0.225;
        }
      }
    }
  }

  return { data: result };
}

function predictionsToFEN(predictions) {
  const rows = [];
  for (let row = 0; row < 8; row++) {
    let fenRow = '';
    let emptyCount = 0;
    for (let col = 0; col < 8; col++) {
      const piece = FEN_MAP[predictions[row * 8 + col]];
      if (piece === null) {
        emptyCount++;
      } else {
        if (emptyCount > 0) { fenRow += emptyCount; emptyCount = 0; }
        fenRow += piece;
      }
    }
    if (emptyCount > 0) fenRow += emptyCount;
    rows.push(fenRow);
  }
  return rows.join('/');
}

function inferOrientation(predictions) {
  // Count pawns in bottom 2 rows vs top 2 rows
  let whitePawnsBottom = 0, blackPawnsBottom = 0;
  let whitePawnsTop = 0, blackPawnsTop = 0;

  for (let col = 0; col < 8; col++) {
    // Bottom rows (6, 7)
    for (const row of [6, 7]) {
      const pred = predictions[row * 8 + col];
      if (pred === 'wP') whitePawnsBottom++;
      if (pred === 'bP') blackPawnsBottom++;
    }
    // Top rows (0, 1)
    for (const row of [0, 1]) {
      const pred = predictions[row * 8 + col];
      if (pred === 'wP') whitePawnsTop++;
      if (pred === 'bP') blackPawnsTop++;
    }
  }

  // If more white pawns near bottom, white is closest to camera
  return whitePawnsBottom >= blackPawnsTop ? 'white' : 'black';
}

function softmax(arr) {
  const max = Math.max(...arr);
  const exps = arr.map(x => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(x => x / sum);
}
