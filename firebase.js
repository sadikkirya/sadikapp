const firebaseConfig = {
    apiKey: "AIzaSyBBU2fUlkRf7VqVJmT-Vh7TfNpPgmQrqWU",
    authDomain: "kirya-e2248.firebaseapp.com",
    projectId: "kirya-e2248",
    storageBucket: "kirya-e2248.firebasestorage.app",
    messagingSenderId: "308339449512",
    appId: "1:308339449512:web:d2b1fb44c4ba36a505ac9d",
    measurementId: "G-YZ3NFWDS89",
    databaseURL: "https://kirya-e2248-default-rtdb.firebaseio.com"
};

window.db = null;
window.auth = null;
window.rtdb = null;
window.storage = null;
window.messaging = null;
// Store unsubscribe functions to prevent duplicate listeners

let lastVisibleDocs = {
    orders: null,
    restaurants: null,
    customers: null,
    logs: null
};
const PAGE_SIZE = 15;
let authListenerRegistered = false;

let firebaseUnsubs = { orders: null, riders: null, customers: null, restaurants: null, promotions: null, payments: null, support: null, accounts: null, logs: null, analytics: null, chat: null, profile: null };

function initFirebase() {
    if (typeof firebase === 'undefined') {
        if (window.showToast) window.showToast("⚠️ Firebase SDK not loaded. Check internet.");
        return;
    }

    try {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
            console.log("Firebase Initialized");
        }
        
        // Ensure references exist
        if (!window.db) window.db = firebase.firestore();
        if (!window.auth) {
            window.auth = firebase.auth();
        }
        if (!window.rtdb) window.rtdb = firebase.database();
        
        window.auth.onAuthStateChanged(user => {
            if (user) {
                console.log("Firebase: Auth state changed ->", user.uid);
                
                if (!window.currentUser) window.currentUser = { id: user.uid };
                else window.currentUser.id = user.uid;
                
                window.setupUserProfileListener(user.uid);
            } else {
                window.clearUserSession();
                // Handle potential errors returning from a redirect login flow
                if (window.auth) {
                    window.auth.getRedirectResult().catch(error => {
                        console.error("Auth Redirect Error:", error);
                        if (window.showToast) window.showToast("🚫 Login Error: " + error.message);
                    });
                }
                if (window.showLoginScreen) window.showLoginScreen();
            }
        });

        if (!window.storage) window.storage = firebase.storage();
        if (!window.messaging && firebase.messaging.isSupported()) {
            window.messaging = firebase.messaging();
            // Explicitly register the service worker to ensure it's active for push subscriptions
            navigator.serviceWorker.register('/firebase-messaging-sw.js')
                .then((reg) => console.log("Firebase: SW registered", reg.scope))
                .catch((err) => console.warn("Firebase: SW registration failed", err));
        }

        // 1. ENABLE OFFLINE PERSISTENCE (Local Sync) - MUST BE BEFORE ANY OTHER DB CALL
        if (window.db) {
            try {
                window.db.enablePersistence({ synchronizeTabs: true });
            } catch (e) {
                console.log('Firestore settings already configured or error:', e);
            }
        }

        // Helpers for Auth Providers
        window.signInWithGoogle = async function() {
            try {
                const rememberMeEl = document.getElementById('loginRememberMe');
                const rememberMe = rememberMeEl ? rememberMeEl.checked : true;
                
                const persistence = rememberMe ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION;
                await window.auth.setPersistence(persistence);

                const provider = new firebase.auth.GoogleAuthProvider();
                // Switching to Redirect to bypass Cross-Origin-Opener-Policy (COOP) restrictions
                await window.auth.signInWithRedirect(provider);
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
                await window.auth.sendPasswordResetEmail(email);
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

            window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
                'size': 'invisible'
            });
            return window.auth.signInWithPhoneNumber(phoneNumber, window.recaptchaVerifier);
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
        // Proactively clear session data before waiting for Firebase
        window.clearUserSession();
        if (!window.auth) return;
        await window.auth.signOut();
    } catch (error) {
        console.error("Logout Error:", error);
        if (window.showToast) showToast("❌ Error signing out.");
    } finally {
        if (window.hideLoading) window.hideLoading();
        window.location.href = window.location.pathname; // Hard reload to clear all JS state
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

    if (firebaseUnsubs.profile) {
        firebaseUnsubs.profile();
        firebaseUnsubs.profile = null;
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

function setupFirebaseListeners() {
    if(!db) return;
    
    // Get current auth state
    const user = window.auth ? window.auth.currentUser : null;
    const role = window.getCurrentRole ? window.getCurrentRole() : 'user';

    // We cannot listen to orders without a user identity because security rules 
    // require request.auth.uid to perform permission checks.
    if (!user) {
        console.log("Firebase: Postponing orders listener until user is logged in.");
        return;
    }

    // Unsubscribe previous listeners if they exist (prevents duplicates on retry)
    if (firebaseUnsubs.orders) firebaseUnsubs.orders();
    if (firebaseUnsubs.riders) firebaseUnsubs.riders();
    if (firebaseUnsubs.analytics) firebaseUnsubs.analytics();
    if (firebaseUnsubs.chatsList) firebaseUnsubs.chatsList();

    let query = db.collection("orders");

    // SECURITY SYNC: Regular users MUST filter by their own ID in the query.
    // Without this filter, Firestore rejects the query as it could return other people's data.
    const isAdmin = (role === 'admin' || role === 'Super Admin' || role === 'Manager');
    if (!isAdmin && role !== 'rider') {
        query = query.where("customerId", "==", user.uid);
    }

    firebaseUnsubs.orders = query.orderBy('timestamp', 'desc')
        .limit(role === 'admin' ? 50 : 5) 
        .onSnapshot((snapshot) => {
        if (snapshot.empty && adminOrders.length > 0) {
            console.log("Firebase 'orders' is empty. Retaining local mock data.");
            if (window.renderAdminDashboard) {
                window.renderAdminDashboard();
                window.renderAdminOrders();
            }
            return;
        }
        const orders = [];
        snapshot.forEach((doc) => {
            orders.push({ id: doc.id, ...doc.data() });
        });
        // Update global state
        window.allOrders = orders;
        adminOrders = orders;
        window.adminOrders = orders;
        
        // Refresh UI if needed
        if (window.renderAdminOrders && document.getElementById('admin-orders').style.display !== 'none') {
            window.renderAdminOrders();
        }
        if (window.renderAdminDashboard && document.getElementById('admin-dashboard').style.display !== 'none') {
            window.renderAdminDashboard();
        }
        if (document.getElementById('riderScreen').classList.contains('active')) {
            updateRiderNearbyOrders();
        }
    }, (error) => {
        console.error("Order listener error:", error);
        if(error.code === 'permission-denied') {
            console.warn("Falling back to local data due to permissions.");
            if (window.showToast) showToast("⚠️ DB Permission Denied. Check Firestore Rules.");
        }
    });

    // Listen for Riders
    if (!isAdmin) return; // Gate sensitive data

    firebaseUnsubs.riders = db.collection("riders").onSnapshot((snapshot) => {
        if (snapshot.empty && adminRiders.length > 0) {
            console.log("Firebase 'riders' is empty. Retaining local mock data.");
            if (document.getElementById('admin-riders').style.display !== 'none') renderAdminRiders();
            return;
        }
        const riders = [];
        snapshot.forEach((doc) => {
            riders.push({ id: doc.id, ...doc.data() });
        });
        adminRiders = riders;
        window.adminRiders = riders;

        // REALTIME TABLE UPDATE: Refresh rider list table immediately
        if (window.renderAdminRiders && document.getElementById('admin-riders').style.display !== 'none') {
            window.renderAdminRiders();
        }
        if (window.renderAdminDashboard && document.getElementById('admin-dashboard').style.display !== 'none') {
            window.renderAdminDashboard();
        }
        // REALTIME MAP UPDATE: Refresh markers if map is active
        if (window.updateAdminMapMarkers) {
            window.updateAdminMapMarkers();
        }
    }, (error) => {
        console.error("Rider listener error:", error);
        if(error.code === 'permission-denied') showToast("⚠️ DB Permission Denied (Riders)");
    });

    // --- Chats List Listener ---
    // Ensure users only see conversations they are participating in
    let chatsQuery = db.collection("chats");
    
    if (!isAdmin) {
        // This assumes your chat documents have a 'participants' array containing UIDs
        // or a specific 'customerId' field.
        chatsQuery = chatsQuery.where("participants", "array-contains", user.uid);
    }

    firebaseUnsubs.chatsList = chatsQuery.onSnapshot((snapshot) => {
        const chats = [];
        snapshot.forEach(doc => {
            chats.push({ id: doc.id, ...doc.data() });
        });
        window.allUserChats = chats;
        
        // Trigger UI update for the chat list if the function exists
        if (window.renderChatList) window.renderChatList(chats);
    }, (error) => {
        console.error("Chats list listener error:", error);
        if(error.code === 'permission-denied') console.warn("Access to chats denied.");
    });
    
    
    // Listen for Analytics Summary
    firebaseUnsubs.analytics = db.collection("analytics").doc("summary").onSnapshot((doc) => {
        if (doc.exists) {
            adminAnalytics = doc.data();
            if (document.getElementById('admin-analytics').style.display !== 'none') renderAdminAnalytics();
            if (document.getElementById('admin-dashboard').style.display !== 'none') renderAdminDashboard();
        }
    });
}

// --- PAGINATION & ONE-TIME FETCH LOGIC ---
window.fetchPaginatedCollection = async function(collectionName, reset = false) {
    if(!window.db) return [];
    if(reset) lastVisibleDocs[collectionName] = null;
    
    let query = db.collection(collectionName);
    
    if (collectionName === 'logs') query = query.orderBy('time', 'desc');
    else if (collectionName === 'users') query = query.orderBy('createdAt', 'desc');
    else query = query.orderBy('name');

    if (!reset && lastVisibleDocs[collectionName]) {
        query = query.startAfter(lastVisibleDocs[collectionName]);
    }

    const snapshot = await query.limit(PAGE_SIZE).get();
    if (snapshot.empty) return [];

    lastVisibleDocs[collectionName] = snapshot.docs[snapshot.docs.length - 1];
    
    const items = [];
    snapshot.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
    return items;
};

window.fetchCollectionOnce = async function(collectionName) {
    if(!window.db) return [];
    const snapshot = await db.collection(collectionName).get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

// --- AUTO-RECONNECT LOGIC ---
window.addEventListener('online', () => {
    showToast("🌐 Connection Restored. Reconnecting...");
    console.log("Network online. Retrying Firebase...");
    initFirebase();
    updateNetworkStatusUI();
});

window.addEventListener('offline', () => {
    showToast("⚠️ No Internet Connection. Working offline.");
    updateNetworkStatusUI();
});

async function seedDatabase() {
    if (!db) { showToast("Firebase not connected! Check Config."); return; }
    showToast("Uploading data...");
    const batch = db.batch();

    // Upload Restaurants
    (typeof MOCK_RESTAURANTS !== 'undefined' ? MOCK_RESTAURANTS : adminRestaurants).forEach(r => {
        const ref = db.collection("restaurants").doc(r.id.toString());
        batch.set(ref, r);
    });

    // Upload Riders
    (typeof MOCK_RIDERS !== 'undefined' ? MOCK_RIDERS : adminRiders).forEach(r => {
        const ref = db.collection("riders").doc(r.id.toString());
        batch.set(ref, r);
    });

    // Upload Customers
    (typeof MOCK_CUSTOMERS !== 'undefined' ? MOCK_CUSTOMERS : adminCustomers).forEach(u => {
        const ref = db.collection("users").doc(u.id.toString());
        batch.set(ref, { ...u, role: "user", isApproved: u.status === 'active', username: u.name });
    });

    // Upload Promotions
    if(typeof MOCK_PROMOTIONS !== 'undefined') {
        MOCK_PROMOTIONS.forEach(p => {
            const ref = db.collection("promotions").doc(p.id.toString());
            batch.set(ref, p);
        });
    }

    // Upload Payments
    if(typeof MOCK_PAYMENTS !== 'undefined') {
        MOCK_PAYMENTS.forEach(p => {
            const ref = db.collection("payments").doc(p.id.toString());
            batch.set(ref, p);
        });
    }

    // Upload Support Tickets
    if(typeof MOCK_SUPPORT_TICKETS !== 'undefined') {
        MOCK_SUPPORT_TICKETS.forEach(t => {
            const ref = db.collection("support").doc(t.id.toString());
            batch.set(ref, t);
        });
    }

    // Upload Admin Accounts
    if(typeof MOCK_ACCOUNTS !== 'undefined') {
        MOCK_ACCOUNTS.forEach(a => {
            const ref = db.collection("admin_accounts").doc(a.id.toString());
            batch.set(ref, a);
        });
    }
    
    // Upload Analytics Summary
    if(typeof MOCK_ANALYTICS !== 'undefined') {
        batch.set(db.collection("analytics").doc("summary"), MOCK_ANALYTICS);
    }

    // Upload Orders
    if(typeof MOCK_ORDERS !== 'undefined') {
        MOCK_ORDERS.forEach(o => {
            const ref = db.collection("orders").doc(o.id.toString());
            batch.set(ref, o);
        });
    }

    await batch.commit();
    showToast("Data Migration Complete! 🎉");
}

// 2. REAL-TIME USER PROFILE SYNC LISTENER
function setupUserProfileListener(userId) {
    // PERMANENT FIX: Skip Firestore operations for Mock/Demo users or unauthenticated sessions
    // This prevents "Missing or insufficient permissions" errors.
    const isMock = userId && (userId.toString().startsWith('mock_') || !isNaN(userId));

    if(!db || !userId || isMock) {
        console.log(`Firebase: Skipping Firestore listener for ${isMock ? 'Mock' : 'Invalid'} User ID: ${userId}`);
        return;
    }

    // Clear previous listener if it exists to avoid duplicates
    if (firebaseUnsubs.profile) firebaseUnsubs.profile();

    // Optimized check: Check both collections but handle permission errors gracefully.
    // We use a "Safe Check" strategy.
    console.log(`[Auth] Checking permissions for ID: ${userId}`);
    
    const collections = [
        { name: 'admin_accounts', role: 'admin' },
        { name: 'riders', role: 'rider' },
        { name: 'restaurants', role: 'vendor' },
        { name: 'users', role: 'user' }
    ];

    async function waterfallProfileLookup() {
        let foundCol = null;
        
        // Optimization: Check for a role hint to speed up lookup
        const roleHint = localStorage.getItem('kirya_user_role_hint');
        if (roleHint) {
            const hintMap = { 'admin': 'admin_accounts', 'rider': 'riders', 'vendor': 'restaurants', 'user': 'users' };
            const colName = hintMap[roleHint];
            try {
                const doc = await db.collection(colName).doc(userId.toString()).get();
                if (doc.exists) foundCol = { name: colName, role: roleHint };
            } catch (e) {}
        }

        if (!foundCol) {
        // Parallel check to find which collection the user belongs to
        const checks = await Promise.all(collections.map(async col => {
            try {
                const doc = await db.collection(col.name).doc(userId.toString()).get();
                return doc.exists ? { name: col.name, role: col.role } : null;
            } catch(e) { return null; }
        }));
        
        foundCol = checks.find(c => c !== null);
        }

        if (foundCol) {
            localStorage.setItem('kirya_user_role_hint', foundCol.role);
            // Attach real-time listener to the identified document
            firebaseUnsubs.profile = db.collection(foundCol.name).doc(userId.toString())
                .onSnapshot((doc) => {
                    if (doc.exists) setupProfileFromDoc(doc, foundCol.role);
                }, handleProfileError);
        } else {
            // Brand new user registration
            const registered = await handleNewUserRegistration(userId);
            // Start listening to the newly created 'users' document
            if (registered) attachUserListener(userId);
        }
    }

    waterfallProfileLookup();

    function setupProfileFromDoc(doc, role) {
        const data = doc.data();
        const collectionName = doc.ref.parent.id;
        
        // Use the role from the document if it exists (e.g., 'Super Admin'), otherwise use default
        data.role = data.role || role;

        // --- REAL-TIME APPROVAL DETECTION ---
        // Check if the user was unapproved and is now approved
        const wasApproved = window.currentUser ? window.currentUser.isApproved : false;
        const isNowApproved = data.isApproved;

        if (wasApproved === false && isNowApproved === true) {
            if (window.showToast) window.showToast("🎊 Congratulations! Your account has been approved.");
            if (window.playNotificationSound) window.playNotificationSound();
        }

        // ALWAYS show toast on successful role resolution
        if (window.showToast) {
            window.showToast(`✅ Verified: Welcome ${data.name || data.username || 'User'} (${data.role})`);
        }
        
        if (window.hideLoading) window.hideLoading();

        console.log(`%c[Verification] Fetched Role from ${collectionName}:`, "color: #007bff; font-weight: bold;", data.role);
            
            // Sync Session State
            const oldRole = window.currentUser ? window.currentUser.role : null;
            window.currentUser = { 
                ...window.currentUser, 
                ...data, 
                id: userId,
                _collection: collectionName // Remember the source collection
            };

            // --- AUTO-ROUTING LOGIC (Perfect Login) ---
            if (data.isApproved) {
                // Use the central routing function in app.js
                if (window.proceedToHome) window.proceedToHome(true);
            } else {
                // Account not approved yet, call proceedToHome which now handles this state on login page
                if (window.proceedToHome) window.proceedToHome(true);
            }

            // Re-initialize listeners if role changed or first load
            if (oldRole !== data.role) setupFirebaseListeners();
            
            // Sync Notifications
            if(data.notifications) {
                notifications = data.notifications;
                updateBellDots();
                if(document.getElementById('notificationsScreen').classList.contains('active')) renderNotifications();
            }

            // Update UI
            updateCartView();
    }

    function attachUserListener(uid) {
        firebaseUnsubs.profile = db.collection('users').doc(uid.toString())
            .onSnapshot((doc) => {
                if (doc.exists) setupProfileFromDoc(doc, 'user');
            }, handleProfileError);
    }

    async function handleNewUserRegistration(userId) {
        console.log("First-time login detected. Creating default profile...");
        const authUser = window.auth.currentUser;
        const email = authUser.email;
        const phone = authUser.phoneNumber;

        try {
            let existingData = null;

            // 1. Check if an Admin pre-created this user by Email or Phone
            if (email) {
                const emailSnap = await db.collection('users').where('email', '==', email).limit(1).get();
                if (!emailSnap.empty) existingData = emailSnap.docs[0].data();
            }
            
            if (!existingData && phone) {
                const phoneSnap = await db.collection('users').where('phone', '==', phone).limit(1).get();
                if (!phoneSnap.empty) existingData = phoneSnap.docs[0].data();
            }

            // 2. Prepare the final profile
            const finalProfile = {
                id: userId,
                name: existingData?.name || authUser.displayName || "New User",
                email: email || existingData?.email || "",
                phone: phone || existingData?.phone || "",
                role: existingData?.role || 'user', // Keep Admin-assigned role or default to 'user'
                isApproved: existingData?.isApproved || false,
                points: existingData?.points || 0,
                walletBalance: existingData?.walletBalance || 0,
                createdAt: existingData?.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
                authRegistered: true
            };

            // 3. Save to the document named by the actual UID
            await db.collection('users').doc(userId.toString()).set(finalProfile);
            if (window.showToast) window.showToast(`🎉 Welcome! Account registered as ${finalProfile.role}`);
            return true;
        } catch (err) {
            console.error("Error in registration flow:", err);
            if (window.showToast) window.showToast("❌ Registration Error: " + err.message);
            return false;
        }
    }

    function handleProfileError(error) {
        console.error("Profile sync error:", error);
        if (window.hideLoading) window.hideLoading();
        if (document.getElementById('verificationLoadingScreen')) {
            document.getElementById('verificationLoadingScreen').style.display = 'none';
        }
        
        if (window.showToast) {
            if (error.code === 'permission-denied') {
                window.showToast("🚫 Login Denied: Your account doesn't have permission to access this area.");
            } else {
                window.showToast("⚠️ System Error: " + error.message);
            }
        }
        if (window.hideLoading) window.hideLoading();
    }
}

window.setupChatListener = function(chatId) {
    if(!window.db) return;
    // Clear existing chat listener to prevent memory leaks/duplicate UI updates
    if (firebaseUnsubs.chat) firebaseUnsubs.chat();

    const chatMessages = document.getElementById('chatMessages');
    
    firebaseUnsubs.chat = window.db.collection('chats').doc(chatId).collection('messages')
        .orderBy('timestamp', 'asc')
        .onSnapshot((snapshot) => {
            // Clear and re-render the view from the Firestore snapshot
            chatMessages.innerHTML = '<div class="chat-date">Today</div>';
            
            snapshot.forEach((doc) => {
                const data = doc.data();
                // Determine message type: 'sent' if I am the sender, else 'received'
                const type = (data.senderId === window.currentUser.id) ? 'sent' : 'received';
                
                const time = data.timestamp 
                    ? new Date(data.timestamp.seconds * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) 
                    : 'Just now';
                
                if (window.addMessage) window.addMessage(type, data.text, time);
            });
        }, (error) => console.error("Chat listener error:", error));
};

window.uploadImageToStorage = async function(blob, path, onProgress = null) {
    if(!window.storage) throw new Error("Firebase Storage not initialized");
    try {
        const ref = window.storage.ref(path);
        const uploadTask = ref.put(blob);

        return new Promise((resolve, reject) => {
            uploadTask.on('state_changed', 
                (snapshot) => {
                    const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                    if (onProgress) onProgress(progress);
                }, 
                (error) => {
                    console.error("Storage Upload Error:", error);
                    if (error.message && error.message.includes('CORS')) {
                        if (window.showToast) window.showToast("⚠️ Storage Error: Please configure CORS on your Firebase bucket.");
                    }
                    reject(error);
                }, 
                async () => {
                    try {
                        const url = await uploadTask.snapshot.ref.getDownloadURL();
                        resolve(url);
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });
    } catch (e) {
        console.error("Storage Upload Error:", e);
        if (e.message && e.message.includes('CORS')) {
            if (window.showToast) window.showToast("⚠️ Storage Error: Please configure CORS on your Firebase bucket.");
            throw new Error("CORS configuration required on Firebase Storage bucket.");
        }
        throw e;
    }
};

window.deleteImageFromStorage = async function(url) {
    if(!window.storage || !url) return false;
    // Only attempt to delete if it's a Firebase Storage URL
    if (!url.includes('firebasestorage.googleapis.com')) return false;
    try {
        const ref = window.storage.refFromURL(url);
        await ref.delete();
        return true;
    } catch (e) {
        console.error("Storage Delete Error:", e);
        return false;
    }
};

window.requestNotificationPermission = async function() {
    if (!window.messaging) return;
    
    try {
        // Ensure Service Worker is active before attempting to subscribe to PushManager
        if ('serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.ready;
            if (!registration.active) {
                console.warn("Firebase Messaging: Service Worker not yet active.");
                return;
            }
        }

        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            console.log('Notification permission granted.');
            
            // Get FCM Token
            const token = await window.messaging.getToken({
                vapidKey: 'BK2f6TpUhGePLF0PW_x4Nvwc3Bp86GEGOmKgFVd9bgtI7G4T_YS_NDZHgWqihO0u4WfCBHFzhZ4TlNgZLyx3sjU' // Generate this in Firebase Console -> Project Settings -> Cloud Messaging
            });
            
            if (token && window.currentUser && window.currentUser.id) {
                await db.collection('users').doc(window.currentUser.id).update({
                    fcmToken: token,
                    notificationsEnabled: true
                });
                console.log('Firebase: FCM Token stored');
            }
        }
    } catch (error) {
        if (error.code === 'messaging/permission-denied' || error.message.includes('permission')) {
            console.warn('Firebase Messaging: Permission denied or missing config.');
        } else {
            console.error('Unable to get messaging token', error);
        }
    }
};

if (window.messaging) {
    window.messaging.onMessage((payload) => {
        console.log('Foreground Message received: ', payload);
        if (window.showToast) window.showToast(`🔔 ${payload.notification.title}: ${payload.notification.body}`);
        if (window.playNotificationSound) window.playNotificationSound();
    });
}

// --- REGISTRATION & ACCOUNT MANAGEMENT ---

/**
 * Public function for users to register via the frontend form.
 * Automatically handles registration without requiring a mode selection.
 */
window.registerUserAccount = async function(userData) {
    if (!window.db) throw new Error("Database not connected");
    
    // Strictly use the Authenticated UID for document creation
    const userId = (window.auth.currentUser ? window.auth.currentUser.uid : userData.phoneNumber) || "u_" + Date.now();
    
    const newUser = {
        ...userData,
        id: userId,
        role: 'user',
        isApproved: false, // Users start unapproved
        points: 0,
        walletBalance: 0,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    await window.db.collection("users").doc(userId.toString()).set(newUser);
    return newUser;
};

/**
 * Admin-only function to create Rider accounts.
 */
window.adminCreateRider = async function(riderData) {
    const role = window.getCurrentRole ? window.getCurrentRole() : '';
    if (role !== 'admin') throw new Error("Permission Denied: Admin only");

    const ref = window.db.collection("riders").doc(riderData.id?.toString() || Date.now().toString());
    await ref.set({ ...riderData, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    return ref.id;
};

/**
 * Admin-only function to create Vendor (Restaurant) accounts.
 */
window.adminCreateVendor = async function(vendorData) {
    const role = window.getCurrentRole ? window.getCurrentRole() : '';
    if (role !== 'admin') throw new Error("Permission Denied: Admin only");

    const ref = window.db.collection("restaurants").doc(vendorData.id?.toString() || Date.now().toString());
    await ref.set({ ...vendorData, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    return ref.id;
};

/**
 * Updates the current rider's location.
 * Restricted by Firestore rules to only allow 'location' and 'lastSeen' updates.
 */
window.updateRiderLocation = async function(latitude, longitude) {
    if (!window.auth.currentUser) return;
    
    const riderId = window.auth.currentUser.uid;
    const ref = window.db.collection("riders").doc(riderId);
    
    try {
        await ref.update({
            location: new firebase.firestore.GeoPoint(latitude, longitude),
            lastSeen: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        console.error("Failed to update location. Are you logged in as this rider?", error);
    }
};

/**
 * Utility to create a test order in Firestore.
 * Running this in the console will trigger the real-time listeners.
 */
window.createTestOrder = async function() {
    if (!window.db || !window.auth || !window.auth.currentUser) {
        if (window.showToast) window.showToast("❌ Error: You must be logged in to create a test order.");
        return;
    }

    const user = window.auth.currentUser;
    const orderId = 'TEST-' + Date.now();
    const testOrder = {
        customerId: user.uid,
        customerName: user.displayName || "Test User",
        customerPhone: user.phoneNumber || "+000 000 0000",
        deliveryAddress: "Test Suite 101, Firebase Towers",
        items: [
            { title: "Firebase Burger", basePrice: 25.00, quantity: 1, image: "🍔" },
            { title: "Firestore Fries", basePrice: 15.00, quantity: 1, image: "🍟" }
        ],
        total: 40.00,
        tip: 5.00,
        restaurant: "Cloud Kitchen",
        status: "pending",
        statusText: "Order Received",
        statusColor: "#FFBF42",
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        userLat: 24.47,
        userLng: 54.40,
        restaurantLat: 24.46,
        restaurantLng: 54.38
    };

    try {
        await window.db.collection("orders").doc(orderId).set(testOrder);
        if (window.showToast) window.showToast("✅ Test Order Created: " + orderId);
    } catch (e) {
        console.error("Test order error:", e);
        if (window.showToast) window.showToast("❌ Failed: " + e.message);
    }
};

/**
 * Creates a user document in Firestore and assigns a role.
 * Note: Auth account creation usually requires Cloud Functions for Admin.
 */
window.adminCreateUserRecord = async function(userData) {
    if (!window.db) throw new Error("Database not connected");
    
    // Generate a unique ID if one isn't provided (for mock/manual entries)
    const userId = userData.id || "u_" + Date.now();
    
    const newUser = {
        name: userData.name || "New User",
        email: userData.email || "",
        phone: userData.phone || "",
        role: userData.role || 'user', // 'admin', 'rider', 'vendor', 'user'
        isApproved: userData.isApproved || false,
        points: 0,
        walletBalance: 0,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        ...userData
    };

    await window.db.collection("users").doc(userId.toString()).set(newUser);
    return newUser;
};

/**
 * Admin Helper: Manually set a user's role by their Firebase UID.
 * Use this from the browser console to quickly fix account permissions.
 */
window.adminSetUserRole = async function(uid, role) {
    const validRoles = ['admin', 'rider', 'vendor', 'user'];
    if (!validRoles.includes(role)) {
        console.error("Invalid role. Choose: admin, rider, vendor, user");
        return;
    }

    try {
        await window.db.collection('users').doc(uid).update({ role: role, isApproved: true });
        console.log(`✅ Successfully updated UID ${uid} to role: ${role}`);
        if (window.showToast) window.showToast(`Updated permissions for ${uid}`);
    } catch (e) {
        console.error("Update failed:", e);
    }
};

/**
 * Utility to seed the sample accounts provided into Firestore.
 * Run this from the browser console once to set up the data.
 */
window.seedSampleAuthUsers = async function() {
    if (!window.db) { if (window.showToast) window.showToast("❌ Firebase not connected!"); return; }
    if (window.showLoading) window.showLoading("Seeding Auth Profiles...");
    
    const samples = [
        { uid: 'vlOZudfefvhPhKZ8TAayOV6ayTc2', collection: 'users', data: { name: 'Sample User', username: 'user123', email: 'user@kirya.app', phone: '+256700000001', role: 'user', isApproved: true } },
        { uid: 'mICAaywZwya7n88y8d47fY2fnf82', collection: 'riders', data: { name: 'Sample Rider', username: 'rider123', email: 'rider@kirya.app', phone: '+256700000002', role: 'rider', accountStatus: 'active', isApproved: true } },
        { uid: 'WPbLjNhBhIXnKBUrbDdE3inME3i1', collection: 'restaurants', data: { name: 'Sample Vendor', username: 'vendor123', email: 'vendor@kirya.app', phone: '+256700000003', role: 'vendor', status: 'active', isApproved: true } },
        { uid: '4Wnx2guR1lajzsdnXr6IOirk83g1', collection: 'admin_accounts', data: { name: 'Main Admin', username: 'admin_master', email: 'admin@kirya.app', phone: '+256700000004', role: 'Super Admin', status: 'active', isApproved: true } }
    ];

    // 1. Promote CURRENT user to Admin immediately (Standalone write)
    if (window.auth.currentUser) {
        const myUid = window.auth.currentUser.uid;
        const myData = {
            name: window.currentUser.name || 'Main Admin',
            email: window.auth.currentUser.email,
            role: 'Super Admin',
            status: 'active',
            isApproved: true,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        try {
            await window.db.collection('admin_accounts').doc(myUid).set(myData, { merge: true });
            console.log("Self-promotion successful. You are now an admin.");
            // Small delay to ensure Firestore rules engine sees the new document
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (e) {
            console.warn("Self-promotion failed:", e.message);
        }
    }

    // 2. Seed samples (This batch will now be authorized as Step 1 made you an admin)
    const batch = window.db.batch();
    samples.forEach(s => {
        const ref = window.db.collection(s.collection).doc(s.uid);
        batch.set(ref, { ...s.data, createdAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    });

    try {
        await batch.commit();
        if (window.showToast) window.showToast("✅ Seeding Complete! Your account is now a Super Admin.");
    } catch (e) {
        console.error("Seed Error:", e);
        if (window.showToast) window.showToast("❌ Seeding failed: " + e.message);
    } finally {
        if (window.hideLoading) window.hideLoading();
    }
};

/**
 * Automatically creates/updates the Master Admin document.
 * Call this from the console: createMasterAdmin()
 */
window.createMasterAdmin = async function() {
    if (!window.db) { console.error("DB not connected"); return; }
    const uid = "4Wnx2guR1lajzsdnXr6IOirk83g1";
    const adminData = {
        name: 'Main Admin',
        email: 'admin@kirya.app',
        username: 'admin_master',
        role: 'Super Admin',
        status: 'active',
        isApproved: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    try {
        await window.db.collection('admin_accounts').doc(uid).set(adminData, { merge: true });
        if (window.showToast) window.showToast("✅ Master Admin Created Successfully!");
        console.log("Master Admin document set for UID:", uid);
    } catch (e) {
        if (e.code === 'permission-denied') {
            console.error("Master Admin Creation Failed: You do not have permission to write to Firestore. Please use the Firebase Console to manually create this document first or update your Security Rules.");
            if (window.showToast) window.showToast("🚫 Permission Denied. Use Firebase Console to create admin.");
        } else {
            console.error("Master Admin Creation Failed:", e);
        }
    }
};

/**
 * Listen to a single order's changes in real-time.
 * Useful for updating the tracking screen without re-rendering the whole list.
 */
window.listenToOrder = function(orderId, onUpdate) {
    if (!window.db || !orderId) return null;
    return window.db.collection("orders").doc(orderId).onSnapshot((doc) => {
        if (doc.exists) {
            onUpdate({ id: doc.id, ...doc.data() });
        }
    }, (error) => console.error("Order listener error:", error));
};
// --- FIREBASE INTEGRATION END ---