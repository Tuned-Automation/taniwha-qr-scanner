# Project Taniwha — Web QR Voucher Scanner

A simple, self-contained web widget for scanning QR voucher codes using device cameras. Designed for easy Webflow integration with Make.com webhook processing.

## Features

- 📱 **Camera QR Scanning** - Uses device camera with frame overlay guide
- 💰 **Optional Spend Tracking** - Number pad input for total spend amount
- 🔧 **Manual Entry Fallback** - Type voucher codes directly
- 🌐 **Webhook Integration** - Direct connection to Make.com
- 📱 **Mobile Optimized** - Responsive design for all devices
- 📦 **Zero Dependencies** - Single HTML file, works anywhere
- 🔒 **Privacy Focused** - No data storage, optional spend tracking

## Quick Start

### For Webflow Integration (Recommended)

Add an **iframe** to your Webflow site:

```html
<iframe 
  src="https://tuned-automation.github.io/taniwha-qr-scanner/simple.html" 
  width="100%" 
  height="600" 
  frameborder="0"
  style="border-radius: 10px;">
</iframe>
```

### Direct Access

Visit the scanner directly: **https://tuned-automation.github.io/taniwha-qr-scanner/simple.html**

## How It Works

### 1. QR Scanning Flow
1. Click "📷 Start Camera"
2. Point camera at QR code (green frame guides alignment)
3. **Mandatory spend prompt** appears as overlay
4. Choose to skip or enter spend amount
5. Webhook fires with token + optional spend data

### 2. Manual Entry Flow
1. Click "⌨️ Enter Code"
2. Type voucher token (e.g., `vch_demo123`)
3. Same spend prompt overlay appears
4. Webhook fires after user choice

### 3. Supported QR Formats
- Direct tokens: `vch_XXXXXXXX`
- URL parameters: `https://example.com?token=vch_XXXXXXXX`
- Batch format: `https://example.com?batch=123&token=vch_XXXXXXXX`

## Webhook Integration

### Request Format
```json
{
  "token": "vch_demo123",
  "ts": 1704067200000,
  "ua": "Mozilla/5.0...",
  "source": "simple-scanner",
  "totalSpend": "25.50"
}
```

### Response Handling
- **JSON Response**: `{"status": "confirmed", "label": "Success!"}`
- **Plain Text**: `"Accepted"` or `"OK"` → treated as confirmed
- **Error Codes**: HTTP errors shown to user

## Configuration

### Webhook URL
Update line 367 in `simple.html`:
```javascript
const WEBHOOK_URL = 'https://hook.us1.make.com/YOUR_WEBHOOK_ID';
```

### CORS Requirements
Your Make.com webhook response should include:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

## Files

- **`simple.html`** - Main scanner application (self-contained)
- **`README.md`** - This documentation

## Development

1. Clone the repository
2. Edit `simple.html` to customize behavior
3. Test locally or push to GitHub Pages
4. Use in Webflow via iframe

## Browser Support

- **Chrome/Safari**: Full support with native `BarcodeDetector`
- **Firefox/Edge**: Uses jsQR library fallback
- **Mobile**: Optimized for iOS/Android cameras
- **HTTPS Required**: Camera access only works on secure connections

## License

MIT License - Feel free to modify and use in your projects.