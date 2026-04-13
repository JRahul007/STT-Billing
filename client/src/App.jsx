import { useState, useRef, useEffect, Component } from "react";
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Billing from "./pages/Billing";
import InvoiceCreate from "./pages/InvoiceCreate";
import InvoiceView from "./pages/InvoiceView";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";

function safeParseJSON(str, fallback = {}) {
  try {
    const parsed = JSON.parse(str);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#f0f2f5" }}>
          <div style={{ textAlign: "center", padding: 40, background: "#fff", borderRadius: 16, boxShadow: "0 2px 20px rgba(0,0,0,0.1)" }}>
            <h2 style={{ marginBottom: 12 }}>Something went wrong</h2>
            <p style={{ color: "#666", marginBottom: 20 }}>The app encountered an error. Please try logging in again.</p>
            <button
              style={{ padding: "10px 24px", background: "#4361ee", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 }}
              onClick={() => {
                localStorage.removeItem("auth_token");
                localStorage.removeItem("auth_user");
                window.location.href = "/login";
              }}
            >Go to Login</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function ProtectedRoute({ children }) {
  const token = localStorage.getItem("auth_token");
  if (!token || token === "undefined" || token === "null") {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    return <Navigate to="/login" replace />;
  }
  return children;
}

function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [logo, setLogo] = useState(() => localStorage.getItem("app_logo") || "");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const logoInputRef = useRef(null);
  const user = safeParseJSON(localStorage.getItem("auth_user"));

  // Auto-close sidebar on route change (mobile)
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      localStorage.setItem("app_logo", reader.result);
      setLogo(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleLogout = () => {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    navigate("/login");
  };

  return (
    <div className="app-layout">
      {/* Mobile hamburger toggle */}
      <button
        className="mobile-menu-toggle"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        aria-label="Toggle menu"
      >
        {sidebarOpen ? "✕" : "☰"}
      </button>
      {/* Backdrop to close sidebar on mobile */}
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-header" style={{ textAlign: "center", padding: "16px 16px 18px" }}>
          <img
            src={logo || "/logo.svg"}
            alt="Logo"
            style={{ width: 70, height: 70, borderRadius: 14, objectFit: "cover", marginBottom: 8, cursor: "pointer", border: "2px solid rgba(255,255,255,0.15)" }}
            onClick={() => logoInputRef.current.click()}
            title="Click to change logo"
          />
          <input ref={logoInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleLogoUpload} />
          <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1.5, lineHeight: 1.3, textTransform: "uppercase", color: "#fff" }}>
            <span style={{ color: "#f7850a" }}>Swati</span> Tours
            <br />
            <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1.5, color: "#f7850a" }}>&amp;</span> Transport
          </div>
        </div>
        <nav>
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/billing">Billing</NavLink>
          <NavLink to="/invoice/create">Create Invoice</NavLink>
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <span>{user.full_name || "User"}</span>
            <small>{user.email || ""}</small>
          </div>
          <button className="btn-logout" onClick={handleLogout}>Logout</button>
        </div>
      </aside>
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/billing" element={<Billing />} />
          <Route path="/invoice/create" element={<InvoiceCreate />} />
          <Route path="/invoice/view" element={<InvoiceView />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/*" element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        } />
      </Routes>
    </ErrorBoundary>
  );
}
