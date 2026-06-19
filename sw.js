const CACHE = "kotoba-v5";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=5",
  "./app.js?v=5",
  "./supabase-config.js?v=5",
  "./vocab-manifest.json",
  "./manifest.webmanifest",
  "./icon.svg",
  "./vocab/japanese_vocab_001-100_people_family_identity_basics.csv",
  "./vocab/japanese_vocab_101-200_daily_verbs.csv",
  "./vocab/japanese_vocab_201-300_time_days_schedule.csv",
  "./vocab/japanese_vocab_301-400_home_daily_objects.csv",
  "./vocab/japanese_vocab_401-500_food_cooking_eating.csv",
  "./vocab/japanese_vocab_501-600_shopping_money_convenience_store.csv",
  "./vocab/japanese_vocab_601-700_transport_directions_places.csv",
  "./vocab/japanese_vocab_701-800_body_health_feelings.csv",
  "./vocab/japanese_vocab_801-900_conversation_adjectives_descriptions.csv",
  "./vocab/japanese_vocab_901-1000_work_school_admin_phone_emergencies.csv"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && new URL(event.request.url).origin === location.origin) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
