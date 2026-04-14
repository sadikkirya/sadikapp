// Firebase v10.13.2 Stable SDK Implementation
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, sendPasswordResetEmail, RecaptchaVerifier, signInWithPhoneNumber, signInWithEmailAndPassword, createUserWithEmailAndPassword, setPersistence, browserLocalPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { initializeFirestore, enableIndexedDbPersistence, collection, query, where, orderBy, limit, onSnapshot, doc, setDoc, updateDoc, getDoc, getDocs, addDoc, deleteDoc, serverTimestamp as fsTimestamp, setLogLevel, startAfter, writeBatch } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getDatabase, ref, set, onValue, off, update as rUpdate, remove as rRemove, get as rGet, serverTimestamp as rtdbTimestamp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js";
import { getStorage, ref as sRef, uploadBytesResumable, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";
import { getMessaging, isSupported as isMessagingSupported, getToken } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging.js";
import { getAnalytics, isSupported as isAnalyticsSupported, logEvent } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-analytics.js";

const firebaseConfig = {
    apiKey: "AIzaSyBZ_7aveKKu7UsIi03wSzjptuZ38XqfJvc",
    authDomain: "delivery-app-6a47f.firebaseapp.com",
    projectId: "delivery-app-6a47f",
    storageBucket: "delivery-app-6a47f.firebasestorage.app",
    messagingSenderId: "525706344286",
    appId: "1:525706344286:web:1ce4079529b7f0d09d81cf",
    measurementId: "G-N9HGCESZTS"
};

// Standard Singleton Initialization
let app;
if (!getApps().length) {
    app = initializeApp(firebaseConfig);
} else {
    app = getApp();
}

// Standardized Service Instances
window.auth = getAuth(app);
window.db = initializeFirestore(app, {
    experimentalForceLongPolling: true, // Resolves WebChannel stability issues
    experimentalAutoDetectLongPolling: false,
});
window.rtdb = getDatabase(app);
window.storage = getStorage(app);
window.functions = getFunctions(app);
window.isCloudConnected = true; // App is initialized and instances are ready

// Export persistence constants
window.authPersistenceSession = browserSessionPersistence;

// Expose core modular utilities globally for standard usage in app.js
window.query = query;
window.collection = collection;
window.where = where;
window.orderBy = orderBy;
window.limit = limit;
window.onSnapshot = onSnapshot;
window.doc = doc;
window.setDoc = setDoc;
window.updateDoc = updateDoc;
window.getDoc = getDoc;
window.getDocs = getDocs;
window.addDoc = addDoc;
window.deleteDoc = deleteDoc;
window.fsTimestamp = fsTimestamp;
window.writeBatch = writeBatch;
window.setPersistence = setPersistence;
window.rRef = ref;
window.rSet = set;
window.rUpdate = rUpdate;
window.rRemove = rRemove;
window.rGet = rGet;
window.rOnValue = onValue;
window.rOff = off;

// Safe Analytics Init after App check
isAnalyticsSupported().then(supported => {
    if (supported) {
        try {
            window.analytics = getAnalytics(app);
            console.log("Firebase: Analytics initialized.");
        } catch (err) { console.warn("Analytics blocked."); }
    }
}).catch(() => {});

// Enable Offline Persistence
enableIndexedDbPersistence(window.db, { synchronizeTabs: true }).catch((err) => {
    if (err.code === 'failed-precondition') console.warn('Multiple tabs open, persistence disabled.');
});

setLogLevel('error');

window.firebaseConfig = firebaseConfig;

// Initialize messaging only if supported
isMessagingSupported().then(supported => {
    if (supported) {
        window.messaging = getMessaging(app);
        navigator.serviceWorker.register('/firebase-messaging-sw.js')
            .then(() => console.log("FCM Service Worker Active"))
            .catch((err) => console.warn("FCM SW failed", err));
    }
});

window.requestNotificationPermission = async function() {
    if (!window.messaging) return;
    try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            // CRITICAL: You MUST use a valid VAPID Key here, not your API Key.
            // Find this in: Firebase Console > Project Settings > Cloud Messaging > Web configuration.
            // This is the long base64-encoded string provided for web push.
            const VAPID_KEY = 'BE6wVkQvHwvcaI41RmZEzigJJ85e4LRe2OrbidkWXZF6dGE3oOvMHPRYDYFLp2kr_dm6hbJYmhdgnyRF_We-oKE'; 
            
            const token = await getToken(window.messaging, { 
                vapidKey: VAPID_KEY
            });
            
            if (token && window.currentUser?.id) {
                console.log("FCM Token Acquired:", token);
                const col = window.currentUser._collection || 'users';
                await updateDoc(doc(window.db, col, window.currentUser.id), {
                    fcmToken: token,
                    notificationsEnabled: true,
                    lastTokenRefresh: new Date().toISOString()
                });
            }
        } else {
            console.warn("Notification permission denied.");
        }
    } catch (err) {
        console.error("Error acquiring FCM token:", err);
    }
};

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
    if (!window.db) return;

    if (firebaseUnsubs.profile) {
        firebaseUnsubs.profile();
        firebaseUnsubs.profile = null;
    }

    // Safety Timeout: If Firestore is slow/blocked, force navigation after 4 seconds
    // so the user isn't stuck on the login form indefinitely.
    const routingTimeout = setTimeout(() => {
        if (!window.isRouted && window.proceedToHome) {
            console.warn("Firebase: Profile fetch timed out. Proceeding with local/cached data.");
            window.proceedToHome(true);
        }
    }, 1500); // Aggressive 1.5s timeout for restricted networks

    // Optimized Collection Discovery Logic
    const roleHint = localStorage.getItem('kirya_user_role_hint') || 'user';
    let collectionsToTry = ['users', 'admin_accounts', 'riders', 'restaurants'];
    
    // Reorder based on hint to minimize latency and re-sync errors
    if (roleHint === 'admin') collectionsToTry = ['admin_accounts', 'users', 'riders', 'restaurants'];
    else if (roleHint === 'rider') collectionsToTry = ['riders', 'users', 'admin_accounts', 'restaurants'];
    else if (roleHint === 'vendor') collectionsToTry = ['restaurants', 'users', 'admin_accounts', 'riders'];

    // Admin Fast-Path: If we already know this is an admin via the auth email, skip the fallback loop
    const userEmail = window.authMod?.currentUser?.email?.toLowerCase() || '';
    const isProbableAdmin = userEmail === 'haj@kirya.app' || userEmail === 'sadik@kirya.app' || window.currentUser?.role === 'Super Admin';
    if (isProbableAdmin) {
        collectionsToTry = ['admin_accounts', 'users', 'riders', 'restaurants'];
    }

    const startListener = (index) => {
        const coll = collectionsToTry[index] || 'users';
        return onSnapshot(doc(window.db, coll, uid), (snapshot) => {
            if (snapshot.exists()) {
                clearTimeout(routingTimeout); // Cancel the safety timeout
                const data = snapshot.data();
                // Mark as not guest and ensure status defaults to active for admin collection if missing
                window.currentUser = { ...window.currentUser, ...data, id: uid, _collection: coll, isGuest: false };
                if (coll === 'admin_accounts' && !window.currentUser.status) window.currentUser.status = 'active';
                
                // Update local hint based on verified role
                const newHint = (data.role === 'Super Admin' || data.role === 'Manager') ? 'admin' : data.role;
                localStorage.setItem('kirya_user_role_hint', newHint);
                
                // Trigger UI updates if data changes in Firebase Console
                if (window.currentUser.status !== data.status && window.proceedToHome) window.proceedToHome(true);
                if (window.updateProfileUI) window.updateProfileUI();
                if (window.appReady && !window.isRouted && window.proceedToHome) {
                    window.proceedToHome(true);
                }
            } else if (index < collectionsToTry.length - 1) {
                // Fallback: Try next collection if not found here
                clearTimeout(routingTimeout); // Reset timeout for next attempt if needed
                if (firebaseUnsubs.profile) firebaseUnsubs.profile();
                firebaseUnsubs.profile = startListener(index + 1);
            }
        }, (error) => {
            const isLastAttempt = index >= collectionsToTry.length - 1;
            
            // Fallback: Try next collection if permission denied (likely wrong user type for this collection)
            if (error.code === 'permission-denied' && !isLastAttempt) {
                console.log(`Firebase: Discovery skipping [${coll}] due to restricted permissions.`);
                clearTimeout(routingTimeout);
                if (firebaseUnsubs.profile) firebaseUnsubs.profile();
                firebaseUnsubs.profile = startListener(index + 1);
            } else {
                // Only log if it's a non-permission error OR we've exhausted all collections
                if (error.code !== 'permission-denied' || isLastAttempt) {
                    console.error(`Firebase: Profile listener error [${coll}]`, error);
                }
            }
        });
    };

    firebaseUnsubs.profile = startListener(0);
};

function initFirebase() {
    try {
        console.log("Firebase Initialized with Modular SDK");

        // Expose Modular Auth Helpers to window for app.js
        window.authMod = window.auth;
        window.authSignIn = (email, pass) => signInWithEmailAndPassword(window.auth, email, pass);
        window.authSignUp = (email, pass) => createUserWithEmailAndPassword(window.auth, email, pass);
        window.authSignOut = () => signOut(window.auth);
        window.authSendPasswordReset = (email) => sendPasswordResetEmail(window.auth, email);

        if (authListenerRegistered) {
            console.log("Firebase: Auth listener already registered.");
            return;
        }

        // Set up auth state listener
        onAuthStateChanged(window.auth, (user) => {
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
                // Immediately mark as not guest and preserve existing data
                window.currentUser = { 
                    ...(window.currentUser || {}), 
                    id: user.uid, 
                    email: user.email,
                    isGuest: false 
                };

                // Admin Safety: If it's a known admin email, pre-set permissions to bypass network hangs
                const email = (user.email || '').toLowerCase().trim();
                if (email === 'haj@kirya.app' || email === 'sadik@kirya.app') {
                    // Only set role hint to help discovery, don't force collection or route yet
                    window.currentUser = { ...window.currentUser, role: 'Super Admin', isGuest: false };
                    
                    // SPEED UP: Start loading dashboard data immediately without waiting for profile snapshot
                    if (window.setupFirebaseListeners) window.setupFirebaseListeners();
                }
                
                if (window.setupUserProfileListener) window.setupUserProfileListener(user.uid);
                if (window.setupFirebaseListeners) window.setupFirebaseListeners();
            } else {
                // Only clear session if we were previously signed in to avoid wiping Guest/Demo state on init
                if (firebaseAuthState.signedIn) {
                    window.clearUserSession();
                }
                // App remains connected even if auth state is null
                if (window.showLoginScreen) window.showLoginScreen();
            }
        });

        // Helpers for Auth Providers
        window.signInWithGoogle = async function() {
            try {
                const rememberMeEl = document.getElementById('loginRememberMe');
                const rememberMe = rememberMeEl ? rememberMeEl.checked : true;

                // Note: Persistence settings are handled differently in modular SDK
                // For now, we'll use default persistence

                const provider = new GoogleAuthProvider();
                await signInWithPopup(window.auth, provider);
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
            if (!window.auth) throw new Error("Firebase Auth not initialized.");
            if (!email) throw new Error("Email is required for password reset.");

            try {
                await sendPasswordResetEmail(window.auth, email);
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

            window.recaptchaVerifier = new RecaptchaVerifier(window.auth, 'recaptcha-container', {
                'size': 'invisible'
            });
            return signInWithPhoneNumber(window.auth, phoneNumber, window.recaptchaVerifier);
        };

        // Start listeners only when Auth state is confirmed to prevent "Insufficient Permissions"
        // Ensure this listener is only registered once
        console.log("Firebase: Initialized. Waiting for auth state to start listeners...");
        authListenerRegistered = true;

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
        timestamp: fsTimestamp(),
        time: new Date().toLocaleString()
    };
    addDoc(collection(window.db, 'admin_logs'), log).catch(e => console.error("Log error", e));
};

/**
 * Updates the rider's live location in Realtime Database.
 */
window.updateRiderLiveLocation = function(riderId, lat, lng, status = 'online') {
    if (!window.rtdb || !riderId) return;
    const riderRef = ref(window.rtdb, `locations/riders/${riderId}`);
    set(riderRef, {
        lat,
        lng,
        status,
        timestamp: rtdbTimestamp(),
        name: window.currentUser?.name || 'Rider'
    }).catch(e => console.error("RTDB Update Error:", e));
};

/**
 * Listens to a specific rider's live location.
 * Returns an unsubscribe function.
 */
window.listenToRiderLiveLocation = function(riderId, callback) {
    if (!window.rtdb || !riderId) return () => {};
    const riderRef = ref(window.rtdb, `locations/riders/${riderId}`);
    const unsubscribe = onValue(riderRef, (snapshot) => {
        if (snapshot.exists()) {
            callback(snapshot.val());
        }
    });
    return () => off(riderRef, 'value', unsubscribe);
};

/**
 * Manual Data Refresh for Admins
 */
window.adminResync = function() {
    window.showToast("🔄 Re-syncing Firestore data...");
    if (window.setupFirebaseListeners) window.setupFirebaseListeners();
};

/**
 * Listens to a specific order for real-time status updates.
 */
window.listenToOrder = function(orderId, callback) {
    if (!window.db || !orderId) return () => {};
    return onSnapshot(doc(window.db, 'orders', orderId), (snapshot) => {
        if (snapshot.exists()) callback({ id: snapshot.id, ...snapshot.data() });
    });
};

/**
 * Uploads a blob to Firebase Storage and returns the download URL.
 */
window.uploadImageToStorage = async function(blob, path, onProgress) {
    if (!window.storage) throw new Error("Storage not initialized");
    const storageRef = sRef(window.storage, path);
    const uploadTask = uploadBytesResumable(storageRef, blob);

    return new Promise((resolve, reject) => {
        uploadTask.on('state_changed', 
            (snapshot) => {
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                if (onProgress) onProgress(progress);
            }, 
            (error) => reject(error), 
            () => {
                getDownloadURL(uploadTask.snapshot.ref).then((downloadURL) => {
                    resolve(downloadURL);
                });
            }
        );
    });
};

/**
 * Deletes an image from Firebase Storage using its URL.
 */
window.deleteImageFromStorage = async function(url) {
    if (!window.storage || !url || !url.includes('firebasestorage.googleapis.com')) return;
    try {
        const fileRef = sRef(window.storage, url);
        await deleteObject(fileRef);
    } catch (e) {
        console.warn("Storage deletion failed:", e);
    }
};

/**
 * Fetches a collection once (helper for admin lists).
 */
window.fetchCollectionOnce = async function(colName) {
    if (!window.db) return [];
    const snap = await getDocs(collection(window.db, colName));
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

/**
 * Fetches paginated data using the lastVisibleDocs cursor.
 */
window.fetchPaginatedCollection = async function(colName, startOver = false) {
    if (!window.db) return [];
    if (startOver) lastVisibleDocs[colName] = null;
    let q = query(collection(window.db, colName), limit(PAGE_SIZE));
    if (lastVisibleDocs[colName]) q = query(collection(window.db, colName), startAfter(lastVisibleDocs[colName]), limit(PAGE_SIZE));
    const snap = await getDocs(q);
    if (snap.empty) return [];
    lastVisibleDocs[colName] = snap.docs[snap.docs.length - 1];
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

// Bridge for Auth user creation
// Note: This is a placeholder for a Cloud Function call
window.adminCreateAuthUser = async function(type, formData) {
    try {
        const createUser = httpsCallable(window.functions, 'adminCreateUser');
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
    if (!window.db || !window.auth.currentUser) {
        console.warn("Firestore Sync: Using Local/Demo session. Skipping remote write to avoid permission error.");
        return Promise.resolve();
    }
    const id = data.id.toString();
    return setDoc(doc(window.db, 'restaurants', id), data, { merge: true });
};

window.adminCreateUserRecord = async function(data) {
    if (!window.db || !window.auth.currentUser) {
        console.warn("Firestore Sync: Using Local/Demo session. Skipping remote write to avoid permission error.");
        return Promise.resolve();
    }
    const col = data.role === 'rider' ? 'riders' : 'users';
    const id = data.id.toString();
    return setDoc(doc(window.db, col, id), data, { merge: true });
};

/**
 * Global Logout Function
 * Signs out of Firebase Auth. The onAuthStateChanged listener
 * handles the subsequent UI reset and session clearing.
 */
window.logoutUser = async function() {
    try {
        if (window.showLoading) window.showLoading("Logging out...");
        if (!window.auth) return;
        await signOut(window.auth);
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
    if (!window.db) return;

    const user = window.auth ? window.auth.currentUser : null;
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
            collection(window.db, 'orders'),
            where('riderId', '==', user.uid),
            orderBy('timestamp', 'desc'),
            limit(50)
        );
        firebaseUnsubs.riderData = onSnapshot(doc(window.db, 'riders', user.uid), (doc) => {
            if (doc.exists()) {
                window.currentUser = { ...window.currentUser, ...doc.data() };
                if (window.updateProfileUI) window.updateProfileUI();
            }
        }, (error) => {
            console.error("Firebase: Rider listener error:", error);
            if (window.toggleConnectionBanner) window.toggleConnectionBanner(true);
        });
    } else if (role === 'vendor') {
        ordersQuery = query(collection(window.db, 'orders'), where('vendorId', '==', user.uid), orderBy('timestamp', 'desc'), limit(50));
        firebaseUnsubs.vendorData = onSnapshot(doc(window.db, 'vendors', user.uid), (doc) => {
            if (doc.exists()) {
                window.currentUser = { ...window.currentUser, ...doc.data() };
                if (window.updateProfileUI) window.updateProfileUI();
            }
        }, (error) => {
            console.error("Firebase: Vendor listener error:", error);
            if (window.toggleConnectionBanner) window.toggleConnectionBanner(true);
        });
    } else if (!isAdmin) {
        ordersQuery = query(
            collection(window.db, 'orders'),
            where('customerId', '==', user.uid),
            orderBy('timestamp', 'desc'),
            limit(25)
        );
    } else {
        ordersQuery = query(
            collection(window.db, 'orders'),
            orderBy('timestamp', 'desc'),
            limit(50)
        );
    }

    firebaseUnsubs.orders = onSnapshot(ordersQuery, (snapshot) => {
        if (window.toggleConnectionBanner) window.toggleConnectionBanner(false);
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
        if (window.toggleConnectionBanner) window.toggleConnectionBanner(true);
    });

    if (isAdmin) {
        firebaseUnsubs.riders = onSnapshot(collection(window.db, 'riders'), (snapshot) => {
            const riders = [];
            snapshot.forEach((doc) => riders.push({ id: doc.id, ...doc.data() }));
            window.adminRiders = riders;
            if (window.renderAdminRiders && document.getElementById('admin-riders') && document.getElementById('admin-riders').style.display !== 'none') {
                window.renderAdminRiders();
            }
        }, (error) => {
            console.error('Firebase rider listener error:', error);
        });

        firebaseUnsubs.customers = onSnapshot(collection(window.db, 'customers'), (snapshot) => {
            const customers = [];
            snapshot.forEach((doc) => customers.push({ id: doc.id, ...doc.data() }));
            window.adminCustomers = customers;
            if (window.renderAdminCustomers && document.getElementById('admin-customers') && document.getElementById('admin-customers').style.display !== 'none') {
                window.renderAdminCustomers();
            }
        }, (error) => {
            console.error('Firebase customer listener error:', error);
        });

        firebaseUnsubs.restaurants = onSnapshot(collection(window.db, 'restaurants'), (snapshot) => {
            const restaurants = [];
            snapshot.forEach((doc) => restaurants.push({ id: doc.id, ...doc.data() }));
            window.adminRestaurants = restaurants;
            if (window.renderAdminRestaurants && document.getElementById('admin-restaurants') && document.getElementById('admin-restaurants').style.display !== 'none') {
                window.renderAdminRestaurants();
            }
        }, (error) => {
            console.error('Firebase restaurant listener error:', error);
        });

        firebaseUnsubs.payments = onSnapshot(collection(window.db, 'payments'), (snapshot) => {
            const payments = [];
            snapshot.forEach((doc) => payments.push({ id: doc.id, ...doc.data() }));
            window.adminPayments = payments;
            if (window.renderAdminPayments && document.getElementById('admin-payments') && document.getElementById('admin-payments').style.display !== 'none') {
                window.renderAdminPayments();
            }
        }, (error) => {
            console.error('Firebase payment listener error:', error);
        });

        firebaseUnsubs.support = onSnapshot(collection(window.db, 'support'), (snapshot) => {
            const supportTickets = [];
            snapshot.forEach((doc) => supportTickets.push({ id: doc.id, ...doc.data() }));
            window.adminSupportTickets = supportTickets;
            if (window.renderAdminSupport && document.getElementById('admin-support') && document.getElementById('admin-support').style.display !== 'none') {
                window.renderAdminSupport();
            }
        }, (error) => {
            console.error('Firebase support listener error:', error);
        });

        firebaseUnsubs.logs = onSnapshot(query(collection(window.db, 'admin_logs'), orderBy('timestamp', 'desc'), limit(50)), (snapshot) => {
            const logs = [];
            snapshot.forEach((doc) => logs.push({ id: doc.id, ...doc.data() }));
            window.adminLogs = logs;
            if (document.getElementById('admin-logs') && document.getElementById('admin-logs').style.display !== 'none') {
                window.renderAdminLogs();
            }
        }, (error) => {
            console.error("Firebase: Admin logs listener error:", error);
        });
    }
}


// Initialize Firebase when the script loads
window.initFirebase = initFirebase;
initFirebase();
