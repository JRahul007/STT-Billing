// Default stamp SVG as a data URL — always available, no file dependency
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120">
  <rect x="2" y="2" width="236" height="116" rx="12" fill="none" stroke="#b71c1c" stroke-width="3"/>
  <rect x="8" y="8" width="224" height="104" rx="9" fill="none" stroke="#b71c1c" stroke-width="1.5" stroke-dasharray="6 3"/>
  <text x="120" y="38" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="bold" fill="#b71c1c" letter-spacing="1.5">SWATI TOURS</text>
  <text x="120" y="56" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="bold" fill="#b71c1c" letter-spacing="1.5">&amp; TRANSPORT</text>
  <line x1="40" y1="66" x2="200" y2="66" stroke="#b71c1c" stroke-width="0.8"/>
  <text x="120" y="82" text-anchor="middle" font-family="Arial,sans-serif" font-size="10" fill="#b71c1c">MUMBAI - 400084</text>
  <text x="120" y="100" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" fill="#b71c1c" letter-spacing="0.5">AUTHORISED SIGNATORY</text>
</svg>`;

const encoded = "data:image/svg+xml;base64," + btoa(svg);

export default encoded;
