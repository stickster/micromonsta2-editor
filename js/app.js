/**
 * Main Application Controller for MicroMonsta 2 HTML Editor and Patch Librarian
 */

const SECTION_TO_MTX_SRC = {
    lfo: { label: 'LFO', indices: { 1: 18, 2: 24, 3: 30 } },
    env: { label: 'Env', indices: { 1: 12, 2: 14, 3: 16 } },
    mult: { label: 'Mult', indices: { 1: 42, 2: 43 } }
};

const PARAM_TO_MTX_DST = {
    OSC1_TUNE: 2,
    OSC2_TUNE: 3,
    OSC3_TUNE: 4,
    OSC1_SHAPE: 5,
    OSC2_SHAPE: 6,
    OSC3_SHAPE: 7,
    MIX_OSC1: 9,
    MIX_OSC2: 10,
    MIX_OSC3: 11,
    MIX_NOISE: 12,
    FILTER_FREQ: 13,
    FILTER_RESO: 14,
    FILTER_FM: 15,
    DRIVE_VOICE: 16,
    VCE_GLIDE: 17,
    LAY_MASTER_VOLUME: 18,
    VCE_PAN_SPREAD: 19,
    ENV1_ATK: 20,
    ENV2_ATK: 21,
    ENV3_ATK: 22,
    ENV1_DCY: 24,
    ENV2_DCY: 25,
    ENV3_DCY: 26,
    ENV1_SUS: 28,
    ENV2_SUS: 29,
    ENV3_SUS: 30,
    ENV1_REL: 32,
    ENV2_REL: 33,
    ENV3_REL: 34,
    LFO1_SPEED: 36,
    LFO2_SPEED: 37,
    LFO3_SPEED: 38,
    DLY_PARAM1: 40,
    DLY_PARAM2: 41,
    DLY_PARAM3: 42,
    REV_PARAM3: 43,
    ARP_GATE: 44
};

/**
 * Escapes HTML special characters for safe interpolation into markup or attributes.
 * @param {*} value
 * @returns {string}
 */
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

class App {
    static get VERSION() {
        return typeof APP_VERSION !== 'undefined' ? APP_VERSION : '0.1.0';
    }

    constructor() {
        this.midi = new MidiManager();
        this.librarian = new PatchLibrarian();
        this.tabSync = (typeof TabSyncManager !== 'undefined') ? new TabSyncManager(this) : null;

        this.timbreA = new MM2Program();
        this.timbreB = new MM2Program();
        this.activeSlot = 0; // 0 for Part A, 1 for Part B

        this.currentView = 'editor'; // 'editor' | 'librarian' | 'settings'
        this.activeCategoryFilter = 'all';
        this.searchQuery = '';
        this.synthTimbralMode = this._readStorage('mm2_timbral_mode') || 'monotimbral';

        // Live Editing, History & Compare State
        this.undoStack = [];
        this.redoStack = [];
        let savedUndoLevels = 20;
        const storedUndo = this._readStorage('mm2_undo_levels');
        if (storedUndo !== null) {
            const parsed = parseInt(storedUndo, 10);
            if (!isNaN(parsed) && parsed >= 1 && parsed <= 100) {
                savedUndoLevels = parsed;
            }
        }
        this.maxHistory = savedUndoLevels;
        this._activeUndoGroup = null;
        this.originalSnapshotA = this.timbreA.clone();
        this.originalSnapshotB = this.timbreB.clone();
        this.isComparing = false;
        this.compareSavedProgram = null;

        this.memories = [null, null, null, null];
        this._activeMemoryDrag = null;
        this._activeLibrarianDrag = null;
        this.selectedProgIndices = new Set();
        this._lastSelectedProgIndex = null;
        this.loadMemories();

        // Sound Design Solo & Mute States & Active Tabs
        this.selectedOsc = 1; // Active oscillator tab (1, 2, or 3)
        this.selectedEnv = 1; // Active envelope tab (1, 2, or 3)
        this._activeDragSection = null;
        this._activeDragMtxField = null;
        this.soloState = { osc1: false, osc2: false, osc3: false, noise: false };
        this.muteState = { osc1: false, osc2: false, osc3: false, noise: false };
        this.savedMixerLevels = null;
        this.syncStatus = 'offline'; // 'synced' | 'modified' | 'streaming' | 'fetching' | 'failed' | 'offline'
        this.modeProbeTimeoutMs = 1500; // How long to wait for a Part B reply before assuming monotimbral
        this._modeProbe = null;
        this._pendingProbe = null;
        this._fetchTimeout = null;
        this._modeProbeTimeout = null;
        this._syncStreamTimeout = null;
        this._toastTimeout = null;
        this._hasDetectedMM2Once = false;
        this._hadBothPortsConnected = false;
        this._isPromptingSync = false;
        this._enableLiveSyncOnFetch = false;
        this._syncActionRequireVerified = false;
        this._checkingLiveSync = false;
        this._pendingPortTest = null;
        this._paramControlMap = new Map();

        this.bindEvents();
    }

    getTimbre(slot) {
        return slot === 1 ? this.timbreB : this.timbreA;
    }

    _setOriginalSnapshot(slot, timbre = this.getTimbre(slot)) {
        const snapshot = timbre.clone();
        if (slot === 1) {
            this.originalSnapshotB = snapshot;
        } else {
            this.originalSnapshotA = snapshot;
        }
    }

    get isFollowerTab() {
        return !!(this.tabSync && (this.tabSync.isLeader === false || this.tabSync.isFollower));
    }

    _readStorage(key) {
        if (typeof window === 'undefined' || !window.localStorage) return null;
        try {
            return window.localStorage.getItem(key);
        } catch (e) {
            return null;
        }
    }

    _writeStorage(key, val) {
        if (typeof window === 'undefined' || !window.localStorage) return false;
        try {
            window.localStorage.setItem(key, val);
            return true;
        } catch (e) {
            return false;
        }
    }

    _refreshSectionNode(container) {
        if (!container || typeof container.querySelectorAll !== 'function') return;
        container.querySelectorAll('[data-param]').forEach(el => el.refresh && el.refresh());
    }

    getLeaderStateSnapshot() {
        return {
            mode: this.synthTimbralMode,
            timbreA: this.timbreA ? Array.from(this.timbreA.rawData) : null,
            timbreB: this.timbreB ? Array.from(this.timbreB.rawData) : null,
            hardwareResponsive: this.midi ? this.midi.hardwareResponsive : null,
            liveSync: this.midi ? this.midi.liveSync : false
        };
    }

    get activeTimbre() {
        return this.getTimbre(this.activeSlot);
    }

    get isConnectionGood() {
        return !!(
            this.midi &&
            !this.midi.permissionError &&
            this.midi.inPort &&
            this.midi.outPort &&
            this.midi.hardwareResponsive === true
        );
    }

    async init() {
        await this.librarian.init();
        await this.midi.init();

        this.buildEditorUI();
        this.buildLibrarianUI();
        this.buildSettingsUI();
        this.buildAuditionUI();
        this.updateConnectionStatus();
        this.updateMidiPermissionUI();
        this.updateTimbralModeUI();
        this.updateSyncStatus(this.isConnectionGood ? 'synced' : 'offline');
        this.updateUndoRedoUI();
        this.updateLiveSyncUI();
        this.updateFirmwareUI();
        this.setupKeyboardShortcuts();
        this.setupControlFocusCleanup();

        // On load, always start in Editor mode
        this.switchView('editor');

        // Verify hardware reachability immediately when both MIDI I/O ports are already set
        this._probeIfNeeded();
    }

    _probeIfNeeded(timeoutMs = 2500, options = {}) {
        if (
            !this.isFollowerTab &&
            this.midi &&
            this.midi.inPort &&
            this.midi.outPort &&
            this.midi.hardwareResponsive === null &&
            !this.midi._isProbing
        ) {
            return this.midi.probeHardware(timeoutMs, options);
        }
        return false;
    }

    async handleMidiStatusClick() {
        if (!this.midi.midiAccess) {
            await this.midi.reconnect();
            this.updateConnectionStatus();
            this.updateSettingsPortLists();
            this.updateMidiPermissionUI();
            this._probeIfNeeded();
        }
        this.switchView('settings');
    }

    setupKeyboardShortcuts() {
        if (typeof window === 'undefined') return;
        window.addEventListener('keydown', (e) => {
            const activeTag = document.activeElement ? document.activeElement.tagName : '';
            if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    this.redo();
                } else {
                    this.undo();
                }
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                this.redo();
            }
        });
    }

    /**
     * Remove focus from buttons and select dropdowns after interaction so
     * QWERTY keyboard piano notes do not visually highlight or re-trigger them.
     */
    setupControlFocusCleanup() {
        if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
        if (document._mm2FocusCleanupBound) return;
        document._mm2FocusCleanupBound = true;

        document.addEventListener('click', (e) => {
            const target = e.target;
            const btn = target && typeof target.closest === 'function'
                ? target.closest('button')
                : (target && target.tagName === 'BUTTON' ? target : null);
            if (btn && typeof btn.blur === 'function') {
                btn.blur();
            }
        }, true);

        document.addEventListener('change', (e) => {
            const target = e.target;
            if (target && target.tagName === 'SELECT' && typeof target.blur === 'function') {
                target.blur();
            }
        }, true);
    }

    bindEvents() {
        this._bindMidiConnectionEvents();
        this._bindMidiDataEvents();

        // Librarian Listeners
        this.librarian.on('update', (data) => {
            this.renderLibrarianBank();
            if (data && data.type === 'save' && this.tabSync) {
                this.tabSync.broadcast('LIBRARIAN_CHANGED');
            }
        });
    }

    _bindMidiConnectionEvents() {
        // MM2 Detection Listener
        this.midi.on('mm2-detected', ({ inPort }) => {
            // When an additional window opens, it acts as a follower.
            // Do not run a hardware fetch; sync from leader window instead.
            if (this.isFollowerTab) {
                this._hasDetectedMM2Once = true;
                this.updateConnectionStatus();
                this.tabSync.requestLeaderState();
                return;
            }
            const isReconnect = this._hasDetectedMM2Once;
            this._hasDetectedMM2Once = true;
            this._hadBothPortsConnected = true;
            this.promptReconnectSync({ isReconnect, portName: inPort && inPort.name });
        });

        // Firmware Detection Listener
        this.midi.on('firmware-detected', ({ detectedVersion }) => {
            this.updateFirmwareUI();
            if (detectedVersion === 2) {
                this.showNotification('Firmware v2.x detected: adapted UI, SysEx (176-byte), and v2 NRPNs.', 'info');
            }
        });

        this.midi.on('port-change', () => {
            this.updateConnectionStatus();
            this.updateSettingsPortLists();
            this.updateMidiPermissionUI();

            const hasBothPorts = !!(this.midi.inPort && this.midi.outPort);
            if (hasBothPorts && !this._hadBothPortsConnected) {
                this._hadBothPortsConnected = true;
                this.resetAuditionLatch();
                const isMM2Pair = this.midi.isMM2Port(this.midi.inPort) && this.midi.isMM2Port(this.midi.outPort);
                if (!isMM2Pair && !this.isFollowerTab) {
                    const isReconnect = this._hasDetectedMM2Once;
                    this._hasDetectedMM2Once = true;
                    this.promptReconnectSync({
                        isReconnect,
                        portName: this.midi.outPort.name || this.midi.inPort.name
                    });
                }
            } else if (!hasBothPorts) {
                if (this._hadBothPortsConnected) {
                    this.resetAuditionLatch();
                }
                this._hadBothPortsConnected = false;
            }
        });

        this.midi.on('hardware-responsiveness-changed', ({ responsive, previous, isRemote }) => {
            if (responsive !== previous) {
                this.resetAuditionLatch();
            }
            if (responsive === true && this.syncStatus === 'failed') {
                this.updateSyncStatus(this.midi.liveSync ? 'synced' : 'modified');
            } else if (responsive === false && (this.syncStatus === 'synced' || this.syncStatus === 'streaming' || this.syncStatus === 'fetching')) {
                this.updateSyncStatus('failed');
            }
            this.updateConnectionStatus();
            if (!isRemote && this.tabSync && this.tabSync.isLeader) {
                this.tabSync.broadcast('HARDWARE_STATUS', { responsive });
            }
        });

        this.midi.on('hardware-timeout', ({ outPort }) => {
            this.updateConnectionStatus();
            this.showNotification(`Hardware timeout: No response from MM2 on ${outPort ? outPort.name : 'selected port'}. Check router or MIDI cables.`, 'warning');
        });

        this.midi.on('probe-start', ({ timeoutMs }) => {
            if (this.tabSync && this.tabSync.isLeader) {
                this.tabSync.broadcast('HARDWARE_PROBE_START', { timeoutMs });
            }
        });

        this.midi.on('probe-end', ({ success }) => {
            if (this._pendingPortTest) {
                const { type, name } = this._pendingPortTest;
                this._pendingPortTest = null;
                if (success) {
                    this.showNotification(`MIDI ${type} "${name}" connected and verified.`, 'success');
                }
            }
            if (this.tabSync && this.tabSync.isLeader) {
                this.tabSync.broadcast('HARDWARE_PROBE_END', { success });
            }
        });

        this.midi.on('base-channel-changed', (ch) => {
            const selChan = document.getElementById('settings-base-channel');
            if (selChan) selChan.value = ch;
        });

        this.midi.on('state-change', () => {
            this.updateConnectionStatus();
            this.updateSettingsPortLists();
            this.updateMidiPermissionUI();
        });

        this.midi.on('permission-error', () => {
            this.updateConnectionStatus();
            this.updateMidiPermissionUI();
        });

        this.midi.on('connection-lost', ({ port, type }) => {
            this.resetAuditionLatch();
            const name = (port && port.name) ? port.name : 'MicroMonsta 2';
            // Cancel any pending fetch or timbral mode probe timeouts to prevent false fetch error warnings or crashes
            if (this._fetchTimeout) {
                clearTimeout(this._fetchTimeout);
                this._fetchTimeout = null;
            }
            if (this._modeProbeTimeout) {
                clearTimeout(this._modeProbeTimeout);
                this._modeProbeTimeout = null;
            }
            this._pendingProbe = null;
            this._modeProbe = null;
            this._enableLiveSyncOnFetch = false;
            this._pendingPortTest = null;
            if (this.syncStatus === 'fetching') {
                this.updateSyncStatus(this.midi.liveSync ? 'synced' : 'modified');
            } else if (this.syncStatus === 'synced' || this.syncStatus === 'streaming') {
                this.updateSyncStatus('failed');
            }

            this.showNotification(`⚠️ MIDI Connection Lost: ${name} (${type}) disconnected. Reconnecting automatically when plugged back in...`, 'warning');
            this.updateConnectionStatus();
            this.updateSettingsPortLists();
            this._probeIfNeeded();
        });

        this.midi.on('connection-restored', ({ port, type }) => {
            this.resetAuditionLatch();
            const name = (port && port.name) ? port.name : 'MicroMonsta 2';
            this.showNotification(`✓ MIDI Connection Restored: ${name} (${type})`, 'success');
            if (this.syncStatus === 'failed' && this.midi.inPort && this.midi.outPort) {
                this.updateSyncStatus(this.midi.liveSync && this.isConnectionGood ? 'synced' : 'modified');
            }
            this.updateConnectionStatus();
            this.updateSettingsPortLists();
            // Retry probing across a few seconds so USB-powered MM2 hardware has time to boot
            this._probeIfNeeded(1200, { retries: 4 });
        });

        this.midi.on('error', (err) => {
            this.showNotification(err, 'error');
            this.updateMidiPermissionUI();
        });
    }

    _bindMidiDataEvents() {
        // MIDI Event Listeners
        this.midi.on('program-received', ({ program, slot, isProbe }) => {
            clearTimeout(this._fetchTimeout);
            console.log(`Captured program from MM2: "${program.name}" for slot ${slot}${isProbe ? ' (probe response)' : ''}`);

            // If this was a health check probe / periodic poll, do not overwrite editor or sync status
            if (isProbe) {
                return;
            }

            // In follower windows, do not process unprompted hardware dumps (e.g. from leader polls or leader fetches).
            // State is synchronized from the leader window via TabSync.
            if (this.isFollowerTab && this.syncStatus !== 'fetching' && !this._modeProbe) {
                return;
            }

            let skipLoad = false;
            if (slot === 1) {
                // A Part B reply means the MM2 has two active layers (bitimbral); no reply means monotimbral
                if (this.synthTimbralMode === 'monotimbral') {
                    this.setTimbralMode('bitimbral');
                }
                if (this._modeProbe) {
                    clearTimeout(this._modeProbeTimeout);
                    skipLoad = !this._modeProbe.loadPartB;
                    this._modeProbe = null;
                }
                if (this.midi) {
                    this.midi.lastFetchedSlot = 0;
                }
            }
            if (skipLoad) {
                // Mode probe only: leave the editor's Part B untouched
                return;
            }
            const partLabel = slot === 1 ? 'B' : 'A';
            this.resetAuditionLatch();
            this.replacePartWithRawData(slot, program.rawData, `Fetch Part ${partLabel} (${program.name})`, {
                sendToHardware: false,
                syncStatus: this.isConnectionGood ? 'synced' : 'offline',
                source: 'hardware'
            });
            this._setOriginalSnapshot(slot);
            // When loading Editor or working in Editor, do not add patch to Librarian!
            // Only capture while the Librarian view is open; dumps go to the currently selected bank
            if (this.currentView === 'librarian') {
                this.librarian.handleIncomingProgram(program);
            }
            this.showNotification('Loaded MM2 hardware patch', 'success');
            if (this._enableLiveSyncOnFetch) {
                this._enableLiveSyncOnFetch = false;
                this._setLiveSyncState(true);
                this.showNotification('Live Sync ENABLED (Fetched MM2 hardware settings)', 'success');
            }

            // Part A was just read: probe Part B to find out whether the MM2 has one or two active layers
            if (slot === 0 && this._pendingProbe) {
                const probe = this._pendingProbe;
                this._pendingProbe = null;
                setTimeout(() => this.probeTimbralMode({ loadPartB: probe === 'load' }), 150);
            }
        });

        // Real-Time Hardware Parameter Tweak Listener (from physical MM2 knobs via CC or NRPN)
        this.midi.on('parameter-received', ({ paramKey, value, slot }) => {
            this._applyIncomingParamToUI(paramKey, value, slot, {
                autoSwitchTab: true,
                updateSync: true
            });
        });
    }

    updateConnectionStatus() {
        this.updateLiveSyncUI();
        this._updateSyncActionDialogState();
        if (!this.isConnectionGood && (this.syncStatus === 'synced' || this.syncStatus === 'streaming')) {
            this.updateSyncStatus(this.midi && this.midi.hardwareResponsive === false ? 'failed' : 'offline');
        }
        if (typeof document === 'undefined') return;

        const dot = document.getElementById('midi-status-dot');
        const text = document.getElementById('midi-status-text');
        if (!dot || !text) return;

        if (this.midi.permissionError) {
            dot.className = 'status-dot disconnected';
            text.textContent = 'MIDI Blocked (Click to setup)';
            text.title = `Web MIDI Error: ${this.midi.permissionError}\nClick to grant permissions.`;
            return;
        }

        const inName = this.midi.inPort ? this.midi.inPort.name : 'None';
        const outName = this.midi.outPort ? this.midi.outPort.name : 'None';

        if (this.midi.inPort && this.midi.outPort) {
            const isVerified = this.midi.hardwareResponsive === true;

            if (this.midi.hardwareResponsive === false) {
                dot.className = 'status-dot disconnected unresponsive';
                text.textContent = `No Response`;
                text.title = `Port open (${outName}), but MicroMonsta 2 hardware is not responding to SysEx/MIDI.\nCheck power and MIDI connections.`;
            } else if (!isVerified) {
                dot.className = 'status-dot standby';
                text.textContent = `Standby`;
                text.title = `Port connected (${outName}), awaiting handshake or response from MicroMonsta 2 hardware.`;
            } else {
                dot.className = 'status-dot connected';
                text.textContent = `Connected`;
                text.title = `In: ${inName}\nOut: ${outName}`;
            }
        } else if (this.midi.inPort || this.midi.outPort) {
            dot.className = 'status-dot partial';
            text.textContent = `Partial: ${outName || inName}`;
        } else {
            dot.className = 'status-dot disconnected';
            text.textContent = 'Disconnected';
        }
    }

    updateMidiPermissionUI() {
        if (typeof document === 'undefined') return;
        const banner = document.getElementById('midi-permission-banner');
        const text = document.getElementById('midi-permission-text');
        if (!banner && !text) return;

        if (!this.midi.isSupported) {
            if (banner) {
                banner.style.display = 'block';
                banner.className = 'midi-permission-banner';
                banner.innerHTML = '<strong>Web MIDI Not Supported:</strong> Your browser does not support Web MIDI. Please use Google Chrome, Microsoft Edge, or Opera.';
            }
            if (text) text.textContent = 'Web MIDI unsupported in this browser';
            return;
        }

        if (this.midi.permissionError) {
            if (banner) {
                banner.style.display = 'block';
                banner.className = 'midi-permission-banner';
                banner.innerHTML = `<strong>Web MIDI Access Blocked:</strong> ${this.midi.permissionError}.<br>` +
                    'Google Chrome requires explicit user permission for Web MIDI & SysEx. ' +
                    'Click <strong>Scan / Reconnect MIDI Devices</strong> below, or click the site settings icon (tune/lock) in Chrome\'s address bar and set <strong>MIDI devices</strong> to <strong>Allow</strong>.';
            }
            if (text) text.textContent = 'Permission blocked by browser';
            return;
        }

        if (!this.midi.midiAccess) {
            if (banner) {
                banner.style.display = 'block';
                banner.className = 'midi-permission-banner info';
                banner.innerHTML = '<strong>Web MIDI Pending:</strong> Click <strong>Scan / Reconnect MIDI Devices</strong> to request access from Chrome.';
            }
            if (text) text.textContent = 'Click to connect';
            return;
        }

        // Web MIDI active
        if (banner) {
            banner.style.display = 'none';
        }
        if (text) {
            const inName = this.midi.inPort ? this.midi.inPort.name : 'None';
            const outName = this.midi.outPort ? this.midi.outPort.name : 'None';
            text.textContent = `Web MIDI active (In: ${inName}, Out: ${outName})`;
        }
    }

    switchView(viewName) {
        this.currentView = viewName;
        if (typeof document === 'undefined') return;
        document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));

        const targetView = document.getElementById(`view-${viewName}`);
        const targetTab = document.getElementById(`tab-${viewName}`);
        if (targetView) targetView.classList.add('active');
        if (targetTab) targetTab.classList.add('active');

        if (viewName === 'librarian') {
            this.renderLibrarianBank();
        }
    }

    onModeSelectChange() {
        // Mode indicator is display-only and cannot be changed from the editor UI
        this.showNotification('Synth Timbral Mode is display-only and must be adjusted directly on MM2 hardware.', 'info');
        return false;
    }

    setTimbralMode(mode) {
        const validModes = ['monotimbral', 'bitimbral', 'combi'];
        if (!validModes.includes(mode)) return;
        this.synthTimbralMode = mode;
        this._writeStorage('mm2_timbral_mode', mode);
        if (mode === 'monotimbral' && this.activeSlot !== 0) {
            this.selectPart(0);
        }
        this.updateTimbralModeUI();
        if (this.auditionKeyboard && typeof this.auditionKeyboard.enforceVoiceLimit === 'function') {
            this.auditionKeyboard.enforceVoiceLimit();
        }
        if (this.tabSync) {
            this.tabSync.broadcast('TIMBRAL_MODE_CHANGED', { mode });
        }
    }

    updateTimbralModeUI() {
        if (typeof document === 'undefined') return;
        const isMono = this.synthTimbralMode === 'monotimbral';
        const btnPartA = document.getElementById('btn-part-a');
        const btnPartB = document.getElementById('btn-part-b');
        const btnCopyOther = document.getElementById('btn-prog-copy-other');

        if (btnPartA) {
            btnPartA.textContent = isMono ? 'Part A (12V)' : 'Part A (6V)';
            btnPartA.title = isMono
                ? 'Edit Part A (Monotimbral Mode — 12-voice polyphony)'
                : 'Edit Part A (Layer A — 6-voice polyphony)';
        }

        if (btnPartB) {
            btnPartB.style.display = isMono ? 'none' : 'inline-block';
            btnPartB.textContent = 'Part B (6V)';
            btnPartB.title = 'Edit Part B (Layer B — 6-voice polyphony)';
        }

        if (btnCopyOther) {
            // When in monotimbral mode, Copy A/B settings should be hidden!
            btnCopyOther.style.display = isMono ? 'none' : 'inline-flex';
            this.updateCopyPartButtonUI();
        }
    }

    updateCopyPartButtonUI() {
        if (typeof document === 'undefined') return;
        const btnCopyOther = document.getElementById('btn-prog-copy-other');
        if (!btnCopyOther) return;
        const isPartA = this.activeSlot === 0;
        btnCopyOther.textContent = isPartA ? 'Copy A → B' : 'Copy B → A';
        btnCopyOther.title = isPartA ? 'Copy Part A settings to Part B' : 'Copy Part B settings to Part A';
    }

    selectPart(slot) {
        if (this.synthTimbralMode === 'monotimbral' && slot !== 0) {
            this.showNotification('MM2 is in Monotimbral Mode. Switch to Bitimbral or Combi mode on MM2 hardware to edit Part B.', 'info');
            return;
        }
        this.activeSlot = slot;
        this.midi.activeSlot = slot;
        if (this.auditionKeyboard && typeof this.auditionKeyboard.setActivePart === 'function') {
            this.auditionKeyboard.setActivePart(slot);
        }
        if (typeof document !== 'undefined') {
            if (document.body && document.body.classList) {
                document.body.classList.toggle('part-b-active', slot === 1);
            }
            document.querySelectorAll('.part-btn').forEach(btn => {
                btn.classList.toggle('active', parseInt(btn.dataset.slot, 10) === slot);
            });
        }
        this.refreshEditorControls();
        this.updateCopyPartButtonUI();
        this.updateTimbralModeUI();
    }

    setUndoLevels(levels) {
        let parsed = parseInt(levels, 10);
        if (isNaN(parsed)) parsed = 20;
        parsed = Math.min(100, Math.max(1, parsed));
        this.maxHistory = parsed;
        if (this.undoStack.length > this.maxHistory) {
            this.undoStack.splice(0, this.undoStack.length - this.maxHistory);
        }
        this._writeStorage('mm2_undo_levels', this.maxHistory.toString());
        this.updateUndoRedoUI();
        const input = typeof document !== 'undefined' ? document.getElementById('settings-undo-levels') : null;
        if (input && typeof document !== 'undefined' && document.activeElement !== input) {
            input.value = this.maxHistory;
        }
    }

    beginUndoGroup(label = '') {
        this._activeUndoGroup = {
            type: 'batch',
            label,
            slot: this.activeSlot,
            changes: []
        };
    }

    endUndoGroup() {
        if (!this._activeUndoGroup) return;
        const group = this._activeUndoGroup;
        this._activeUndoGroup = null;
        if (group.changes.length === 0) return;

        const first = group.changes[0];
        group.key = first.key;
        group.prevVal = first.prevVal;
        group.newVal = first.newVal;

        this.undoStack.push(group);
        if (this.undoStack.length > this.maxHistory) {
            this.undoStack.shift();
        }
        this.redoStack = [];
        this.updateUndoRedoUI();
    }

    onParameterChanged(key, val, meta = {}) {
        if (this.isComparing) {
            this.toggleCompare(false);
        }

        const isLegacyBool = typeof meta === 'boolean';
        const isInterim = !isLegacyBool && !!meta.isInterim;
        const isFinal = isLegacyBool ? meta : (meta.isFinal ?? !isInterim);
        const prevVal = (!isLegacyBool && meta.prevVal !== undefined)
            ? meta.prevVal
            : this.activeTimbre.getValue(key);

        if (isFinal && prevVal !== val) {
            this.recordUndo(key, prevVal, val, meta.label);
        }
        this.activeTimbre.setValue(key, val);
        if (key === 'ARP_OFF_ON' || (key === 'ARP_LATCH' && !val) || key === 'VCE_UNISON' || key === 'VCE_MODE') {
            this.resetAuditionLatch(this.activeSlot);
        }
        this.refreshVisualizerFor(key);
        if (this.tabSync) {
            this.tabSync.broadcast('PARAM_CHANGE', {
                key,
                val,
                slot: this.activeSlot
            });
        }

        if (this.midi.liveSync) {
            this.midi.sendParameter(key, val);
            this.updateSyncStatus('streaming');
            clearTimeout(this._syncStreamTimeout);
            this._syncStreamTimeout = setTimeout(() => {
                this.updateSyncStatus(this.isConnectionGood ? 'synced' : 'offline');
            }, 500);
        } else {
            this.updateSyncStatus('modified');
        }
    }

    refreshVisualizerFor(key) {
        if (typeof document === 'undefined') return;
        if (key === 'ARP_PTN_LENGTH') {
            const seq = document.getElementById('arp-seq-wrapper');
            if (seq && seq.refresh) seq.refresh();
            return;
        }
        let sel = null;
        if (/^ENV\d_/.test(key)) sel = `.adsr-visualizer[data-env="${key.charAt(3)}"]`;
        else if (key.startsWith('FILTER_') || key === 'DRIVE_VOICE') sel = '.filter-visualizer';
        else if (/^LFO\d_/.test(key)) sel = `.lfo-visualizer[data-lfo="${key.charAt(3)}"]`;
        if (!sel) return;
        const viz = document.querySelector(sel);
        if (viz && viz.refresh) viz.refresh();
    }

    recordUndo(key, prevVal, newVal, label = '') {
        if (prevVal === newVal) return;
        const actionLabel = label || (typeof PARAM_MAP !== 'undefined' && PARAM_MAP.get(key)?.label) || key;
        const action = {
            type: 'param',
            key,
            prevVal,
            newVal,
            slot: this.activeSlot,
            label: actionLabel
        };

        if (this._activeUndoGroup) {
            const existing = this._activeUndoGroup.changes.find(c => c.key === key);
            if (existing) {
                existing.newVal = newVal;
            } else {
                this._activeUndoGroup.changes.push({ key, prevVal, newVal });
            }
            return;
        }

        this.undoStack.push(action);
        if (this.undoStack.length > this.maxHistory) {
            this.undoStack.shift();
        }
        this.redoStack = [];
        this.updateUndoRedoUI();
    }

    _autoSwitchTabFor(key) {
        if (!key) return;
        const oscMatch = key.match(/^OSC(\d)_/);
        if (oscMatch) {
            const oscNum = parseInt(oscMatch[1], 10);
            if (oscNum >= 1 && oscNum <= 3 && this.selectedOsc !== oscNum) {
                this.selectedOsc = oscNum;
            }
        }
        const envMatch = key.match(/^ENV(\d)_/);
        if (envMatch) {
            const envNum = parseInt(envMatch[1], 10);
            if (envNum >= 1 && envNum <= 3 && this.selectedEnv !== envNum) {
                this.selectedEnv = envNum;
            }
        }
    }

    undo() {
        this._applyHistoryStep(false);
    }

    redo() {
        this._applyHistoryStep(true);
    }

    _getHistoryActionLabel(action) {
        if (!action) return '';
        if (action.type === 'part-snapshot') return action.label || 'Part Change';
        if (action.type === 'bank-snapshot') return action.label || 'Bank Change';
        return action.label || (typeof PARAM_MAP !== 'undefined' && PARAM_MAP.get(action.key)?.label) || action.key || 'Change';
    }

    _applyHistoryStep(isRedo) {
        const sourceStack = isRedo ? this.redoStack : this.undoStack;
        const targetStack = isRedo ? this.undoStack : this.redoStack;
        if (sourceStack.length === 0) return;

        const action = sourceStack.pop();
        targetStack.push(action);

        if (action.slot !== undefined && this.activeSlot !== action.slot) {
            this.selectPart(action.slot);
        }

        const prefix = isRedo ? 'Redo' : 'Undo';
        const actionLabel = this._getHistoryActionLabel(action);
        if (action.type === 'part-snapshot') {
            const rawData = isRedo ? action.newRawData : action.prevRawData;
            this._applyPartSnapshot(action.slot, rawData, isRedo ? 'redo' : 'undo', `${prefix}: ${actionLabel}`);
            return;
        }
        if (action.type === 'bank-snapshot') {
            const programs = isRedo ? action.newPrograms : action.prevPrograms;
            this._applyBankSnapshot(action.bankIndex, programs, `${prefix}: ${actionLabel}`);
            return;
        }

        const applyChange = (key, val) => {
            this.activeTimbre.setValue(key, val);
            if (this.midi.liveSync) {
                this.midi.sendParameter(key, val);
            }
            this.refreshVisualizerFor(key);
        };

        if (action.changes && Array.isArray(action.changes)) {
            for (const ch of action.changes) {
                applyChange(ch.key, isRedo ? ch.newVal : ch.prevVal);
            }
            if (action.changes.length > 0) {
                this._autoSwitchTabFor(action.changes[0].key);
            }
        } else {
            applyChange(action.key, isRedo ? action.newVal : action.prevVal);
            this._autoSwitchTabFor(action.key);
        }

        this.refreshEditorControls();
        this.updateUndoRedoUI();
        this.showNotification(`${prefix}: ${actionLabel}`, 'info');
    }

    _recordBankUndo(bankIndex, prevPrograms, newPrograms, label) {
        this.undoStack.push({
            type: 'bank-snapshot',
            bankIndex,
            prevPrograms,
            newPrograms,
            label
        });
        if (this.undoStack.length > this.maxHistory) {
            this.undoStack.shift();
        }
        this.redoStack = [];
        this.updateUndoRedoUI();
    }

    _applyBankSnapshot(bankIndex, programsRaw, toastMsg) {
        const bank = this.librarian && this.librarian.banks[bankIndex];
        if (!bank) return;
        bank.programs = programsRaw.map(bytes => new MM2Program(new Uint8Array(bytes)));
        if (this.librarian.activeBankIndex !== bankIndex) {
            this.librarian.activeBankIndex = bankIndex;
        }
        if (this.selectedProgIndices) this.selectedProgIndices.clear();
        this._lastSelectedProgIndex = null;
        this.librarian.saveAllBanks();
        this.renderLibrarianBank();
        this.updateUndoRedoUI();
        this.showNotification(toastMsg, 'info');
    }

    _bindClickAndHold(btn, { onClick, onHold, holdMs = 450 }) {
        if (!btn) return;
        let holdTimer = null;
        let held = false;
        let startX = 0;
        let startY = 0;

        const clearTimer = () => {
            if (holdTimer !== null) {
                clearTimeout(holdTimer);
                holdTimer = null;
            }
        };

        if (typeof btn.addEventListener === 'function') {
            btn.addEventListener('pointerdown', (e) => {
                if (btn.disabled || (e.button !== undefined && e.button !== 0)) return;
                clearTimer();
                held = false;
                startX = e.clientX || 0;
                startY = e.clientY || 0;
                holdTimer = setTimeout(() => {
                    holdTimer = null;
                    held = true;
                    onHold();
                }, holdMs);
            });

            btn.addEventListener('pointermove', (e) => {
                if (holdTimer === null) return;
                const dx = (e.clientX || 0) - startX;
                const dy = (e.clientY || 0) - startY;
                if (Math.hypot(dx, dy) > 5) {
                    clearTimer();
                }
            });

            btn.addEventListener('pointerup', clearTimer);
            btn.addEventListener('pointercancel', clearTimer);
            btn.addEventListener('dragstart', clearTimer);
        }

        btn.onclick = (e) => {
            if (held) {
                held = false;
                if (e && typeof e.preventDefault === 'function') e.preventDefault();
                if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
                return;
            }
            onClick();
        };
    }

    _closeHistoryMenu() {
        if (this._historyMenuCleanup) {
            this._historyMenuCleanup();
            this._historyMenuCleanup = null;
        }
        if (this._historyMenuEl && this._historyMenuEl.parentNode) {
            this._historyMenuEl.parentNode.removeChild(this._historyMenuEl);
        }
        this._historyMenuEl = null;
    }

    _showHistoryMenu(isRedo, anchorBtn) {
        if (typeof document === 'undefined') return;
        const stack = isRedo ? this.redoStack : this.undoStack;
        if (!stack || stack.length === 0) return;

        this._closeHistoryMenu();

        const count = Math.min(stack.length, 15);
        const menu = document.createElement('div');
        menu.className = 'history-popover';
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', isRedo ? 'Redo history' : 'Undo history');

        const header = document.createElement('div');
        header.className = 'history-popover-header';
        header.textContent = isRedo ? `Redo (${count})` : `Undo (${count})`;
        menu.appendChild(header);

        for (let i = 0; i < count; i++) {
            const action = stack[stack.length - 1 - i];
            const steps = i + 1;
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'menu-item history-popover-item';
            item.setAttribute('role', 'menuitem');
            item.setAttribute('data-steps', String(steps));
            item.textContent = this._getHistoryActionLabel(action);
            item.title = `${isRedo ? 'Redo' : 'Undo'} ${steps} ${steps === 1 ? 'step' : 'steps'}`;
            item.onclick = (ev) => {
                if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
                this._closeHistoryMenu();
                for (let s = 0; s < steps; s++) {
                    if (isRedo) this.redo();
                    else this.undo();
                }
            };
            menu.appendChild(item);
        }

        const host = (anchorBtn && (anchorBtn.parentElement || anchorBtn.parentNode)) || document.body;
        if (host && typeof host.appendChild === 'function') {
            host.appendChild(menu);
        }
        this._historyMenuEl = menu;

        if (typeof document.addEventListener === 'function') {
            const onDocPointerDown = (ev) => {
                if (menu.contains && ev.target && menu.contains(ev.target)) return;
                this._closeHistoryMenu();
            };
            const onDocKeyDown = (ev) => {
                if (ev.key === 'Escape') this._closeHistoryMenu();
            };
            document.addEventListener('pointerdown', onDocPointerDown);
            document.addEventListener('keydown', onDocKeyDown);
            this._historyMenuCleanup = () => {
                document.removeEventListener('pointerdown', onDocPointerDown);
                document.removeEventListener('keydown', onDocKeyDown);
            };
        }
    }

    updateUndoRedoUI() {
        if (typeof document === 'undefined') return;
        const btnUndo = document.getElementById('btn-prog-undo');
        const btnRedo = document.getElementById('btn-prog-redo');
        if (btnUndo) {
            btnUndo.disabled = this.undoStack.length === 0;
            if (this.undoStack.length > 0) {
                const label = this._getHistoryActionLabel(this.undoStack[this.undoStack.length - 1]);
                btnUndo.title = `Undo: ${label} (Ctrl+Z)`;
            } else {
                btnUndo.title = 'Undo change (Ctrl+Z)';
            }
        }
        if (btnRedo) {
            btnRedo.disabled = this.redoStack.length === 0;
            if (this.redoStack.length > 0) {
                const label = this._getHistoryActionLabel(this.redoStack[this.redoStack.length - 1]);
                btnRedo.title = `Redo: ${label} (Ctrl+Y)`;
            } else {
                btnRedo.title = 'Redo change (Ctrl+Y)';
            }
        }
    }

    /**
     * Restores a 216-byte part snapshot for undo/redo and refreshes UI/sync state.
     */
    _applyPartSnapshot(slot, rawData, source, notificationText) {
        const targetTimbre = this.getTimbre(slot);
        targetTimbre.rawData = new Uint8Array(rawData);
        if (this.midi && this.midi.liveSync && this.midi.outPort) {
            this.midi.sendProgram(targetTimbre, slot);
        }
        this.refreshEditorControls();
        this.updateUndoRedoUI();
        this.updateSyncStatus('modified');
        if (this.tabSync) {
            this.tabSync.broadcast('PATCH_LOADED', {
                slot,
                rawData: Array.from(targetTimbre.rawData),
                source
            });
        }
        if (notificationText) {
            this.showNotification(notificationText, 'info');
        }
    }

    /**
     * Replaces an entire Part's state as a single atomic undoable step.
     */
    replacePartWithRawData(targetSlot, rawData, label = 'Replace Part', options = {}) {
        const {
            sendToHardware = true,
            syncStatus = 'modified',
            source = 'memory',
            clearUndo = false,
            setOriginalSnapshot = false,
            broadcast = true
        } = options;
        if (this.isComparing) {
            this.toggleCompare(false);
        }
        const targetTimbre = this.getTimbre(targetSlot);
        const prevRawData = new Uint8Array(targetTimbre.rawData);
        const nextRawData = new Uint8Array(rawData);

        if (clearUndo) {
            this.undoStack = [];
            this.redoStack = [];
        } else {
            this.undoStack.push({
                type: 'part-snapshot',
                slot: targetSlot,
                prevRawData,
                newRawData: nextRawData,
                label
            });
            if (this.undoStack.length > this.maxHistory) {
                this.undoStack.shift();
            }
            this.redoStack = [];
        }

        targetTimbre.rawData = nextRawData;
        if (setOriginalSnapshot) {
            this._setOriginalSnapshot(targetSlot, targetTimbre);
        }
        if (sendToHardware && this.midi && this.midi.liveSync && this.midi.outPort) {
            this.midi.sendProgram(targetTimbre, targetSlot);
        }
        this.refreshEditorControls();
        this.updateUndoRedoUI();
        if (syncStatus !== null) {
            this.updateSyncStatus(syncStatus);
        }
        if (broadcast && this.tabSync) {
            this.tabSync.broadcast('PATCH_LOADED', {
                slot: targetSlot,
                rawData: Array.from(targetTimbre.rawData),
                source
            });
        }
    }

    loadMemories() {
        const raw = this._readStorage('mm2_memories');
        if (!raw) return;
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return;
            for (let i = 0; i < 4; i++) {
                const entry = parsed[i];
                if (Array.isArray(entry) && entry.length === 216) {
                    this.memories[i] = new MM2Program(new Uint8Array(entry));
                }
            }
        } catch (e) { }
    }

    saveMemories() {
        const payload = this.memories.map(m => (m ? Array.from(m.rawData) : null));
        this._writeStorage('mm2_memories', JSON.stringify(payload));
    }

    updateMemoryUI() {
        if (typeof document === 'undefined') return;
        for (let i = 0; i < 4; i++) {
            const btn = document.getElementById(`btn-mem-${i}`);
            if (!btn) continue;
            const mem = this.memories[i];
            btn.classList.toggle('populated', !!mem);
            btn.title = mem
                ? `Memory M${i + 1}: "${mem.name}" (click to load, drag to copy)`
                : `Memory M${i + 1} (Empty — drag a Part or Memory here)`;
        }
        const btnClear = document.getElementById('btn-mem-clear');
        if (btnClear) {
            btnClear.disabled = !this.memories.some(Boolean);
        }
    }

    clearMemories() {
        const hadMemories = this.memories.some(Boolean);
        this.memories = [null, null, null, null];
        this.saveMemories();
        this.updateMemoryUI();
        if (hadMemories) {
            this.showNotification('Cleared all patch memories (M1-M4)', 'info');
        }
    }

    loadMemoryToActivePart(memIdx) {
        if (memIdx < 0 || memIdx >= 4 || !this.memories[memIdx]) {
            this.showNotification(`Memory M${memIdx + 1} is empty. Drag a Part or Memory onto M${memIdx + 1} to store.`, 'info');
            return false;
        }
        const mem = this.memories[memIdx];
        const partLabel = this.activeSlot === 0 ? 'A' : 'B';
        this.replacePartWithRawData(this.activeSlot, mem.rawData, `Load M${memIdx + 1} into Part ${partLabel}`);
        this.showNotification(`Loaded Memory M${memIdx + 1} ("${mem.name}") into Part ${partLabel}`, 'success');
        return true;
    }

    storePartInMemory(srcSlot, memIdx) {
        if (memIdx < 0 || memIdx >= 4) return false;
        const srcTimbre = srcSlot === 1 ? this.timbreB : this.timbreA;
        if (srcTimbre.isInit()) {
            this.memories[memIdx] = null;
            this.saveMemories();
            this.updateMemoryUI();
            this.showNotification(`Cleared Memory M${memIdx + 1}`, 'info');
            return true;
        }
        this.memories[memIdx] = new MM2Program(new Uint8Array(srcTimbre.rawData));
        this.saveMemories();
        this.updateMemoryUI();
        const partLabel = srcSlot === 0 ? 'A' : 'B';
        this.showNotification(`Stored Part ${partLabel} ("${srcTimbre.name}") in Memory M${memIdx + 1}`, 'success');
        return true;
    }

    copyMemory(srcIdx, dstIdx) {
        if (srcIdx === dstIdx || srcIdx < 0 || srcIdx >= 4 || dstIdx < 0 || dstIdx >= 4) return false;
        const srcMem = this.memories[srcIdx];
        if (!srcMem) return false;
        this.memories[dstIdx] = new MM2Program(new Uint8Array(srcMem.rawData));
        this.saveMemories();
        this.updateMemoryUI();
        this.showNotification(`Copied Memory M${srcIdx + 1} ("${srcMem.name}") to M${dstIdx + 1}`, 'success');
        return true;
    }

    async addMemoryToCurrentBank(memIdx) {
        if (memIdx < 0 || memIdx >= 4 || !this.memories[memIdx]) return false;
        const bank = this.librarian && this.librarian.activeBank;
        if (!bank) return false;
        const mem = this.memories[memIdx];
        bank.addProgram(new MM2Program(new Uint8Array(mem.rawData)));
        await this.librarian.saveAllBanks();
        this.renderLibrarianBank();
        this.showNotification(`Added Memory M${memIdx + 1} ("${mem.name}") to "${bank.name}"`, 'success');
        return true;
    }

    _setDropTip(el, text) {
        if (typeof setAppDropTip === 'function') {
            setAppDropTip(el, text);
            return;
        }
        if (el && typeof el.setAttribute === 'function') {
            el.setAttribute('data-drop-tip', text);
        }
    }

    _clearDropTip(el) {
        if (typeof clearAppDropTip === 'function') {
            clearAppDropTip(el);
            return;
        }
        if (el && typeof el.removeAttribute === 'function') {
            el.removeAttribute('data-drop-tip');
        }
    }

    _clearMemoryDragHover() {
        if (typeof document === 'undefined' || !document.querySelectorAll) return;
        document.querySelectorAll('.memory-btn.slot-drop-hover, .part-btn.slot-drop-hover, .app-main.slot-drop-hover, #editor-grid.slot-drop-hover, .prog-row.slot-drop-hover, .bank-tab.slot-drop-hover, #btn-add-bank.slot-drop-hover').forEach(el => {
            el.classList.remove('slot-drop-hover');
            this._clearDropTip(el);
        });
        document.querySelectorAll('.bank-tab.bank-insert-before, .bank-tab.bank-insert-after, .prog-row.prog-insert-before, .prog-row.prog-insert-after').forEach(el => {
            el.classList.remove('bank-insert-before', 'bank-insert-after', 'prog-insert-before', 'prog-insert-after');
        });
    }

    _parseDragPayload(e, fallback = this._activeMemoryDrag) {
        try {
            const raw = e && e.dataTransfer && e.dataTransfer.getData ? e.dataTransfer.getData('text/plain') : '';
            if (raw) return JSON.parse(raw);
        } catch (err) { }
        return fallback;
    }

    _bindDragTarget(el, { hoverClass = 'slot-drop-hover', onDragOver, onDragLeave, onDrop, stopLeavePropagation = false } = {}) {
        if (!el) return;
        if (onDragOver) {
            el.addEventListener('dragover', onDragOver);
        }
        el.addEventListener('dragleave', (e) => {
            if (stopLeavePropagation) e.stopPropagation();
            if (e.relatedTarget && typeof el.contains === 'function' && el.contains(e.relatedTarget)) {
                return;
            }
            if (hoverClass) el.classList.remove(hoverClass);
            this._clearDropTip(el);
            if (onDragLeave) onDragLeave(e);
        });
        if (onDrop) {
            el.addEventListener('drop', (e) => {
                if (hoverClass) el.classList.remove(hoverClass);
                this._clearDropTip(el);
                onDrop(e);
            });
        }
    }

    wireMemoryAndPartDragDrop(els = {}) {
        if (typeof document === 'undefined' && !els.memButtons) return;

        const memButtons = els.memButtons || [0, 1, 2, 3].map(i => document.getElementById(`btn-mem-${i}`)).filter(Boolean);
        const partButtons = els.partButtons || [
            document.getElementById('btn-part-a'),
            document.getElementById('btn-part-b')
        ].filter(Boolean);
        const appMain = els.appMain !== undefined ? els.appMain : document.querySelector('.app-main');
        const editorGrid = els.editorGrid !== undefined ? els.editorGrid : document.getElementById('editor-grid');
        const clearBtn = els.clearButton !== undefined ? els.clearButton : document.getElementById('btn-mem-clear');

        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.clearMemories();
            });
        }

        const clearHover = () => {
            this._clearMemoryDragHover();
            [...memButtons, ...partButtons, appMain, editorGrid].filter(Boolean).forEach(el => {
                el.classList.remove('slot-drop-hover');
                this._clearDropTip(el);
            });
        };

        this._wireMemoryButtons(memButtons, clearHover);
        this._wirePartButtons(partButtons, clearHover);
        if (editorGrid) this._wireEditorGridDrop(editorGrid, clearHover);
        if (appMain) this._wireAppMainDrop(appMain, clearHover);
    }

    _wireMemoryButtons(memButtons, clearHover) {
        memButtons.forEach((btn, idx) => {
            const memIdx = btn.dataset && btn.dataset.mem !== undefined ? parseInt(btn.dataset.mem, 10) : idx;
            btn.setAttribute('draggable', 'true');

            btn.addEventListener('click', () => {
                this.loadMemoryToActivePart(memIdx);
            });

            btn.addEventListener('dragstart', (e) => {
                if (!this.memories[memIdx]) {
                    if (e.preventDefault) e.preventDefault();
                    return;
                }
                const payload = { kind: 'memory', index: memIdx };
                this._activeMemoryDrag = payload;
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData('text/plain', JSON.stringify(payload));
                }
                btn.classList.add('is-dragging');
            });

            btn.addEventListener('dragend', () => {
                this._activeMemoryDrag = null;
                btn.classList.remove('is-dragging');
                clearHover();
            });

            this._bindDragTarget(btn, {
                stopLeavePropagation: true,
                onDragOver: (e) => {
                    const active = this._activeMemoryDrag;
                    if (!active) return;
                    const validMem = active.kind === 'memory' && active.index !== memIdx && !!this.memories[active.index];
                    const validPart = active.kind === 'part';
                    if (!validMem && !validPart) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                    btn.classList.add('slot-drop-hover');
                    if (validMem) {
                        this._setDropTip(btn, `Drop to copy Memory M${active.index + 1} to M${memIdx + 1}`);
                    } else if (validPart) {
                        const srcTimbre = this.getTimbre(active.slot);
                        const srcLabel = active.slot === 0 ? 'A' : 'B';
                        if (srcTimbre && typeof srcTimbre.isInit === 'function' && srcTimbre.isInit()) {
                            this._setDropTip(btn, `Drop to clear Memory M${memIdx + 1}`);
                        } else {
                            this._setDropTip(btn, `Drop to store Part ${srcLabel} in Memory M${memIdx + 1}`);
                        }
                    }
                },
                onDrop: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const data = this._parseDragPayload(e);
                    if (!data) return;
                    if (data.kind === 'memory' && data.index !== memIdx) {
                        this.copyMemory(data.index, memIdx);
                    } else if (data.kind === 'part' && (data.slot === 0 || data.slot === 1)) {
                        this.storePartInMemory(data.slot, memIdx);
                    }
                    this._activeMemoryDrag = null;
                    clearHover();
                }
            });
        });
    }

    _wirePartButtons(partButtons, clearHover) {
        partButtons.forEach((btn, idx) => {
            const slot = btn.dataset && btn.dataset.slot !== undefined ? parseInt(btn.dataset.slot, 10) : idx;
            btn.setAttribute('draggable', 'true');

            btn.addEventListener('dragstart', (e) => {
                const payload = { kind: 'part', slot };
                this._activeMemoryDrag = payload;
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData('text/plain', JSON.stringify(payload));
                }
                btn.classList.add('is-dragging');
            });

            btn.addEventListener('dragend', () => {
                this._activeMemoryDrag = null;
                btn.classList.remove('is-dragging');
                clearHover();
            });

            this._bindDragTarget(btn, {
                stopLeavePropagation: true,
                onDragOver: (e) => {
                    const active = this._activeMemoryDrag;
                    if (!active || active.kind !== 'part' || active.slot === slot || this.synthTimbralMode !== 'bitimbral') {
                        return;
                    }
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                    btn.classList.add('slot-drop-hover');
                    const srcLabel = active.slot === 0 ? 'A' : 'B';
                    const dstLabel = slot === 0 ? 'A' : 'B';
                    this._setDropTip(btn, `Drop to copy Part ${srcLabel} to Part ${dstLabel}`);
                },
                onDrop: (e) => {
                    const data = this._parseDragPayload(e);
                    if (!data || data.kind !== 'part' || data.slot === slot || this.synthTimbralMode !== 'bitimbral') {
                        return;
                    }
                    e.preventDefault();
                    e.stopPropagation();
                    const srcTimbre = this.getTimbre(data.slot);
                    const srcLabel = data.slot === 0 ? 'A' : 'B';
                    const dstLabel = slot === 0 ? 'A' : 'B';
                    this.replacePartWithRawData(slot, srcTimbre.rawData, `Copy Part ${srcLabel} → Part ${dstLabel}`);
                    this.showNotification(`Copied Part ${srcLabel} ("${srcTimbre.name}") to Part ${dstLabel}`, 'success');
                    this._activeMemoryDrag = null;
                    clearHover();
                }
            });
        });
    }

    _wireEditorGridDrop(editorGrid, clearHover) {
        this._bindDragTarget(editorGrid, {
            onDragOver: (e) => {
                const active = this._activeMemoryDrag;
                if (!active || active.kind !== 'part' || this.synthTimbralMode !== 'bitimbral' || this.activeSlot === active.slot) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                editorGrid.classList.add('slot-drop-hover');
                const srcLabel = active.slot === 0 ? 'A' : 'B';
                const dstLabel = this.activeSlot === 0 ? 'A' : 'B';
                this._setDropTip(editorGrid, `Drop to copy Part ${srcLabel} to Part ${dstLabel}`);
            },
            onDrop: (e) => {
                const data = this._parseDragPayload(e);
                if (!data || data.kind !== 'part' || this.synthTimbralMode !== 'bitimbral' || this.activeSlot === data.slot) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                const srcTimbre = this.getTimbre(data.slot);
                const srcLabel = data.slot === 0 ? 'A' : 'B';
                const dstLabel = this.activeSlot === 0 ? 'A' : 'B';
                this.replacePartWithRawData(this.activeSlot, srcTimbre.rawData, `Copy Part ${srcLabel} → Part ${dstLabel}`);
                this.showNotification(`Copied Part ${srcLabel} ("${srcTimbre.name}") to Part ${dstLabel}`, 'success');
                this._activeMemoryDrag = null;
                clearHover();
            }
        });
    }

    _moveBankPrograms(bank, indices, targetIdx, mode = 'insert') {
        const prevPrograms = bank.programs.map(p => new Uint8Array(p.rawData));
        let undoLabel = null;

        if (mode === 'group' || indices.length > 1) {
            if (bank.moveProgramsGroup(indices, targetIdx)) {
                undoLabel = `Move ${indices.length} patches to #${targetIdx + 1}`;
            }
            if (this.selectedProgIndices) this.selectedProgIndices.clear();
            this._lastSelectedProgIndex = null;
            this.showNotification(`Moved ${indices.length} patches to slot #${targetIdx + 1}`, 'info');
        } else if (mode === 'swap') {
            if (bank.swapPrograms(indices[0], targetIdx)) {
                undoLabel = `Swap #${indices[0] + 1} and #${targetIdx + 1}`;
            }
            this.showNotification(`Swapped slot #${indices[0] + 1} and slot #${targetIdx + 1}`, 'info');
        } else if (mode === 'replace') {
            if (indices[0] !== targetIdx) {
                const srcProg = bank.getProgram(indices[0]);
                if (srcProg) {
                    bank.setProgram(targetIdx, srcProg.clone());
                    undoLabel = `Copy "${srcProg.name}" to #${targetIdx + 1}`;
                    this.showNotification(`Copied "${srcProg.name}" to slot #${targetIdx + 1}`, 'success');
                }
            }
        } else if (targetIdx !== indices[0] && bank.moveProgram(indices[0], targetIdx)) {
            undoLabel = `Move patch to #${targetIdx + 1}`;
        }

        if (undoLabel) {
            const newPrograms = bank.programs.map(p => new Uint8Array(p.rawData));
            this._recordBankUndo(this.librarian.activeBankIndex, prevPrograms, newPrograms, undoLabel);
        }
        this._activeLibrarianDrag = null;
        this.librarian.saveAllBanks();
        this.renderLibrarianBank();
    }

    _wireAppMainDrop(appMain, clearHover) {
        const isBelowProgList = (e) => {
            if (typeof document === 'undefined' || !e || typeof e.clientY !== 'number') return true;
            const progListEl = document.getElementById('librarian-prog-list');
            if (!progListEl || typeof progListEl.getBoundingClientRect !== 'function') return true;
            const rect = progListEl.getBoundingClientRect();
            return !rect || e.clientY >= rect.bottom;
        };

        this._bindDragTarget(appMain, {
            onDragOver: (e) => {
                const activeLib = this._activeLibrarianDrag;
                if (
                    this.currentView === 'librarian' &&
                    activeLib &&
                    activeLib.type === 'prog-move' &&
                    this.librarian &&
                    activeLib.bankIndex === this.librarian.activeBankIndex &&
                    isBelowProgList(e)
                ) {
                    const bank = this.librarian.activeBank;
                    const count = activeLib.progIndices ? activeLib.progIndices.length : 1;
                    if (!bank || bank.length === 0 || (count === 1 && activeLib.progIndex === bank.length - 1)) {
                        clearHover();
                        if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
                        return;
                    }
                    e.preventDefault();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                    const progListEl = typeof document !== 'undefined' ? document.getElementById('librarian-prog-list') : null;
                    const rows = progListEl && progListEl.children ? Array.from(progListEl.children) : [];
                    rows.forEach((r, i) => {
                        if (r.classList) {
                            r.classList.remove('prog-insert-before', 'slot-drop-hover');
                            r.classList.toggle('prog-insert-after', i === rows.length - 1);
                        }
                    });
                    const slotLabel = `#${bank.length.toString().padStart(2, '0')}`;
                    this._setDropTip(appMain, count > 1 ? `Drop to move ${count} patches to ${slotLabel}` : `Drop to move patch to ${slotLabel}`);
                    return;
                }

                const active = this._activeMemoryDrag;
                if (!active || active.kind !== 'memory' || !this.memories[active.index]) {
                    return;
                }
                if (this.currentView !== 'editor' && this.currentView !== 'librarian') {
                    return;
                }
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                appMain.classList.add('slot-drop-hover');
                if (this.currentView === 'editor') {
                    const partLabel = this.activeSlot === 1 ? 'B' : 'A';
                    this._setDropTip(appMain, `Drop to load Memory M${active.index + 1} into Part ${partLabel}`);
                } else if (this.currentView === 'librarian') {
                    const bankName = this.librarian && this.librarian.activeBank ? this.librarian.activeBank.name : 'current bank';
                    this._setDropTip(appMain, `Drop to add Memory M${active.index + 1} to "${bankName}"`);
                }
            },
            onDrop: async (e) => {
                const libData = this._parseDragPayload(e, this._activeLibrarianDrag);
                if (
                    this.currentView === 'librarian' &&
                    libData &&
                    libData.type === 'prog-move' &&
                    this.librarian &&
                    libData.bankIndex === this.librarian.activeBankIndex &&
                    isBelowProgList(e)
                ) {
                    const bank = this.librarian.activeBank;
                    if (!bank || bank.length === 0) return;
                    e.preventDefault();
                    e.stopPropagation();
                    clearHover();
                    const indices = Array.isArray(libData.progIndices) && libData.progIndices.length > 0
                        ? libData.progIndices
                        : [libData.progIndex];
                    this._moveBankPrograms(bank, indices, bank.length - 1, indices.length > 1 ? 'group' : 'insert');
                    return;
                }

                const data = this._parseDragPayload(e);
                if (!data || data.kind !== 'memory' || !this.memories[data.index]) {
                    return;
                }
                if (this.currentView !== 'editor' && this.currentView !== 'librarian') {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                this._activeMemoryDrag = null;
                clearHover();
                if (this.currentView === 'editor') {
                    this.loadMemoryToActivePart(data.index);
                } else if (this.currentView === 'librarian') {
                    await this.addMemoryToCurrentBank(data.index);
                }
            }
        });
    }

    updateFirmwareUI() {
        if (typeof document === 'undefined') return;
        const fwVer = this.midi ? this.midi.effectiveFirmwareVersion : 3;
        const isV2 = fwVer === 2;

        const badge = document.getElementById('fw-version-badge');
        if (badge) {
            badge.textContent = isV2 ? 'FW v2.x' : 'FW v3.x';
            badge.classList.toggle('fw-v2', isV2);
            badge.classList.toggle('fw-v3', !isV2);
            if (isV2) {
                badge.setAttribute('href', 'https://www.audiothingies.com/tools/micromonsta2_updater/');
                badge.setAttribute('target', '_blank');
                badge.setAttribute('rel', 'noopener noreferrer');
                badge.title = 'Update firmware';
            } else {
                badge.removeAttribute('href');
                badge.removeAttribute('target');
                badge.removeAttribute('rel');
                badge.title = 'MicroMonsta 2 firmware v3.x mode (216-byte SysEx & v3 NRPNs)';
            }
        }

        document.querySelectorAll('[data-fw-v3-only="true"]').forEach(el => {
            el.classList.toggle('fw-v3-only-hidden', isV2);
            if (el.tagName === 'SELECT' || el.tagName === 'INPUT' || el.tagName === 'BUTTON') {
                el.disabled = isV2;
            } else {
                el.querySelectorAll('select, input, button').forEach(ctrl => {
                    ctrl.disabled = isV2;
                });
            }
        });

        const toggleOptions = (selector, excludedSet) => {
            document.querySelectorAll(selector).forEach(selectEl => {
                for (const opt of selectEl.options) {
                    const idx = Number(opt.value);
                    const hide = isV2 && excludedSet.has(idx);
                    opt.hidden = hide;
                    opt.disabled = hide;
                }
            });
        };

        toggleOptions('[data-param$="_SRC"] select, [data-param="LAG_SRC1"] select, [data-param^="MULT_"] select', V3_ONLY_SOURCE_INDICES);
        toggleOptions('[data-param$="_DST"] select', V3_ONLY_DEST_INDICES);
        toggleOptions('[data-param^="LAY_POT"] select, [data-param^="LAY_ENC"] select', V3_ONLY_ASSIGN_INDICES);

        const chordCard = document.querySelector('.chord-scaler-card');
        if (chordCard && chordCard.refresh) chordCard.refresh();
    }

    updateLiveSyncUI() {
        if (typeof document === 'undefined') return;
        const connGood = this.isConnectionGood;
        if (!connGood && this.midi && this.midi.liveSync) {
            this.midi.liveSync = false;
            this.midi.saveSettings();
        }
        const isLive = !!(this.midi && this.midi.liveSync && connGood);
        const btnLiveSync = document.getElementById('btn-prog-live-sync');
        if (btnLiveSync) {
            btnLiveSync.disabled = !connGood;
            if (btnLiveSync.classList) {
                btnLiveSync.classList.toggle('active', isLive);
            }
            if (typeof btnLiveSync.setAttribute === 'function') {
                btnLiveSync.setAttribute('aria-pressed', isLive ? 'true' : 'false');
            }
            const stateBadge = typeof btnLiveSync.querySelector === 'function'
                ? btnLiveSync.querySelector('.toggle-state-badge')
                : null;
            if (stateBadge) {
                stateBadge.textContent = isLive ? 'ON' : 'OFF';
            }
            btnLiveSync.title = connGood
                ? 'Real-time NRPN parameter streaming to MM2 hardware'
                : 'Live Sync unavailable until MicroMonsta 2 connection is verified';
        }

        const btnFetch = document.getElementById('btn-prog-fetch');
        if (btnFetch) {
            btnFetch.disabled = !connGood || isLive;
            btnFetch.title = isLive
                ? 'Fetch disabled while Live Sync is streaming parameters directly'
                : (!connGood
                    ? 'Fetch disabled: MicroMonsta 2 hardware connection is offline or unverified'
                    : 'Fetch current sound patch directly from MM2 hardware');
        }

        const btnPush = document.getElementById('btn-prog-push');
        if (btnPush) {
            btnPush.disabled = !connGood || isLive;
            btnPush.title = isLive
                ? 'Push disabled while Live Sync is streaming parameters directly'
                : (!connGood
                    ? 'Push disabled: MicroMonsta 2 hardware connection is offline or unverified'
                    : 'Send patch to MicroMonsta 2 hardware');
        }

        if (isLive && this.isComparing) {
            this.toggleCompare(false);
        }
        const btnCompare = document.getElementById('btn-prog-compare');
        if (btnCompare) {
            btnCompare.disabled = isLive;
            btnCompare.title = isLive
                ? 'Compare disabled while Live Sync is active'
                : 'Compare with original loaded patch (A/B testing)';
        }
    }

    toggleCompare(forceState) {
        const nextState = forceState !== undefined ? forceState : !this.isComparing;
        if (nextState === this.isComparing) return;
        if (nextState && this.midi && this.midi.liveSync) return;

        const btnCompare = typeof document !== 'undefined' ? document.getElementById('btn-prog-compare') : null;

        if (nextState) {
            const orig = this.activeSlot === 0 ? this.originalSnapshotA : this.originalSnapshotB;
            if (!orig) return;

            this.compareSavedProgram = this.activeTimbre.clone();
            this.activeTimbre.rawData = new Uint8Array(orig.rawData);
            this.isComparing = true;

            if (btnCompare) {
                btnCompare.textContent = 'COMPARING [ORIGINAL]';
                btnCompare.classList.add('comparing');
            }
            this.refreshEditorControls();
            this.showNotification('Auditioning original unedited patch. Click Compare or turn a knob to return.', 'info');
        } else {
            if (this.compareSavedProgram) {
                this.activeTimbre.rawData = new Uint8Array(this.compareSavedProgram.rawData);
                this.compareSavedProgram = null;
            }
            this.isComparing = false;
            if (btnCompare) {
                btnCompare.textContent = 'Compare: Off';
                btnCompare.classList.remove('comparing');
            }
            this.refreshEditorControls();
            this.showNotification('Restored live edited patch.', 'info');
        }
    }

    updateSyncStatus(status) {
        if ((status === 'synced' || status === 'streaming') && !this.isConnectionGood) {
            status = (this.midi && this.midi.hardwareResponsive === false) ? 'failed' : 'offline';
        }
        this.syncStatus = status;
        if (typeof document === 'undefined') return;
        const badge = document.getElementById('editor-sync-badge');
        if (!badge) return;

        badge.className = `sync-badge ${status}`;
        const wrapIcon = (paths) => `<svg class="icon-line" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
        const statusMeta = {
            synced: {
                icon: wrapIcon('<path d="M3 8.5 6.5 12 13 4.5"></path>'),
                label: this.midi.liveSync ? 'Live Synced' : 'Synced with MM2',
                title: this.midi.liveSync
                    ? 'Live Parameter Sync active (all tweaks stream immediately via NRPN)'
                    : 'Sound matches hardware state'
            },
            streaming: {
                icon: wrapIcon('<path d="M9 1.5 3.5 9h4.5l-1 5.5L12.5 7H8l1-5.5Z"></path>'),
                label: 'Streaming NRPN...',
                title: 'Real-time parameter changes transmitting to MM2'
            },
            modified: {
                icon: wrapIcon('<circle cx="8" cy="8" r="6"></circle><path d="M8 5v3.5"></path><path d="M8 11.2h.01"></path>'),
                label: 'Modified (Push to sync)',
                title: 'Edits pending. Push to MM2 or enable Live Sync.'
            },
            fetching: {
                icon: wrapIcon('<path d="M8 2.5v10.5M4 9l4 4 4-4"></path>'),
                label: 'Fetching from MM2...',
                title: 'Requesting active edit buffer from synth hardware'
            },
            failed: {
                icon: wrapIcon('<circle cx="8" cy="8" r="6"></circle><path d="M3.8 12.2 12.2 3.8"></path>'),
                label: 'Sync Failed (Offline)',
                title: 'Hardware did not respond to SysEx dump request. Check cables and channel settings.'
            },
            offline: {
                icon: wrapIcon('<path d="M6.5 10.5 5 12a2.5 2.5 0 0 1-3.5-3.5l1.5-1.5a2.5 2.5 0 0 1 3.5 0"></path><path d="M9.5 5.5 11 4a2.5 2.5 0 0 1 3.5 3.5L13 9a2.5 2.5 0 0 1-3.5 0"></path><path d="M5.5 3v1.5M3 5.5h1.5M10.5 13v-1.5M13 10.5h-1.5"></path>'),
                label: 'Not Synced (Offline)',
                title: 'Not connected to MicroMonsta 2 hardware'
            }
        };
        const meta = statusMeta[status];
        if (meta) {
            badge.innerHTML = meta.icon;
            badge.title = meta.title;
            if (typeof badge.setAttribute === 'function') {
                badge.setAttribute('aria-label', meta.label);
            }
        }
    }

    fetchActiveProgram(targetSlot = this.activeSlot, opts = {}) {
        if (!this.midi.outPort) {
            this.showNotification('No MIDI Output port selected. Open Settings to connect.', 'error');
            this.switchView('settings');
            return;
        }
        this.resetAuditionLatch();
        this.updateSyncStatus('fetching');
        const slot = targetSlot;

        // After reading Part A, probe Part B to detect the synth's timbral mode
        // ('load' also loads Part B into the editor; 'detect' only updates the mode indicator)
        this._pendingProbe = slot === 0 ? (opts.probe ?? 'detect') : null;

        // Clear existing fetch timer and set a 3.0s fallback timeout
        clearTimeout(this._fetchTimeout);
        this._fetchTimeout = setTimeout(() => {
            this._pendingProbe = null;
            if (this.midi) {
                this.midi.lastFetchedSlot = 0;
            }
            if (this.syncStatus === 'fetching') {
                this._enableLiveSyncOnFetch = false;
                this.updateSyncStatus('failed');
                this.midi.markHardwareResponsive(false);
                this.updateConnectionStatus();
                const portName = (this.midi.outPort && this.midi.outPort.name) ? this.midi.outPort.name : 'selected port';
                this.showNotification(`Fetch timed out: No response from MM2 on ${portName}. Check MIDI cable connections.`, 'warning');
            }
        }, 3000);

        if (this.midi && typeof this.midi.cancelProbe === 'function') {
            this.midi.cancelProbe();
        }
        this.midi.fetchProgram(slot);
    }

    /**
     * Detects the MM2 timbral mode by requesting Part B. The synth only answers Part B requests when
     * two layers are active (bitimbral/combi), so a reply means two layers and silence means monotimbral.
     * SysEx cannot tell bitimbral from combi, so both are reported as bitimbral.
     */
    probeTimbralMode({ loadPartB = false } = {}) {
        if (!this.midi.outPort) return;
        clearTimeout(this._modeProbeTimeout);
        this._modeProbe = { loadPartB };
        this._modeProbeTimeout = setTimeout(() => {
            this._modeProbe = null;
            if (this.midi) {
                this.midi.lastFetchedSlot = 0;
            }
            this.setTimbralMode('monotimbral');
        }, this.modeProbeTimeoutMs);
        this.midi.fetchProgram(1);
    }

    /**
     * Toggles solo or mute on a single oscillator/noise source; enabling one cancels the other.
     */
    toggleSoloMute(key, mode) {
        const primary = mode === 'solo' ? this.soloState : this.muteState;
        const secondary = mode === 'solo' ? this.muteState : this.soloState;
        primary[key] = !primary[key];
        if (primary[key]) {
            secondary[key] = false;
        }
        this.applySoloMute();
    }

    applySoloMute() {
        const timbre = this.activeTimbre;
        if (!this.savedMixerLevels) {
            this.savedMixerLevels = {
                MIX_OSC1: timbre.getValue('MIX_OSC1'),
                MIX_OSC2: timbre.getValue('MIX_OSC2'),
                MIX_OSC3: timbre.getValue('MIX_OSC3'),
                MIX_NOISE: timbre.getValue('MIX_NOISE')
            };
        }

        const sources = ['osc1', 'osc2', 'osc3', 'noise'];
        const anySolo = sources.some(s => this.soloState[s]);

        sources.forEach(src => {
            const paramKey = src === 'noise' ? 'MIX_NOISE' : `MIX_${src.toUpperCase()}`;
            const orig = this.savedMixerLevels[paramKey] ?? 127;
            let targetVal = orig;

            if (anySolo) {
                targetVal = this.soloState[src] ? orig : 0;
            } else if (this.muteState[src]) {
                targetVal = 0;
            }

            timbre.setValue(paramKey, targetVal);
            if (this.midi.liveSync) {
                this.midi.sendParameter(paramKey, targetVal);
            }
        });

        document.querySelectorAll('.editor-grid [data-param^="MIX_"]').forEach(el => {
            if (el.refresh) el.refresh();
        });
    }

    refreshEditorControls() {
        if (typeof document === 'undefined') return;
        const timbre = this.activeTimbre;

        // Program Name
        const nameInput = document.getElementById('prog-name-input');
        if (nameInput) nameInput.value = timbre.name;

        // Category
        const catSelect = document.getElementById('prog-category-select');
        if (catSelect) catSelect.value = timbre.category;

        // Refresh all controls in editor grid and program bar
        document.querySelectorAll('.editor-grid [data-param], #prog-tempo-container [data-param]').forEach(el => {
            if (el.refresh) el.refresh();
        });

        // Refresh all visualizers (ADSR, filter, LFO)
        document.querySelectorAll('.editor-grid .visualizer-box').forEach(v => {
            if (v.refresh) v.refresh();
        });

        const seq = document.getElementById('arp-seq-wrapper');
        if (seq && seq.refresh) seq.refresh();

        const oscCard = document.querySelector('.osc-unified-card');
        if (oscCard && oscCard.refresh) oscCard.refresh();

        const envCard = document.querySelector('.env-unified-card');
        if (envCard && envCard.refresh) envCard.refresh();

        const chordCard = document.querySelector('.chord-scaler-card');
        if (chordCard && chordCard.refresh) chordCard.refresh();

        this.updateTimbralModeUI();
        this.updateUndoRedoUI();
    }

    /**
     * Configures an element as a drag source for copying a section's parameters.
     */
    wireSectionDragSource(dragEl, sectionType, sectionIndex, { containerEl } = {}) {
        dragEl.setAttribute('draggable', 'true');
        const dragContainer = containerEl || dragEl;

        dragEl.addEventListener('dragstart', (e) => {
            const payload = { kind: 'section', sectionType, sectionIndex };
            this._activeDragSection = payload;
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData('text/plain', JSON.stringify(payload));
            }
            dragContainer.classList.add('is-dragging');
        });

        dragEl.addEventListener('dragend', () => {
            this._activeDragSection = null;
            dragContainer.classList.remove('is-dragging');
            this._clearDropTip(null);
            if (typeof document !== 'undefined' && document.querySelectorAll) {
                document.querySelectorAll('.tab-drop-hover, .slot-drop-hover, .lfo-dst-drop-hover').forEach(el => {
                    el.classList.remove('tab-drop-hover', 'slot-drop-hover', 'lfo-dst-drop-hover');
                    this._clearDropTip(el);
                });
            }
        });
    }

    /**
     * Configures an element as a drop target for copying a matching section's parameters.
     */
    wireSectionDropTarget(targetEl, sectionType, targetIndex, timbre, onChange, { hoverClass = 'slot-drop-hover', onDrop } = {}) {
        const resolveTargetIndex = () => (typeof targetIndex === 'function' ? targetIndex() : targetIndex);
        const SECTION_TIP_LABELS = {
            osc: 'OSC',
            env: 'ENV',
            lfo: 'LFO',
            mult: 'Mult',
            mtx: 'Mtx'
        };

        this._bindDragTarget(targetEl, {
            hoverClass,
            stopLeavePropagation: true,
            onDragOver: (e) => {
                const active = this._activeDragSection;
                const dstIdx = resolveTargetIndex();
                if (!active || active.kind !== 'section' || active.sectionType !== sectionType || active.sectionIndex === dstIdx) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                targetEl.classList.add(hoverClass);
                const secLabel = SECTION_TIP_LABELS[sectionType] || sectionType.toUpperCase();
                this._setDropTip(targetEl, `Drop to copy ${secLabel} ${active.sectionIndex} to ${secLabel} ${dstIdx}`);
            },
            onDrop: (e) => {
                e.preventDefault();
                e.stopPropagation();
                const dstIdx = resolveTargetIndex();
                const data = this._parseDragPayload(e, this._activeDragSection);
                if (data && data.kind === 'section' && data.sectionType === sectionType && data.sectionIndex !== dstIdx) {
                    copySection(sectionType, data.sectionIndex, sectionType, dstIdx, timbre(), onChange);
                    this._activeDragSection = null;
                    if (onDrop) onDrop(data.sectionIndex, dstIdx);
                }
            }
        });
    }

    /**
     * Configures a mod matrix source or destination select container as both a drag source
     * and drop target for copying that field (source -> source, dest -> dest) between slots.
     */
    wireMtxFieldDragDrop(el, fieldType, slotIndex, timbre, onChange) {
        if (!el) return;
        const kindLabel = fieldType === 'src' ? 'Source' : 'Destination';
        el.setAttribute('draggable', 'true');

        if (typeof document !== 'undefined' && typeof el.insertBefore === 'function') {
            const handle = document.createElement('span');
            handle.className = 'mtx-field-drag-handle';
            handle.textContent = '⋮⋮';
            handle.title = `Slot ${slotIndex} ${kindLabel} • Drag to copy to another slot's ${kindLabel.toLowerCase()}`;
            el.insertBefore(handle, el.firstChild || null);
        }

        el.addEventListener('dragstart', (e) => {
            e.stopPropagation();
            const payload = { kind: 'mtx-field', fieldType, slotIndex };
            this._activeDragMtxField = payload;
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData('text/plain', JSON.stringify(payload));
            }
            el.classList.add('is-dragging');
        });

        el.addEventListener('dragend', () => {
            this._activeDragMtxField = null;
            el.classList.remove('is-dragging');
            this._clearDropTip(null);
            if (typeof document !== 'undefined' && document.querySelectorAll) {
                document.querySelectorAll('.mtx-select-src.slot-drop-hover, .mtx-select-dst.slot-drop-hover').forEach(node => {
                    node.classList.remove('slot-drop-hover');
                    this._clearDropTip(node);
                });
            }
        });

        this._bindDragTarget(el, {
            hoverClass: 'slot-drop-hover',
            onDragOver: (e) => {
                const active = this._activeDragMtxField;
                if (!active || active.kind !== 'mtx-field' || active.fieldType !== fieldType || active.slotIndex === slotIndex) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                el.classList.add('slot-drop-hover');
                this._setDropTip(el, `Drop to copy Slot ${active.slotIndex} ${kindLabel} to Slot ${slotIndex}`);
            },
            onDrop: (e) => {
                const data = this._parseDragPayload(e, this._activeDragMtxField);
                if (!data || data.kind !== 'mtx-field' || data.fieldType !== fieldType || data.slotIndex === slotIndex) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();

                const prog = timbre();
                if (!prog) return;
                const srcKey = fieldType === 'src' ? `MTX${data.slotIndex}_SRC` : `MTX${data.slotIndex}_DST`;
                const dstKey = fieldType === 'src' ? `MTX${slotIndex}_SRC` : `MTX${slotIndex}_DST`;
                const val = prog.getValue(srcKey);
                const prevVal = prog.getValue(dstKey);
                if (onChange) {
                    onChange(dstKey, val, {
                        isFinal: true,
                        prevVal,
                        label: `Copy Slot ${data.slotIndex} ${kindLabel} → Slot ${slotIndex}`
                    });
                } else {
                    prog.setValue(dstKey, val);
                }
                if (el.refresh) el.refresh();
                this._activeDragMtxField = null;
                this.showNotification(`Copied Slot ${data.slotIndex} ${kindLabel} to Slot ${slotIndex}`, 'success');
            }
        });
    }

    /**
     * Returns the 1-based index of the first empty mod matrix slot, or null if full.
     */
    _findFirstEmptyMtxSlot(prog) {
        if (!prog) return null;
        const maxSlots = (this.midi && this.midi.effectiveFirmwareVersion === 2) ? 10 : 12;
        for (let m = 1; m <= maxSlots; m++) {
            if (prog.getValue(`MTX${m}_SRC`) === 0 && prog.getValue(`MTX${m}_DST`) === 0) {
                return m;
            }
        }
        return null;
    }

    _resolveModSource(payload) {
        if (!payload || payload.kind !== 'section') return null;
        const spec = SECTION_TO_MTX_SRC[payload.sectionType];
        if (!spec) return null;
        const srcVal = spec.indices[payload.sectionIndex];
        if (!srcVal) return null;
        return { srcVal, srcLabel: `${spec.label} ${payload.sectionIndex}` };
    }

    _mapModSourceToSlot(prog, modSrc, paramKey, dstVal, emptySlot, onChange, containerEl) {
        const { srcVal, srcLabel } = modSrc;
        const dstLabel = (typeof PARAM_MAP !== 'undefined' && PARAM_MAP.get('MTX1_DST')?.values?.[dstVal]) || paramKey;
        if (onChange && onChange.beginGroup) {
            onChange.beginGroup(`Map ${srcLabel} → ${dstLabel} (Slot ${emptySlot})`);
        }
        const prevSrc = prog.getValue(`MTX${emptySlot}_SRC`);
        const prevDst = prog.getValue(`MTX${emptySlot}_DST`);
        const prevAmt = prog.getValue(`MTX${emptySlot}_AMT`);
        if (onChange) {
            onChange(`MTX${emptySlot}_SRC`, srcVal, { isFinal: true, prevVal: prevSrc });
            onChange(`MTX${emptySlot}_DST`, dstVal, { isFinal: true, prevVal: prevDst });
            if (prevAmt === 128) {
                onChange(`MTX${emptySlot}_AMT`, 160, { isFinal: true, prevVal: prevAmt });
            }
        } else {
            prog.setValue(`MTX${emptySlot}_SRC`, srcVal);
            prog.setValue(`MTX${emptySlot}_DST`, dstVal);
            if (prevAmt === 128) {
                prog.setValue(`MTX${emptySlot}_AMT`, 160);
            }
        }
        if (onChange && onChange.endGroup) {
            onChange.endGroup();
        }

        this._activeDragSection = null;
        const slotRow = Array.from(containerEl.querySelectorAll('.matrix-slot-row'))
            .find(r => String(r.getAttribute('data-slot')) === String(emptySlot));
        if (slotRow) {
            this._refreshSectionNode(slotRow);
        }
        this.showNotification(`Mapped ${srcLabel} → ${dstLabel} (Matrix Slot ${emptySlot})`, 'success');
    }

    /**
     * Wires GUI controls matching mod-matrix destinations as drop targets for dragged
     * modulation sources (LFOs 1-3, Envelopes 1-3, Multipliers 1-2) whenever the mod
     * matrix has at least one empty slot.
     */
    wireModSourceToDestinationDropTargets(containerEl, timbre, onChange) {
        if (!containerEl || typeof containerEl.querySelectorAll !== 'function') return;

        containerEl.querySelectorAll('[data-param]').forEach(el => {
            const paramKey = el.getAttribute('data-param');
            const dstVal = PARAM_TO_MTX_DST[paramKey];
            if (!dstVal) return;

            this._bindDragTarget(el, {
                hoverClass: 'lfo-dst-drop-hover',
                onDragOver: (e) => {
                    const modSrc = this._resolveModSource(this._activeDragSection);
                    if (!modSrc) return;
                    const emptySlot = this._findFirstEmptyMtxSlot(timbre());
                    if (emptySlot === null) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                    if (typeof el.closest === 'function') {
                        const parentCard = el.closest('.lfo-sub-card, .env-pane');
                        if (parentCard) parentCard.classList.remove('slot-drop-hover');
                    } else {
                        for (const sel of ['.lfo-sub-card', '.env-pane']) {
                            containerEl.querySelectorAll(sel).forEach(card => {
                                if (typeof card.contains === 'function' && card.contains(el)) {
                                    card.classList.remove('slot-drop-hover');
                                }
                            });
                        }
                    }
                    el.classList.add('lfo-dst-drop-hover');
                    const dstLabel = (typeof PARAM_MAP !== 'undefined' && PARAM_MAP.get('MTX1_DST')?.values?.[dstVal]) || paramKey;
                    this._setDropTip(el, `Add to mod matrix: ${modSrc.srcLabel} -> ${dstLabel}`);
                },
                onDrop: (e) => {
                    const data = this._parseDragPayload(e, this._activeDragSection);
                    const modSrc = this._resolveModSource(data);
                    if (!modSrc) return;
                    const prog = timbre();
                    const emptySlot = this._findFirstEmptyMtxSlot(prog);
                    if (emptySlot === null) return;

                    e.preventDefault();
                    e.stopPropagation();
                    this._mapModSourceToSlot(prog, modSrc, paramKey, dstVal, emptySlot, onChange, containerEl);
                }
            });
        });
    }

    _createCardActionMenu(card, sectionType, { shortLabel, noun, buttonTitle }, timbre, onChange) {
        const menuWrap = document.createElement('div');
        menuWrap.className = 'card-menu-wrap';

        const menuBtn = document.createElement('button');
        menuBtn.type = 'button';
        menuBtn.className = 'card-menu-btn';
        menuBtn.textContent = '⋯';
        menuBtn.title = buttonTitle;

        const dropdown = document.createElement('div');
        dropdown.className = 'card-dropdown-menu';

        const closeMenu = () => {
            dropdown.classList.remove('open');
            window.removeEventListener('click', closeMenu);
        };

        const updateMenuState = () => {
            const clip = getSectionClipboard();
            const canPaste = clip && clip.sectionType === sectionType;
            const curIdx = parseInt(card.getAttribute('data-section-index'), 10) || 1;
            dropdown.innerHTML = `
                <div class="menu-item" data-action="copy">${ICON_COPY_SVG} <span>Copy ${shortLabel} ${curIdx}</span></div>
                <div class="menu-item ${canPaste ? '' : 'disabled'}" data-action="paste">${ICON_PASTE_SVG} <span>Paste Section</span></div>
                <div class="menu-item" data-action="reset">${ICON_RESET_SVG} <span>Reset to Defaults</span></div>
                <div class="menu-item" data-action="randomize">${ICON_RANDOM_SVG} <span>Smart Randomize</span></div>
            `;

            dropdown.querySelector('[data-action="copy"]').onclick = (e) => {
                e.stopPropagation();
                copySectionToClipboard(sectionType, curIdx, timbre());
                closeMenu();
                this.showNotification(`Copied ${noun} ${curIdx} to clipboard`, 'info');
            };

            const pasteEl = dropdown.querySelector('[data-action="paste"]');
            if (canPaste) {
                pasteEl.onclick = (e) => {
                    e.stopPropagation();
                    pasteSectionFromClipboard(sectionType, curIdx, timbre(), onChange);
                    closeMenu();
                    card.refresh();
                    this.showNotification(`Pasted into ${noun} ${curIdx}`, 'success');
                };
            }

            dropdown.querySelector('[data-action="reset"]').onclick = (e) => {
                e.stopPropagation();
                resetSectionToInit(sectionType, curIdx, timbre(), onChange);
                closeMenu();
                card.refresh();
                this.showNotification(`Reset ${noun} ${curIdx} to defaults`, 'info');
            };

            dropdown.querySelector('[data-action="randomize"]').onclick = (e) => {
                e.stopPropagation();
                randomizeSection(sectionType, curIdx, timbre(), onChange);
                closeMenu();
                card.refresh();
                this.showNotification(`Randomized ${noun} ${curIdx}`, 'success');
            };
        };

        menuBtn.onclick = (e) => {
            e.stopPropagation();
            const isOpen = dropdown.classList.contains('open');
            document.querySelectorAll('.card-dropdown-menu.open').forEach(m => m.classList.remove('open'));
            if (!isOpen) {
                updateMenuState();
                dropdown.classList.add('open');
                window.addEventListener('click', closeMenu);
            }
        };

        menuWrap.appendChild(menuBtn);
        menuWrap.appendChild(dropdown);
        return menuWrap;
    }

    _createOscPane(i, timbre, onChange, { updateOscShapeState, updateOscSelection, muteBtns, soloBtns, shapeKnobs }) {
        const pane = document.createElement('div');
        pane.className = `osc-pane osc-pane-${i}`;
        pane.style.display = (this.selectedOsc === i) ? 'flex' : 'none';

        const algoRow = document.createElement('div');
        algoRow.className = 'osc-algo-row';
        algoRow.appendChild(createSelect(`OSC${i}_ALGO`, timbre, (k, v, meta) => {
            updateOscShapeState(i);
            if (onChange) onChange(k, v, meta);
        }));

        const soloMuteGroup = document.createElement('div');
        soloMuteGroup.className = 'solo-mute-group';

        const muteBtn = document.createElement('button');
        muteBtn.type = 'button';
        muteBtn.className = 'btn-sm-badge btn-mute';
        muteBtn.textContent = 'M';
        muteBtn.title = `Mute Osc ${i}`;
        muteBtn.onclick = (e) => {
            e.stopPropagation();
            this.toggleSoloMute('osc' + i, 'mute');
            updateOscSelection();
        };

        const soloBtn = document.createElement('button');
        soloBtn.type = 'button';
        soloBtn.className = 'btn-sm-badge btn-solo';
        soloBtn.textContent = 'S';
        soloBtn.title = `Solo Osc ${i}`;
        soloBtn.onclick = (e) => {
            e.stopPropagation();
            this.toggleSoloMute('osc' + i, 'solo');
            updateOscSelection();
        };

        soloMuteGroup.appendChild(muteBtn);
        soloMuteGroup.appendChild(soloBtn);
        algoRow.appendChild(soloMuteGroup);
        pane.appendChild(algoRow);

        muteBtns[i] = muteBtn;
        soloBtns[i] = soloBtn;

        const knobs = document.createElement('div');
        knobs.className = 'knob-row';
        const shapeKnob = createKnob(`OSC${i}_SHAPE`, timbre, onChange);
        shapeKnobs[i] = shapeKnob;
        knobs.appendChild(shapeKnob);
        knobs.appendChild(createKnob(`OSC${i}_TUNE`, timbre, onChange));
        knobs.appendChild(createKnob(`OSC${i}_FINETUNE`, timbre, onChange));
        knobs.appendChild(createKnob(`MIX_OSC${i}`, timbre, onChange));
        pane.appendChild(knobs);
        return pane;
    }

    _createOscNoiseFooter(timbre, onChange) {
        const footer = document.createElement('div');
        footer.className = 'osc-footer-strip';

        const noiseGroup = document.createElement('div');
        noiseGroup.className = 'osc-noise-group';
        const noiseBadges = document.createElement('div');
        noiseBadges.className = 'osc-noise-badges';

        const noiseMuteBtn = document.createElement('button');
        noiseMuteBtn.type = 'button';
        noiseMuteBtn.className = 'btn-sm-badge btn-mute' + (this.muteState.noise ? ' active' : '');
        noiseMuteBtn.textContent = 'M';
        noiseMuteBtn.title = 'Mute Noise Generator';

        const noiseSoloBtn = document.createElement('button');
        noiseSoloBtn.type = 'button';
        noiseSoloBtn.className = 'btn-sm-badge btn-solo' + (this.soloState.noise ? ' active' : '');
        noiseSoloBtn.textContent = 'S';
        noiseSoloBtn.title = 'Solo Noise Generator';

        const syncNoiseBadges = () => {
            noiseMuteBtn.classList.toggle('active', this.muteState.noise);
            noiseSoloBtn.classList.toggle('active', this.soloState.noise);
        };
        noiseMuteBtn.onclick = (e) => {
            e.stopPropagation();
            this.toggleSoloMute('noise', 'mute');
            syncNoiseBadges();
        };
        noiseSoloBtn.onclick = (e) => {
            e.stopPropagation();
            this.toggleSoloMute('noise', 'solo');
            syncNoiseBadges();
        };

        noiseBadges.appendChild(noiseMuteBtn);
        noiseBadges.appendChild(noiseSoloBtn);
        noiseGroup.appendChild(createKnob('MIX_NOISE', timbre, onChange, { small: true }));
        noiseGroup.appendChild(noiseBadges);

        footer.appendChild(noiseGroup);
        footer.appendChild(createSelect('OSC_PHASE_RESET', timbre, onChange));
        return footer;
    }

    createOscillatorPanel(timbre, onChange) {
        if (typeof document === 'undefined') return { card: null };

        const card = document.createElement('div');
        card.className = 'synth-card osc-unified-card';
        card.setAttribute('data-section-type', 'osc');
        card.setAttribute('data-section-index', this.selectedOsc);

        const head = document.createElement('div');
        head.className = 'synth-card-header';

        const titleGroup = document.createElement('div');
        titleGroup.className = 'card-title-group static';
        const titleText = document.createElement('span');
        titleText.className = 'card-title-text';
        titleText.textContent = 'Oscillator';
        titleGroup.appendChild(titleText);
        head.appendChild(titleGroup);

        const tabGroup = document.createElement('div');
        tabGroup.className = 'osc-tabs-group';

        const tabButtons = [];
        for (let i = 1; i <= 3; i++) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `btn-osc-tab ${this.selectedOsc === i ? 'active' : ''}`;
            btn.setAttribute('data-osc', i);
            btn.textContent = `Osc ${i}`;

            const muteDot = document.createElement('span');
            muteDot.className = 'tab-dot dot-mute';
            const soloDot = document.createElement('span');
            soloDot.className = 'tab-dot dot-solo';
            btn.appendChild(muteDot);
            btn.appendChild(soloDot);

            btn.title = `Osc ${i} • Drag to copy to another oscillator`;
            this.wireSectionDragSource(btn, 'osc', i);
            this.wireSectionDropTarget(btn, 'osc', i, timbre, onChange, {
                hoverClass: 'tab-drop-hover',
                onDrop: (srcIdx, dstIdx) => {
                    card.refresh();
                    this.showNotification(`Copied Osc ${srcIdx} to Osc ${dstIdx}`, 'success');
                }
            });

            btn.onclick = () => {
                this.selectedOsc = i;
                updateOscSelection();
            };

            tabGroup.appendChild(btn);
            tabButtons.push(btn);
        }
        head.appendChild(tabGroup);
        head.appendChild(this._createCardActionMenu(card, 'osc', {
            shortLabel: 'Osc',
            noun: 'Oscillator',
            buttonTitle: 'Oscillator Actions (Copy, Paste, Reset, Randomize)'
        }, timbre, onChange));
        card.appendChild(head);

        const body = document.createElement('div');
        body.className = 'synth-card-body';

        this.wireSectionDropTarget(body, 'osc', () => this.selectedOsc, timbre, onChange, {
            hoverClass: 'slot-drop-hover',
            onDrop: (srcIdx, dstIdx) => {
                card.refresh();
                this.showNotification(`Copied Osc ${srcIdx} to Osc ${dstIdx}`, 'success');
            }
        });

        const panes = [];
        const muteBtns = {};
        const soloBtns = {};
        const shapeKnobs = {};
        const SINE_ALGOS = new Set(['Sine', 'Sine Full', 'Sine Half']);
        const updateOscShapeState = (oscNum) => {
            const shapeKnob = shapeKnobs[oscNum];
            if (!shapeKnob || !shapeKnob.setDisabled) return;
            const prog = typeof timbre === 'function' ? timbre() : timbre;
            const algoKey = `OSC${oscNum}_ALGO`;
            const algoDef = PARAM_MAP.get(algoKey);
            const algoVal = prog ? prog.getValue(algoKey) : (algoDef ? algoDef.default : 0);
            const algoName = algoDef && algoDef.values ? algoDef.values[algoVal] : '';
            shapeKnob.setDisabled(SINE_ALGOS.has(algoName));
        };

        const updateOscSelection = () => {
            const idx = this.selectedOsc;
            card.setAttribute('data-section-index', idx);

            tabButtons.forEach((btn, i) => {
                const oscNum = i + 1;
                btn.classList.toggle('active', oscNum === idx);
                btn.classList.toggle('is-muted', !!this.muteState['osc' + oscNum]);
                btn.classList.toggle('is-soloed', !!this.soloState['osc' + oscNum]);
            });

            panes.forEach((pane, i) => {
                const active = (i + 1 === idx);
                pane.style.display = active ? 'flex' : 'none';
                if (active) this._refreshSectionNode(pane);
            });

            for (let n = 1; n <= 3; n++) {
                if (muteBtns[n]) muteBtns[n].classList.toggle('active', !!this.muteState['osc' + n]);
                if (soloBtns[n]) soloBtns[n].classList.toggle('active', !!this.soloState['osc' + n]);
            }
            updateOscShapeState(idx);
        };

        for (let i = 1; i <= 3; i++) {
            const pane = this._createOscPane(i, timbre, onChange, {
                updateOscShapeState,
                updateOscSelection,
                muteBtns,
                soloBtns,
                shapeKnobs
            });
            body.appendChild(pane);
            panes.push(pane);
        }

        body.appendChild(this._createOscNoiseFooter(timbre, onChange));
        card.appendChild(body);

        card.refresh = () => {
            this._refreshSectionNode(card);
            [1, 2, 3].forEach(updateOscShapeState);
            updateOscSelection();
        };

        [1, 2, 3].forEach(updateOscShapeState);
        updateOscSelection();
        return card;
    }

    _createEnvGraphsRow(card, timbre, onChange, envLabels, onSelect) {
        const graphsRow = document.createElement('div');
        graphsRow.className = 'adsr-graphs-row';

        const graphCards = [];
        for (let i = 1; i <= 3; i++) {
            const gCard = document.createElement('div');
            gCard.className = `adsr-graph-card ${this.selectedEnv === i ? 'active' : ''}`;
            gCard.setAttribute('data-env', i);
            gCard.title = `Click to edit ${envLabels[i - 1]} • Drag to copy to another envelope`;
            this.wireSectionDragSource(gCard, 'env', i);
            this.wireSectionDropTarget(gCard, 'env', i, timbre, onChange, {
                hoverClass: 'slot-drop-hover',
                onDrop: (srcIdx, dstIdx) => {
                    card.refresh();
                    this.showNotification(`Copied Env ${srcIdx} to Env ${dstIdx}`, 'success');
                }
            });

            const gLabel = document.createElement('div');
            gLabel.className = 'adsr-graph-label';
            gLabel.textContent = envLabels[i - 1];

            gCard.appendChild(gLabel);
            gCard.appendChild(createADSRVisualizer(i, timbre));

            gCard.onclick = () => {
                this.selectedEnv = i;
                onSelect();
            };

            graphsRow.appendChild(gCard);
            graphCards.push(gCard);
        }
        return { graphsRow, graphCards };
    }

    _createEnvPane(i, card, timbre, onChange) {
        const pane = document.createElement('div');
        pane.className = `env-pane env-pane-${i}`;
        pane.style.display = (this.selectedEnv === i) ? 'flex' : 'none';

        const knobs = document.createElement('div');
        knobs.className = 'knob-row';
        knobs.appendChild(createKnob(`ENV${i}_ATK`, timbre, onChange));
        knobs.appendChild(createKnob(`ENV${i}_DCY`, timbre, onChange));
        knobs.appendChild(createKnob(`ENV${i}_SUS`, timbre, onChange));
        knobs.appendChild(createKnob(`ENV${i}_REL`, timbre, onChange));
        if (i === 1) knobs.appendChild(createKnob('ENV1_VCA_VEL_SENS', timbre, onChange));
        if (i === 2) knobs.appendChild(createKnob('ENV2_FLT_VEL_SENS', timbre, onChange));
        knobs.appendChild(createToggleButton(`ENV${i}_RESET`, timbre, onChange));
        pane.appendChild(knobs);

        this.wireSectionDropTarget(pane, 'env', i, timbre, onChange, {
            hoverClass: 'slot-drop-hover',
            onDrop: (srcIdx, dstIdx) => {
                card.refresh();
                this.showNotification(`Copied Env ${srcIdx} to Env ${dstIdx}`, 'success');
            }
        });
        return pane;
    }

    createEnvelopePanel(timbre, onChange) {
        if (typeof document === 'undefined') return document.createElement('div');

        const card = document.createElement('div');
        card.className = 'synth-card env-unified-card';
        card.setAttribute('data-section-type', 'env');
        card.setAttribute('data-section-index', this.selectedEnv);

        const head = document.createElement('div');
        head.className = 'synth-card-header';

        const titleGroup = document.createElement('div');
        titleGroup.className = 'card-title-group static';
        const titleText = document.createElement('span');
        titleText.className = 'card-title-text';
        titleText.textContent = 'Envelopes';
        titleGroup.appendChild(titleText);
        head.appendChild(titleGroup);

        const tabGroup = document.createElement('div');
        tabGroup.className = 'env-tabs-group';

        const tabButtons = [];
        const envLabels = ['Env 1 (Amp)', 'Env 2 (Filter)', 'Env 3 (Mod)'];

        for (let i = 1; i <= 3; i++) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `btn-env-tab ${this.selectedEnv === i ? 'active' : ''}`;
            btn.setAttribute('data-env', i);
            btn.textContent = `Env ${i}`;
            btn.title = `Env ${i} • Drag to copy to another envelope`;
            this.wireSectionDragSource(btn, 'env', i);
            this.wireSectionDropTarget(btn, 'env', i, timbre, onChange, {
                hoverClass: 'tab-drop-hover',
                onDrop: (srcIdx, dstIdx) => {
                    card.refresh();
                    this.showNotification(`Copied Env ${srcIdx} to Env ${dstIdx}`, 'success');
                }
            });

            btn.onclick = () => {
                this.selectedEnv = i;
                updateEnvSelection();
            };

            tabGroup.appendChild(btn);
            tabButtons.push(btn);
        }
        head.appendChild(tabGroup);
        head.appendChild(this._createCardActionMenu(card, 'env', {
            shortLabel: 'Env',
            noun: 'Envelope',
            buttonTitle: 'Envelope Actions (Copy, Paste, Reset, Randomize)'
        }, timbre, onChange));
        card.appendChild(head);

        const body = document.createElement('div');
        body.className = 'synth-card-body';

        const { graphsRow, graphCards } = this._createEnvGraphsRow(
            card,
            timbre,
            onChange,
            envLabels,
            () => updateEnvSelection()
        );
        body.appendChild(graphsRow);

        const panes = [];
        for (let i = 1; i <= 3; i++) {
            const pane = this._createEnvPane(i, card, timbre, onChange);
            body.appendChild(pane);
            panes.push(pane);
        }

        card.appendChild(body);

        const updateEnvSelection = () => {
            const idx = this.selectedEnv;
            card.setAttribute('data-section-index', idx);

            tabButtons.forEach((btn, i) => {
                btn.classList.toggle('active', i + 1 === idx);
            });

            graphCards.forEach((gc, i) => {
                gc.classList.toggle('active', i + 1 === idx);
            });

            panes.forEach((pane, i) => {
                const active = (i + 1 === idx);
                pane.style.display = active ? 'flex' : 'none';
                if (active) this._refreshSectionNode(pane);
            });
        };

        card.refresh = () => {
            this._refreshSectionNode(card);
            card.querySelectorAll('.adsr-visualizer').forEach(v => {
                if (v.refresh) v.refresh();
            });
            updateEnvSelection();
        };

        updateEnvSelection();
        return card;
    }

    createOnChange() {
        const fn = (key, val, meta) => this.onParameterChanged(key, val, meta);
        fn.beginGroup = (label) => this.beginUndoGroup(label);
        fn.endGroup = () => this.endUndoGroup();
        return fn;
    }

    _buildFilterCard(timbre, onChange) {
        const flt = createSectionCard('Filter', 'flt', 1, timbre, onChange);

        const fltHeroRow = document.createElement('div');
        fltHeroRow.className = 'flt-hero-row';
        fltHeroRow.appendChild(createFilterCurveVisualizer(timbre, onChange));

        const fltMainKnobs = document.createElement('div');
        fltMainKnobs.className = 'flt-main-knobs';
        fltMainKnobs.appendChild(createKnob('FILTER_FREQ', timbre, onChange, { large: true }));
        fltMainKnobs.appendChild(createKnob('FILTER_RESO', timbre, onChange, { large: true }));
        fltHeroRow.appendChild(fltMainKnobs);
        flt.body.appendChild(fltHeroRow);

        const fltSelects = document.createElement('div');
        fltSelects.className = 'select-row';
        fltSelects.appendChild(createSelect('FILTER_ALGO', timbre, onChange));
        const fltCharWrap = createSelect('FILTER_CHARACTER', timbre, onChange);
        fltCharWrap.setAttribute('data-fw-v3-only', 'true');
        fltSelects.appendChild(fltCharWrap);
        flt.body.appendChild(fltSelects);

        const fltKnobs = document.createElement('div');
        fltKnobs.className = 'knob-row flt-secondary-knobs';
        fltKnobs.appendChild(createKnob('FILTER_TRACKING', timbre, onChange));
        fltKnobs.appendChild(createKnob('FILTER_ENV2', timbre, onChange));
        fltKnobs.appendChild(createKnob('FILTER_FM', timbre, onChange));
        fltKnobs.appendChild(createKnob('DRIVE_VOICE', timbre, onChange));
        fltKnobs.appendChild(createKnob('LAY_MASTER_VOLUME', timbre, onChange));
        flt.body.appendChild(fltKnobs);
        return flt.card;
    }

    _buildLfoGroupCard(timbre, onChange) {
        const lfoGroupCard = createSectionCard('Low Frequency Oscillators', 'lfo_group', 1, timbre, onChange);
        const lfoGrid = document.createElement('div');
        lfoGrid.className = 'lfo-multi-grid';

        for (let l = 1; l <= 3; l++) {
            const subLfo = document.createElement('div');
            subLfo.className = 'lfo-sub-card';
            subLfo.setAttribute('data-lfo', l);

            const subHeader = document.createElement('div');
            subHeader.className = 'lfo-sub-header';

            const badge = document.createElement('div');
            badge.className = 'lfo-badge';
            badge.textContent = `LFO ${l}`;
            badge.title = `LFO ${l} • Drag to copy to another LFO`;

            const refreshLfo = () => {
                this._refreshSectionNode(subLfo);
                const viz = subLfo.querySelector('.lfo-visualizer');
                if (viz && viz.refresh) viz.refresh();
            };

            this.wireSectionDragSource(badge, 'lfo', l, { containerEl: subLfo });
            this.wireSectionDropTarget(subLfo, 'lfo', l, timbre, onChange, {
                hoverClass: 'slot-drop-hover',
                onDrop: (srcIdx, dstIdx) => {
                    refreshLfo();
                    this.showNotification(`Copied LFO ${srcIdx} to LFO ${dstIdx}`, 'success');
                }
            });

            const actions = document.createElement('div');
            actions.className = 'matrix-slot-actions';

            const btnRandom = document.createElement('button');
            btnRandom.type = 'button';
            btnRandom.className = 'btn-slot-icon';
            btnRandom.title = `Smart randomize LFO ${l}`;
            btnRandom.innerHTML = ICON_RANDOM_SVG;
            btnRandom.onclick = () => {
                randomizeSection('lfo', l, timbre(), onChange);
                refreshLfo();
                this.showNotification(`Randomized LFO ${l}`, 'info');
            };

            const btnClear = document.createElement('button');
            btnClear.type = 'button';
            btnClear.className = 'btn-slot-icon btn-slot-clear';
            btnClear.title = `Reset LFO ${l} to init defaults`;
            btnClear.textContent = '✕';
            btnClear.onclick = () => {
                resetSectionToInit('lfo', l, timbre(), onChange);
                refreshLfo();
                this.showNotification(`Reset LFO ${l} to defaults`, 'info');
            };

            actions.appendChild(btnRandom);
            actions.appendChild(btnClear);

            subHeader.appendChild(badge);
            subHeader.appendChild(actions);
            subLfo.appendChild(subHeader);

            subLfo.appendChild(createLFOWaveformPreview(l, timbre));
            subLfo.appendChild(createSelect(`LFO${l}_WAVE`, timbre, onChange));

            const lfoModeSpeed = document.createElement('div');
            lfoModeSpeed.className = 'lfo-mode-speed-row';
            lfoModeSpeed.appendChild(createSelect(`LFO${l}_MODE`, timbre, onChange));
            lfoModeSpeed.appendChild(createKnob(`LFO${l}_SPEED`, timbre, onChange));
            subLfo.appendChild(lfoModeSpeed);

            lfoGrid.appendChild(subLfo);
        }
        lfoGroupCard.body.appendChild(lfoGrid);
        return lfoGroupCard.card;
    }

    _buildVoiceCard(timbre, onChange, makeSection) {
        const vceCard = makeSection('Voice Performance');
        const vceSelects = document.createElement('div');
        vceSelects.className = 'select-row';
        vceSelects.appendChild(createSelect('VCE_MODE', timbre, onChange));
        vceSelects.appendChild(createSelect('VCE_UNISON', timbre, onChange));
        vceCard.body.appendChild(vceSelects);

        const vceKnobs1 = document.createElement('div');
        vceKnobs1.className = 'knob-row';
        vceKnobs1.appendChild(createKnob('VCE_DETUNE', timbre, onChange));
        vceKnobs1.appendChild(createKnob('VCE_DETUNE_OSC', timbre, onChange));
        vceKnobs1.appendChild(createKnob('VCE_GLIDE', timbre, onChange));
        vceCard.body.appendChild(vceKnobs1);

        const vceKnobs2 = document.createElement('div');
        vceKnobs2.className = 'knob-row';
        vceKnobs2.appendChild(createKnob('VCE_PBRANGE_DOWN', timbre, onChange));
        vceKnobs2.appendChild(createKnob('VCE_PBRANGE_UP', timbre, onChange));
        vceCard.body.appendChild(vceKnobs2);
        return vceCard.card;
    }

    _buildMathCard(timbre, onChange, makeSection) {
        const mathSec = makeSection('Math Operators');
        const mathGrid = document.createElement('div');
        mathGrid.className = 'math-operators-grid';

        const lagBox = document.createElement('div');
        lagBox.className = 'math-sub-panel';
        lagBox.innerHTML = '<div class="fx-sub-title">Lag Generator (Glide)</div>';
        const lagControls = document.createElement('div');
        lagControls.className = 'lag-controls-row';
        lagControls.appendChild(createSelect('LAG_SRC1', timbre, onChange));
        lagControls.appendChild(createKnob('LAG_AMT1', timbre, onChange));
        lagBox.appendChild(lagControls);
        mathGrid.appendChild(lagBox);

        const multStack = document.createElement('div');
        multStack.className = 'math-mult-stack';

        for (let m = 1; m <= 2; m++) {
            const multBox = document.createElement('div');
            multBox.className = 'math-sub-panel';
            multBox.setAttribute('data-mult', m);

            const multHeader = document.createElement('div');
            multHeader.className = 'mult-sub-header';

            const multBadge = document.createElement('div');
            multBadge.className = 'mult-badge';
            multBadge.textContent = `Mult${m} (AxB)`;
            multBadge.title = `Multiplier ${m} • Drag to copy to another multiplier`;

            const multActions = document.createElement('div');
            multActions.className = 'matrix-slot-actions';

            const btnClear = document.createElement('button');
            btnClear.type = 'button';
            btnClear.className = 'btn-slot-icon btn-slot-clear';
            btnClear.title = `Reset Multiplier ${m} to init defaults`;
            btnClear.textContent = '✕';
            btnClear.onclick = () => {
                resetSectionToInit('mult', m, timbre(), onChange);
                this._refreshSectionNode(multBox);
                this.showNotification(`Reset Multiplier ${m} to defaults`, 'info');
            };

            multActions.appendChild(btnClear);
            multHeader.appendChild(multBadge);
            multHeader.appendChild(multActions);
            multBox.appendChild(multHeader);

            this.wireSectionDragSource(multBadge, 'mult', m, { containerEl: multBox });
            this.wireSectionDropTarget(multBox, 'mult', m, timbre, onChange, {
                hoverClass: 'slot-drop-hover',
                onDrop: (srcIdx, dstIdx) => {
                    this._refreshSectionNode(multBox);
                    this.showNotification(`Copied Multiplier ${srcIdx} to Multiplier ${dstIdx}`, 'success');
                }
            });

            const multSels = document.createElement('div');
            multSels.className = 'select-row';
            multSels.appendChild(createSelect(`MULT_A${m}`, timbre, onChange));
            multSels.appendChild(createSelect(`MULT_B${m}`, timbre, onChange));
            multBox.appendChild(multSels);
            multStack.appendChild(multBox);
        }

        mathGrid.appendChild(multStack);
        mathSec.body.appendChild(mathGrid);
        return mathSec.card;
    }

    _buildKnobsAssignCard(timbre, onChange, makeSection) {
        const knobsSec = makeSection('Knobs');
        const knobsGrid = document.createElement('div');
        knobsGrid.className = 'knobs-assign-grid';
        for (const key of [
            'LAY_POT1_ASSIGN', 'LAY_POT2_ASSIGN', 'LAY_POT3_ASSIGN',
            'LAY_ENC1_ASSIGN', 'LAY_ENC2_ASSIGN', 'LAY_ENC3_ASSIGN', 'LAY_ENC4_ASSIGN'
        ]) {
            knobsGrid.appendChild(createSelect(key, timbre, onChange));
        }
        knobsSec.body.appendChild(knobsGrid);
        return knobsSec.card;
    }

    _buildMatrixCard(timbre, onChange) {
        const mtxSec = createSectionCard('Modulation Matrix', 'mtx_group', 1, timbre, onChange);
        const mtxList = document.createElement('div');
        mtxList.className = 'matrix-slots-list';

        for (let m = 1; m <= 12; m++) {
            const slotRow = document.createElement('div');
            slotRow.className = 'matrix-slot-row';
            slotRow.setAttribute('data-slot', m);
            if (m >= 11) {
                slotRow.setAttribute('data-fw-v3-only', 'true');
            }

            const badge = document.createElement('div');
            badge.className = 'matrix-slot-badge';
            badge.textContent = `${m}`;
            badge.title = `Slot ${m} • Drag to copy to another slot`;

            this.wireSectionDragSource(badge, 'mtx', m, { containerEl: slotRow });
            this.wireSectionDropTarget(slotRow, 'mtx', m, timbre, onChange, {
                hoverClass: 'slot-drop-hover',
                onDrop: (srcIdx, dstIdx) => {
                    this._refreshSectionNode(slotRow);
                    this.showNotification(`Copied Slot ${srcIdx} to Slot ${dstIdx}`, 'success');
                }
            });

            const srcSelect = createSelect(`MTX${m}_SRC`, timbre, onChange);
            srcSelect.classList.add('mtx-select-src');
            this.wireMtxFieldDragDrop(srcSelect, 'src', m, timbre, onChange);

            const arrow = document.createElement('span');
            arrow.className = 'matrix-arrow';
            arrow.textContent = '→';

            const dstSelect = createSelect(`MTX${m}_DST`, timbre, onChange);
            dstSelect.classList.add('mtx-select-dst');
            this.wireMtxFieldDragDrop(dstSelect, 'dst', m, timbre, onChange);

            const amtSlider = createBipolarSlider(`MTX${m}_AMT`, timbre, onChange, { label: 'Amt' });

            const actions = document.createElement('div');
            actions.className = 'matrix-slot-actions';

            const btnRandom = document.createElement('button');
            btnRandom.type = 'button';
            btnRandom.className = 'btn-slot-icon';
            btnRandom.title = `Smart randomize Slot ${m}`;
            btnRandom.innerHTML = ICON_RANDOM_SVG;
            btnRandom.onclick = () => {
                randomizeSection('mtx', m, timbre(), onChange);
                this._refreshSectionNode(slotRow);
                this.showNotification(`Randomized Matrix Slot ${m}`, 'info');
            };

            const btnClear = document.createElement('button');
            btnClear.type = 'button';
            btnClear.className = 'btn-slot-icon btn-slot-clear';
            btnClear.title = `Clear Slot ${m}`;
            btnClear.textContent = '✕';
            btnClear.onclick = () => {
                resetSectionToInit('mtx', m, timbre(), onChange);
                this._refreshSectionNode(slotRow);
            };

            actions.appendChild(btnRandom);
            actions.appendChild(btnClear);

            slotRow.appendChild(badge);
            slotRow.appendChild(srcSelect);
            slotRow.appendChild(arrow);
            slotRow.appendChild(dstSelect);
            slotRow.appendChild(amtSlider);
            slotRow.appendChild(actions);

            mtxList.appendChild(slotRow);
        }
        mtxSec.body.appendChild(mtxList);
        return mtxSec.card;
    }

    _buildEffectsAndChordColumn(timbre, onChange, makeSection) {
        const fxSec = createSectionCard('Effects & Space', 'fx', 1, timbre, onChange);
        const fxLayout = document.createElement('div');
        fxLayout.className = 'fx-layout-grid';

        const fxRowTop = document.createElement('div');
        fxRowTop.className = 'fx-row-top';

        const dlyBox = document.createElement('div');
        dlyBox.className = 'fx-sub-panel fx-sub-delay';
        dlyBox.innerHTML = '<div class="fx-sub-title">Delay</div>';
        const dlyStrip = document.createElement('div');
        dlyStrip.className = 'fx-strip-horizontal';
        dlyStrip.appendChild(createSelect('DLY_TYPE', timbre, onChange));
        dlyStrip.appendChild(createKnob('DLY_PARAM1', timbre, onChange));
        dlyStrip.appendChild(createKnob('DLY_PARAM2', timbre, onChange));
        dlyStrip.appendChild(createKnob('DLY_PARAM3', timbre, onChange));
        dlyBox.appendChild(dlyStrip);
        fxRowTop.appendChild(dlyBox);

        const revBox = document.createElement('div');
        revBox.className = 'fx-sub-panel fx-sub-reverb';
        revBox.innerHTML = '<div class="fx-sub-title">Reverb</div>';
        const revKnobs = document.createElement('div');
        revKnobs.className = 'knob-row';
        revKnobs.appendChild(createKnob('REV_PARAM1', timbre, onChange));
        revKnobs.appendChild(createKnob('REV_PARAM2', timbre, onChange));
        revKnobs.appendChild(createKnob('REV_PARAM3', timbre, onChange));
        revBox.appendChild(revKnobs);
        fxRowTop.appendChild(revBox);

        fxLayout.appendChild(fxRowTop);

        const fxRowBottom = document.createElement('div');
        fxRowBottom.className = 'fx-row-bottom';

        const unifiedBox = document.createElement('div');
        unifiedBox.className = 'fx-sub-panel fx-sub-unified';
        unifiedBox.innerHTML = '<div class="fx-sub-title">Chorus, EQ & Morph</div>';
        const unifiedStrip = document.createElement('div');
        unifiedStrip.className = 'fx-strip-horizontal';
        unifiedStrip.appendChild(createSelect('IFX_CHORUS', timbre, onChange));
        unifiedStrip.appendChild(createKnob('IFX_EQ', timbre, onChange));
        unifiedStrip.appendChild(createKnob('MORPH_KNOB', timbre, onChange));
        unifiedBox.appendChild(unifiedStrip);
        fxRowBottom.appendChild(unifiedBox);

        const panBox = document.createElement('div');
        panBox.className = 'fx-sub-panel fx-sub-pan';
        panBox.innerHTML = '<div class="fx-sub-title">Pan</div>';
        const panStrip = document.createElement('div');
        panStrip.className = 'fx-strip-horizontal';
        panStrip.appendChild(createSelect('PAN_MODE', timbre, onChange));
        panStrip.appendChild(createKnob('VCE_PAN_SPREAD', timbre, onChange));
        panBox.appendChild(panStrip);
        fxRowBottom.appendChild(panBox);

        fxLayout.appendChild(fxRowBottom);
        fxSec.body.appendChild(fxLayout);

        const fxChordCol = document.createElement('div');
        fxChordCol.className = 'fx-chord-column';
        fxChordCol.appendChild(fxSec.card);

        const chordSec = makeSection('FW v3 Chorder & Scaler Engine');
        chordSec.card.classList.add('chord-scaler-card');
        chordSec.card.setAttribute('data-fw-v3-only', 'true');

        const expandedChordControls = [];
        const updateChordExpandState = () => {
            const prog = typeof timbre === 'function' ? timbre() : timbre;
            const expandOn = prog ? prog.getValue('KBD_CHORD_EXPAND') === 1 : false;
            const isV2 = this.midi ? this.midi.effectiveFirmwareVersion === 2 : false;
            expandedChordControls.forEach(ctrl => {
                if (ctrl && ctrl.setDisabled) {
                    ctrl.setDisabled(isV2 || !expandOn);
                }
            });
        };

        const chordTopRow = document.createElement('div');
        chordTopRow.className = 'chord-top-row';

        const chordToggleStack = document.createElement('div');
        chordToggleStack.className = 'chord-toggle-stack';
        chordToggleStack.appendChild(createSelect('KBD_MIDI_INPUT', timbre, onChange));
        chordToggleStack.appendChild(createSelect('KBD_CHORD_EXPAND', timbre, (k, v, meta) => {
            onChange(k, v, meta);
            updateChordExpandState();
        }));
        chordTopRow.appendChild(chordToggleStack);

        const keySelect = createSelect('KBD_KEY', timbre, onChange);
        keySelect.classList.add('chord-key-select');
        chordTopRow.appendChild(keySelect);

        const scaleSelect = createSelect('KBD_SCALE', timbre, onChange);
        scaleSelect.classList.add('chord-scale-select');
        chordTopRow.appendChild(scaleSelect);

        chordTopRow.appendChild(createKnob('KBD_OCTAVE', timbre, onChange));
        chordSec.body.appendChild(chordTopRow);

        const chordCols = document.createElement('div');
        chordCols.className = 'chord-degrees-columns';

        const col1 = document.createElement('div');
        col1.className = 'chord-degrees-col';
        for (let d = 1; d <= 4; d++) {
            const ctrl = createSelect(`CHORD_TYPE${d}`, timbre, onChange);
            if (d >= 2) expandedChordControls.push(ctrl);
            col1.appendChild(ctrl);
        }
        chordCols.appendChild(col1);

        const col2 = document.createElement('div');
        col2.className = 'chord-degrees-col';
        for (let d = 5; d <= 7; d++) {
            const ctrl = createSelect(`CHORD_TYPE${d}`, timbre, onChange);
            expandedChordControls.push(ctrl);
            col2.appendChild(ctrl);
        }
        const noteEl = document.createElement('div');
        noteEl.className = 'chord-degrees-note';
        noteEl.textContent = 'Degree 1 = Base Chord; Degrees 2–7 require Chord Expand';
        col2.appendChild(noteEl);
        chordCols.appendChild(col2);

        chordSec.body.appendChild(chordCols);
        chordSec.card.refresh = () => {
            this._refreshSectionNode(chordSec.card);
            updateChordExpandState();
        };
        updateChordExpandState();
        fxChordCol.appendChild(chordSec.card);
        return fxChordCol;
    }

    _buildArpCard(timbre, onChange, makeSection) {
        const arpSec = makeSection('Arpeggiator / Sequencer');
        const arpLayout = document.createElement('div');
        arpLayout.className = 'arp-main-layout';

        const arpControlsRow = document.createElement('div');
        arpControlsRow.className = 'arp-controls-row';
        const arpToggleStack = document.createElement('div');
        arpToggleStack.className = 'arp-compact-stack';
        arpToggleStack.appendChild(createSelect('ARP_OFF_ON', timbre, onChange));
        arpToggleStack.appendChild(createSelect('ARP_LATCH', timbre, onChange));
        arpControlsRow.appendChild(arpToggleStack);
        arpControlsRow.appendChild(createSelect('ARP_TYPE', timbre, onChange));
        arpControlsRow.appendChild(createSelect('ARP_SPEED', timbre, onChange));
        arpControlsRow.appendChild(createKnob('ARP_OCTAVE', timbre, onChange));
        arpControlsRow.appendChild(createKnob('ARP_GATE', timbre, onChange));
        arpControlsRow.appendChild(createKnob('ARP_PTN_LENGTH', timbre, onChange));
        const arpModStack = document.createElement('div');
        arpModStack.className = 'arp-compact-stack';
        arpModStack.setAttribute('data-fw-v3-only', 'true');
        arpModStack.appendChild(createSelect('ARP_STEPSEQ_DEST', timbre, onChange));
        arpModStack.appendChild(createSelect('ARP_STEPSEQ_POLARITY', timbre, onChange));
        arpControlsRow.appendChild(arpModStack);
        arpLayout.appendChild(arpControlsRow);

        const arpSeq = createArpSequencer(timbre, onChange);
        arpSeq.id = 'arp-seq-wrapper';
        arpLayout.appendChild(arpSeq);
        arpSec.body.appendChild(arpLayout);
        return arpSec.card;
    }

    buildEditorUI() {
        if (typeof document === 'undefined') return;
        const grid = document.getElementById('editor-grid');
        if (!grid) return;
        grid.innerHTML = '';

        const timbre = () => this.activeTimbre;
        const onChange = this.createOnChange();

        const makeRow = (rowClass = '') => {
            const row = document.createElement('div');
            row.className = `rack-row ${rowClass}`;
            return row;
        };

        const makeSection = (title, className = '') => {
            const card = document.createElement('div');
            card.className = `synth-card ${className}`;
            const head = document.createElement('div');
            head.className = 'synth-card-header';
            head.textContent = title;
            card.appendChild(head);
            const body = document.createElement('div');
            body.className = 'synth-card-body';
            card.appendChild(body);
            return { card, body };
        };

        // Row 1: Oscillators, Filter, Envelopes
        const row1 = makeRow('rack-row-1');
        row1.appendChild(this.createOscillatorPanel(timbre, onChange));
        row1.appendChild(this._buildFilterCard(timbre, onChange));
        row1.appendChild(this.createEnvelopePanel(timbre, onChange));
        grid.appendChild(row1);

        // Row 2: LFOs, Voice Performance, Math Operators
        const row2 = makeRow('rack-row-2');
        row2.appendChild(this._buildLfoGroupCard(timbre, onChange));
        row2.appendChild(this._buildVoiceCard(timbre, onChange, makeSection));
        row2.appendChild(this._buildMathCard(timbre, onChange, makeSection));
        grid.appendChild(row2);

        // Row 3: Knobs + Modulation Matrix | Effects & Chorder
        const row3 = makeRow('rack-row-3');
        const modRightCol = document.createElement('div');
        modRightCol.className = 'mod-right-column';
        modRightCol.appendChild(this._buildKnobsAssignCard(timbre, onChange, makeSection));
        modRightCol.appendChild(this._buildMatrixCard(timbre, onChange));
        row3.appendChild(modRightCol);
        row3.appendChild(this._buildEffectsAndChordColumn(timbre, onChange, makeSection));
        grid.appendChild(row3);

        // Row 4: Arpeggiator Engine
        const row4 = makeRow('rack-row-4');
        row4.appendChild(this._buildArpCard(timbre, onChange, makeSection));
        grid.appendChild(row4);

        this.wireModSourceToDestinationDropTargets(grid, timbre, onChange);
        this.setupProgramBar();

        // Populate O(1) parameter control lookup cache
        this._paramControlMap.clear();
        grid.querySelectorAll('[data-param]').forEach(el => {
            this._paramControlMap.set(el.getAttribute('data-param'), el);
        });
        const tempoContainer = document.getElementById('prog-tempo-container');
        if (tempoContainer) {
            tempoContainer.querySelectorAll('[data-param]').forEach(el => {
                this._paramControlMap.set(el.getAttribute('data-param'), el);
            });
        }
    }

    async _readSysExFile(inputEl, onMessages) {
        const file = inputEl.files && inputEl.files[0];
        if (!file) return;
        try {
            const buf = new Uint8Array(await file.arrayBuffer());
            const msgs = extractSysExMessagesWithMeta(buf);
            if (msgs.length === 0) {
                await this._alertDialog({
                    title: 'Invalid SysEx File',
                    description: 'No valid MicroMonsta 2 SysEx program dump found in this file.'
                });
                return;
            }
            await onMessages(msgs, file);
        } catch (err) {
            await this._alertDialog({
                title: 'Error Loading SysEx File',
                description: err.message
            });
        } finally {
            inputEl.value = '';
        }
    }

    setupProgramBar() {
        this._setupProgramMetaControls();
        this._setupLiveSyncToggle();
        this._setupProgramFileIO();
        this._setupProgramActionButtons();
    }

    _setupProgramMetaControls() {
        const broadcastMeta = () => {
            if (this.tabSync) {
                this.tabSync.broadcast('PATCH_META_CHANGE', {
                    slot: this.activeSlot,
                    name: this.activeTimbre.name,
                    category: this.activeTimbre.category
                });
            }
        };

        const nameInput = document.getElementById('prog-name-input');
        if (nameInput) {
            nameInput.value = this.activeTimbre.name;
            nameInput.onchange = () => {
                this.activeTimbre.name = nameInput.value;
                this.onParameterChanged('LAY_NAME_1', 0);
                broadcastMeta();
            };
            const blockDrop = (e) => {
                if (e && e.preventDefault) e.preventDefault();
                if (e && e.stopPropagation) e.stopPropagation();
                if (e && e.dataTransfer) e.dataTransfer.dropEffect = 'none';
                const appMain = typeof document !== 'undefined' ? document.querySelector('.app-main') : null;
                if (appMain) {
                    appMain.classList.remove('slot-drop-hover');
                    this._clearDropTip(appMain);
                }
            };
            nameInput.addEventListener('dragenter', blockDrop);
            nameInput.addEventListener('dragover', blockDrop);
            nameInput.addEventListener('drop', blockDrop);
        }

        const catSelect = document.getElementById('prog-category-select');
        if (catSelect) {
            catSelect.innerHTML = '';
            LOOKUPS.categories.forEach((c, idx) => {
                const opt = document.createElement('option');
                opt.value = idx;
                opt.textContent = c;
                catSelect.appendChild(opt);
            });
            catSelect.value = this.activeTimbre.category;
            catSelect.onchange = () => {
                this.activeTimbre.category = parseInt(catSelect.value, 10);
                this.onParameterChanged('LAY_CATEGORY', this.activeTimbre.category);
                broadcastMeta();
            };
        }

        const tempoContainer = document.getElementById('prog-tempo-container');
        if (tempoContainer) {
            tempoContainer.innerHTML = '';
            const tempoKnob = createKnob('LAY_TEMPO', () => this.activeTimbre, (k, v, m) => this.onParameterChanged(k, v, m), { small: true });
            tempoContainer.appendChild(tempoKnob);
        }
    }

    _setupLiveSyncToggle() {
        const btnLiveSync = document.getElementById('btn-prog-live-sync');
        if (!btnLiveSync) return;

        this.updateLiveSyncUI();
        btnLiveSync.onclick = async () => {
            if (!this.isConnectionGood) {
                this.updateLiveSyncUI();
                return;
            }
            if (!(this.midi && this.midi.liveSync)) {
                if (this._checkingLiveSync) return;
                this._checkingLiveSync = true;
                try {
                    if (this.midi && typeof this.midi.requestProgramDump === 'function' && this.midi.inPort && this.midi.outPort) {
                        const hwDump = await this.midi.requestProgramDump(this.activeSlot, { timeoutMs: 2000 });
                        if (!this.isConnectionGood) return;
                        if (hwDump && programsMatch(hwDump.program, this.activeTimbre)) {
                            this._setLiveSyncState(true);
                            this.updateSyncStatus(this.isConnectionGood ? 'synced' : 'offline');
                            this.showNotification('Live Sync ENABLED (Hardware and editor already match)', 'success');
                            return;
                        }
                    }
                } finally {
                    this._checkingLiveSync = false;
                }
                const choice = await this.promptSyncAction({
                    title: '⚠️ Enable Live Hardware Sync?',
                    description: 'Enabling Live Sync transmits parameter edits immediately to your MicroMonsta 2 over MIDI NRPN/CC. To avoid accidental patch overwrites or sound mismatches, choose an initial synchronization action:',
                    fetchDetail: 'Pulls current hardware settings from your MicroMonsta 2 into this editor before enabling live sync.',
                    pushDetail: 'Transmits this editor\'s current patch settings into the active hardware layer (A or B).'
                });
                if (choice === 'fetch') {
                    this._enableLiveSyncOnFetch = true;
                    this.fetchActiveProgram();
                } else if (choice === 'push') {
                    if (this._sendActiveProgramToHardware()) {
                        this._setLiveSyncState(true);
                        this.showNotification('Live Sync ENABLED (Pushed patch to MM2)', 'success');
                    } else {
                        this._setLiveSyncState(false, { broadcast: false });
                    }
                } else if (choice === null) {
                    this._setLiveSyncState(true);
                    this.updateSyncStatus(this.isConnectionGood ? 'synced' : 'offline');
                } else {
                    this._setLiveSyncState(false, { broadcast: false });
                }
            } else {
                this._setLiveSyncState(false);
                this._refreshSyncStatusAfterLiveSyncDisable();
                this.showNotification('Live Sync DISABLED', 'info');
            }
        };
    }

    _setupProgramFileIO() {
        const btnSave = document.getElementById('btn-prog-save');
        if (btnSave) {
            btnSave.onclick = () => {
                const fwVer = this.midi ? this.midi.effectiveFirmwareVersion : 3;
                const fwId = this.midi && this.midi.detectedFwId !== null ? this.midi.detectedFwId : SYSEX_V2_FW_ID;
                this.librarian.exportProgramFile(this.activeTimbre, null, fwVer, fwId);
            };
        }

        const btnLoad = document.getElementById('btn-prog-load');
        const fileInput = document.getElementById('prog-file-picker');
        if (btnLoad && fileInput) {
            btnLoad.onclick = () => fileInput.click();
            fileInput.onchange = () => this._readSysExFile(fileInput, (msgs, file) => {
                this.replacePartWithRawData(this.activeSlot, msgs[0].bytes, `Load ${file.name}`, {
                    sendToHardware: false,
                    syncStatus: this.isConnectionGood ? 'synced' : 'offline',
                    source: 'file',
                    clearUndo: true,
                    setOriginalSnapshot: true
                });
                const fwVer = this.midi ? this.midi.effectiveFirmwareVersion : 3;
                const incompat = fwVer === 2 ? detectV3Incompatibilities(this.activeTimbre) : { hasIncompatibilities: false, reasons: [] };
                if (incompat.hasIncompatibilities) {
                    this.showNotification(
                        `Loaded v3 patch "${this.activeTimbre.name}" in v2.x mode. Omitted on v2.x send/export: ${incompat.reasons.join(', ')}`,
                        'warning'
                    );
                } else {
                    this.showNotification(`Loaded program "${this.activeTimbre.name}" from ${file.name}`, 'success');
                }
            });
        }
    }

    _setupProgramActionButtons() {
        const btnFetch = document.getElementById('btn-prog-fetch');
        if (btnFetch) {
            btnFetch.onclick = () => {
                if (!this.isConnectionGood || (this.midi && this.midi.liveSync)) return;
                this.fetchActiveProgram();
            };
        }

        const btnUndo = document.getElementById('btn-prog-undo');
        if (btnUndo) {
            this._bindClickAndHold(btnUndo, {
                onClick: () => this.undo(),
                onHold: () => this._showHistoryMenu(false, btnUndo)
            });
        }

        const btnRedo = document.getElementById('btn-prog-redo');
        if (btnRedo) {
            this._bindClickAndHold(btnRedo, {
                onClick: () => this.redo(),
                onHold: () => this._showHistoryMenu(true, btnRedo)
            });
        }

        this.wireMemoryAndPartDragDrop();
        this.updateMemoryUI();

        const btnCompare = document.getElementById('btn-prog-compare');
        if (btnCompare) btnCompare.onclick = () => this.toggleCompare();

        const btnInit = document.getElementById('btn-prog-init');
        if (btnInit) {
            btnInit.onclick = async () => {
                const partLabel = `Part ${this.activeSlot === 0 ? 'A' : 'B'}`;
                const liveSyncNote = this.midi.liveSync ? ' and immediately synchronize with connected MicroMonsta 2 hardware' : '';
                if (await this._promptInitPatch(partLabel, this.activeTimbre.name, liveSyncNote)) {
                    const canSync = this.midi.liveSync && this.isConnectionGood;
                    this.replacePartWithRawData(this.activeSlot, new MM2Program().rawData, `Init ${partLabel}`, {
                        sendToHardware: false,
                        syncStatus: canSync ? 'synced' : 'modified',
                        source: 'init'
                    });

                    if (canSync) {
                        try {
                            this.midi.sendProgram(this.activeTimbre, this.activeSlot);
                            this.showNotification(`Initialized ${partLabel} and synced with hardware.`, 'success');
                        } catch (err) {
                            this.showNotification(`Initialized ${partLabel}, but hardware sync failed: ${err.message}`, 'warning');
                        }
                    } else {
                        this.showNotification(`Program initialized to defaults (${partLabel}).`, 'info');
                    }
                }
            };
        }

        const btnPush = document.getElementById('btn-prog-push');
        if (btnPush) {
            btnPush.onclick = () => {
                if (!this.isConnectionGood || (this.midi && this.midi.liveSync)) return;
                this.confirmAndSendProgram();
            };
        }

        const btnAddToLib = document.getElementById('btn-prog-add-to-lib');
        if (btnAddToLib) {
            btnAddToLib.onclick = () => {
                const prog = this.activeTimbre.clone();
                const bank = this.librarian.activeBank;
                if (!bank) {
                    this.showNotification('No active bank found in Librarian.', 'error');
                    return;
                }
                bank.addProgram(prog);
                this.librarian.saveAllBanks();
                this.showNotification(`Stored "${prog.name}" in bank "${bank.name}" (Slot ${bank.length})`, 'success');
            };
        }

        const btnCopyOther = document.getElementById('btn-prog-copy-other');
        if (btnCopyOther) {
            btnCopyOther.onclick = () => {
                const targetSlot = this.activeSlot === 0 ? 1 : 0;
                const srcLabel = this.activeSlot === 0 ? 'A' : 'B';
                const dstLabel = targetSlot === 1 ? 'B' : 'A';
                this.replacePartWithRawData(targetSlot, this.activeTimbre.rawData, `Copy Part ${srcLabel} → Part ${dstLabel}`, {
                    sendToHardware: false,
                    syncStatus: null,
                    source: 'copy',
                    setOriginalSnapshot: true
                });
                this.showNotification(`Copied Part ${srcLabel} "${this.activeTimbre.name}" to Part ${dstLabel}`, 'success');
            };
        }
    }

    _openDialog(dialogId, setupFn = null, cleanupFn = null) {
        if (typeof document === 'undefined') {
            if (cleanupFn) cleanupFn();
            return Promise.resolve(null);
        }
        const dialog = document.getElementById(dialogId);
        if (!dialog || typeof dialog.showModal !== 'function' || dialog.open) {
            if (cleanupFn) cleanupFn();
            return Promise.resolve(null);
        }
        if (setupFn) setupFn(dialog);

        return new Promise((resolve) => {
            const onClose = () => {
                dialog.removeEventListener('close', onClose);
                if (cleanupFn) cleanupFn();
                resolve(dialog.returnValue || null);
            };
            dialog.addEventListener('close', onClose);
            try {
                dialog.showModal();
            } catch (e) {
                dialog.removeEventListener('close', onClose);
                if (cleanupFn) cleanupFn();
                resolve(null);
            }
        });
    }

    _sendActiveProgramToHardware() {
        try {
            this.midi.sendProgram(this.activeTimbre, this.activeSlot, true);
            this._setOriginalSnapshot(this.activeSlot, this.activeTimbre);
            this.updateSyncStatus(this.isConnectionGood ? 'synced' : 'offline');
            return true;
        } catch (err) {
            this.updateSyncStatus('failed');
            this.midi.markHardwareResponsive(false);
            this.updateConnectionStatus();
            this.showNotification('Failed to send program: ' + err.message, 'error');
            return false;
        }
    }

    async confirmAndSendProgram() {
        if (!this.midi.outPort) {
            this.showNotification('No MIDI Output port is selected. Please open MIDI Settings and select the port where MicroMonsta 2 is connected.', 'error');
            this.switchView('settings');
            return false;
        }

        const slotLabel = this.activeSlot === 0 ? 'Layer A' : 'Layer B';
        const progName = this.activeTimbre.name;
        const fwVer = this.midi ? this.midi.effectiveFirmwareVersion : 3;
        const incompat = fwVer === 2 ? detectV3Incompatibilities(this.activeTimbre) : { hasIncompatibilities: false, reasons: [] };

        const confirmed = await this._promptPushConfirm(progName, slotLabel, this.midi.outPort.name, incompat);
        if (!confirmed) return false;

        const sent = this._sendActiveProgramToHardware();
        if (sent) {
            this.showNotification(`Successfully sent "${progName}" to MM2 ${slotLabel}!`, 'success');
        }
        return sent;
    }

    async _promptPushConfirm(progName, slotLabel, portName, incompat) {
        const result = await this._openDialog('push-confirm-dialog', () => {
            const desc = document.getElementById('push-confirm-desc');
            if (desc) {
                desc.textContent = `Send program "${progName}" to MicroMonsta 2 (${slotLabel}) via port "${portName}"? This will overwrite the active edit buffer on the synth.`;
            }

            const incompatEl = document.getElementById('push-confirm-incompat');
            if (incompatEl) {
                if (incompat && incompat.hasIncompatibilities) {
                    incompatEl.textContent = `Firmware v2.x Note: The following v3-only features will be omitted: ${incompat.reasons.join(', ')}.`;
                    incompatEl.style.display = '';
                } else {
                    incompatEl.textContent = '';
                    incompatEl.style.display = 'none';
                }
            }
        });
        return result === 'confirm';
    }

    _updateSyncActionDialogState() {
        if (typeof document === 'undefined') return;
        const fetchBtn = document.getElementById('sync-action-fetch-btn');
        const pushBtn = document.getElementById('sync-action-push-btn');
        const statusEl = document.getElementById('sync-action-status');
        const ready = !this._syncActionRequireVerified || this.isConnectionGood;

        if (fetchBtn) {
            fetchBtn.disabled = !ready;
            fetchBtn.title = ready ? '' : 'Waiting for MicroMonsta 2 hardware to respond';
        }
        if (pushBtn) {
            pushBtn.disabled = !ready;
            pushBtn.title = ready ? '' : 'Waiting for MicroMonsta 2 hardware to respond';
        }
        if (statusEl) {
            if (!this._syncActionRequireVerified) {
                statusEl.style.display = 'none';
                statusEl.textContent = '';
                statusEl.className = 'dialog-status';
            } else if (!this.isConnectionGood) {
                statusEl.style.display = '';
                if (this.midi && this.midi.hardwareResponsive === false) {
                    statusEl.textContent = 'MicroMonsta 2 did not respond yet. Check power/MIDI cables or click Ignore.';
                    statusEl.className = 'dialog-status warning';
                } else {
                    statusEl.textContent = 'Waiting for MicroMonsta 2 hardware to finish booting and respond...';
                    statusEl.className = 'dialog-status waiting';
                }
            } else {
                statusEl.style.display = '';
                statusEl.textContent = 'MicroMonsta 2 hardware is ready.';
                statusEl.className = 'dialog-status ready';
            }
        }
    }

    promptSyncAction({ title, description, fetchDetail, pushDetail, ignoreLabel = 'Ignore', requireVerified = false } = {}) {
        this._syncActionRequireVerified = !!requireVerified;
        return this._openDialog('sync-action-dialog', () => {
            const titleEl = document.getElementById('sync-action-title');
            if (titleEl && title !== undefined) titleEl.textContent = title;
            const descEl = document.getElementById('sync-action-desc');
            if (descEl && description !== undefined) descEl.textContent = description;
            const fetchEl = document.getElementById('sync-action-fetch-detail');
            if (fetchEl && fetchDetail !== undefined) fetchEl.textContent = fetchDetail;
            const pushEl = document.getElementById('sync-action-push-detail');
            if (pushEl && pushDetail !== undefined) pushEl.textContent = pushDetail;
            const ignoreBtn = document.getElementById('sync-action-ignore-btn');
            if (ignoreBtn) ignoreBtn.textContent = ignoreLabel;
            this._updateSyncActionDialogState();
        }, () => {
            this._syncActionRequireVerified = false;
        });
    }

    async promptReconnectSync({ isReconnect = true, portName = '' } = {}) {
        if (typeof document === 'undefined') return;
        if (this._isPromptingSync) return;
        this._isPromptingSync = true;

        try {
            if (isReconnect && this.midi && this.midi.hardwareResponsive === true && typeof this.midi.requestProgramDump === 'function' && this.midi.inPort && this.midi.outPort) {
                const partA = await this.midi.requestProgramDump(0, { timeoutMs: 2000 });
                if (partA && programsMatch(partA.program, this.timbreA)) {
                    const partB = await this.midi.requestProgramDump(1, { timeoutMs: this.modeProbeTimeoutMs });
                    let partBMatches = false;
                    if (partB) {
                        if (this.synthTimbralMode === 'monotimbral') {
                            this.setTimbralMode('bitimbral');
                        }
                        partBMatches = programsMatch(partB.program, this.timbreB);
                    } else {
                        partBMatches = this.synthTimbralMode === 'monotimbral';
                    }
                    if (partBMatches) {
                        this.originalSnapshotA = this.timbreA.clone();
                        if (partB) {
                            this.originalSnapshotB = this.timbreB.clone();
                        }
                        this.updateSyncStatus(this.isConnectionGood ? 'synced' : 'offline');
                        this.updateConnectionStatus();
                        this.showNotification('MicroMonsta 2 reconnected (already in sync)', 'success');
                        return;
                    }
                }
            }

            const portSuffix = portName ? ` (${portName})` : '';
            const choice = await this.promptSyncAction({
                title: isReconnect ? '🔄 MicroMonsta 2 Reconnected' : '🔌 MicroMonsta 2 Connected',
                description: isReconnect
                    ? `Communication with your MicroMonsta 2 synthesizer${portSuffix} has been restored. Choose whether to fetch parameters from the hardware, push this editor's parameters to the synth, or ignore:`
                    : `Connected to your MicroMonsta 2 synthesizer${portSuffix}. Choose whether to fetch parameters from the hardware, push this editor's parameters to the synth, or ignore:`,
                fetchDetail: 'Reads active edit buffer settings from the synth hardware into Part A and Part B.',
                pushDetail: 'Transmits current patch parameters in the editor to the synth hardware.',
                requireVerified: true
            });

            if (choice === 'fetch') {
                this.fetchActiveProgram(0, { probe: 'load' });
            } else if (choice === 'push') {
                this.showNotification('Pushing patch settings from editor to MM2...', 'info');
                this.pushAllPartsToHardware();
                if (this.midi && this.midi.inPort && this.midi.outPort) {
                    setTimeout(() => this._probeIfNeeded(2500), 200);
                }
            } else if (choice === 'ignore') {
                this._probeIfNeeded(2500);
            } else if (choice === null) {
                this._probeIfNeeded(2500);
                this.showNotification(isReconnect ? 'MicroMonsta 2 reconnected!' : 'MicroMonsta 2 connected!', 'success');
            }
        } finally {
            setTimeout(() => {
                this._isPromptingSync = false;
            }, 300);
        }
    }

    pushAllPartsToHardware() {
        if (!this.midi.outPort) {
            this.showNotification('No MIDI Output port selected.', 'error');
            return;
        }
        try {
            // Send Part A
            this.midi.sendProgram(this.timbreA, 0);
            this.originalSnapshotA = this.timbreA.clone();
            // Send Part B if bitimbral/combi
            if (this.synthTimbralMode !== 'monotimbral') {
                setTimeout(() => {
                    try {
                        this.midi.sendProgram(this.timbreB, 1);
                        this.originalSnapshotB = this.timbreB.clone();
                    } catch (e) {
                        console.warn('Failed to send Part B:', e);
                    }
                }, 100);
            }
            this.updateSyncStatus(this.isConnectionGood ? 'synced' : 'offline');
            this.showNotification('Successfully pushed settings to MicroMonsta 2!', 'success');
        } catch (err) {
            this.showNotification('Failed to push settings: ' + err.message, 'error');
        }
    }

    buildLibrarianUI() {
        if (typeof document === 'undefined') return;
        const bankTabs = document.getElementById('bank-tabs');
        if (!bankTabs) return;

        this._wireLibrarianFilters();
        this._wireBankTabReorderAndDuplicate(bankTabs);
        this._wireLibrarianToolbarActions();
    }

    _wireLibrarianFilters() {
        const searchInput = document.getElementById('lib-search-input');
        if (searchInput) {
            searchInput.oninput = () => {
                this.searchQuery = searchInput.value.toLowerCase().trim();
                this.renderLibrarianBank();
            };
        }

        const catFilter = document.getElementById('lib-cat-filter');
        if (catFilter) {
            catFilter.innerHTML = '<option value="all">All Categories</option>';
            LOOKUPS.categories.forEach((cat, idx) => {
                const opt = document.createElement('option');
                opt.value = idx;
                opt.textContent = cat;
                catFilter.appendChild(opt);
            });
            catFilter.onchange = () => {
                this.activeCategoryFilter = catFilter.value;
                this.renderLibrarianBank();
            };
        }
    }

    _clearBankInsertMarkers() {
        const bankTabsContainer = typeof document !== 'undefined' ? document.getElementById('bank-tabs') : null;
        if (!bankTabsContainer || !bankTabsContainer.children) return;
        for (let i = 0; i < bankTabsContainer.children.length; i++) {
            const t = bankTabsContainer.children[i];
            if (t && t.classList) t.classList.remove('bank-insert-before', 'bank-insert-after');
        }
    }

    _updateBankInsertIndicator(fromIndex, clientX) {
        this._clearBankInsertMarkers();
        const bankTabsContainer = typeof document !== 'undefined' ? document.getElementById('bank-tabs') : null;
        if (!bankTabsContainer || !bankTabsContainer.children) return fromIndex;
        const tabs = Array.from(bankTabsContainer.children);
        if (tabs.length === 0) return fromIndex;
        let insertPos = tabs.length;
        if (typeof clientX === 'number') {
            insertPos = 0;
            for (let i = 0; i < tabs.length; i++) {
                const rect = typeof tabs[i].getBoundingClientRect === 'function' ? tabs[i].getBoundingClientRect() : null;
                if (!rect || (rect.left + rect.width / 2) < clientX) {
                    insertPos = i + 1;
                }
            }
        }
        const toIndex = fromIndex < insertPos ? insertPos - 1 : insertPos;
        const clampedTo = Math.max(0, Math.min(tabs.length - 1, toIndex));
        if (clampedTo !== fromIndex) {
            if (insertPos < tabs.length && tabs[insertPos].classList) {
                tabs[insertPos].classList.add('bank-insert-before');
            } else if (tabs[tabs.length - 1].classList) {
                tabs[tabs.length - 1].classList.add('bank-insert-after');
            }
        }
        return clampedTo;
    }

    _wireBankTabReorderAndDuplicate(bankTabsContainer) {
        const btnAddBank = document.getElementById('btn-add-bank');
        const bankTabsBar = typeof document.querySelector === 'function' ? document.querySelector('.bank-tabs-bar') : null;

        if (btnAddBank) {
            btnAddBank.onclick = () => {
                const defaultName = `Bank ${this.librarian.banks.length + 1}`;
                this.librarian.addBank(defaultName);
                const newIndex = this.librarian.banks.length - 1;
                this.librarian.activeBankIndex = newIndex;
                this.renderLibrarianBank();

                const bankTabs = document.getElementById('bank-tabs');
                const newTab = bankTabs && bankTabs.children ? bankTabs.children[newIndex] : null;
                const tabTitle = newTab ? newTab.querySelector('.bank-tab-title') : null;
                if (tabTitle) {
                    this.startInlineBankRename(newIndex, tabTitle, newTab);
                }
            };
        }

        const isInsideBankTabs = (target) => {
            if (!bankTabsContainer || !target) return false;
            if (target === bankTabsContainer) return true;
            return typeof bankTabsContainer.contains === 'function' && bankTabsContainer.contains(target);
        };

        const clearDuplicateHover = () => {
            if (btnAddBank) {
                btnAddBank.classList.remove('slot-drop-hover');
                this._clearDropTip(btnAddBank);
            }
        };

        bankTabsContainer.ondragover = (e) => {
            const activeDrag = this._activeLibrarianDrag;
            if (!activeDrag || activeDrag.type !== 'bank-reorder') return;
            e.preventDefault();
            if (e.stopPropagation) e.stopPropagation();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            clearDuplicateHover();
            this._updateBankInsertIndicator(activeDrag.fromIndex, e.clientX);
        };

        bankTabsContainer.ondragleave = (e) => {
            if (e.relatedTarget && typeof bankTabsContainer.contains === 'function' && bankTabsContainer.contains(e.relatedTarget)) return;
            this._clearBankInsertMarkers();
        };

        bankTabsContainer.ondrop = (e) => {
            const data = this._parseDragPayload(e, this._activeLibrarianDrag);
            if (!data || data.type !== 'bank-reorder') return;
            e.preventDefault();
            if (e.stopPropagation) e.stopPropagation();
            clearDuplicateHover();
            const toIndex = this._updateBankInsertIndicator(data.fromIndex, e.clientX);
            this._clearBankInsertMarkers();
            this._activeLibrarianDrag = null;
            if (toIndex !== data.fromIndex) {
                this.librarian.reorderBanks(data.fromIndex, toIndex);
                this.renderLibrarianBank();
            }
        };

        const handleDuplicateDragOver = (e) => {
            const activeDrag = this._activeLibrarianDrag;
            if (!activeDrag || activeDrag.type !== 'bank-reorder') return;
            if (e.currentTarget === bankTabsBar && isInsideBankTabs(e.target)) {
                clearDuplicateHover();
                return;
            }
            e.preventDefault();
            if (e.stopPropagation) e.stopPropagation();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
            if (btnAddBank) {
                btnAddBank.classList.add('slot-drop-hover');
                const srcBank = this.librarian.banks[activeDrag.fromIndex];
                if (srcBank) {
                    this._setDropTip(btnAddBank, `Drop to duplicate "${srcBank.name}"`);
                }
            }
        };

        const handleDuplicateDragLeave = (targetEl, e) => {
            if (e.relatedTarget && typeof targetEl.contains === 'function' && targetEl.contains(e.relatedTarget)) return;
            clearDuplicateHover();
        };

        const handleDuplicateDrop = (e) => {
            if (e.currentTarget === bankTabsBar && isInsideBankTabs(e.target)) return;
            e.preventDefault();
            if (e.stopPropagation) e.stopPropagation();
            clearDuplicateHover();
            const data = this._parseDragPayload(e, this._activeLibrarianDrag);
            if (!data || data.type !== 'bank-reorder') return;
            const newBank = this.librarian.duplicateBank(data.fromIndex);
            this._activeLibrarianDrag = null;
            if (newBank) {
                const newIndex = this.librarian.banks.length - 1;
                this.librarian.activeBankIndex = newIndex;
                this.selectedProgIndices.clear();
                this._lastSelectedProgIndex = null;
                this.renderLibrarianBank();
                this.showNotification(`Duplicated bank as "${newBank.name}"`, 'success');

                const bankTabs = document.getElementById('bank-tabs');
                const newTab = bankTabs && bankTabs.children ? bankTabs.children[newIndex] : null;
                const tabTitle = newTab ? newTab.querySelector('.bank-tab-title') : null;
                if (tabTitle) {
                    this.startInlineBankRename(newIndex, tabTitle, newTab);
                }
            }
        };

        if (btnAddBank) {
            btnAddBank.ondragover = handleDuplicateDragOver;
            btnAddBank.ondragleave = (e) => handleDuplicateDragLeave(btnAddBank, e);
            btnAddBank.ondrop = handleDuplicateDrop;
        }
        if (bankTabsBar) {
            bankTabsBar.ondragover = handleDuplicateDragOver;
            bankTabsBar.ondragleave = (e) => handleDuplicateDragLeave(bankTabsBar, e);
            bankTabsBar.ondrop = handleDuplicateDrop;
        }
    }

    _wireLibrarianToolbarActions() {
        const btnExportBank = document.getElementById('btn-export-bank');
        if (btnExportBank) {
            btnExportBank.onclick = async () => {
                const fwVer = this.midi ? this.midi.effectiveFirmwareVersion : 3;
                const fwId = this.midi && this.midi.detectedFwId !== null ? this.midi.detectedFwId : SYSEX_V2_FW_ID;
                if (!this.librarian.exportBankFile(this.librarian.activeBankIndex, null, fwVer, fwId)) {
                    await this._alertDialog({
                        title: 'Empty Bank',
                        description: 'Current bank is empty.'
                    });
                }
            };
        }

        const btnImportBank = document.getElementById('btn-import-bank');
        const bankFileInput = document.getElementById('bank-file-picker');
        if (btnImportBank && bankFileInput) {
            btnImportBank.onclick = () => bankFileInput.click();
            bankFileInput.onchange = () => this._readSysExFile(bankFileInput, async (msgs) => {
                const count = msgs.length;
                const fwVer = this.midi ? this.midi.effectiveFirmwareVersion : 3;
                let incompatCount = 0;
                for (const item of msgs) {
                    const prog = new MM2Program(item.bytes);
                    this.librarian.activeBank.addProgram(prog);
                    if (fwVer === 2 && item.version === 3 && detectV3Incompatibilities(prog).hasIncompatibilities) {
                        incompatCount++;
                    }
                }
                await this.librarian.saveAllBanks();
                this.renderLibrarianBank();
                if (incompatCount > 0) {
                    this.showNotification(
                        `Imported ${count} patches into "${this.librarian.activeBank.name}". Warning: ${incompatCount} patch(es) use v3-only features that will be omitted in v2.x mode.`,
                        'warning'
                    );
                } else {
                    this.showNotification(`Imported ${count} patches into "${this.librarian.activeBank.name}"`, 'success');
                }
            });
        }

        const btnDetectDups = document.getElementById('btn-detect-duplicates');
        if (btnDetectDups) {
            btnDetectDups.onclick = () => this.showDuplicateModal();
        }

        const btnCondense = document.getElementById('btn-condense-bank');
        if (btnCondense) {
            btnCondense.onclick = async () => {
                const confirmed = await this._confirmDialog({
                    title: 'Condense Bank?',
                    description: `Condense "${this.librarian.activeBank.name}"? This will remove duplicate patches and consolidate all slots into a clean sequential bank.`,
                    confirmLabel: 'Condense',
                    confirmClass: 'btn-warning'
                });
                if (confirmed) {
                    const res = this.librarian.condenseBank(this.librarian.activeBankIndex);
                    this.renderLibrarianBank();
                    this.showNotification(`Bank condensed! Removed ${res.removedDuplicates} duplicate(s). Total: ${res.finalCount} patches.`, 'success');
                }
            };
        }

        const btnDeleteAll = document.getElementById('btn-delete-all-patches');
        if (btnDeleteAll) {
            btnDeleteAll.onclick = async () => {
                const bank = this.librarian.activeBank;
                if (!bank) return;
                if (bank.length === 0) {
                    this.showNotification(`"${bank.name}" is already empty.`, 'info');
                    return;
                }
                const confirmed = await this._confirmDialog({
                    title: 'Delete All Patches?',
                    description: `Delete all ${bank.length} patches in "${bank.name}"? This cannot be undone.`,
                    confirmLabel: 'Delete All',
                    confirmClass: 'btn-danger'
                });
                if (confirmed) {
                    const removed = this.librarian.clearBank(this.librarian.activeBankIndex);
                    this.renderLibrarianBank();
                    this.showNotification(`Deleted ${removed} patches from "${bank.name}".`, 'success');
                }
            };
        }
    }

    startInlineBankRename(index, tabTitle, tab) {
        if (!tabTitle || tabTitle.querySelector('input')) return;
        const bank = this.librarian.banks[index];
        if (!bank) return;

        const originalName = bank.name;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'bank-tab-title-input';
        input.value = originalName;

        if (tab) tab.setAttribute('draggable', 'false');
        tabTitle.textContent = '';
        tabTitle.appendChild(input);
        if (input.focus) input.focus();
        if (input.select) input.select();

        let finished = false;
        const finish = (save) => {
            if (finished) return;
            finished = true;

            if (tab) tab.setAttribute('draggable', 'true');
            if (input.parentNode === tabTitle && tabTitle.removeChild) {
                tabTitle.removeChild(input);
            } else if (tabTitle.children) {
                tabTitle.children = tabTitle.children.filter(c => c !== input);
            }

            if (!save) {
                tabTitle.textContent = originalName;
                return;
            }

            const trimmed = input.value.trim();
            if (!trimmed) {
                tabTitle.textContent = originalName;
                this.showNotification('Bank name cannot be empty.', 'warning');
                return;
            }
            if (trimmed === originalName) {
                tabTitle.textContent = originalName;
                return;
            }

            const ok = this.librarian.renameBank(index, trimmed);
            if (ok) {
                this.renderLibrarianBank();
                this.showNotification(`Renamed bank to "${trimmed}".`, 'success');
            } else {
                tabTitle.textContent = originalName;
            }
        };

        input.onclick = (e) => e.stopPropagation();
        input.ondblclick = (e) => e.stopPropagation();
        input.onkeydown = (e) => {
            if (e.stopPropagation) e.stopPropagation();
            if (e.key === 'Enter') {
                if (e.preventDefault) e.preventDefault();
                finish(true);
            } else if (e.key === 'Escape') {
                if (e.preventDefault) e.preventDefault();
                finish(false);
            }
        };
        input.onblur = () => finish(true);
    }

    async deleteBank(index = this.librarian.activeBankIndex) {
        const bank = this.librarian.banks[index];
        if (!bank) return false;
        if (this.librarian.banks.length <= 1) {
            this.showNotification('Cannot delete the only bank. At least one bank is required.', 'warning');
            return false;
        }
        const patchNote = bank.length > 0 ? ` and all of its ${bank.length} patch(es)` : '';
        const confirmed = await this._promptDeleteBank(bank.name, patchNote);
        if (!confirmed) return false;

        const bankName = bank.name;
        const ok = this.librarian.removeBank(index);
        if (ok) {
            this.renderLibrarianBank();
            this.showNotification(`Deleted bank "${bankName}".`, 'success');
        }
        return ok;
    }

    async _confirmDialog({ title, description, confirmLabel = 'Confirm', confirmClass = 'btn-danger' }) {
        const result = await this._openDialog('app-confirm-dialog', () => {
            const titleEl = document.getElementById('app-confirm-title');
            if (titleEl) titleEl.textContent = title;
            const descEl = document.getElementById('app-confirm-desc');
            if (descEl) descEl.textContent = description;
            const okBtn = document.getElementById('app-confirm-ok-btn');
            if (okBtn) {
                okBtn.textContent = confirmLabel;
                okBtn.className = `btn ${confirmClass}`;
            }
        });
        return result === 'confirm';
    }

    async _alertDialog({ title, description }) {
        await this._openDialog('app-alert-dialog', () => {
            const titleEl = document.getElementById('app-alert-title');
            if (titleEl) titleEl.textContent = title;
            const descEl = document.getElementById('app-alert-desc');
            if (descEl) descEl.textContent = description;
        });
    }

    async _promptInitPatch(partLabel, patchName, liveSyncNote = '') {
        const result = await this._openDialog('init-patch-dialog', () => {
            const desc = document.getElementById('init-patch-desc');
            if (desc) {
                desc.textContent = `Reset ${partLabel} (${patchName}) to default INIT values${liveSyncNote}?`;
            }
        });
        return result === 'confirm';
    }

    async _promptDeleteBank(bankName, patchNote) {
        const result = await this._openDialog('delete-bank-dialog', () => {
            const desc = document.getElementById('delete-bank-desc');
            if (desc) {
                desc.textContent = `Delete bank "${bankName}"${patchNote}? This cannot be undone.`;
            }
        });
        return result === 'confirm';
    }

    renderLibrarianBank() {
        if (typeof document === 'undefined') return;
        const bankTabs = document.getElementById('bank-tabs');
        const progList = document.getElementById('librarian-prog-list');
        if (!bankTabs || !progList) return;

        this._renderBankTabs(bankTabs);

        const activeBank = this.librarian.activeBank;
        if (!activeBank) return;

        const dupInfo = this._updateDuplicateBadge(activeBank);
        const visiblePrograms = this._filterVisiblePrograms(activeBank);

        progList.innerHTML = '';
        if (visiblePrograms.length === 0) {
            progList.innerHTML = `
                <div class="empty-state">
                    <p>No presets found in this bank.</p>
                    <p class="text-subtle">Import a .syx file or trigger a dump from your MicroMonsta 2 hardware menu.</p>
                </div>
            `;
            return;
        }

        if (this.selectedProgIndices && this.selectedProgIndices.size > 0) {
            for (const idx of [...this.selectedProgIndices]) {
                if (idx < 0 || idx >= activeBank.length) {
                    this.selectedProgIndices.delete(idx);
                }
            }
        }

        const dragCtx = this._createLibrarianDragController(activeBank, progList);
        const rowCtx = { activeBank, progList, dupInfo, visiblePrograms, dragCtx };
        visiblePrograms.forEach(({ program, originalIndex }) => {
            progList.appendChild(this._createProgramRow(program, originalIndex, rowCtx));
        });
    }

    _renderBankTabs(bankTabs) {
        bankTabs.innerHTML = '';
        this.librarian.banks.forEach((bank, idx) => {
            const tab = document.createElement('div');
            tab.className = `bank-tab ${idx === this.librarian.activeBankIndex ? 'active' : ''}`;
            tab.setAttribute('draggable', 'true');
            tab.innerHTML = `
                <span class="bank-tab-drag" title="Drag to reorder banks">⋮⋮</span>
                <span class="bank-tab-title">${escapeHtml(bank.name)}</span>
                <span class="bank-tab-count">(${bank.length})</span>
                ${this.librarian.banks.length > 1 ? `<button class="bank-tab-close" data-index="${idx}" title="Delete bank ${escapeHtml(bank.name)}">✕</button>` : ''}
            `;

            tab.onclick = () => {
                if (this.librarian.activeBankIndex === idx) return;
                this.librarian.activeBankIndex = idx;
                this.selectedProgIndices.clear();
                this._lastSelectedProgIndex = null;
                this.renderLibrarianBank();
            };

            const tabTitle = tab.querySelector('.bank-tab-title');
            if (tabTitle) {
                tabTitle.title = 'Double-click to rename';
                tabTitle.ondblclick = (e) => {
                    e.stopPropagation();
                    this.startInlineBankRename(idx, tabTitle, tab);
                };
            }

            const closeBtn = tab.querySelector('.bank-tab-close');
            if (closeBtn) {
                closeBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.deleteBank(idx);
                };
            }

            tab.ondragstart = (e) => {
                const payload = { type: 'bank-reorder', fromIndex: idx };
                this._activeLibrarianDrag = payload;
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'copyMove';
                    e.dataTransfer.setData('text/plain', JSON.stringify(payload));
                }
                tab.classList.add('dragging');
            };
            tab.ondragend = () => {
                this._activeLibrarianDrag = null;
                tab.classList.remove('dragging');
                this._clearMemoryDragHover();
            };
            tab.ondragover = (e) => {
                e.preventDefault();
                if (e.stopPropagation) e.stopPropagation();
                const btnAdd = document.getElementById('btn-add-bank');
                if (btnAdd) {
                    btnAdd.classList.remove('slot-drop-hover');
                    this._clearDropTip(btnAdd);
                }
                const activeDrag = this._activeLibrarianDrag;
                if (activeDrag && activeDrag.type === 'bank-reorder') {
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                    this._updateBankInsertIndicator(activeDrag.fromIndex, e.clientX);
                    return;
                }
                if (activeDrag && activeDrag.type === 'prog-move' && activeDrag.bankIndex !== idx) {
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                    tab.classList.add('slot-drop-hover');
                    const count = activeDrag.progIndices ? activeDrag.progIndices.length : 1;
                    const srcBank = this.librarian.banks[activeDrag.bankIndex];
                    const firstIdx = activeDrag.progIndices ? activeDrag.progIndices[0] : activeDrag.progIndex;
                    const firstProg = srcBank ? srcBank.getProgram(firstIdx) : null;
                    const label = count > 1 ? `${count} patches` : (firstProg ? `"${firstProg.name}"` : 'patch');
                    this._setDropTip(tab, `Drop to move ${label} to "${bank.name}"`);
                }
            };
            tab.ondragleave = (e) => {
                if (e.relatedTarget && typeof tab.contains === 'function' && tab.contains(e.relatedTarget)) return;
                tab.classList.remove('slot-drop-hover');
                this._clearDropTip(tab);
            };
            tab.ondrop = (e) => {
                e.preventDefault();
                if (e.stopPropagation) e.stopPropagation();
                tab.classList.remove('slot-drop-hover');
                this._clearDropTip(tab);
                this._clearBankInsertMarkers();
                const data = this._parseDragPayload(e, this._activeLibrarianDrag);
                if (!data) return;
                if (data.type === 'bank-reorder') {
                    const toIndex = typeof e.clientX === 'number'
                        ? this._updateBankInsertIndicator(data.fromIndex, e.clientX)
                        : idx;
                    this._clearBankInsertMarkers();
                    this._activeLibrarianDrag = null;
                    if (toIndex !== data.fromIndex) {
                        this.librarian.reorderBanks(data.fromIndex, toIndex);
                        this.renderLibrarianBank();
                    }
                } else if (data.type === 'prog-move' && data.bankIndex !== idx) {
                    const indices = Array.isArray(data.progIndices) && data.progIndices.length > 0
                        ? data.progIndices
                        : [data.progIndex];
                    const movedCount = this.librarian.moveProgramsToBank(data.bankIndex, indices, idx);
                    this._activeLibrarianDrag = null;
                    if (movedCount > 0) {
                        this.selectedProgIndices.clear();
                        this._lastSelectedProgIndex = null;
                        this.renderLibrarianBank();
                        this.showNotification(`Moved ${movedCount} ${movedCount === 1 ? 'patch' : 'patches'} to "${bank.name}"`, 'success');
                    }
                }
            };

            bankTabs.appendChild(tab);
        });
    }

    _updateDuplicateBadge(bank) {
        const dupInfo = bank.detectDuplicates(true);
        const dupBadge = document.getElementById('bank-duplicates-badge');
        if (dupBadge) {
            if (dupInfo.duplicatesFound > 0) {
                dupBadge.textContent = `${dupInfo.duplicatesFound} Duplicates Found`;
                dupBadge.className = 'badge badge-warning';
                dupBadge.style.display = 'inline-block';
            } else {
                dupBadge.style.display = 'none';
            }
        }
        return dupInfo;
    }

    _filterVisiblePrograms(bank) {
        const visiblePrograms = [];
        for (let i = 0; i < bank.programs.length; i++) {
            const p = bank.programs[i];
            const matchesCat = this.activeCategoryFilter === 'all' || p.category === parseInt(this.activeCategoryFilter, 10);
            const matchesSearch = !this.searchQuery || p.name.toLowerCase().includes(this.searchQuery);
            if (matchesCat && matchesSearch) {
                visiblePrograms.push({ program: p, originalIndex: i });
            }
        }
        return visiblePrograms;
    }

    _createLibrarianDragController(activeBank, progList) {
        const clearProgInsertMarkers = () => {
            const rows = progList.children || [];
            for (let r = 0; r < rows.length; r++) {
                if (rows[r] && rows[r].classList) {
                    rows[r].classList.remove('prog-insert-before', 'prog-insert-after', 'slot-drop-hover');
                }
                this._clearDropTip(rows[r]);
            }
        };

        const computeProgTarget = (e, fallbackIndex, allowReplace = false) => {
            const rows = progList.children ? Array.from(progList.children) : [];
            if (rows.length === 0 || typeof e.clientY !== 'number') {
                return { row: rows[fallbackIndex] || null, index: fallbackIndex, isAfter: false, mode: 'insert' };
            }
            for (let r = 0; r < rows.length; r++) {
                const rEl = rows[r];
                const rect = typeof rEl.getBoundingClientRect === 'function' ? rEl.getBoundingClientRect() : null;
                if (!rect) continue;
                const rIdx = rEl.dataset && rEl.dataset.progIndex !== undefined ? parseInt(rEl.dataset.progIndex, 10) : r;
                if (e.clientY <= rect.bottom || r === rows.length - 1) {
                    const edge = rect.height * 0.28;
                    if (allowReplace && e.clientY >= rect.top + edge && e.clientY <= rect.bottom - edge) {
                        return { row: rEl, index: rIdx, isAfter: false, mode: 'replace' };
                    }
                    const mid = rect.top + rect.height / 2;
                    return { row: rEl, index: rIdx, isAfter: e.clientY > mid, mode: 'insert' };
                }
            }
            return { row: rows[fallbackIndex] || null, index: fallbackIndex, isAfter: false, mode: 'insert' };
        };

        const resolveSingleInsertDest = (srcIdx, targetIdx, isAfter, hasClientY) => {
            let dest = targetIdx;
            if (hasClientY) {
                if (isAfter && srcIdx > targetIdx) {
                    dest = Math.min(activeBank.length - 1, targetIdx + 1);
                } else if (!isAfter && srcIdx < targetIdx) {
                    dest = Math.max(0, targetIdx - 1);
                }
            }
            return dest;
        };

        const applyProgDragOver = (e, fallbackRow, fallbackIndex, fallbackName) => {
            const activeLib = this._activeLibrarianDrag;
            if (!activeLib || activeLib.type !== 'prog-move' || activeLib.bankIndex !== this.librarian.activeBankIndex) {
                return false;
            }
            if (e.stopPropagation) e.stopPropagation();

            const count = activeLib.progIndices ? activeLib.progIndices.length : 1;
            if (count === 1 && (e.altKey || e.shiftKey) && fallbackRow) {
                if (fallbackIndex === activeLib.progIndex) {
                    clearProgInsertMarkers();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
                    return true;
                }
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                clearProgInsertMarkers();
                fallbackRow.classList.add('slot-drop-hover');
                const slotLabel = `#${(fallbackIndex + 1).toString().padStart(2, '0')}`;
                this._setDropTip(fallbackRow, `Drop to swap with ${slotLabel} "${fallbackName}"`);
                return true;
            }

            const target = computeProgTarget(e, fallbackIndex, count === 1);
            const targetRow = target.row || fallbackRow;
            const targetIdx = target.index !== undefined ? target.index : fallbackIndex;

            if (count === 1) {
                const isSameReplace = target.mode === 'replace' && targetIdx === activeLib.progIndex;
                const isSameInsert = target.mode !== 'replace' &&
                    resolveSingleInsertDest(activeLib.progIndex, targetIdx, target.isAfter, typeof e.clientY === 'number') === activeLib.progIndex;
                if (isSameReplace || isSameInsert) {
                    clearProgInsertMarkers();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
                    return true;
                }
            }

            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            const rows = progList.children || [];
            for (let r = 0; r < rows.length; r++) {
                if (rows[r] !== targetRow && rows[r].classList) {
                    rows[r].classList.remove('prog-insert-before', 'prog-insert-after', 'slot-drop-hover');
                    this._clearDropTip(rows[r]);
                }
            }
            if (targetRow && targetRow.classList) {
                const slotLabel = `#${(targetIdx + 1).toString().padStart(2, '0')}`;
                if (target.mode === 'replace') {
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                    targetRow.classList.remove('prog-insert-before', 'prog-insert-after');
                    targetRow.classList.add('slot-drop-hover');
                    const targetProg = activeBank.getProgram(targetIdx);
                    const targetName = targetProg ? targetProg.name : fallbackName;
                    this._setDropTip(targetRow, `Drop to copy patch onto ${slotLabel} "${targetName}"`);
                } else {
                    targetRow.classList.toggle('prog-insert-before', !target.isAfter);
                    targetRow.classList.toggle('prog-insert-after', target.isAfter);
                    targetRow.classList.add('slot-drop-hover');
                    this._setDropTip(targetRow, count > 1 ? `Drop to move ${count} patches to ${slotLabel}` : `Drop to move patch to ${slotLabel}`);
                }
            }
            return true;
        };

        const applyProgDrop = (e, fallbackIndex) => {
            const data = this._parseDragPayload(e, this._activeLibrarianDrag);
            if (!data || data.type !== 'prog-move') return false;

            e.preventDefault();
            if (e.stopPropagation) e.stopPropagation();
            clearProgInsertMarkers();

            const indices = Array.isArray(data.progIndices) && data.progIndices.length > 0
                ? data.progIndices
                : [data.progIndex];
            const target = computeProgTarget(e, fallbackIndex, indices.length === 1);
            const targetIndex = target.index !== undefined ? target.index : fallbackIndex;

            if (indices.length > 1) {
                this._moveBankPrograms(activeBank, indices, targetIndex, 'group');
            } else if (e.altKey || e.shiftKey) {
                this._moveBankPrograms(activeBank, indices, targetIndex, 'swap');
            } else if (target.mode === 'replace' && indices[0] !== targetIndex) {
                this._moveBankPrograms(activeBank, indices, targetIndex, 'replace');
            } else {
                const destIndex = resolveSingleInsertDest(indices[0], targetIndex, target.isAfter, typeof e.clientY === 'number');
                this._moveBankPrograms(activeBank, indices, destIndex, 'insert');
            }
            return true;
        };

        progList.ondragover = (e) => applyProgDragOver(e, null, 0, '');
        progList.ondragleave = (e) => {
            if (e.relatedTarget && typeof progList.contains === 'function' && progList.contains(e.relatedTarget)) return;
            clearProgInsertMarkers();
        };
        progList.ondrop = (e) => applyProgDrop(e, activeBank.length - 1);

        return { applyProgDragOver, applyProgDrop };
    }

    _createProgramRow(program, originalIndex, { activeBank, progList, dupInfo, visiblePrograms, dragCtx }) {
        const row = document.createElement('div');
        const isDup = dupInfo.duplicateIndices.has(originalIndex);
        const isSelected = this.selectedProgIndices && this.selectedProgIndices.has(originalIndex);
        row.className = `prog-row${isDup ? ' is-duplicate' : ''}${isSelected ? ' selected' : ''}`;
        row.setAttribute('draggable', 'true');
        if (row.dataset) row.dataset.progIndex = String(originalIndex);

        const catOptions = LOOKUPS.categories.map((cat, cIdx) =>
            `<option value="${cIdx}" ${cIdx === program.category ? 'selected' : ''}>${cat}</option>`
        ).join('');

        row.innerHTML = `
            <div class="prog-drag-handle" title="Drag to reorder, swap, or move to another bank">⋮⋮</div>
            <button type="button" class="prog-select-cb${isSelected ? ' active' : ''}" aria-pressed="${isSelected ? 'true' : 'false'}" title="Select patch for multi-drag" aria-label="Select ${escapeHtml(program.name)}">
                <svg class="prog-select-check" viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="2.2 6.2 4.8 8.8 9.8 3.2"></polyline></svg>
            </button>
            <div class="prog-slot-num">#${(originalIndex + 1).toString().padStart(2, '0')}</div>
            <div class="prog-name">${escapeHtml(program.name)}</div>
            <select class="prog-cat-badge prog-cat-select" data-prog-index="${originalIndex}" title="Edit category">
                ${catOptions}
            </select>
            ${isDup ? '<div class="prog-dup-badge" title="Identical sound parameters detected">Duplicate</div>' : ''}
            <div class="prog-actions">
                <button class="btn btn-sm btn-action" data-action="load-a" title="Load into Part A">Part A</button>
                <button class="btn btn-sm btn-action" data-action="load-b" title="Load into Part B">Part B</button>
                <button class="btn btn-sm btn-action" data-action="export" title="Export .syx">Export</button>
                <button class="btn btn-sm btn-danger" data-action="delete" title="Delete">✕</button>
            </div>
        `;

        const syncSelectionUI = () => {
            const rows = progList.children || [];
            for (let r = 0; r < rows.length; r++) {
                const rEl = rows[r];
                const rIdx = rEl.dataset && rEl.dataset.progIndex !== undefined ? parseInt(rEl.dataset.progIndex, 10) : NaN;
                if (Number.isNaN(rIdx)) continue;
                const sel = this.selectedProgIndices.has(rIdx);
                if (rEl.classList) rEl.classList.toggle('selected', sel);
                const rCb = rEl.querySelector ? rEl.querySelector('.prog-select-cb') : null;
                if (rCb) {
                    if (rCb.classList && typeof rCb.classList.toggle === 'function') {
                        rCb.classList.toggle('active', sel);
                    }
                    if (typeof rCb.setAttribute === 'function') {
                        rCb.setAttribute('aria-pressed', sel ? 'true' : 'false');
                    }
                    rCb.checked = sel;
                }
            }
        };

        const applySelection = (mode, shiftKey) => {
            if (shiftKey && this._lastSelectedProgIndex !== null) {
                const startPos = visiblePrograms.findIndex(v => v.originalIndex === this._lastSelectedProgIndex);
                const endPos = visiblePrograms.findIndex(v => v.originalIndex === originalIndex);
                if (startPos !== -1 && endPos !== -1) {
                    const lo = Math.min(startPos, endPos);
                    const hi = Math.max(startPos, endPos);
                    if (mode === 'single') this.selectedProgIndices.clear();
                    for (let p = lo; p <= hi; p++) {
                        this.selectedProgIndices.add(visiblePrograms[p].originalIndex);
                    }
                }
            } else if (mode === 'toggle') {
                if (this.selectedProgIndices.has(originalIndex)) {
                    this.selectedProgIndices.delete(originalIndex);
                } else {
                    this.selectedProgIndices.add(originalIndex);
                }
            } else {
                const wasOnly = this.selectedProgIndices.size === 1 && this.selectedProgIndices.has(originalIndex);
                this.selectedProgIndices.clear();
                if (!wasOnly) this.selectedProgIndices.add(originalIndex);
            }
            this._lastSelectedProgIndex = originalIndex;
            syncSelectionUI();
        };

        const selectCb = row.querySelector('.prog-select-cb');
        if (selectCb) {
            selectCb.onclick = (e) => {
                if (e && e.stopPropagation) e.stopPropagation();
                applySelection('toggle', !!(e && e.shiftKey));
            };
            selectCb.onmousedown = (e) => {
                if (e && e.stopPropagation) e.stopPropagation();
            };
        }

        row.onclick = (e) => {
            if (e && e.target && typeof e.target.closest === 'function' && e.target.closest('button, select, input, .prog-drag-handle')) {
                return;
            }
            if (e && (e.metaKey || e.ctrlKey)) {
                applySelection('toggle', false);
            } else {
                applySelection('single', !!(e && e.shiftKey));
            }
        };

        const catSelect = row.querySelector('.prog-cat-select');
        if (catSelect) {
            catSelect.onclick = (e) => e.stopPropagation();
            catSelect.onmousedown = (e) => e.stopPropagation();
            catSelect.onchange = (e) => {
                e.stopPropagation();
                const newCat = parseInt(e.target.value, 10);
                program.category = newCat;
                this.librarian.saveAllBanks();

                [0, 1].forEach((slot) => {
                    const timbre = this.getTimbre(slot);
                    if (timbre && (timbre.name === program.name || timbre.computeSoundFingerprint() === program.computeSoundFingerprint())) {
                        timbre.category = newCat;
                        if (this.activeSlot === slot) {
                            const edCat = document.getElementById('prog-category-select');
                            if (edCat) edCat.value = newCat;
                        }
                    }
                });

                const catLabel = LOOKUPS.categories[newCat] || 'Misc';
                this.showNotification(`Updated category for "${program.name}" to ${catLabel}`, 'success');
            };
        }

        const loadIntoPart = (slot) => {
            const partLabel = slot === 1 ? 'B' : 'A';
            this.replacePartWithRawData(slot, program.rawData, `Load "${program.name}" into Part ${partLabel}`, {
                sendToHardware: false,
                syncStatus: null,
                source: 'librarian',
                clearUndo: true,
                setOriginalSnapshot: true
            });
            this.selectPart(slot);
            this.switchView('editor');
            this.showNotification(`Loaded "${program.name}" into Part ${partLabel}!`, 'info');
        };
        row.querySelector('[data-action="load-a"]').onclick = () => loadIntoPart(0);
        row.querySelector('[data-action="load-b"]').onclick = () => loadIntoPart(1);

        row.querySelector('[data-action="export"]').onclick = () => {
            const fwVer = this.midi ? this.midi.effectiveFirmwareVersion : 3;
            const fwId = this.midi && this.midi.detectedFwId !== null ? this.midi.detectedFwId : SYSEX_V2_FW_ID;
            this.librarian.exportProgramFile(program, null, fwVer, fwId);
        };

        row.querySelector('[data-action="delete"]').onclick = async () => {
            const confirmed = await this._confirmDialog({
                title: 'Delete Patch?',
                description: `Delete patch "${program.name}" from ${activeBank.name}?`,
                confirmLabel: 'Delete',
                confirmClass: 'btn-danger'
            });
            if (confirmed) {
                activeBank.removeProgram(originalIndex);
                this.librarian.saveAllBanks();
                this.renderLibrarianBank();
            }
        };

        row.ondragstart = (e) => {
            const useGroup = this.selectedProgIndices && this.selectedProgIndices.has(originalIndex) && this.selectedProgIndices.size > 0;
            const dragIndices = useGroup
                ? Array.from(this.selectedProgIndices).filter(i => i >= 0 && i < activeBank.length).sort((a, b) => a - b)
                : [originalIndex];
            const payload = {
                type: 'prog-move',
                bankIndex: this.librarian.activeBankIndex,
                progIndex: originalIndex,
                progIndices: dragIndices
            };
            this._activeLibrarianDrag = payload;
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'copyMove';
                e.dataTransfer.setData('text/plain', JSON.stringify(payload));
            }
            row.classList.add('dragging');
        };
        row.ondragend = () => {
            this._activeLibrarianDrag = null;
            row.classList.remove('dragging');
            this._clearMemoryDragHover();
        };
        row.ondragover = (e) => {
            const active = this._activeMemoryDrag;
            if (active && active.kind === 'memory' && this.memories[active.index]) {
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                const appMain = document.querySelector('.app-main');
                if (appMain) {
                    appMain.classList.remove('slot-drop-hover');
                    this._clearDropTip(appMain);
                }
                row.classList.add('slot-drop-hover');
                const slotLabel = `#${(originalIndex + 1).toString().padStart(2, '0')}`;
                this._setDropTip(row, `Drop to replace ${slotLabel} "${program.name}" with Memory M${active.index + 1}`);
                return;
            }
            if (dragCtx.applyProgDragOver(e, row, originalIndex, program.name)) {
                return;
            }
            e.preventDefault();
        };
        row.ondragleave = (e) => {
            if (e.relatedTarget && typeof row.contains === 'function' && row.contains(e.relatedTarget)) return;
            if (!this._activeLibrarianDrag || this._activeLibrarianDrag.type !== 'prog-move') {
                row.classList.remove('slot-drop-hover', 'prog-insert-before', 'prog-insert-after');
                this._clearDropTip(row);
            }
        };
        row.ondrop = async (e) => {
            row.classList.remove('slot-drop-hover', 'prog-insert-before', 'prog-insert-after');
            this._clearDropTip(row);
            const memData = this._parseDragPayload(e);
            if (memData && memData.kind === 'memory' && this.memories[memData.index]) {
                e.preventDefault();
                e.stopPropagation();
                this._activeMemoryDrag = null;
                this._clearMemoryDragHover();
                const mem = this.memories[memData.index];
                const slotLabel = `#${(originalIndex + 1).toString().padStart(2, '0')}`;
                const confirmed = await this._confirmDialog({
                    title: 'Replace Bank Patch?',
                    description: `Replace ${slotLabel} "${program.name}" in "${activeBank.name}" with Memory M${memData.index + 1} ("${mem.name}")?`,
                    confirmLabel: 'Replace',
                    confirmClass: 'btn-warning'
                });
                if (confirmed) {
                    activeBank.setProgram(originalIndex, new MM2Program(new Uint8Array(mem.rawData)));
                    await this.librarian.saveAllBanks();
                    this.renderLibrarianBank();
                    this.showNotification(`Replaced ${slotLabel} ("${program.name}") with Memory M${memData.index + 1} ("${mem.name}")`, 'success');
                }
                return;
            }
            dragCtx.applyProgDrop(e, originalIndex);
        };

        return row;
    }

    showDuplicateModal() {
        if (typeof document === 'undefined') return;
        const activeBank = this.librarian.activeBank;
        const dupInfo = activeBank.detectDuplicates(true);

        const modal = document.getElementById('duplicate-modal');
        const body = document.getElementById('duplicate-modal-body');
        if (!modal || !body) return;

        body.innerHTML = '';

        if (dupInfo.duplicatesFound === 0) {
            body.innerHTML = `
                <div class="empty-state">
                    <p class="text-success">✓ Clean bank! No duplicate patches detected in "${escapeHtml(activeBank.name)}".</p>
                </div>
            `;
        } else {
            const summary = document.createElement('div');
            summary.className = 'dup-summary-box';
            summary.innerHTML = `
                <strong>${dupInfo.duplicatesFound} duplicate patch(es) found</strong> across ${dupInfo.groups.length} matching signature group(s).
                <div class="dup-modal-actions">
                    <button class="btn btn-warning" id="btn-modal-remove-dups">Remove All Redundant Copies</button>
                    <button class="btn btn-primary" id="btn-modal-condense-bank">Remove & Condense Bank</button>
                </div>
            `;
            body.appendChild(summary);

            dupInfo.groups.forEach((group, gIdx) => {
                const groupCard = document.createElement('div');
                groupCard.className = 'dup-group-card';
                groupCard.innerHTML = `<div class="dup-group-title">Duplicate Group ${gIdx + 1} (${group.entries.length} copies)</div>`;

                const list = document.createElement('div');
                list.className = 'dup-group-list';
                group.entries.forEach(({ index, program }, idx) => {
                    const item = document.createElement('div');
                    item.className = 'dup-group-item';
                    item.innerHTML = `
                        <span>Slot #${(index + 1).toString().padStart(2, '0')}: <strong>${escapeHtml(program.name)}</strong> (${escapeHtml(LOOKUPS.categories[program.category])})</span>
                        <span class="badge ${idx === 0 ? 'badge-info' : 'badge-warning'}">${idx === 0 ? 'Original' : 'Duplicate'}</span>
                    `;
                    list.appendChild(item);
                });
                groupCard.appendChild(list);
                body.appendChild(groupCard);
            });

            // Action listeners
            body.querySelector('#btn-modal-remove-dups').onclick = () => {
                const removed = activeBank.removeDuplicates(true);
                this.librarian.saveAllBanks();
                this.renderLibrarianBank();
                modal.classList.remove('open');
                this.showNotification(`Removed ${removed} duplicate patches!`, 'success');
            };

            body.querySelector('#btn-modal-condense-bank').onclick = () => {
                const res = activeBank.condenseBank({ removeDuplicates: true, removeInits: false });
                this.librarian.saveAllBanks();
                this.renderLibrarianBank();
                modal.classList.remove('open');
                this.showNotification(`Condensed bank! Removed ${res.removedDuplicates} duplicates. ${res.finalCount} patches remain.`, 'success');
            };
        }

        modal.classList.add('open');
    }

    _handlePortSelection(type, portId) {
        const isInput = type === 'Input';
        const prevPort = isInput ? this.midi.inPort : this.midi.outPort;
        const prevPortId = prevPort ? prevPort.id : '';

        if (isInput) {
            this.midi.setInputPort(portId);
        } else {
            this.midi.setOutputPort(portId);
        }

        const nextPort = isInput ? this.midi.inPort : this.midi.outPort;
        const otherPort = isInput ? this.midi.outPort : this.midi.inPort;
        if (nextPort && nextPort.id !== prevPortId && otherPort) {
            this._pendingPortTest = { type, name: nextPort.name };
            this.midi.probeHardware(2500);
        }
    }

    _bindSettingsToggle(id, initial, onToggle, msgOn, msgOff) {
        const chk = document.getElementById(id);
        if (!chk) return;
        chk.checked = !!initial;
        chk.onchange = () => {
            onToggle(chk.checked);
            this.showNotification(chk.checked ? msgOn : msgOff, 'info');
        };
    }

    buildSettingsUI() {
        if (typeof document === 'undefined') return;
        const selIn = document.getElementById('settings-midi-in');
        const selOut = document.getElementById('settings-midi-out');
        const selChan = document.getElementById('settings-base-channel');
        const btnReconnect = document.getElementById('btn-reconnect-midi');
        const btnProbe = document.getElementById('btn-probe-hardware');

        this.updateSettingsPortLists();
        this.updateMidiPermissionUI();

        if (btnProbe) {
            btnProbe.onclick = () => {
                if (!this.midi.inPort || !this.midi.outPort) {
                    this.showNotification('Please select both MIDI Input and Output ports first.', 'warning');
                    return;
                }
                this.showNotification(`Testing MM2 connection on ${this.midi.outPort.name}...`, 'info');
                this.midi.probeHardware(2500);
            };
        }

        if (btnReconnect) {
            btnReconnect.onclick = async () => {
                this.showNotification('Scanning for Web MIDI devices...', 'info');
                const ok = await this.midi.reconnect();
                this.updateConnectionStatus();
                this.updateSettingsPortLists();
                this.updateMidiPermissionUI();
                if (ok) {
                    this._probeIfNeeded();
                    this.showNotification('Web MIDI reconnected successfully!', 'success');
                } else {
                    this.showNotification('Web MIDI connection failed. Check browser permissions.', 'error');
                }
            };
        }

        if (selIn) {
            selIn.onchange = () => this._handlePortSelection('Input', selIn.value);
        }
        if (selOut) {
            selOut.onchange = () => this._handlePortSelection('Output', selOut.value);
        }
        if (selChan) {
            selChan.value = this.midi.baseChannel;
            selChan.onchange = () => {
                this.midi.baseChannel = parseInt(selChan.value, 10);
                this.midi.saveSettings();
            };
        }

        const undoInput = document.getElementById('settings-undo-levels');
        if (undoInput) {
            undoInput.value = this.maxHistory;
            undoInput.onchange = () => this.setUndoLevels(undoInput.value);
            undoInput.oninput = () => {
                const val = parseInt(undoInput.value, 10);
                if (!isNaN(val) && val >= 1 && val <= 100) {
                    this.setUndoLevels(val);
                }
            };
        }

        this._bindSettingsToggle(
            'settings-periodic-check',
            this.midi.periodicCheck,
            (checked) => this.midi.setPeriodicCheck(checked),
            'Periodic connection checks enabled.',
            'Periodic connection checks disabled.'
        );

        if (this.tabSync) {
            this._bindSettingsToggle(
                'settings-tab-sync',
                this.tabSync.enabled,
                (checked) => this.tabSync.setEnabled(checked),
                'Cross-tab synchronization enabled.',
                'Cross-tab synchronization disabled.'
            );
        }

        const settingsVer = document.getElementById('settings-app-version');
        if (settingsVer) {
            settingsVer.textContent = `v${App.VERSION}`;
        }

        const headerVer = document.getElementById('app-version-badge');
        if (headerVer) {
            headerVer.textContent = `v${App.VERSION}`;
        }
    }

    _applyIncomingParamToUI(paramKey, value, slot = 0, { autoSwitchTab = false, updateSync = false } = {}) {
        const targetTimbre = this.getTimbre(slot);
        targetTimbre.setValue(paramKey, value);

        if (slot !== this.activeSlot) return;

        if (paramKey === 'ARP_OFF_ON' && value) {
            this.resetAuditionLatch(slot);
        }

        const oscMatch = paramKey.match(/^OSC(\d)_/);
        const envMatch = paramKey.match(/^ENV(\d)_/);
        const envNum = envMatch ? parseInt(envMatch[1], 10) : 0;

        if (autoSwitchTab) {
            this._autoSwitchTabFor(paramKey);
        }

        if (typeof document !== 'undefined') {
            if (oscMatch) {
                const oscCard = document.querySelector('.osc-unified-card');
                if (oscCard && oscCard.refresh) oscCard.refresh();
            }
            if (envNum) {
                const envCard = document.querySelector('.env-unified-card');
                if (envCard && envCard.refresh) envCard.refresh();
            }
            if (paramKey === 'KBD_CHORD_EXPAND') {
                const chordCard = document.querySelector('.chord-scaler-card');
                if (chordCard && chordCard.refresh) chordCard.refresh();
            }

            const el = (this._paramControlMap && this._paramControlMap.get(paramKey)) ||
                document.querySelector(`.editor-grid [data-param="${paramKey}"], #prog-tempo-container [data-param="${paramKey}"]`);
            if (el && el.refresh) {
                el.refresh();
            }
        }

        this.refreshVisualizerFor(paramKey);
        if (updateSync && typeof document !== 'undefined') {
            this.updateSyncStatus(this.isConnectionGood ? 'synced' : 'offline');
        }
    }

    applyRemoteParamChange(key, val, slot = 0) {
        this._applyIncomingParamToUI(key, val, slot, {
            autoSwitchTab: false,
            updateSync: false
        });
    }

    applyRemoteMetaChange(slot, name, category) {
        const targetTimbre = this.getTimbre(slot);
        if (name !== undefined) targetTimbre.name = name;
        if (category !== undefined) targetTimbre.category = category;

        if (slot === this.activeSlot && typeof document !== 'undefined') {
            const nameInput = document.getElementById('prog-name-input');
            if (nameInput && name !== undefined) nameInput.value = name;
            const catSelect = document.getElementById('prog-category-select');
            if (catSelect && category !== undefined) catSelect.value = category;
        }
    }

    applyRemotePatchLoaded(slot, rawData, source) {
        const targetTimbre = this.getTimbre(slot);
        const bytes = (rawData instanceof Uint8Array) ? rawData : new Uint8Array(rawData);
        targetTimbre.rawData = bytes;
        this._setOriginalSnapshot(slot, targetTimbre);

        if (slot === this.activeSlot) {
            this.undoStack = [];
            this.redoStack = [];
            this.updateUndoRedoUI();
            this.updateSyncStatus(this.isConnectionGood ? 'synced' : 'offline');
            this.refreshEditorControls();
        }
    }

    async applyRemoteLibrarianChange() {
        await this.librarian.loadAllBanks();
        if (typeof document !== 'undefined') {
            this.renderLibrarianBank();
        }
    }

    applyRemoteTimbralMode(mode) {
        const validModes = ['monotimbral', 'bitimbral', 'combi'];
        if (!validModes.includes(mode)) return;
        this.synthTimbralMode = mode;
        if (mode === 'monotimbral' && this.activeSlot !== 0) {
            this.selectPart(0);
        }
        this.updateTimbralModeUI();
    }

    applyRemoteHardwareStatus(responsive) {
        if (this.midi) {
            this.midi.applyRemoteHardwareStatus(responsive);
            this.updateConnectionStatus();
        }
    }

    _setLiveSyncState(enabled, { broadcast = true } = {}) {
        const isEnabled = !!enabled;
        if (this.midi) {
            this.midi.liveSync = isEnabled;
            this.midi.saveSettings();
        }
        this.updateLiveSyncUI();
        if (broadcast && this.tabSync) {
            this.tabSync.broadcast('LIVE_SYNC_CHANGED', { liveSync: isEnabled });
        }
    }

    _refreshSyncStatusAfterLiveSyncDisable() {
        const nextStatus = (this.syncStatus === 'synced' || this.syncStatus === 'streaming')
            ? 'synced'
            : this.syncStatus;
        this.updateSyncStatus(nextStatus);
    }

    applyRemoteLiveSync(enabled) {
        this._setLiveSyncState(enabled, { broadcast: false });
        if (enabled) {
            this.updateSyncStatus(this.isConnectionGood ? 'synced' : 'offline');
        } else {
            this._refreshSyncStatusAfterLiveSyncDisable();
        }
    }

    applyLeaderState(state) {
        if (!state) return;
        if (state.mode) {
            this.synthTimbralMode = state.mode;
            this.updateTimbralModeUI();
        }
        if (state.timbreA) {
            const bytesA = (state.timbreA instanceof Uint8Array) ? state.timbreA : new Uint8Array(state.timbreA);
            this.timbreA.rawData = bytesA;
            this.originalSnapshotA = this.timbreA.clone();
        }
        if (state.timbreB) {
            const bytesB = (state.timbreB instanceof Uint8Array) ? state.timbreB : new Uint8Array(state.timbreB);
            this.timbreB.rawData = bytesB;
            this.originalSnapshotB = this.timbreB.clone();
        }
        if (state.hardwareResponsive !== undefined && state.hardwareResponsive !== null && this.midi) {
            this.midi.applyRemoteHardwareStatus(state.hardwareResponsive);
        }
        if (state.liveSync !== undefined && this.midi) {
            this.midi.liveSync = !!state.liveSync;
            this.midi.saveSettings();
        }
        this._hasDetectedMM2Once = true;
        this.undoStack = [];
        this.redoStack = [];
        this.updateUndoRedoUI();
        this.updateSyncStatus(this.isConnectionGood ? 'synced' : 'offline');
        this.refreshEditorControls();
        this.updateConnectionStatus();
        this.showNotification('Synchronized settings from leader window', 'info');
    }

    updateSettingsPortLists() {
        if (typeof document === 'undefined') return;
        const selIn = document.getElementById('settings-midi-in');
        const selOut = document.getElementById('settings-midi-out');
        if (!selIn || !selOut) return;

        selIn.innerHTML = '<option value="">(None / Disconnected)</option>';
        selOut.innerHTML = '<option value="">(None / Disconnected)</option>';

        this.midi.getInputs().forEach(port => {
            const opt = document.createElement('option');
            opt.value = port.id;
            opt.textContent = port.name;
            if (this.midi.inPort && this.midi.inPort.id === port.id) opt.selected = true;
            selIn.appendChild(opt);
        });

        this.midi.getOutputs().forEach(port => {
            const opt = document.createElement('option');
            opt.value = port.id;
            opt.textContent = port.name;
            if (this.midi.outPort && this.midi.outPort.id === port.id) opt.selected = true;
            selOut.appendChild(opt);
        });
    }

    resetAuditionLatch(slot = null) {
        if (!this.auditionKeyboard) return;
        if ((slot === 0 || slot === 1) && typeof this.auditionKeyboard.resetLatchAndNotes === 'function') {
            this.auditionKeyboard.resetLatchAndNotes(slot);
        } else if (typeof this.auditionKeyboard.resetAllLatchAndNotes === 'function') {
            this.auditionKeyboard.resetAllLatchAndNotes();
        } else if (typeof this.auditionKeyboard.resetLatchAndNotes === 'function') {
            this.auditionKeyboard.resetLatchAndNotes();
        }
    }

    buildAuditionUI() {
        if (typeof document === 'undefined') return;
        const container = document.getElementById('audition-toolbar-container');
        if (!container) return;
        container.innerHTML = '';
        this.auditionKeyboard = createKeyboard(
            this.midi,
            () => this.activeTimbre,
            () => (this.synthTimbralMode === 'monotimbral' ? 12 : 6)
        );
        if (typeof this.auditionKeyboard.setActivePart === 'function') {
            this.auditionKeyboard.setActivePart(this.activeSlot);
        }
        container.appendChild(this.auditionKeyboard);
    }

    showNotification(msg, type = 'info') {
        if (typeof document === 'undefined') return;
        const toast = document.getElementById('toast-notification');
        if (!toast) return;
        toast.textContent = msg;
        toast.className = `toast toast-${type} show`;
        clearTimeout(this._toastTimeout);
        this._toastTimeout = setTimeout(() => {
            toast.classList.remove('show');
        }, 4000);
    }
}

// Global App Instance (Browser only)
if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
        window.app = new App();
        window.app.init().catch(err => console.error('App init failed:', err));
    });
}
