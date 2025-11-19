import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { config } from '../config.js';
import { logger } from '../logger.js';

// Connection states
export enum CameraConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export interface CameraServiceConfig {
  gphoto2Path?: string;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export declare interface CameraService {
  on(
    event: 'status',
    listener: (status: { connected: boolean; state: CameraConnectionState }) => void,
  ): this;
  on(event: 'photo', listener: (data: { filename: string; path: string }) => void): this;
  on(event: 'error', listener: (error: { message: string }) => void): this;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class CameraService extends EventEmitter {
  private gphoto2Path: string;
  private monitorProcess: ChildProcess | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private killTimer: NodeJS.Timeout | null = null;
  private connectionState: CameraConnectionState = CameraConnectionState.DISCONNECTED;
  private isShuttingDown = false;
  private isPaused = false;
  private isChecking = false;
  private readonly reconnectInterval: number = 3000; // Fixed 3 second interval
  private lastLogTime: number = 0;
  private readonly logThrottleInterval: number = 5 * 60 * 1000; // 5 minutes

  constructor(cfg?: CameraServiceConfig) {
    super();
    this.gphoto2Path = cfg?.gphoto2Path || config.GPHOTO2_PATH;
  }

  /**
   * Start monitoring the camera (called once on server startup)
   */
  async start(): Promise<void> {
    // Create session directory
    const sessionDir = config.PHOTOS_DIR;
    await mkdir(sessionDir, { recursive: true });

    // logger.info(`[Camera] Starting camera monitoring`); // Removed for less verbosity

    // Start camera monitoring
    await this.startCameraMonitor();
  }

  /**
   * Stop all active timers (centralized cleanup)
   */
  private stopAllTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.killTimer) {
      clearTimeout(this.killTimer);
      this.killTimer = null;
    }
  }

  /**
   * Stop camera monitoring (called only on server shutdown)
   */
  async stop(): Promise<void> {
    this.isShuttingDown = true;
    this.stopAllTimers();
    if (this.monitorProcess) {
      this.monitorProcess.kill('SIGUSR2');

      // Wait for process to exit
      try {
        await new Promise<void>((resolve, reject) => {
          if (!this.monitorProcess) return resolve();

          const timeout = setTimeout(() => {
            if (this.monitorProcess) {
              this.monitorProcess.kill('SIGTERM');
              resolve();
            }
          }, 5000);

          this.monitorProcess.on('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      } catch (e) {
        logger.error('Error stopping monitor process', e);
      }

      this.monitorProcess = null;
    }
    this.connectionState = CameraConnectionState.DISCONNECTED;
    this.emit('status', { connected: false, state: CameraConnectionState.DISCONNECTED });
  }

  /**
   * Start the gphoto2 monitoring process using event-based approach
   */
  private async startCameraMonitor(): Promise<void> {
    // Check if camera is available BEFORE setting state to CONNECTING
    // This prevents the state flip-flop (DISCONNECTED -> CONNECTING -> DISCONNECTED)
    // which causes repetitive logs during retry loops
    const cameraAvailable = await this.checkCameraAvailable();

    if (!cameraAvailable) {
      // Only log if it's been a while or if it's the first time
      const now = Date.now();
      if (now - this.lastLogTime > this.logThrottleInterval) {
        logger.info('[Camera] Camera not detected, waiting for connection...');
        this.lastLogTime = now;
      } else {
        logger.debug('[Camera] Camera not detected, retrying...');
      }

      // Ensure we are in DISCONNECTED state (might already be)
      if (this.connectionState !== CameraConnectionState.DISCONNECTED) {
        this.setConnectionState(CameraConnectionState.DISCONNECTED);
      }

      this.scheduleReconnect();
      return;
    }

    // Camera is available, NOW we can transition to CONNECTING
    this.setConnectionState(CameraConnectionState.CONNECTING);

    // Start event-based monitoring (includes capturetarget config)
    await this.startEventMonitor();
  }

  /**
   * Start event-based monitoring with gphoto2 --wait-event-and-download
   */
  private async startEventMonitor(): Promise<void> {
    // Clean up any existing monitor process first
    if (this.monitorProcess) {
      logger.debug('[Camera] Cleaning up existing monitor process before restart...');

      // Remove all event listeners to prevent ghost handlers
      this.monitorProcess.removeAllListeners();

      // Kill if still running
      if (!this.monitorProcess.killed) {
        this.monitorProcess.kill('SIGTERM');
      }

      this.monitorProcess = null;
    }

    // Build filename pattern with session directory
    const sessionDir = config.PHOTOS_DIR;
    const filenamePattern = join(sessionDir, 'photo_%H%M%S.jpg');

    const args = [
      '--set-config',
      'capturetarget=1', // Save to SD card
      '--set-config',
      'imageformat=0', // Force JPEG only (not RAW+JPG)
      '--capture-tethered', // Wait for shutter release and download
      '--keep', // Keep files on SD after downloading
      '--filename',
      filenamePattern, // Download JPG to local session/ folder
    ];

    // logger.info(`[Camera] Starting event monitor`);
    logger.debug(`[Camera] Command: ${this.gphoto2Path} ${args.join(' ')}`);

    // Spawn long-running gphoto2 process
    this.monitorProcess = spawn(this.gphoto2Path, args);

    // Monitor stdout for "Saving file as" events
    this.monitorProcess.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      const lines = output.split('\n');

      for (const line of lines) {
        if (line.includes('Saving file as')) {
          this.parsePhotoEvent(line);
        }
      }
    });

    // Monitor stderr for errors
    this.monitorProcess.stderr?.on('data', (data: Buffer) => {
      const error = data.toString();

      // Log errors but don't spam console with normal gphoto2 debug output
      if (error.includes('ERROR') || error.includes('WARNING')) {
        logger.debug(`[Camera] stderr: ${error}`);
      }

      // Check for specific errors
      if (error.toLowerCase().includes('no space left')) {
        logger.error('[Camera] SD card full!');
        this.emit('error', { message: 'SD card full' });
      }
    });

    // Handle process exit (camera disconnected or error)
    this.monitorProcess.on('close', (code) => {
      logger.info(`[Camera] Monitor process exited with code ${code}`);

      // Clear the process reference immediately
      this.monitorProcess = null;

      if (!this.isShuttingDown) {
        logger.info('[Camera] Camera disconnected');
        this.setConnectionState(CameraConnectionState.DISCONNECTED);
        this.scheduleReconnect();
      }
    });

    // Handle process errors
    this.monitorProcess.on('error', (err) => {
      logger.error(`[Camera] Monitor process error: ${err}`);

      // Clear the process reference immediately
      this.monitorProcess = null;

      if (!this.isShuttingDown) {
        this.setConnectionState(CameraConnectionState.ERROR);
        this.scheduleReconnect();
      }
    });

    // Successfully started
    this.setConnectionState(CameraConnectionState.CONNECTED);
    logger.info('[Camera] Connected');
  }

  /**
   * Parse photo capture event from gphoto2 stdout
   * Example: "Saving file as sessions/session_123/photo_143052.jpg"
   */
  private parsePhotoEvent(line: string): void {
    // Check if camera is paused (during reset)
    if (this.isPaused) {
      logger.debug('[Camera] Photo capture paused, skipping event');
      return;
    }

    // Extract filename from gphoto2 output
    const match = line.match(/Saving file as (.+\.jpe?g)/i);

    if (!match || !match[1]) {
      return;
    }

    const fullPath = match[1];
    const filename = fullPath.split('/').pop() || '';

    // Filter: only process JPG files (skip RAW if camera shoots RAW+JPG)
    if (!/\.jpe?g$/i.test(filename)) {
      logger.debug(`[Camera] Skipping non-JPG file: ${filename}`);
      return;
    }

    const photoPath = `/photos/${filename}`;

    logger.info(`[Camera] Photo captured: ${filename}`);

    // Wait for file to be fully written before notifying
    this.waitForFileAndNotify(fullPath, filename, photoPath);
  }

  /**
   * Wait for file to be fully written, then notify frontend
   */
  private async waitForFileAndNotify(
    fullPath: string,
    filename: string,
    photoPath: string,
  ): Promise<void> {
    const maxRetries = 10;
    const retryDelay = 100; // ms

    for (let i = 0; i < maxRetries; i++) {
      try {
        await access(fullPath);
        // File exists and is accessible

        // Emit event
        this.emit('photo', {
          filename,
          path: photoPath,
        });

        return;
      } catch {
        // File not ready yet, wait and retry
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }

    logger.error(`[Camera] Timeout waiting for file: ${fullPath}`);

    // Emit error
    this.emit('error', {
      message: `Photo file not ready: ${filename}`,
    });
  }

  /**
   * Check if camera is available by performing actual operation
   * Uses --summary which requires camera to be accessible
   */
  private async checkCameraAvailable(): Promise<boolean> {
    // Prevent concurrent checks (gphoto2 uses exclusive locks)
    if (this.isChecking) {
      logger.debug('[Camera] Detection already in progress, skipping');
      return false;
    }

    this.isChecking = true;

    try {
      return await new Promise((resolve) => {
        // Use --summary instead of --auto-detect for more reliable check
        const detect = spawn(this.gphoto2Path, ['--summary']);

        let output = '';
        let errorOutput = '';
        let resolved = false;

        // Handle timeout
        const timeout = setTimeout(() => {
          if (!resolved && !detect.killed) {
            resolved = true;
            detect.kill();
            logger.debug('[Camera] Detection timed out');
            this.isChecking = false;
            resolve(false);
          }
        }, 5000);

        detect.stdout?.on('data', (data: Buffer) => {
          output += data.toString();
        });

        detect.stderr?.on('data', (data: Buffer) => {
          errorOutput += data.toString();
        });

        detect.on('close', (code) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            this.isChecking = false;

            // Check if command succeeded and returned camera info
            const hasCamera = code === 0 && output.length > 0;

            if (hasCamera) {
              logger.debug('[Camera] Camera detected and accessible');
            } else {
              logger.debug('[Camera] Camera not detected or not accessible');
              if (errorOutput) {
                logger.debug(`[Camera] Error: ${errorOutput.substring(0, 200)}`);
              }
            }

            resolve(hasCamera);
          }
        });

        detect.on('error', (err) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            this.isChecking = false;
            logger.debug(`[Camera] Detection error: ${err}`);
            resolve(false);
          }
        });
      });
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Schedule a reconnection attempt with fixed interval
   */
  private scheduleReconnect(): void {
    // Stop all timers first to prevent duplicates
    this.stopAllTimers();

    // Only log if we are debugging, otherwise keep it silent
    logger.debug(`[Camera] Will retry connection in ${this.reconnectInterval / 1000}s`);

    this.reconnectTimer = setTimeout(async () => {
      if (this.isShuttingDown) {
        return;
      }

      // Only log "Attempting to reconnect" if it's been a while
      const now = Date.now();
      if (now - this.lastLogTime > this.logThrottleInterval) {
        logger.info('[Camera] Attempting to reconnect...');
        this.lastLogTime = now;
      } else {
        logger.debug('[Camera] Attempting to reconnect...');
      }

      await this.startCameraMonitor();
    }, this.reconnectInterval);
  }

  /**
   * Update connection state and emit to clients
   */
  private setConnectionState(state: CameraConnectionState): void {
    if (this.connectionState !== state) {
      const oldState = this.connectionState;
      this.connectionState = state;
      // logger.info(`[Camera] State: ${oldState} → ${state}`);

      // Emit status change
      this.emit('status', {
        connected: state === CameraConnectionState.CONNECTED,
        state: state,
      });
    }
  }

  /**
   * Get current connection status
   */
  public getStatus(): { connected: boolean; state: string } {
    return {
      connected: this.connectionState === CameraConnectionState.CONNECTED,
      state: this.connectionState,
    };
  }

  /**
   * Pause photo capture events (used during session reset)
   */
  public pause(): void {
    this.isPaused = true;
    logger.info('[Camera] Photo capture paused');
  }

  /**
   * Resume photo capture events
   */
  public resume(): void {
    this.isPaused = false;
    logger.info('[Camera] Photo capture resumed');
  }
}
