import { state, clearState } from './state.js';
import { elements, ToastSystem, updateConnectionStatus, showModalState, showQRModal, closeQRModal, closePhoneModal, closeConfirmModal } from './ui-core.js';
import { addPhoto, updatePhotoGallery, updateSelectionCount, updateSendButton, deselectAllPhotos } from './gallery.js';
import { triggerHaptic } from './utils.js';

export function initSocket() {
    state.socket = io();

    state.socket.on('connect', () => {
        console.log('Connected to server');
        updateConnectionStatus(true);
        state.socket.emit('client:request-photos');
        processPendingSends();
    });

    state.socket.on('disconnect', () => {
        console.log('Disconnected from server');
        updateConnectionStatus(false);
    });

    state.socket.on('camera-status', (data) => {
        updateConnectionStatus(data.connected);
    });

    state.socket.on('photo-captured', (data) => {
        addPhoto(data);
    });

    state.socket.on('session-reset', () => {
        clearState();
        updatePhotoGallery();
        updateSelectionCount();
        updateSendButton();
        ToastSystem.show('Session reset', 'info');
    });

    state.socket.on('send-progress', (data) => {
        // Update progress display: "1 of 3", "2 of 3", etc.
        elements.sendingProgress.textContent = `${data.current} of ${data.total}`;
    });

    state.socket.on('send-complete', (data) => {
        if (data.success) {
            showModalState('success');
            // Deselect immediately "behind the scenes"
            deselectAllPhotos();

            // We no longer auto-close the modal, user must click "Done"
        } else {
            closePhoneModal();
            ToastSystem.show(data.error || 'Failed to send photos', 'error');
        }
    });

    state.socket.on('whatsapp-qr', (qr) => {
        showQRModal(qr);
    });

    state.socket.on('whatsapp-status', (data) => {
        // Optional: Handle WhatsApp specific status if needed
        // For now, we might just log it or use it for the send button state
        console.log('WhatsApp status:', data);
    });
}

function processPendingSends() {
    const pending = localStorage.getItem('pendingSends');
    if (pending) {
        const sends = JSON.parse(pending);
        if (sends.length > 0) {
            ToastSystem.show(`Sending ${sends.length} queued requests...`, 'info');
            sends.forEach(data => {
                state.socket.emit('client:send-photos', data);
            });
            localStorage.removeItem('pendingSends');
        }
    }
}

export function resetSession() {
    state.socket.emit('client:reset-session');
    closeConfirmModal();
}

export function sendPhotos(phoneNumber) {
    const selectedPhotos = state.photos
        .filter(p => p.selected)
        .map(p => p.filename);

    if (selectedPhotos.length === 0) {
        ToastSystem.show('Please select at least one photo', 'error');
        return;
    }

    const sendData = {
        phone: phoneNumber,
        photos: selectedPhotos
    };

    if (!state.socket.connected) {
        // Queue for later
        const pending = JSON.parse(localStorage.getItem('pendingSends') || '[]');
        pending.push(sendData);
        localStorage.setItem('pendingSends', JSON.stringify(pending));

        showModalState('success'); // Fake success for UX
        elements.successMessage.textContent = "Queued for sending (Offline)";
        triggerHaptic();

        setTimeout(() => {
            closePhoneModal();
            // Don't auto-reset in offline mode, maybe? Or do?
            // Let's auto-reset to keep flow going
            deselectAllPhotos();
        }, 2000);
        return;
    }

    showModalState('sending');
    // Progress will be updated by 'send-progress' events from server

    state.socket.emit('client:send-photos', sendData);
}
