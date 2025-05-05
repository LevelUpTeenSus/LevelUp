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
  collection,
  getDocs,
  connectFirestoreEmulator,
  setLogLevel
} from 'firebase/firestore';
import { app } from './firebaseConfig.js';

// Initialize Auth & Firestore
const auth = getAuth(app);
const db = getFirestore(app);

// Enable verbose Firestore logging
setLogLevel('debug');

// Connect to emulators if running locally
if (window.location.hostname === 'localhost') {
  connectAuthEmulator(auth, 'http://localhost:9099');
  connectFirestoreEmulator(db, 'localhost', 8080);
}

// Config & Defaults
const TIER_CONFIG = [
  { id: 1, name: 'Self-Care Rookie' },
  { id: 2, name: 'Room Captain' },
  { id: 3, name: 'Household Contributor' },
  { id: 4, name: 'School & Schedule Boss' },
  { id: 5, name: 'Young-Adult Mode' }
];
const DEFAULT_DATA = {
  1: { responsibilities: ['Shower daily', 'Brush teeth 2×', 'Put away shoes/coats'], privileges: ['Allowance', '1h screen time', 'Choose family movie'] },
  2: { responsibilities: ['Keep bedroom tidy', 'Pack own lunch'], privileges: ['Smartphone', 'Decorate room'] },
  3: { responsibilities: ['Take out trash', 'Feed pet'], privileges: ['Video games', 'Friend outings'] },
  4: { responsibilities: ['Maintain GPA B', 'Manage homework'], privileges: ['Laptop', 'Later curfew'] },
  5: { responsibilities: ['Budget money', 'Safe driving'], privileges: ['Car access', 'Flexible curfew'] }
};
const DEFAULT_KID = 'Kid 1';
const MAX_INPUT_LENGTH = 50;
const VALIDATION_REGEX = /^[a-zA-Z0-9\s\-.,&()]+$/;

// State
let store = null;
let data = null;
let actionHistory = [];
let actionHistoryIndex = -1;
let isMobile = window.matchMedia('(max-width: 768px)').matches;

// Update isMobile on viewport changes
const mediaQuery = window.matchMedia('(max-width: 768px)');
mediaQuery.addEventListener('change', (e) => {
  isMobile = e.matches;
  buildBoard();
});

// DOM Refs
const board = document.getElementById('board');
board.classList.add('board');
const kidSelect = document.getElementById('kidSelect');
const addKidBtn = document.getElementById('addKidBtn');
const renameKidBtn = document.getElementById('renameKidBtn');
const deleteKidBtn = document.getElementById('deleteKidBtn');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const fileInput = document.getElementById('fileInput');
const notifications = document.getElementById('notifications');
const modal = document.getElementById('modal');
const editInput = document.getElementById('editInput');
const saveBtn = document.getElementById('saveBtn');
const deleteBtn = document.getElementById('deleteBtn');
const cancelBtn = document.getElementById('cancelBtn');
const loginModal = document.getElementById('loginModal');
const emailInput = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const registerBtn = document.getElementById('registerBtn');
const googleBtn = document.getElementById('googleBtn');
const userEmail = document.getElementById('userEmail');
const logoutBtn = document.getElementById('logoutBtn');
const kidBar = document.getElementById('kidBar');
const todoList = document.getElementById('todo-list');
const masteredList = document.getElementById('mastered-list');

// Authentication
onAuthStateChanged(auth, (user) => {
  if (user) {
    loginModal.style.display = 'none';
    kidBar.style.display = 'flex';
    userEmail.textContent = user.email;
    init(user.uid);
  } else {
    loginModal.style.display = 'flex';
    kidBar.style.display = 'none';
    board.innerHTML = '<h1>Responsibility Ladder</h1><p>Please log in to continue.</p>';
    todoList.innerHTML = '<li>Please log in to see your to-do responsibilities.</li>';
    masteredList.innerHTML = '<li>Please log in to see your mastered responsibilities.</li>';
  }
});

loginBtn.onclick = async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  if (!email || !password) return showNotification('Email and password are required', 'error');
  try {
    await signInWithEmailAndPassword(auth, email, password);
    showNotification('Logged in successfully', 'success');
  } catch (err) {
    showNotification(err.message, 'error');
  }
};

registerBtn.onclick = async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  if (!email || !password) return showNotification('Email and password are required', 'error');
  try {
    await createUserWithEmailAndPassword(auth, email, password);
    showNotification('Registered successfully', 'success');
  } catch (err) {
    showNotification(err.message, 'error');
  }
};

googleBtn.onclick = async () => {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
    showNotification('Signed in with Google', 'success');
  } catch (err) {
    showNotification(err.message, 'error');
  }
};

logoutBtn.onclick = async () => {
  try {
    await signOut(auth);
    showNotification('Logged out successfully', 'success');
  } catch (err) {
    showNotification(err.message, 'error');
  }
};

// Persistence Helpers
async function loadStore(uid) {
  try {
    const userDocRef = doc(db, 'users', uid);
    const docSnap = await getDoc(userDocRef);
    if (docSnap.exists()) {
      store = docSnap.data().store;
      Object.keys(store.profiles).forEach(kid => {
        store.mastered[kid] = Array.isArray(store.mastered[kid]) ? store.mastered[kid] : [];
      });
    } else {
      store = {
        currentKid: DEFAULT_KID,
        profiles: { [DEFAULT_KID]: structuredClone(DEFAULT_DATA) },
        mastered: { [DEFAULT_KID]: [] }
      };
      await setDoc(userDocRef, { store });
    }
    data = store.profiles[store.currentKid];
  } catch (e) {
    console.error('loadStore error:', e);
    showNotification('Failed to load data', 'error');
    store = {
      currentKid: DEFAULT_KID,
      profiles: { [DEFAULT_KID]: structuredClone(DEFAULT_DATA) },
      mastered: { [DEFAULT_KID]: [] }
    };
    data = store.profiles[store.currentKid];
  }
}

async function saveStore(action = null, uid = auth.currentUser?.uid) {
  if (!uid) return;
  if (action) {
    actionHistory = actionHistory.slice(0, actionHistoryIndex + 1);
    actionHistory.push({ action, state: structuredClone(store) });
    actionHistoryIndex++;
    updateUndoRedo();
  }
  try {
    await setDoc(doc(db, 'users', uid), { store }, { merge: true });
  } catch (e) {
    showNotification('Failed to save data', 'error');
  }
}

// Undo/Redo
function undo() {
  if (actionHistoryIndex <= 0) return;
  actionHistoryIndex--;
  store = structuredClone(actionHistory[actionHistoryIndex].state);
  data = store.profiles[store.currentKid];
  saveStore();
  refreshKidSelect();
  kidSelect.value = store.currentKid;
  buildBoard();
  updateUndoRedo();
}

function redo() {
  if (actionHistoryIndex >= actionHistory.length - 1) return;
  actionHistoryIndex++;
  store = structuredClone(actionHistory[actionHistoryIndex].state);
  data = store.profiles[store.currentKid];
  saveStore();
  refreshKidSelect();
  kidSelect.value = store.currentKid;
  buildBoard();
  updateUndoRedo();
}

function updateUndoRedo() {
  undoBtn.disabled = actionHistoryIndex <= 0;
  redoBtn.disabled = actionHistoryIndex >= actionHistory.length - 1;
}

// Notifications
function showNotification(message, type = 'success') {
  const div = document.createElement('div');
  div.className = `notification ${type}`;
  div.textContent = message;
  notifications.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

// Validation
function validateInput(text) {
  if (!text) return 'Input cannot be empty';
  if (text.length > MAX_INPUT_LENGTH) return `Input must be ${MAX_INPUT_LENGTH} characters or less`;
  if (!VALIDATION_REGEX.test(text)) return 'Only letters, numbers, spaces, and basic punctuation allowed';
  return null;
}

function isDuplicate(text, category, tierId) {
  return (data[tierId]?.[category] || []).includes(text);
}

// Kid & File Event Bindings
function initKidBar() {
  refreshKidSelect();
  kidSelect.value = store.currentKid;
  kidSelect.onchange = () => {
    store.currentKid = kidSelect.value;
    data = store.profiles[store.currentKid];
    store.mastered[store.currentKid] = store.mastered[store.currentKid] || [];
    saveStore('changeKid');
    buildBoard();
  };
  addKidBtn.onclick = addKid;
  renameKidBtn.onclick = renameKid;
  deleteKidBtn.onclick = deleteKid;
  undoBtn.onclick = undo;
  redoBtn.onclick = redo;
  exportBtn.onclick = exportJSON;
  importBtn.onclick = () => fileInput.click();
  fileInput.onchange = importJSON;
}

function refreshKidSelect() {
  if (!kidSelect) return;
  kidSelect.innerHTML = '';
  Object.keys(store.profiles).forEach(name => kidSelect.add(new Option(name, name)));
}

function addKid() {
  const name = prompt('Enter new kid name');
  if (!name) return;
  const kid = name.trim();
  const error = validateInput(kid);
  if (error) return showNotification(error, 'error');
  if (store.profiles[kid]) return showNotification('Kid name already exists', 'error');
  store.profiles[kid] = structuredClone(DEFAULT_DATA);
  store.mastered[kid] = [];
  store.currentKid = kid;
  data = store.profiles[kid];
  saveStore('addKid');
  refreshKidSelect();
  kidSelect.value = kid;
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
  kidSelect.value = kid;
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
  kidSelect.value = store.currentKid;
  buildBoard();
}

// Export / Import
function exportJSON() {
  const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'responsibility-ladder.json';
  a.click();
  URL.revokeObjectURL(url);
  showNotification('Export successful', 'success');
}

function importJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  exportBtn.disabled = importBtn.disabled = true;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const obj = JSON.parse(ev.target.result);
      if (obj.profiles && obj.currentKid) {
        obj.mastered = obj.mastered || {};
        Object.keys(obj.profiles).forEach(kid => {
          obj.mastered[kid] = Array.isArray(obj.mastered[kid]) ? obj.mastered[kid] : [];
        });
        store = obj;
        data = store.profiles[store.currentKid];
        store.mastered[store.currentKid] = store.mastered[store.currentKid] || [];
        saveStore('import');
        refreshKidSelect();
        kidSelect.value = store.currentKid;
        buildBoard();
        showNotification('Import successful', 'success');
      } else {
        showNotification('Invalid file format', 'error');
      }
    } catch (err) {
      showNotification('Failed to parse file', 'error');
    }
    fileInput.value = '';
    exportBtn.disabled = importBtn.disabled = false;
  };
  reader.readAsText(file);
}

// User Data and Lists
async function getUserData(userId) {
  try {
    const userDocRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userDocRef);
    return userDoc.exists() ? userDoc.data() : null;
  } catch (error) {
    console.error('Error fetching user data:', error);
    showNotification('Failed to fetch user data', 'error');
    return null;
  }
}

function masteredSet(item, userData) {
  if (!userData || !userData.store?.mastered?.[userData.store.currentKid]) {
    console.warn('Invalid userData or mastered field');
    return false;
  }
  return userData.store.mastered[userData.store.currentKid].includes(item);
}

async function populateListsWithUserData(userData) {
  try {
    let itemsSnapshot = await getDocs(collection(db, 'items'));
    if (itemsSnapshot.empty) {
      const sampleItems = [
        { id: '1', name: 'Brush teeth' },
        { id: '2', name: 'Make bed' },
        { id: '3', name: 'Do homework' }
      ];
      for (const item of sampleItems) {
        await setDoc(doc(db, 'items', item.id), item);
      }
      itemsSnapshot = await getDocs(collection(db, 'items'));
    }
    const lists = { todo: [], mastered: [] };
    itemsSnapshot.forEach((doc) => {
      const itemData = doc.data();
      if (masteredSet(itemData.name, userData)) {
        lists.mastered.push(itemData);
      } else {
        lists.todo.push(itemData);
      }
    });
    const todoListEl = document.getElementById('todo-list');
    const masteredListEl = document.getElementById('mastered-list');
    todoListEl.innerHTML = lists.todo.length
      ? lists.todo.map(item => `<li>${item.name}</li>`).join('')
      : '<li>No to-do responsibilities.</li>';
    masteredListEl.innerHTML = lists.mastered.length
      ? lists.mastered.map(item => `<li>${item.name}</li>`).join('')
      : '<li>No mastered responsibilities.</li>';
  } catch (error) {
    console.error('Error populating lists:', error);
    showNotification('Failed to load lists', 'error');
    const todoListEl = document.getElementById('todo-list');
    const masteredListEl = document.getElementById('mastered-list');
    todoListEl.innerHTML = '<li>Failed to load to-do responsibilities.</li>';
    masteredListEl.innerHTML = '<li>Failed to load mastered responsibilities.</li>';
  }
}

// Board Build
function buildBoard() {
  board.innerHTML = '';
  if (!data) {
    board.innerHTML = '<h1>Responsibility Ladder</h1><p>No data available. Please add some responsibilities or privileges.</p>';
    return;
  }
  const header = document.createElement('h1');
  header.textContent = 'Responsibility Ladder';
  board.appendChild(header);

  // Move kid selection bar into board
  const bar = document.getElementById('kidBar');
  bar.style.order = 0;
  board.appendChild(bar);

  // Current Level display
  const masteredSet = new Set(store.mastered[store.currentKid] || []);
  let highest = 0;
  TIER_CONFIG.forEach(t => {
    const resp = (data[t.id]?.responsibilities || []);
    if (resp.length && resp.every(text => masteredSet.has(text))) highest = t.id;
  });
  const next = Math.min(highest + 1, TIER_CONFIG.length);
  const nextResp = data[next]?.responsibilities || [];
  const nextCount = nextResp.length;
  const doneCount = nextResp.filter(text => masteredSet.has(text)).length;
  const pct = nextCount ? Math.round((doneCount / nextCount) * 100) : 0;
  const levelSection = document.createElement('div');
  levelSection.className = 'level-section';
  levelSection.innerHTML = `
    <h2>Current Level: Tier ${highest}</h2>
    <p>Next: Tier ${next} (${doneCount}/${nextCount} done)</p>
    <div class="progress-bar"><span style="width:${pct}%"></span></div>
  `;
  board.appendChild(levelSection);

  // Build the tier sections
  TIER_CONFIG.forEach(tier => {
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
    board.appendChild(col);
  });

  // Removed: populateLocalLists();
  // Removed: updateMasteredList();
  attachEvents();
  updateAllTiers();

  // Bottom controls
  const controls = document.createElement('div');
  controls.className = 'controls';
  [
    addKidBtn,
    renameKidBtn,
    deleteKidBtn,
    undoBtn,
    redoBtn,
    importBtn,
    exportBtn,
    logoutBtn
  ].forEach(btn => controls.appendChild(btn));
  board.appendChild(controls);
}

// Helpers for building the board
function section(lbl, cat, tierId) {
  return `
    <div>
      <div class="list-title">${lbl}</div>
      <ul data-category="${cat}" id="tier${tierId}-${cat.slice(0, 4)}" role="list"></ul>
      <button class="add-btn" data-category="${cat}" aria-label="Add new ${cat.slice(0, -3)}">+ Add</button>
    </div>`;
}

function populateLocalLists() {
  TIER_CONFIG.forEach(({ id }) => ['responsibilities', 'privileges'].forEach(cat => {
    const ul = document.getElementById(`tier${id}-${cat.slice(0, 4)}`);
    if (!ul) return;
    ul.innerHTML = '';
    (data[id]?.[cat] || []).forEach(txt => ul.appendChild(item(txt, cat)));
  }));
}

// Update the mastered list from the store
function updateMasteredList() {
  const masteredListEl = document.getElementById('mastered-list');
  if (!masteredListEl) return;
  
  const masteredItems = store.mastered[store.currentKid] || [];
  
  if (masteredItems.length === 0) {
    masteredListEl.innerHTML = '<li>No mastered responsibilities yet.</li>';
    return;
  }
  
  masteredListEl.innerHTML = '';
  masteredItems.forEach(text => {
    const li = document.createElement('li');
    li.className = 'mastered-item';
    li.textContent = text;
    
    // Add button to move back to to-do
    const undoBtn = document.createElement('button');
    undoBtn.className = 'undo-mastered-btn';
    undoBtn.textContent = 'Return to To-Do';
    undoBtn.setAttribute('aria-label', `Return ${text} to to-do list`);
    undoBtn.onclick = () => {
      const mastered = getMasteredSet();
      mastered.delete(text);
      saveMastered(mastered);
      saveStore('unmaster');
      updateMasteredList();
      updateAllTiers();
    };
    
    li.appendChild(undoBtn);
    masteredListEl.appendChild(li);
  });
}

// Item Creation & Mastery
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

// Mobile Move
function moveItemMobile(li) {
  const text = li.querySelector('span').textContent;
  const category = li.dataset.category;
  const sourceTier = li.closest('.tier').dataset.tier;
  const tierOptions = TIER_CONFIG.map(t => `Tier ${t.id}: ${t.name}`).join('\n');
  const targetTierName = prompt(`Move "${text}" to which tier?\n${tierOptions}`);
  if (!targetTierName) return;
  const targetTierId = targetTierName.match(/Tier (\d+)/)?.[1];
  if (!targetTierId || !TIER_CONFIG.some(t => t.id == targetTierId)) {
    showNotification('Invalid tier selected', 'error');
    return;
  }
  if (targetTierId === sourceTier) return;
  if (isDuplicate(text, category, targetTierId)) {
    showNotification('Item already exists in target tier', 'error');
    return;
  }
  removeText(text, category, sourceTier);
  addText(document.getElementById(`tier${targetTierId}-${category.slice(0, 4)}`), text, category);
  saveStore('move');
  updateAllTiers();
}

// Modal
let curLi = null;
function editModal(li) {
  curLi = li;
  editInput.value = li.querySelector('span').textContent.trim();
  modal.style.display = 'flex';
  editInput.focus();
}

function closeModal() {
  modal.style.display = 'none';
  curLi = null;
}

saveBtn.onclick = () => {
  if (!curLi) return;
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
  closeModal();
};

deleteBtn.onclick = () => {
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
    closeModal();
  }, { once: true });
};

cancelBtn.onclick = closeModal;
modal.onclick = e => { if (e.target === modal) closeModal(); };
window.onkeydown = e => { if (e.key === 'Escape') closeModal(); };

function renameMastered(oldText, newText) {
  const m = getMasteredSet();
  if (m.has(oldText)) {
    m.delete(oldText);
    m.add(newText);
    saveMastered(m);
  }
}

// Drag & Drop
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
  if (ul.dataset.category !== cat) return;
  const tierId = ul.id.match(/^tier(\d+)/)[1];
  if (isDuplicate(text, cat, tierId)) {
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
  if (txt === null || txt.trim() === '') {
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

// Tier Update
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

// Text Helpers
function removeText(text, cat, sourceTier = null) {
  if (sourceTier) {
    const tierData = data[sourceTier];
    if (tierData && tierData[cat]) {
      tierData[cat] = tierData[cat].filter(item => item !== text);
      if (tierData[cat].length === 0) delete tierData[cat];
    }
  } else {
    TIER_CONFIG.forEach(tier => {
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
  TIER_CONFIG.forEach(tier => {
    const tierData = data[tier.id];
    if (tierData && tierData[cat]) {
      const idx = tierData[cat].indexOf(oldText);
      if (idx !== -1) tierData[cat][idx] = newText;
    }
  });
}

// Initialization
async function init(userId) {
  await loadStore(userId);
  initKidBar();
  await buildBoardWithUserData(userId);
}

async function buildBoardWithUserData(userId) {
  try {
    const userData = await getUserData(userId);
    if (!userData) {
      showNotification('No user data found', 'error');
      return;
    }
    await populateListsWithUserData(userData);
    buildBoard();
  } catch (error) {
    console.error('Error building board with user data:', error);
    showNotification('Failed to build board', 'error');
    buildBoard();
  }
}