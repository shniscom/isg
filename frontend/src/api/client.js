import axios from 'axios';

const baseURL = import.meta.env.VITE_API_URL || '/api';

const apiClient = axios.create({ baseURL });

let currentToken = null;
let onUnauthorized = null;

export function setAuthToken(token) {
  currentToken = token;
}

export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

apiClient.interceptors.request.use((config) => {
  if (currentToken) {
    config.headers.Authorization = `Bearer ${currentToken}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && onUnauthorized) {
      onUnauthorized();
    }
    return Promise.reject(error);
  }
);

/** Axios hatasından kullanıcıya gösterilecek okunabilir mesajı çıkarır. */
export function getErrorMessage(error) {
  const apiMessage = error?.response?.data?.error?.message;
  if (apiMessage) return apiMessage;
  if (error?.message === 'Network Error') return 'Sunucuya bağlanılamıyor. İnternet bağlantınızı kontrol edin.';
  return 'Beklenmeyen bir hata oluştu.';
}

export default apiClient;
