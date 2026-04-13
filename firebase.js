// Firebase v10.13.2 Stable SDK Implementation
import "https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js";
import "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth-compat.js";
import "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore-compat.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, sendPasswordResetEmail, RecaptchaVerifier, signInWithPhoneNumber } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, enableIndexedDbPersistence, collection, query, where, orderBy, limit, onSnapshot, doc } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";
import { getMessaging, isSupported } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-analytics.js";

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
// Initialize Firebase (Modular)
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// Modular objects for new realtime listeners and other internal operations
window.authMod = getAuth(app);
window.dbMod = getFirestore(app);
window.rtdb = getDatabase(app);
window.storage = getStorage(app);
window.functionsMod = getFunctions(app);

// Bridge to Compat layer for legacy app.js support
// Use the already initialized app instance if possible
if (window.firebase) {
    window.firebase.initializeApp(firebaseConfig);
    window.auth = window.firebase.auth();
    window.db = window.firebase.firestore();
} else {
    console.warn("Firebase Compat SDK not found.");
}

window.isCloudConnected = false;
window.firebaseConfig = firebaseConfig;
window.initFirebase = initFirebase;

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

/**
 * Sets up a real-time listener for the current user's profile document.
 */
window.setupUserProfileListener = function(uid) {
    if (!window.dbMod) return;

    if (firebaseUnsubs.profile) {
        firebaseUnsubs.profile();
        firebaseUnsubs.profile = null;
    }

    // Optimized Collection Discovery Logic
    const roleHint = localStorage.getItem('kirya_user_role_hint');
    let collectionsToTry = ['users', 'admin_accounts', 'riders', 'restaurants'];
    
    // Reorder based on hint to minimize latency and re-sync errors
    if (roleHint === 'admin') collectionsToTry = ['admin_accounts', 'users', 'riders', 'restaurants'];
    else if (roleHint === 'rider') collectionsToTry = ['riders', 'users', 'admin_accounts', 'restaurants'];
    else if (roleHint === 'vendor') collectionsToTry = ['restaurants', 'users', 'admin_accounts', 'riders'];

    const startListener = (index) => {
        const coll = collectionsToTry[index];
        return onSnapshot(doc(window.dbMod, coll, uid), (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.data();
                window.currentUser = { ...window.currentUser, ...data, id: uid, _collection: coll };
                
                // Update local hint based on verified role
                const newHint = (data.role === 'Super Admin' || data.role === 'Manager') ? 'admin' : data.role;
                localStorage.setItem('kirya_user_role_hint', newHint);
                
                if (window.updateProfileUI) window.updateProfileUI();
                if (window.appReady && !window.isRouted && window.proceedToHome) {
                    window.proceedToHome(true);
                }
            } else if (index < collectionsToTry.length - 1) {
                // Fallback: Try next collection if not found here
                if (firebaseUnsubs.profile) firebaseUnsubs.profile();
                firebaseUnsubs.profile = startListener(index + 1);
            }
        }, (error) => {
            // Fallback: Try next collection if permission denied (likely wrong user type for this collection)
            if (error.code === 'permission-denied' && index < collectionsToTry.length - 1) {
                if (firebaseUnsubs.profile) firebaseUnsubs.profile();
                firebaseUnsubs.profile = startListener(index + 1);
            } else {
                console.error(`Firebase: Profile listener error [${coll}]`, error);
            }
        });
    };

    firebaseUnsubs.profile = startListener(0);
};

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
                console.log("Firebase: Auth state unchanged.");
                return;
            }

            firebaseAuthState.initialized = true;
            firebaseAuthState.signedIn = signedIn;
            firebaseAuthState.uid = uid;

            if (user) {
                console.log("Firebase: Auth state changed ->", user.uid);
                if (!window.currentUser) window.currentUser = { id: user.uid };
                else window.currentUser.id = user.uid;

                if (window.setupUserProfileListener) window.setupUserProfileListener(user.uid);
                if (window.setupFirebaseListeners) window.setupFirebaseListeners();
                window.isCloudConnected = true;
            } else {
                // Only clear session if we were previously signed in to avoid wiping Guest/Demo state on init
                if (firebaseAuthState.signedIn) {
                    window.clearUserSession();
                }
                window.isCloudConnected = false;
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
                await signInWithPopup(window.authMod, provider);
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
        window.isCloudConnected = false;
    }
}

// Helper to log activities to Firestore
window.logToFirestore = function(action, details = {}) {
    if (!window.db) return;
    const log = {
        action,
        details: typeof details === 'string' ? details : JSON.stringify(details),
        user: window.currentUser ? (window.currentUser.name || window.currentUser.id) : 'System',
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        time: new Date().toLocaleString()
    };
    window.db.collection('admin_logs').add(log).catch(e => console.error("Log error", e));
};

// Bridge for Auth user creation
// Note: This is a placeholder for a Cloud Function call
window.adminCreateAuthUser = async function(type, formData) {
    try {
        const createUser = httpsCallable(window.functionsMod, 'adminCreateUser');
        const result = await createUser(formData);
        
        window.logToFirestore('Auth Creation Success', {
            type: type,
            uid: result.data.uid
        });
        return result.data;
    } catch (error) {
        console.error("Cloud function error:", error);
        window.showToast("Auth Creation Failed: " + error.message);
        throw error;
    }
};

// Bridge functions for Admin creation in app.js
window.adminCreateVendor = async function(data) {
    if (!window.db || !window.authMod.currentUser) {
        console.warn("Firestore Sync: Using Local/Demo session. Skipping remote write to avoid permission error.");
        return Promise.resolve();
    }
    const id = data.id.toString();
    return window.db.collection('restaurants').doc(id).set(data, { merge: true });
};

window.adminCreateUserRecord = async function(data) {
    if (!window.db || !window.authMod.currentUser) {
        console.warn("Firestore Sync: Using Local/Demo session. Skipping remote write to avoid permission error.");
        return Promise.resolve();
    }
    const col = data.role === 'rider' ? 'riders' : 'users';
    const id = data.id.toString();
    return window.db.collection(col).doc(id).set(data, { merge: true });
};

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

    // Clear only specific app keys to avoid breaking Firebase internal state/callbacks
    const keysToRemove = [
        'kirya_user_profile',
        'kirya_cart',
        'kirya_user_settings',
        'kirya_last_screen',
        'kirya_notifications',
        'kirya_user_role_hint'
    ];
    keysToRemove.forEach(k => {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
    });

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

        // ROLE-SPECIFIC DATA FETCHING (Hybrid Architecture)
        if (role === 'rider') {
            firebaseUnsubs.riderData = onSnapshot(doc(window.dbMod, 'riders', user.uid), (doc) => {
                if (doc.exists()) {
                    window.currentUser = { ...window.currentUser, ...doc.data() };
                    if (window.updateProfileUI) window.updateProfileUI();
                }
            });
        } else if (role === 'vendor') {
            firebaseUnsubs.vendorData = onSnapshot(doc(window.dbMod, 'vendors', user.uid), (doc) => {
                if (doc.exists()) {
                    window.currentUser = { ...window.currentUser, ...doc.data() };
                    if (window.updateProfileUI) window.updateProfileUI();
                }
            });
            // Real-time Products for Vendor
            firebaseUnsubs.products = onSnapshot(query(collection(window.dbMod, 'products'), where('vendorId', '==', user.uid)), (snap) => {
                const prods = [];
                snap.forEach(d => prods.push({id: d.id, ...d.data()}));
                window.merchantMenuItems = prods;
                if (window.renderMerchantMenuItems) window.renderMerchantMenuItems(prods);
            });
        }
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

        firebaseUnsubs.logs = onSnapshot(query(collection(window.dbMod, 'admin_logs'), orderBy('timestamp', 'desc'), limit(50)), (snapshot) => {
            const logs = [];
            snapshot.forEach((doc) => logs.push({ id: doc.id, ...doc.data() }));
            window.adminLogs = logs;
            if (document.getElementById('admin-logs') && document.getElementById('admin-logs').style.display !== 'none') {
                window.renderAdminLogs();
            }
        });
    }
}


// Initialize Firebase when the script loads
initFirebase();
