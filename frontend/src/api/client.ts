import axios from "axios";

function resolveApiBaseUrl(): string {
  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  if (!raw) return "/api/v1";
  const noTrailing = raw.replace(/\/+$/, "");
  if (noTrailing.startsWith("http://") || noTrailing.startsWith("https://")) {
    if (/^https?:\/\/[^/]+$/i.test(noTrailing)) {
      return `${noTrailing}/api/v1`;
    }
    return noTrailing;
  }
  return noTrailing || "/api/v1";
}

const apiBase = resolveApiBaseUrl();

const apiClient = axios.create({
  baseURL: apiBase.replace(/\/+$/, ""),
  timeout: 15000,
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error("API request failed:", error);
    return Promise.reject(error);
  },
);

export default apiClient;
