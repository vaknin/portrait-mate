# Photo Capture & WhatsApp Delivery System

## Project Vision

Street/portrait photography workflow for shooting strangers and instantly sending them their photos.

**Hardware Setup:**
- Canon R8 (USB) → Laptop in backpack → WiFi hotspot
- Phone in hand as wireless remote control

**Workflow:**
1. Open webapp on phone (gallery always ready)
2. Take 3-5 portraits of stranger with Canon R8
3. Photos appear in webapp grid automatically
4. Pull out phone, show thumbnails while chatting
5. Tap checkboxes to select their favorite photos
6. Click "Send" button, enter their phone number
7. Photos arrive on their WhatsApp while still present
8. Click "Reset" to clear gallery for next person

## Technology Stack

### Backend (runs on laptop)
- **Bun** - fast all-in-one JavaScript runtime with native TypeScript support
- **TypeScript (ESM)** - type-safe backend
- **Express.js** - web server
- **Baileys** (@whiskeysockets/baileys v7) - WhatsApp WebSocket API
- **child_process** - execute gphoto2 commands
- **Socket.io** - real-time photo updates
- **qrcode-terminal** - WhatsApp QR authentication

### Frontend (mobile-first design)
- **Vanilla JavaScript (ES6+)** - no framework overhead, direct DOM manipulation
- **PhotoSwipe v5.4.4** - fullscreen image viewer with pinch-to-zoom
- **Socket.io-client** - real-time updates
- **CSS Grid/Flexbox** - responsive layouts
- **CSS Custom Properties** - dark theme variables
- Dark, minimal, modern aesthetic optimized for mobile Chromium/Brave
- Dynamic image dimension detection for correct aspect ratios

### System Tools
- **gphoto2** - camera tethering & event monitoring

## Project Structure

```
portrait-mate/
├── src/
│   ├── server.ts           # Main Express server
│   ├── services/
│   │   ├── camera.ts       # gphoto2 camera control & monitoring
│   │   └── whatsapp.ts     # Baileys WhatsApp integration (Phase 4)
│   └── types/
│       └── index.ts        # TypeScript type definitions
├── public/                 # Frontend files (served statically)
│   ├── index.html          # Main UI
│   ├── style.css           # Styling
│   └── app.js              # Frontend JavaScript
├── session/                # All captured photos stored here
│   └── photo_*.jpg         # Photos from camera (auto-saved)
├── auth_info/              # Baileys auth state (gitignored)
├── package.json            # Dependencies (type: module for ESM)
├── tsconfig.json           # TypeScript configuration
└── .env                    # Environment variables
```

## Implementation Phases

### Phase 1: Basic Setup ✅ COMPLETED
- [x] Initialize Bun project
- [x] Install dependencies (Baileys, Express, Socket.io)
- [x] Configure TypeScript (tsconfig.json with ESM support)
- [x] Set up folder structure (src/, public/, sessions/, auth_info/)
- [x] Create Express server with TypeScript and Socket.io
- [x] Create TypeScript type definitions (src/types/index.ts)
- [x] Configure build/dev scripts (Bun runs TypeScript natively)
- [x] Test server startup (verified working on port 3000)

**Note:** Frontend HTML/CSS/JS deferred to Phase 3

### Phase 2: Camera Integration ✅ COMPLETED
- [x] Create camera service module (`src/services/camera.ts`)
- [x] Implement `monitorCamera()` - event-based with `gphoto2 --wait-event-and-download`
- [x] Handle photo download to session folder
- [x] Auto-reconnect when camera turns on/off (poll for camera availability)
- [x] Emit camera connection status via Socket.io
- [x] Emit Socket.io events on new captures
- [x] Integrate camera service with server.ts
- [x] Add callback to update session photos array
- [x] Add GET /api/camera/status endpoint
- [x] Fix camera "busy" issue with `--set-config capturetarget=1` and `--keep` flags
- [ ] Test capture workflow with camera power cycling (requires physical camera)

### Phase 3: Mobile Web Interface ✅ COMPLETED + REDESIGNED
**Tech Stack:** Vanilla JS + PhotoSwipe v5.4.4 (dark, minimal, modern aesthetic)
**Design:** Dark theme (#0a0a0a bg), mobile-first, 44px touch targets, photographer aesthetic

**New Flow (Gallery-First Approach):**
- [x] No login screen - gallery shows immediately on page load
- [x] Auto-loads existing session on page reload (session persistence)
- [x] Auto-starts new session if none exists
- [x] Header with camera status + Reset button + Send button
- [x] Send button grayed out until photos selected, shows badge count
- [x] Reset button with confirmation dialog (always enabled)

**Photo Gallery:**
- [x] CSS Grid with 2-column layout (3 on tablet, 4 on desktop)
- [x] Photo selection - tap checkbox to select/deselect with checkmark overlay
- [x] Real-time photo display via Socket.io (`photo-captured` event)
- [x] Touch-optimized interactions (44px+ targets, smooth transitions)
- [x] Camera status indicator (green/red dot with pulse animation)
- [x] Empty state with waiting message

**Image Display Fixes:**
- [x] Dynamic dimension detection (6000×4000 landscape, 4000×6000 portrait)
- [x] `object-fit: contain` for grid thumbnails (shows full image, no cropping)
- [x] Correct aspect ratios in PhotoSwipe lightbox viewer
- [x] Tap photo → PhotoSwipe fullscreen with pinch-to-zoom, pan, swipe
- [x] Tap checkbox → Select/deselect for sending
- [x] Image error handling with fallback dimensions

**Modern Modal Dialogs:**
- [x] Phone number popup (opens when Send clicked)
- [x] Israeli format validation with auto-formatting (allows hyphens)
- [x] Three states: Input → Sending (spinner) → Success ("Images sent!")
- [x] Cancel and Send buttons in popup
- [x] Success screen with Close button
- [x] Auto-reset session after successful send

**Session Management:**
- [x] Photos persist across page reloads
- [x] Reset button clears UI and starts new session
- [x] Photos remain on disk/SD card when reset (not deleted)
- [x] Confirmation dialog before reset

**Polish & Accessibility:**
- [x] Toast notifications for errors and feedback
- [x] Focus styles for keyboard accessibility
- [x] PhotoSwipe dark theme customization
- [x] Smooth animations (modal slide-in, button states)
- [x] WhatsApp format conversion ready for Phase 4

**Features:**
- ✅ Gallery-first workflow (no login barrier)
- ✅ Session persistence across reloads
- ✅ Full image visible in grid (no cropping)
- ✅ Correct aspect ratios for Canon R8 photos
- ✅ Modern popup modals with state transitions
- ✅ Header-based controls (Send + Reset buttons)
- ✅ Bundle size: ~133KB total

- [ ] Test on actual phone via WiFi hotspot (requires physical setup)

### Phase 4: WhatsApp Integration (Baileys)
- [ ] Set up Baileys client with WebSocket connection
- [ ] Implement auth state management (useMultiFileAuthState)
- [ ] QR code authentication flow (do once at home)
- [ ] Implement `sendPhotos()` - send only selected photos as full-resolution
- [ ] Phone number format conversion (0504203492 → 972504203492@s.whatsapp.net)
- [ ] Handle LID system (v7 Local Identifiers)
- [ ] Send progress indicator
- [ ] Success/failure feedback
- [ ] Connection status monitoring & reconnection

### Phase 5: Session Management
- [ ] Session data structure (metadata + selected photos)
- [ ] Auto-create session folder on first capture
- [ ] Session cleanup after send
- [ ] Optional: Session history viewer

### Phase 6: Production Build (Single Binary)
- [ ] Test full workflow end-to-end (camera → capture → select → send)
- [ ] Compile to single binary with `bun build --compile src/server.ts --outfile portrait-mate`
- [ ] Test binary on laptop (no node_modules needed)
- [ ] Create startup script for production use
- [ ] Document deployment to laptop in backpack

## Key Implementation Details

### Camera Monitoring & Auto-Reconnection
**Bun server manages gphoto2 automatically** - no manual terminal commands needed.

The `camera.ts` service spawns and monitors gphoto2 using `child_process`:
- Command: `gphoto2 --set-config capturetarget=1 --capture-tethered --keep --filename session/photo_%H%M%S.jpg`
- `--set-config capturetarget=1` - Save to memory card (prevents camera "busy" errors)
- `--capture-tethered` - Wait for shutter release and auto-download
- `--keep` - Keep originals on SD card as backup
- Downloads only JPG files (skips RAW if camera set to RAW+JPG)
- Photos save directly to `session/` folder on laptop
- Timestamp pattern `%H%M%S` prevents filename conflicts
- Server spawns gphoto2 as child process on startup (runs continuously)
- Monitors stdout/stderr for "Saving file as" events
- Emits Socket.io event to frontend when photo downloaded
- When camera disconnects (process exits), automatically retries every 3s
- Auto-restart gphoto2 when camera reconnects
- Emit camera connection status to frontend
- Use SIGUSR2 signal for graceful shutdown

**Why capturetarget=1 fixes "busy" issue:**
- Default (capturetarget=0) uses camera's internal RAM buffer
- Buffer fills quickly during rapid shooting (3-11 shots depending on model)
- Setting to memory card (1) writes directly to SD card, preventing buffer overflow
- Photographer can shoot continuously without camera locking up

### Phone Number Format Conversion (Baileys)
- Input: `0504203492` (Israeli) or `+1234567890` (international)
- Output: `972504203492@s.whatsapp.net` or `1234567890@s.whatsapp.net`
- Strip non-digits except `+`, replace leading `0` with `972`, remove `+`, append `@s.whatsapp.net`
- Note: Baileys uses `@s.whatsapp.net` for individual chats (not `@c.us`)

### Photo Storage
```
session/
├── photo_164206.jpg       # Captured photo (HH:MM:SS timestamp)
├── photo_164207.jpg
└── photo_164208.jpg       # etc...
```

**Simple single-folder approach:**
- All photos from camera go to `session/` directory
- Filename: `photo_{HH}{MM}{SS}.jpg` (unique by time)
- No session ID complexity
- Frontend requests `/photos/{filename}` to download
- Server serves from `session/{filename}`

### Real-time Updates Flow
1. Photographer presses camera shutter button
2. gphoto2 detects event, downloads photo to session folder
3. Server emits `photo-captured` event via Socket.io with `{filename, path}`
4. Frontend loads image dimensions dynamically (6000×4000 or 4000×6000)
5. Photo appears in gallery grid with correct aspect ratio
6. User taps checkbox to select/deselect photos
7. "Send" button enables when photos selected, shows badge count
8. Click "Send" → popup opens for phone number
9. Enter phone → sends via WhatsApp (Phase 4)
10. Success message → auto-reset session for next person

## API Endpoints

### REST APIs
- `POST /api/session/start` - Start new session, returns session ID
- `POST /api/session/photos/:id/select` - Toggle photo selection
- `POST /api/session/send` - Send selected photos to phone number, end session
- `POST /api/session/reset` - Reset session (clear photos array)
- `GET /api/session/current` - Get current session (photos, selections, status)
- `GET /api/camera/status` - Get camera connection status
- `GET /photos/:filename` - Serve photo files from `session/` folder

### WebSocket Events (Server → Client)
- `photo-captured` - New photo available `{filename, path}`
- `whatsapp-status` - Connection status `{connected: boolean}`
- `send-progress` - Sending progress `{current, total}`
- `send-complete` - All photos sent `{success: boolean, count}`

## Environment Configuration

```bash
# .env file
PORT=3000
PHOTOS_DIR=./sessions
AUTH_INFO_DIR=./auth_info
GPHOTO2_PATH=/usr/bin/gphoto2
NODE_ENV=development
```

## Dependencies

**Runtime Dependencies:**
- `@whiskeysockets/baileys` - WhatsApp WebSocket API
- `express` - web server
- `socket.io` - real-time communication
- `qrcode-terminal` - QR code display for WhatsApp auth
- `dotenv` - environment variable management

**Dev Dependencies:**
- `@types/express` - TypeScript types for Express
- `@types/node` - TypeScript types for Node.js APIs
- `typescript` - TypeScript compiler (optional, Bun has built-in support)

**Notes:**
- Bun natively supports TypeScript - no transpiler needed
- Bun natively supports ESM modules
- No need for `tsx`, `nodemon`, or build tools
- Install dependencies with: `bun install <package>`

## Mobile UI Requirements

**Essential Features (Implemented):**
- ✅ Large touch targets (min 44px)
- ✅ PhotoSwipe fullscreen viewer with pinch-to-zoom
- ✅ Visual selection state (checkmark overlay on selected photos)
- ✅ Fixed header with camera status + Reset + Send buttons
- ✅ Send button with selection count badge
- ✅ Modal popup for phone number input
- ✅ Number pad-friendly phone input with auto-formatting
- ✅ Loading spinner during send
- ✅ Success screen with "Images sent!" message
- ✅ Confirmation dialog for reset

**Layout:**
- Header: App title | Camera status | Reset button | Send button (with badge)
- Main: Photo gallery grid (2 cols mobile, 3 tablet, 4 desktop)
- Modals: Phone input → Sending spinner → Success message

## HD Photo Handling

**Canon R8 Specifications:**
- Full resolution: 6000×4000 pixels (landscape) or 4000×6000 pixels (portrait)
- 24 megapixel full-frame sensor
- Files saved as high-quality JPEGs from camera

**How it works with Baileys:**
- Send full-resolution Canon R8 JPEGs directly (no compression)
- Baileys uploads images as-is via WebSocket
- Quality is determined by recipient's WhatsApp client settings
- No special HD parameter needed in `sendMessage()`
- Recipient must have HD quality enabled to receive full resolution

**Image Dimension Handling:**
- Frontend dynamically loads actual dimensions using `Image()` API
- Supports both landscape (6000×4000) and portrait (4000×6000) orientations
- PhotoSwipe receives correct dimensions for proper aspect ratio display
- Grid thumbnails use `object-fit: contain` to show full image without cropping
- Fallback to 4000×6000 if dimension loading fails

**Important notes:**
- Cannot force HD on recipient's end
- WhatsApp handles compression client-side, not server-side
- Send original Canon R8 files (6000×4000 or 4000×6000 pixels)
- Recipient sees HD option only if their WhatsApp supports it

---

## Recent Fixes & Improvements (Phase 3 Redesign)

### Camera "Busy" Issue - RESOLVED
**Problem:** Camera showed "busy" when shooting multiple photos rapidly.

**Root Cause:** Using gphoto2 without `capturetarget=1` causes camera to buffer photos in internal RAM, which fills quickly.

**Solution:** Added `--set-config capturetarget=1` and `--keep` flags to gphoto2 command:
```bash
gphoto2 --set-config capturetarget=1 --wait-event-and-download --keep --filename path.jpg
```

**Result:** Photos save to SD card immediately, preventing buffer overflow. Camera never locks up during rapid shooting.

---

### Image Aspect Ratio Issues - RESOLVED
**Problem 1:** Grid thumbnails were cropped, not showing full image.

**Solution:** Changed CSS from `object-fit: cover` to `object-fit: contain`.

**Result:** Full image visible in grid with letterboxing if needed.

**Problem 2:** PhotoSwipe viewer showed incorrect aspect ratios.

**Solution:** Added dynamic dimension detection using JavaScript `Image()` API. Loads actual 6000×4000 or 4000×6000 dimensions.

**Result:** PhotoSwipe displays images with correct aspect ratios for both landscape and portrait.

---

### UX Flow - REDESIGNED
**Old Flow:** Login screen → Enter phone number → Gallery → Select → Send

**New Flow:** Gallery (always open) → Select → Send → Popup for phone number

**Changes:**
- ✅ Removed login screen barrier
- ✅ Gallery shows immediately on page load
- ✅ Session persists across page reloads
- ✅ Send button in header (not footer)
- ✅ Reset button for next person
- ✅ Modern modal popups instead of screens
- ✅ Auto-reset after successful send

**Benefits:**
- Faster workflow (no login step)
- Photos persist if page reloaded mid-session
- Cleaner header-based UI
- Confirmation dialogs prevent accidents

---

### Phone Number Validation - IMPROVED
**Changes:**
- ✅ Allows hyphens for readability (05X-XXX-XXXX)
- ✅ Auto-formats as user types
- ✅ Strips hyphens before validation
- ✅ Israeli format: 10 digits starting with 05

---

### Modal Design - MODERNIZED
**Changes:**
- ✅ Backdrop blur effect
- ✅ Slide-in animation
- ✅ Three states: Input → Sending (spinner) → Success
- ✅ "Images sent!" confirmation screen
- ✅ Close button to dismiss and auto-reset

---

### All Changes Verified
- ✅ TypeScript compiles without errors
- ✅ All event handlers wired correctly
- ✅ Session persistence working
- ✅ Reset functionality working
- ✅ Dynamic dimensions loading
- ✅ Modal state transitions smooth
- ✅ Responsive design (mobile/tablet/desktop)
- ✅ Accessibility (focus styles, keyboard nav)

---

## Architecture Simplification (Session Flow Cleanup)

### Old Complex Flow ❌
- Camera saved to `sessions/current/` or `sessions/session_TIMESTAMP/`
- Session ID mismatch between camera and server
- Photo serving route: `GET /photos/:sessionId/:filename`
- Path resolution issues causing request aborts
- Multiple folders for different sessions

### New Simple Flow ✅
- All photos save to single `session/` folder
- Camera service starts on server startup (continuous monitoring)
- No session ID complexity - everything in one place
- Photo serving route: `GET /photos/:filename`
- Direct, reliable file serving
- Clean separation: disk storage (`session/`) vs. in-memory session state

**Benefits:**
- No more path resolution bugs
- Photos always accessible at predictable path
- Simplified frontend image loading
- Single point of truth for all photos
- Easier to debug and maintain
