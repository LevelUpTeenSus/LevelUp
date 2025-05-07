

// public/shared.js

// 1) Firebase imports and initialization
import { 
    getAuth, 
    onAuthStateChanged, 
    connectAuthEmulator,
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    signInWithPopup, 
    signOut, 
    GoogleAuthProvider 
  } from 'firebase/auth';
  import {
    getFirestore,
    doc,
    getDoc,
    setDoc,
    addDoc,
    collection,
    getDocs,
    connectFirestoreEmulator,
    setLogLevel,
    query,
    where,
    orderBy,
    initializeFirestore,
    persistentLocalCache,
    persistentSingleTabManager
  } from 'firebase/firestore';
  import { app } from './firebaseConfig.js';
  
  // Initialize Firebase Auth and Firestore
  export const auth = getAuth(app);
  export const db = initializeFirestore(app, {
    cache: persistentLocalCache({
      tabManager: persistentSingleTabManager()
    })
  });
  setLogLevel('debug');
  
  // Connect to emulators when running locally
  const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (isLocalhost) {
    connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: false });
    connectFirestoreEmulator(db, 'localhost', 8080);
  }
  
  // Shared configuration constants
  export const CONFIG = {
    MAX_INPUT_LENGTH: 50,
    VALIDATION_REGEX: /^[a-zA-Z0-9\s\-.,&()]+$/,
    MAX_HISTORY: 50,
    COLLECTIONS: {
      USERS: 'users',
      ROLES: 'userRoles',
      INVITES: 'invitations',
      ITEMS: 'items',
      CHILD_ACTIVITY: 'childActivity'
    },
    TIER_CONFIG: [
      { id: 1, name: 'Self-Care Rookie' },
      { id: 2, name: 'Room Captain' },
      { id: 3, name: 'Household Contributor' },
      { id: 4, name: 'School & Schedule Boss' },
      { id: 5, name: 'Young-Adult Mode' }
    ],
    DEFAULT_DATA: {
      1: {
        responsibilities: ['Shower daily', 'Brush teeth 2×', 'Put away shoes/coats'],
        privileges: ['Allowance', '1h screen time', 'Choose family movie']
      },
      2: {
        responsibilities: ['Keep bedroom tidy', 'Pack own lunch'],
        privileges: ['Smartphone', 'Decorate room']
      },
      3: {
        responsibilities: ['Take out trash', 'Feed pet'],
        privileges: ['Video games', 'Friend outings']
      },
      4: {
        responsibilities: ['Maintain GPA B', 'Manage homework'],
        privileges: ['Laptop', 'Later curfew']
      },
      5: {
        responsibilities: ['Budget money', 'Safe driving'],
        privileges: ['Car access', 'Flexible curfew']
      }
    },
    DEFAULT_KID: 'Kid 1'
  };
  
  // Shared utility functions
  export function showNotification(message, type = 'success') {
    console.log(`Notification: ${message} (${type})`);
    const notifications = document.getElementById('notifications');
    if (!notifications) return;
    const div = document.createElement('div');
    div.className = `notification ${type}`;
    div.textContent = message;
    notifications.appendChild(div);
    setTimeout(() => div.remove(), 3000);
  }
  
  export function handleError(err, userMessage = 'An error occurred') {
    console.error(err);
    showNotification(userMessage, 'error');
  }
  
  export function validateInput(text) {
    if (!text) return 'Input cannot be empty';
    if (text.length > CONFIG.MAX_INPUT_LENGTH) return `Input must be ${CONFIG.MAX_INPUT_LENGTH} characters or less`;
    if (!CONFIG.VALIDATION_REGEX.test(text)) return 'Only letters, numbers, spaces, and basic punctuation allowed';
    return null;
  }
  
  /**
   * Waits for the first auth state resolution.
   * @returns {Promise<{user: import("firebase/auth").User|null, uid: string|null}>}
   */
  export function waitForAuthState() {
    return new Promise(resolve => {
      const unsubscribe = onAuthStateChanged(auth, user => {
        unsubscribe();
        resolve({ user, uid: user?.uid || null });
      });
    });
  }

// Re-export Firebase Auth & Firestore helpers for dashboard modules
export {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  doc,
  getDoc,
  setDoc,
  addDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy
};