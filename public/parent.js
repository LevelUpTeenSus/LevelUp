// public/parent.js

// Import shared Firebase setup and utilities
import {
  auth,
  db,
  CONFIG,
  showNotification,
  handleError,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  doc,
  setDoc,
  collection
} from './shared.js';

// Import the core bootstrap from script.js
import { initializeApp } from './script.js';

/**
 * Entry point for the parent dashboard.
 * Waits for DOMContentLoaded, then initializes in parent mode.
 */
export function initializeParentApp() {
  document.addEventListener('DOMContentLoaded', () => {
    initializeApp({ isChild: false });
  });
}

/**
 * Generates and copies an invite code for a child profile.
 */
export async function generateInvite() {
  try {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    await setDoc(
      doc(db, CONFIG.COLLECTIONS.INVITES, code),
      {
        parentUid: auth.currentUser.uid,
        kidName: store.currentKid,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
      }
    );
    navigator.clipboard.writeText(code);
    showNotification(`Invite code ${code} copied to clipboard`, 'success');
  } catch (err) {
    handleError(err, 'Failed to generate invite code');
  }
}
