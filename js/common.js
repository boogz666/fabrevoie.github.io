/**
 * FABREVOIE COMMON JAVASCRIPT
 * File: assets/js/common.js
 */

// Access Denied Modal Functions
function showAccessDenied(type = 'generic') {
    // Create modal if it doesn't exist
    if (!document.getElementById('accessDeniedModal')) {
        createAccessDeniedModal();
    }
    
    const modal = document.getElementById('accessDeniedModal');
    const text = document.getElementById('accessDeniedText');
    
    // Different messages for different contexts
    const messages = {
        generic: 'This page doesn\'t exist yet.<br>We\'re too busy making shoes that cost more than your rent.',
        checkout: 'Checkout? Not yet.<br>We\'re still perfecting the art of taking your money.',
        bundle: 'Bundle deals? That\'s premium content.<br>Come back when you\'re ready to commit.',
        faq: 'FAQ? We don\'t have frequent questions.<br>We have frequent complaints.',
        size_guide: 'Size guide? Figure it out yourself.<br>Life doesn\'t come with instructions either.',
        career: 'Careers? We don\'t hire.<br>We select the chosen few.',
        press: 'Press? We don\'t do interviews.<br>Our shoes speak for themselves.',
        world_domination: 'World domination plans?<br>That\'s classified information.',
        join_dark_side: 'Join the dark side?<br>You\'re not ready for this level of commitment.',
        cookies: 'Cookie warning?<br>The only cookies here are the ones you regret eating.',
        page_not_found: 'This page? Nah. We don\'t care.<br>We\'re too busy making shoes that cost more than your rent.'
    };
    
    text.innerHTML = messages[type] || messages.generic;
    modal.classList.add('active');
    
    // Prevent background scrolling
    document.body.style.overflow = 'hidden';
}

function closeAccessDenied() {
    const modal = document.getElementById('accessDeniedModal');
    if (modal) {
        modal.classList.remove('active');
        // Restore background scrolling
        document.body.style.overflow = '';
    }
}

function createAccessDeniedModal() {
    const modalHTML = `
        <div class="access-denied-modal" id="accessDeniedModal">
            <div class="access-denied-content">
                <h2 class="access-denied-title">ACCESS DENIED</h2>
                <p class="access-denied-text" id="accessDeniedText">
                    This page doesn't exist yet.<br>We're too busy making shoes that cost more than your rent.
                </p>
                <button class="access-denied-close" onclick="closeAccessDenied()">UNDERSTOOD</button>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Add event listeners
    const modal = document.getElementById('accessDeniedModal');
    
    // Close modal when clicking outside
    modal.addEventListener('click', function(e) {
        if (e.target === this) {
            closeAccessDenied();
        }
    });
    
    // Close modal with Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeAccessDenied();
        }
    });
}

// Footer Creation Function
function createFooter() {
    const footerHTML = `
        <footer class="fabrevoie-footer">
            <div class="footer-content">
                <div class="footer-section">
                    <h4>About Fabrevoie</h4>
                    <p>We make shoes for people who enter rooms like natural disasters. If you need permission to stand out, these aren't for you.</p>
                    <div class="footer-social">
                        <a href="https://www.instagram.com/fabrevoie" target="_blank" aria-label="Follow us on Instagram">
                            <i class="fab fa-instagram"></i>
                        </a>
                        <a href="https://www.tiktok.com/@fabrevoie" target="_blank" aria-label="Follow us on TikTok">
                            <i class="fab fa-tiktok"></i>
                        </a>
                        <a href="#" target="_blank" aria-label="Follow us on Twitter">
                            <i class="fab fa-twitter"></i>
                        </a>
                    </div>
                </div>

                <div class="footer-section">
                    <h4>Customer Care</h4>
                    <ul>
                        <li><a href="contact.html">Contact Support</a></li>
                        <li><a href="#" onclick="showAccessDenied('size_guide')">Size Guide</a></li>
                        <li><a href="shipping.html">Shipping Info</a></li>
                        <li><a href="returns.html">Returns (Good Luck)</a></li>
                        <li><a href="#" onclick="showAccessDenied('faq')">FAQ</a></li>
                    </ul>
                </div>

                <div class="footer-section">
                    <h4>Company</h4>
                    <ul>
                        <li><a href="about.html">About Us</a></li>
                        <li><a href="#" onclick="showAccessDenied('join_dark_side')">Join the Dark Side</a></li>
                        <li><a href="#" onclick="showAccessDenied('press')">Press</a></li>
                        <li><a href="#" onclick="showAccessDenied('world_domination')">World Domination Plans</a></li>
                    </ul>
                </div>

                <div class="footer-section">
                    <h4>Legal Stuff</h4>
                    <ul>
                        <li><a href="privacy-policy.html">Privacy Policy</a></li>
                        <li><a href="terms.html">Terms (Non-Negotiable)</a></li>
                        <li><a href="returns.html">No Refunds Policy</a></li>
                        <li><a href="#" onclick="showAccessDenied('cookies')">Cookie Warning</a></li>
                    </ul>
                </div>
            </div>

            <div class="footer-bottom">
                <p>&copy; 2025, Fabrevoie, Inc. All rights reserved. | <a href="privacy-policy.html">Privacy</a> | Made for villains, by villains</p>
            </div>
        </footer>
    `;
    
    document.body.insertAdjacentHTML('beforeend', footerHTML);
}

// Navigation Functions
function goBack() {
    const referrer = document.referrer;
    if (referrer && referrer.includes(window.location.hostname)) {
        if (referrer.includes('#shop') || referrer.includes('productOverlay')) {
            window.location.href = 'index.html#shop';
        } else {
            window.history.back();
        }
    } else {
        window.location.href = 'index.html';
    }
}

// Initialize common functionality when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Auto-create footer if it doesn't exist
    if (!document.querySelector('.fabrevoie-footer')) {
        createFooter();
    }
    
    // Auto-create access denied modal
    createAccessDeniedModal();
});

// Global utility functions
window.showAccessDenied = showAccessDenied;
window.closeAccessDenied = closeAccessDenied;
window.goBack = goBack;
