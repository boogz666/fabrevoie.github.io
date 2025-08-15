// STATE MANAGEMENT
const state = {
    currentColor: 'red',
    currentImageIndex: 0,
    selectedSize: null,
    currentGender: 'unisex',
    pairsLeft: 100,
    cart: [],
    currentHeaderPhraseIndex: 0,
    headerAnnouncementInterval: null
};

// VARIANT MAP - YOUR ACTUAL SHOPIFY VARIANT IDS
const variantMap = {
    // Red variants
    'red-5.5': '52151827530055',
    'red-7': '52151827202375',
    'red-7.5': '52151827235143',
    'red-8': '52151827267911',
    'red-8.5': '52151827300679',
    'red-9': '52151827333447',
    'red-9.5': '52151827366215',
    'red-10': '52151827398983',
    'red-10.5': '52151827431751',
    'red-11': '52151827464519',
    'red-11.5': '52151827497287',
    
    // Black variants
    'black-5.5': '52151827890503',
    'black-7': '52151827562823',
    'black-7.5': '52151827595591',
    'black-8': '52151827628359',
    'black-8.5': '52151827661127',
    'black-9': '52151827693895',
    'black-9.5': '52151827726663',
    'black-10': '52151827759431',
    'black-10.5': '52151827792199',
    'black-11': '52151827824967',
    'black-11.5': '52151827857735'
};

const config = {
    dropDate: new Date('2025-10-14T14:00:00+02:00'),
    presaleStartDate: new Date('2025-10-07T14:00:00+02:00'),
    productPrice: 269,
    presalePrice: 229,
    shopifyDomain: 'lhllparis.myshopify.com',
    productHandle: 'sbhmn-1',
    
    productImages: {
        red: [
            'assets/images/red-1.jpg',
            'assets/images/red-2.jpg',
            'assets/images/red-3.jpg',
            'assets/images/red-4.jpg',
            'assets/images/red-5.jpg'
        ],
        black: [
            'assets/images/black-1.jpg',
            'assets/images/black-2.jpg',
            'assets/images/black-3.jpg',
            'assets/images/black-4.jpg',
            'assets/images/black-5.jpg'
        ]
    },
    
    // UPDATED SIZES TO MATCH YOUR ACTUAL VARIANTS
    sizes: ['5.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5'],
    
    // UPDATED SIZE CHART
    sizeChart: [
        { us: '5.5', eu: '37.5', uk: '4.5', cm: '23.5', inches: '9.3' },
        { us: '7', eu: '40', uk: '6', cm: '25.0', inches: '9.8' },
        { us: '7.5', eu: '40.5', uk: '6.5', cm: '25.5', inches: '10.0' },
        { us: '8', eu: '41', uk: '7', cm: '25.5', inches: '10.0' },
        { us: '8.5', eu: '41.5', uk: '7.5', cm: '26.0', inches: '10.2' },
        { us: '9', eu: '42', uk: '8', cm: '26.5', inches: '10.4' },
        { us: '9.5', eu: '42.5', uk: '8.5', cm: '27.0', inches: '10.6' },
        { us: '10', eu: '43', uk: '9', cm: '27.5', inches: '10.8' },
        { us: '10.5', eu: '44', uk: '9.5', cm: '28.0', inches: '11.0' },
        { us: '11', eu: '44.5', uk: '10', cm: '28.5', inches: '11.2' },
        { us: '11.5', eu: '45', uk: '10.5', cm: '29.0', inches: '11.4' }
    ]
};

// ACCESS DENIED FUNCTIONS
function showAccessDenied() {
    const modal = document.getElementById('accessDeniedModal');
    if (modal) modal.classList.add('active');
}

function closeAccessDenied() {
    const modal = document.getElementById('accessDeniedModal');
    if (modal) modal.classList.remove('active');
}

// SIZE FUNCTIONS
function populateSizes() {
    const sizeOptions = document.getElementById('sizeOptions');
    if (!sizeOptions) return;
    
    const sizes = config.sizes;
    
    sizeOptions.innerHTML = sizes.map(size => `
        <div class="size-option" data-size="${size}" onclick="selectSize('${size}')">${size}</div>
    `).join('');
}

function updateSizeChart() {
    const chartBody = document.getElementById('sizeChartBody');
    if (!chartBody) return;
    
    const chartData = config.sizeChart;
    
    chartBody.innerHTML = chartData.map(row => `
        <tr>
            <td>${row.us}</td>
            <td>${row.eu}</td>
            <td>${row.uk}</td>
            <td>${row.cm}</td>
            <td>${row.inches}</td>
        </tr>
    `).join('');
}

// Remove gender toggle function (unisex only)
function toggleGender(gender) {
    // Keep for backward compatibility but do nothing
    return;
}

// TIMER FUNCTION
function updateTimer() {
    const now = new Date();
    const timeDiff = config.presaleStartDate - now;

    const timerHours = document.getElementById('timerHours');
    const timerMinutes = document.getElementById('timerMinutes');
    const timerSeconds = document.getElementById('timerSeconds');
    const timerStatus = document.getElementById('timerStatus');
    
    const countdownDays = document.getElementById('countdownDays');
    const countdownHours = document.getElementById('countdownHours');
    const countdownMinutes = document.getElementById('countdownMinutes');
    const countdownSecondsEl = document.getElementById('countdownSeconds');
    
    if (!timerHours) return;

    if (now < config.presaleStartDate) {
        const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((timeDiff % (1000 * 60)) / 1000);

        timerHours.textContent = '72';
        timerMinutes.textContent = '00';
        timerSeconds.textContent = '00';
        timerStatus.textContent = 'PRE-SALE STARTS IN';
        
        if (countdownDays) {
            countdownDays.textContent = days.toString().padStart(2, '0');
            countdownHours.textContent = hours.toString().padStart(2, '0');
            countdownMinutes.textContent = minutes.toString().padStart(2, '0');
            countdownSecondsEl.textContent = seconds.toString().padStart(2, '0');
        }
    } else {
        const presaleEnd = new Date(config.presaleStartDate.getTime() + (72 * 60 * 60 * 1000));
        const presaleTimeDiff = presaleEnd - now;
        
        if (presaleTimeDiff > 0) {
            const presaleHours = Math.floor(presaleTimeDiff / (1000 * 60 * 60));
            const presaleMinutes = Math.floor((presaleTimeDiff % (1000 * 60 * 60)) / (1000 * 60));
            const presaleSeconds = Math.floor((presaleTimeDiff % (1000 * 60)) / 1000);
            
            timerHours.textContent = presaleHours.toString().padStart(2, '0');
            timerMinutes.textContent = presaleMinutes.toString().padStart(2, '0');
            timerSeconds.textContent = presaleSeconds.toString().padStart(2, '0');
            timerStatus.textContent = 'PRE-SALE LIVE';
        } else {
            timerHours.textContent = '00';
            timerMinutes.textContent = '00';
            timerSeconds.textContent = '00';
            timerStatus.textContent = 'PRE-SALE ENDED';
        }
        
        if (countdownDays) {
            countdownDays.textContent = '00';
            countdownHours.textContent = '00';
            countdownMinutes.textContent = '00';
            countdownSecondsEl.textContent = '00';
        }
    }
}

// PRODUCT FUNCTIONS
function changeImage(index) {
    state.currentImageIndex = index;
    updateProductImage();
    updateThumbnails();
}

function updateProductImage() {
    const productImage = document.getElementById('productImage');
    if (!productImage) return;
    
    const images = config.productImages[state.currentColor];

    productImage.style.opacity = '0';
    setTimeout(() => {
        productImage.src = images[state.currentImageIndex];
        productImage.style.opacity = '1';
    }, 150);
}

function updateThumbnails() {
    const thumbnails = document.querySelectorAll('.thumbnail-container .thumbnail');
    const images = config.productImages[state.currentColor];

    thumbnails.forEach((thumb, index) => {
        if (images && images[index]) {
            thumb.querySelector('img').src = images[index];
            thumb.classList.toggle('active', index === state.currentImageIndex);
        }
    });
}

function nextImage() {
    const images = config.productImages[state.currentColor];
    state.currentImageIndex = (state.currentImageIndex + 1) % images.length;
    updateProductImage();
    updateThumbnails();
}

function previousImage() {
    const images = config.productImages[state.currentColor];
    state.currentImageIndex = (state.currentImageIndex - 1 + images.length) % images.length;
    updateProductImage();
    updateThumbnails();
}

function changeProductColor(color) {
    document.querySelectorAll('.color-option').forEach(option => option.classList.remove('active'));
    const colorOption = document.querySelector(`[data-color="${color}"]`);
    if (colorOption) colorOption.classList.add('active');
    
    state.currentColor = color;
    state.currentImageIndex = 0;
    updateProductImage();
    updateThumbnails();
    resetSizeSelection();
}

function selectSize(size) {
    document.querySelectorAll('.size-option').forEach(option => option.classList.remove('selected'));

    const sizeElement = document.querySelector(`[data-size="${size}"]`);
    if (sizeElement && !sizeElement.classList.contains('out-of-stock')) {
        sizeElement.classList.add('selected');
        state.selectedSize = size;
        const sizeWarning = document.getElementById('sizeWarning');
        if (sizeWarning) sizeWarning.style.display = 'none';
        updateBuyButtonText();
    }
}

function resetSizeSelection() {
    state.selectedSize = null;
    document.querySelectorAll('.size-option').forEach(option => option.classList.remove('selected'));
    const sizeWarning = document.getElementById('sizeWarning');
    if (sizeWarning) sizeWarning.style.display = 'none';
    updateBuyButtonText();
}

function updateBuyButtonText() {
    const buyButton = document.getElementById('buyButton');
    if (!buyButton) return;
    
    const colorText = state.currentColor.charAt(0).toUpperCase() + state.currentColor.slice(1);

    buyButton.innerHTML = state.selectedSize
        ? `CLAIM ${colorText.toUpperCase()} - SIZE ${state.selectedSize} <i class="fas fa-shopping-cart"></i>`
        : 'CLAIM YOUR PAIR <i class="fas fa-shopping-cart"></i>';
}

// SHOPIFY INTEGRATION - SIMPLIFIED
function buyProduct() {
    if (!state.selectedSize) {
        const sizeWarning = document.getElementById('sizeWarning');
        if (sizeWarning) {
            sizeWarning.style.display = 'block';
            sizeWarning.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
    }

    // Get the exact variant
    const variantKey = `${state.currentColor}-${state.selectedSize}`;
    const variantId = variantMap[variantKey];
    
    if (!variantId) {
        alert("This size/color combination is currently unavailable. Try another!");
        return;
    }

    // Visual feedback
    const buyButton = document.getElementById('buyButton');
    buyButton.innerHTML = 'PROCESSING YOUR DOMINANCE... <i class="fas fa-spinner fa-spin"></i>';
    buyButton.disabled = true;

    // Add to cart and redirect to Shopify
    setTimeout(() => {
        // Direct to cart with the exact variant
        // Add ?checkout=true to skip cart page and go straight to checkout
        window.location.href = `https://${config.shopifyDomain}/cart/${variantId}:1`;
        
        // After redirect, reset button (though page will be gone)
        buyButton.innerHTML = 'CLAIM YOUR PAIR <i class="fas fa-shopping-cart"></i>';
        buyButton.disabled = false;
    }, 500);
}

// SIZE GUIDE FUNCTIONS
function openSizeGuide() {
    const modal = document.getElementById('sizeGuideModal');
    if (modal) {
        modal.style.display = 'flex';
        updateSizeChart();
    }
}

function closeSizeGuide() {
    const modal = document.getElementById('sizeGuideModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// OVERLAY FUNCTIONS (For old index.html if still used)
function showProductOverlay() {
    const landingContent = document.getElementById('landingContent');
    const timerContainer = document.getElementById('timerContainer');
    const productOverlay = document.getElementById('productOverlay');
    const topLogo = document.getElementById('topLogo');
    
    if (landingContent) landingContent.classList.add('hidden');
    if (timerContainer) timerContainer.style.display = 'none';

    setTimeout(() => {
        if (productOverlay) {
            productOverlay.classList.add('active');
            productOverlay.addEventListener('scroll', handleHeaderScroll);
        }
        if (topLogo) topLogo.classList.add('visible');
        
        isProductOverlayActive = true;
        updateProductImage();
        updateThumbnails();
        populateSizes();
    }, 250);
}

function hideProductOverlay() {
    const productOverlay = document.getElementById('productOverlay');
    const topLogo = document.getElementById('topLogo');
    const header = document.querySelector('.main-header');
    const timerContainer = document.getElementById('timerContainer');
    const landingContent = document.getElementById('landingContent');
    
    if (productOverlay) {
        productOverlay.classList.remove('active');
        productOverlay.removeEventListener('scroll', handleHeaderScroll);
    }
    if (topLogo) topLogo.classList.remove('visible');
    if (header) header.classList.remove('hidden');
    if (timerContainer) timerContainer.style.display = 'block';
    
    isProductOverlayActive = false;

    setTimeout(() => {
        if (landingContent) landingContent.classList.remove('hidden');
    }, 250);
}

// HEADER SCROLL FUNCTIONALITY
let lastScrollTop = 0;
let isProductOverlayActive = false;

function handleHeaderScroll() {
    if (!isProductOverlayActive) return;
    
    const productOverlay = document.getElementById('productOverlay');
    if (!productOverlay) return;
    
    const currentScroll = productOverlay.scrollTop;
    const header = document.querySelector('.main-header');
    
    if (header) {
        if (currentScroll > lastScrollTop && currentScroll > 100) {
            header.classList.add('hidden');
        } else {
            header.classList.remove('hidden');
        }
    }
    lastScrollTop = currentScroll;
}

// CART FUNCTIONS (Simple - Shopify handles the real cart)
function toggleCart() {
    // Since we're using Shopify's cart, just redirect to cart page
    window.location.href = `https://${config.shopifyDomain}/cart`;
}

function updateCartCount() {
    // This would need Shopify Cart API to get real count
    // For now, just showing 0
    const headerCartCount = document.getElementById('headerCartCount');
    if (headerCartCount) headerCartCount.textContent = '0';
}

function updatePairsLeft() {
    const pairsLeftElement = document.getElementById('pairsLeft');
    if (pairsLeftElement) pairsLeftElement.textContent = state.pairsLeft;
}

// HEADER ANNOUNCEMENT FUNCTIONS
function startHeaderAnnouncementCycling() {
    const headerPhrases = ['headerPhrase1', 'headerPhrase2', 'headerPhrase3'];
    
    if (!document.getElementById(headerPhrases[0])) return;

    document.getElementById(headerPhrases[0]).classList.add('visible');

    state.headerAnnouncementInterval = setInterval(() => {
        const currentPhrase = document.getElementById(headerPhrases[state.currentHeaderPhraseIndex]);
        if (currentPhrase) currentPhrase.classList.remove('visible');

        state.currentHeaderPhraseIndex = (state.currentHeaderPhraseIndex + 1) % headerPhrases.length;

        setTimeout(() => {
            const nextPhrase = document.getElementById(headerPhrases[state.currentHeaderPhraseIndex]);
            if (nextPhrase) nextPhrase.classList.add('visible');
        }, 500);

    }, 3000);
}

function stopHeaderAnnouncementCycling() {
    if (state.headerAnnouncementInterval) {
        clearInterval(state.headerAnnouncementInterval);
        const headerPhrases = ['headerPhrase1', 'headerPhrase2', 'headerPhrase3'];
        headerPhrases.forEach(id => {
            const element = document.getElementById(id);
            if (element) element.classList.remove('visible');
        });
        state.currentHeaderPhraseIndex = 0;
    }
}

// INITIALIZATION
function showPageContent() {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
        loadingScreen.classList.add('fade-out');
        setTimeout(() => loadingScreen.style.display = 'none', 500);
    }
}

// CLOSE MODALS WHEN CLICKING OUTSIDE
function initModalClosers() {
    const sizeGuideModal = document.getElementById('sizeGuideModal');
    if (sizeGuideModal) {
        sizeGuideModal.addEventListener('click', function(e) {
            if (e.target === this) closeSizeGuide();
        });
    }

    const accessDeniedModal = document.getElementById('accessDeniedModal');
    if (accessDeniedModal) {
        accessDeniedModal.addEventListener('click', function(e) {
            if (e.target === this) closeAccessDenied();
        });
    }
}

// VIDEO SETUP
function initVideo() {
    const video = document.getElementById('bgVideo');
    if (video) {
        video.muted = true;
        video.autoplay = true;
        video.loop = true;
        video.load();

        video.play().catch(() => {
            document.addEventListener('click', () => video.play(), { once: true });
        });
    }
}

// MAIN INITIALIZATION
document.addEventListener('DOMContentLoaded', function() {
    const isShopPage = window.location.pathname.includes('shop');
    const isLandingPage = window.location.pathname === '/' || window.location.pathname.includes('index');
    
    setTimeout(() => {
        showPageContent();
        updatePairsLeft();
        updateCartCount();
    }, 1000);

    if (document.getElementById('timerHours')) {
        updateTimer();
        setInterval(updateTimer, 1000);
    }

    if (isShopPage || document.getElementById('productImage')) {
        updateProductImage();
        updateThumbnails();
        updateBuyButtonText();
        populateSizes();
    }

    if (isLandingPage) {
        startHeaderAnnouncementCycling();
        initVideo();
    }

    initModalClosers();
});

// UTILITY FUNCTIONS
function formatPrice(price) {
    return `$${price.toFixed(2)}`;
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// EXPORT FOR USE IN OTHER FILES IF NEEDED
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        state,
        config,
        changeProductColor,
        selectSize,
        buyProduct,
        variantMap
    };
}
