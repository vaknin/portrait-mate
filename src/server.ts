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

import { SocketController } from './controllers/socketController.js';

import { ImageService } from './services/image.js';

import { ConnectController } from './controllers/connectController.js';

// Initialize services
const cameraService = new CameraService();
const whatsappService = new WhatsAppService({
  io,
  authDir: config.AUTH_INFO_DIR,
});
const imageService = new ImageService();

// Initialize Controllers
const socketController = new SocketController(io, cameraService, whatsappService, imageService);
const connectController = new ConnectController();

// Middleware
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));
app.use('/thumbnails', express.static(join(config.PHOTOS_DIR, 'thumbnails')));
app.use('/photos', express.static(config.PHOTOS_DIR));

// Routes
app.get('/connect', (req, res) => connectController.handleConnect(req, res));

// ==========================================
// Event Wiring
// ==========================================

// Camera Events
cameraService.on('status', (status) => {
  io.emit('camera-status', status);
});

cameraService.on('photo', async (data) => {
  // Generate thumbnail
  const absolutePath = join(config.PHOTOS_DIR, data.filename);
  const thumbnailFilename = await imageService.generateThumbnail(absolutePath);

  // Notify frontend
  io.emit('photo-captured', {
    ...data,
    thumbnail: thumbnailFilename ? `/thumbnails/${thumbnailFilename}` : data.path
  });
});

cameraService.on('error', (error) => {
  io.emit('camera-error', error);
});

// Start services
(async () => {
  try {
    await imageService.init();
    await cameraService.start();
    // logger.info('[Camera] Service started'); // Removed for less verbosity

    await whatsappService.start();
    // logger.info('[WhatsApp] Service started'); // Removed for less verbosity
  } catch (err) {
    logger.error(`[Startup] Error starting services: ${err}`);
  }
})();

// ==========================================
// Socket.io Handlers (Delegated to Controller)
// ==========================================

io.on('connection', (socket) => {
  socketController.handleConnection(socket);
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
