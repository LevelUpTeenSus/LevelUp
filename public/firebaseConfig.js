// firebaseConfig.js
import { initializeApp, getApps, getApp } from 'firebase/app';

const firebaseConfig = {
  apiKey: "AIzaSyCF19jDxvSUjyd5R8N9_FJ0-DzyBQAYs1g",
  authDomain: "levelupteensus.firebaseapp.com",
  projectId: "levelupteensus",          // ← must exactly match your Firebase console
  storageBucket: "levelupteensus.appspot.com",
  messagingSenderId: "626925593956",
  appId: "1:626925593956:1:626925593956:web:956e7503936e3537814671",
  measurementId: "G-NGBQG34RKB"
};

// Initialize or reuse existing app to avoid duplicate-app errors
export const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();