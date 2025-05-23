export async function initializeParentApp() {
  document.addEventListener('DOMContentLoaded', () => {
    initializeApp({ isChild: false });
  });
}

export async function initializeChildApp() {
  document.addEventListener('DOMContentLoaded', () => {
    initializeApp({ isChild: true });
  });
}

/**
 * Generates and copies an invite code for a child profile.
 */
async function generateInvite() {
  try {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    await setDoc(doc(db, CONFIG.COLLECTIONS.INVITES, code), {
      parentUid: auth.currentUser.uid,
      kidName: store.currentKid,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    });
    navigator.clipboard.writeText(code);
    showNotification(`Invite code ${code} copied to clipboard`, 'success');
  } catch (err) {
    handleError(err, 'Failed to generate invite code');
  }
}
/**
 * Responsibility tracking app using Firebase Auth and Firestore.
 * Manages parent/child dashboards for tracking responsibilities and privileges.
 * @module app
 */

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

/**
 * Refreshes the kidSelect dropdown with current profiles.
 */
function refreshKidSelect() {
  const kidSelect = document.getElementById('kidSelect');
  if (!kidSelect || !store || !store.profiles) return;
  kidSelect.innerHTML = '';
  Object.keys(store.profiles).forEach(kid => {
    const option = document.createElement('option');
    option.value = kid;
    option.textContent = kid;
    kidSelect.appendChild(option);
  });
}

// Constants
const CONFIG = {
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
    1: { responsibilities: ['Shower daily', 'Brush teeth 2×', 'Put away shoes/coats'], privileges: ['Allowance', '1h screen time', 'Choose family movie'] },
    2: { responsibilities: ['Keep bedroom tidy', 'Pack own lunch'], privileges: ['Smartphone', 'Decorate room'] },
    3: { responsibilities: ['Take out trash', 'Feed pet'], privileges: ['Video games', 'Friend outings'] },
    4: { responsibilities: ['Maintain GPA B', 'Manage homework'], privileges: ['Laptop', 'Later curfew'] },
    5: { responsibilities: ['Budget money', 'Safe driving'], privileges: ['Car access', 'Flexible curfew'] }
  },
  DEFAULT_KID: 'Kid 1'
};

// State
/** @type {{currentKid: string, profiles: {[kid: string]: {[tierId: string]: {responsibilities?: string[], privileges?: string[]}}}, mastered: {[kid: string]: string[]}} | null} */
let store = null;
/** @type {{[tierId: string]: {responsibilities?: string[], privileges?: string[]}} | null} */
let data = null;
/** @type {{action: string, state: any}[]} */
let actionHistory = [];
let actionHistoryIndex = -1;
let isMobile = window.matchMedia('(max-width: 768px)').matches;
let userRole = null;

// Initialize Firebase
const auth = getAuth(app);
const db = initializeFirestore(app, {
  cache: persistentLocalCache({
    tabManager: persistentSingleTabManager()
  })
});

// Enable Firestore debug logging
setLogLevel('debug');

// Connect to emulators
const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
if (isLocalhost) {
  try {
    connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: false });
    connectFirestoreEmulator(db, 'localhost', 8080);
    console.log('Connected to Firebase emulators');
  } catch (err) {
    console.warn('Failed to connect to Firebase emulators:', err);
    showNotification('Emulator connection failed. Using production Firebase.', 'warning');
  }
}


function getElements() {
  return {
    board: document.getElementById('board'),
    kidSelect: document.getElementById('kidSelect'),
    addKidBtn: document.getElementById('addKidBtn'),
    renameKidBtn: document.getElementById('renameKidBtn'),
    deleteKidBtn: document.getElementById('deleteKidBtn'),
    notifications: document.getElementById('notifications'),
    modal: document.getElementById('modal'),
    editInput: document.getElementById('editInput'),
    saveBtn: document.getElementById('saveBtn'),
    deleteBtn: document.getElementById('deleteBtn'),
    cancelBtn: document.getElementById('cancelBtn'),
    loginModal: document.getElementById('loginModal'),
    emailInput: document.getElementById('emailInput'),
    passwordInput: document.getElementById('passwordInput'),
    loginBtn: document.getElementById('loginBtn'),
    registerBtn: document.getElementById('registerBtn'),
    googleBtn: document.getElementById('googleBtn'),
    userEmail: document.getElementById('userEmail'),
    logoutBtn: document.getElementById('logoutBtn'),
    inviteBtn: document.getElementById('inviteBtn'),
    kidBar: document.getElementById('kidBar'),
    // Add undo/redo button references if present
    undoBtn: document.getElementById('undoBtn'),
    redoBtn: document.getElementById('redoBtn')
  };
}

/**
 * Waits for auth state to resolve.
 * @returns {Promise<{ user: firebase.User | null, uid: string | null }>}
 */
function waitForAuthState() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve({ user, uid: user?.uid || null });
    });
  });
}

/**
 * Resets UI elements to a consistent state.
 * @param {Object} elements - DOM elements
 */
function resetUIElements(elements) {
  const { board, loginModal } = elements;
  if (loginModal) loginModal.style.display = 'flex';
  // Do NOT clear the entire board; only clear the content-area if present
  if (board) {
    let contentArea = board.querySelector('.content-area');
    if (contentArea) {
      contentArea.innerHTML = '<h1>LevelUp</h1><p>Please log in to continue.</p>';
    }
  }
}

/**
 * Initializes the app with config.
 * @param {Object} param0 - config object
 * @param {boolean} param0.isChild
 */
function initializeApp({ isChild }) {
  const elements = getElements();

  // Validate DOM elements
  const requiredElements = ['board'];
  for (const [key, el] of Object.entries(elements)) {
    if (!el && requiredElements.includes(key)) {
      console.error(`Required DOM element "${key}" not found`);
      showNotification('Application initialization failed', 'error');
      return;
    } else if (!el) {
      console.warn(`Optional DOM element "${key}" not found`);
    }
  }

  // Style login modal as a full-screen, centered overlay
  if (elements.loginModal) {
    elements.loginModal.style.position = 'fixed';
    elements.loginModal.style.top = '0';
    elements.loginModal.style.left = '0';
    elements.loginModal.style.width = '100%';
    elements.loginModal.style.height = '100%';
    elements.loginModal.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    elements.loginModal.style.display = 'none'; // Start hidden until needed
    elements.loginModal.style.justifyContent = 'center';
    elements.loginModal.style.alignItems = 'center';
    elements.loginModal.style.zIndex = '1000';
  }

  // Style the edit popup modal similarly
  if (elements.modal) {
    elements.modal.style.position = 'fixed';
    elements.modal.style.top = '0';
    elements.modal.style.left = '0';
    elements.modal.style.width = '100%';
    elements.modal.style.height = '100%';
    elements.modal.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    elements.modal.style.display = 'none'; // Controlled by show/hide logic
    elements.modal.style.justifyContent = 'center';
    elements.modal.style.alignItems = 'center';
    elements.modal.style.zIndex = '1000';
  }

  elements.board.classList.add('board');
  resetUIElements(elements);

  const {
    board, kidSelect, addKidBtn, renameKidBtn, deleteKidBtn,
    notifications, modal, editInput, saveBtn,
    deleteBtn, cancelBtn, loginModal, emailInput, passwordInput, loginBtn,
    registerBtn, googleBtn, userEmail, logoutBtn, inviteBtn, kidBar
  } = elements;

  // Update isMobile on viewport changes
  const mediaQuery = window.matchMedia('(max-width: 768px)');
  mediaQuery.addEventListener('change', (e) => {
    isMobile = e.matches;
    if (userRole === 'parent') {
      buildBoard(elements);
    } else if (userRole === 'child') {
      buildBoardChild(elements);
    }
  });

  // Authentication
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      try {
        try {
          await user.getIdToken(true);
        } catch (e) {
          console.warn('Token refresh failed, continuing with existing session:', e);
        }
        const roleRef = doc(db, CONFIG.COLLECTIONS.ROLES, user.uid);
        let roleSnap = await getDoc(roleRef);
        if (!roleSnap.exists()) {
          await setDoc(roleRef, { role: 'parent' });
          roleSnap = await getDoc(roleRef);
        }
        userRole = roleSnap.data().role;
        if (!['parent', 'child'].includes(userRole)) {
          throw new Error(`Invalid role: ${userRole}`);
        }
        if (loginModal) loginModal.style.display = 'none';
        if (elements.userEmail) elements.userEmail.textContent = user.email;
        // Undo/Redo buttons logic (if present in DOM)
        if (elements.undoBtn) elements.undoBtn.style.display = '';
        if (elements.redoBtn) elements.redoBtn.style.display = '';

        if (userRole === 'parent') {
          await initParentDashboard(user.uid, elements);
          // Persist parent store immediately to Firestore
          await saveStore(null, user.uid);
        } else {
          await initChildDashboard(user.uid, elements);
        }
        // Render the appropriate board based on role
        // buildBoard();
        if (userRole === 'parent') {
          buildBoard(elements);
        } else if (userRole === 'child') {
          buildBoardChild(elements);
        }
      } catch (e) {
        handleError(e, 'Failed to initialize dashboard');
        resetUIElements(elements);
        if (e.code === 'auth/network-request-failed' || e.code === 'auth/invalid-credential') {
          showNotification('Authentication error. Please log in again.', 'error');
          await signOut(auth);
        }
      }
    } else {
      resetUIElements(elements);
      userRole = null;
      store = null;
      data = null;
      actionHistory = [];
      actionHistoryIndex = -1;
    }
  });

  // Event bindings
  if (loginBtn)
    loginBtn.onclick = async () => {
      const email = emailInput.value.trim();
      const password = passwordInput.value.trim();
      if (!email || !password) return showNotification('Email and password are required', 'error');
      try {
        await signInWithEmailAndPassword(auth, email, password);
        showNotification('Logged in successfully', 'success');
      } catch (err) {
        handleError(err, 'Failed to log in');
      }
    };

  if (registerBtn)
    registerBtn.onclick = async () => {
      const email = emailInput.value.trim();
      const password = passwordInput.value.trim();
      if (!email || !password) return showNotification('Email and password are required', 'error');
      // Invite/child registration logic
      const isChildReg = document.getElementById('isChildCheckbox')?.checked;
      const inviteCode = document.getElementById('inviteInput')?.value.trim().toUpperCase();
      try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const uid = userCredential.user.uid;
        if (isChildReg) {
          // Set role to 'child' and link via invite code
          const invData = await promptForInviteCode(inviteCode);
          if (!invData) return;
          const { parentUid, kidName } = invData;
          await setDoc(doc(db, CONFIG.COLLECTIONS.ROLES, uid), { role: 'child' });
          await setDoc(doc(db, CONFIG.COLLECTIONS.USERS, uid), { parentUid }, { merge: true });
        } else {
          await setDoc(doc(db, CONFIG.COLLECTIONS.ROLES, uid), { role: 'parent' });
        }
        showNotification('Registered successfully', 'success');
      } catch (err) {
        handleError(err, 'Failed to register');
      }
    };

  if (googleBtn)
    googleBtn.onclick = async () => {
      const provider = new GoogleAuthProvider();
      try {
        const userCredential = await signInWithPopup(auth, provider);
        const user = userCredential.user;
        const roleRef = doc(db, CONFIG.COLLECTIONS.ROLES, user.uid);
        if (!(await getDoc(roleRef)).exists()) {
          await setDoc(roleRef, { role: 'parent' });
        }
        showNotification('Signed in with Google', 'success');
      } catch (err) {
        handleError(err, 'Failed to sign in with Google');
      }
    };

  if (logoutBtn)
    logoutBtn.onclick = async () => {
      try {
        await saveStore();
        await signOut(auth);
        actionHistory = [];
        actionHistoryIndex = -1;
        showNotification('Logged out successfully', 'success');
      } catch (err) {
        handleError(err, 'Failed to log out');
      }
    };

  if (inviteBtn) inviteBtn.onclick = generateInvite;

  // Modal events
  if (saveBtn) saveBtn.onclick = () => saveModal(editInput, modal);
  if (deleteBtn) deleteBtn.onclick = () => deleteModal(modal);
  if (cancelBtn) cancelBtn.onclick = () => closeModal(modal);
  if (modal) modal.onclick = e => { if (e.target === modal) closeModal(modal); };
  if (typeof window !== 'undefined') {
    window.onkeydown = e => { if (e.key === 'Escape') closeModal(modal); };
  }
}

/**
 * Initializes parent dashboard.
 * @param {string} userId
 * @param {Object} elements
 */
async function initParentDashboard(userId, elements) {
  const { user } = await waitForAuthState();
  if (!user || user.uid !== userId) {
    showNotification('Authentication required', 'error');
    return;
  }
  // Show loading message in content-area
  const board = elements.board;
  if (!board) {
    showNotification('Board element not found', 'error');
    return;
  }
  let contentArea = board.querySelector('.content-area');
  if (!contentArea) {
    contentArea = document.createElement('div');
    contentArea.className = 'content-area';
    board.appendChild(contentArea);
  }
  contentArea.innerHTML = '<p>Loading...</p>';
  await loadStore(userId);
  initKidBar(elements);
  await buildBoardWithUserData(userId, elements);
}

/**
 * Initializes child dashboard.
 * @param {string} userId
 * @param {Object} elements
 */
async function initChildDashboard(userId, elements) {
  const { user } = await waitForAuthState();
  if (!user || user.uid !== userId) {
    showNotification('Authentication required', 'error');
    return;
  }
  try {
    const userRef = doc(db, CONFIG.COLLECTIONS.USERS, userId);
    const userSnap = await getDoc(userRef);
    let parentUid = userSnap.exists() && userSnap.data().parentUid;
    let kidName = null;

    if (!parentUid) {
      const invite = await promptForInviteCode();
      if (!invite) {
        showNotification('No valid invite code provided', 'error');
        return;
      }
      parentUid = invite.parentUid;
      kidName = invite.kidName;
      await setDoc(userRef, { parentUid }, { merge: true });
    }

    await loadStore(parentUid);
    if (kidName) {
      store.currentKid = kidName;
    }
    data = store.profiles[store.currentKid];
    buildBoardChild(elements);
    // Show kidBar for child if present (shared top bar logic)
    if (elements.kidBar) {
      elements.kidBar.style.display = 'flex';
      initKidBar(elements);
    }
    loadChildStreak(userId, elements);
  } catch (e) {
    handleError(e, 'Failed to initialize child dashboard');
  }
}

/**
 * Prompts for invite code via modal or validates provided code.
 * @param {string|null} code - If provided, validates directly; else, prompts UI.
 * @returns {Promise<{parentUid: string, kidName: string}|null>}
 */
async function promptForInviteCode(code = null) {
  if (code) {
    // Validate code directly, same logic as submit.onclick
    const invRef = doc(db, CONFIG.COLLECTIONS.INVITES, code);
    const invSnap = await getDoc(invRef);
    if (invSnap.exists() && !invSnap.data().childUid) {
      const { parentUid, kidName, expiresAt } = invSnap.data();
      if (expiresAt.toDate() < new Date()) {
        showNotification('Invite code expired', 'error');
        return null;
      } else {
        await setDoc(invRef, { childUid: auth.currentUser.uid }, { merge: true });
        return { parentUid, kidName };
      }
    } else {
      showNotification('Invalid or used invite code', 'error');
      return null;
    }
  }
  // Existing UI prompt code...
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <p>Enter invite code from your parent:</p>
      <input type="text" id="inviteCode" maxlength="6">
      <button id="submitCode">Submit</button>
      <button id="cancelCode">Cancel</button>
    `;
    document.body.appendChild(modal);
    
    const input = modal.querySelector('#inviteCode');
    const submit = modal.querySelector('#submitCode');
    const cancel = modal.querySelector('#cancelCode');
    
    submit.onclick = async () => {
      const code = input.value.trim().toUpperCase();
      if (code) {
        const invRef = doc(db, CONFIG.COLLECTIONS.INVITES, code);
        const invSnap = await getDoc(invRef);
        if (invSnap.exists() && !invSnap.data().childUid) {
          const { parentUid, kidName, expiresAt } = invSnap.data();
          if (expiresAt.toDate() < new Date()) {
            showNotification('Invite code expired', 'error');
          } else {
            await setDoc(invRef, { childUid: auth.currentUser.uid }, { merge: true });
            modal.remove();
            resolve({ parentUid, kidName });
          }
        } else {
          showNotification('Invalid or used invite code', 'error');
        }
      }
    };
    
    cancel.onclick = () => {
      modal.remove();
      resolve(null);
    };
  });
}

/**
 * Loads store from Firestore.
 * @param {string} uid
 */
async function loadStore(uid) {
  try {
    const userDocRef = doc(db, CONFIG.COLLECTIONS.USERS, uid);
    const docSnap = await getDoc(userDocRef);
    if (docSnap.exists() && docSnap.data().store) {
      store = docSnap.data().store;
      if (!store.profiles || !store.currentKid || !store.mastered) {
        throw new Error('Invalid store structure');
      }
      Object.keys(store.profiles).forEach(kid => {
        store.mastered[kid] = Array.isArray(store.mastered[kid]) ? store.mastered[kid] : [];
      });
    } else {
      store = {
        currentKid: CONFIG.DEFAULT_KID,
        profiles: { [CONFIG.DEFAULT_KID]: structuredClone(CONFIG.DEFAULT_DATA) },
        mastered: { [CONFIG.DEFAULT_KID]: [] }
      };
      await setDoc(userDocRef, { store }, { merge: true });
    }
    data = store.profiles[store.currentKid];
  } catch (e) {
    handleError(e, 'Failed to load data. Using default store.');
    store = {
      currentKid: CONFIG.DEFAULT_KID,
      profiles: { [CONFIG.DEFAULT_KID]: structuredClone(CONFIG.DEFAULT_DATA) },
      mastered: { [CONFIG.DEFAULT_KID]: [] }
    };
    data = store.profiles[store.currentKid];
    try {
      await setDoc(doc(db, CONFIG.COLLECTIONS.USERS, uid), { store }, { merge: true });
    } catch (retryErr) {
      handleError(retryErr, 'Failed to save default store');
    }
  }
  return store;
}

/**
 * Saves store to Firestore.
 * @param {string|null} action
 * @param {string} [uid]
 */
async function saveStore(action = null, uid = auth.currentUser?.uid) {
  if (!uid) return;
  if (action) {
    actionHistory = actionHistory.slice(0, actionHistoryIndex + 1);
    actionHistory.push({ action, state: structuredClone(store) });
    if (actionHistory.length > CONFIG.MAX_HISTORY) {
      actionHistory.shift();
      actionHistoryIndex--;
    }
    actionHistoryIndex++;
    updateUndoRedo();
  }
  try {
    await setDoc(doc(db, CONFIG.COLLECTIONS.USERS, uid), { store }, { merge: true });
  } catch (e) {
    handleError(e, 'Failed to save data');
  }
}

/**
 * Undo action.
 */
function undo() {
  if (actionHistoryIndex <= 0) return;
  actionHistoryIndex--;
  const state = actionHistory[actionHistoryIndex].state;
  if (!state.profiles || !state.currentKid) {
    console.warn('Invalid state in undo');
    return;
  }
  store = structuredClone(state);
  data = store.profiles[store.currentKid];
  saveStore();
  refreshKidSelect();
  document.getElementById('kidSelect').value = store.currentKid;
  buildBoard();
  updateUndoRedo();
}

/**
 * Redo action.
 */
function redo() {
  if (actionHistoryIndex >= actionHistory.length - 1) return;
  actionHistoryIndex++;
  const state = actionHistory[actionHistoryIndex].state;
  if (!state.profiles || !state.currentKid) {
    console.warn('Invalid state in redo');
    return;
  }
  store = structuredClone(state);
  data = store.profiles[store.currentKid];
  saveStore();
  refreshKidSelect();
  document.getElementById('kidSelect').value = store.currentKid;
  buildBoard();
  updateUndoRedo();
}

/**
 * Updates undo/redo button states.
 */
function updateUndoRedo() {
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');
  if (undoBtn) undoBtn.disabled = actionHistoryIndex <= 0;
  if (redoBtn) redoBtn.disabled = actionHistoryIndex >= actionHistory.length - 1;
}

/**
 * Shows notification.
 * @param {string} message
 * @param {string} [type='success']
 */
function showNotification(message, type = 'success') {
  console.log(`Notification: ${message} (${type})`);
  const notifications = document.getElementById('notifications');
  if (!notifications) return;
  const div = document.createElement('div');
  div.className = `notification ${type}`;
  div.textContent = message;
  notifications.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

/**
 * Handles errors.
 * @param {Error} err
 * @param {string} [userMessage='An error occurred']
 */
function handleError(err, userMessage = 'An error occurred') {
  console.error(err);
  showNotification(userMessage, 'error');
}

/**
 * Validates input text.
 * @param {string} text
 * @returns {string|null}
 */
function validateInput(text) {
  if (!text) return 'Input cannot be empty';
  if (text.length > CONFIG.MAX_INPUT_LENGTH) return `Input must be ${CONFIG.MAX_INPUT_LENGTH} characters or less`;
  if (!CONFIG.VALIDATION_REGEX.test(text)) return 'Only letters, numbers, spaces, and basic punctuation allowed';
  return null;
}

/**
 * Checks for duplicate items.
 * @param {string} text
 * @param {string} category
 * @param {string} tierId
 * @returns {boolean}
 */
function isDuplicate(text, category, tierId) {
  return (data[tierId]?.[category] || []).includes(text);
}

/**
 * Initializes kid bar controls.
 * @param {Object} elements
 */
function initKidBar(elements) {
  if (userRole !== 'parent') return;
  const { kidSelect, addKidBtn, renameKidBtn, deleteKidBtn, undoBtn, redoBtn } = elements;
  if (!kidSelect) {
    console.error('kidSelect element is required but not found');
    return;
  }
  kidSelect.style.display = '';
  refreshKidSelect();
  kidSelect.value = store.currentKid;
  kidSelect.onchange = () => {
    store.currentKid = kidSelect.value;
    data = store.profiles[store.currentKid];
    store.mastered[store.currentKid] = store.mastered[store.currentKid] || [];
    saveStore('changeKid');
    buildBoard();
  };
  if (addKidBtn) addKidBtn.onclick = addKid;
  if (renameKidBtn) renameKidBtn.onclick = renameKid;
  if (deleteKidBtn) deleteKidBtn.onclick = deleteKid;
  if (undoBtn) undoBtn.onclick = undo;
  if (redoBtn) redoBtn.onclick = redo;
}


/**
 * Adds a new kid.
 */
function addKid() {
  const name = prompt('Enter new kid name');
  if (!name) return;
  const kid = name.trim();
  const error = validateInput(kid);
  if (error) return showNotification(error, 'error');
  if (store.profiles[kid]) return showNotification('Kid name already exists', 'error');
  store.profiles[kid] = structuredClone(CONFIG.DEFAULT_DATA);
  store.mastered[kid] = [];
  store.currentKid = kid;
  data = store.profiles[kid];
  saveStore('addKid');
  refreshKidSelect();
  document.getElementById('kidSelect').value = kid;
  buildBoard();
}

/**
 * Renames a kid.
 */
function renameKid() {
  const cur = store.currentKid;
  const name = prompt('Rename kid', cur);
  if (!name) return;
  const kid = name.trim();
  const error = validateInput(kid);
  if (error) return showNotification(error, 'error');
  if (kid === cur) return;
  if (store.profiles[kid]) return showNotification('Kid name already exists', 'error');
  store.profiles[kid] = store.profiles[cur];
  store.mastered[kid] = store.mastered[cur] || [];
  delete store.profiles[cur];
  delete store.mastered[cur];
  store.currentKid = kid;
  data = store.profiles[kid];
  saveStore('renameKid');
  refreshKidSelect();
  document.getElementById('kidSelect').value = kid;
  buildBoard();
}

/**
 * Deletes a kid.
 */
function deleteKid() {
  if (Object.keys(store.profiles).length === 1) {
    showNotification('Cannot delete the only profile', 'error');
    return;
  }
  if (!confirm(`Delete ${store.currentKid}?`)) return;
  delete store.profiles[store.currentKid];
  delete store.mastered[store.currentKid];
  store.currentKid = Object.keys(store.profiles)[0];
  data = store.profiles[store.currentKid];
  store.mastered[store.currentKid] = store.mastered[store.currentKid] || [];
  saveStore('deleteKid');
  refreshKidSelect();
  document.getElementById('kidSelect').value = store.currentKid;
  buildBoard();
}




/**
 * Builds the board for parent view.
 */
function buildBoard(elements) {
  const {
    board, kidBar, kidSelect, addKidBtn, renameKidBtn,
    deleteKidBtn, undoBtn, redoBtn
  } = elements || getElements();
  if (!board) {
    console.error('Board element missing');
    return;
  }
  console.log('Building board with store:', store);
  
  // Preserve existing controls and kidBar; clear only the content area
  let contentArea = board.querySelector('.content-area');
  if (!contentArea) {
    contentArea = document.createElement('div');
    contentArea.className = 'content-area';
    // Insert contentArea after the static kidBar (if present), else at top
    if (kidBar && kidBar.parentElement === board) {
      board.insertBefore(contentArea, kidBar.nextSibling);
    } else {
      board.insertBefore(contentArea, board.firstChild);
    }
  }
  contentArea.innerHTML = '';

  if (userRole === 'parent') {
    if (kidBar) {
      initKidBar({ kidSelect, addKidBtn, renameKidBtn, deleteKidBtn, undoBtn, redoBtn });
    }
  }

  if (!data || !store) {
    contentArea.innerHTML = '<p>No data available. Please add some items.</p>';
    return;
  }

  // Shared top header fragment for both parent and child
  const topHeader = document.createElement('div');
  topHeader.className = 'top-header';
  topHeader.innerHTML = `
    <h2 class="child-name">${store.currentKid}</h2>
  `;
  // Level section logic
  const masteredSet = new Set(store.mastered[store.currentKid] || []);
  let highest = 0;
  CONFIG.TIER_CONFIG.forEach(t => {
    const resp = (data[t.id]?.responsibilities || []);
    if (resp.length && resp.every(text => masteredSet.has(text))) highest = t.id;
  });
  const next = Math.min(highest + 1, CONFIG.TIER_CONFIG.length);
  const nextResp = data[next]?.responsibilities || [];
  const nextCount = nextResp.length;
  const doneCount = nextResp.filter(text => masteredSet.has(text)).length;
  const pct = nextCount ? Math.round((doneCount / nextCount) * 100) : 0;
  const levelSection = document.createElement('div');
  levelSection.className = 'level-section';
  levelSection.innerHTML = `
    <h2>Current Level: Tier ${highest}</h2>
    <p>Next: Tier ${next} (${doneCount}/${nextCount} done)</p>
  `;
  topHeader.appendChild(levelSection);
  // Streak display will be appended by loadChildStreak if needed
  contentArea.appendChild(topHeader);

  const tiersContainer = document.createElement('div');
  tiersContainer.className = 'tiers-container';
  CONFIG.TIER_CONFIG.forEach(tier => {
    const col = document.createElement('div');
    col.className = 'tier';
    col.dataset.tier = tier.id;
    col.tabIndex = 0;
    col.innerHTML = `
      <div class="tier-header"><h2>Tier ${tier.id}: ${tier.name}</h2></div>
      <div class="progress-bar"><span style="width: 0%"></span></div>
      <div class="lists">
        ${section('Responsibilities', 'responsibilities', tier.id)}
        ${section('Privileges', 'privileges', tier.id)}
      </div>`;
    tiersContainer.appendChild(col);
  });
  contentArea.appendChild(tiersContainer);

  populateLocalLists();
  attachEvents();
  updateAllTiers();
}

/**
 * Builds section HTML.
 * @param {string} lbl
 * @param {string} cat
 * @param {string} tierId
 * @returns {string}
 */
function section(lbl, cat, tierId) {
  return `
    <div>
      <div class="list-title">${lbl}</div>
      <ul data-category="${cat}" id="tier${tierId}-${cat.slice(0, 4)}" role="list"></ul>
      <button class="add-btn" data-category="${cat}" aria-label="Add new ${cat.slice(0, -3)}">+ Add</button>
    </div>`;
}

/**
 * Populates local tier lists.
 */
function populateLocalLists() {
  CONFIG.TIER_CONFIG.forEach(({ id }) => ['responsibilities', 'privileges'].forEach(cat => {
    const ul = document.getElementById(`tier${id}-${cat.slice(0, 4)}`);
    if (!ul) return;
    ul.innerHTML = '';
    (data[id]?.[cat] || []).forEach(txt => ul.appendChild(item(txt, cat)));
  }));
}

/**
 * Updates mastered list.
 */
function updateMasteredList() {
  const masteredListEl = document.getElementById('mastered-list');
  if (!masteredListEl) return;
  
  const masteredItems = store.mastered[store.currentKid] || [];
  if (masteredItems.length === 0) {
    masteredListEl.innerHTML = '<li>No mastered responsibilities yet.</li>';
    return;
  }
  
  masteredListEl.innerHTML = masteredItems.map(text => {
    return `
      <li class="mastered-item">
        ${text}
        <button class="undo-mastered-btn" aria-label="Return ${text} to to-do list">Return to To-Do</button>
      </li>`;
  }).join('');
  
  masteredListEl.querySelectorAll('.undo-mastered-btn').forEach(btn => {
    btn.onclick = () => {
      const text = btn.parentElement.textContent.replace('Return to To-Do', '').trim();
      const mastered = getMasteredSet();
      mastered.delete(text);
      saveMastered(mastered);
      saveStore('unmaster');
      updateMasteredList();
      updateAllTiers();
    };
  });
}

/**
 * Creates a list item.
 * @param {string} text
 * @param {string} category
 * @returns {HTMLLIElement}
 */
function item(text, category) {
  const li = document.createElement('li');
  li.draggable = !isMobile;
  li.dataset.category = category;
  li.tabIndex = 0;
  if (category === 'responsibilities') {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = `cb-${text}-${category}`;
    cb.setAttribute('aria-label', `Mark ${text} as mastered`);
    const m = getMasteredSet();
    cb.checked = m.has(text);
    li.classList.toggle('mastered', cb.checked);
    cb.onchange = () => {
      li.classList.toggle('mastered', cb.checked);
      const mastered = getMasteredSet();
      cb.checked ? mastered.add(text) : mastered.delete(text);
      saveMastered(mastered);
      saveStore('master');
      updateMasteredList();
      updateTier(li.closest('.tier'));
      if (userRole === 'child' && cb.checked) {
        recordCompletion(text).catch(err => console.error(err));
      }
      loadResponsibilityStreakFor(li, text).catch(err => console.error(err));
    };
    li.appendChild(cb);
  }
  const span = document.createElement('span');
  span.textContent = text;
  span.ondblclick = () => editModal(li);
  li.appendChild(span);
  if (isMobile) {
    const moveBtn = document.createElement('button');
    moveBtn.className = 'move-btn';
    moveBtn.textContent = 'Move';
    moveBtn.setAttribute('aria-label', `Move ${text} to another tier`);
    moveBtn.onclick = () => moveItemMobile(li);
    li.appendChild(moveBtn);
  } else {
    li.ondragstart = e => {
      li.classList.add('dragging');
      e.dataTransfer.setData('text/plain', text);
      e.dataTransfer.setData('category', category);
      e.dataTransfer.setData('sourceTier', li.closest('.tier').dataset.tier);
    };
    li.ondragend = () => li.classList.remove('dragging');
  }
  li.onkeydown = e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      editModal(li);
    }
  };
  return li;
}

/**
 * Moves item on mobile.
 * @param {HTMLLIElement} li
 */
function moveItemMobile(li) {
  const text = li.querySelector('span').textContent;
  const category = li.dataset.category;
  const sourceTier = li.closest('.tier').dataset.tier;
  
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `<p>Move "${text}" to:</p>`;
  const select = document.createElement('select');
  CONFIG.TIER_CONFIG.forEach(t => {
    if (t.id != sourceTier) {
      const option = new Option(`Tier ${t.id}: ${t.name}`, t.id);
      select.add(option);
    }
  });
  modal.appendChild(select);
  const save = document.createElement('button');
  save.textContent = 'Move';
  modal.appendChild(save);
  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  modal.appendChild(cancel);
  document.body.appendChild(modal);
  
  save.onclick = () => {
    const targetTierId = select.value;
    if (isDuplicate(text, category, targetTierId)) {
      showNotification('Item already exists in target tier', 'error');
    } else {
      removeText(text, category, sourceTier);
      addText(document.getElementById(`tier${targetTierId}-${category.slice(0, 4)}`), text, category);
      saveStore('move');
      updateAllTiers();
    }
    modal.remove();
  };
  cancel.onclick = () => modal.remove();
}

/**
 * Opens edit modal.
 * @param {HTMLLIElement} li
 */
let curLi = null;
function editModal(li) {
  curLi = li;
  const editInput = document.getElementById('editInput');
  const modal = document.getElementById('modal');
  editInput.value = li.querySelector('span').textContent.trim();
  modal.style.display = 'flex';
  editInput.focus();
}

/**
 * Closes modal.
 * @param {HTMLElement} modal
 */
function closeModal(modal) {
  modal.style.display = 'none';
  curLi = null;
}

/**
 * Saves modal changes.
 * @param {HTMLInputElement} editInput
 * @param {HTMLElement} modal
 */
function saveModal(editInput, modal) {
  if (!curLi) {
    showNotification('No item selected for editing', 'error');
    return;
  }
  const newText = editInput.value.trim();
  const error = validateInput(newText);
  if (error) return showNotification(error, 'error');
  const tierId = curLi.closest('.tier').dataset.tier;
  if (isDuplicate(newText, curLi.dataset.category, tierId)) {
    showNotification('Item already exists in this tier', 'error');
    return;
  }
  const oldText = curLi.querySelector('span').textContent;
  curLi.querySelector('span').textContent = newText;
  replaceText(oldText, newText, curLi.dataset.category);
  renameMastered(oldText, newText);
  saveStore('edit');
  updateMasteredList();
  closeModal(modal);
}

/**
 * Deletes item from modal.
 * @param {HTMLElement} modal
 */
function deleteModal(modal) {
  if (!curLi) return;
  const txt = curLi.querySelector('span').textContent;
  const tier = curLi.closest('.tier');
  removeText(txt, curLi.dataset.category);
  const m = getMasteredSet();
  m.delete(txt);
  saveMastered(m);
  curLi.style.animation = 'fadeOut 0.3s ease';
  curLi.addEventListener('animationend', () => {
    curLi.remove();
    saveStore('delete');
    updateMasteredList();
    updateTier(tier);
    closeModal(modal);
  }, { once: true });
}

/**
 * Attaches drag-and-drop and add events.
 */
function attachEvents() {
  document.querySelectorAll('ul').forEach(ul => {
    if (!isMobile) {
      ul.ondragover = e => e.preventDefault();
      ul.ondragenter = e => {
        if (ul.dataset.category === e.dataTransfer.getData('category')) ul.classList.add('drag-over');
      };
      ul.ondragleave = () => ul.classList.remove('drag-over');
      ul.ondrop = e => drop(e, ul);
    }
  });
  document.querySelectorAll('.add-btn').forEach(btn => {
    btn.onclick = addItem;
  });
}

/**
 * Handles drop event.
 * @param {DragEvent} e
 * @param {HTMLUListElement} ul
 */
function drop(e, ul) {
  e.preventDefault();
  ul.classList.remove('drag-over');
  const text = e.dataTransfer.getData('text/plain');
  const cat = e.dataTransfer.getData('category');
  const sourceTier = e.dataTransfer.getData('sourceTier');
  const targetTier = ul.id.match(/^tier(\d+)/)[1];
  if (ul.dataset.category !== cat || sourceTier === targetTier) return;
  if (isDuplicate(text, cat, targetTier)) {
    showNotification('Item already exists in target tier', 'error');
    return;
  }
  removeText(text, cat, sourceTier);
  addText(ul, text, cat);
  saveStore('move');
  updateAllTiers();
}

/**
 * Adds new item.
 * @param {Event} e
 */
function addItem(e) {
  const cat = e.currentTarget.dataset.category;
  const txt = prompt(`Add new ${cat.slice(0, -3)}`);
  if (!txt?.trim()) {
    showNotification('No input provided', 'error');
    return;
  }
  const text = txt.trim();
  const error = validateInput(text);
  if (error) {
    showNotification(error, 'error');
    return;
  }
  const ul = e.currentTarget.previousElementSibling;
  const tierId = ul.id.match(/^tier(\d+)/)[1];
  if (isDuplicate(text, cat, tierId)) {
    showNotification('Item already exists in this tier', 'error');
    return;
  }
  addText(ul, text, cat);
  saveStore('add');
  updateTier(ul.closest('.tier'));
  showNotification(`Added "${text}" to ${cat.slice(0, -3)}`, 'success');
}

/**
 * Updates tier progress.
 * @param {HTMLElement} tier
 */
function updateTier(tier) {
  const resp = tier.querySelector("ul[data-category='responsibilities']");
  const total = resp.children.length;
  const mastered = resp.querySelectorAll('li.mastered').length;
  tier.classList.toggle('complete', total > 0 && mastered === total);
  const progress = total > 0 ? (mastered / total) * 100 : 0;
  tier.querySelector('.progress-bar span').style.width = `${progress}%`;
}

/**
 * Updates all tiers.
 */
function updateAllTiers() {
  document.querySelectorAll('.tier').forEach(updateTier);
}

/**
 * Gets mastered set.
 * @returns {Set<string>}
 */
function getMasteredSet() {
  store.mastered = store.mastered || {};
  store.mastered[store.currentKid] = Array.isArray(store.mastered[store.currentKid])
    ? store.mastered[store.currentKid]
    : [];
  return new Set(store.mastered[store.currentKid]);
}

/**
 * Saves mastered set.
 * @param {Set<string>} set
 */
function saveMastered(set) {
  store.mastered[store.currentKid] = Array.from(set);
}

/**
 * Removes text from tier.
 * @param {string} text
 * @param {string} cat
 * @param {string} [sourceTier]
 */
function removeText(text, cat, sourceTier = null) {
  if (sourceTier) {
    const tierData = data[sourceTier];
    if (tierData && tierData[cat]) {
      tierData[cat] = tierData[cat].filter(item => item !== text);
      if (tierData[cat].length === 0) delete tierData[cat];
    }
  } else {
    CONFIG.TIER_CONFIG.forEach(tier => {
      const tierData = data[tier.id];
      if (tierData && tierData[cat]) {
        tierData[cat] = tierData[cat].filter(item => item !== text);
        if (tierData[cat].length === 0) delete tierData[cat];
      }
    });
  }
}

/**
 * Adds text to tier.
 * @param {HTMLUListElement} ul
 * @param {string} text
 * @param {string} cat
 */
function addText(ul, text, cat) {
  const tierId = ul.id.match(/^tier(\d+)/)[1];
  if (!data[tierId]) data[tierId] = {};
  if (!data[tierId][cat]) data[tierId][cat] = [];
  data[tierId][cat].push(text);
  ul.appendChild(item(text, cat));
}

/**
 * Replaces text in tier.
 * @param {string} oldText
 * @param {string} newText
 * @param {string} cat
 */
function replaceText(oldText, newText, cat) {
  CONFIG.TIER_CONFIG.forEach(tier => {
    const tierData = data[tier.id];
    if (tierData && tierData[cat]) {
      const idx = tierData[cat].indexOf(oldText);
      if (idx !== -1) tierData[cat][idx] = newText;
    }
  });
}

/**
 * Renames mastered item.
 * @param {string} oldText
 * @param {string} newText
 */
function renameMastered(oldText, newText) {
  const m = getMasteredSet();
  if (m.has(oldText)) {
    m.delete(oldText);
    m.add(newText);
    saveMastered(m);
  }
}

/**
 * Builds board with user data.
 */
function buildBoardWithUserData() {
  try {
    buildBoard();
  } catch (error) {
    handleError(error, 'Failed to build board');
  }
}

/**
 * Builds board for child view.
 * @param {Object} elements
 */
function buildBoardChild(elements) {
  buildBoard(elements);
  // Remove edit/move/add/undo/redo buttons only if not child or if editing is restricted
  if (elements.board && userRole === 'child') {
    document.querySelectorAll('.add-btn, .move-btn, button.modify, .undo-btn, .redo-btn').forEach(btn => btn.remove());
    document.querySelectorAll('li span').forEach(span => span.ondblclick = null);
  }
  // Initialize streak badges for child view
  loadAllResponsibilityStreaks();
}

/**
 * Loads child streak.
 * @param {string} childUid
 * @param {Object} elements
 */
async function loadChildStreak(childUid, elements) {
  try {
    const snaps = await getDocs(query(
      collection(db, CONFIG.COLLECTIONS.CHILD_ACTIVITY),
      where('childUid', '==', childUid),
      orderBy('date', 'desc')
    ));
    let streak = 0;
    const today = new Date();
    for (let snap of snaps.docs) {
      const date = snap.data().date.toDate();
      const diffDays = Math.round((today - date) / (1000 * 60 * 60 * 24));
      if (diffDays === streak) streak++;
      else break;
    }
    const topHeader = document.querySelector('.top-header');
    const streakEl = document.createElement('div');
    streakEl.className = 'streak-display';
    streakEl.textContent = `🔥 Current Streak: ${streak} day${streak !== 1 ? 's' : ''}`;
    topHeader.appendChild(streakEl);
  } catch (e) {
    handleError(e, 'Failed to load streak');
  }
}

/**
 * Records today's completion for a single responsibility.
 * @param {string} text
 */
async function recordCompletion(text) {
  const childUid = auth.currentUser.uid;
  const today = new Date();
  const date = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // Build YYYY-MM-DD string for key
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const dateKey = `${yyyy}-${mm}-${dd}`;
  // Create a deterministic document ID: childUid_responsibility_date
  const safeResp = text.replace(/\s+/g, '_').replace(/[^\w\-]/g, '');
  const docId = `${childUid}_${safeResp}_${dateKey}`;
  await setDoc(
    doc(db, CONFIG.COLLECTIONS.CHILD_ACTIVITY, docId),
    { childUid, responsibility: text, date }
  );
}

/**
 * Computes and updates streak badge for one responsibility item.
 * @param {HTMLLIElement} li
 * @param {string} text
 */
async function loadResponsibilityStreakFor(li, text) {
  const childUid = auth.currentUser.uid;
  const snaps = await getDocs(query(
    collection(db, CONFIG.COLLECTIONS.CHILD_ACTIVITY),
    where('childUid', '==', childUid),
    where('responsibility', '==', text),
    orderBy('date', 'desc')
  ));
  let streak = 0;
  const today = new Date();
  const expected = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  for (const docSnap of snaps.docs) {
    const d = docSnap.data().date.toDate();
    d.setHours(0,0,0,0);
    if (+d === +expected) {
      streak++;
      expected.setDate(expected.getDate() - 1);
    } else {
      break;
    }
  }
  let badge = li.querySelector('.streak-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'streak-badge';
    li.appendChild(badge);
  }
  badge.textContent = `🔥 ${streak}d`;
}

/**
 * Loads streak badges for all visible responsibilities.
 */
function loadAllResponsibilityStreaks() {
  document.querySelectorAll('li[data-category="responsibilities"]').forEach(li => {
    const text = li.querySelector('span').textContent.trim();
    loadResponsibilityStreakFor(li, text).catch(err => console.error(err));
  });
}