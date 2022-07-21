// Give the service worker access to Firebase Messaging.
// Note that you can only use Firebase Messaging here. Other Firebase libraries
// are not available in the service worker.
importScripts('https://www.gstatic.com/firebasejs/8.6.7/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.6.7/firebase-messaging.js');

// Initialize the Firebase app in the service worker by passing in
// your app's Firebase config object.
// https://firebase.google.com/docs/web/setup#config-object
firebase.initializeApp({
  apiKey: 'AIzaSyCz4j1dhRj5rt-hJvUdvqXXJAKmIryvVCg',
  authDomain: 'seed-anton.firebaseapp.com',
  projectId: 'seed-anton',
  storageBucket: 'seed-anton.appspot.com',
  messagingSenderId: '439280065103',
  appId: '1:439280065103:web:d97d7c6b4bedff1402e83a',
  measurementId: 'G-TV07XT0RLM',
});

// Retrieve an instance of Firebase Messaging so that it can handle background
// messages.
const messaging = firebase.messaging();
