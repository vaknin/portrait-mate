# Canon CCAPI Implementation Plan

## Why CCAPI?

**Problem:** Canon R8 shutter button is blocked when using gphoto2 PTP/USB connection (by design).

**Solution:** Canon CCAPI (Camera Control API) - WiFi-based HTTP REST API that allows manual shutter button usage.

---

## Network Architecture: Dual Interface

```
Laptop (Bun Server)
├─ WiFi (wlan0): Connected to Camera WiFi
│  └─ IP: 192.168.1.x
│  └─ Routes: Camera CCAPI traffic (http://192.168.1.1:8080)
│
└─ USB (usb0): Connected to Phone (USB Tethering)
   └─ IP: 192.168.42.x
   └─ Routes: Internet traffic (WhatsApp/Baileys)
   └─ Phone accesses webapp: http://192.168.42.x:3000
```

**Benefits:**
- Camera WiFi + Internet simultaneously (no switching)
- Phone webapp has continuous connection
- Phone charges via USB while providing internet
- Photographer presses camera shutter freely

---

## Canon R8 CCAPI Setup (One-Time)

### Prerequisites
1. Canon R8 firmware v1.1.0+ (has CCAPI support)
2. Register at Canon Developer Community (free)
3. Download CCAPI activation tool
4. Run activation tool with R8 connected via USB (one-time)

### Camera Configuration
1. **Menu → WiFi Settings → Enable WiFi**
2. **Set to Camera Access Point mode**
3. Camera creates WiFi network: `EOS_R8_XXXX`
4. Default camera IP: `192.168.1.1`
5. CCAPI port: `8080`

### Laptop Configuration
1. Connect WiFi to `EOS_R8_XXXX` network
2. Enable USB tethering on phone
3. Connect phone to laptop via USB
4. Verify dual connectivity:
   ```bash
   ip route
   # Should show:
   # default via 192.168.42.x dev usb0  (internet)
   # 192.168.1.0/24 dev wlan0           (camera)
   ```

---

## CCAPI Endpoints

### Discovery
```bash
GET http://192.168.1.1:8080/ccapi
# Returns camera info and capabilities
```

### Event Polling (Detect New Photos)
```bash
GET http://192.168.1.1:8080/ccapi/ver100/event/polling?continue=off
```

**Response when shutter pressed:**
```json
{
  "addedcontents": [
    {
      "url": "/ccapi/ver100/contents/sd/IMG_1234.JPG",
      "name": "IMG_1234.JPG"
    }
  ]
}
```

### Download Photo
```bash
GET http://192.168.1.1:8080/ccapi/ver100/contents/sd/IMG_1234.JPG
# Returns binary JPEG data
```

---

## Implementation Changes

### Replace gphoto2 with CCAPI

**Old (gphoto2 USB):**
```typescript
// Spawn process, parse output, multiple USB conflicts
spawn('gphoto2', ['--list-files', '--folder', path]);
spawn('gphoto2', ['--get-file', filename]);
```

**New (CCAPI WiFi):**
```typescript
// Simple HTTP REST calls
const response = await fetch(`http://192.168.1.1:8080/ccapi/ver100/event/polling?continue=off`);
const data = await response.json();

if (data.addedcontents) {
  for (const content of data.addedcontents) {
    const photoUrl = `http://192.168.1.1:8080${content.url}`;
    const response = await fetch(photoUrl);
    const buffer = await response.arrayBuffer();
    await writeFile(localPath, Buffer.from(buffer));
  }
}
```

### Code Changes

**src/services/camera.ts:**
- Remove: `spawn()` calls, path discovery, USB locking
- Add: HTTP fetch-based polling
- Keep: Reconnection logic, download queue, Socket.io events
- Replace: `checkCameraAvailable()` → HTTP ping to camera
- Polling interval: 1.5s (same as before)

**Key simplifications:**
- No more `discoverCameraPath()` (fixed IP: 192.168.1.1)
- No more `listCameraFiles()` parsing
- No more USB conflicts
- No more `--list-files`, `--get-file` complexity

---

## Workflow

### In the Field
1. Turn on Canon R8 (WiFi AP auto-starts)
2. Laptop auto-connects to camera WiFi + USB tethered to phone
3. Open webapp on phone: `http://192.168.42.x:3000`
4. Start session → CCAPI polling begins
5. **Press camera shutter button** → Photo captured
6. CCAPI detects new file (1-2s delay)
7. Downloads via WiFi (2-3s)
8. Appears in webapp grid (~3-5s total)
9. Select favorites, click Send
10. WhatsApp sends via USB internet (no network switching!)
11. Reset for next subject

### Expected Latency
- Shutter press → Detection: 1-2s
- Download 24MP JPEG: 2-3s
- **Total: 3-5 seconds** (acceptable for street photography)

---

## Migration Checklist

- [ ] Register Canon Developer Community
- [ ] Download CCAPI activation tool
- [ ] Activate Canon R8 CCAPI
- [ ] Configure R8 WiFi AP mode
- [ ] Test manual CCAPI endpoints (curl/Postman)
- [ ] Refactor `camera.ts` to use HTTP fetch
- [ ] Test dual network setup (WiFi + USB)
- [ ] Verify shutter button works during CCAPI connection
- [ ] Test reconnection when camera powers off/on
- [ ] Field test: 10+ photo shoot session

---

## Technical Notes

### Camera Discovery
If camera IP changes or multiple cameras:
```typescript
// Use mDNS/Bonjour
import Bonjour from 'bonjour';
const bonjour = Bonjour();
bonjour.find({ type: 'ccapi' }, (service) => {
  console.log('Found camera:', service.host);
});
```

### Error Handling
- **HTTP 404:** Camera not ready, retry
- **Timeout:** Camera powered off, trigger reconnection
- **Network unreachable:** WiFi disconnected, attempt reconnect

### WiFi Stability
- Canon cameras may sleep and disconnect WiFi after inactivity
- Solution: Keep CCAPI polling alive to prevent sleep
- Alternative: Disable camera auto-sleep in menu

---

## Resources

- **CCAPI Docs:** https://developercommunity.usa.canon.com/s/article/Introduction-to-Camera-Control-API-CCAPI
- **Canomate (Python reference):** https://github.com/horshack-dpreview/Canomate
- **Node.js CCAPI library:** https://github.com/camerahacks/canon-ccapi-node
- **Canon R8 Firmware:** https://www.canon.com/support (ensure v1.1.0+)

---

## Comparison: gphoto2 vs CCAPI

| Aspect | gphoto2 (Old) | CCAPI (New) |
|--------|---------------|-------------|
| Connection | USB | WiFi |
| Shutter button | ❌ Blocked | ✅ Works |
| Canon R8 support | ❌ Not official | ✅ Official |
| Code complexity | 🔴 High (spawn, parse) | 🟢 Low (HTTP fetch) |
| USB conflicts | ❌ Yes | ✅ None |
| Internet access | ✅ Direct | ✅ Via USB tethering |
| Latency | ~1.5s (if worked) | ~3-5s |
| Setup | 🟢 Plug & play | 🟡 One-time activation |
| Reliability | ❌ R8 not supported | ✅ Designed for this |

**Verdict:** CCAPI is the correct solution for Canon R8 + manual shutter workflow.
