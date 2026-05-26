// ============================================================
// STATE MANAGEMENT
// ============================================================
import { DEFAULT_TARIFFS, DEFAULT_PREFS, DEFAULT_SERVICES } from './config.js';

class AppState {
    constructor() {
        this._listeners = new Map();
        this._data = {
            addresses: [],
            currentAddressId: 'default',
            tariffs: { ...DEFAULT_TARIFFS },
            prefs: { ...DEFAULT_PREFS },
            records: [],
            customServices: [...DEFAULT_SERVICES],
            isGuest: false,
            sessionLogin: null,
            sessionPass: null,
            syncState: 'synced',
            currentCalc: { waterCost: 0, hotWaterCost: 0, electroCost: 0, gasCost: 0, customCost: 0, total: 0 }
        };
    }

    get(key) { return this._data[key]; }

    set(key, value) {
        const old = this._data[key];
        this._data[key] = value;
        if (old !== value) this._notify(key, value, old);
    }

    _notify(key, value, old) {
        const listeners = this._listeners.get(key);
        if (listeners) listeners.forEach(fn => fn(value, old));
    }

    on(key, fn) {
        if (!this._listeners.has(key)) this._listeners.set(key, new Set());
        this._listeners.get(key).add(fn);
        return () => this._listeners.get(key).delete(fn);
    }

    // Persistence
    saveLocal() {
        try {
            localStorage.setItem('komynalka_backup', JSON.stringify({
                addresses: this._data.addresses,
                currentAddressId: this._data.currentAddressId,
                timestamp: Date.now()
            }));
        } catch (e) {}
    }

    loadLocal() {
        try {
            const raw = localStorage.getItem('komynalka_backup');
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    // Session
    saveSession() {
        if (this._data.sessionLogin) localStorage.setItem('k_login', this._data.sessionLogin);
        if (this._data.sessionPass) localStorage.setItem('k_passHash', this._data.sessionPass);
    }

    loadSession() {
        this._data.sessionLogin = localStorage.getItem('k_login');
        this._data.sessionPass = localStorage.getItem('k_passHash');
    }

    // Current address helpers
    getCurrentAddress() {
        return this._data.addresses.find(a => a.id === this._data.currentAddressId) || this._data.addresses[0];
    }

    syncFromAddress() {
        const addr = this.getCurrentAddress();
        if (!addr) return;
        this._data.tariffs = { ...DEFAULT_TARIFFS, ...(addr.tariffs || {}) };
        this._data.prefs = { ...DEFAULT_PREFS, ...(addr.prefs || {}) };
        this._data.records = addr.records || [];
        this._data.customServices = addr.customServices || [...DEFAULT_SERVICES];
    }

    syncToAddress() {
        const idx = this._data.addresses.findIndex(a => a.id === this._data.currentAddressId);
        if (idx >= 0) {
            this._data.addresses[idx].tariffs = this._data.tariffs;
            this._data.addresses[idx].prefs = this._data.prefs;
            this._data.addresses[idx].records = this._data.records;
            this._data.addresses[idx].customServices = this._data.customServices;
        }
    }
}

export const state = new AppState();
