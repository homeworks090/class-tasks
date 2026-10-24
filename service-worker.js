const CACHE_NAME = "class-tasks-v3";
const APP_SHELL = [
  "./index.html",
  "./game.html",
  "./craft/index.html",
  "./craft/style.css",
  "./craft/world.js",
  "./craft/player.js",
  "./craft/enemies.js",
  "./craft/ui.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => Promise.all(
        cacheNames
          .filter(cacheName => cacheName !== CACHE_NAME)
          .map(cacheName => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const requestUrl = new URL(request.url);
  if (request.method !== "GET" || requestUrl.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const responseCopy = response.clone();
            return caches.open(CACHE_NAME)
              .then(cache => cache.put(request, responseCopy))
              .then(() => response)
              .catch(error => {
                console.error("تعذر تحديث الصفحة المخزنة:", error);
                return response;
              });
          }
          return response;
        })
        .catch(async () => {
          const cachedPage = await caches.match(request);
          if (cachedPage) return cachedPage;
          const appShellPage = await caches.match("./index.html");
          if (appShellPage) return appShellPage;
          return Response.error();
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cachedResponse => cachedResponse || fetch(request))
  );
});
