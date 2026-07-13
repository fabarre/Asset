// ═══════════════════════════════════════════════════════════════════
// IndexedDB Manager for Offline Caching & Memory Optimization
// ═══════════════════════════════════════════════════════════════════

const DB_NAME = 'HybridMAdatabase';
const DB_VERSION = 1;

const DBStore = {
    PUN_PROFILES: 'pun_profiles',
    LOAD_CURVES: 'load_curves',
    USER_SETTINGS: 'user_settings'
};

const HybridDB = {
    db: null,

    init: function() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(DBStore.PUN_PROFILES)) {
                    db.createObjectStore(DBStore.PUN_PROFILES, { keyPath: 'zone' });
                }
                if (!db.objectStoreNames.contains(DBStore.LOAD_CURVES)) {
                    db.createObjectStore(DBStore.LOAD_CURVES, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(DBStore.USER_SETTINGS)) {
                    db.createObjectStore(DBStore.USER_SETTINGS, { keyPath: 'key' });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log("[IndexedDB] Database initialized successfully.");
                resolve(this.db);
            };

            request.onerror = (event) => {
                console.error("[IndexedDB] Database error:", event.target.error);
                reject(event.target.error);
            };
        });
    },

    save: function(storeName, data) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject("DB non inizializzato");
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(data);

            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    },

    get: function(storeName, key) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject("DB non inizializzato");
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(key);

            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    getAll: function(storeName) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject("DB non inizializzato");
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }
};

// Se vogliamo usarlo globalmente
window.HybridDB = HybridDB;
