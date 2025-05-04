import { initializeApp } from 'firebase/app';
import { getAnalytics } from 'firebase/analytics';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCF19jDxvSUjyd5R8N9_FJ0-DzyBQAYs1g",
  authDomain: "levelupteensus.firebaseapp.com",
  projectId: "levelupteensus",
  storageBucket: "levelupteensus.firebasestorage.app",
  messagingSenderId: "626925593956",
  appId: "1:626925593956:web:956e7503936e3537814671",
  measurementId: "G-NGBQG34RKB"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);

export { app, db, analytics };