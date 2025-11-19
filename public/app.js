// ================================
// App State
// ================================
const state = {
    socket: null,
    lightbox: null,
    photos: [], // [{filename, path, selected, width, height}]
    cameraConnected: false
};

// ================================
// DOM Elements
// ================================
const elements = {
    // Header
    // connectionStatus removed
    connectionWarning: document.getElementById('connectionWarning'),
    toastContainer: document.getElementById('toastContainer'),

    // Bottom Action Bar
    bottomActionBar: document.getElementById('bottomActionBar'),
    resetBtn: document.getElementById('resetBtn'),
    sendBtn: document.getElementById('sendBtn'),
    selectionBadge: document.getElementById('selectionBadge'),

    // Gallery
    emptyState: document.getElementById('emptyState'),
    photoGallery: document.getElementById('photoGallery'),
    photoGrid: document.getElementById('photoGrid'),

    // Phone Modal
    phoneModal: document.getElementById('phoneModal'),
    phoneInputState: document.getElementById('phoneInputState'),
    sendingState: document.getElementById('sendingState'),
    successState: document.getElementById('successState'),
    phoneForm: document.getElementById('phoneForm'),
    phoneInputModal: document.getElementById('phoneInputModal'),
    phoneErrorModal: document.getElementById('phoneErrorModal'),
    cancelBtn: document.getElementById('cancelBtn'),
    sendSubmitBtn: document.getElementById('sendSubmitBtn'),
    sendingProgress: document.getElementById('sendingProgress'),
    successMessage: document.getElementById('successMessage'),
    closeSuccessBtn: document.getElementById('closeSuccessBtn'),

    // Confirmation Modal
    confirmModal: document.getElementById('confirmModal'),
    confirmCancelBtn: document.getElementById('confirmCancelBtn'),
    confirmResetBtn: document.getElementById('confirmResetBtn'),

    // QR Modal
    qrModal: document.getElementById('qrModal'),
    qrContainer: document.getElementById('qrContainer'),
    qrStatus: document.getElementById('qrStatus'),
    qrCancelBtn: document.getElementById('qrCancelBtn')
};

// ================================
// Toast Notification System
// ================================
class ToastSystem {
    static show(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        // Icons based on type
        let iconSvg = '';
        if (type === 'success') {
            iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        } else if (type === 'error') {
            iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
        } else {
            iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
        }

        toast.innerHTML = `
            <div class="toast-icon">${iconSvg}</div>
            <span class="toast-message">${message}</span>
        `;

        elements.toastContainer.appendChild(toast);

        // Remove after delay
        setTimeout(() => {
            toast.classList.add('hiding');
            toast.addEventListener('animationend', () => {
                toast.remove();
            });
        }, 3000);
    }
}

// ================================
// Utility Functions
// ================================

// Haptic Feedback
function triggerHaptic() {
    if (navigator.vibrate) {
        navigator.vibrate(10); // Light tap
    }
}

// Load image dimensions dynamically
function getImageDimensions(src) {
    return new Promise((resolve) => {
        const img = new Image();
        const cleanup = () => {
            img.onload = null;
            img.onerror = null;
            img.src = '';
        };
        img.onload = () => {
            const dims = { width: img.naturalWidth, height: img.naturalHeight };
            cleanup();
            resolve(dims);
        };
        img.onerror = () => {
            cleanup();
            resolve({ width: 4000, height: 6000 });
        };
        img.src = src;
    });
}

// ================================
// Local Storage Persistence
// ================================
function saveState() {
    const selectedFilenames = state.photos
        .filter(p => p.selected)
        .map(p => p.filename);
    localStorage.setItem('selectedPhotos', JSON.stringify(selectedFilenames));
}

function loadState() {
    try {
        const saved = localStorage.getItem('selectedPhotos');
        return saved ? JSON.parse(saved) : [];
    } catch (e) {
        console.error('Error loading state:', e);
        return [];
    }
}

function clearState() {
    localStorage.removeItem('selectedPhotos');
}

// ================================
// Socket.io Initialization
// ================================
function initSocket() {
    state.socket = io();

    state.socket.on('connect', () => {
        console.log('Connected to server');
        updateConnectionStatus(true);
        ToastSystem.show('Connected to server', 'success');
        state.socket.emit('client:request-photos');
    });

    state.socket.on('disconnect', () => {
        console.log('Disconnected from server');
        updateConnectionStatus(false);

        if (!elements.sendingState.classList.contains('hidden')) {
            ToastSystem.show('Connection lost. Please try again.', 'error');
            closePhoneModal();
        }
        ToastSystem.show('Reconnecting...', 'error');
    });

    state.socket.on('camera-status', (data) => {
        // We can add specific camera status UI if needed, 
        // but for now we assume server connection implies system health
        state.cameraConnected = data.connected;
    });

    state.socket.on('photo-captured', async (data) => {
        console.log('Photo received:', data);
        await addPhoto(data);
    });

    state.socket.on('session-reset', () => {
        handleSessionReset();
    });

    state.socket.on('send-progress', (data) => {
        elements.sendingProgress.textContent = `${data.current} of ${data.total}`;
    });

    state.socket.on('send-complete', (data) => {
        if (data.success) {
            showModalState('success');
            elements.successMessage.textContent = `${data.count} photo${data.count > 1 ? 's' : ''} sent successfully`;
            triggerHaptic();
        } else {
            ToastSystem.show(data.error || 'Failed to send photos.', 'error');
            closePhoneModal();
        }
    });

    state.socket.on('whatsapp-qr', (data) => {
        console.log('QR Code received', data);
        showQRModal(data.qr, data.attempt);
    });

    state.socket.on('whatsapp-status', (data) => {
        if (data.connected) {
            closeQRModal();
            ToastSystem.show('WhatsApp Connected!', 'success');
        }
    });
}

function updateConnectionStatus(connected) {
    if (connected) {
        elements.connectionWarning.classList.add('hidden');
    } else {
        elements.connectionWarning.classList.remove('hidden');
    }
}

// ================================
// Phone Number Validation
// ================================
function validatePhoneNumber(phone) {
    const cleaned = phone.replace(/[\s-]/g, '');
    const israeliRegex = /^05\d{8}$/;

    if (!israeliRegex.test(cleaned)) {
        return { valid: false, error: 'Invalid format. Use: 05X-XXX-XXXX' };
    }
    return { valid: true, cleaned: cleaned };
}

function formatPhoneNumber(value) {
    const digits = value.replace(/\D/g, '');
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

elements.phoneInputModal.addEventListener('input', (e) => {
    const formatted = formatPhoneNumber(e.target.value);
    e.target.value = formatted;
    elements.phoneErrorModal.classList.remove('visible');
});

// ================================
// Session Management
// ================================
function resetSession() {
    closeConfirmModal();
    state.socket.emit('client:reset-session');
}

function handleSessionReset() {
    state.photos = [];
    clearState();
    updatePhotoGallery();
    updateSelectionCount();
    updateSendButton();
    ToastSystem.show('Session reset', 'info');
}

// ================================
// Photo Gallery (PhotoSwipe)
// ================================
function initPhotoSwipe() {
    const lightbox = new PhotoSwipeLightbox({
        gallery: '#photoGrid',
        children: 'a', // This targets the anchor tag in our card
        pswpModule: PhotoSwipe,
        pinchToClose: true,
        closeOnVerticalDrag: true,
        bgOpacity: 0.95,
        zoom: false, // Disable default zoom button
        maxZoomLevel: 4,
        doubleTapAction: 'zoom',
        bgClickAction: 'close', // Click outside to close
        tapAction: 'close', // Tap on image to close (can be changed if zoom is preferred on tap)
        paddingFn: () => ({ top: 30, bottom: 30, left: 10, right: 10 })
    });

    // Add Custom Select Button
    lightbox.on('uiRegister', () => {
        lightbox.pswp.ui.registerElement({
            name: 'select-button',
            order: 9, // Place it where zoom usually is
            isButton: true,
            tagName: 'button',
            html: `
                <div class="pswp-select-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                </div>
            `,
            onClick: (event, el, pswp) => {
                const currIndex = pswp.currIndex;
                // We need to map pswp index to our photos array
                // Since we render in reverse order, but PhotoSwipe reads DOM order:
                // DOM order: [Newest ... Oldest]
                // State photos: [Oldest ... Newest]
                // So DOM index 0 corresponds to State index (length - 1)

                // Wait, let's verify createPhotoCard logic:
                // createPhotoCard uses `state.photos.length - 1 - reverseIndex` as the index.
                // The DOM is appended in reverse order loop.
                // So the first element in DOM (index 0) corresponds to the last element in state.photos.

                // However, PhotoSwipe uses the index of the clicked element relative to the gallery.
                // So pswp.currIndex 0 is the first image in the grid (Newest).

                // Let's find the photo index from the DOM element
                const slide = pswp.currSlide;
                // The slide data comes from the anchor tag.
                // We can look up the photo by src or by calculating the index.

                // Easiest way: The DOM elements are in order 0..N in the grid.
                // The grid children correspond to pswp indices.
                // Grid child 0 is the newest photo.
                // Grid child 0 has data-index = (total - 1).

                const gridChildren = Array.from(elements.photoGrid.children);
                const activeElement = gridChildren[currIndex];
                const originalIndex = parseInt(activeElement.dataset.index, 10);

                togglePhotoSelection(originalIndex);

                // Update the button state immediately
                updatePhotoSwipeSelectButton(el, originalIndex);
            }
        });
    });

    // Update button state when slide changes
    lightbox.on('change', () => {
        const pswp = lightbox.pswp;
        const currIndex = pswp.currIndex;
        const gridChildren = Array.from(elements.photoGrid.children);
        const activeElement = gridChildren[currIndex];
        if (activeElement) {
            const originalIndex = parseInt(activeElement.dataset.index, 10);

            // Find the button element in the UI
            const btn = pswp.element.querySelector('.pswp__button--select');
            if (btn) {
                updatePhotoSwipeSelectButton(btn, originalIndex);
            }
        }
    });

    lightbox.init();
    state.lightbox = lightbox;
}

function updatePhotoSwipeSelectButton(btnElement, photoIndex) {
    const photo = state.photos[photoIndex];
    if (photo && photo.selected) {
        btnElement.classList.add('selected');
    } else {
        btnElement.classList.remove('selected');
    }
}

async function addPhoto(photoData) {
    if (state.photos.some(p => p.filename === photoData.filename)) return;

    const dimensions = await getImageDimensions(photoData.path);
    const savedSelections = loadState();
    const isSelected = savedSelections.includes(photoData.filename);

    const photo = {
        filename: photoData.filename,
        path: photoData.path,
        selected: isSelected,
        width: dimensions.width,
        height: dimensions.height
    };
    state.photos.push(photo);

    updatePhotoGallery();
    updateSelectionCount();
    updateSendButton();
}

function updatePhotoGallery() {
    if (state.photos.length > 0) {
        elements.emptyState.classList.add('hidden');
        updateBottomBar();
    } else {
        elements.emptyState.classList.remove('hidden');
        updateBottomBar();
    }

    elements.photoGrid.innerHTML = '';

    // Reverse order to show newest first
    [...state.photos].reverse().forEach((photo, reverseIndex) => {
        // Calculate original index
        const index = state.photos.length - 1 - reverseIndex;
        const photoCard = createPhotoCard(photo, index, reverseIndex);
        elements.photoGrid.appendChild(photoCard);
    });
}

function createPhotoCard(photo, index, reverseIndex = 0) {
    const wrapper = document.createElement('div');
    wrapper.className = 'photo-card-wrapper';
    wrapper.dataset.index = index; // Store index for easy access
    if (photo.selected) wrapper.classList.add('selected');

    // Add staggered animation delay
    wrapper.style.animationDelay = `${reverseIndex * 0.05}s`;

    // Main interaction: Toggle Selection
    wrapper.addEventListener('click', (e) => {
        // If clicking the expand button, don't toggle selection
        if (e.target.closest('.expand-btn')) return;

        togglePhotoSelection(index);
    });

    wrapper.innerHTML = `
        <img src="${photo.path}" alt="${photo.filename}" loading="lazy">
        
        <div class="selection-indicator">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"/>
            </svg>
        </div>

        <!-- Expand Button triggers PhotoSwipe -->
        <button class="expand-btn" aria-label="View photo">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
            </svg>
        </button>

        <!-- Hidden Anchor for PhotoSwipe data source -->
        <a href="${photo.path}" 
           data-pswp-width="${photo.width}" 
           data-pswp-height="${photo.height}" 
           target="_blank" 
           class="pswp-link"
           style="display:none;"></a>
    `;

    // Handle Expand Click
    const expandBtn = wrapper.querySelector('.expand-btn');
    expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Open PhotoSwipe programmatically at this index
        // We need to map our reverse-order index to the lightbox index if needed,
        // but since we're rendering in reverse, the DOM order matches the visual order.
        // However, PhotoSwipe expects the index based on the DOM elements matching the gallery selector.

        // Find the actual DOM index of this wrapper among all wrappers
        const allWrappers = Array.from(elements.photoGrid.children);
        const domIndex = allWrappers.indexOf(wrapper);

        if (state.lightbox) {
            state.lightbox.loadAndOpen(domIndex);
        }
    });

    return wrapper;
}

function togglePhotoSelection(index) {
    const photo = state.photos[index];
    const wasSelected = photo.selected;
    photo.selected = !photo.selected;

    triggerHaptic();
    saveState();

    // OPTIMIZED: Only update the specific card instead of re-rendering the whole gallery
    const cardWrapper = elements.photoGrid.querySelector(`.photo-card-wrapper[data-index="${index}"]`);
    if (cardWrapper) {
        if (photo.selected) {
            cardWrapper.classList.add('selected');
            // Add pulse animation only on first selection
            if (!wasSelected) {
                cardWrapper.classList.add('pulse');
                setTimeout(() => cardWrapper.classList.remove('pulse'), 600);
            }
        } else {
            cardWrapper.classList.remove('selected');
            cardWrapper.classList.remove('pulse');
        }
    } else {
        // Fallback if not found (shouldn't happen)
        updatePhotoGallery();
    }

    updateSelectionCount();
    updateSendButton();
    updateBottomBar();
}

function updateSelectionCount() {
    const count = state.photos.filter(p => p.selected).length;
    elements.selectionBadge.textContent = count;

    // Animate badge
    elements.selectionBadge.classList.remove('pop');
    void elements.selectionBadge.offsetWidth; // Trigger reflow
    elements.selectionBadge.classList.add('pop');
}

function updateSendButton() {
    const hasSelection = state.photos.some(p => p.selected);
    elements.sendBtn.disabled = !hasSelection;
}

function updateBottomBar() {
    // Show bottom bar when there are photos, hide when empty
    if (state.photos.length > 0) {
        elements.bottomActionBar.classList.add('show');
    } else {
        elements.bottomActionBar.classList.remove('show');
    }
}

// ================================
// Modal Management
// ================================
function showPhoneModal() {
    elements.phoneModal.classList.add('show');
    showModalState('input');
    elements.phoneInputModal.value = '';
    elements.phoneInputModal.focus();
}

function closePhoneModal() {
    elements.phoneModal.classList.remove('show');
}

function showModalState(stateName) {
    elements.phoneInputState.classList.add('hidden');
    elements.sendingState.classList.add('hidden');
    elements.successState.classList.add('hidden');

    switch (stateName) {
        case 'input':
            elements.phoneInputState.classList.remove('hidden');
            break;
        case 'sending':
            elements.sendingState.classList.remove('hidden');
            break;
        case 'success':
            elements.successState.classList.remove('hidden');
            break;
    }
}

function showConfirmModal() {
    elements.confirmModal.classList.add('show');
}

function closeConfirmModal() {
    elements.confirmModal.classList.remove('show');
}

// ================================
// QR Modal Management
// ================================
function showQRModal(qrData, attempt) {
    elements.qrModal.classList.add('show');

    // Generate QR code image (using a simple library or just displaying the string if it was an image, 
    // but Baileys sends a string. We need a library to render it.
    // For now, let's assume we can use a public API or a local library.
    // Since we don't have a frontend QR lib installed, we'll use a reliable public API for now 
    // or better yet, we should have installed 'qrcode' on frontend.
    // Given the constraints, I'll use a robust public API for the prototype.

    // NOTE: In a real production app, we should bundle 'qrcode' library.
    // Using goqr.me API for simplicity in this phase.
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qrData)}`;

    elements.qrContainer.innerHTML = `<img src="${qrUrl}" class="qr-image" alt="Scan QR Code">`;
    elements.qrStatus.textContent = `Scan with WhatsApp (Attempt ${attempt})`;
}

function closeQRModal() {
    elements.qrModal.classList.remove('show');
}

// ================================
// Send Photos
// ================================
function sendPhotos(phoneNumber) {
    const selectedPhotos = state.photos
        .filter(p => p.selected)
        .map(p => p.filename);

    if (selectedPhotos.length === 0) {
        ToastSystem.show('Please select at least one photo', 'error');
        return;
    }

    showModalState('sending');
    elements.sendingProgress.textContent = `0 of ${selectedPhotos.length}`;

    state.socket.emit('client:send-photos', {
        phone: phoneNumber,
        photos: selectedPhotos
    });
}

// ================================
// Event Handlers
// ================================
elements.resetBtn.addEventListener('click', showConfirmModal);
elements.confirmCancelBtn.addEventListener('click', closeConfirmModal);
elements.confirmResetBtn.addEventListener('click', resetSession);
elements.qrCancelBtn.addEventListener('click', closeQRModal);

elements.sendBtn.addEventListener('click', () => {
    if (!elements.sendBtn.disabled) showPhoneModal();
});

elements.phoneForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const validation = validatePhoneNumber(elements.phoneInputModal.value);
    if (!validation.valid) {
        elements.phoneErrorModal.textContent = validation.error;
        elements.phoneErrorModal.classList.add('visible');
        return;
    }
    sendPhotos(validation.cleaned);
});

elements.cancelBtn.addEventListener('click', closePhoneModal);
elements.closeSuccessBtn.addEventListener('click', closePhoneModal);

// ================================
// App Initialization
// ================================
function init() {
    console.log('Initializing portrait-mate app...');
    initSocket();
    initPhotoSwipe();
    console.log('App initialized');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
