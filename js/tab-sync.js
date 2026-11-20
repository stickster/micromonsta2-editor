/**
 * TabSyncManager
 * Coordinates real-time state synchronization and single-instance hardware
 * polling leadership across multiple open browser tabs/windows.
 */

class TabSyncManager {
    static CHANNEL_NAME = 'mm2_tab_sync';
    static SETTING_KEY = 'mm2_tab_sync_enabled';
    static LEADER_LOCK_NAME = 'mm2_hardware_poll_leader';
    static FALLBACK_LEASE_KEY_ID = 'mm2_poll_leader_id';
    static FALLBACK_LEASE_KEY_TS = 'mm2_poll_leader_ts';
    static FALLBACK_MSG_KEY = 'mm2_tab_sync_msg';
    static LEASE_TIMEOUT_MS = 20000;

    /**
     * @param {App} app Parent application instance
     * @param {Object} [options] Optional overrides (`tabId`, `channelName`, `lockName`)
     */
    constructor(app, options = {}) {
        this.app = app;
        this.tabId = options.tabId || `tab_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        this.channelName = options.channelName || TabSyncManager.CHANNEL_NAME;
        this.lockName = options.lockName || TabSyncManager.LEADER_LOCK_NAME;
        this.enabled = this.loadSetting();
        this.isLeader = null;
        this.channel = null;
        this._storageListener = null;
        this._isApplyingRemoteSync = false;
        this._releaseLock = null;
        this._fallbackLeaseInterval = null;

        this.initChannel();
        this.initLeaderElection();
    }

    /**
     * Safely reads a string value from `window.localStorage`.
     * @param {string} key
     * @returns {string|null}
     */
    _safeStorageGet(key) {
        if (typeof window === 'undefined' || !window.localStorage) return null;
        try {
            return window.localStorage.getItem(key);
        } catch (e) {
            return null;
        }
    }

    /**
     * Safely writes a string value to `window.localStorage`.
     * @param {string} key
     * @param {string} value
     */
    _safeStorageSet(key, value) {
        if (typeof window === 'undefined' || !window.localStorage) return;
        try {
            window.localStorage.setItem(key, value);
        } catch (e) {}
    }

    /**
     * Safely removes a key from `window.localStorage`.
     * @param {string} key
     */
    _safeStorageRemove(key) {
        if (typeof window === 'undefined' || !window.localStorage) return;
        try {
            window.localStorage.removeItem(key);
        } catch (e) {}
    }

    /**
     * Reads the current fallback leader lease record from `localStorage`.
     * @returns {{ leaderId: string|null, timestamp: number, isExpired: boolean }}
     */
    _readFallbackLease() {
        const leaderId = this._safeStorageGet(TabSyncManager.FALLBACK_LEASE_KEY_ID);
        const timestamp = parseInt(this._safeStorageGet(TabSyncManager.FALLBACK_LEASE_KEY_TS) || '0', 10);
        const isExpired = !leaderId || (Date.now() - timestamp) > TabSyncManager.LEASE_TIMEOUT_MS;
        return { leaderId, timestamp, isExpired };
    }

    /**
     * Loads whether cross-tab sync is enabled from `localStorage` (defaults to true).
     * @returns {boolean}
     */
    loadSetting() {
        const val = this._safeStorageGet(TabSyncManager.SETTING_KEY);
        if (val === null) return true; // Default ON
        return val === 'true';
    }

    /**
     * Enables or disables cross-tab synchronization and persists the choice.
     * @param {boolean} enabled
     */
    setEnabled(enabled) {
        this.enabled = !!enabled;
        this._safeStorageSet(TabSyncManager.SETTING_KEY, String(this.enabled));
    }

    /** Initializes BroadcastChannel or falls back to `localStorage` events. */
    initChannel() {
        if (typeof BroadcastChannel !== 'undefined') {
            try {
                this.channel = new BroadcastChannel(this.channelName);
                this.channel.onmessage = (event) => {
                    this.handleIncomingMessage(event.data);
                };
            } catch (e) {
                console.warn('[TabSync] BroadcastChannel init error, falling back to storage:', e);
                this.setupStorageFallback();
            }
        } else {
            this.setupStorageFallback();
        }
    }

    /** Registers a `storage` event listener for browsers without BroadcastChannel. */
    setupStorageFallback() {
        if (typeof window === 'undefined' || !window.addEventListener) return;
        this._storageListener = (e) => {
            if (e.key === TabSyncManager.FALLBACK_MSG_KEY && e.newValue) {
                try {
                    const data = JSON.parse(e.newValue);
                    this.handleIncomingMessage(data);
                } catch (err) {}
            }
        };
        window.addEventListener('storage', this._storageListener);
    }

    /** Starts Web Locks leader election or falls back to a localStorage lease. */
    initLeaderElection() {
        if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
            this.acquireWebLock();
        } else {
            this.initFallbackLeaderElection();
        }
    }

    /** Attempts to acquire the exclusive hardware polling Web Lock. */
    async acquireWebLock() {
        try {
            if (navigator.locks && typeof navigator.locks.query === 'function') {
                try {
                    const state = await navigator.locks.query();
                    const isHeld = state && state.held && state.held.some(l => l.name === this.lockName);
                    if (isHeld) {
                        this.setLeadership(false);
                    }
                } catch (e) {}
            }
            navigator.locks.request(this.lockName, async (lock) => {
                this.setLeadership(true);
                await new Promise((resolve) => {
                    this._releaseLock = resolve;
                });
                this.setLeadership(false);
            }).catch((err) => {
                console.warn('[TabSync] Web Locks request aborted/failed:', err);
                this.initFallbackLeaderElection();
            });
        } catch (e) {
            this.initFallbackLeaderElection();
        }
    }

    /** Runs periodic `localStorage` lease checks when Web Locks are unavailable. */
    initFallbackLeaderElection() {
        if (typeof window === 'undefined' || !window.localStorage) {
            this.setLeadership(true);
            return;
        }

        const checkLease = () => {
            const now = Date.now();
            const { leaderId, isExpired } = this._readFallbackLease();

            if (leaderId === this.tabId || isExpired) {
                this._safeStorageSet(TabSyncManager.FALLBACK_LEASE_KEY_ID, this.tabId);
                this._safeStorageSet(TabSyncManager.FALLBACK_LEASE_KEY_TS, String(now));
                if (!this.isLeader) {
                    this.setLeadership(true);
                }
            } else {
                if (this.isLeader !== false) {
                    this.setLeadership(false);
                }
            }
        };

        checkLease();
        this._fallbackLeaseInterval = setInterval(checkLease, 5000);
    }

    /** True when this tab is known to be a follower (either elected or via active fallback lease). */
    get isFollower() {
        if (this.isLeader === false) return true;
        if (this.isLeader === true) return false;
        const { leaderId, isExpired } = this._readFallbackLease();
        return !!(leaderId && leaderId !== this.tabId && !isExpired);
    }

    /**
     * Updates polling leadership status and requests leader state when becoming a follower.
     * @param {boolean} isLeader
     */
    setLeadership(isLeader) {
        if (this.isLeader === isLeader) return;
        this.isLeader = isLeader;
        if (this.app && this.app.midi && typeof this.app.midi.setLeaderStatus === 'function') {
            this.app.midi.setLeaderStatus(isLeader);
        }
        if (!isLeader) {
            this.requestLeaderState();
        }
    }

    /** Broadcasts a request for the active leader's current state snapshot. */
    requestLeaderState() {
        if (!this.enabled || this.isLeader) return;
        this.broadcast('REQUEST_LEADER_STATE', {});
    }

    /**
     * Broadcasts a sync message to all other tabs unless suppressed by remote application.
     * @param {string} type
     * @param {Object} [payload]
     */
    broadcast(type, payload = {}) {
        if (!this.enabled || this._isApplyingRemoteSync) return;
        const message = {
            type,
            senderTabId: this.tabId,
            timestamp: Date.now(),
            ...payload
        };

        if (this.channel) {
            try {
                this.channel.postMessage(message);
            } catch (e) {
                console.warn('[TabSync] Failed to postMessage:', e);
            }
        } else if (typeof window !== 'undefined' && window.localStorage) {
            this._safeStorageSet(TabSyncManager.FALLBACK_MSG_KEY, JSON.stringify(message));
            // Clear immediately after to allow identical consecutive messages
            setTimeout(() => {
                this._safeStorageRemove(TabSyncManager.FALLBACK_MSG_KEY);
            }, 50);
        }
    }

    /**
     * Updates remote probe suppression state on the follower's MIDI manager.
     * @param {boolean} isProbing
     * @param {number} [timeoutMs=3000]
     */
    _applyRemoteProbing(isProbing, timeoutMs = 3000) {
        const midi = this.app && this.app.midi;
        if (!midi || this.isLeader) return;
        if (typeof midi.setRemoteProbing === 'function') {
            midi.setRemoteProbing(isProbing, timeoutMs);
            return;
        }
        clearTimeout(midi._remoteProbeTimeout);
        midi._isProbing = !!isProbing;
        if (isProbing) {
            midi._remoteProbeTimeout = setTimeout(() => {
                if (this.app && this.app.midi) {
                    this.app.midi._isProbing = false;
                }
            }, timeoutMs);
        }
    }

    /**
     * Responds to a follower's `REQUEST_LEADER_STATE` with the leader's current snapshot.
     * @param {Object} data
     */
    _handleLeaderStateRequest(data) {
        if (!this.isLeader || !this.app) return;
        const snapshot = typeof this.app.getLeaderStateSnapshot === 'function'
            ? this.app.getLeaderStateSnapshot()
            : {
                mode: this.app.synthTimbralMode,
                timbreA: this.app.timbreA ? Array.from(this.app.timbreA.rawData) : null,
                timbreB: this.app.timbreB ? Array.from(this.app.timbreB.rawData) : null,
                hardwareResponsive: this.app.midi ? this.app.midi.hardwareResponsive : null,
                liveSync: this.app.midi ? this.app.midi.liveSync : false
            };
        this.broadcast('SYNC_LEADER_STATE', {
            targetTabId: data.senderTabId,
            ...snapshot
        });
    }

    /**
     * Dispatches a validated remote sync message to the appropriate handler.
     * @param {Object} data
     */
    _dispatchRemoteMessage(data) {
        const app = this.app;
        switch (data.type) {
            case 'PARAM_CHANGE':
                app?.applyRemoteParamChange?.(data.key, data.val, data.slot);
                break;
            case 'PATCH_META_CHANGE':
                app?.applyRemoteMetaChange?.(data.slot, data.name, data.category);
                break;
            case 'PATCH_LOADED':
                app?.applyRemotePatchLoaded?.(data.slot, data.rawData, data.source);
                break;
            case 'LIBRARIAN_CHANGED':
                app?.applyRemoteLibrarianChange?.();
                break;
            case 'TIMBRAL_MODE_CHANGED':
                app?.applyRemoteTimbralMode?.(data.mode);
                break;
            case 'HARDWARE_STATUS':
                app?.applyRemoteHardwareStatus?.(data.responsive);
                break;
            case 'LIVE_SYNC_CHANGED':
                app?.applyRemoteLiveSync?.(data.liveSync);
                break;
            case 'HARDWARE_PROBE_START':
                this._applyRemoteProbing(true, (data && data.timeoutMs) || 3000);
                break;
            case 'HARDWARE_PROBE_END':
                this._applyRemoteProbing(false);
                break;
            case 'REQUEST_LEADER_STATE':
                this._handleLeaderStateRequest(data);
                break;
            case 'SYNC_LEADER_STATE':
                if ((!data.targetTabId || data.targetTabId === this.tabId) && !this.isLeader) {
                    app?.applyLeaderState?.(data);
                }
                break;
        }
    }

    /**
     * Processes an incoming cross-tab sync payload while preventing echo loops.
     * @param {Object} data
     */
    handleIncomingMessage(data) {
        if (!this.enabled || !data || data.senderTabId === this.tabId) {
            return;
        }

        this._isApplyingRemoteSync = true;
        try {
            this._dispatchRemoteMessage(data);
        } catch (err) {
            console.error('[TabSync] Error applying remote sync message:', err, data);
        } finally {
            this._isApplyingRemoteSync = false;
        }
    }

    /** Releases locks, timers, storage leases, and listeners on teardown. */
    destroy() {
        if (this._releaseLock) {
            this._releaseLock();
            this._releaseLock = null;
        }
        if (this._fallbackLeaseInterval) {
            clearInterval(this._fallbackLeaseInterval);
            this._fallbackLeaseInterval = null;
        }
        if (this._safeStorageGet(TabSyncManager.FALLBACK_LEASE_KEY_ID) === this.tabId) {
            this._safeStorageRemove(TabSyncManager.FALLBACK_LEASE_KEY_ID);
            this._safeStorageRemove(TabSyncManager.FALLBACK_LEASE_KEY_TS);
        }
        if (this.channel) {
            try {
                this.channel.close();
            } catch (e) {}
            this.channel = null;
        }
        if (this._storageListener && typeof window !== 'undefined') {
            window.removeEventListener('storage', this._storageListener);
            this._storageListener = null;
        }
    }
}

if (typeof window !== 'undefined') {
    window.TabSyncManager = TabSyncManager;
}
if (typeof globalThis !== 'undefined') {
    globalThis.TabSyncManager = TabSyncManager;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TabSyncManager };
}
