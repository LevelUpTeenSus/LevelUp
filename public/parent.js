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
  let store = null;
  let data = null;
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
      undoBtn: document.getElementById('undoBtn'),
      redoBtn: document.getElementById('redoBtn')
    };
  }
  
  function waitForAuthState() {
    return new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        unsubscribe();
        resolve({ user, uid: user?.uid || null });
      });
    });
  }
  
  function resetUIElements(elements) {
    const { board, loginModal } = elements;
    if (loginModal) loginModal.style.display = 'flex';
    if (board) {
      let contentArea = board.querySelector('.content-area');
      if (contentArea) {
        contentArea.innerHTML = '<h1>LevelUp</h1><p>Please log in to continue.</p>';
      }
    }
  }
  
  export async function initializeParentApp() {
    document.addEventListener('DOMContentLoaded', () => {
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
  
      // Style modals
      if (elements.loginModal) {
        elements.loginModal.style.position = 'fixed';
        elements.loginModal.style.top = '0';
        elements.loginModal.style.left = '0';
        elements.loginModal.style.width = '100%';
        elements.loginModal.style.height = '100%';
        elements.loginModal.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        elements.loginModal.style.display = 'none';
        elements.loginModal.style.justifyContent = 'center';
        elements.loginModal.style.alignItems = 'center';
        elements.loginModal.style.zIndex = '1000';
      }
  
      if (elements.modal) {
        elements.modal.style.position = 'fixed';
        elements.modal.style.top = '0';
        elements.modal.style.left = '0';
        elements.modal.style.width = '100%';
        elements.modal.style.height = '100%';
        elements.modal.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        elements.modal.style.display = 'none';
        elements.modal.style.justifyContent = 'center';
        elements.modal.style.alignItems = 'center';
        elements.modal.style.zIndex = '1000';
      }
  
      elements.board.classList.add('board');
      resetUIElements(elements);
  
      const {
        board, kidSelect, addKidBtn, renameKidBtn, deleteKidBtn,
        notifications, modal, editInput, saveBtn, deleteBtn, cancelBtn,
        loginModal, emailInput, passwordInput, loginBtn, registerBtn,
        googleBtn, userEmail, logoutBtn, inviteBtn, kidBar, undoBtn, redoBtn
      } = elements;
  
      // Update isMobile on viewport changes
      const mediaQuery = window.matchMedia('(max-width: 768px)');
      mediaQuery.addEventListener('change', (e) => {
        isMobile = e.matches;
        if (userRole === 'parent') {
          buildBoard(elements);
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
            if (elements.undoBtn) elements.undoBtn.style.display = '';
            if (elements.redoBtn) elements.redoBtn.style.display = '';
  
            if (userRole === 'parent') {
              await initParentDashboard(user.uid, elements);
              await saveStore(null, user.uid);
              buildBoard(elements);
            } else {
              showNotification('Access restricted to parent accounts', 'error');
              await signOut(auth);
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
      if (loginBtn) {
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
      }
  
      if (registerBtn) {
        registerBtn.onclick = async () => {
          const email = emailInput.value.trim();
          const password = passwordInput.value.trim();
          if (!email || !password) return showNotification('Email and password are required', 'error');
          try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const uid = userCredential.user.uid;
            await setDoc(doc(db, CONFIG.COLLECTIONS.ROLES, uid), { role: 'parent' });
            showNotification('Registered successfully', 'success');
          } catch (err) {
            handleError(err, 'Failed to register');
          }
        };
      }
  
      if (googleBtn) {
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
      }
  
      if (logoutBtn) {
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
      }
  
      if (inviteBtn) inviteBtn.onclick = generateInvite;
  
      if (saveBtn) saveBtn.onclick = () => saveModal(editInput, modal);
      if (deleteBtn) deleteBtn.onclick = () => deleteModal(modal);
      if (cancelBtn) cancelBtn.onclick = () => closeModal(modal);
      if (modal) modal.onclick = e => { if (e.target === modal) closeModal(modal); };
      if (typeof window !== 'undefined') {
        window.onkeydown = e => { if (e.key === 'Escape') closeModal(modal); };
      }
    });
  }
  
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
  
  async function initParentDashboard(userId, elements) {
    const { user } = await waitForAuthState();
    if (!user || user.uid !== userId) {
      showNotification('Authentication required', 'error');
      return;
    }
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
  
  function updateUndoRedo() {
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    if (undoBtn) undoBtn.disabled = actionHistoryIndex <= 0;
    if (redoBtn) redoBtn.disabled = actionHistoryIndex >= actionHistory.length - 1;
  }
  
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
  
  function handleError(err, userMessage = 'An error occurred') {
    console.error(err);
    showNotification(userMessage, 'error');
  }
  
  function validateInput(text) {
    if (!text) return 'Input cannot be empty';
    if (text.length > CONFIG.MAX_INPUT_LENGTH) return `Input must be ${CONFIG.MAX_INPUT_LENGTH} characters or less`;
    if (!CONFIG.VALIDATION_REGEX.test(text)) return 'Only letters, numbers, spaces, and basic punctuation allowed';
    return null;
  }
  
  function isDuplicate(text, category, tierId) {
    return (data[tierId]?.[category] || []).includes(text);
  }
  
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
    let contentArea = board.querySelector('.content-area');
    if (!contentArea) {
      contentArea = document.createElement('div');
      contentArea.className = 'content-area';
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
    const topHeader = document.createElement('div');
    topHeader.className = 'top-header';
    topHeader.innerHTML = `
      <h2 class="child-name">${store.currentKid}</h2>
    `;
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
  
  function section(lbl, cat, tierId) {
    return `
      <div>
        <div class="list-title">${lbl}</div>
        <ul data-category="${cat}" id="tier${tierId}-${cat.slice(0, 4)}" role="list"></ul>
        <button class="add-btn" data-category="${cat}" aria-label="Add new ${cat.slice(0, -3)}">+ Add</button>
      </div>`;
  }
  
  function populateLocalLists() {
    CONFIG.TIER_CONFIG.forEach(({ id }) => ['responsibilities', 'privileges'].forEach(cat => {
      const ul = document.getElementById(`tier${id}-${cat.slice(0, 4)}`);
      if (!ul) return;
      ul.innerHTML = '';
      (data[id]?.[cat] || []).forEach(txt => ul.appendChild(item(txt, cat)));
    }));
  }
  
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
  
  let curLi = null;
  function editModal(li) {
    curLi = li;
    const editInput = document.getElementById('editInput');
    const modal = document.getElementById('modal');
    editInput.value = li.querySelector('span').textContent.trim();
    modal.style.display = 'flex';
    editInput.focus();
  }
  
  function closeModal(modal) {
    modal.style.display = 'none';
    curLi = null;
  }
  
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
  
  function updateTier(tier) {
    const resp = tier.querySelector("ul[data-category='responsibilities']");
    const total = resp.children.length;
    const mastered = resp.querySelectorAll('li.mastered').length;
    tier.classList.toggle('complete', total > 0 && mastered === total);
    const progress = total > 0 ? (mastered / total) * 100 : 0;
    tier.querySelector('.progress-bar span').style.width = `${progress}%`;
  }
  
  function updateAllTiers() {
    document.querySelectorAll('.tier').forEach(updateTier);
  }
  
  function getMasteredSet() {
    store.mastered = store.mastered || {};
    store.mastered[store.currentKid] = Array.isArray(store.mastered[store.currentKid])
      ? store.mastered[store.currentKid]
      : [];
    return new Set(store.mastered[store.currentKid]);
  }
  
  function saveMastered(set) {
    store.mastered[store.currentKid] = Array.from(set);
  }
  
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
  
  function addText(ul, text, cat) {
    const tierId = ul.id.match(/^tier(\d+)/)[1];
    if (!data[tierId]) data[tierId] = {};
    if (!data[tierId][cat]) data[tierId][cat] = [];
    data[tierId][cat].push(text);
    ul.appendChild(item(text, cat));
  }
  
  function replaceText(oldText, newText, cat) {
    CONFIG.TIER_CONFIG.forEach(tier => {
      const tierData = data[tier.id];
      if (tierData && tierData[cat]) {
        const idx = tierData[cat].indexOf(oldText);
        if (idx !== -1) tierData[cat][idx] = newText;
      }
    });
  }
  
  function renameMastered(oldText, newText) {
    const m = getMasteredSet();
    if (m.has(oldText)) {
      m.delete(oldText);
      m.add(newText);
      saveMastered(m);
    }
  }
  
  function buildBoardWithUserData() {
    try {
      buildBoard();
    } catch (error) {
      handleError(error, 'Failed to build board');
    }
  }