export async function api(path, options = {}) {
  const config = { credentials: 'include', ...options };
  if (config.body && !(config.body instanceof FormData)) {
    config.headers = { 'Content-Type': 'application/json', ...(config.headers || {}) };
    config.body = JSON.stringify(config.body);
  }
  const response = await fetch(path, config);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}
