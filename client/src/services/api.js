// The API's own address, used for the socket. App requests go to /api on this same origin
// (Vite proxy in dev, Vercel rewrite in production), which keeps the login cookie first-party.
export const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:8080").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const request = async (method, path, body) => {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: "include",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach Agla right now. Check your connection; if the server was asleep it can take a minute to wake up.", 0);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(data?.message || `Something went wrong (${res.status})`, res.status, data);
  }
  return data;
};

export const api = {
  get: (path) => request("GET", path),
  post: (path, body = {}) => request("POST", path, body),
  put: (path, body) => request("PUT", path, body),
  patch: (path, body) => request("PATCH", path, body),
  del: (path) => request("DELETE", path),
};
