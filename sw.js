// ─────────────────────────────────────────────────────────────────────────────
// Service Worker — ASSET Simulator (PWA offline shell)
// Strategia:
//  - Same-origin (app shell): network-first con fallback cache (codice sempre fresco)
//  - CDN (tailwind, chart.js, librerie): cache-first con aggiornamento in background
//  - API Supabase: MAI cachate (dati sempre live)
// ─────────────────────────────────────────────────────────────────────────────
const CACHE_NAME = 'asset-shell-v1';
const APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './icon.svg',
    './src/main.js',
    './src/excelExport.js',
    './src/db.js',
    './src/worker/simulation.worker.js',
    './supabase_config.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET') return;

    // Dati live: mai intercettare Supabase o PVGIS API
    if (url.hostname.includes('supabase.co') || url.hostname.includes('re.jrc.ec.europa.eu')) return;

    if (url.origin === self.location.origin) {
        // App shell: network-first
        event.respondWith(
            fetch(event.request)
                .then((resp) => {
                    if (resp.ok) {
                        const clone = resp.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    }
                    return resp;
                })
                .catch(() => caches.match(event.request))
        );
    } else {
        // CDN: cache-first (le librerie sono pinnate per versione)
        event.respondWith(
            caches.match(event.request).then((hit) => {
                const fetchPromise = fetch(event.request).then((resp) => {
                    if (resp.ok) {
                        const clone = resp.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    }
                    return resp;
                }).catch(() => hit);
                return hit || fetchPromise;
            })
        );
    }
});
