# Project Taniwha — Web QR Voucher Scanner

A drop‑in scanner widget for Webflow (or any site). Uses the device camera to read a QR code, extracts a voucher token, sends it to a Make.com webhook, and renders a "Confirmed" or "Denied" result.

### Features
- Shadow DOM widget mounted in `#taniwha-root`
- Uses `BarcodeDetector` when available; falls back to ZXing
- Graceful fallbacks: file upload and manual token entry
- Single bundle (`dist/taniwha.bundle.js`) and stylesheet (`dist/taniwha.css`)
- Fully namespaced with `taniwha-` to avoid collisions

## Quick start

1) Configure `src/config.js`:
- Set `MAKE_WEBHOOK_URL`
- Optionally adjust UI labels and `ENABLE_WORKER`

2) Build (optional) or use prebuilt files in `dist/`.

3) Publish to GitHub and reference via a CDN tag in Webflow embed.

### Webflow embed snippet

```html
<!-- Project Taniwha scanner embed -->
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link rel="stylesheet" href="REPO_BASE_URL/taniwha.css">
<div id="taniwha-root"></div>
<script>window.TANIWHA_REPO_BASE_URL = "REPO_BASE_URL";</script>
<script defer src="REPO_BASE_URL/taniwha.bundle.js"></script>
```

Replace `REPO_BASE_URL` with your CDN path (e.g. `https://cdn.jsdelivr.net/gh/ORG/REPO@TAG/dist`).

## Config

Edit `src/config.js`:

```js
export const TANIWHA_CONFIG = {
  MAKE_WEBHOOK_URL: "https://hooks.make.com/XXXXXXXXXXXX",
  CORS_MODE: "cors",
  REQUEST_TIMEOUT_MS: 8000,
  ALLOW_FILE_UPLOAD_FALLBACK: true,
  ENABLE_WORKER: true,
  UI: {
    title: "Scan your voucher",
    subtitle: "Align the QR within the frame",
    confirmLabel: "Confirmed",
    denyLabel: "Denied",
    errorLabel: "Something went wrong",
    retryLabel: "Try again",
  },
};
```

## Make.com webhook contract

Request JSON:

```json
{
  "token": "vch_8b7K9wP3qA",
  "ts": 1733779200000,
  "ua": "<user agent>",
  "source": "taniwha-web"
}
```

Response JSON:
- Confirmed:
```json
{ "status": "confirmed", "label": "Confirmed", "name": "…", "email": "…", "meta": { "batch": "…", "redeemedAt": "…" } }
```
- Denied:
```json
{ "status": "denied", "label": "Denied", "reason": "expired" }
```

Ensure CORS: set `Access-Control-Allow-Origin` to `*` or your Webflow domain.

## Development

- Source: `src/`
- Build output: `dist/`
- Vendor fallback: `src/vendor/zxing.min.js` (shim that loads ZXing from jsDelivr by default)

You can swap the shim for a vendored copy of ZXing if you prefer hosting everything in this repo.

## Accessibility

- Keyboard focusable buttons and inputs, visible focus styles
- `aria-live="polite"` for status updates
- Icons have `aria-hidden` or `aria-label` where appropriate

## Security

- No secrets in client code
- Token validation performed server-side via Make + Airtable
- Avoid displaying PII; masking applied where shown

## Testing

- iOS Safari and Android Chrome
- Camera allowed and blocked
- Slow network / timeout
- Bad QR content
- CORS from live Webflow domain

## License
MIT