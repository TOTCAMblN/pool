export async function api(url, options = {}) {
  const isFormData = options.body instanceof FormData;

  const res = await fetch(url, {
    credentials: "same-origin",
    headers: isFormData ? {} : { "Content-Type": "application/json" },
    ...options,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
  }

  if (!res.ok) {
    const error = new Error(data?.error ?? "Ошибка запроса");
    error.status = res.status;
    throw error;
  }

  return data;
}

export async function currentUser() {
  try {
    const data = await api("/api/me");
    return data.authenticated ? data : null;
  } catch {
    return null;
  }
}

export function showMessage(el, text, type = "error") {
  if (!el) return;
  el.textContent = text;
  el.className = `message message--${type}`;
  el.hidden = false;
}

export function hideMessage(el) {
  if (el) el.hidden = true;
}

export function formatDateTime(value) {
  return new Date(value).toLocaleString("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
} 