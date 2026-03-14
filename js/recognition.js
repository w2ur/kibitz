// Recognition module — mock implementation for development
// Will be replaced with ONNX Runtime Web inference in Task 19

let preloaded = false;

export function preload() {
  // In the real implementation, this loads ONNX models
  preloaded = true;
  return Promise.resolve();
}

export async function recognize(imageData) {
  // Mock: return the starting position with simulated corners
  // In production, this calls the recognition worker
  await simulateDelay(800);

  const width = imageData.width;
  const height = imageData.height;

  // Fake corners — centered in the image with some margin
  const margin = Math.min(width, height) * 0.15;
  const corners = [
    [margin, margin],                        // top-left
    [width - margin, margin],                // top-right
    [width - margin, height - margin],       // bottom-right
    [margin, height - margin]                // bottom-left
  ];

  return {
    fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR',
    confidence: 0.92,
    minConfidence: 0.78,
    corners,
    orientation: 'white'
  };
}

function simulateDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
