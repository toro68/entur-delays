export const devSwCleanup = () => {
  if (typeof window === "undefined" || typeof navigator === "undefined") return;
  const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (!isLocal || !("serviceWorker" in navigator)) return;

  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => reg.unregister());
    caches?.keys?.().then((keys) => keys.forEach((key) => caches.delete(key))).catch(() => {});
  }).catch(() => {});
};
