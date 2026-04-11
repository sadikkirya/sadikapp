// Firebase v12.12.0 Modular SDK Implementation
import "https://www.gstatic.com/firebasejs/12.12.0/firebase-app-compat.js";
import "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth-compat.js";
import "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore-compat.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithRedirect, signOut, onAuthStateChanged, sendPasswordResetEmail, RecaptchaVerifier, signInWithPhoneNumber } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import { getFirestore, enableIndexedDbPersistence, collection, query, where, orderBy, limit, onSnapshot } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-database.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-storage.js";
import { getMessaging, isSupported } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-messaging.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-analytics.js";

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyBZ_7aveKKu7UsIi03wSzjptuZ38XqfJvc",
    authDomain: "delivery-app-6a47f.firebaseapp.com",
    projectId: "delivery-app-6a47f",
    storageBucket: "delivery-app-6a47f.firebasestorage.app",
    messagingSenderId: "525706344286",
    appId: "1:525706344286:web:1ce4079529b7f0d09d81cf",
    measurementId: "G-N9HGCESZTS"
};

// Initialize Firebase
if (!window.firebase) {
    throw new Error('Firebase compat SDK failed to load.');
}
const compatApp = window.firebase.initializeApp(firebaseConfig);
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// Compatibility objects for legacy app.js code
window.firebase = window.firebase;
window.auth = window.firebase.auth();
window.db = window.firebase.firestore();
window.firebaseConfig = firebaseConfig;
window.initFirebase = initFirebase;

// Modular objects for new realtime listeners and other internal operations
window.authMod = getAuth(app);
// If using a named database, specify it here: getFirestore(app, "your-db-id")
window.dbMod = getFirestore(app); 
window.rtdb = getDatabase(app);
window.storage = getStorage(app);

// Initialize messaging only if supported
isSupported().then(supported => {
    if (supported) {
        window.messaging = getMessaging(app);
        // Explicitly register the service worker to ensure it's active for push subscriptions
        navigator.serviceWorker.register('/firebase-messaging-sw.js')
            .then((reg) => console.log("Firebase: SW registered", reg.scope))
            .catch((err) => console.warn("Firebase: SW registration failed", err));
    }
});

// Store unsubscribe functions to prevent duplicate listeners
let lastVisibleDocs = {
    orders: null,
    restaurants: null,
    customers: null,
    logs: null
};
const PAGE_SIZE = 15;
let authListenerRegistered = false;
let firebaseAuthState = { initialized: false, signedIn: false, uid: null };

let firebaseUnsubs = { orders: null, riders: null, customers: null, restaurants: null, promotions: null, payments: null, support: null, accounts: null, logs: null, analytics: null, chat: null, profile: null };

function initFirebase() {
    try {
        console.log("Firebase Initialized with Modular SDK");

        // Set up auth state listener
        onAuthStateChanged(window.authMod, (user) => {
            const signedIn = !!user;
            const uid = user ? user.uid : null;
            const authChanged = !firebaseAuthState.initialized
                || firebaseAuthState.signedIn !== signedIn
                || (signedIn && firebaseAuthState.uid !== uid);

            if (!authChanged) {
                console.log("Firebase: Auth state unchanged, skipping session reset.");
                return;
            }

            firebaseAuthState.initialized = true;
            firebaseAuthState.signedIn = signedIn;
            firebaseAuthState.uid = uid;

            if (user) {
                console.log("Firebase: Auth state changed ->", user.uid);
                if (!window.currentUser) window.currentUser = { id: user.uid };
                else window.currentUser.id = user.uid;

                window.setupUserProfileListener(user.uid);
                if (window.setupFirebaseListeners) window.setupFirebaseListeners();
            } else {
                window.clearUserSession();
                // Handle potential errors returning from a redirect login flow
                if (window.authMod) {
                    // Note: getRedirectResult is not available in modular SDK v9+
                    // Error handling for redirect flows should be done in the signInWithRedirect call
                }
                if (window.showLoginScreen) window.showLoginScreen();
            }
        });

        // 1. ENABLE OFFLINE PERSISTENCE (Local Sync) - MUST BE BEFORE ANY OTHER DB CALL
        try {
            enableIndexedDbPersistence(window.dbMod, { synchronizeTabs: true });
        } catch (e) {
            console.log('Firestore settings already configured or error:', e);
        }

        // Helpers for Auth Providers
        window.signInWithGoogle = async function() {
            try {
                const rememberMeEl = document.getElementById('loginRememberMe');
                const rememberMe = rememberMeEl ? rememberMeEl.checked : true;

                // Note: Persistence settings are handled differently in modular SDK
                // For now, we'll use default persistence

                const provider = new GoogleAuthProvider();
                // Switching to Redirect to bypass Cross-Origin-Opener-Policy (COOP) restrictions
                await signInWithRedirect(window.authMod, provider);
            } catch (error) {
                if (error.code === 'auth/unauthorized-domain') {
                    if (window.showToast) window.showToast("🚫 Domain unauthorized. Please add " + window.location.hostname + " to your Firebase Console settings.");
                } else {
                    if (window.showToast) window.showToast("🚫 Login Denied: " + error.message);
                }
                throw error;
            }
        };

        window.sendPasswordResetEmail = async function(email) {
            if (!window.authMod) throw new Error("Firebase Auth not initialized.");
            if (!email) throw new Error("Email is required for password reset.");

            try {
                await sendPasswordResetEmail(window.authMod, email);
                if (window.showToast) window.showToast("✅ Password reset email sent! Check your inbox.");
                return true;
            } catch (error) {
                console.error("Password Reset Error:", error);
                if (window.showToast) window.showToast("🚫 Password Reset Failed: " + error.message);
                throw error;
            }
        };

        window.sendOtp = async function(phoneNumber) {
            if (!phoneNumber || phoneNumber.length < 10) {
                if (window.showToast) window.showToast("⚠️ Invalid Phone Number format.");
                throw new Error("Invalid phone number");
            }

            // 1. Clear existing verifier instance
            if (window.recaptchaVerifier) {
                try { window.recaptchaVerifier.clear(); } catch(e) { console.error("Verifier clear error", e); }
            }

            // 2. Nuclear Reset: Re-create the DOM element to kill any lingering internal styles/iframes
            const oldContainer = document.getElementById('recaptcha-container');
            if (oldContainer) {
                const newContainer = document.createElement('div');
                newContainer.id = 'recaptcha-container';
                oldContainer.parentNode.replaceChild(newContainer, oldContainer);
            }

            window.recaptchaVerifier = new RecaptchaVerifier(window.authMod, 'recaptcha-container', {
                'size': 'invisible'
            });
            return signInWithPhoneNumber(window.authMod, phoneNumber, window.recaptchaVerifier);
        };

        // Start listeners only when Auth state is confirmed to prevent "Insufficient Permissions"
        // Ensure this listener is only registered once
        if (!authListenerRegistered) {
            console.log("Firebase: Initialized. Waiting for auth state to start listeners...");
            // setupFirebaseListeners() will now be triggered by onAuthStateChanged
            authListenerRegistered = true;
        }

        if (window.showToast) window.showToast("✅ Firebase Connected");
        updateNetworkStatusUI();
    } catch (e) {
        console.error("Firebase Init Error:", e);
    }
}

/**
 * Global Logout Function
 * Signs out of Firebase Auth. The onAuthStateChanged listener
 * handles the subsequent UI reset and session clearing.
 */
window.logoutUser = async function() {
    try {
        if (window.showLoading) window.showLoading("Logging out...");
        if (!window.authMod) return;
        await signOut(window.authMod);
    } catch (error) {
        console.error("Logout Error:", error);
        if (window.showToast) showToast("❌ Error signing out.");
    } finally {
        if (window.hideLoading) window.hideLoading();
        // Removed hard reload - let confirmLogout handle screen transitions
        // window.location.href = window.location.pathname;
    }
};

/**
 * UI Helper: Show a loading overlay
 */
window.showLoading = function(message = "Loading...", progress = null) {
    let loader = document.getElementById('global-loader');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'global-loader';
        loader.innerHTML = `
            <div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(255,255,255,0.9);
            display:flex;flex-direction:column;justify-content:center;align-items:center;z-index:10000;font-family:sans-serif;">
                <div class="loader-spinner-container" style="display:flex; flex-direction:column; align-items:center;">
                    <div class="spinner" style="width:40px;height:40px;border:4px solid #f3f3f3;border-top:4px solid #3498db;border-radius:50%;animation:spin 1s linear infinite;"></div>
                </div>
                <p id="loader-text" style="margin-top:15px;color:#555;">${message}</p>
            </div>
            <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
        `;
        document.body.appendChild(loader);
    } else {
        document.getElementById('loader-text').textContent = message;
        loader.style.display = 'flex';
    }

    let barContainer = document.getElementById('loader-progress-container');
    if (progress !== null) {
        if (!barContainer) {
            barContainer = document.createElement('div');
            barContainer.id = 'loader-progress-container';
            barContainer.style.cssText = 'width:200px; height:8px; background:#eee; border-radius:4px; margin-top:15px; overflow:hidden;';
            barContainer.innerHTML = '<div id="loader-progress-bar" style="width:0%; height:100%; background:#019E81; transition:width 0.2s;"></div>';
            loader.querySelector('.loader-spinner-container').appendChild(barContainer);
        }
        barContainer.style.display = 'block';
        document.getElementById('loader-progress-bar').style.width = Math.round(progress) + '%';
    } else if (barContainer) {
        barContainer.style.display = 'none';
    }
};

/**
 * UI Helper: Hide the loading overlay
 */
window.hideLoading = function() {
    const loader = document.getElementById('global-loader');
    if (loader) loader.style.display = 'none';
};

/**
 * Clears the current user session to prevent role leakage
 * between different login attempts.
 */
window.clearUserSession = function() {
    console.log("Firebase: Clearing user session...");
    clearFirebaseListeners();

    window.currentUser = { role: 'user', points: 0, walletBalance: 0 };

    // Clear User Data from local storage
    localStorage.removeItem('kirya_user_profile');
    localStorage.removeItem('kirya_cart');
    localStorage.removeItem('kirya_user_settings');
    localStorage.removeItem('kirya_last_screen');
    localStorage.removeItem('kirya_notifications');
    localStorage.removeItem('kirya_user_role_hint');
    sessionStorage.clear(); // Clear session storage as well

    if (window.favorites) window.favorites.clear();
    if (window.cart) window.cart = [];
    if (window.notifications) window.notifications = [];

    if (document.getElementById('verificationLoadingScreen')) {
        document.getElementById('verificationLoadingScreen').style.display = 'none';
    }
};

/**
 * Returns the current user's role.
 * Defaults to 'user' if not logged in or role is undefined.
 */
window.getCurrentRole = function() {
    if (!window.currentUser || !window.currentUser.id) return 'user';
    return window.currentUser.role || 'user';
};

function updateNetworkStatusUI() {
    const indicators = document.querySelectorAll('.network-indicator');
    const isOnline = navigator.onLine;
    indicators.forEach(el => {
        el.className = 'network-indicator ' + (isOnline ? 'online' : 'offline');
        el.title = isOnline ? 'System Online' : 'System Offline (Local Data Only)';
    });
}

function clearFirebaseListeners() {
    const unsubscribeKeys = Object.keys(firebaseUnsubs);
    const hasActiveListeners = unsubscribeKeys.some(key => firebaseUnsubs[key]);
    if (!hasActiveListeners) return;

    unsubscribeKeys.forEach(key => {
        if (firebaseUnsubs[key]) {
            try {
                firebaseUnsubs[key]();
            } catch (err) {
                console.warn(`Firebase listener cleanup failed for ${key}:`, err);
            }
            firebaseUnsubs[key] = null;
        }
    });
}

function setupFirebaseListeners() {
    if (!window.dbMod) return;

    const user = window.authMod ? window.authMod.currentUser : null;
    const role = window.getCurrentRole ? window.getCurrentRole() : 'user';

    if (!user) {
        console.log("Firebase: Postponing Firestore listeners until user is logged in.");
        return;
    }

    if (firebaseUnsubs.orders) {
        firebaseUnsubs.orders();
        firebaseUnsubs.orders = null;
    }
    if (firebaseUnsubs.riders) {
        firebaseUnsubs.riders();
        firebaseUnsubs.riders = null;
    }
    if (firebaseUnsubs.customers) {
        firebaseUnsubs.customers();
        firebaseUnsubs.customers = null;
    }

    const isAdmin = ['admin', 'Super Admin', 'Manager'].includes(role);
    let ordersQuery;

    if (role === 'rider') {
        ordersQuery = query(
            collection(window.dbMod, 'orders'),
            where('riderId', '==', user.uid),
            orderBy('timestamp', 'desc'),
            limit(50)
        );
    } else if (!isAdmin) {
        ordersQuery = query(
            collection(window.dbMod, 'orders'),
            where('customerId', '==', user.uid),
            orderBy('timestamp', 'desc'),
            limit(25)
        );
    } else {
        ordersQuery = query(
            collection(window.dbMod, 'orders'),
            orderBy('timestamp', 'desc'),
            limit(50)
        );
    }

    firebaseUnsubs.orders = onSnapshot(ordersQuery, (snapshot) => {
        const orders = [];
        snapshot.forEach((doc) => {
            orders.push({ id: doc.id, ...doc.data() });
        });

        window.allOrders = orders;
        window.adminOrders = orders;

        if (window.renderAdminOrders && document.getElementById('admin-orders') && document.getElementById('admin-orders').style.display !== 'none') {
            window.renderAdminOrders();
        }
        if (window.renderAdminDashboard && document.getElementById('admin-dashboard') && document.getElementById('admin-dashboard').style.display !== 'none') {
            window.renderAdminDashboard();
        }
        if (document.getElementById('riderScreen') && document.getElementById('riderScreen').classList.contains('active') && window.updateRiderNearbyOrders) {
            window.updateRiderNearbyOrders();
        }
    }, (error) => {
        console.error('Firebase order listener error:', error);
    });

    if (isAdmin) {
        firebaseUnsubs.riders = onSnapshot(collection(window.dbMod, 'riders'), (snapshot) => {
            const riders = [];
            snapshot.forEach((doc) => riders.push({ id: doc.id, ...doc.data() }));
            window.adminRiders = riders;
            if (window.renderAdminRiders && document.getElementById('admin-riders') && document.getElementById('admin-riders').style.display !== 'none') {
                window.renderAdminRiders();
            }
        }, (error) => {
            console.error('Firebase rider listener error:', error);
        });

        firebaseUnsubs.customers = onSnapshot(collection(window.dbMod, 'customers'), (snapshot) => {
            const customers = [];
            snapshot.forEach((doc) => customers.push({ id: doc.id, ...doc.data() }));
            window.adminCustomers = customers;
            if (window.renderAdminCustomers && document.getElementById('admin-customers') && document.getElementById('admin-customers').style.display !== 'none') {
                window.renderAdminCustomers();
            }
        }, (error) => {
            console.error('Firebase customer listener error:', error);
        });

        firebaseUnsubs.restaurants = onSnapshot(collection(window.dbMod, 'restaurants'), (snapshot) => {
            const restaurants = [];
            snapshot.forEach((doc) => restaurants.push({ id: doc.id, ...doc.data() }));
            window.adminRestaurants = restaurants;
            if (window.renderAdminRestaurants && document.getElementById('admin-restaurants') && document.getElementById('admin-restaurants').style.display !== 'none') {
                window.renderAdminRestaurants();
            }
        }, (error) => {
            console.error('Firebase restaurant listener error:', error);
        });

        firebaseUnsubs.payments = onSnapshot(collection(window.dbMod, 'payments'), (snapshot) => {
            const payments = [];
            snapshot.forEach((doc) => payments.push({ id: doc.id, ...doc.data() }));
            window.adminPayments = payments;
            if (window.renderAdminPayments && document.getElementById('admin-payments') && document.getElementById('admin-payments').style.display !== 'none') {
                window.renderAdminPayments();
            }
        }, (error) => {
            console.error('Firebase payment listener error:', error);
        });

        firebaseUnsubs.support = onSnapshot(collection(window.dbMod, 'support'), (snapshot) => {
            const supportTickets = [];
            snapshot.forEach((doc) => supportTickets.push({ id: doc.id, ...doc.data() }));
            window.adminSupportTickets = supportTickets;
            if (window.renderAdminSupport && document.getElementById('admin-support') && document.getElementById('admin-support').style.display !== 'none') {
                window.renderAdminSupport();
            }
        }, (error) => {
            console.error('Firebase support listener error:', error);
        });
    }
}


// Initialize Firebase when the script loads
initFirebase();
