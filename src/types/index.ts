// Type definitions for the photo-taker-sender application

export interface Photo {
  filename: string;
  path: string;
  selected: boolean;
  timestamp: number;
}

export interface Session {
  id: string;
  phone?: string;
  timestamp: number;
  photos: Photo[];
  active: boolean;
}

export interface SessionMetadata {
  phone?: string;
  timestamp: number;
  photos: Array<{
    path: string;
    selected: boolean;
  }>;
}

// WebSocket event payloads
export interface PhotoCapturedEvent {
  filename: string;
  path: string;
}

export interface WhatsAppStatusEvent {
  connected: boolean;
}

export interface CameraStatusEvent {
  connected: boolean;
}

export interface SendProgressEvent {
  current: number;
  total: number;
}

export interface SendCompleteEvent {
  success: boolean;
  count: number;
  error?: string;
}

// API request/response types
export interface StartSessionResponse {
  sessionId: string;
}

export interface SelectPhotoRequest {
  selected: boolean;
}

export interface SendPhotosRequest {
  phone: string;
  sessionId: string;
}

export interface SendPhotosResponse {
  success: boolean;
  count: number;
  error?: string;
}

export interface GetSessionResponse {
  session: Session | null;
}
