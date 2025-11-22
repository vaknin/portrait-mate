// Utility Functions

export function triggerHaptic() {
    if (navigator.vibrate) {
        navigator.vibrate(10); // Light tap
    }
}

export function getImageDimensions(src) {
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

export function validatePhoneNumber(phone) {
    const cleaned = phone.replace(/[\s-]/g, '');
    const israeliRegex = /^05\d{8}$/;

    if (!israeliRegex.test(cleaned)) {
        return { valid: false, error: 'Invalid format. Use: 05X-XXX-XXXX' };
    }
    return { valid: true, cleaned: cleaned };
}

export function formatPhoneNumber(value) {
    const digits = value.replace(/\D/g, '');
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}
