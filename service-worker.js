const CACHE_NAME = 'lecteur-cache-v1';
const SHELL_ASSETS = ['index.html', 'tracks.js', 'manifest.json'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .catch(() => {})
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const isAudio = req.destination === 'audio' || req.url.endsWith('.mp3');
  if (isAudio) {
    event.respondWith(handleRangeableRequest(req));
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(resp => {
        if (resp && resp.ok && req.url.startsWith(self.location.origin)) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return resp;
      }).catch(() => {
        return cached || new Response(
          'Hors-ligne : cette page n\'a pas encore été téléchargée.',
          { status: 503, statusText: 'Service Unavailable', headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
        );
      });
    })
  );
});

// Cache-stored mp3s are full files, but <audio> uses HTTP Range requests to
// seek. This slices the cached blob manually and returns a proper 206
// Partial Content response so seeking still works offline.
async function handleRangeableRequest(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request.url);

  if (!cachedResponse) {
    try {
      return await fetch(request);
    } catch (e) {
      return new Response("Ce titre n'a pas été téléchargé pour l'écoute hors-ligne.", { status: 503 });
    }
  }

  const rangeHeader = request.headers.get('range');
  if (!rangeHeader) return cachedResponse;

  const blob = await cachedResponse.blob();
  const size = blob.size;
  const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
  const start = match && match[1] ? parseInt(match[1], 10) : 0;
  const end = match && match[2] ? parseInt(match[2], 10) : size - 1;
  const chunk = blob.slice(start, end + 1);

  return new Response(chunk, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': blob.type || 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(chunk.size),
      'Accept-Ranges': 'bytes'
    }
  });
}
