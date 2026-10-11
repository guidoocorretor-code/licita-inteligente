// Service worker: cache da "casca" do app para funcionar como PWA instalável.
// Dados da API NUNCA são servidos do cache (evita exibir informação desatualizada como atual).
const CACHE = 'licita-v32';
const CASCA = ['/', '/index.html', '/css/app.css', '/js/app.js', '/js/api.js', '/js/ui.js', '/js/paginas.js', '/js/empresas.js', '/js/painel.js', '/js/fornecedores.js', '/js/tributos.js', '/manifest.webmanifest', '/icons/icon.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCA))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // API e links públicos de cotação (com token) nunca vão para o cache
  if (e.request.method !== 'GET' || /^\/(api|publico|cotar)\//.test(url.pathname)) return;
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((k) => k.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))));
});
