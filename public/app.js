// ================================
// App State
// ================================
const state = {
    socket: null,
    lightbox: null,
    sessionId: null,
    photos: [], // [{filename, path, selected, width, height}]
    cameraConnected: false
};

// ================================
// DOM Elements
// ================================
const elements = {
    // Header
    cameraStatusDot: document.getElementById('cameraStatusDot'),
    cameraStatusText: document.getElementById('cameraStatusText'),
    resetBtn: document.getElementById('resetBtn'),
    sendBtnHeader: document.getElementById('sendBtnHeader'),
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
    confirmResetBtn: document.getElementById('confirmResetBtn')
};

// ================================
// Utility Functions
// ================================

// Toast Notifications
function showToast(message, type = 'error') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Convert phone number to WhatsApp format
function convertToWhatsAppFormat(phone) {
    const cleaned = phone.replace(/[\s-]/g, '');

    if (cleaned.startsWith('0') && cleaned.length === 10) {
        return `972${cleaned.slice(1)}@s.whatsapp.net`;
    }

    if (cleaned.startsWith('+')) {
        return `${cleaned.slice(1)}@s.whatsapp.net`;
    }

    return `${cleaned}@s.whatsapp.net`;
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
            // Default to Canon R8 portrait if load fails
            cleanup();
            resolve({ width: 4000, height: 6000 });
        };

        img.src = src;
    });
}

// ================================
// Socket.io Initialization
// ================================
function initSocket() {
    state.socket = io();

    state.socket.on('connect', () => {
        console.log('Connected to server');
        showToast('Connected to server', 'success');
    });

    state.socket.on('disconnect', () => {
        console.log('Disconnected from server');

        // If in sending state, show error
        if (!elements.sendingState.classList.contains('hidden')) {
            showToast('Connection lost. Please try again.', 'error');
            closePhoneModal();
        }

        // Show reconnecting indicator
        showToast('Reconnecting to server...', 'error');
    });

    // Camera status updates
    state.socket.on('camera-status', (data) => {
        updateCameraStatus(data.connected);
    });

    // Session state (on reconnect or reload)
    state.socket.on('session-state', async (session) => {
        if (session && session.active) {
            state.sessionId = session.id;
            state.photos = session.photos || [];

            // Load dimensions for existing photos
            for (let photo of state.photos) {
                if (!photo.width || !photo.height) {
                    const dims = await getImageDimensions(photo.path);
                    photo.width = dims.width;
                    photo.height = dims.height;
                }
            }

            updatePhotoGallery();
            updateSelectionCount();
            updateSendButton();
        }
    });

    // New photo captured
    state.socket.on('photo-captured', async (data) => {
        console.log('Photo captured:', data);
        await addPhoto(data);
    });

    // Send progress
    state.socket.on('send-progress', (data) => {
        elements.sendingProgress.textContent = `${data.current} of ${data.total}`;
    });

    // Send complete
    state.socket.on('send-complete', (data) => {
        if (data.success) {
            showModalState('success');
            elements.successMessage.textContent = `${data.count} photo${data.count > 1 ? 's' : ''} sent successfully`;
        } else {
            showToast('Failed to send photos. Please try again.', 'error');
            closePhoneModal();
        }
    });
}

// ================================
// Camera Status
// ================================
function updateCameraStatus(connected) {
    state.cameraConnected = connected;

    if (connected) {
        elements.cameraStatusDot.classList.add('connected');
        elements.cameraStatusDot.classList.remove('disconnected');
        elements.cameraStatusText.textContent = 'Camera';
    } else {
        elements.cameraStatusDot.classList.remove('connected');
        elements.cameraStatusDot.classList.add('disconnected');
        elements.cameraStatusText.textContent = 'Camera';
    }
}

// ================================
// Phone Number Validation
// ================================
function validatePhoneNumber(phone) {
    const cleaned = phone.replace(/[\s-]/g, '');
    const israeliRegex = /^05\d{8}$/;

    if (!israeliRegex.test(cleaned)) {
        return {
            valid: false,
            error: 'Invalid format. Use: 05X-XXX-XXXX'
        };
    }

    return {
        valid: true,
        cleaned: cleaned
    };
}

function formatPhoneNumber(value) {
    const digits = value.replace(/\D/g, '');

    if (digits.length <= 3) {
        return digits;
    } else if (digits.length <= 6) {
        return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    } else {
        return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
    }
}

// Auto-format phone input
elements.phoneInputModal.addEventListener('input', (e) => {
    const formatted = formatPhoneNumber(e.target.value);
    e.target.value = formatted;
    elements.phoneErrorModal.classList.remove('visible');
});

// ================================
// Session Management
// ================================
async function startSession() {
    try {
        const response = await fetch('/api/session/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to start session');
        }

        const data = await response.json();
        state.sessionId = data.sessionId;
        state.photos = [];

        console.log(`Session started: ${state.sessionId}`);

    } catch (error) {
        console.error('Error starting session:', error);
        showToast('Failed to start session. Please try again.', 'error');
    }
}

async function resetSession() {
    // Close confirmation modal
    closeConfirmModal();

    try {
        // Call reset endpoint to clear photos from server and delete files
        const response = await fetch('/api/session/reset', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error('Failed to reset session');
        }

        // Clear local UI state
        state.photos = [];
        updatePhotoGallery();
        updateSelectionCount();
        updateSendButton();

        showToast('Session reset', 'info');
    } catch (error) {
        console.error('Reset failed:', error);
        showToast('Failed to reset session', 'error');
    }
}

// ================================
// Photo Gallery (PhotoSwipe)
// ================================
function initPhotoSwipe() {
    const lightbox = new PhotoSwipeLightbox({
        gallery: '#photoGrid',
        children: 'a',
        pswpModule: PhotoSwipe,

        pinchToClose: true,
        closeOnVerticalDrag: true,
        bgOpacity: 0.95,
        zoom: true,
        maxZoomLevel: 4,
        doubleTapAction: 'zoom',

        paddingFn: (viewportSize) => {
            return {
                top: 30,
                bottom: 30,
                left: 10,
                right: 10
            };
        }
    });

    // Add custom select button to PhotoSwipe UI
    lightbox.on('uiRegister', function() {
        lightbox.pswp.ui.registerElement({
            name: 'select-button',
            order: 9, // Position after zoom button
            isButton: true,
            html: '<svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" class="pswp__icn"><path d="M26 6L12 20l-6-6" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
            onClick: (event, el, pswp) => {
                // Get current photo index
                const currentIndex = pswp.currIndex;

                // Toggle selection
                state.photos[currentIndex].selected = !state.photos[currentIndex].selected;

                // Update button visual state
                updateSelectButtonState(el, state.photos[currentIndex].selected);

                // Update gallery UI
                updatePhotoGallery();
                updateSelectionCount();
                updateSendButton();
            }
        });
    });

    // Update select button state when slide changes
    lightbox.on('change', () => {
        const currentIndex = lightbox.pswp.currIndex;
        const selectButton = lightbox.pswp.element.querySelector('.pswp__button--select-button');

        if (selectButton && state.photos[currentIndex]) {
            updateSelectButtonState(selectButton, state.photos[currentIndex].selected);
        }
    });

    // Set initial select button state when lightbox opens
    lightbox.on('afterInit', () => {
        const currentIndex = lightbox.pswp.currIndex;
        const selectButton = lightbox.pswp.element.querySelector('.pswp__button--select-button');

        if (selectButton && state.photos[currentIndex]) {
            updateSelectButtonState(selectButton, state.photos[currentIndex].selected);
        }
    });

    lightbox.init();
    state.lightbox = lightbox;

    return lightbox;
}

// Helper function to update select button visual state
function updateSelectButtonState(buttonElement, isSelected) {
    if (isSelected) {
        buttonElement.classList.add('pswp__button--selected');
        buttonElement.setAttribute('aria-label', 'Deselect photo');
    } else {
        buttonElement.classList.remove('pswp__button--selected');
        buttonElement.setAttribute('aria-label', 'Select photo');
    }
}

async function addPhoto(photoData) {
    // Load image dimensions
    const dimensions = await getImageDimensions(photoData.path);

    // Add to state
    const photo = {
        filename: photoData.filename,
        path: photoData.path,
        selected: false,
        width: dimensions.width,
        height: dimensions.height
    };
    state.photos.push(photo);

    // Update UI
    updatePhotoGallery();
    updateSelectionCount();
    updateSendButton();
}

function updatePhotoGallery() {
    // Hide empty state if we have photos
    if (state.photos.length > 0) {
        elements.emptyState.classList.add('hidden');
    } else {
        elements.emptyState.classList.remove('hidden');
    }

    // Clear existing photos
    elements.photoGrid.innerHTML = '';

    // Add photos to grid
    state.photos.forEach((photo, index) => {
        const photoCard = createPhotoCard(photo, index);
        elements.photoGrid.appendChild(photoCard);
    });
}

function createPhotoCard(photo, index) {
    const wrapper = document.createElement('div');
    wrapper.className = 'photo-card-wrapper';
    if (photo.selected) {
        wrapper.classList.add('selected');
    }

    // Use actual image dimensions for PhotoSwipe
    wrapper.innerHTML = `
        <a href="${photo.path}"
           data-pswp-width="${photo.width}"
           data-pswp-height="${photo.height}"
           class="photo-card ${photo.selected ? 'selected' : ''}"
           target="_blank"
           rel="noopener">
            <img src="${photo.path}"
                 alt="${photo.filename}"
                 width="${photo.width}"
                 height="${photo.height}"
                 loading="lazy"
                 decoding="async">
        </a>
        <button class="photo-checkbox"
                data-index="${index}"
                aria-label="Select photo"
                type="button">
        </button>
    `;

    // Add image error handling
    const img = wrapper.querySelector('img');
    img.onerror = () => {
        console.error('Failed to load image:', photo.path);
        wrapper.classList.add('error');
    };

    // Selection on checkbox click only
    const checkbox = wrapper.querySelector('.photo-checkbox');
    checkbox.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        togglePhotoSelection(index);
    });

    return wrapper;
}

// ================================
// Photo Selection
// ================================
async function togglePhotoSelection(index) {
    const photo = state.photos[index];
    const previousState = photo.selected;
    photo.selected = !photo.selected;

    // Update UI immediately (optimistic update)
    updatePhotoGallery();
    updateSelectionCount();
    updateSendButton();

    // Send to server
    try {
        const response = await fetch(`/api/session/photos/${photo.filename}/select`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                selected: photo.selected
            })
        });

        if (!response.ok) {
            throw new Error('Selection update failed');
        }
    } catch (error) {
        console.error('Error updating selection:', error);

        // Revert and notify user
        photo.selected = previousState;
        updatePhotoGallery();
        updateSelectionCount();
        updateSendButton();

        showToast('Failed to update selection. Please try again.', 'error');
    }
}

function updateSelectionCount() {
    const count = state.photos.filter(p => p.selected).length;
    elements.selectionBadge.textContent = count;
}

function updateSendButton() {
    const hasSelection = state.photos.some(p => p.selected);
    elements.sendBtnHeader.disabled = !hasSelection;
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
// Send Photos
// ================================
async function sendPhotos(phoneNumber) {
    if (!state.sessionId) {
        showToast('Session not initialized', 'error');
        return;
    }

    const selectedCount = state.photos.filter(p => p.selected).length;

    if (selectedCount === 0) {
        showToast('Please select at least one photo', 'error');
        return;
    }

    try {
        showModalState('sending');
        elements.sendingProgress.textContent = `0 of ${selectedCount}`;

        const response = await fetch('/api/session/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                phone: phoneNumber,
                sessionId: state.sessionId
            })
        });

        if (!response.ok) {
            throw new Error('Failed to send photos');
        }

        // Success handled by socket.io event

    } catch (error) {
        console.error('Error sending photos:', error);
        showToast('Failed to send photos. Please try again.', 'error');
        closePhoneModal();
    }
}

// ================================
// Event Handlers
// ================================

// Reset button
elements.resetBtn.addEventListener('click', () => {
    showConfirmModal();
});

// Confirmation modal
elements.confirmCancelBtn.addEventListener('click', closeConfirmModal);
elements.confirmResetBtn.addEventListener('click', resetSession);

// Send button in header
elements.sendBtnHeader.addEventListener('click', () => {
    if (!elements.sendBtnHeader.disabled) {
        showPhoneModal();
    }
});

// Phone modal form
elements.phoneForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const phoneValue = elements.phoneInputModal.value;
    const validation = validatePhoneNumber(phoneValue);

    if (!validation.valid) {
        elements.phoneErrorModal.textContent = validation.error;
        elements.phoneErrorModal.classList.add('visible');
        return;
    }

    sendPhotos(validation.cleaned);
});

// Cancel button
elements.cancelBtn.addEventListener('click', closePhoneModal);

// Close success button
elements.closeSuccessBtn.addEventListener('click', () => {
    closePhoneModal();
    // Session persists after sending - only reset when user clicks Reset button
});

// ================================
// App Initialization
// ================================
async function init() {
    console.log('Initializing Photo Sender app...');

    // Initialize Socket.io
    initSocket();

    // Initialize PhotoSwipe
    initPhotoSwipe();

    // Check for existing session
    try {
        const response = await fetch('/api/session/current');
        const data = await response.json();

        if (data.session && data.session.active) {
            // Load existing session
            state.sessionId = data.session.id;
            state.photos = data.session.photos || [];

            // Load dimensions for existing photos
            for (let photo of state.photos) {
                if (!photo.width || !photo.height) {
                    const dims = await getImageDimensions(photo.path);
                    photo.width = dims.width;
                    photo.height = dims.height;
                }
            }

            updatePhotoGallery();
            updateSelectionCount();
            updateSendButton();

            console.log(`Loaded existing session: ${state.sessionId}`);
        } else {
            // Start new session
            await startSession();
        }
    } catch (error) {
        console.error('Error loading session:', error);
        // Start new session on error
        await startSession();
    }

    console.log('App initialized');
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
