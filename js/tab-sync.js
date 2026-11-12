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
    static LEASE_TIMEOUT_MS = 20000;

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

    loadSetting() {
        if (typeof window !== 'undefined' && window.localStorage) {
            try {
                const val = window.localStorage.getItem(TabSyncManager.SETTING_KEY);
                if (val === null) return true; // Default ON
                return val === 'true';
            } catch (e) {
                return true;
            }
        }
        return true;
    }

    setEnabled(enabled) {
        this.enabled = !!enabled;
        if (typeof window !== 'undefined' && window.localStorage) {
            try {
                window.localStorage.setItem(TabSyncManager.SETTING_KEY, String(this.enabled));
            } catch (e) {}
        }
    }

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

    setupStorageFallback() {
        if (typeof window === 'undefined' || !window.addEventListener) return;
        this._storageListener = (e) => {
            if (e.key === 'mm2_tab_sync_msg' && e.newValue) {
                try {
                    const data = JSON.parse(e.newValue);
                    this.handleIncomingMessage(data);
                } catch (err) {}
            }
        };
        window.addEventListener('storage', this._storageListener);
    }

    initLeaderElection() {
        if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
            this.acquireWebLock();
        } else {
            this.initFallbackLeaderElection();
        }
    }

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

    initFallbackLeaderElection() {
        if (typeof window === 'undefined' || !window.localStorage) {
            this.setLeadership(true);
            return;
        }

        const checkLease = () => {
            const now = Date.now();
            let currentLeader = null;
            let currentTs = 0;
            try {
                currentLeader = window.localStorage.getItem(TabSyncManager.FALLBACK_LEASE_KEY_ID);
                currentTs = parseInt(window.localStorage.getItem(TabSyncManager.FALLBACK_LEASE_KEY_TS) || '0', 10);
            } catch (e) {}

            const isExpired = !currentLeader || (now - currentTs) > TabSyncManager.LEASE_TIMEOUT_MS;
            if (currentLeader === this.tabId || isExpired) {
                try {
                    window.localStorage.setItem(TabSyncManager.FALLBACK_LEASE_KEY_ID, this.tabId);
                    window.localStorage.setItem(TabSyncManager.FALLBACK_LEASE_KEY_TS, String(now));
                } catch (e) {}
                if (!this.isLeader) {
                    this.setLeadership(true);
                }
            } else {
                if (this.isLeader) {
                    this.setLeadership(false);
                }
            }
        };

        checkLease();
        this._fallbackLeaseInterval = setInterval(checkLease, 5000);
    }

    get isFollower() {
        if (this.isLeader === false) return true;
        if (typeof window !== 'undefined' && window.localStorage) {
            try {
                const currentLeader = window.localStorage.getItem(TabSyncManager.FALLBACK_LEASE_KEY_ID);
                const currentTs = parseInt(window.localStorage.getItem(TabSyncManager.FALLBACK_LEASE_KEY_TS) || '0', 10);
                if (currentLeader && currentLeader !== this.tabId && (Date.now() - currentTs) <= TabSyncManager.LEASE_TIMEOUT_MS) {
                    return true;
                }
            } catch (e) {}
        }
        return false;
    }

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

    requestLeaderState() {
        if (!this.enabled || this.isLeader) return;
        this.broadcast('REQUEST_LEADER_STATE', {});
    }

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
            try {
                window.localStorage.setItem('mm2_tab_sync_msg', JSON.stringify(message));
                // Clear immediately after to allow identical consecutive messages
                setTimeout(() => {
                    try { window.localStorage.removeItem('mm2_tab_sync_msg'); } catch (e) {}
                }, 50);
            } catch (e) {}
        }
    }

    handleIncomingMessage(data) {
        if (!this.enabled || !data || data.senderTabId === this.tabId) {
            return;
        }

        this._isApplyingRemoteSync = true;
        try {
            switch (data.type) {
                case 'PARAM_CHANGE':
                    if (this.app && typeof this.app.applyRemoteParamChange === 'function') {
                        this.app.applyRemoteParamChange(data.key, data.val, data.slot);
                    }
                    break;
                case 'PATCH_META_CHANGE':
                    if (this.app && typeof this.app.applyRemoteMetaChange === 'function') {
                        this.app.applyRemoteMetaChange(data.slot, data.name, data.category);
                    }
                    break;
                case 'PATCH_LOADED':
                    if (this.app && typeof this.app.applyRemotePatchLoaded === 'function') {
                        this.app.applyRemotePatchLoaded(data.slot, data.rawData, data.source);
                    }
                    break;
                case 'LIBRARIAN_CHANGED':
                    if (this.app && typeof this.app.applyRemoteLibrarianChange === 'function') {
                        this.app.applyRemoteLibrarianChange();
                    }
                    break;
                case 'TIMBRAL_MODE_CHANGED':
                    if (this.app && typeof this.app.applyRemoteTimbralMode === 'function') {
                        this.app.applyRemoteTimbralMode(data.mode);
                    }
                    break;
                case 'HARDWARE_STATUS':
                    if (this.app && typeof this.app.applyRemoteHardwareStatus === 'function') {
                        this.app.applyRemoteHardwareStatus(data.responsive);
                    }
                    break;
                case 'HARDWARE_PROBE_START':
                    if (this.app && this.app.midi && !this.isLeader) {
                        this.app.midi._isProbing = true;
                        clearTimeout(this.app.midi._remoteProbeTimeout);
                        this.app.midi._remoteProbeTimeout = setTimeout(() => {
                            if (this.app && this.app.midi) {
                                this.app.midi._isProbing = false;
                            }
                        }, (data && data.timeoutMs) || 3000);
                    }
                    break;
                case 'HARDWARE_PROBE_END':
                    if (this.app && this.app.midi && !this.isLeader) {
                        clearTimeout(this.app.midi._remoteProbeTimeout);
                        this.app.midi._isProbing = false;
                    }
                    break;
                case 'REQUEST_LEADER_STATE':
                    if (this.isLeader && this.app) {
                        const payload = {
                            targetTabId: data.senderTabId,
                            mode: this.app.synthTimbralMode,
                            timbreA: this.app.timbreA ? Array.from(this.app.timbreA.rawData) : null,
                            timbreB: this.app.timbreB ? Array.from(this.app.timbreB.rawData) : null,
                            hardwareResponsive: this.app.midi ? this.app.midi.hardwareResponsive : null
                        };
                        this.broadcast('SYNC_LEADER_STATE', payload);
                    }
                    break;
                case 'SYNC_LEADER_STATE':
                    if ((!data.targetTabId || data.targetTabId === this.tabId) && !this.isLeader) {
                        if (this.app && typeof this.app.applyLeaderState === 'function') {
                            this.app.applyLeaderState(data);
                        }
                    }
                    break;
            }
        } catch (err) {
            console.error('[TabSync] Error applying remote sync message:', err, data);
        } finally {
            this._isApplyingRemoteSync = false;
        }
    }

    destroy() {
        if (this._releaseLock) {
            this._releaseLock();
            this._releaseLock = null;
        }
        if (this._fallbackLeaseInterval) {
            clearInterval(this._fallbackLeaseInterval);
            this._fallbackLeaseInterval = null;
        }
        if (typeof window !== 'undefined' && window.localStorage) {
            try {
                if (window.localStorage.getItem(TabSyncManager.FALLBACK_LEASE_KEY_ID) === this.tabId) {
                    window.localStorage.removeItem(TabSyncManager.FALLBACK_LEASE_KEY_ID);
                    window.localStorage.removeItem(TabSyncManager.FALLBACK_LEASE_KEY_TS);
                }
            } catch (e) {}
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
