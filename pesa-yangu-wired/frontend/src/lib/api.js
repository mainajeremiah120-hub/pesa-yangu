/**
 * frontend/src/lib/api.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Axios client wired to the Pesa Yangu backend.
 * VITE_API_URL is set in Vercel environment variables.
 * Falls back to /api/v1 for local dev (Vite proxy handles it).
 */
import axios from "axios";

export const BASE_URL =
  import.meta.env.VITE_API_URL || "/api/v1";

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 20000,
  headers: { "Content-Type": "application/json" },
});

// ── Attach JWT ────────────────────────────────────────────────────────────────
client.interceptors.request.use((config) => {
  const token = localStorage.getItem("py_access_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Auto-refresh expired token ────────────────────────────────────────────────
let refreshing = false;
let waitQueue  = [];

client.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    if (err.response?.status === 401 && !original._retry) {
      if (refreshing) {
        return new Promise((resolve, reject) =>
          waitQueue.push({ resolve, reject })
        ).then(() => client(original));
      }
      original._retry = true;
      refreshing = true;
      try {
        const rt = localStorage.getItem("py_refresh_token");
        if (!rt) throw new Error("no refresh token");
        const { data } = await axios.post(`${BASE_URL}/auth/refresh`, {
          refreshToken: rt,
        });
        localStorage.setItem("py_access_token", data.accessToken);
        waitQueue.forEach(({ resolve }) => resolve());
        waitQueue = [];
        return client(original);
      } catch {
        waitQueue.forEach(({ reject }) => reject(err));
        waitQueue = [];
        localStorage.removeItem("py_access_token");
        localStorage.removeItem("py_refresh_token");
        // Signal the app to show login screen
        window.dispatchEvent(new Event("py:logout"));
        return Promise.reject(err);
      } finally {
        refreshing = false;
      }
    }
    return Promise.reject(err);
  }
);

const unwrap = (p) => p.then((r) => r.data);

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authApi = {
  register:       (p)           => unwrap(client.post("/auth/register", p)),
  login:          (p)           => unwrap(client.post("/auth/login",    p)),
  me:             ()            => unwrap(client.get("/auth/me")),
  deactivate:     ()            => unwrap(client.delete("/auth/account")),
  forgotPassword: (email)            => unwrap(client.post("/auth/forgot-password", { email })),
  resetPassword:  (token, password)  => unwrap(client.post("/auth/reset-password", { token, password })),
  updateProfile:  (full_name)        => unwrap(client.patch("/auth/profile", { full_name })),
  resetData:      ()                 => unwrap(client.post("/auth/reset-data")),
  logout: () => {
    const rt = localStorage.getItem("py_refresh_token");
    localStorage.removeItem("py_access_token");
    localStorage.removeItem("py_refresh_token");
    return client.post("/auth/logout", { refreshToken: rt }).catch(() => {});
  },
};

// ── Wallets ───────────────────────────────────────────────────────────────────
export const walletsApi = {
  list:     ()         => unwrap(client.get("/wallets")),
  create:   (p)        => unwrap(client.post("/wallets", p)),
  update:   (id, p)    => unwrap(client.patch(`/wallets/${id}`, p)),
  remove:   (id)       => unwrap(client.delete(`/wallets/${id}`)),
  transfer: (p)        => unwrap(client.post("/wallets/transfer", p)),
};

// ── Transactions ──────────────────────────────────────────────────────────────
export const txApi = {
  list:      (params)  => unwrap(client.get("/transactions", { params })),
  create:    (p)       => unwrap(client.post("/transactions", p)),
  update:    (id, p)   => unwrap(client.patch(`/transactions/${id}`, p)),
  remove:    (id)      => unwrap(client.delete(`/transactions/${id}`)),
  exportCSV: ()        => client.get("/transactions/export", { responseType: "blob" }),
  importCSV: (file)    => {
    const fd = new FormData();
    fd.append("file", file);
    return unwrap(
      client.post("/transactions/import", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      })
    );
  },
};

// ── Categories ────────────────────────────────────────────────────────────────
export const catsApi = {
  list:   ()         => unwrap(client.get("/categories")),
  create: (p)        => unwrap(client.post("/categories", p)),
  update: (id, p)    => unwrap(client.patch(`/categories/${id}`, p)),
  remove: (id)       => unwrap(client.delete(`/categories/${id}`)),
};

// ── Budgets ───────────────────────────────────────────────────────────────────
export const budgetsApi = {
  list: ()  => unwrap(client.get("/budgets")),
  set:  (p) => unwrap(client.post("/budgets", p)),
};

// ── Goals ─────────────────────────────────────────────────────────────────────
export const goalsApi = {
  list:   ()         => unwrap(client.get("/goals")),
  create: (p)        => unwrap(client.post("/goals", p)),
  update: (id, p)    => unwrap(client.patch(`/goals/${id}`, p)),
  fund:   (id, amt, walletId)  => unwrap(client.post(`/goals/${id}/fund`, { amount: amt, wallet_id: walletId })),
  remove: (id)       => unwrap(client.delete(`/goals/${id}`)),
};

// ── Investments ───────────────────────────────────────────────────────────────
export const invsApi = {
  list:         ()         => unwrap(client.get("/investments")),
  create:       (p)        => unwrap(client.post("/investments", p)),
  update:       (id, p)    => unwrap(client.patch(`/investments/${id}`, p)),
  recordReturn:  (id, p)       => unwrap(client.post(`/investments/${id}/returns`, p)),
  removeReturn:  (id, rid)     => unwrap(client.delete(`/investments/${id}/returns/${rid}`)),
  remove:        (id)          => unwrap(client.delete(`/investments/${id}`)),
};

// ── Loans ─────────────────────────────────────────────────────────────────────
export const loansApi = {
  list:              ()           => unwrap(client.get("/loans")),
  create:            (p)          => unwrap(client.post("/loans", p)),
  update:            (id, p)      => unwrap(client.patch(`/loans/${id}`, p)),
  updateRepayment:   (id, rid, p) => unwrap(client.patch(`/loans/${id}/repayments/${rid}`, p)),
  removeRepayment:   (id, rid)    => unwrap(client.delete(`/loans/${id}/repayments/${rid}`)),
  remove:            (id)         => unwrap(client.delete(`/loans/${id}`)),
  recordRepayment: (id, p) => {
    const fd = new FormData();
    Object.entries(p).forEach(([k, v]) => {
      if (k === "files") v.forEach((f) => fd.append("files", f));
      else fd.append(k, String(v));
    });
    return unwrap(
      client.post(`/loans/${id}/repayments`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      })
    );
  },
};

// ── Recurring ─────────────────────────────────────────────────────────────────
export const recurApi = {
  list:   ()    => unwrap(client.get("/recurring")),
  create: (p)   => unwrap(client.post("/recurring", p)),
  toggle: (id)  => unwrap(client.patch(`/recurring/${id}/toggle`)),
  remove: (id)  => unwrap(client.delete(`/recurring/${id}`)),
};

// ── FX Rates ──────────────────────────────────────────────────────────────────
export const fxApi = {
  rates: () => unwrap(client.get("/fx-rates")),
};

// ── AI Advice ─────────────────────────────────────────────────────────────────
export const aiApi = {
  advice: (ctx) => unwrap(client.post("/ai/advice", { context: ctx })),
};

// ── Admin ─────────────────────────────────────────────────────────────────────
export const adminApi = {
  stats:         ()           => unwrap(client.get("/admin/stats")),
  users:         (search)     => unwrap(client.get("/admin/users", { params: { search } })),
  updateUser:    (id, patch)  => unwrap(client.patch(`/admin/users/${id}`, patch)),
  deleteUser:    (id)         => unwrap(client.delete(`/admin/users/${id}`)),
  tickets:       (status)     => unwrap(client.get("/admin/tickets", { params: { status } })),
  replyTicket:   (id, patch)  => unwrap(client.patch(`/admin/tickets/${id}`, patch)),
};

// ── Support Tickets (user) ────────────────────────────────────────────────────
export const ticketsApi = {
  list:       ()           => unwrap(client.get("/tickets")),
  create:     (p)          => unwrap(client.post("/tickets", p)),
  get:        (id)         => unwrap(client.get(`/tickets/${id}`)),
  addMessage: (id, msg)    => unwrap(client.post(`/tickets/${id}/messages`, { message: msg })),
  reopen:     (id)         => unwrap(client.post(`/tickets/${id}/reopen`)),
  rate:       (id, rating) => unwrap(client.post(`/tickets/${id}/rate`, { rating })),
};

// ── Billing ───────────────────────────────────────────────────────────────────
export const billingApi = {
  plans:     ()    => unwrap(client.get("/billing/plans")),
  subscribe: (p)   => unwrap(client.post("/billing/subscribe", p)),
  cancel:    ()    => unwrap(client.post("/billing/cancel")),
};

// ── Reconcile ─────────────────────────────────────────────────────────────────
export const reconcileApi = {
  parse: (walletId, file) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("walletId", walletId);
    return unwrap(
      client.post("/reconcile/parse", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      })
    );
  },
  confirm: (rows, walletId) =>
    unwrap(client.post("/reconcile/confirm", { rows, walletId })),
};

// ── Insurance ─────────────────────────────────────────────────────────────────
export const insuranceApi = {
  list:   ()         => unwrap(client.get("/insurance")),
  create: (p)        => unwrap(client.post("/insurance", p)),
  update: (id, p)    => unwrap(client.patch(`/insurance/${id}`, p)),
  remove: (id)       => unwrap(client.delete(`/insurance/${id}`)),
};

export default client;
