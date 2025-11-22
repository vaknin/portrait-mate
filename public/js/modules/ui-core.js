// UI Core: Elements, Toasts, Modals

export const elements = {
    // Header
    connectionWarning: document.getElementById('connectionWarning'),
    toastContainer: document.getElementById('toastContainer'),

    // Bottom Action Bar
    bottomActionBar: document.getElementById('bottomActionBar'),
    resetBtn: document.getElementById('resetBtn'),
    sendBtn: document.getElementById('sendBtn'),
    selectionBadge: document.getElementById('selectionBadge'),

    // Gallery
    emptyState: document.getElementById('emptyState'),
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

export class ToastSystem {
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

export function updateConnectionStatus(connected) {
    if (connected) {
        elements.connectionWarning.classList.add('hidden');
    } else {
        elements.connectionWarning.classList.remove('hidden');
    }
}

// Modal Management
export function showPhoneModal() {
    elements.phoneModal.classList.add('show');
    showModalState('input');
    elements.phoneInputModal.value = '';
    elements.phoneInputModal.focus();
}

export function closePhoneModal() {
    elements.phoneModal.classList.remove('show');
}

export function showModalState(stateName) {
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

export function showScreen(screenName) {
    // Simplified: Only one screen exists now
    console.log(`Screen navigation to ${screenName} ignored (single screen app)`);
}

export function showConfirmModal() {
    elements.confirmModal.classList.add('show');
}

export function closeConfirmModal() {
    elements.confirmModal.classList.remove('show');
}

export function showQRModal(qrData, attempt) {
    elements.qrModal.classList.add('show');
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qrData)}`;
    elements.qrContainer.innerHTML = `<img src="${qrUrl}" class="qr-image" alt="Scan QR Code">`;
    elements.qrStatus.textContent = `Scan with WhatsApp (Attempt ${attempt})`;
}

export function closeQRModal() {
    elements.qrModal.classList.remove('show');
}
