// Local-storage housekeeping for the invoice list kept under "invoices".
//
// Older builds embedded the full base64 stamp image (~340 KB) inside every
// entry's `invoice_data`. The stamp is never read back from there (the current
// stamp is always loaded fresh), but ~15 such entries fill the browser's ~5 MB
// localStorage quota, after which every setItem throws and invoice downloads
// stop working. Strip those copies once per page load; nothing else is touched.

const INVOICES_KEY = "invoices";

function stripStamp(invoiceData) {
  if (typeof invoiceData !== "string" || !invoiceData.includes("stamp_image")) return null;
  try {
    const parsed = JSON.parse(invoiceData);
    if (!parsed || typeof parsed !== "object" || !("stamp_image" in parsed)) return null;
    delete parsed.stamp_image;
    return JSON.stringify(parsed);
  } catch {
    return null;
  }
}

export function compactStoredInvoices() {
  try {
    const raw = localStorage.getItem(INVOICES_KEY);
    if (!raw || !raw.includes("stamp_image")) return;
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return;
    let changed = false;
    list.forEach((entry) => {
      const compacted = stripStamp(entry?.invoice_data);
      if (compacted !== null) {
        entry.invoice_data = compacted;
        changed = true;
      }
    });
    if (changed) localStorage.setItem(INVOICES_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable or malformed — leave it as is */
  }
}

if (typeof window !== "undefined") compactStoredInvoices();
