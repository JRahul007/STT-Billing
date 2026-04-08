import axios from "axios";

const api = axios.create({
  baseURL: "/api",
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("auth_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auto-logout on 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response && err.response.status === 401) {
      // Don't redirect if already on auth pages
      if (!window.location.pathname.startsWith("/login") &&
          !window.location.pathname.startsWith("/register") &&
          !window.location.pathname.startsWith("/forgot-password")) {
        localStorage.removeItem("auth_token");
        localStorage.removeItem("auth_user");
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  }
);

// Auth
export const loginUser = (data) => api.post("/auth/login", data);
export const registerUser = (data) => api.post("/auth/register", data);
export const forgotPassword = (data) => api.post("/auth/forgot-password", data);
export const resetPassword = (data) => api.post("/auth/reset-password", data);
export const getMe = () => api.get("/auth/me");

// Dashboard Analytics
export const getBillingAnalytics = (year) => api.get(`/dashboard/billing-analytics?year=${year}`);

// Billings
export const getBillings = () => api.get("/billings");
export const createBilling = (data) => api.post("/billings", data);
export const updateBilling = (id, data) => api.put(`/billings/${id}`, data);
export const deleteBilling = (id) => api.delete(`/billings/${id}`);

// Billing Parties (consigner/consignee master)
export const getParties = (partyType) =>
  api.get(partyType ? `/parties?party_type=${partyType}` : "/parties");
export const createParty = (data) => api.post("/parties", data);
export const updateParty = (id, data) => api.put(`/parties/${id}`, data);
export const deleteParty = (id) => api.delete(`/parties/${id}`);

export default api;
