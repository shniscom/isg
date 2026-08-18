import apiClient from '../api/client';

/** VAPID public key'i (base64url) Web Push API'nin beklediği Uint8Array formatına çevirir. */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/**
 * Kullanıcı giriş yaptıktan sonra çağrılır: tarayıcıdan bildirim izni ister, izin verilirse
 * push subscription oluşturur (veya var olanı kullanır) ve backend'e kaydeder.
 * İzin reddedilirse veya tarayıcı desteklemiyorsa sessizce hiçbir şey yapmaz.
 */
export async function ensurePushSubscription() {
  if (!isPushSupported()) return;

  try {
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (permission !== 'granted') return;

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      const { data } = await apiClient.get('/push/vapid-public-key');
      if (!data.publicKey) return; // Sunucuda VAPID anahtarları tanımlı değil.
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.publicKey),
      });
    }

    const json = subscription.toJSON();
    await apiClient.post('/push/subscribe', { endpoint: json.endpoint, keys: json.keys });
  } catch (err) {
    // Push kaydı opsiyonel bir gelişmedir; başarısız olması uygulamanın geri kalanını etkilememeli.
    console.warn('Push bildirim kaydı yapılamadı:', err);
  }
}

/** Çıkış yapılırken subscription'ı hem tarayıcıdan hem backend'den kaldırır. */
export async function clearPushSubscription() {
  if (!isPushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await apiClient.post('/push/unsubscribe', { endpoint }).catch(() => {});
  } catch (err) {
    console.warn('Push subscription temizlenemedi:', err);
  }
}

/**
 * Service worker'dan gelen "bildirime tıklandı" mesajını dinler ve verilen navigate
 * fonksiyonuyla (react-router) ilgili sayfaya yönlendirir. App içinde bir kez kurulur.
 */
export function listenForPushNavigation(navigate) {
  if (!('serviceWorker' in navigator)) return () => {};
  const handler = (event) => {
    if (event.data?.type === 'NAVIGATE' && event.data.url) {
      navigate(event.data.url);
    }
  };
  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
}
