<div align="center">

# portrait-mate

**Instant WhatsApp photo delivery for street/portrait photographers**

Shoot strangers → Photos appear on your phone instantly → They select favorites → Send to their WhatsApp

---

### Stack

**Backend:** Bun • TypeScript • Express • Baileys (WhatsApp) • gphoto2 • Pino • Zod • Sharp
**Frontend:** Vanilla JS • PhotoSwipe • Socket.io

---

### Setup

```bash
# Install dependencies
bun install

# Start development server
bun dev

# Compile to single binary
bun run compile
```

**Requirements:** gphoto2-compatible camera, laptop, WiFi hotspot

---

### Workflow

1. Connect camera via USB (tethered shooting)
2. Open webapp on phone via WiFi
3. Take portraits → Photos appear in phone gallery instantly (no refresh needed)
4. Subject selects favorites (tap to select)
5. Send to their WhatsApp number (auto-formats)
6. Reset for next person (clears session & thumbnails)

---

</div>
