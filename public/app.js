import { initSocket, resetSession, sendPhotos } from './js/modules/socket.js';
import { initPhotoSwipe } from './js/modules/gallery.js';
import { elements, showPhoneModal, closePhoneModal, showConfirmModal, closeConfirmModal, closeQRModal } from './js/modules/ui-core.js';
import { validatePhoneNumber, formatPhoneNumber } from './js/modules/utils.js';

// Event Handlers
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

elements.phoneInputModal.addEventListener('input', (e) => {
    const formatted = formatPhoneNumber(e.target.value);
    e.target.value = formatted;
    elements.phoneErrorModal.classList.remove('visible');
});

elements.cancelBtn.addEventListener('click', closePhoneModal);
elements.closeSuccessBtn.addEventListener('click', closePhoneModal);

// App Initialization
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
