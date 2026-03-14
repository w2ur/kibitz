let worker = null;
let ready = false;
let readyPromise = null;

export function preload() {
  if (worker) return readyPromise;

  worker = new Worker('js/workers/recognition.worker.js');

  readyPromise = new Promise((resolve, reject) => {
    const handler = (e) => {
      if (e.data.type === 'ready') {
        ready = true;
        resolve();
      } else if (e.data.type === 'error') {
        reject(new Error(e.data.payload));
      }
    };
    worker.onmessage = handler;
  });

  worker.postMessage({ type: 'init' });
  return readyPromise;
}

export async function recognize(imageData) {
  if (!ready) await preload();

  return new Promise((resolve, reject) => {
    const handler = (e) => {
      worker.onmessage = null;
      if (e.data.type === 'result') {
        resolve(e.data.payload);
      } else if (e.data.type === 'error') {
        reject(new Error(e.data.payload));
      }
    };
    worker.onmessage = handler;

    // Transfer the raw pixel data to the worker
    // Copy the data first, then transfer the copy's buffer
    const copy = new Uint8Array(imageData.data);
    worker.postMessage({
      type: 'recognize',
      payload: {
        imageData: copy,
        width: imageData.width,
        height: imageData.height,
      }
    }, [copy.buffer]);
  });
}
