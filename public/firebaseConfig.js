// firebaseConfig.js
import { initializeApp } from 'firebase/app';

const firebaseConfig = {
  apiKey: "…",
  authDomain: "levelupteensus.firebaseapp.com",
  projectId: "levelupteensus",          // ← must exactly match your Firebase console
  storageBucket: "levelupteensus.appspot.com",
  messagingSenderId: "626925593956",
  appId: "1:626925593956:web:…",
  measurementId: "G-NGBQG34RKB"
};

export const app = initializeApp(firebaseConfig);