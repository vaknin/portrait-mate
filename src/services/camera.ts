import { exec, spawn } from 'node:child_process';
import { mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { logger } from '../logger.js';

const execAsync = promisify(exec);

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
  private connectionState: CameraConnectionState = CameraConnectionState.DISCONNECTED;
  private isShuttingDown = false;
  private isBusy = false; // Prevents concurrent operations
  private pollInterval: NodeJS.Timeout | null = null;
  private readonly POLL_MS = 2000;
  private sessionStartTime: Date;
  private clockDrift = 0; // Difference between Camera Time and System Time (ms)

  constructor(cfg?: CameraServiceConfig) {
    super();
    this.gphoto2Path = cfg?.gphoto2Path || config.GPHOTO2_PATH || 'gphoto2';
    this.sessionStartTime = new Date();
  }

  /**
   * Start monitoring the camera (called once on server startup)
   */
  async start(): Promise<void> {
    // Create session directory
    const sessionDir = config.PHOTOS_DIR;
    await mkdir(sessionDir, { recursive: true });

    logger.info(`[Camera] Service started. Waiting for camera connection... (Session start: ${this.sessionStartTime.toLocaleTimeString()})`);

    // Start polling
    this.startPolling();
  }

  /**
   * Reset the session time.
   * Any photos taken before NOW will be ignored in future syncs.
   */
  public resetSession(): void {
    this.sessionStartTime = new Date();
    logger.info(`[Camera] Session reset. Ignoring photos taken before ${this.sessionStartTime.toLocaleTimeString()}`);
  }

  /**
   * Stop camera monitoring (called only on server shutdown)
   */
  async stop(): Promise<void> {
    this.isShuttingDown = true;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.connectionState = CameraConnectionState.DISCONNECTED;
    this.emit('status', { connected: false, state: CameraConnectionState.DISCONNECTED });
  }

  /**
   * Start the polling loop
   */
  private startPolling(): void {
    if (this.pollInterval) return;

    this.pollInterval = setInterval(async () => {
      if (this.isShuttingDown || this.isBusy) return;

      try {
        const connected = await this.checkCameraConnected();

        if (connected) {
          if (this.connectionState !== CameraConnectionState.CONNECTED) {
            await this.handleConnection();
          }
        } else {
          if (this.connectionState === CameraConnectionState.CONNECTED) {
            this.handleDisconnection();
          }
        }
      } catch (error) {
        logger.debug(`[Camera] Polling error: ${error}`);
      }
    }, this.POLL_MS);
  }

  /**
   * Check if camera is connected using --auto-detect
   */
  private async checkCameraConnected(): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`${this.gphoto2Path} --auto-detect`);
      // Output typically contains "usb:" if a camera is found
      return stdout.includes('usb:');
    } catch (error) {
      return false;
    }
  }

  /**
   * Handle new camera connection
   */
  private async handleConnection(): Promise<void> {
    logger.info('[Camera] Camera connected! Starting sync...');
    this.setConnectionState(CameraConnectionState.CONNECTED);
    this.isBusy = true;

    try {
      // Calculate clock drift on connection (with retries)
      await this.calculateClockDrift();
      await this.syncNewPhotos();
    } catch (error) {
      logger.error(`[Camera] Sync error: ${error}`);
      this.emit('error', { message: 'Failed to sync photos' });
    } finally {
      this.isBusy = false;
      logger.info('[Camera] Sync complete. Waiting for next connection...');
    }
  }

  /**
   * Calculate the time difference between Camera and System.
   * Positive drift means Camera is AHEAD of System.
   * Retries up to 3 times to handle camera busy states.
   */
  private async calculateClockDrift(): Promise<void> {
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        // Small delay to ensure camera is ready
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const { stdout } = await execAsync(`${this.gphoto2Path} --get-config /main/settings/datetime`);
        // Output: "Printable: Wed 19 Nov 2025 03:48:53 PM IST"
        const match = stdout.match(/Printable:\s+(.+)/);
        if (match && match[1]) {
          // Strip timezone abbreviation (e.g. IST) to parse as local time
          const cleanDateStr = match[1].replace(/ [A-Z]{3}$/, '');
          const cameraTime = new Date(cleanDateStr);

          if (!isNaN(cameraTime.getTime())) {
            const systemTime = new Date();
            this.clockDrift = cameraTime.getTime() - systemTime.getTime();
            logger.info(`[Camera] Clock Drift: ${this.clockDrift}ms (Camera is ${this.clockDrift > 0 ? 'ahead' : 'behind'})`);
            return; // Success
          }
        }
      } catch (error) {
        attempts++;
        logger.warn(`[Camera] Failed to calculate clock drift (attempt ${attempts}/${maxAttempts}): ${error}`);
      }
    }

    logger.warn('[Camera] Could not calculate clock drift after multiple attempts. Assuming 0ms.');
    this.clockDrift = 0;
  }



  /**
   * Handle camera disconnection
   */
  private handleDisconnection(): void {
    logger.info('[Camera] Camera disconnected');
    this.setConnectionState(CameraConnectionState.DISCONNECTED);
  }

  /**
   * Sync only new photos taken after server start
   */
  private async syncNewPhotos(): Promise<void> {
    // 1. Get total number of files
    const totalFiles = await this.getTotalFiles();
    if (totalFiles === 0) {
      logger.debug('[Camera] No files on camera.');
      return;
    }

    logger.debug(`[Camera] Found ${totalFiles} files. Scanning for new photos...`);

    // 2. Find the first new photo (backward scan)
    const firstNewIndex = await this.findFirstNewPhotoIndex(totalFiles);

    if (!firstNewIndex) {
      logger.debug('[Camera] No new photos found.');
      return;
    }

    logger.info(`[Camera] Found new photos from index ${firstNewIndex} to ${totalFiles}`);

    // 3. Download the range
    await this.downloadRange(firstNewIndex, totalFiles);
  }

  /**
   * Get total number of files on camera
   * Uses --list-files because --num-files often returns 0 for subfolders
   */
  private async getTotalFiles(): Promise<number> {
    try {
      const { stdout } = await execAsync(`${this.gphoto2Path} --list-files`);
      // Output example:
      // ...
      // #1     IMG_0001.JPG ...
      // #2     IMG_0002.JPG ...

      // Find all occurrences of #Number
      const matches = [...stdout.matchAll(/#(\d+)\s+/g)];
      if (matches.length === 0) return 0;

      // The last match should be the highest number
      const lastMatch = matches[matches.length - 1];
      return lastMatch && lastMatch[1] ? parseInt(lastMatch[1], 10) : 0;
    } catch (error) {
      logger.error(`[Camera] Error getting file count: ${error}`);
      return 0;
    }
  }

  /**
   * Find the index of the first photo taken after serverStartTime
   * Scans backwards from totalFiles
   */
  private async findFirstNewPhotoIndex(totalFiles: number): Promise<number | null> {
    const MAX_SCAN_DEPTH = 50; // Optimization: only check last 50 photos
    const stopIndex = Math.max(1, totalFiles - MAX_SCAN_DEPTH);

    for (let i = totalFiles; i >= stopIndex; i--) {
      try {
        const info = await this.getFileInfo(i);
        if (!info) continue;

        // Check 1: Is it older than session start?
        if (info.time < this.sessionStartTime) {
          return i === totalFiles ? null : i + 1;
        }

        // Check 2: Do we already have it?
        // We check if the file exists in the session directory
        const alreadyExists = await this.checkFileExists(info.filename);
        if (alreadyExists) {
          // We found a file we already have.
          // Assuming sequential order, the NEXT one (i+1) is the first one we DON'T have.
          return i === totalFiles ? null : i + 1;
        }

        // If neither, it's a new, un-downloaded photo. Continue scanning backwards.
      } catch (error) {
        logger.warn(`[Camera] Failed to get info for file ${i}: ${error}`);
      }
    }

    // If we scanned everything and didn't find an old/existing photo, assume everything from stopIndex is new.
    return stopIndex;
  }

  /**
   * Get file info (time and filename) for a file index
   */
  private async getFileInfo(index: number): Promise<{ time: Date; filename: string } | null> {
    try {
      const { stdout } = await execAsync(`${this.gphoto2Path} --show-info ${index}`);
      // Output example:
      // Information on file 'IMG_1234.JPG' (folder '/...'):
      // ...
      // Time: Wed Nov 19 15:00:00 2025
      // ...

      const timeMatch = stdout.match(/Time:\s+(.+)/);
      const fileMatch = stdout.match(/Information on file '([^']+)'/);

      if (timeMatch && timeMatch[1] && fileMatch && fileMatch[1]) {
        const date = new Date(timeMatch[1]);
        const filename = fileMatch[1];
        // logger.debug(`[Camera] Parsed info: ${filename} (${date.toISOString()})`);
        if (!isNaN(date.getTime())) {
          // Fix: gphoto2 treats camera time as UTC and converts to local, causing double offset.
          // We need to reverse this by adding the timezone offset (which is negative for UTC+).
          // Example: Camera 15:00 -> gphoto2 thinks 15:00 UTC -> Prints 17:00 (UTC+2)
          // We parse 17:00. We want 15:00.
          // offset is -120. 17:00 + (-120min) = 15:00.
          const originalTime = new Date(date);
          date.setMinutes(date.getMinutes() + date.getTimezoneOffset());

          // Apply clock drift correction
          // If camera is ahead (drift > 0), we subtract drift to get "System Time" equivalent
          const correctedTime = new Date(date.getTime() - this.clockDrift);

          logger.info(`[Camera] File ${filename}: Raw=${originalTime.toLocaleTimeString()} Corrected=${correctedTime.toLocaleTimeString()} (Drift=${this.clockDrift}ms) SessionStart=${this.sessionStartTime.toLocaleTimeString()}`);
          return { time: correctedTime, filename };
        }
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if a file exists in the photos directory
   */
  private async checkFileExists(filename: string): Promise<boolean> {
    try {
      await access(join(config.PHOTOS_DIR, filename));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Download a range of files
   */
  private async downloadRange(start: number, end: number): Promise<void> {
    const sessionDir = config.PHOTOS_DIR;
    // Use original filename (%f) and extension (%C)
    // This prevents duplicates if we download the same file again (it overwrites)
    // But our logic above should prevent re-downloading anyway.
    const filenamePattern = join(sessionDir, '%f.%C');

    // Command: gphoto2 --get-file 1-5 --filename ...
    const args = [
      '--get-file',
      `${start}-${end}`,
      '--filename',
      filenamePattern,
      '--force-overwrite', // Safety
    ];

    logger.info(`[Camera] Downloading files ${start}-${end}...`);

    return new Promise((resolve, reject) => {
      const process = spawn(this.gphoto2Path, args);

      process.stdout.on('data', (data: Buffer) => {
        const output = data.toString();
        const lines = output.split('\n');
        for (const line of lines) {
          if (line.includes('Saving file as')) {
            this.parseDownloadEvent(line);
          }
        }
      });

      process.stderr.on('data', (data: Buffer) => {
        const error = data.toString();
        if (error.includes('ERROR')) {
          logger.debug(`[Camera] Download stderr: ${error}`);
        }
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Download process exited with code ${code}`));
        }
      });
    });
  }

  /**
   * Parse download event and emit photo captured
   */
  private parseDownloadEvent(line: string): void {
    // Example: "Saving file as sessions/photo_123456.jpg"
    const match = line.match(/Saving file as (.+\.jpe?g)/i);

    if (!match || !match[1]) {
      return;
    }

    const fullPath = match[1];
    const filename = fullPath.split('/').pop() || '';
    const photoPath = `/photos/${filename}`;

    logger.info(`[Camera] Downloaded: ${filename}`);

    // Emit event immediately (file is written by gphoto2 before printing this line usually,
    // but we can add a small check if needed. gphoto2 usually finishes write before log).
    this.emit('photo', {
      filename,
      path: photoPath,
    });
  }

  /**
   * Update connection state and emit to clients
   */
  private setConnectionState(state: CameraConnectionState): void {
    if (this.connectionState !== state) {
      this.connectionState = state;
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

  // No-op methods for compatibility if needed, or remove them
  public pause(): void { }
  public resume(): void { }
}
