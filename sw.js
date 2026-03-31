const CACHE_NAME = 'kibitz-v2';
const MODEL_CACHE = 'kibitz-models-v1';

const APP_SHELL = [
  './',
  'index.html',
  'css/theme.css',
  'js/app.js',
  'js/camera.js',
  'js/recognition.js',
  'js/engine.js',
  'js/board.js',
  'js/overlay.js',
  'js/workers/recognition.worker.js',
  'js/workers/engine.worker.js',
  'vendor/stockfish.js',
  'vendor/stockfish.wasm',
  'vendor/ort.wasm.bundle.min.mjs',
  'vendor/ort-wasm-simd-threaded.mjs',
  'vendor/ort-wasm-simd-threaded.wasm',
];

const MODEL_FILES = [
  'models/board-detect.onnx',
  'models/piece-classify.onnx',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)),
      caches.open(MODEL_CACHE).then(cache => cache.addAll(MODEL_FILES)),
    ])
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME && key !== MODEL_CACHE)
          .map(key => caches.delete(key))
      )
    )
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Models: cache-first (versioned by filename)
  if (url.pathname.includes('/models/')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(MODEL_CACHE).then(cache => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // App shell: stale-while-revalidate
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request).then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
