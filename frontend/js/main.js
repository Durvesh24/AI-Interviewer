/**
 * Main JavaScript for AI Interviewer
 * Handles Theme Toggle, Mobile Menu, and Global UI interactions.
 */

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initMobileMenu();
    updateYear();
});

/* --- Theme Management --- */
function initTheme() {
    // Always apply saved theme, regardless of whether a toggle button exists
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);

    const themeToggleBtn = document.getElementById('themeToggle');
    if (!themeToggleBtn) return;

    updateThemeIcon(savedTheme);

    themeToggleBtn.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';

        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        updateThemeIcon(newTheme);
    });
}

function updateThemeIcon(theme) {
    const iconSpan = document.querySelector('#themeToggle span');
    if (iconSpan) {
        iconSpan.innerText = theme === 'light' ? '🌙' : '☀️';
    }
}

/* --- Mobile Menu --- */
function initMobileMenu() {
    const toggle = document.querySelector('.mobile-toggle');
    const navLinks = document.querySelector('.nav-links');

    if (toggle && navLinks) {
        toggle.addEventListener('click', () => {
            navLinks.classList.toggle('active');
        });
    }
}

/* --- Utilities --- */
function updateYear() {
    const yearSpan = document.getElementById('currentYear');
    if (yearSpan) {
        yearSpan.innerText = new Date().getFullYear();
    }
}

// Global Toast Notification
window.showToast = function (message, type = 'info') {
    const container = document.querySelector('.toast-container');
    if (!container) {
        const newContainer = document.createElement('div');
        newContainer.className = 'toast-container';
        document.body.appendChild(newContainer);
    }

    // Re-select in case we just created it
    const toastContainer = document.querySelector('.toast-container');

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerText = message;

    // Color coding based on type
    if (type === 'error') toast.style.borderLeftColor = 'var(--secondary)';
    if (type === 'success') toast.style.borderLeftColor = '#10B981';

    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
};

/* --- Global Logout --- */
window.logout = function () {
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('userRole');
    sessionStorage.removeItem('userEmail');
    showToast('Logged out successfully.', 'success');
    setTimeout(() => {
        window.location.href = 'index.html';
    }, 1000);
}
