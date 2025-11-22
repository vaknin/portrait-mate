import { state, saveState, loadState } from './state.js';
import { elements } from './ui-core.js';
import { triggerHaptic, getImageDimensions } from './utils.js';

// Gallery Logic

export function initPhotoSwipe() {
    const lightbox = new PhotoSwipeLightbox({
        gallery: '#photoGrid',
        children: 'a',
        pswpModule: PhotoSwipe,
        pinchToClose: true,
        closeOnVerticalDrag: true,
        bgOpacity: 0.95,
        zoom: false,
        maxZoomLevel: 4,
        doubleTapAction: 'zoom',
        bgClickAction: 'close',
        tapAction: 'close',
        paddingFn: () => ({ top: 30, bottom: 30, left: 10, right: 10 })
    });

    // Add Custom Select Button
    lightbox.on('uiRegister', () => {
        lightbox.pswp.ui.registerElement({
            name: 'select-button',
            order: 9,
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
                const gridChildren = Array.from(elements.photoGrid.children);
                const activeElement = gridChildren[currIndex];
                const originalIndex = parseInt(activeElement.dataset.index, 10);

                togglePhotoSelection(originalIndex);
                updatePhotoSwipeSelectButton(el, originalIndex);
            }
        });
    });

    lightbox.on('change', () => {
        const pswp = lightbox.pswp;
        const currIndex = pswp.currIndex;
        const gridChildren = Array.from(elements.photoGrid.children);
        const activeElement = gridChildren[currIndex];
        if (activeElement) {
            const originalIndex = parseInt(activeElement.dataset.index, 10);
            const btn = pswp.element.querySelector('.pswp__button--select-button');
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

export async function addPhoto(photoData) {
    if (state.photos.some(p => p.filename === photoData.filename)) return;

    const dimensions = await getImageDimensions(photoData.path);
    const savedSelections = loadState();
    const isSelected = savedSelections.includes(photoData.filename);

    const photo = {
        filename: photoData.filename,
        path: photoData.path,
        thumbnail: photoData.thumbnail,
        selected: isSelected,
        width: dimensions.width,
        height: dimensions.height
    };
    state.photos.push(photo);

    // Optimization: Prepend single card instead of rebuilding entire grid
    if (elements.photoGrid.children.length > 0 || state.photos.length === 1) {
        elements.emptyState.classList.add('hidden');
        elements.photoGrid.classList.remove('hidden');
        updateBottomBar();

        // Create card with "developing" animation
        const index = state.photos.length - 1;
        const photoCard = createPhotoCard(photo, index, 0, true); // true = isNew

        // Insert at the beginning (visual top)
        elements.photoGrid.prepend(photoCard);
    } else {
        updatePhotoGallery();
    }

    updateSelectionCount();
    updateSendButton();
}

export function updatePhotoGallery() {
    if (state.photos.length === 0) {
        elements.emptyState.classList.remove('hidden');
        elements.photoGrid.classList.add('hidden');
    } else {
        elements.emptyState.classList.add('hidden');
        elements.photoGrid.classList.remove('hidden');
    }

    elements.photoGrid.innerHTML = '';

    // Reverse order to show newest first
    [...state.photos].reverse().forEach((photo, reverseIndex) => {
        const index = state.photos.length - 1 - reverseIndex;
        const photoCard = createPhotoCard(photo, index, reverseIndex, false);
        elements.photoGrid.appendChild(photoCard);
    });
}

function createPhotoCard(photo, index, reverseIndex = 0, isNew = false) {
    const wrapper = document.createElement('div');
    wrapper.className = 'photo-card-wrapper';
    wrapper.dataset.index = index;
    if (photo.selected) wrapper.classList.add('selected');

    if (isNew) {
        wrapper.style.animation = 'develop 2s cubic-bezier(0.2, 0.8, 0.2, 1) forwards';
    } else {
        wrapper.style.animationDelay = `${reverseIndex * 0.05}s`;
    }

    wrapper.addEventListener('click', (e) => {
        if (e.target.closest('.expand-btn')) return;
        togglePhotoSelection(index);
    });

    wrapper.innerHTML = `
        <img src="${photo.thumbnail || photo.path}" alt="${photo.filename}" loading="lazy">
        
        <div class="selection-indicator">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"/>
            </svg>
        </div>

        <button class="expand-btn" aria-label="View photo">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
            </svg>
        </button>

        <a href="${photo.path}" 
           data-pswp-width="${photo.width}" 
           data-pswp-height="${photo.height}" 
           target="_blank" 
           class="pswp-link"
           style="display:none;"></a>
    `;

    const expandBtn = wrapper.querySelector('.expand-btn');
    expandBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const allWrappers = Array.from(elements.photoGrid.children);
        const domIndex = allWrappers.indexOf(wrapper);

        if (state.lightbox) {
            state.lightbox.loadAndOpen(domIndex);
        }
    });

    return wrapper;
}

export function togglePhotoSelection(index) {
    const photo = state.photos[index];
    const wasSelected = photo.selected;
    photo.selected = !photo.selected;

    triggerHaptic();
    saveState();

    const cardWrapper = elements.photoGrid.querySelector(`.photo-card-wrapper[data-index="${index}"]`);
    if (cardWrapper) {
        if (photo.selected) {
            cardWrapper.classList.add('selected');
            if (!wasSelected) {
                cardWrapper.classList.add('pulse');
                setTimeout(() => cardWrapper.classList.remove('pulse'), 600);

                const img = cardWrapper.querySelector('img');
                // Animation removed per user request
            }
        } else {
            cardWrapper.classList.remove('selected');
            cardWrapper.classList.remove('pulse');
        }
    } else {
        updatePhotoGallery();
    }

    updateSelectionCount();
    updateSendButton();
    updateBottomBar();
}

export function deselectAllPhotos() {
    state.photos.forEach(p => p.selected = false);
    saveState();

    const cards = elements.photoGrid.querySelectorAll('.photo-card-wrapper');
    cards.forEach(card => {
        card.classList.remove('selected');
    });

    updateSelectionCount();
    updateSendButton();
    updateBottomBar();
}

export function updateSelectionCount() {
    const count = state.photos.filter(p => p.selected).length;
    elements.selectionBadge.textContent = count;

    elements.selectionBadge.classList.remove('pop');
    void elements.selectionBadge.offsetWidth;
    elements.selectionBadge.classList.add('pop');
}

export function updateSendButton() {
    const hasSelection = state.photos.some(p => p.selected);
    elements.sendBtn.disabled = !hasSelection;

    // We allow clicking send even if disconnected (it will queue)
    elements.sendBtn.title = "";
}

export function updateBottomBar() {
    if (state.photos.length > 0) {
        elements.bottomActionBar.classList.add('show');
    } else {
        elements.bottomActionBar.classList.remove('show');
    }
}
