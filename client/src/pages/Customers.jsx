import { useState, useEffect } from "react";
import { getCustomers, createCustomer, updateCustomer, deleteCustomer } from "../services/api";

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", address: "" });

  const loadData = () => {
    getCustomers().then((res) => setCustomers(res.data)).catch(() => {});
  };

  useEffect(() => { loadData(); }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (editing) {
      await updateCustomer(editing.id, form);
    } else {
      await createCustomer(form);
    }
    setShowModal(false);
    setEditing(null);
    setForm({ name: "", email: "", phone: "", address: "" });
    loadData();
  };

  const handleEdit = (c) => {
    setEditing(c);
    setForm({ name: c.name, email: c.email || "", phone: c.phone || "", address: c.address || "" });
    setShowModal(true);
  };

  const handleDelete = async (id) => {
    if (window.confirm("Delete this customer?")) {
      await deleteCustomer(id);
      loadData();
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Customers</h1>
        <button className="btn btn-primary" onClick={() => { setEditing(null); setForm({ name: "", email: "", phone: "", address: "" }); setShowModal(true); }}>
          + New Customer
        </button>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Address</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {customers.length === 0 ? (
              <tr><td colSpan="5" style={{ textAlign: "center", padding: "40px", color: "#999" }}>No customers yet</td></tr>
            ) : (
              customers.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.name}</strong></td>
                  <td>{c.email || "-"}</td>
                  <td>{c.phone || "-"}</td>
                  <td>{c.address || "-"}</td>
                  <td>
                    <div className="btn-group">
                      <button className="btn btn-sm btn-secondary" onClick={() => handleEdit(c)}>Edit</button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(c.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editing ? "Edit Customer" : "New Customer"}</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Name</label>
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Phone</label>
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Address</label>
                <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{editing ? "Update" : "Create"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
