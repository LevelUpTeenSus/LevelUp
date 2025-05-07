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
      notifications: document.getElementById('notifications'),
      loginModal: document.getElementById('loginModal'),
      emailInput: document.getElementById('emailInput'),
      passwordInput: document.getElementById('passwordInput'),
      loginBtn: document.getElementById('loginBtn'),
      registerBtn: document.getElementById('registerBtn'),
      googleBtn: document.getElementById('googleBtn'),
      userEmail: document.getElementById('userEmail'),
      logoutBtn: document.getElementById('logoutBtn'),
      kidBar: document.getElementById('kidBar')
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
  
  export async function initializeChildApp() {
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
  
      // Style login modal
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
  
      elements.board.classList.add('board');
      resetUIElements(elements);
  
      const {
        board, notifications, loginModal, emailInput, passwordInput,
        loginBtn, registerBtn, googleBtn, userEmail, logoutBtn, kidBar
      } = elements;
  
      // Update isMobile on viewport changes
      const mediaQuery = window.matchMedia('(max-width: 768px)');
      mediaQuery.addEventListener('change', (e) => {
        isMobile = e.matches;
        if (userRole === 'child') {
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
              await setDoc(roleRef, { role: 'child' });
              roleSnap = await getDoc(roleRef);
            }
            userRole = roleSnap.data().role;
            if (!['parent', 'child'].includes(userRole)) {
              throw new Error(`Invalid role: ${userRole}`);
            }
            if (login Clements) loginModal.style.display = 'none';
            if (elements.userEmail) elements.userEmail.textContent = user.email;
  
            if (userRole === 'child') {
              await initChildDashboard(user.uid, elements);
              buildBoardChild(elements);
            } else {
              showNotification('Access restricted to child accounts', 'error');
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
          const inviteCode = document.getElementById('inviteInput')?.value.trim().toUpperCase();
          if (!email || !password) return showNotification('Email and password are required', 'error');
          try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const uid = userCredential.user.uid;
            const invData = await promptForInviteCode(inviteCode);
            if (!invData) return;
            const { parentUid, kidName } = invData;
            await setDoc(doc(db, CONFIG.COLLECTIONS.ROLES, uid), { role: 'child' });
            await setDoc(doc(db, CONFIG.COLLECTIONS.USERS, uid), { parentUid }, { merge: true });
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
              const invData = await promptForInviteCode();
              if (!invData) return;
              const { parentUid } = invData;
              await setDoc(roleRef, { role: 'child' });
              await setDoc(doc(db, CONFIG.COLLECTIONS.USERS, user.uid), { parentUid }, { merge: true });
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
            await signOut(auth);
            showNotification('Logged out successfully', 'success');
          } catch (err) {
            handleError(err, 'Failed to log out');
          }
        };
      }
    });
  }
  
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
      if (elements.kidBar) {
        elements.kidBar.style.display = 'flex';
        initKidBar(elements);
      }
      loadChildStreak(userId, elements);
    } catch (e) {
      handleError(e, 'Failed to initialize child dashboard');
    }
  }
  
  async function promptForInviteCode(code = null) {
    if (code) {
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
  
  function initKidBar(elements) {
    const { kidBar } = elements;
    if (kidBar) {
      kidBar.innerHTML = `<h2>${store.currentKid}'s Dashboard</h2>`;
    }
  }
  
  function buildBoardChild(elements) {
    const { board, kidBar } = elements || getElements();
    if (!board) {
      console.error('Board element missing');
      return;
    }
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
    if (!data || !store) {
      contentArea.innerHTML = '<p>No data available.</p>';
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
    const levelSection = document.createElement('div');
    levelSection.className = 'level-section';
    levelSection.innerHTML = `
      <h2>Current Level: Tier ${highest}</h2>
      <p>Next: Tier ${next} (${doneCount}/${nextCount} done)</p>
    `;
    topHeader.appendChild(levelSection);
    const streakContainer = document.createElement('div');
    streakContainer.className = 'streak-container';
    topHeader.appendChild(streakContainer);
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
    if (elements.board && userRole === 'child') {
      document.querySelectorAll('.add-btn, .move-btn, button.modify, .undo-btn, .redo-btn').forEach(btn => btn.remove());
      document.querySelectorAll('li span').forEach(span => span.ondblclick = null);
    }
    loadAllResponsibilityStreaks(streakContainer);
  }
  
  function section(lbl, cat, tierId) {
    return `
      <div>
        <div class="list-title">${lbl}</div>
        <ul data-category="${cat}" id="tier${tierId}-${cat.slice(0, 4)}" role="list"></ul>
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
  
  function item(text, category) {
    const li = document.createElement('li');
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
        updateTier(li.closest('.tier'));
        if (userRole === 'child' && cb.checked) {
          recordCompletion(text).catch(err => console.error(err));
        }
      };
      li.appendChild(cb);
      const doneBtn = document.createElement('button');
      doneBtn.className = 'done-btn';
      doneBtn.textContent = 'Done Today';
      doneBtn.setAttribute('aria-label', `Mark ${text} as done for today`);
      doneBtn.onclick = () => markDoneForDay(li, text);
      li.appendChild(doneBtn);
    }
    const span = document.createElement('span');
    span.textContent = text;
    li.appendChild(span);
    li.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
      }
    };
    return li;
  }
  
  function attachEvents() {
    // Minimal events for child view; no drag-and-drop or add buttons
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
  
  async function markDoneForDay(li, text) {
    try {
      const childUid = auth.currentUser.uid;
      const today = new Date();
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const dateKey = `${yyyy}-${mm}-${dd}`;
      const safeResp = text.replace(/\s+/g, '_').replace(/[^\w\-]/g, '');
      const docId = `${childUid}_${safeResp}_${dateKey}`;
      const docRef = doc(db, CONFIG.COLLECTIONS.CHILD_ACTIVITY, docId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        showNotification(`${text} already marked done for today`, 'warning');
        return;
      }
      await setDoc(docRef, { childUid, responsibility: text, date });
      showNotification(`${text} marked as done for today`, 'success');
      loadResponsibilityStreakFor(li, text);
      const streakContainer = document.querySelector('.streak-container');
      if (streakContainer) {
        loadAllResponsibilityStreaks(streakContainer);
      }
    } catch (e) {
      handleError(e, 'Failed to mark as done');
    }
  }
  
  async recordCompletion(text) {
    const childUid = auth.currentUser.uid;
    const today = new Date();
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const dateKey = `${yyyy}-${mm}-${dd}`;
    const safeResp = text.replace(/\s+/g, '_').replace(/[^\w\-]/g, '');
    const docId = `${childUid}_${safeResp}_${dateKey}`;
    await setDoc(
      doc(db, CONFIG.COLLECTIONS.CHILD_ACTIVITY, docId),
      { childUid, responsibility: text, date }
    );
  }
  
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
    return streak;
  }
  
  async function loadAllResponsibilityStreaks(streakContainer) {
    const streaks = [];
    const responsibilities = [];
    CONFIG.TIER_CONFIG.forEach(tier => {
      (data[tier.id]?.responsibilities || []).forEach(text => {
        responsibilities.push(text);
      });
    });
    for (const text of responsibilities) {
      const streak = await loadResponsibilityStreakFor(
        document.querySelector(`li span:not(.streak-badge)[textContent="${text}"]`)?.parentElement,
        text
      );
      streaks.push({ text, streak });
    }
    streakContainer.innerHTML = `
      <h3>Daily Streaks</h3>
      <ul class="streak-list">
        ${streaks.map(s => `<li>${s.text}: ${s.streak} day${s.streak !== 1 ? 's' : ''}</li>`).join('')}
      </ul>
    `;
  }
  
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
      streakEl.textContent = `🔥 Overall Streak: ${streak} day${streak !== 1 ? 's' : ''}`;
      topHeader.appendChild(streakEl);
    } catch (e) {
      handleError(e, 'Failed to load streak');
    }
  }