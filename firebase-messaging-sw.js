importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyBZ_7aveKKu7UsIi03wSzjptuZ38XqfJvc",
    authDomain: "delivery-app-6a47f.firebaseapp.com",
    projectId: "delivery-app-6a47f",
    storageBucket: "delivery-app-6a47f.firebasestorage.app",
    messagingSenderId: "525706344286",
    appId: "1:525706344286:web:1ce4079529b7f0d09d81cf",
    measurementId: "G-N9HGCESZTS"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message ', payload);
    const notificationTitle = payload.notification.title;
    const notificationOptions = {
        body: payload.notification.body,
        icon: '/icon.png' // Ensure you have an icon at this path
    };
    return self.registration.showNotification(notificationTitle, notificationOptions);
});