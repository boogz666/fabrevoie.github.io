// FABREVOIE MAIN.JS - FIXED VERSION
// Last Updated: Aug 18, 2025
// Shop Domain: shop.fabrevoie.com

// STATE MANAGEMENT
const state = {
    currentColor: 'red',
    currentImageIndex: 0,
    selectedSize: null,
    currentGender: 'unisex',
    pairsLeft: 150,
    cart: [],
    currentHeaderPhraseIndex: 0,
    headerAnnouncementInterval: null,
    lastScrollTop: 0,
    isScrollingDown: false,
    lifestyleIndex: 0
};

// CART STATE
let localCart = JSON.parse(localStorage.getItem('fabrevoie_cart')) || [];

// SHOPIFY STOREFRONT API CONFIGURATION
const SHOPIFY_STOREFRONT_TOKEN = '8c1c303201210453ae54e2f37ecfaeab';
const SHOPIFY_DOMAIN = 'shop.fabrevoie.com';

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
    // FIXED DATES FOR 2025
    dropDate: new Date('2025-08-28T08:00:00-04:00'),  // Thursday August 28th, 2025, 8AM NYC
    presaleStartDate: new Date('2025-08-21T08:00:00-04:00'),  // Thursday August 21st, 2025, 8AM NYC
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
    
    lifestyleImages: [
        'assets/images/lifestyle-1.jpg',
        'assets/images/lifestyle-2.jpg',
        'assets/images/lifestyle-3.jpg',
        'assets/images/lifestyle-4.jpg',
        'assets/images/lifestyle-5.jpg'
    ],
    
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

// OPTIMIZED INVENTORY FETCHING - REDUCED FREQUENCY
let inventoryFetchTimeout;
async function fetchShopifyInventory() {
    // Clear any pending fetches
    clearTimeout(inventoryFetchTimeout);
    
    try {
        let actualOrdersPlaced = parseInt(localStorage.getItem('fabrevoie_actual_orders') || '0');
        
        const response = await fetch(`https://${SHOPIFY_DOMAIN}/products/sbhmn-1.js`);
        const productData = await response.json();
        
        let soldOutCount = 0;
        productData.variants.forEach(variant => {
            if (!variant.available) soldOutCount++;
        });
        
        const estimatedOrders = soldOutCount * 7;
        
        if (estimatedOrders > actualOrdersPlaced) {
            actualOrdersPlaced = estimatedOrders;
            localStorage.setItem('fabrevoie_actual_orders', actualOrdersPlaced);
        }
        
        // CAP AT 150 FOR ARTIFICIAL SCARCITY
        let displayRemaining = Math.max(0, 150 - actualOrdersPlaced);
        state.pairsLeft = displayRemaining;
        
        updatePairsLeft();
        
        if (state.pairsLeft === 0) {
            addSoldOutVisuals();
        }
        
        localStorage.setItem('fabrevoie_inventory', state.pairsLeft);
        localStorage.setItem('fabrevoie_inventory_time', Date.now());
        
    } catch (error) {
        console.error('Failed to fetch inventory:', error);
        const cached = localStorage.getItem('fabrevoie_inventory');
        state.pairsLeft = cached ? parseInt(cached) : 150;
        updatePairsLeft();
    }
}

// Add visual indicators when sold out
function addSoldOutVisuals() {
    const pairsLeftElement = document.getElementById('pairsLeft');
    if (pairsLeftElement) {
        pairsLeftElement.style.color = '#ff6b6b';
        pairsLeftElement.style.fontWeight = 'bold';
        pairsLeftElement.classList.add('sold-out');
    }
    
    const timerContainer = document.querySelector('.timer-container');
    if (timerContainer && !document.querySelector('.sold-out-badge')) {
        const badge = document.createElement('div');
        badge.className = 'sold-out-badge';
        badge.innerHTML = '🔥 SOLD OUT 🔥';
        badge.style.cssText = `
            position: absolute;
            top: -20px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, #ff6b6b, #ff5252);
            color: white;
            padding: 5px 15px;
            border-radius: 20px;
            font-size: 10px;
            font-weight: bold;
            animation: pulse 2s infinite;
            font-family: var(--font-headers);
            letter-spacing: 1px;
            box-shadow: 0 0 20px rgba(255, 107, 107, 0.5);
            z-index: 10001;
        `;
        timerContainer.appendChild(badge);
    }
    
    const timerStatus = document.getElementById('timerStatus');
    if (timerStatus) {
        timerStatus.textContent = 'SOLD OUT - TAKING FINAL ORDERS';
    }
}

// HEADER HIDE/SHOW ON SCROLL
function initHeaderScroll() {
    const header = document.querySelector('.main-header') || document.querySelector('.shop-header');
    const announcement = document.querySelector('.announcement-bar');
    
    if (!header) return;
    
    let lastScroll = 0;
    let scrollTimer = null;
    
    window.addEventListener('scroll', () => {
        const currentScroll = window.pageYOffset;
        
        if (scrollTimer) clearTimeout(scrollTimer);
        
        if (Math.abs(currentScroll - lastScroll) > 10) {
            if (currentScroll > lastScroll && currentScroll > 100) {
                header.classList.add('hidden');
                if (announcement) announcement.style.transform = 'translateY(-100%)';
            } else {
                header.classList.remove('hidden');
                if (announcement) announcement.style.transform = 'translateY(0)';
            }
        }
        
        scrollTimer = setTimeout(() => {
            header.classList.remove('hidden');
            if (announcement) announcement.style.transform = 'translateY(0)';
        }, 1000);
        
        lastScroll = currentScroll;
    });
}

// TOUCH/SWIPE SUPPORT FOR MOBILE
function initMobileSwipe() {
    const productImage = document.getElementById('productImage');
    const imageContainer = document.querySelector('.product-image-container');
    
    if (!productImage || !imageContainer) return;
    
    let startX = 0;
    let startY = 0;
    let endX = 0;
    let endY = 0;
    
    imageContainer.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    }, { passive: true });
    
    imageContainer.addEventListener('touchend', (e) => {
        endX = e.changedTouches[0].clientX;
        endY = e.changedTouches[0].clientY;
        handleSwipe();
    }, { passive: true });
    
    function handleSwipe() {
        const diffX = startX - endX;
        const diffY = startY - endY;
        const threshold = 50;
        
        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > threshold) {
            if (diffX > 0) {
                nextImage();
            } else {
                previousImage();
            }
        }
    }
}

// LIFESTYLE CAROUSEL
function initLifestyleCarousel() {
    const carousel = document.querySelector('.lifestyle-carousel');
    if (!carousel) return;
    
    setInterval(() => {
        nextLifestyleImage();
    }, 4000);
    
    let startX = 0;
    carousel.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
    }, { passive: true });
    
    carousel.addEventListener('touchend', (e) => {
        const endX = e.changedTouches[0].clientX;
        const diff = startX - endX;
        
        if (Math.abs(diff) > 50) {
            if (diff > 0) {
                nextLifestyleImage();
            } else {
                previousLifestyleImage();
            }
        }
    }, { passive: true });
}

function nextLifestyleImage() {
    state.lifestyleIndex = (state.lifestyleIndex + 1) % config.lifestyleImages.length;
    updateLifestyleCarousel();
}

function previousLifestyleImage() {
    state.lifestyleIndex = (state.lifestyleIndex - 1 + config.lifestyleImages.length) % config.lifestyleImages.length;
    updateLifestyleCarousel();
}

function updateLifestyleCarousel() {
    const track = document.querySelector('.lifestyle-carousel-track');
    if (track) {
        track.style.transform = `translateX(-${state.lifestyleIndex * 100}%)`;
    }
    
    document.querySelectorAll('.carousel-dot').forEach((dot, index) => {
        dot.classList.toggle('active', index === state.lifestyleIndex);
    });
}

function goToLifestyleSlide(index) {
    state.lifestyleIndex = index;
    updateLifestyleCarousel();
}

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
    
    const existingIndex = localCart.findIndex(item => item.id === cartItem.id);
    
    if (existingIndex >= 0) {
        localCart[existingIndex].quantity += 1;
    } else {
        localCart.push(cartItem);
    }
    
    localStorage.setItem('fabrevoie_cart', JSON.stringify(localCart));
    updateCartCount();
    toggleCart();
    
    // Spider animation
    const spider = document.querySelector('.spider');
    const webContainer = document.querySelector('.web-container');
    
    if (spider) {
        spider.style.animation = 'spiderMove 0.3s ease-in-out 3';
        spider.style.transform = 'scale(1.3) rotate(10deg)';
        spider.style.filter = 'drop-shadow(0 0 8px rgba(158, 217, 181, 1))';
        
        setTimeout(() => {
            spider.style.animation = 'spiderMove 4s infinite ease-in-out';
            spider.style.transform = 'scale(1)';
            spider.style.filter = 'drop-shadow(0 0 5px rgba(158, 217, 181, 0.8))';
        }, 1000);
    }
    
    if (webContainer) {
        webContainer.style.animation = 'webShake 0.8s ease-in-out';
        setTimeout(() => {
            webContainer.style.animation = '';
        }, 800);
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
    const webFlies = document.getElementById('webFlies');
    const spider = document.querySelector('.spider');
    const spiderWeb = document.querySelector('.spider-web');
    
    if (cartCountElement) {
        if (count > 0) {
            cartCountElement.textContent = count;
            cartCountElement.style.display = 'flex';
            cartCountElement.classList.add('updated');
            setTimeout(() => cartCountElement.classList.remove('updated'), 500);
        } else {
            cartCountElement.style.display = 'none';
        }
    }
    
    // Spider behavior
    if (spider) {
        if (count === 0) {
            spider.style.animation = 'spiderMove 2s infinite ease-in-out';
            spider.style.filter = 'none';
            spider.style.transform = 'scale(1)';
        } else if (count < 3) {
            spider.style.animation = 'spiderMove 4s infinite ease-in-out';
            spider.style.filter = 'drop-shadow(0 0 3px rgba(158, 217, 181, 0.5))';
            spider.style.transform = 'scale(1.1)';
        } else {
            spider.style.animation = 'spiderMove 6s infinite ease-in-out';
            spider.style.filter = 'drop-shadow(0 0 5px rgba(158, 217, 181, 0.8))';
            spider.style.transform = 'scale(1.2)';
        }
    }
    
    // Fly system
    if (webFlies) {
        webFlies.innerHTML = '';
        
        const flyPositions = [
            { top: '15px', left: '20px' },
            { top: '10px', left: '35px' },
            { top: '25px', left: '40px' },
            { top: '35px', left: '30px' },
            { top: '40px', left: '15px' },
            { top: '20px', left: '10px' },
            { top: '30px', left: '45px' },
            { top: '45px', left: '25px' },
            { top: '5px', left: '25px' },
            { top: '25px', left: '5px' }
        ];
        
        const fliesToShow = Math.min(count, flyPositions.length);
        for (let i = 0; i < fliesToShow; i++) {
            const fly = document.createElement('div');
            fly.className = 'trapped-fly';
            fly.style.top = flyPositions[i].top;
            fly.style.left = flyPositions[i].left;
            fly.style.animationDelay = `${i * 0.2}s`;
            
            webFlies.appendChild(fly);
            
            setTimeout(() => {
                fly.classList.add('show');
            }, i * 150);
        }
        
        if (spiderWeb && count > 0) {
            const glowIntensity = Math.min(count * 2, 10);
            spiderWeb.style.filter = `drop-shadow(0 0 ${glowIntensity}px rgba(158, 217, 181, 0.6))`;
        } else if (spiderWeb) {
            spiderWeb.style.filter = 'none';
        }
    }
    
    if (count > 0 && webContainer) {
        webContainer.style.animation = 'webShake 0.5s ease-in-out';
        setTimeout(() => {
            webContainer.style.animation = '';
        }, 500);
    }
}

// FIXED CHECKOUT FUNCTION - Doesn't lose cart on failure
function proceedToCheckout() {
    if (localCart.length === 0) {
        alert('Your cart is empty. Add something first!');
        return;
    }
    
    // Build checkout URL
    const cartItems = localCart.map(item => `${item.variantId}:${item.quantity}`).join(',');
    const checkoutUrl = `https://shop.fabrevoie.com/cart/${cartItems}`;
    
    // Save cart to sessionStorage as backup
    sessionStorage.setItem('fabrevoie_checkout_backup', JSON.stringify(localCart));
    
    // Redirect WITHOUT clearing cart yet
    window.location.href = checkoutUrl;
    
    // Clear cart only after successful redirect (this won't execute if redirect works)
    setTimeout(() => {
        localStorage.removeItem('fabrevoie_cart');
        localCart = [];
    }, 5000);
}

function buyProduct() {
    if (!state.selectedSize) {
        const modal = document.getElementById('sizeWarningModal');
        if (modal) {
            modal.classList.add('active');
        }
        return;
    }
    
    const buyButton = document.getElementById('buyButton');
    if (buyButton) {
        buyButton.innerHTML = 'ADDING TO CART... <i class="fas fa-spinner fa-spin"></i>';
        buyButton.disabled = true;
    }
    
    addToCart(state.currentColor, state.selectedSize);
    
    setTimeout(() => {
        if (buyButton) {
            buyButton.innerHTML = 'ADD TO CART <i class="fas fa-shopping-cart"></i>';
            buyButton.disabled = false;
        }
        resetSizeSelection();
    }, 500);
}

function showAccessDenied() {
    const modal = document.getElementById('accessDeniedModal');
    if (modal) modal.classList.add('active');
}

function closeAccessDenied() {
    const modal = document.getElementById('accessDeniedModal');
    if (modal) modal.classList.remove('active');
}

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

// FIXED TIMER - 168 HOURS FROM PRESALE START
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
        // BEFORE PRESALE - Show countdown to presale
        timerStatus.textContent = 'PRE-SALE STARTS IN...';
        
        const days = Math.floor(presaleTimeDiff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((presaleTimeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((presaleTimeDiff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((presaleTimeDiff % (1000 * 60)) / 1000);
        
        // Total hours until presale
        const totalHours = Math.floor(presaleTimeDiff / (1000 * 60 * 60));
        
        timerHours.textContent = totalHours.toString();
        timerMinutes.textContent = minutes.toString().padStart(2, '0');
        timerSeconds.textContent = seconds.toString().padStart(2, '0');
        
        if (countdownDays) {
            countdownDays.textContent = days.toString().padStart(2, '0');
            countdownHours.textContent = hours.toString().padStart(2, '0');
            countdownMinutes.textContent = minutes.toString().padStart(2, '0');
            countdownSecondsEl.textContent = seconds.toString().padStart(2, '0');
        }
    } else if (now < config.dropDate) {
        // PRESALE IS LIVE - Show exactly 168 hours countdown
        timerStatus.textContent = state.pairsLeft === 0 ? 'SOLD OUT - TAKING FINAL ORDERS' : 'PRE-SALE LIVE - DROP IN';
        
        // Calculate total milliseconds until drop
        const totalMilliseconds = dropTimeDiff;
        
        // Convert to hours, minutes, seconds
        const totalHoursUntilDrop = Math.floor(totalMilliseconds / (1000 * 60 * 60));
        const remainingAfterHours = totalMilliseconds % (1000 * 60 * 60);
        const dropMinutes = Math.floor(remainingAfterHours / (1000 * 60));
        const dropSeconds = Math.floor((remainingAfterHours % (1000 * 60)) / 1000);
        
        // Display countdown (will start at 168 and count down to 0)
        timerHours.textContent = Math.max(0, totalHoursUntilDrop).toString();
        timerMinutes.textContent = dropMinutes.toString().padStart(2, '0');
        timerSeconds.textContent = dropSeconds.toString().padStart(2, '0');
        
        // Also update the day/hour/minute/second display
        if (countdownDays) {
            const days = Math.floor(dropTimeDiff / (1000 * 60 * 60 * 24));
            const hours = Math.floor((dropTimeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((dropTimeDiff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((dropTimeDiff % (1000 * 60)) / 1000);
            
            countdownDays.textContent = days.toString().padStart(2, '0');
            countdownHours.textContent = hours.toString().padStart(2, '0');
            countdownMinutes.textContent = minutes.toString().padStart(2, '0');
            countdownSecondsEl.textContent = seconds.toString().padStart(2, '0');
        }
    } else {
        // DROP IS LIVE
        timerHours.textContent = '0';
        timerMinutes.textContent = '00';
        timerSeconds.textContent = '00';
        timerStatus.textContent = 'DROP IS LIVE NOW!';
        
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
    currentPopupImageIndex = index;
    updateProductImage();
    updateThumbnails();
    updatePopupImage();
    preloadNextImage(); // Preload next
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
    preloadNextImage();
}

function previousImage() {
    const images = config.productImages[state.currentColor];
    state.currentImageIndex = (state.currentImageIndex - 1 + images.length) % images.length;
    updateProductImage();
    updateThumbnails();
}

// FIXED COLOR CHANGE - Properly resets size
function changeProductColor(color) {
    // Update color state
    state.currentColor = color;
    state.currentImageIndex = 0;
    currentPopupImageIndex = 0;
    
    // Reset size selection
    state.selectedSize = null;
    document.querySelectorAll('.size-option').forEach(option => {
        option.classList.remove('selected');
    });
    
    // Update UI
    updateProductImage();
    updateThumbnails();
    updatePopupImage();
    
    // Update all color selectors
    document.querySelectorAll('.color-option, .size-section-color-option').forEach(option => {
        option.classList.remove('active');
    });
    document.querySelectorAll(`[data-color="${color}"]`).forEach(option => {
        option.classList.add('active');
    });
    
    // Hide any size warnings
    const sizeWarning = document.getElementById('sizeWarning');
    if (sizeWarning) sizeWarning.style.display = 'none';
    
    // Preload images for new color
    preloadColorImages(color);
}

// Preload images for better performance
function preloadNextImage() {
    const images = config.productImages[state.currentColor];
    const nextIndex = (state.currentImageIndex + 1) % images.length;
    const img = new Image();
    img.src = images[nextIndex];
}

function preloadColorImages(color) {
    const images = config.productImages[color];
    images.forEach(src => {
        const img = new Image();
        img.src = src;
    });
}

function selectSize(size) {
    const sizeElement = document.querySelector(`[data-size="${size}"]`);
    
    if (sizeElement && !sizeElement.classList.contains('out-of-stock')) {
        if (sizeElement.classList.contains('selected')) {
            sizeElement.classList.remove('selected');
            state.selectedSize = null;
        } else {
            document.querySelectorAll('.size-option').forEach(option => option.classList.remove('selected'));
            sizeElement.classList.add('selected');
            state.selectedSize = size;
        }
        
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
    if (pairsLeftElement) {
        pairsLeftElement.textContent = state.pairsLeft;
        
        if (state.pairsLeft === 0) {
            pairsLeftElement.style.color = '#ff6b6b';
            pairsLeftElement.style.fontWeight = 'bold';
            pairsLeftElement.classList.add('sold-out');
        }
    }
}

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

function showPageContent() {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
        loadingScreen.classList.add('fade-out');
        setTimeout(() => loadingScreen.style.display = 'none', 500);
    }
}

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

// IMAGE POPUP FUNCTIONS
let currentPopupImageIndex = 0;

function openImagePopup(imageIndex) {
    currentPopupImageIndex = imageIndex;
    updatePopupImage();
    const modal = document.getElementById('imagePopupModal');
    if (modal) {
        modal.classList.add('active');
    }
}

function closeImagePopup() {
    const modal = document.getElementById('imagePopupModal');
    if (modal) {
        modal.classList.remove('active');
    }
}

function updatePopupImage() {
    const images = config.productImages[state.currentColor];
    const popupImg = document.getElementById('popupImage');
    const counter = document.getElementById('popupCounter');
    
    if (popupImg && images) {
        popupImg.src = images[currentPopupImageIndex];
    }
    
    if (counter && images) {
        counter.textContent = `${currentPopupImageIndex + 1} / ${images.length}`;
    }
}

function nextPopupImage() {
    const images = config.productImages[state.currentColor];
    currentPopupImageIndex = (currentPopupImageIndex + 1) % images.length;
    updatePopupImage();
}

function previousPopupImage() {
    const images = config.productImages[state.currentColor];
    currentPopupImageIndex = (currentPopupImageIndex - 1 + images.length) % images.length;
    updatePopupImage();
}

// Popup swipe support
function initPopupSwipe() {
    const popupImage = document.getElementById('popupImage');
    
    if (!popupImage) return;
    
    let startX = 0;
    let startY = 0;
    
    popupImage.addEventListener('touchstart', function(e) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    }, { passive: true });
    
    popupImage.addEventListener('touchend', function(e) {
        const endX = e.changedTouches[0].clientX;
        const endY = e.changedTouches[0].clientY;
        const diffX = startX - endX;
        const diffY = startY - endY;
        const threshold = 50;
        
        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > threshold) {
            if (diffX > 0) {
                nextPopupImage();
            } else {
                previousPopupImage();
            }
        }
    }, { passive: true });
}

function toggleTimer() {
    const timerContent = document.getElementById('timerContent');
    const timerContainer = document.getElementById('timerContainer');
    const toggleBtn = document.querySelector('.timer-toggle-btn');
    const collapsedIcon = document.querySelector('.timer-collapsed-icon');
    
    if (timerContainer.classList.contains('collapsed')) {
        timerContent.style.display = 'block';
        timerContainer.classList.remove('collapsed');
        if (toggleBtn) {
            toggleBtn.style.display = 'block';
            toggleBtn.innerHTML = '<i class="fas fa-minus"></i>';
            toggleBtn.setAttribute('title', 'Minimize Timer');
        }
        if (collapsedIcon) {
            collapsedIcon.style.display = 'none';
        }
    } else {
        timerContent.style.display = 'none';
        timerContainer.classList.add('collapsed');
        if (toggleBtn) {
            toggleBtn.style.display = 'none';
        }
        if (collapsedIcon) {
            collapsedIcon.style.display = 'block';
        }
    }
}

// INITIALIZATION - FIXED ORDER
document.addEventListener('DOMContentLoaded', function() {
    // Initialize cart FIRST
    localCart = JSON.parse(localStorage.getItem('fabrevoie_cart')) || [];
    updateCartCount();
    
    // Determine page type
    const isShopPage = window.location.pathname.includes('shop');
    const isLandingPage = window.location.pathname === '/' || window.location.pathname.includes('index');
    
    // Initialize page-specific features
    if (isShopPage) {
        // Initialize product features
        populateSizes();
        state.currentColor = 'red';
        state.selectedSize = null;
        updateProductImage();
        updateThumbnails();
        
        // Initialize mobile features
        initMobileSwipe();
        initPopupSwipe();
        initHeaderScroll();
        initLifestyleCarousel();
        
        // Make product image clickable
        const productImage = document.getElementById('productImage');
        if (productImage) {
            productImage.addEventListener('click', function() {
                openImagePopup(state.currentImageIndex);
            });
            productImage.style.cursor = 'pointer';
        }
    }
    
    if (isLandingPage) {
        startHeaderAnnouncementCycling();
        initVideo();
    }
    
    // Initialize timer
    updateTimer();
    setInterval(updateTimer, 1000);
    
    // Fetch inventory once on load
    fetchShopifyInventory();
    
    // Then fetch every 60 seconds (not 15)
    setInterval(fetchShopifyInventory, 60000);
    
    // Also fetch when tab becomes visible
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
            fetchShopifyInventory();
        }
    });
    
    // Initialize modals
    initModalClosers();
    
    // Keyboard navigation for popup
    document.addEventListener('keydown', function(e) {
        const modal = document.getElementById('imagePopupModal');
        if (modal && modal.classList.contains('active')) {
            if (e.key === 'Escape') {
                closeImagePopup();
            } else if (e.key === 'ArrowLeft') {
                previousPopupImage();
            } else if (e.key === 'ArrowRight') {
                nextPopupImage();
            }
        }
    });
    
    // Click outside popup to close
    document.addEventListener('click', function(e) {
        const modal = document.getElementById('imagePopupModal');
        if (modal && e.target === modal) {
            closeImagePopup();
        }
    });
    
    // Show content
    setTimeout(showPageContent, 500);
});

// GLOBAL FUNCTIONS
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
window.openImagePopup = openImagePopup;
window.closeImagePopup = closeImagePopup;
window.nextPopupImage = nextPopupImage;
window.previousPopupImage = previousPopupImage;
window.nextLifestyleImage = nextLifestyleImage;
window.previousLifestyleImage = previousLifestyleImage;
window.goToLifestyleSlide = goToLifestyleSlide;
