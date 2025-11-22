import sharp from 'sharp';
import { join, basename, extname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { config } from '../config.js';
import { logger } from '../logger.js';

export class ImageService {
  private thumbnailDir: string;

  constructor() {
    this.thumbnailDir = join(config.PHOTOS_DIR, 'thumbnails');
  }

  async init(): Promise<void> {
    await mkdir(this.thumbnailDir, { recursive: true });
  }

  async generateThumbnail(filePath: string): Promise<string | null> {
    try {
      const filename = basename(filePath);
      const ext = extname(filename);
      const name = filename.replace(ext, '');
      const thumbnailFilename = `${name}_thumb${ext}`;
      const thumbnailPath = join(this.thumbnailDir, thumbnailFilename);

      await sharp(filePath)
        .rotate() // Auto-rotate based on EXIF orientation
        .resize(800, null, { withoutEnlargement: true }) // Width only, height auto-scales to maintain aspect ratio
        .jpeg({ quality: 80 })
        .toFile(thumbnailPath);

      // logger.debug(`[Image] Generated thumbnail: ${thumbnailFilename}`);
      return thumbnailFilename;
    } catch (error) {
      logger.error(`[Image] Error generating thumbnail for ${filePath}: ${error}`);
      return null;
    }
  }

  getThumbnailPath(filename: string): string {
    const ext = extname(filename);
    const name = filename.replace(ext, '');
    return join(this.thumbnailDir, `${name}_thumb${ext}`);
  }
}
