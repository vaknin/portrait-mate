import express from 'express';
import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CameraService } from './services/camera.ts';
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
const PHOTOS_DIR = './sessions';
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

// Middleware
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

// In-memory photo storage
let currentSession: Session | null = null;

// Start camera monitoring once on server startup
(async () => {
  await cameraService.start();
  console.log('[Camera] Monitoring started on server startup');
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

  if (!currentSession || currentSession.id !== sessionId) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const selectedPhotos = currentSession.photos.filter(p => p.selected);

  if (selectedPhotos.length === 0) {
    return res.status(400).json({ error: 'No photos selected' });
  }

  // TODO: Implement WhatsApp sending in Phase 4
  console.log(`[Send] Would send ${selectedPhotos.length} photos to ${phone}`);

  // Simulate sending (remove in Phase 4)
  const response: SendPhotosResponse = {
    success: true,
    count: selectedPhotos.length,
  };

  io.emit('send-complete', { success: true, count: selectedPhotos.length });

  // End session after sending (camera keeps running)
  currentSession.active = false;

  res.json(response);
});

// Reset session - clear photos and delete files from sessions/current/
app.post('/api/session/reset', async (req, res) => {
  try {
    // Clear in-memory photos
    if (currentSession) {
      currentSession.photos = [];
      currentSession.active = true;
    }

    // Delete all files in sessions/current/ directory
    const { readdir, unlink } = await import('node:fs/promises');
    const sessionDir = join(process.cwd(), 'sessions', 'current');

    try {
      const files = await readdir(sessionDir);
      await Promise.all(
        files.map(file => unlink(join(sessionDir, file)))
      );
      console.log(`[Reset] Deleted ${files.length} photos from sessions/current/`);
    } catch (err) {
      // Directory might not exist yet, that's ok
      console.log('[Reset] No photos to delete');
    }

    res.json({ success: true });
    console.log('[Reset] Session reset complete');
  } catch (error) {
    console.error('[Reset] Error:', error);
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

// Serve photo files
app.get('/photos/:sessionId/:filename', (req, res) => {
  const { sessionId, filename } = req.params;
  const photoPath = join(__dirname, '..', PHOTOS_DIR, sessionId, filename);

  res.sendFile(photoPath, (err) => {
    if (err) {
      console.error(`[Photos] Error serving ${filename}:`, err);
      // Only send error response if headers haven't been sent yet
      if (!res.headersSent) {
        res.status(404).json({ error: 'Photo not found' });
      }
    }
  });
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
  console.log(`📁 Photos Dir: ${PHOTOS_DIR}`);
  console.log(`🔐 Auth Dir:   ${AUTH_INFO_DIR}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[Server] Shutting down gracefully...');

  // Stop camera service
  await cameraService.stop();

  httpServer.close(() => {
    console.log('[Server] HTTP server closed');
    process.exit(0);
  });
});

// Export for testing
export { app, io, httpServer };
