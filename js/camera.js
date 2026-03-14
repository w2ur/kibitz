let videoEl = null;
let stream = null;

export async function init() {
  videoEl = document.getElementById('camera-feed');

  stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: 'environment',
      width: { ideal: 1280 },
      height: { ideal: 960 }
    },
    audio: false
  });

  videoEl.srcObject = stream;
  await videoEl.play();
}

export function start() {
  if (videoEl && stream) {
    videoEl.play();
  }
}

export function stop() {
  if (videoEl) {
    videoEl.pause();
  }
}

export function capture() {
  if (!videoEl) throw new Error('Camera not initialized');

  const canvas = document.createElement('canvas');
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoEl, 0, 0);

  // Also draw to the frozen frame canvas for the ANALYZING state
  const frozenCanvas = document.getElementById('frozen-frame');
  frozenCanvas.width = canvas.width;
  frozenCanvas.height = canvas.height;
  frozenCanvas.getContext('2d').drawImage(canvas, 0, 0);

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
