import express from 'express';
import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CameraService } from './services/camera.ts';
import { WhatsAppService } from './services/whatsapp.ts';
import type {
  StartSessionResponse,
  SelectPhotoRequest,
  SendPhotosRequest,
  SendPhotosResponse,
  GetSessionResponse,
  Session,
} from './types/index.ts';

// Configuration (hardcoded, no .env needed)
const PORT = 3000;
const AUTH_INFO_DIR = './auth_info';

// Get current file directory for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Express app
const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer);

// Initialize camera service
const cameraService = new CameraService({
  io,
  onPhotoCapture: (filename: string, path: string) => {
    // Add photo to current session
    if (currentSession) {
      currentSession.photos.push({
        filename,
        path,
        selected: false,
        timestamp: Date.now(),
      });
      console.log(`[Session] Photo added to session: ${filename}`);
    }
  },
});

// Initialize WhatsApp service
const whatsappService = new WhatsAppService({
  io,
  authDir: AUTH_INFO_DIR,
});

// Middleware
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

// In-memory photo storage
let currentSession: Session | null = null;

/**
 * Convert phone number to WhatsApp JID format
 * Israeli: 0504203492 → 972504203492@s.whatsapp.net
 * International: +1234567890 → 1234567890@s.whatsapp.net
 */
function convertToWhatsAppJID(phone: string): string {
  const cleaned = phone.replace(/[\s-]/g, '');

  if (cleaned.startsWith('0') && cleaned.length === 10) {
    return `972${cleaned.slice(1)}@s.whatsapp.net`;
  }

  if (cleaned.startsWith('+')) {
    return `${cleaned.slice(1)}@s.whatsapp.net`;
  }

  return `${cleaned}@s.whatsapp.net`;
}

// Start camera and WhatsApp services on server startup
(async () => {
  await cameraService.start();
  console.log('[Camera] Monitoring started on server startup');

  await whatsappService.start();
  console.log('[WhatsApp] Service started on server startup');
})();

// API Routes

// Start a new session (just creates session object, camera already running)
app.post('/api/session/start', async (req, res) => {
  const sessionId = `session_${Date.now()}`;
  currentSession = {
    id: sessionId,
    timestamp: Date.now(),
    photos: [],
    active: true,
  };

  const response: StartSessionResponse = { sessionId };
  res.json(response);

  console.log(`[Session] Started: ${sessionId}`);
});

// Toggle photo selection
app.post('/api/session/photos/:id/select', (req, res) => {
  const photoId = req.params.id;
  const { selected } = req.body as SelectPhotoRequest;

  if (!currentSession) {
    return res.status(404).json({ error: 'No active session' });
  }

  const photo = currentSession.photos.find(p => p.filename === photoId);
  if (!photo) {
    return res.status(404).json({ error: 'Photo not found' });
  }

  photo.selected = selected;
  res.json({ success: true, selected });

  console.log(`[Photo] ${photoId} selection: ${selected}`);
});

// Send selected photos via WhatsApp
app.post('/api/session/send', async (req, res) => {
  const { phone, sessionId } = req.body as SendPhotosRequest;

  // Validate sessionId format
  if (!sessionId || typeof sessionId !== 'string' || !sessionId.startsWith('session_')) {
    return res.status(400).json({ error: 'Invalid session ID' });
  }

  if (!currentSession || currentSession.id !== sessionId) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const selectedPhotos = currentSession.photos.filter(p => p.selected);

  if (selectedPhotos.length === 0) {
    return res.status(400).json({ error: 'No photos selected' });
  }

  // Convert phone to WhatsApp JID format
  const jid = convertToWhatsAppJID(phone);
  console.log(`[Send] Sending ${selectedPhotos.length} photos to ${phone} (JID: ${jid})`);

  // Get absolute file paths for selected photos
  const photoPaths = selectedPhotos.map(photo =>
    join(process.cwd(), 'session', photo.filename)
  );

  try {
    // Send photos via WhatsApp
    const success = await whatsappService.sendPhotos(jid, photoPaths);

    if (!success) {
      const errorResponse: SendPhotosResponse = {
        success: false,
        count: 0,
        error: 'Failed to send photos via WhatsApp',
      };
      io.emit('send-complete', { success: false, count: 0, error: 'Failed to send photos' });
      return res.status(500).json(errorResponse);
    }

    // Success! Emit completion event
    io.emit('send-complete', { success: true, count: selectedPhotos.length });

    // End session after sending (camera keeps running)
    currentSession.active = false;

    const response: SendPhotosResponse = {
      success: true,
      count: selectedPhotos.length,
    };
    res.json(response);

    console.log(`[Send] Successfully sent ${selectedPhotos.length} photos to ${phone}`);
  } catch (error) {
    console.error('[Send] Error sending photos:', error);
    const errorResponse: SendPhotosResponse = {
      success: false,
      count: 0,
      error: 'Internal server error',
    };
    io.emit('send-complete', { success: false, count: 0, error: 'Internal server error' });
    res.status(500).json(errorResponse);
  }
});

// Reset session - clear photos and delete files from session/
app.post('/api/session/reset', async (req, res) => {
  try {
    // Pause camera to prevent race condition during file deletion
    cameraService.pause();

    // Clear in-memory photos
    if (currentSession) {
      currentSession.photos = [];
      currentSession.active = true;
    }

    // Delete all files in session/ directory
    const { readdir, unlink } = await import('node:fs/promises');
    const sessionDir = join(process.cwd(), 'session');

    try {
      const files = await readdir(sessionDir);
      await Promise.all(
        files.map(file => unlink(join(sessionDir, file)))
      );
      console.log(`[Reset] Deleted ${files.length} photos from session/`);
    } catch (err) {
      // Directory might not exist yet, that's ok
      console.log('[Reset] No photos to delete');
    }

    // Resume camera
    cameraService.resume();

    res.json({ success: true });
    console.log('[Reset] Session reset complete');
  } catch (error) {
    console.error('[Reset] Error:', error);

    // Make sure to resume camera even if error occurred
    cameraService.resume();

    res.status(500).json({ error: 'Failed to reset session' });
  }
});

// Get current session
app.get('/api/session/current', (req, res) => {
  const response: GetSessionResponse = {
    session: currentSession,
  };
  res.json(response);
});

// Get camera status
app.get('/api/camera/status', (req, res) => {
  const status = cameraService.getStatus();
  res.json(status);
});

// Get WhatsApp status
app.get('/api/whatsapp/status', (req, res) => {
  const status = whatsappService.getStatus();
  res.json(status);
});

// Serve photo files
app.get('/photos/:filename', async (req, res) => {
  const { filename } = req.params;

  // Security: prevent directory traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    console.warn(`[Photos] Invalid filename attempt: ${filename}`);
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const photoPath = join(process.cwd(), 'session', filename);

  try {
    // Check file exists before sending
    const { access } = await import('node:fs/promises');
    await access(photoPath);

    res.sendFile(photoPath);
  } catch (err) {
    console.error(`[Photos] File not found: ${filename}`);
    res.status(404).json({ error: 'Photo not found' });
  }
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('[WebSocket] Client connected:', socket.id);

  // Send current session state to new client
  if (currentSession) {
    socket.emit('session-state', currentSession);
  }

  // Send camera status to new client
  const cameraStatus = cameraService.getStatus();
  socket.emit('camera-status', { connected: cameraStatus.connected });

  // Send WhatsApp status to new client
  const whatsappStatus = whatsappService.getStatus();
  socket.emit('whatsapp-status', { connected: whatsappStatus.connected });

  socket.on('disconnect', () => {
    console.log('[WebSocket] Client disconnected:', socket.id);
  });
});

// Start server
httpServer.listen(PORT, () => {
  console.log(`\n🚀 Photo-Taker-Sender Server Started`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📱 Mobile UI:  http://localhost:${PORT}`);
  console.log(`🔌 WebSocket:  ws://localhost:${PORT}`);
  console.log(`📁 Photos Dir: ./session`);
  console.log(`🔐 Auth Dir:   ${AUTH_INFO_DIR}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Server] Shutting down gracefully...');

  // Force exit after 2 seconds if shutdown hangs
  const forceExitTimer = setTimeout(() => {
    console.log('[Server] Force exiting...');
    process.exit(1);
  }, 2000);

  try {
    // Disconnect all Socket.io clients
    io.disconnectSockets();

    // Stop camera service
    await Promise.race([
      cameraService.stop(),
      new Promise(resolve => setTimeout(resolve, 500))
    ]);

    // Stop WhatsApp service
    await Promise.race([
      whatsappService.stop(),
      new Promise(resolve => setTimeout(resolve, 500))
    ]);

    // Close HTTP server
    httpServer.close();

    clearTimeout(forceExitTimer);
    console.log('[Server] Shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('[Server] Shutdown error:', error);
    clearTimeout(forceExitTimer);
    process.exit(1);
  }
});

// Export for testing
export { app, io, httpServer };
