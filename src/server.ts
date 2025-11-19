import express from 'express';
import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readdir, unlink } from 'node:fs/promises';
import { z } from 'zod';

import { config } from './config.js';
import { logger } from './logger.js';
import { CameraService } from './services/camera.js';
import { WhatsAppService } from './services/whatsapp.js';
import type { ClientSendPhotosEvent } from './types/index.js';

// Get current file directory for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Express app
const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer);

// Initialize services
const cameraService = new CameraService();
const whatsappService = new WhatsAppService({
  io,
  authDir: config.AUTH_INFO_DIR,
});

// Middleware
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

// ==========================================
// Event Wiring
// ==========================================

// Camera Events
cameraService.on('status', (status) => {
  io.emit('camera-status', status);
});

cameraService.on('photo', (data) => {
  // Notify frontend directly
  io.emit('photo-captured', data);
});

cameraService.on('error', (error) => {
  io.emit('camera-error', error);
});

// Start services
(async () => {
  try {
    await cameraService.start();
    // logger.info('[Camera] Service started'); // Removed for less verbosity

    await whatsappService.start();
    // logger.info('[WhatsApp] Service started'); // Removed for less verbosity
  } catch (err) {
    logger.error(`[Startup] Error starting services: ${err}`);
  }
})();

// ==========================================
// Helper Functions
// ==========================================

/**
 * Convert phone number to WhatsApp JID format
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

// Validation Schemas
const SendPhotosSchema = z.object({
  phone: z.string().min(10),
  photos: z.array(z.string()),
});

// ==========================================
// Socket.io Handlers (Stateless)
// ==========================================

io.on('connection', (socket) => {
  logger.debug(`[WebSocket] Client connected: ${socket.id}`);

  // Send initial status
  const cameraStatus = cameraService.getStatus();
  socket.emit('camera-status', { connected: cameraStatus.connected });

  const whatsappStatus = whatsappService.getStatus();
  socket.emit('whatsapp-status', { connected: whatsappStatus.connected });

  // Send latest QR code if available (for late-joining clients)
  const latestQR = whatsappService.getLatestQR();
  if (latestQR) {
    socket.emit('whatsapp-qr', latestQR);
    logger.debug(`[WebSocket] Sent existing QR code to ${socket.id}`);
  }

  // 1. Request Photos (Client asks for list on load)
  socket.on('client:request-photos', async () => {
    try {
      const files = await readdir(config.PHOTOS_DIR);
      const jpgFiles = files.filter(
        (f) => f.toLowerCase().endsWith('.jpg') || f.toLowerCase().endsWith('.jpeg'),
      );

      // Send each photo as an event (simulating capture stream)
      // This is simple and reuses the existing frontend logic
      for (const filename of jpgFiles) {
        socket.emit('photo-captured', {
          filename,
          path: `/photos/${filename}`,
        });
      }
      logger.debug(`[WebSocket] Sent ${jpgFiles.length} existing photos to ${socket.id}`);
    } catch (error) {
      logger.error(`[WebSocket] Error listing photos: ${error}`);
    }
  });

  // 2. Send Photos (Client sends list of filenames)
  socket.on('client:send-photos', async (data: ClientSendPhotosEvent) => {
    const validation = SendPhotosSchema.safeParse(data);

    if (!validation.success) {
      logger.warn(`[WebSocket] Invalid send request: ${JSON.stringify(validation.error.format())}`);
      socket.emit('send-complete', {
        success: false,
        count: 0,
        error: 'Invalid request parameters',
      });
      return;
    }

    const { phone, photos } = validation.data;

    if (photos.length === 0) {
      socket.emit('send-complete', { success: false, count: 0, error: 'No photos selected' });
      return;
    }

    const jid = convertToWhatsAppJID(phone);
    logger.info(`[Send] Sending ${photos.length} photos to ${phone}`);

    const photoPaths = photos.map((filename) => join(process.cwd(), 'session', filename));

    try {
      const success = await whatsappService.sendPhotos(jid, photoPaths);

      if (!success) {
        socket.emit('send-complete', {
          success: false,
          count: 0,
          error: 'Failed to send photos',
        });
        return;
      }

      socket.emit('send-complete', { success: true, count: photos.length });
    } catch (error) {
      logger.error(`[Send] Error: ${error}`);
      socket.emit('send-complete', { success: false, count: 0, error: 'Internal server error' });
    }
  });

  // 3. Reset Session (Delete all files)
  socket.on('client:reset-session', async () => {
    try {
      logger.info(`[Reset] Request from ${socket.id}`);
      cameraService.pause();

      const files = await readdir(config.PHOTOS_DIR);
      const jpgFiles = files.filter(
        (f) => f.toLowerCase().endsWith('.jpg') || f.toLowerCase().endsWith('.jpeg'),
      );

      await Promise.all(jpgFiles.map((file) => unlink(join(config.PHOTOS_DIR, file))));

      logger.info(`[Reset] Deleted ${jpgFiles.length} photos`);
      cameraService.resume();

      // Broadcast reset to all clients (so everyone clears their gallery)
      io.emit('session-reset');
    } catch (error) {
      logger.error(`[Reset] Error: ${error}`);
      cameraService.resume();
    }
  });

  socket.on('disconnect', () => {
    logger.debug(`[WebSocket] Client disconnected: ${socket.id}`);
  });
});

// ==========================================
// HTTP Routes (Static & Files Only)
// ==========================================

// Serve photo files
app.get('/photos/:filename', async (req, res) => {
  const { filename } = req.params;

  // Security: prevent directory traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    logger.warn(`[Photos] Invalid filename attempt: ${filename}`);
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const photoPath = join(config.PHOTOS_DIR, filename);

  try {
    const { access } = await import('node:fs/promises');
    await access(photoPath);
    res.sendFile(photoPath, { root: process.cwd() });
  } catch (err) {
    res.status(404).json({ error: 'Photo not found' });
  }
});

// Start server
httpServer.listen(config.PORT, () => {
  logger.info(`Server Started: http://localhost:${config.PORT}`);
});

// Graceful shutdown
const shutdown = async (signal: string) => {
  // logger.info(`\n[Server] ${signal} received. Shutting down gracefully...`);

  const forceExitTimer = setTimeout(() => {
    logger.error('[Server] Force exiting...');
    process.exit(1);
  }, 2000);

  try {
    io.disconnectSockets();
    await Promise.race([cameraService.stop(), new Promise((r) => setTimeout(r, 500))]);
    logger.info('[Camera] Service Stopped');

    await Promise.race([whatsappService.stop(), new Promise((r) => setTimeout(r, 500))]);
    logger.info('[WhatsApp] Service Stopped');

    httpServer.close();

    clearTimeout(forceExitTimer);
    logger.info('[Server] App Stopped');
    process.exit(0);
  } catch (error) {
    logger.error(`[Server] Shutdown error: ${error}`);
    process.exit(1);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { app, io, httpServer };
