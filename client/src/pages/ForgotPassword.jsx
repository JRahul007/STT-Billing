import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { forgotPassword, resetPassword } from "../services/api";

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1); // 1 = enter email, 2 = enter code + new password
  const [email, setEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [generatedCode, setGeneratedCode] = useState("");

  const handleRequestCode = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      const res = await forgotPassword({ email });
      setGeneratedCode(res.data.reset_code);
      setSuccess("Reset code generated! Check below for the code.");
      setStep(2);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to send reset code.");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await resetPassword({ email, reset_code: resetCode, new_password: newPassword });
      setSuccess("Password reset successfully! Redirecting to login...");
      setTimeout(() => navigate("/login"), 2000);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to reset password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h1><span style={{ color: "#f7850a" }}>Swati</span> Tours & Transport</h1>
          <p>Reset your password</p>
        </div>

        {step === 1 ? (
          <form onSubmit={handleRequestCode}>
            {error && <div className="auth-error">{error}</div>}
            {success && <div className="auth-success">{success}</div>}
            <div className="form-group">
              <label>Email Address</label>
              <input
                type="email"
                placeholder="Enter your registered email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary auth-btn" disabled={loading}>
              {loading ? "Sending..." : "Get Reset Code"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleResetPassword}>
            {error && <div className="auth-error">{error}</div>}
            {success && <div className="auth-success">{success}</div>}

            {generatedCode && (
              <div className="auth-code-display">
                <p>Your reset code:</p>
                <strong>{generatedCode}</strong>
                <p style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
                  (In production, this would be sent to your email)
                </p>
              </div>
            )}

            <div className="form-group">
              <label>Reset Code</label>
              <input
                type="text"
                placeholder="Enter the 6-digit reset code"
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value)}
                required
                maxLength={6}
              />
            </div>
            <div className="form-group">
              <label>New Password</label>
              <input
                type="password"
                placeholder="Min 6 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <div className="form-group">
              <label>Confirm New Password</label>
              <input
                type="password"
                placeholder="Re-enter new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <button type="submit" className="btn btn-primary auth-btn" disabled={loading}>
              {loading ? "Resetting..." : "Reset Password"}
            </button>
            <button type="button" className="btn btn-secondary auth-btn" style={{ marginTop: 8 }}
              onClick={() => { setStep(1); setError(""); setSuccess(""); setGeneratedCode(""); }}>
              Back
            </button>
          </form>
        )}

        <div className="auth-links">
          <Link to="/login">Back to Sign In</Link>
        </div>
      </div>
    </div>
  );
}
