import { useState, useRef, useEffect } from "react";
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Billing from "./pages/Billing";
import InvoiceCreate from "./pages/InvoiceCreate";
import InvoiceView from "./pages/InvoiceView";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";

function ProtectedRoute({ children }) {
  const token = localStorage.getItem("auth_token");
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

function AppLayout() {
  const navigate = useNavigate();
  const [logo, setLogo] = useState(() => localStorage.getItem("app_logo") || "");
  const logoInputRef = useRef(null);
  const user = JSON.parse(localStorage.getItem("auth_user") || "{}");

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
      <aside className="sidebar">
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
  );
}
