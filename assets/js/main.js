// FABREVOIE MAIN.JS - COMPLETE WITH CART SYSTEM
// Last Updated: Aug 15, 2025
// Shop Domain: shop.fabrevoie.com

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

// CART STATE
let localCart = JSON.parse(localStorage.getItem('fabrevoie_cart')) || [];

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
    // UPDATED DATES - NYC TIME (EDT/EST)
    dropDate: new Date('2025-09-05T08:00:00-04:00'),  // September 5th, 8AM NYC
    presaleStartDate: new Date('2025-08-21T08:00:00-04:00'),  // August 21st, 8AM NYC
    productPrice: 269,
    presalePrice: 229,
    shopifyDomain: 'shop.fabrevoie.com',
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
    
    sizes: ['5.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5'],
    
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

// CART FUNCTIONS
function toggleCart() {
    const cartModal = document.getElementById('cartModal');
    if (cartModal) {
        cartModal.classList.toggle('active');
        if (cartModal.classList.contains('active')) {
            updateCartDisplay();
        }
    }
}

function closeCart() {
    const cartModal = document.getElementById('cartModal');
    if (cartModal) {
        cartModal.classList.remove('active');
    }
}

function addToCart(color, size) {
    // Create cart item
    const cartItem = {
        id: `${color}-${size}`,
        name: 'SBHMN 1',
        color: color,
        size: size,
        price: 269,
        quantity: 1,
        variantId: variantMap[`${color}-${size}`],
        image: config.productImages[color][0]
    };
    
    // Check if item already exists
    const existingIndex = localCart.findIndex(item => item.id === cartItem.id);
    
    if (existingIndex >= 0) {
        localCart[existingIndex].quantity += 1;
    } else {
        localCart.push(cartItem);
    }
    
    // Save to localStorage
    localStorage.setItem('fabrevoie_cart', JSON.stringify(localCart));
    
    // Update cart count with animation
    updateCartCount();
    
    // Show cart
    toggleCart();
    
    // Visual feedback
    const cartCount = document.getElementById('headerCartCount');
    if (cartCount) {
        cartCount.classList.add('updated');
        setTimeout(() => cartCount.classList.remove('updated'), 300);
    }
}

function removeFromCart(itemId) {
    localCart = localCart.filter(item => item.id !== itemId);
    localStorage.setItem('fabrevoie_cart', JSON.stringify(localCart));
    updateCartDisplay();
    updateCartCount();
}

function updateCartQuantity(itemId, delta) {
    const item = localCart.find(item => item.id === itemId);
    if (item) {
        item.quantity += delta;
        if (item.quantity <= 0) {
            removeFromCart(itemId);
        } else {
            localStorage.setItem('fabrevoie_cart', JSON.stringify(localCart));
            updateCartDisplay();
            updateCartCount();
        }
    }
}

function updateCartDisplay() {
    const cartItems = document.getElementById('cartItems');
    const cartEmpty = document.getElementById('cartEmpty');
    const cartFooter = document.getElementById('cartFooter');
    
    if (!cartItems) return;
    
    if (localCart.length === 0) {
        cartItems.style.display = 'none';
        cartEmpty.style.display = 'block';
        cartFooter.style.display = 'none';
    } else {
        cartItems.style.display = 'block';
        cartEmpty.style.display = 'none';
        cartFooter.style.display = 'block';
        
        cartItems.innerHTML = localCart.map(item => `
            <div class="cart-item">
                <img src="${item.image}" alt="${item.name}" class="cart-item-image">
                <div class="cart-item-details">
                    <div class="cart-item-name">${item.name}</div>
                    <div class="cart-item-variant">${item.color} / Size ${item.size}</div>
                    <div class="cart-item-price">$${item.price}</div>
                    <div class="cart-item-quantity">
                        <button class="cart-qty-btn" onclick="updateCartQuantity('${item.id}', -1)">-</button>
                        <span class="cart-qty-display">${item.quantity}</span>
                        <button class="cart-qty-btn" onclick="updateCartQuantity('${item.id}', 1)">+</button>
                    </div>
                </div>
                <button class="cart-item-remove" onclick="removeFromCart('${item.id}')">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `).join('');
        
        // Update total
        const total = localCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const totalElement = document.getElementById('cartTotalPrice');
        if (totalElement) {
            totalElement.textContent = `$${total}`;
        }
    }
}

function updateCartCount() {
    const count = localCart.reduce((sum, item) => sum + item.quantity, 0);
    const cartCountElement = document.getElementById('headerCartCount');
    if (cartCountElement) {
        cartCountElement.textContent = count;
    }
}

function proceedToCheckout() {
    if (localCart.length === 0) {
        alert('Your cart is empty. Add something first!');
        return;
    }
    
    // Build Shopify checkout URL with multiple items
    const cartItems = localCart.map(item => `${item.variantId}:${item.quantity}`).join(',');
    const checkoutUrl = `https://shop.fabrevoie.com/cart/${cartItems}`;
    
    // Clear cart after checkout
    localStorage.removeItem('fabrevoie_cart');
    localCart = [];
    
    // Redirect to Shopify
    window.location.href = checkoutUrl;
}

// UPDATE THE buyProduct FUNCTION
function buyProduct() {
    if (!state.selectedSize) {
        const sizeWarning = document.getElementById('sizeWarning');
        if (sizeWarning) {
            sizeWarning.style.display = 'block';
            sizeWarning.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        alert('PICK A SIZE OR GET LOST!');
        return;
    }
    
    // Visual feedback
    const buyButton = document.getElementById('buyButton');
    if (buyButton) {
        buyButton.innerHTML = 'ADDING TO CART... <i class="fas fa-spinner fa-spin"></i>';
        buyButton.disabled = true;
    }
    
    // Add to cart instead of direct checkout
    addToCart(state.currentColor, state.selectedSize);
    
    // Reset button after short delay
    setTimeout(() => {
        if (buyButton) {
            buyButton.innerHTML = 'ADD TO CART <i class="fas fa-shopping-cart"></i>';
            buyButton.disabled = false;
        }
        // Reset size selection
        resetSizeSelection();
    }, 500);
}

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

// TIMER FUNCTION - UPDATED FOR NEW LOGIC
function updateTimer() {
    const now = new Date();
    const presaleTimeDiff = config.presaleStartDate - now;
    const dropTimeDiff = config.dropDate - now;

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
        // Before pre-sale (2 weeks countdown)
        const days = Math.floor(presaleTimeDiff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((presaleTimeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((presaleTimeDiff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((presaleTimeDiff % (1000 * 60)) / 1000);

        // Show countdown to presale in hours (up to 360 hours max for 15 days)
        const totalHoursUntilPresale = Math.floor(presaleTimeDiff / (1000 * 60 * 60));
        const remainingMinutes = Math.floor((presaleTimeDiff % (1000 * 60 * 60)) / (1000 * 60));
        const remainingSeconds = Math.floor((presaleTimeDiff % (1000 * 60)) / 1000);
        
        timerHours.textContent = Math.min(totalHoursUntilPresale, 360).toString().padStart(3, '0');
        timerMinutes.textContent = remainingMinutes.toString().padStart(2, '0');
        timerSeconds.textContent = remainingSeconds.toString().padStart(2, '0');
        timerStatus.textContent = 'PRE-SALE STARTS IN';
        
        // Detailed countdown
        if (countdownDays) {
            countdownDays.textContent = days.toString().padStart(2, '0');
            countdownHours.textContent = hours.toString().padStart(2, '0');
            countdownMinutes.textContent = minutes.toString().padStart(2, '0');
            countdownSecondsEl.textContent = seconds.toString().padStart(2, '0');
        }
    } else if (now < config.dropDate) {
        // During pre-sale period (15 days = 360 hours countdown to drop)
        const days = Math.floor(dropTimeDiff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((dropTimeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((dropTimeDiff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((dropTimeDiff % (1000 * 60)) / 1000);
        
        timerStatus.textContent = 'PRE-SALE LIVE - DROP IN';
        
        // Show countdown to drop (max 360 hours for 15 days)
        const totalHoursUntilDrop = Math.floor(dropTimeDiff / (1000 * 60 * 60));
        const dropMinutes = Math.floor((dropTimeDiff % (1000 * 60 * 60)) / (1000 * 60));
        const dropSeconds = Math.floor((dropTimeDiff % (1000 * 60)) / 1000);
        
        timerHours.textContent = Math.min(totalHoursUntilDrop, 360).toString().padStart(3, '0');
        timerMinutes.textContent = dropMinutes.toString().padStart(2, '0');
        timerSeconds.textContent = dropSeconds.toString().padStart(2, '0');
        
        if (countdownDays) {
            countdownDays.textContent = days.toString().padStart(2, '0');
            countdownHours.textContent = hours.toString().padStart(2, '0');
            countdownMinutes.textContent = minutes.toString().padStart(2, '0');
            countdownSecondsEl.textContent = seconds.toString().padStart(2, '0');
        }
    } else {
        // After drop - show 120 hours countdown
        const hoursAfterDrop = Math.floor((now - config.dropDate) / (1000 * 60 * 60));
        const remainingCountdownHours = Math.max(0, 120 - hoursAfterDrop);
        
        if (remainingCountdownHours > 0) {
            const currentTime = new Date();
            const dropEndTime = new Date(config.dropDate.getTime() + (120 * 60 * 60 * 1000));
            const timeLeft = dropEndTime - currentTime;
            
            const hours = Math.floor(timeLeft / (1000 * 60 * 60));
            const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);
            
            timerHours.textContent = hours.toString().padStart(3, '0');
            timerMinutes.textContent = minutes.toString().padStart(2, '0');
            timerSeconds.textContent = seconds.toString().padStart(2, '0');
            timerStatus.textContent = 'LIVE NOW - TIME LEFT';
            
            if (countdownDays) {
                countdownDays.textContent = '00';
                countdownHours.textContent = hours.toString().padStart(2, '0');
                countdownMinutes.textContent = minutes.toString().padStart(2, '0');
                countdownSecondsEl.textContent = seconds.toString().padStart(2, '0');
            }
        } else {
            // 120 hours have passed
            timerHours.textContent = '000';
            timerMinutes.textContent = '00';
            timerSeconds.textContent = '00';
            timerStatus.textContent = 'DROP ENDED';
            
            if (countdownDays) {
                countdownDays.textContent = '00';
                countdownHours.textContent = '00';
                countdownMinutes.textContent = '00';
                countdownSecondsEl.textContent = '00';
            }
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
    
    buyButton.innerHTML = 'ADD TO CART <i class="fas fa-shopping-cart"></i>';
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

// IMPROVED TIMER TOGGLE FUNCTION
function toggleTimer() {
    const timerContent = document.getElementById('timerContent');
    const timerContainer = document.getElementById('timerContainer');
    const toggleBtn = document.querySelector('.timer-toggle-btn');
    
    if (timerContainer.classList.contains('collapsed')) {
        // Expand
        timerContent.style.display = 'block';
        timerContainer.classList.remove('collapsed');
        if (toggleBtn) {
            toggleBtn.innerHTML = '<i class="fas fa-minus"></i>';
            toggleBtn.setAttribute('title', 'Minimize Timer');
        }
    } else {
        // Collapse
        timerContent.style.display = 'none';
        timerContainer.classList.add('collapsed');
        if (toggleBtn) {
            toggleBtn.innerHTML = '<i class="fas fa-clock"></i>';
            toggleBtn.setAttribute('title', 'Expand Timer');
        }
    }
}

// MAIN INITIALIZATION
document.addEventListener('DOMContentLoaded', function() {
    // Load cart from localStorage
    localCart = JSON.parse(localStorage.getItem('fabrevoie_cart')) || [];
    updateCartCount();
    
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
    
    // Add click handler for cart icon
    const cartIcon = document.querySelector('.header-cart-icon');
    if (cartIcon) {
        cartIcon.onclick = toggleCart; // Use custom cart instead of Shopify
    }
});

// MAKE FUNCTIONS GLOBALLY ACCESSIBLE FOR ONCLICK HANDLERS
window.state = state;
window.config = config;
window.variantMap = variantMap;
window.buyProduct = buyProduct;
window.changeProductColor = changeProductColor;
window.selectSize = selectSize;
window.openSizeGuide = openSizeGuide;
window.closeSizeGuide = closeSizeGuide;
window.changeImage = changeImage;
window.nextImage = nextImage;
window.previousImage = previousImage;
window.showAccessDenied = showAccessDenied;
window.closeAccessDenied = closeAccessDenied;
window.updateThumbnails = updateThumbnails;
window.updateProductImage = updateProductImage;
window.toggleCart = toggleCart;
window.closeCart = closeCart;
window.removeFromCart = removeFromCart;
window.updateCartQuantity = updateCartQuantity;
window.proceedToCheckout = proceedToCheckout;
window.addToCart = addToCart;
window.toggleTimer = toggleTimer;
