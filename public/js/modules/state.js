// State Management
export const state = {
    socket: null,
    lightbox: null,
    photos: [], // [{filename, path, selected, width, height}]
    cameraConnected: false,
    whatsappConnected: false
};

export function saveState() {
    const selectedFilenames = state.photos
        .filter(p => p.selected)
        .map(p => p.filename);
    localStorage.setItem('selectedPhotos', JSON.stringify(selectedFilenames));
}

export function loadState() {
    try {
        const saved = localStorage.getItem('selectedPhotos');
        return saved ? JSON.parse(saved) : [];
    } catch (e) {
        console.error('Error loading state:', e);
        return [];
    }
}

export function clearState() {
    localStorage.removeItem('selectedPhotos');
    state.photos = [];
}
