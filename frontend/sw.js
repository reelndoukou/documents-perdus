// Service worker minimal : il rend le site installable sur l'écran d'accueil.
// Il ne met RIEN en cache (paiements et données toujours à jour) et laisse
// le navigateur gérer toutes les requêtes réseau normalement.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
