const SERVICE_WORKER_URL = '/classroompath-sw.js';

export async function registerClassroomPathServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
    return null;
  }

  return navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: '/' });
}
