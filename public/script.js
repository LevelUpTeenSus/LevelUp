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
  setLogLevel,
  query,
  where,
  orderBy,
  addDoc, // Added for child activity logging
  serverTimestamp, // Added for child activity logging
  enableIndexedDbPersistence // Keep offline persistence
} from 'firebase/firestore';
import { app } from './firebaseConfig.js'; // Assuming firebaseConfig.js initializes Firebase app

// Centralized collection names
const COLLECTIONS = {
  USERS: 'users',
  ROLES: 'userRoles',
  INVITES: 'invitations',
  // ITEMS: 'items', // Removed - Using store object as single source of truth
  CHILD_ACTIVITY: 'childActivity' // For streak calculation
};

// Detect local emulator environment
const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);

// Initialize Auth & Firestore
const auth = getAuth(app);
const db = getFirestore(app);

// Enable offline persistence (attempt only once)
enableIndexedDbPersistence(db)
  .then(() => console.log("Offline persistence enabled"))
  .catch(err => {
      if (err.code == 'failed-precondition') {
          console.warn("Multiple tabs open, offline persistence can only be enabled in one.");
      } else if (err.code == 'unimplemented') {
          console.warn("The current browser does not support all of the features required to enable persistence.");
      } else {
          console.error("Failed to enable offline persistence:", err);
      }
  });

// Enable verbose Firestore logging (optional, for debugging)
setLogLevel('debug');

// Connect to emulators if running locally
if (isLocalhost) {
  console.log("Connecting to local Firebase emulators...");
  try {
      connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
      connectFirestoreEmulator(db, 'localhost', 8080);
      console.log("Connected to emulators.");
  } catch (e) {
      console.error("Error connecting to emulators:", e);
  }
}

// --- Configuration & Defaults ---
const TIER_CONFIG = [
  { id: 1, name: 'Self-Care Rookie' },
  { id: 2, name: 'Room Captain' },
  { id: 3, name: 'Household Contributor' },
  { id: 4, name: 'School & Schedule Boss' },
  { id: 5, name: 'Young-Adult Mode' }
];
// Default structure for a new kid profile
const DEFAULT_DATA = {
  1: { responsibilities: ['Shower daily', 'Brush teeth 2×', 'Put away shoes/coats'], privileges: ['Allowance', '1h screen time', 'Choose family movie'] },
  2: { responsibilities: ['Keep bedroom tidy', 'Pack own lunch'], privileges: ['Smartphone', 'Decorate room'] },
  3: { responsibilities: ['Take out trash', 'Feed pet'], privileges: ['Video games', 'Friend outings'] },
  4: { responsibilities: ['Maintain GPA B', 'Manage homework'], privileges: ['Laptop', 'Later curfew'] },
  5: { responsibilities: ['Budget money', 'Safe driving'], privileges: ['Car access', 'Flexible curfew'] }
};
const DEFAULT_KID = 'Kid 1'; // Default kid name if none exist
const MAX_INPUT_LENGTH = 50; // Max characters for item text
const VALIDATION_REGEX = /^[a-zA-Z0-9\s\-.,&()']+$/; // Allowed characters for item text

// --- State Variables ---
let store = null; // Holds the entire user data structure (profiles, mastered items)
let data = null; // Convenience reference to the current kid's profile data (store.profiles[store.currentKid])
let actionHistory = []; // For undo/redo functionality
let actionHistoryIndex = -1; // Current position in the action history
let isMobile = window.matchMedia('(max-width: 768px)').matches; // Check for mobile viewport
let userRole = null; // User role: 'parent' or 'child'
let currentUid = null; // Store the current user's UID

// --- DOM References (Declared after DOMContentLoaded) ---
let board, kidSelect, addKidBtn, renameKidBtn, deleteKidBtn, undoBtn, redoBtn, exportBtn, importBtn, fileInput, notifications, modal, editInput, saveBtn, deleteBtn, cancelBtn, loginModal, emailInput, passwordInput, loginBtn, registerBtn, googleBtn, userEmail, logoutBtn, inviteBtn, kidBar, masteredList;

// --- Utility Functions ---

// Update isMobile on viewport changes and rebuild board for responsiveness
const mediaQuery = window.matchMedia('(max-width: 768px)');
mediaQuery.addEventListener('change', (e) => {
  isMobile = e.matches;
  // Rebuild board only if user is logged in and data exists
  if (auth.currentUser && store) {
      buildBoard(); // Rebuild to adjust UI elements (like drag-drop vs move button)
  }
});

// Display temporary notifications
function showNotification(message, type = 'success') {
  if (!notifications) return; // Ensure notifications element exists
  const div = document.createElement('div');
  div.className = `notification ${type}`; // Apply styling based on type (success/error)
  div.textContent = message;
  notifications.appendChild(div);
  // Automatically remove the notification after 3 seconds
  setTimeout(() => div.remove(), 3000);
}

// Centralized error handler
function handleError(err, userMessage = 'An error occurred') {
  console.error(`Error: ${userMessage}`, err); // Log detailed error to console
  showNotification(userMessage, 'error'); // Show user-friendly message
}

// Validate item text input
function validateInput(text) {
  if (!text) return 'Input cannot be empty';
  if (text.length > MAX_INPUT_LENGTH) return `Input must be ${MAX_INPUT_LENGTH} characters or less`;
  if (!VALIDATION_REGEX.test(text)) return 'Input contains invalid characters. Only letters, numbers, spaces, and -.,&()\' allowed';
  return null; // No error
}

// Check if an item already exists in a specific category and tier for the current kid
function isDuplicate(text, category, tierId) {
  // Ensure data structure exists before checking
  return data?.[tierId]?.[category]?.includes(text) ?? false;
}

// Get the Set of mastered responsibilities for the current kid
function getMasteredSet() {
  // Ensure the mastered structure exists for the current kid
  store.mastered = store.mastered || {};
  store.mastered[store.currentKid] = store.mastered[store.currentKid] || [];
  // Return a Set for efficient add/delete/has operations
  return new Set(store.mastered[store.currentKid]);
}

// Save the Set of mastered responsibilities back to the store array
function saveMastered(masteredSet) {
  if (store && store.currentKid) {
      store.mastered[store.currentKid] = Array.from(masteredSet);
  }
}

// --- Firestore Persistence ---

// Load user data (store) from Firestore or create default if none exists
async function loadStore(uid) {
  console.log(`loadStore: Attempting to load data for UID: ${uid}`);
  const userDocRef = doc(db, COLLECTIONS.USERS, uid);
  try {
      const docSnap = await getDoc(userDocRef);
      console.log('loadStore: Fetched user document', { exists: docSnap.exists() });
      if (docSnap.exists()) {
          store = docSnap.data().store;
          // Ensure 'mastered' structure is valid
          store.mastered = store.mastered || {};
          store.profiles = store.profiles || {};
          // Ensure each profile has a mastered array
          Object.keys(store.profiles).forEach(kid => {
              store.mastered[kid] = Array.isArray(store.mastered[kid]) ? store.mastered[kid] : [];
          });
          // Ensure currentKid is valid or reset
          if (!store.profiles[store.currentKid]) {
              store.currentKid = Object.keys(store.profiles)[0] || DEFAULT_KID;
               // If still no kid, create default
              if (!store.profiles[store.currentKid]) {
                   console.log("loadStore: No valid kid profile found, creating default.");
                   store.profiles[DEFAULT_KID] = structuredClone(DEFAULT_DATA);
                   store.mastered[DEFAULT_KID] = [];
                   store.currentKid = DEFAULT_KID;
                   await setDoc(userDocRef, { store }); // Save the newly created default
              }
          }
      } else {
          console.log("loadStore: No existing document, creating default store.");
          // Create default store structure for a new user
          store = {
              currentKid: DEFAULT_KID,
              profiles: { [DEFAULT_KID]: structuredClone(DEFAULT_DATA) },
              mastered: { [DEFAULT_KID]: [] }
          };
          await setDoc(userDocRef, { store }); // Save the new store to Firestore
          console.log("loadStore: Default store saved.");
      }
      // Set the convenience 'data' variable
      data = store.profiles[store.currentKid];
      console.log("loadStore: Store loaded successfully. Current kid:", store.currentKid);
  } catch (e) {
      handleError(e, 'Failed to load data from Firestore');
      // Fallback to in-memory default if loading fails critically
      store = {
          currentKid: DEFAULT_KID,
          profiles: { [DEFAULT_KID]: structuredClone(DEFAULT_DATA) },
          mastered: { [DEFAULT_KID]: [] }
      };
      data = store.profiles[store.currentKid];
  }
}


// Save the entire store object to Firestore
async function saveStore(actionType = null, uid = currentUid) {
  if (!uid || !store) {
      console.warn("saveStore: Cannot save, UID or store is missing.", { uid, store });
      return;
  }
  console.log(`saveStore: Saving data for UID: ${uid}`, { actionType, store: { ...store } }); // Log a clone

  // Add current state to history for undo/redo if an action type is provided
  if (actionType) {
      // Discard redo history if a new action is performed
      actionHistory = actionHistory.slice(0, actionHistoryIndex + 1);
      // Push a deep clone of the state
      actionHistory.push({ action: actionType, state: structuredClone(store) });
      actionHistoryIndex++;
      updateUndoRedoButtons(); // Update button states
  }

  try {
      // Use setDoc with merge: true to avoid overwriting unrelated fields if any exist
      await setDoc(doc(db, COLLECTIONS.USERS, uid), { store }, { merge: true });
      console.log("saveStore: Data saved successfully.");
  } catch (e) {
      handleError(e, 'Failed to save data to Firestore');
  }
}

// --- Undo/Redo Functionality ---

function undo() {
  if (actionHistoryIndex <= 0) return; // Cannot undo initial state
  actionHistoryIndex--;
  // Restore state from history (use a clone to prevent modification issues)
  store = structuredClone(actionHistory[actionHistoryIndex].state);
  data = store.profiles[store.currentKid]; // Update data reference
  console.log("Undo: Restored state from index", actionHistoryIndex);
  // Save the restored state back to Firestore (without adding to history)
  saveStore(); // Pass no actionType
  // Refresh UI
  refreshKidSelect();
  kidSelect.value = store.currentKid; // Ensure dropdown reflects the state
  buildBoard();
  updateUndoRedoButtons();
}

function redo() {
  if (actionHistoryIndex >= actionHistory.length - 1) return; // Cannot redo beyond last action
  actionHistoryIndex++;
  // Restore state from history
  store = structuredClone(actionHistory[actionHistoryIndex].state);
  data = store.profiles[store.currentKid]; // Update data reference
  console.log("Redo: Restored state from index", actionHistoryIndex);
  // Save the restored state back to Firestore
  saveStore(); // Pass no actionType
  // Refresh UI
  refreshKidSelect();
  kidSelect.value = store.currentKid;
  buildBoard();
  updateUndoRedoButtons();
}

// Enable/disable undo/redo buttons based on history index
function updateUndoRedoButtons() {
  if (!undoBtn || !redoBtn) return;
  undoBtn.disabled = actionHistoryIndex <= 0;
  redoBtn.disabled = actionHistoryIndex >= actionHistory.length - 1;
}

// --- Kid Profile Management ---

// Refresh the kid selection dropdown
function refreshKidSelect() {
  if (!kidSelect || !store || !store.profiles) return;
  const currentVal = kidSelect.value; // Store current selection
  kidSelect.innerHTML = ''; // Clear existing options
  Object.keys(store.profiles).forEach(name => {
      kidSelect.add(new Option(name, name)); // Add each kid as an option
  });
  // Try to restore previous selection or set to currentKid
  kidSelect.value = Object.keys(store.profiles).includes(currentVal) ? currentVal : store.currentKid;
}

// Add a new kid profile
function addKid() {
  const name = prompt('Enter name for the new kid profile:');
  if (!name) return; // User cancelled
  const kid = name.trim();
  const error = validateInput(kid); // Validate name
  if (error) return showNotification(error, 'error');
  if (store.profiles[kid]) return showNotification('Kid name already exists', 'error');

  // Add new profile with default data and empty mastered list
  store.profiles[kid] = structuredClone(DEFAULT_DATA);
  store.mastered[kid] = [];
  store.currentKid = kid; // Switch to the new kid
  data = store.profiles[kid]; // Update data reference

  saveStore('addKid'); // Save changes with history tracking
  refreshKidSelect(); // Update dropdown
  kidSelect.value = kid; // Select the new kid in dropdown
  buildBoard(); // Rebuild the board for the new kid
  showNotification(`Profile for ${kid} added`, 'success');
}

// Rename the current kid profile
function renameKid() {
  const currentKidName = store.currentKid;
  const newName = prompt('Enter new name for this profile:', currentKidName);
  if (!newName) return; // User cancelled
  const newKid = newName.trim();
  const error = validateInput(newKid); // Validate name
  if (error) return showNotification(error, 'error');
  if (newKid === currentKidName) return; // No change
  if (store.profiles[newKid]) return showNotification('Kid name already exists', 'error');

  // Copy data and mastered list to new name, then delete old entry
  store.profiles[newKid] = store.profiles[currentKidName];
  store.mastered[newKid] = store.mastered[currentKidName] || []; // Ensure mastered exists
  delete store.profiles[currentKidName];
  delete store.mastered[currentKidName];
  store.currentKid = newKid; // Update current kid
  data = store.profiles[newKid]; // Update data reference

  saveStore('renameKid'); // Save changes
  refreshKidSelect(); // Update dropdown
  kidSelect.value = newKid; // Select renamed kid
  buildBoard(); // Rebuild board
  showNotification(`Profile renamed to ${newKid}`, 'success');
}

// Delete the current kid profile
function deleteKid() {
  if (Object.keys(store.profiles).length <= 1) {
      return showNotification('Cannot delete the only profile', 'error');
  }
  const kidToDelete = store.currentKid;
  if (!confirm(`Are you sure you want to delete the profile for ${kidToDelete}? This cannot be undone.`)) {
      return;
  }

  // Delete profile and mastered list
  delete store.profiles[kidToDelete];
  delete store.mastered[kidToDelete];

  // Switch to the first remaining profile
  store.currentKid = Object.keys(store.profiles)[0];
  data = store.profiles[store.currentKid];
  // Ensure mastered exists for the new current kid (should already, but safety check)
  store.mastered[store.currentKid] = store.mastered[store.currentKid] || [];

  saveStore('deleteKid'); // Save changes
  refreshKidSelect(); // Update dropdown
  kidSelect.value = store.currentKid; // Select the new current kid
  buildBoard(); // Rebuild board
  showNotification(`Profile for ${kidToDelete} deleted`, 'success');
}

// --- Export / Import ---

function exportJSON() {
  if (!store) return showNotification('No data to export', 'error');
  try {
      const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `levelup-data-${store.currentKid}-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a); // Required for Firefox
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showNotification('Data exported successfully', 'success');
  } catch (e) {
      handleError(e, 'Failed to export data');
  }
}

function importJSON(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Disable buttons during import
  exportBtn.disabled = true;
  importBtn.disabled = true;

  const reader = new FileReader();
  reader.onload = (e) => {
      try {
          const importedObj = JSON.parse(e.target.result);

          // Basic validation of the imported structure
          if (importedObj && importedObj.profiles && importedObj.currentKid && importedObj.mastered) {
              // More thorough validation could be added here (e.g., check data types)

              // Ensure mastered arrays exist for all imported profiles
              Object.keys(importedObj.profiles).forEach(kid => {
                  importedObj.mastered[kid] = Array.isArray(importedObj.mastered[kid]) ? importedObj.mastered[kid] : [];
              });

              store = importedObj; // Replace current store with imported data
              // Ensure the currentKid from the file exists, otherwise fallback
              if (!store.profiles[store.currentKid]) {
                  store.currentKid = Object.keys(store.profiles)[0];
                   if (!store.currentKid) { // Handle case of empty profiles object
                       throw new Error("Imported data has no kid profiles.");
                   }
              }
              data = store.profiles[store.currentKid]; // Update data reference

              // Clear existing action history after import
              actionHistory = [];
              actionHistoryIndex = -1;

              saveStore('import'); // Save imported data, add 'import' to history
              refreshKidSelect();
              kidSelect.value = store.currentKid;
              buildBoard();
              updateUndoRedoButtons(); // Reset undo/redo state
              showNotification('Data imported successfully', 'success');
          } else {
              showNotification('Invalid file format. Required fields: profiles, currentKid, mastered', 'error');
          }
      } catch (err) {
          handleError(err, 'Failed to parse or validate import file');
      } finally {
          // Clear the file input and re-enable buttons regardless of success/failure
          fileInput.value = '';
          exportBtn.disabled = false;
          importBtn.disabled = false;
      }
  };
  reader.onerror = () => {
      showNotification('Failed to read file', 'error');
      fileInput.value = '';
      exportBtn.disabled = false;
      importBtn.disabled = false;
  };
  reader.readAsText(file);
}


// --- Board Building & UI ---

// Build the main responsibility/privilege board
function buildBoard() {
  if (!board || !store || !data) {
      console.warn("buildBoard: Cannot build, missing elements or data.", { board, store, data });
      if (board) board.innerHTML = '<h1>LevelUp</h1><p>Loading data or please log in...</p>';
      return;
  }
  board.innerHTML = ''; // Clear previous content

  // --- Top Header Section ---
  const topHeader = document.createElement('div');
  topHeader.className = 'top-header bg-gray-100 p-4 rounded-lg shadow mb-6'; // Added styling

  const header = document.createElement('h1');
  header.textContent = 'LevelUp Ladder';
  header.className = 'text-3xl font-bold text-indigo-700 mb-2';
  topHeader.appendChild(header);

  // Display selected child's name
  const childNameHeader = document.createElement('h2');
  childNameHeader.className = 'child-name text-xl font-semibold text-gray-800 mb-4';
  childNameHeader.textContent = `Profile: ${store.currentKid}`;
  topHeader.appendChild(childNameHeader);

  // --- Current Level Display ---
  const masteredItemsSet = getMasteredSet(); // Use the Set for efficient checks
  let highestCompletedTier = 0;
  // Determine the highest tier where all responsibilities are mastered
  TIER_CONFIG.forEach(tier => {
      const responsibilities = data[tier.id]?.responsibilities || [];
      if (responsibilities.length > 0 && responsibilities.every(text => masteredItemsSet.has(text))) {
          highestCompletedTier = tier.id;
      }
  });

  // Calculate progress towards the next tier
  const nextTierId = Math.min(highestCompletedTier + 1, TIER_CONFIG.length);
  const nextTierData = data[nextTierId];
  const nextTierResponsibilities = nextTierData?.responsibilities || [];
  const nextTierTotal = nextTierResponsibilities.length;
  const nextTierDone = nextTierResponsibilities.filter(text => masteredItemsSet.has(text)).length;
  const nextTierProgressPct = nextTierTotal > 0 ? Math.round((nextTierDone / nextTierTotal) * 100) : (highestCompletedTier === TIER_CONFIG.length ? 100 : 0); // Show 100% if max tier completed

  const levelSection = document.createElement('div');
  levelSection.className = 'level-section mt-2 p-3 bg-white rounded shadow-sm'; // Added styling
  levelSection.innerHTML = `
      <h3 class="font-semibold text-lg text-gray-700">Current Level: Tier ${highestCompletedTier}</h3>
      <p class="text-sm text-gray-600">Next: Tier ${nextTierId} (${nextTierDone}/${nextTierTotal} responsibilities mastered)</p>
      <div class="w-full bg-gray-200 rounded-full h-2.5 mt-2">
          <div class="bg-blue-600 h-2.5 rounded-full" style="width: ${nextTierProgressPct}%"></div>
      </div>
  `;
  topHeader.appendChild(levelSection);

  // Append Top Header to Board
  board.appendChild(topHeader);

  // --- Tiers Container ---
  const tiersContainer = document.createElement('div');
  // Responsive grid layout
  tiersContainer.className = 'tiers-container grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4';
  board.appendChild(tiersContainer);

  // --- Build Each Tier Section ---
  TIER_CONFIG.forEach(tier => {
      const tierElement = document.createElement('div');
      tierElement.className = 'tier bg-white p-4 rounded-lg shadow border border-gray-200 flex flex-col'; // Added styling
      tierElement.dataset.tier = tier.id; // Store tier ID for reference
      tierElement.tabIndex = 0; // Make focusable

      // Tier Header
      const tierHeader = document.createElement('div');
      tierHeader.className = 'tier-header mb-3 pb-2 border-b border-gray-300';
      tierHeader.innerHTML = `<h2 class="text-xl font-semibold text-indigo-600">Tier ${tier.id}: ${tier.name}</h2>`;
      tierElement.appendChild(tierHeader);

      // Progress Bar (for responsibilities within this tier)
      const progressBarContainer = document.createElement('div');
      progressBarContainer.className = 'progress-bar w-full bg-gray-200 rounded-full h-1.5 mb-4';
      progressBarContainer.innerHTML = `<div class="bg-green-500 h-1.5 rounded-full" style="width: 0%"></div>`; // Inner span for progress
      tierElement.appendChild(progressBarContainer);

      // Lists Container (Responsibilities & Privileges)
      const listsContainer = document.createElement('div');
      listsContainer.className = 'lists flex-grow grid grid-cols-1 sm:grid-cols-2 gap-4'; // Use grid for side-by-side lists

      // Generate HTML for Responsibilities and Privileges sections
      listsContainer.innerHTML = `
          ${createListSectionHTML('Responsibilities', 'responsibilities', tier.id)}
          ${createListSectionHTML('Privileges', 'privileges', tier.id)}
      `;
      tierElement.appendChild(listsContainer);

      // Append the complete tier element to the container
      tiersContainer.appendChild(tierElement);
  });

  // Populate the lists within each tier with items from the 'data' object
  populateTierLists();

  // Attach event listeners (drag/drop, buttons, checkboxes)
  attachBoardEvents();

  // Update visual state (progress bars, 'complete' class) for all tiers
  updateAllTierVisuals();

  // Update the separate "Mastered" list display
  updateMasteredListDisplay();

  // --- Bottom Controls Section ---
  // (This section might be better placed outside the main 'board' div in HTML for layout)
  // Assuming kidBar, userEmail etc. are handled by initParentDashboard/initChildDashboard visibility toggles
}


// Helper to create HTML structure for a list section (Responsibilities/Privileges)
function createListSectionHTML(label, category, tierId) {
  const catSlug = category.slice(0, 4); // Short identifier (resp/priv)
  return `
      <div class="list-section flex flex-col">
          <div class="list-title font-medium text-gray-700 mb-2">${label}</div>
          <ul data-category="${category}" id="tier${tierId}-${catSlug}" role="list" class="list-disc list-inside space-y-1 text-sm text-gray-600 mb-3 flex-grow min-h-[50px] bg-gray-50 p-2 rounded border border-dashed border-gray-300">
              </ul>
           ${userRole === 'parent' ? // Only show Add button for parents
              `<button class="add-btn mt-auto bg-indigo-500 hover:bg-indigo-600 text-white text-xs px-2 py-1 rounded shadow transition duration-150 ease-in-out self-start" data-category="${category}" data-tier="${tierId}" aria-label="Add new ${category.slice(0, -1)}">+ Add ${category.slice(0, -1)}</button>`
              : '' // No button for children
          }
      </div>`;
}

// Populate the UL elements within each tier based on the 'data' object
function populateTierLists() {
  TIER_CONFIG.forEach(({ id: tierId }) => {
      ['responsibilities', 'privileges'].forEach(category => {
          const catSlug = category.slice(0, 4);
          const ul = document.getElementById(`tier${tierId}-${catSlug}`);
          if (!ul) return; // Skip if element not found

          ul.innerHTML = ''; // Clear previous items
          const items = data?.[tierId]?.[category] || []; // Get items or empty array

          if (items.length === 0) {
              ul.innerHTML = `<li class="text-gray-400 italic text-xs">No ${category} added yet.</li>`; // Placeholder
          } else {
              items.forEach(text => {
                  ul.appendChild(createItemElement(text, category, tierId)); // Create and append LI element
              });
          }
      });
  });
}

// Update the separate display area for mastered responsibilities
function updateMasteredListDisplay() {
  if (!masteredList) return; // Ensure the element exists

  const masteredItems = store.mastered[store.currentKid] || [];

  masteredList.innerHTML = ''; // Clear previous content

  if (masteredItems.length === 0) {
      masteredList.innerHTML = '<li class="text-gray-500 italic">No responsibilities mastered yet.</li>';
      return;
  }

  masteredItems.forEach(text => {
      const li = document.createElement('li');
      li.className = 'mastered-item flex justify-between items-center py-1 px-2 rounded bg-green-100 border border-green-300 mb-1'; // Added styling
      li.textContent = text;

      // Add a button to un-master (move back to to-do) - only for parents? Or always?
      // Let's allow anyone to un-master for now, simplifies logic.
      const undoMasteredBtn = document.createElement('button');
      undoMasteredBtn.className = 'undo-mastered-btn text-xs text-blue-600 hover:text-blue-800 ml-2';
      undoMasteredBtn.textContent = 'Undo';
      undoMasteredBtn.setAttribute('aria-label', `Mark ${text} as not mastered`);
      undoMasteredBtn.onclick = () => {
          const currentMasteredSet = getMasteredSet();
          if (currentMasteredSet.has(text)) {
              currentMasteredSet.delete(text); // Remove from set
              saveMastered(currentMasteredSet); // Save updated set back to store array
              saveStore('unmaster'); // Save to Firestore with history
              updateMasteredListDisplay(); // Refresh this list
              updateAllTierVisuals(); // Update checkboxes and progress bars on the main board
              showNotification(`"${text}" marked as not mastered.`, 'success');
          }
      };

      li.appendChild(undoMasteredBtn);
      masteredList.appendChild(li);
  });
}


// --- Item Creation & Interaction ---

// Create LI element for an item (responsibility or privilege)
function createItemElement(text, category, tierId) {
  const li = document.createElement('li');
  li.dataset.category = category;
  li.dataset.tier = tierId; // Store tier info
  li.dataset.text = text; // Store original text for reference
  li.className = 'item-element flex items-center group p-1 rounded hover:bg-gray-100'; // Base styling
  li.tabIndex = 0; // Make focusable

  const isMastered = getMasteredSet().has(text); // Check if mastered

  // --- Checkbox (for Responsibilities only) ---
  if (category === 'responsibilities') {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = isMastered;
      checkbox.className = 'mr-2 h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded';
      checkbox.id = `cb-${tierId}-${text.replace(/\s+/g, '-')}`; // Create a unique ID
      checkbox.setAttribute('aria-label', `Mark ${text} as ${isMastered ? 'not mastered' : 'mastered'}`);
      checkbox.disabled = userRole === 'child'; // Children can check/uncheck

      // --- Checkbox Change Handler ---
      checkbox.onchange = async () => { // Make async for Firestore write
          const currentMasteredSet = getMasteredSet();
          const itemText = li.dataset.text; // Get text from dataset

          li.classList.toggle('mastered', checkbox.checked); // Update visual style
          checkbox.setAttribute('aria-label', `Mark ${itemText} as ${checkbox.checked ? 'not mastered' : 'mastered'}`);

          if (checkbox.checked) {
              currentMasteredSet.add(itemText); // Add to set
              showNotification(`"${itemText}" mastered!`, 'success');

              // --- Log Child Activity ---
              if (userRole === 'child' && currentUid) {
                  try {
                      console.log(`Logging activity for child ${currentUid}: ${itemText}`);
                      await addDoc(collection(db, COLLECTIONS.CHILD_ACTIVITY), {
                          childUid: currentUid,
                          responsibility: itemText,
                          tier: parseInt(tierId, 10), // Store tier number
                          date: serverTimestamp() // Use server timestamp for accuracy
                      });
                      console.log("Child activity logged.");
                  } catch (err) {
                      handleError(err, 'Failed to log completion activity');
                      // Optional: Revert checkbox state if logging fails?
                      // checkbox.checked = false;
                      // currentMasteredSet.delete(itemText);
                      // li.classList.remove('mastered');
                      // return; // Stop further processing if logging fails
                  }
              }
          } else {
              currentMasteredSet.delete(itemText); // Remove from set
              showNotification(`"${itemText}" marked as not mastered.`, 'info');
              // No need to log un-mastering for streaks
          }

          saveMastered(currentMasteredSet); // Save set back to store array
          // Await saveStore if logging happened, otherwise fire-and-forget is okay
          await saveStore('masterToggle'); // Save to Firestore with history
          updateMasteredListDisplay(); // Refresh the separate mastered list
          updateTierVisuals(li.closest('.tier')); // Update progress bar for the specific tier
      };
      li.appendChild(checkbox);
      li.classList.toggle('mastered', isMastered); // Apply initial style
  }

  // --- Item Text ---
  const span = document.createElement('span');
  span.textContent = text;
  span.className = 'item-text flex-grow cursor-pointer'; // Allow clicking/dblclicking
  // Allow editing only for parents
  if (userRole === 'parent') {
      span.ondblclick = () => openEditModal(li); // Double-click to edit
  }
  li.appendChild(span);

  // --- Action Buttons (Edit/Delete/Move - for Parent role) ---
  if (userRole === 'parent') {
      const btnContainer = document.createElement('div');
      btnContainer.className = 'item-actions ml-auto pl-2 space-x-1 opacity-0 group-hover:opacity-100 transition-opacity'; // Show on hover

      // Edit Button
      const editBtn = document.createElement('button');
      editBtn.innerHTML = '✏️'; // Pencil emoji
      editBtn.className = 'text-xs hover:text-blue-600';
      editBtn.setAttribute('aria-label', `Edit ${text}`);
      editBtn.onclick = () => openEditModal(li);
      btnContainer.appendChild(editBtn);

      // Delete Button
      const deleteItemBtn = document.createElement('button');
      deleteItemBtn.innerHTML = '🗑️'; // Trash emoji
      deleteItemBtn.className = 'text-xs hover:text-red-600';
      deleteItemBtn.setAttribute('aria-label', `Delete ${text}`);
      deleteItemBtn.onclick = () => deleteItem(li);
      btnContainer.appendChild(deleteItemBtn);

      // Move Button (for mobile or alternative) - Simplified: Using drag/drop primarily
      // if (isMobile) { // Or always show a move button?
      //     const moveBtn = document.createElement('button');
      //     moveBtn.textContent = '☰'; // Move icon
      //     moveBtn.className = 'move-btn text-xs hover:text-green-600';
      //     moveBtn.setAttribute('aria-label', `Move ${text}`);
      //     moveBtn.onclick = () => moveItemMobile(li);
      //     btnContainer.appendChild(moveBtn);
      // }

      li.appendChild(btnContainer);

      // --- Drag and Drop (for Parent role, non-mobile) ---
      if (!isMobile) {
          li.draggable = true;
          li.ondragstart = (e) => {
              li.classList.add('dragging', 'opacity-50');
              e.dataTransfer.effectAllowed = 'move';
              // Set data to transfer: text, category, source tier
              e.dataTransfer.setData('text/plain', text);
              e.dataTransfer.setData('application/json', JSON.stringify({
                  category: category,
                  sourceTier: tierId
              }));
          };
          li.ondragend = () => {
              li.classList.remove('dragging', 'opacity-50');
          };
      }
  } // End if (userRole === 'parent')

  // Allow editing via Enter key for parents
  if (userRole === 'parent') {
      li.onkeydown = (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openEditModal(li);
          }
      };
  }

  return li;
}


// --- Item Manipulation Logic ---

// Add a new item via the '+' button
function addNewItem(button) {
  const category = button.dataset.category;
  const tierId = button.dataset.tier;
  const listElement = document.getElementById(`tier${tierId}-${category.slice(0, 4)}`);

  if (!listElement) return; // Should not happen

  const text = prompt(`Enter new ${category.slice(0, -1)} for Tier ${tierId}:`);
  if (!text) return; // User cancelled

  const trimmedText = text.trim();
  const error = validateInput(trimmedText);
  if (error) return showNotification(error, 'error');
  if (isDuplicate(trimmedText, category, tierId)) {
      return showNotification(`"${trimmedText}" already exists in ${category} for this tier.`, 'error');
  }

  // Add to the data structure
  data[tierId] = data[tierId] || {}; // Ensure tier object exists
  data[tierId][category] = data[tierId][category] || []; // Ensure category array exists
  data[tierId][category].push(trimmedText);

  // Add to the UI
  const newItemElement = createItemElement(trimmedText, category, tierId);
  // Remove placeholder if it exists
  const placeholder = listElement.querySelector('.text-gray-400');
  if (placeholder) placeholder.remove();
  listElement.appendChild(newItemElement);

  saveStore('addItem'); // Save changes with history
  updateTierVisuals(listElement.closest('.tier')); // Update progress bar
  showNotification(`Added "${trimmedText}"`, 'success');
}

// Delete an item
function deleteItem(li) {
  const text = li.dataset.text;
  const category = li.dataset.category;
  const tierId = li.dataset.tier;
  const tierElement = li.closest('.tier');
  const listElement = li.parentElement;

  if (!confirm(`Are you sure you want to delete "${text}"?`)) return;

  // Remove from data structure
  if (data?.[tierId]?.[category]) {
      data[tierId][category] = data[tierId][category].filter(item => item !== text);
      // Optional: Clean up empty arrays/objects
      if (data[tierId][category].length === 0) {
          delete data[tierId][category];
          if (Object.keys(data[tierId]).length === 0) {
              // delete data[tierId]; // Keep tier structure even if empty? Decide based on preference.
          }
      }
  }

  // Remove from mastered set if present
  const currentMasteredSet = getMasteredSet();
  if (currentMasteredSet.has(text)) {
      currentMasteredSet.delete(text);
      saveMastered(currentMasteredSet);
      updateMasteredListDisplay(); // Update the separate list
  }

  // Remove from UI with animation
  li.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
  li.style.opacity = '0';
  li.style.transform = 'translateX(-20px)';
  li.addEventListener('transitionend', () => {
      li.remove();
      // Add placeholder back if list becomes empty
      if (listElement && listElement.children.length === 0) {
           listElement.innerHTML = `<li class="text-gray-400 italic text-xs">No ${category} added yet.</li>`;
      }
      saveStore('deleteItem'); // Save changes
      updateTierVisuals(tierElement); // Update progress bar
      showNotification(`Deleted "${text}"`, 'success');
  }, { once: true });
}


// --- Modal for Editing Items ---
let currentEditingLi = null; // Reference to the LI being edited

function openEditModal(li) {
  currentEditingLi = li;
  const currentText = li.dataset.text;
  editInput.value = currentText; // Populate input field
  modal.style.display = 'flex'; // Show modal
  editInput.focus(); // Focus the input
  editInput.select(); // Select text for easy replacement
}

function closeEditModal() {
  modal.style.display = 'none'; // Hide modal
  currentEditingLi = null; // Clear reference
  editInput.value = ''; // Clear input
}

function saveEdit() {
  if (!currentEditingLi) return;

  const oldText = currentEditingLi.dataset.text;
  const newText = editInput.value.trim();
  const category = currentEditingLi.dataset.category;
  const tierId = currentEditingLi.dataset.tier;

  // Validate new text
  const error = validateInput(newText);
  if (error) return showNotification(error, 'error');

  // Check for duplicates only if text actually changed
  if (newText !== oldText && isDuplicate(newText, category, tierId)) {
      return showNotification(`"${newText}" already exists in ${category} for this tier.`, 'error');
  }

  // --- Update Data Structure ---
  if (data?.[tierId]?.[category]) {
      const index = data[tierId][category].indexOf(oldText);
      if (index !== -1) {
          data[tierId][category][index] = newText; // Update the array
      }
  }

  // --- Update Mastered Set (if applicable and text changed) ---
  if (newText !== oldText) {
      const currentMasteredSet = getMasteredSet();
      if (currentMasteredSet.has(oldText)) {
          currentMasteredSet.delete(oldText);
          currentMasteredSet.add(newText);
          saveMastered(currentMasteredSet); // Save updated set
          updateMasteredListDisplay(); // Refresh the separate list
      }
  }

  // --- Update UI ---
  currentEditingLi.dataset.text = newText; // Update the dataset attribute
  const span = currentEditingLi.querySelector('.item-text');
  if (span) span.textContent = newText; // Update the visible text
  // Update checkbox ID and label if it exists
  const checkbox = currentEditingLi.querySelector('input[type="checkbox"]');
  if (checkbox) {
      checkbox.id = `cb-${tierId}-${newText.replace(/\s+/g, '-')}`;
      checkbox.setAttribute('aria-label', `Mark ${newText} as ${checkbox.checked ? 'not mastered' : 'mastered'}`);
  }
  // Update action button labels
   currentEditingLi.querySelectorAll('button[aria-label]').forEach(btn => {
       btn.setAttribute('aria-label', btn.getAttribute('aria-label').replace(oldText, newText));
   });


  saveStore('editItem'); // Save changes
  closeEditModal();
  showNotification('Item updated', 'success');
}

// Handle delete button within the edit modal
function deleteFromModal() {
  if (currentEditingLi) {
      deleteItem(currentEditingLi); // Reuse the deleteItem function
  }
  closeEditModal(); // Close modal regardless
}


// --- Drag and Drop Handling (Parent Role) ---

function handleDragOver(e) {
  e.preventDefault(); // Necessary to allow dropping
  e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e, listElement) {
  e.preventDefault();
  // Check if the item being dragged matches the list's category
  try {
      const dragData = JSON.parse(e.dataTransfer.getData('application/json'));
      if (listElement.dataset.category === dragData.category) {
          listElement.classList.add('bg-indigo-100', 'border-indigo-400'); // Highlight target list
      } else {
           e.dataTransfer.dropEffect = 'none'; // Indicate invalid drop target
      }
  } catch (err) {
      // Ignore if data is not valid JSON
       e.dataTransfer.dropEffect = 'none';
  }
}

function handleDragLeave(e, listElement) {
  listElement.classList.remove('bg-indigo-100', 'border-indigo-400'); // Remove highlight
}

function handleDrop(e, targetListElement) {
  e.preventDefault();
  targetListElement.classList.remove('bg-indigo-100', 'border-indigo-400'); // Remove highlight

  // Get data from the drag event
  const text = e.dataTransfer.getData('text/plain');
  let dragData;
  try {
      dragData = JSON.parse(e.dataTransfer.getData('application/json'));
  } catch (err) {
      console.error("Invalid drag data:", err);
      return; // Exit if data is corrupt
  }

  const sourceCategory = dragData.category;
  const sourceTier = dragData.sourceTier;
  const targetCategory = targetListElement.dataset.category;
  const targetTierId = targetListElement.id.match(/^tier(\d+)/)[1]; // Extract tier ID from target list ID

  // --- Validation ---
  // 1. Ensure category matches
  if (sourceCategory !== targetCategory) {
      showNotification(`Cannot move item to a different category (${sourceCategory} -> ${targetCategory})`, 'error');
      return;
  }
  // 2. Prevent dropping onto the same list/tier
  if (sourceTier === targetTierId) {
      return; // No action needed
  }
  // 3. Check for duplicates in the target list
  if (isDuplicate(text, targetCategory, targetTierId)) {
      showNotification(`"${text}" already exists in ${targetCategory} for Tier ${targetTierId}.`, 'error');
      return;
  }

  // --- Perform the Move ---
  // 1. Remove from source data structure
  if (data?.[sourceTier]?.[sourceCategory]) {
      data[sourceTier][sourceCategory] = data[sourceTier][sourceCategory].filter(item => item !== text);
      // Optional: Clean up empty arrays/objects in source
  }

  // 2. Add to target data structure
  data[targetTierId] = data[targetTierId] || {};
  data[targetTierId][targetCategory] = data[targetTierId][targetCategory] || [];
  data[targetTierId][targetCategory].push(text);

  // 3. Update UI: Remove from old list, add to new list
  const sourceListElement = document.getElementById(`tier${sourceTier}-${sourceCategory.slice(0, 4)}`);
  if (sourceListElement) {
      const itemToRemove = Array.from(sourceListElement.children).find(li => li.dataset?.text === text);
      if (itemToRemove) {
          itemToRemove.remove();
           // Add placeholder back if source list becomes empty
          if (sourceListElement.children.length === 0) {
              sourceListElement.innerHTML = `<li class="text-gray-400 italic text-xs">No ${sourceCategory} added yet.</li>`;
          }
      }
  }

  // Remove placeholder from target list if it exists
  const targetPlaceholder = targetListElement.querySelector('.text-gray-400');
  if (targetPlaceholder) targetPlaceholder.remove();
  // Create and add the new element to the target list
  targetListElement.appendChild(createItemElement(text, targetCategory, targetTierId));

  // 4. Save changes and update visuals
  saveStore('moveItem');
  updateTierVisuals(document.querySelector(`.tier[data-tier="${sourceTier}"]`)); // Update source tier visuals
  updateTierVisuals(document.querySelector(`.tier[data-tier="${targetTierId}"]`)); // Update target tier visuals
  showNotification(`Moved "${text}" to Tier ${targetTierId}`, 'success');
}


// --- Tier Visual Updates ---

// Update progress bar and 'complete' class for a single tier
function updateTierVisuals(tierElement) {
  if (!tierElement) return;

  const respList = tierElement.querySelector("ul[data-category='responsibilities']");
  if (!respList) return; // Only update based on responsibilities

  const totalItems = Array.from(respList.children).filter(li => li.dataset?.category === 'responsibilities').length; // Count actual items, not placeholders
  const masteredItems = respList.querySelectorAll('li.mastered[data-category="responsibilities"]').length;

  // Calculate progress percentage
  const progress = totalItems > 0 ? (masteredItems / totalItems) * 100 : 0;

  // Update progress bar width
  const progressBar = tierElement.querySelector('.progress-bar div'); // Target the inner div
  if (progressBar) {
      progressBar.style.width = `${progress}%`;
  }

  // Add/remove 'complete' class if all responsibilities are mastered
  tierElement.classList.toggle('tier-complete', totalItems > 0 && masteredItems === totalItems);
  // Maybe add visual indicator like a checkmark to header?
  const header = tierElement.querySelector('.tier-header h2');
  if (header) {
       // Remove existing checkmark first
      const existingCheck = header.querySelector('.completion-check');
      if (existingCheck) existingCheck.remove();
      // Add checkmark if complete
      if (totalItems > 0 && masteredItems === totalItems) {
           header.insertAdjacentHTML('beforeend', '<span class="completion-check text-green-500 ml-2">✓</span>');
      }
  }
}


// Update visuals for all tiers on the board
function updateAllTierVisuals() {
  document.querySelectorAll('.tier').forEach(updateTierVisuals);
  // Also update the main level display at the top
  // (This logic is already in buildBoard, consider extracting it to a separate function if needed elsewhere)
}

// --- Event Listener Attachment ---

// Attach event listeners to dynamic elements on the board
function attachBoardEvents() {
  // Add Item Buttons
  document.querySelectorAll('.add-btn').forEach(btn => {
      // Remove previous listener to prevent duplicates if buildBoard is called multiple times
      btn.replaceWith(btn.cloneNode(true));
      // Get the new button instance and add listener
      document.getElementById(btn.id)?.addEventListener('click', (e) => addNewItem(e.currentTarget));
      // Need unique IDs for buttons if using getElementById, or use querySelector with data attributes
      // Let's stick to querySelectorAll and direct attachment:
  });
   // Re-query buttons after cloning/replacing
   document.querySelectorAll('.add-btn').forEach(btn => {
      btn.onclick = (e) => addNewItem(e.currentTarget);
   });


  // Drag and Drop for Lists (Parent Role, Non-Mobile)
  if (userRole === 'parent' && !isMobile) {
      document.querySelectorAll('.tier .lists ul').forEach(ul => {
          ul.ondragover = handleDragOver;
          ul.ondragenter = (e) => handleDragEnter(e, ul);
          ul.ondragleave = (e) => handleDragLeave(e, ul);
          ul.ondrop = (e) => handleDrop(e, ul);
      });
  }

  // Note: Event listeners for items (checkboxes, dblclick, buttons inside items)
  // are attached directly when the item element is created in `createItemElement`.
}


// --- Initialization Functions ---

// Initialize dashboard for Parent users
async function initParentDashboard(uid) {
  currentUid = uid; // Store UID
  userRole = 'parent'; // Set role
  console.log("Initializing Parent Dashboard for", uid);
  await loadStore(uid); // Load data
  if (!store) return; // Stop if loading failed critically

  // Show parent-specific controls
  kidBar.style.display = 'flex';
  inviteBtn.style.display = 'inline-block';
  logoutBtn.style.display = 'inline-block';
  userEmail.textContent = auth.currentUser.email; // Display email
  userEmail.style.display = 'inline-block'; // Make sure it's visible

  // Initialize Kid Bar controls
  initKidBarControls();

  // Build the main board UI
  buildBoard();

  // Initialize action history for undo/redo
  actionHistory = [{ action: 'initial', state: structuredClone(store) }];
  actionHistoryIndex = 0;
  updateUndoRedoButtons();
}

// Initialize dashboard for Child users
async function initChildDashboard(uid) {
  currentUid = uid; // Store UID
  userRole = 'child'; // Set role
  console.log("Initializing Child Dashboard for", uid);

  // Hide parent controls, show basic user info
  kidBar.style.display = 'none';
  inviteBtn.style.display = 'none';
  logoutBtn.style.display = 'inline-block'; // Allow logout
  userEmail.textContent = auth.currentUser.email;
  userEmail.style.display = 'inline-block';

  // --- Link Child to Parent (if not already linked) ---
  // This logic needs refinement. How do we know which parent to load data from?
  // Option 1: Child enters an invite code (as in original code)
  // Option 2: Parent document stores linked child UIDs
  // Option 3: Child document stores linked parent UID

  // Let's assume Option 3: Child doc stores parent UID after initial invite acceptance.
  let parentUid = null;
  const childUserRef = doc(db, COLLECTIONS.USERS, uid); // Check child's own doc
  try {
      const childDocSnap = await getDoc(childUserRef);
      if (childDocSnap.exists() && childDocSnap.data().parentUid) {
          parentUid = childDocSnap.data().parentUid;
          console.log(`Child ${uid} linked to parent ${parentUid}`);
      } else {
          // --- Invite Code Logic ---
          const code = prompt('If this is your first time, enter the invite code from your parent:');
          if (code) {
              const inviteRef = doc(db, COLLECTIONS.INVITES, code.toUpperCase());
              const invSnap = await getDoc(inviteRef);
              if (invSnap.exists() && invSnap.data().parentUid) {
                  parentUid = invSnap.data().parentUid;
                  // Link child in their user doc and potentially update invite doc
                  await setDoc(childUserRef, { parentUid: parentUid }, { merge: true });
                  // Optional: Update invite doc to show it's claimed by this child
                  await setDoc(inviteRef, { childUid: uid, claimedDate: serverTimestamp() }, { merge: true });
                  console.log(`Invite code ${code} accepted. Linked child ${uid} to parent ${parentUid}`);
              } else {
                  showNotification('Invalid or expired invite code.', 'error');
                  // Handle logout or retry? For now, show error and potentially empty board.
                  board.innerHTML = '<h1>LevelUp</h1><p>Could not link to a parent account. Please check the invite code or ask your parent.</p>';
                  return;
              }
          } else {
               // No code entered, and not previously linked
               board.innerHTML = '<h1>LevelUp</h1><p>Account not linked to a parent. Please use an invite code.</p>';
               return;
          }
      }
  } catch (e) {
      handleError(e, "Failed to check/link child account");
      board.innerHTML = '<h1>LevelUp</h1><p>An error occurred while setting up your account.</p>';
      return;
  }

  // --- Load Parent's Data ---
  if (parentUid) {
      await loadStore(parentUid); // Load the parent's store data
      if (!store) {
           board.innerHTML = '<h1>LevelUp</h1><p>Could not load data from the linked parent account.</p>';
           return;
      }
      // Child view usually focuses on ONE specific profile.
      // How is the correct profile determined?
      // Assumption: Parent sets the 'currentKid' in their store to the child's profile name.
      // This requires the parent to manage profile names appropriately.
      // We'll proceed assuming store.currentKid is the correct one for this child.
      data = store.profiles[store.currentKid]; // Set data reference

      // Build the board (child view is inherently read-only for structure, only checkboxes interactive)
      buildBoard(); // buildBoard now respects userRole for buttons/drag-drop

      // Load and display streak
      loadChildStreak(uid);

  } else {
       board.innerHTML = '<h1>LevelUp</h1><p>Could not determine parent account to load data from.</p>';
  }
}


// Load and display the child's completion streak
async function loadChildStreak(childUid) {
  console.log("Loading streak for child:", childUid);
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Normalize today to the start of the day

  try {
      // Query last ~30 days of activity for efficiency, ordered descending
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(today.getDate() - 30);

      const q = query(
          collection(db, COLLECTIONS.CHILD_ACTIVITY),
          where('childUid', '==', childUid),
          where('date', '>=', thirtyDaysAgo), // Limit query range
          orderBy('date', 'desc')
      );
      const querySnapshot = await getDocs(q);

      const completedDates = new Set(); // Store unique completion dates (YYYY-MM-DD)

      querySnapshot.forEach(docSnap => {
          const activity = docSnap.data();
          if (activity.date) {
              const completionDate = activity.date.toDate();
              completionDate.setHours(0, 0, 0, 0); // Normalize to start of day
              completedDates.add(completionDate.toISOString().split('T')[0]); // Add YYYY-MM-DD string
          }
      });

      // Calculate streak backwards from today
      let currentCheckDate = new Date(today);
      while (completedDates.has(currentCheckDate.toISOString().split('T')[0])) {
          streak++;
          currentCheckDate.setDate(currentCheckDate.getDate() - 1); // Move to the previous day
      }
      console.log("Calculated streak:", streak);

  } catch (e) {
      handleError(e, "Failed to load activity streak");
  }

  // Display the streak
  const topHeader = document.querySelector('.top-header');
  if (topHeader) {
      // Remove existing streak display if any
      const existingStreakEl = topHeader.querySelector('.streak-display');
      if (existingStreakEl) existingStreakEl.remove();

      const streakEl = document.createElement('div');
      streakEl.className = 'streak-display mt-2 text-sm text-orange-600 font-medium'; // Added styling
      streakEl.textContent = `🔥 Current Streak: ${streak} day${streak !== 1 ? 's' : ''}`;
      // Append after the level section
      const levelSection = topHeader.querySelector('.level-section');
      if (levelSection) {
          levelSection.insertAdjacentElement('afterend', streakEl);
      } else {
          topHeader.appendChild(streakEl); // Fallback append
      }
  }
}


// Setup event listeners for Kid Bar controls (only called for parents)
function initKidBarControls() {
  if (!kidSelect || !addKidBtn || !renameKidBtn || !deleteKidBtn || !undoBtn || !redoBtn || !exportBtn || !importBtn || !fileInput) {
      console.error("initKidBarControls: One or more kid bar elements not found.");
      return;
  }

  // Kid selection change
  kidSelect.onchange = () => {
      if (store.currentKid !== kidSelect.value) {
          store.currentKid = kidSelect.value;
          data = store.profiles[store.currentKid];
          // Ensure mastered array exists for the selected kid
          store.mastered[store.currentKid] = store.mastered[store.currentKid] || [];
          console.log("Kid changed to:", store.currentKid);
          saveStore('changeKid'); // Save the change
          buildBoard(); // Rebuild the board for the selected kid
          // Reset undo history when switching kids? Or keep global history?
          // Current implementation keeps global history.
      }
  };

  // Button listeners
  addKidBtn.onclick = addKid;
  renameKidBtn.onclick = renameKid;
  deleteKidBtn.onclick = deleteKid;
  undoBtn.onclick = undo;
  redoBtn.onclick = redo;
  exportBtn.onclick = exportJSON;
  importBtn.onclick = () => fileInput.click(); // Trigger hidden file input
  fileInput.onchange = importJSON; // Handle file selection
}

// --- DOMContentLoaded ---
// Main execution starts here after the HTML is parsed
document.addEventListener('DOMContentLoaded', () => {
  console.log("DOM fully loaded and parsed.");

  // --- Get DOM Element References ---
  board = document.getElementById('board');
  kidSelect = document.getElementById('kidSelect');
  addKidBtn = document.getElementById('addKidBtn');
  renameKidBtn = document.getElementById('renameKidBtn');
  deleteKidBtn = document.getElementById('deleteKidBtn');
  undoBtn = document.getElementById('undoBtn');
  redoBtn = document.getElementById('redoBtn');
  exportBtn = document.getElementById('exportBtn');
  importBtn = document.getElementById('importBtn');
  fileInput = document.getElementById('fileInput');
  notifications = document.getElementById('notifications');
  modal = document.getElementById('modal');
  editInput = document.getElementById('editInput');
  saveBtn = document.getElementById('saveBtn');
  deleteBtn = document.getElementById('deleteBtn'); // Delete button within modal
  cancelBtn = document.getElementById('cancelBtn');
  loginModal = document.getElementById('loginModal');
  emailInput = document.getElementById('emailInput');
  passwordInput = document.getElementById('passwordInput');
  loginBtn = document.getElementById('loginBtn');
  registerBtn = document.getElementById('registerBtn');
  googleBtn = document.getElementById('googleBtn');
  userEmail = document.getElementById('userEmail');
  logoutBtn = document.getElementById('logoutBtn');
  inviteBtn = document.getElementById('inviteBtn');
  kidBar = document.getElementById('kidBar');
  // todoList = document.getElementById('todo-list'); // Removed
  masteredList = document.getElementById('mastered-list'); // Keep reference to the mastered display area

  // --- Initial UI State ---
  loginModal.style.display = 'flex'; // Show login initially
  kidBar.style.display = 'none'; // Hide kid controls
  inviteBtn.style.display = 'none';
  logoutBtn.style.display = 'none';
  userEmail.style.display = 'none';
  board.innerHTML = '<h1>LevelUp</h1><p>Please log in to continue.</p>'; // Initial message
  if (masteredList) masteredList.innerHTML = '<li>Log in to see mastered items.</li>';


  // --- Authentication State Observer ---
  onAuthStateChanged(auth, async (user) => {
      if (user) {
          console.log("Auth state changed: User logged in", user.uid, user.email);
          loginModal.style.display = 'none'; // Hide login modal

          // Determine user role
          const roleRef = doc(db, COLLECTIONS.ROLES, user.uid);
          let userRoleAssigned = 'parent'; // Default to parent if no role found
          try {
              const roleSnap = await getDoc(roleRef);
              if (roleSnap.exists()) {
                  userRoleAssigned = roleSnap.data().role || 'parent'; // Use existing role or default
              } else {
                  // If role doc doesn't exist, create it (defaulting to parent)
                  console.log(`No role found for ${user.uid}, assigning default 'parent' role.`);
                  await setDoc(roleRef, { role: 'parent' });
                  userRoleAssigned = 'parent';
              }
          } catch (e) {
              handleError(e, "Failed to get or set user role");
              // Proceed cautiously, maybe default to parent or show error?
              userRoleAssigned = 'parent'; // Fallback
          }

          console.log("User role determined as:", userRoleAssigned);

          // Initialize the appropriate dashboard
          if (userRoleAssigned === 'parent') {
              await initParentDashboard(user.uid);
          } else {
              await initChildDashboard(user.uid);
          }

      } else {
          console.log("Auth state changed: User logged out.");
          // Reset UI to logged-out state
          loginModal.style.display = 'flex';
          kidBar.style.display = 'none';
          inviteBtn.style.display = 'none';
          logoutBtn.style.display = 'none';
          userEmail.style.display = 'none';
          board.innerHTML = '<h1>LevelUp</h1><p>Please log in to continue.</p>';
          if (masteredList) masteredList.innerHTML = '<li>Log in to see mastered items.</li>';

          // Clear state variables
          store = null;
          data = null;
          actionHistory = [];
          actionHistoryIndex = -1;
          userRole = null;
          currentUid = null;
      }
  });

  // --- Login/Register Button Handlers ---
  loginBtn.onclick = async () => {
      const email = emailInput.value.trim();
      const password = passwordInput.value.trim();
      if (!email || !password) return showNotification('Email and password are required', 'error');
      try {
          await signInWithEmailAndPassword(auth, email, password);
          showNotification('Logged in successfully', 'success');
          // onAuthStateChanged will handle UI updates
      } catch (err) {
          handleError(err, 'Failed to log in. Check email/password.');
      }
  };

  registerBtn.onclick = async () => {
      const email = emailInput.value.trim();
      const password = passwordInput.value.trim();
      if (!email || !password) return showNotification('Email and password are required', 'error');
      if (password.length < 6) return showNotification('Password must be at least 6 characters', 'error');

      try {
          const userCredential = await createUserWithEmailAndPassword(auth, email, password);
          const user = userCredential.user;
          // Set default role to 'parent' upon registration
          await setDoc(doc(db, COLLECTIONS.ROLES, user.uid), { role: 'parent' });
          showNotification('Registered successfully! You can now log in.', 'success');
          // onAuthStateChanged will handle UI updates after registration potentially logs in
      } catch (err) {
          handleError(err, 'Failed to register. Email might already be in use.');
      }
  };

  googleBtn.onclick = async () => {
      const provider = new GoogleAuthProvider();
      try {
          const result = await signInWithPopup(auth, provider);
          const user = result.user;
          // Check if role exists, create 'parent' role if not (first Google sign-in)
          const roleRef = doc(db, COLLECTIONS.ROLES, user.uid);
          const roleSnap = await getDoc(roleRef);
          if (!roleSnap.exists()) {
              await setDoc(roleRef, { role: 'parent' });
              console.log(`Assigned default 'parent' role to Google user ${user.uid}`);
          }
          showNotification('Signed in with Google', 'success');
          // onAuthStateChanged handles UI
      } catch (err) {
          handleError(err, 'Failed to sign in with Google');
      }
  };

  logoutBtn.onclick = async () => {
      try {
          // Optional: Save any final state changes if needed, though most actions trigger saveStore already.
          // await saveStore(); // Usually not necessary here if saves happen on action
          await signOut(auth);
          showNotification('Logged out successfully', 'success');
          // onAuthStateChanged handles UI reset
      } catch (err) {
          handleError(err, 'Failed to log out');
      }
  };

  // --- Invite Button Handler (Parent Only) ---
  inviteBtn.onclick = async () => {
      if (!currentUid) return showNotification("Cannot generate invite: Not logged in.", "error");
      try {
          // Generate a simple random code (adjust length/complexity as needed)
          const code = Math.random().toString(36).substring(2, 8).toUpperCase();
          // Store the code with the parent's UID in Firestore
          await setDoc(doc(db, COLLECTIONS.INVITES, code), {
              parentUid: currentUid,
              createdAt: serverTimestamp()
          });
          // Attempt to copy code to clipboard
          try {
              await navigator.clipboard.writeText(code);
              showNotification(`Invite code ${code} created and copied to clipboard. Share it with your child.`, 'success', 5000); // Longer duration
          } catch (clipErr) {
               showNotification(`Invite code ${code} created. Please copy it manually.`, 'info');
          }
      } catch (err) {
          handleError(err, 'Failed to generate invite code');
      }
  };

  // --- Edit Modal Button Handlers ---
  saveBtn.onclick = saveEdit;
  deleteBtn.onclick = deleteFromModal; // Use specific handler for modal delete
  cancelBtn.onclick = closeEditModal;
  // Close modal if clicking outside the content area
  modal.onclick = (e) => {
      if (e.target === modal) {
          closeEditModal();
      }
  };
  // Close modal on Escape key press
  window.onkeydown = (e) => {
      if (e.key === 'Escape' && modal.style.display === 'flex') {
          closeEditModal();
      }
  };

}); // End DOMContentLoaded

console.log("LevelUp script loaded.");
