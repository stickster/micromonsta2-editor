/**
 * Main Application Controller for MicroMonsta 2 HTML Editor and Patch Librarian
 */

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
        this.synthTimbralMode = 'monotimbral';
        if (typeof window !== 'undefined') {
            try {
                this.synthTimbralMode = window.localStorage.getItem('mm2_timbral_mode') || 'monotimbral';
            } catch (e) { }
        }

        // Live Editing, History & Compare State
        this.undoStack = [];
        this.redoStack = [];
        let savedUndoLevels = 20;
        if (typeof window !== 'undefined' && window.localStorage) {
            try {
                const stored = window.localStorage.getItem('mm2_undo_levels');
                if (stored !== null) {
                    const parsed = parseInt(stored, 10);
                    if (!isNaN(parsed) && parsed >= 1 && parsed <= 100) {
                        savedUndoLevels = parsed;
                    }
                }
            } catch (e) { }
        }
        this.maxHistory = savedUndoLevels;
        this._activeUndoGroup = null;
        this.originalSnapshotA = this.timbreA.clone();
        this.originalSnapshotB = this.timbreB.clone();
        this.isComparing = false;
        this.compareSavedProgram = null;

        this.memories = [null, null, null, null];
        this._activeMemoryDrag = null;
        this.loadMemories();

        // Sound Design Solo & Mute States & Active Tabs
        this.selectedOsc = 1; // Active oscillator tab (1, 2, or 3)
        this.selectedEnv = 1; // Active envelope tab (1, 2, or 3)
        this._activeDragSection = null;
        this.soloState = { osc1: false, osc2: false, osc3: false, noise: false };
        this.muteState = { osc1: false, osc2: false, osc3: false, noise: false };
        this.savedMixerLevels = null;
        this.syncStatus = 'synced'; // 'synced' | 'modified' | 'streaming' | 'fetching'
        this.modeProbeTimeoutMs = 1500; // How long to wait for a Part B reply before assuming monotimbral
        this._modeProbe = null;
        this._pendingProbe = null;
        this._hasDetectedMM2Once = false;
        this._hadBothPortsConnected = false;
        this._isPromptingSync = false;
        this._enableLiveSyncOnFetch = false;
        this._paramControlMap = new Map();

        this.bindEvents();
    }

    get activeTimbre() {
        return this.activeSlot === 0 ? this.timbreA : this.timbreB;
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
        this.updateActivePartIndicator();
        this.updateSyncStatus('synced');
        this.updateUndoRedoUI();
        this.updateLiveSyncUI();
        this.updateFirmwareUI();
        this.setupKeyboardShortcuts();

        // On load, always start in Editor mode
        this.switchView('editor');
    }

    async handleMidiStatusClick() {
        if (!this.midi.midiAccess) {
            await this.midi.reconnect();
            this.updateConnectionStatus();
            this.updateSettingsPortLists();
            this.updateMidiPermissionUI();
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

    bindEvents() {
        // MM2 Detection Listener
        this.midi.on('mm2-detected', ({ inPort }) => {
            // When an additional window opens, it acts as a follower.
            // Do not run a hardware fetch; sync from leader window instead.
            if (this.tabSync && (this.tabSync.isLeader === false || this.tabSync.isFollower)) {
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
        this.midi.on('firmware-detected', ({ version, detectedVersion }) => {
            this.updateFirmwareUI();
            if (detectedVersion === 2) {
                this.showNotification('Firmware v2.x detected: adapted UI, SysEx (176-byte), and v2 NRPNs.', 'info');
            } else if (detectedVersion === 3 && version === 3) {
                this.updateFirmwareUI();
            }
        });

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
            const isFollowerTab = this.tabSync && (this.tabSync.isLeader === false || this.tabSync.isFollower);
            if (isFollowerTab && this.syncStatus !== 'fetching' && !this._modeProbe) {
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
            if (slot === 1) {
                this.timbreB.rawData = program.rawData;
                this.originalSnapshotB = this.timbreB.clone();
            } else {
                this.timbreA.rawData = program.rawData;
                this.originalSnapshotA = this.timbreA.clone();
            }
            this.undoStack = [];
            this.redoStack = [];
            this.updateUndoRedoUI();
            // When loading Editor or working in Editor, do not add patch to Librarian!
            // Only capture while the Librarian view is open; dumps go to the currently selected bank
            if (this.currentView === 'librarian') {
                this.librarian.handleIncomingProgram(program);
            }
            if (this.tabSync) {
                this.tabSync.broadcast('PATCH_LOADED', {
                    slot,
                    rawData: Array.from(program.rawData),
                    source: 'hardware'
                });
            }
            this.refreshEditorControls();
            this.updateActivePartIndicator();
            this.updateSyncStatus('synced');
            this.showNotification(`Loaded MM2 hardware Patch ${slot === 1 ? 'B' : 'A'} ("${program.name}")`, 'success');
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

        this.midi.on('port-change', () => {
            this.updateConnectionStatus();
            this.updateSettingsPortLists();
            this.updateMidiPermissionUI();

            const hasBothPorts = !!(this.midi.inPort && this.midi.outPort);
            const isFollowerTab = this.tabSync && (this.tabSync.isLeader === false || this.tabSync.isFollower);
            if (hasBothPorts && !this._hadBothPortsConnected) {
                this._hadBothPortsConnected = true;
                const isMM2Pair = this.midi.isMM2Port(this.midi.inPort) && this.midi.isMM2Port(this.midi.outPort);
                if (!isMM2Pair && !isFollowerTab) {
                    const isReconnect = this._hasDetectedMM2Once;
                    this._hasDetectedMM2Once = true;
                    this.promptReconnectSync({
                        isReconnect,
                        portName: this.midi.outPort.name || this.midi.inPort.name
                    });
                }
            } else if (!hasBothPorts) {
                this._hadBothPortsConnected = false;
            }
        });

        this.midi.on('hardware-responsiveness-changed', ({ responsive, previous, isRemote }) => {
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

        // Real-Time Hardware Parameter Tweak Listener (from physical MM2 knobs via CC or NRPN)
        this.midi.on('parameter-received', ({ paramKey, value, slot }) => {
            const targetTimbre = slot === 1 ? this.timbreB : this.timbreA;
            targetTimbre.setValue(paramKey, value);

            if (slot === this.activeSlot) {
                // If it's an oscillator parameter, switch active oscillator tab if needed
                const oscMatch = paramKey.match(/^OSC(\d)_/);
                if (oscMatch) {
                    const oscNum = parseInt(oscMatch[1], 10);
                    if (this.selectedOsc !== oscNum) {
                        this.selectedOsc = oscNum;
                    }
                }

                // If it's an envelope parameter, switch active envelope tab if needed
                const envMatch = paramKey.match(/^ENV(\d)_/);
                let envNum = envMatch ? parseInt(envMatch[1], 10) : 0;
                if (!envNum && (paramKey === 'ENV1_VCA_VEL_SENS' || paramKey === 'ENV1_RESET')) envNum = 1;
                if (!envNum && (paramKey === 'ENV2_FLT_VEL_SENS' || paramKey === 'ENV2_RESET')) envNum = 2;
                if (!envNum && paramKey === 'ENV3_RESET') envNum = 3;
                if (envNum && this.selectedEnv !== envNum) {
                    this.selectedEnv = envNum;
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

                    // Refresh the specific control in the UI via O(1) cache (with DOM fallback)
                    const el = (this._paramControlMap && this._paramControlMap.get(paramKey)) ||
                        document.querySelector(`.editor-grid [data-param="${paramKey}"], #prog-tempo-container [data-param="${paramKey}"]`);
                    if (el && el.refresh) {
                        el.refresh();
                    }

                    this.refreshVisualizerFor(paramKey);
                    this.updateSyncStatus('synced');
                }
            }
        });

        this.midi.on('connection-lost', ({ port, type }) => {
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
            if (this.syncStatus === 'fetching') {
                this.updateSyncStatus(this.midi.liveSync ? 'synced' : 'modified');
            } else if (this.syncStatus === 'synced' || this.syncStatus === 'streaming') {
                this.updateSyncStatus('failed');
            }

            this.showNotification(`⚠️ MIDI Connection Lost: ${name} (${type}) disconnected. Reconnecting automatically when plugged back in...`, 'warning');
            this.updateConnectionStatus();
            this.updateSettingsPortLists();
        });

        this.midi.on('connection-restored', ({ port, type }) => {
            const name = (port && port.name) ? port.name : 'MicroMonsta 2';
            this.showNotification(`✓ MIDI Connection Restored: ${name} (${type})`, 'success');
            if (this.syncStatus === 'failed' && this.midi.inPort && this.midi.outPort) {
                this.updateSyncStatus(this.midi.liveSync ? 'synced' : 'modified');
            }
            this.updateConnectionStatus();
            this.updateSettingsPortLists();
        });

        this.midi.on('error', (err) => {
            this.showNotification(err, 'error');
            this.updateMidiPermissionUI();
        });

        // Librarian Listeners
        this.librarian.on('update', (data) => {
            this.renderLibrarianBank();
            if (data && data.type === 'save' && this.tabSync) {
                this.tabSync.broadcast('LIBRARIAN_CHANGED');
            }
        });
    }

    updateConnectionStatus() {
        this.updateLiveSyncUI();

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
        if (typeof window !== 'undefined') {
            try {
                window.localStorage.setItem('mm2_timbral_mode', mode);
            } catch (e) { }
        }
        if (mode === 'monotimbral' && this.activeSlot !== 0) {
            this.selectPart(0);
        }
        this.updateTimbralModeUI();
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

    updateActivePartIndicator() {
        if (typeof document === 'undefined') return;
        const badge = document.getElementById('active-part-indicator');
        const isMono = this.synthTimbralMode === 'monotimbral';
        const isPartA = this.activeSlot === 0;

        if (badge) {
            badge.className = `active-part-badge ${isPartA ? 'part-a' : 'part-b'}`;
            if (isMono) {
                badge.textContent = 'PART A [MONO 12V]';
                badge.title = 'Monotimbral Mode: 12-voice polyphony active on Part A';
            } else {
                badge.textContent = isPartA ? 'PART A [6V]' : 'PART B [6V]';
                badge.title = `Currently editing Part ${isPartA ? 'A' : 'B'} (${this.synthTimbralMode.toUpperCase()})`;
            }
        }
    }

    selectPart(slot) {
        if (this.synthTimbralMode === 'monotimbral' && slot !== 0) {
            this.showNotification('MM2 is in Monotimbral Mode. Switch to Bitimbral or Combi mode on MM2 hardware to edit Part B.', 'info');
            return;
        }
        this.activeSlot = slot;
        this.midi.activeSlot = slot;
        if (typeof document !== 'undefined') {
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
        if (typeof window !== 'undefined' && window.localStorage) {
            try {
                window.localStorage.setItem('mm2_undo_levels', this.maxHistory.toString());
            } catch (e) { }
        }
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
                this.updateSyncStatus('synced');
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
        if (this.undoStack.length === 0) return;
        const action = this.undoStack.pop();
        this.redoStack.push(action);

        if (action.slot !== undefined && this.activeSlot !== action.slot) {
            this.selectPart(action.slot);
        }

        if (action.type === 'part-snapshot') {
            this._applyPartSnapshot(action.slot, action.prevRawData, 'undo', `Undo: ${action.label || 'Part Change'}`);
            return;
        }

        if (action.changes && Array.isArray(action.changes)) {
            for (const ch of action.changes) {
                this.activeTimbre.setValue(ch.key, ch.prevVal);
                if (this.midi.liveSync) {
                    this.midi.sendParameter(ch.key, ch.prevVal);
                }
                this.refreshVisualizerFor(ch.key);
            }
            if (action.changes.length > 0) {
                this._autoSwitchTabFor(action.changes[0].key);
            }
        } else {
            this.activeTimbre.setValue(action.key, action.prevVal);
            if (this.midi.liveSync) {
                this.midi.sendParameter(action.key, action.prevVal);
            }
            this.refreshVisualizerFor(action.key);
            this._autoSwitchTabFor(action.key);
        }

        this.refreshEditorControls();
        this.updateUndoRedoUI();
        const label = action.label || (typeof PARAM_MAP !== 'undefined' && PARAM_MAP.get(action.key)?.label) || action.key;
        this.showNotification(`Undo: ${label}`, 'info');
    }

    redo() {
        if (this.redoStack.length === 0) return;
        const action = this.redoStack.pop();
        this.undoStack.push(action);

        if (action.slot !== undefined && this.activeSlot !== action.slot) {
            this.selectPart(action.slot);
        }

        if (action.type === 'part-snapshot') {
            this._applyPartSnapshot(action.slot, action.newRawData, 'redo', `Redo: ${action.label || 'Part Change'}`);
            return;
        }

        if (action.changes && Array.isArray(action.changes)) {
            for (const ch of action.changes) {
                this.activeTimbre.setValue(ch.key, ch.newVal);
                if (this.midi.liveSync) {
                    this.midi.sendParameter(ch.key, ch.newVal);
                }
                this.refreshVisualizerFor(ch.key);
            }
            if (action.changes.length > 0) {
                this._autoSwitchTabFor(action.changes[0].key);
            }
        } else {
            this.activeTimbre.setValue(action.key, action.newVal);
            if (this.midi.liveSync) {
                this.midi.sendParameter(action.key, action.newVal);
            }
            this.refreshVisualizerFor(action.key);
            this._autoSwitchTabFor(action.key);
        }

        this.refreshEditorControls();
        this.updateUndoRedoUI();
        const label = action.label || (typeof PARAM_MAP !== 'undefined' && PARAM_MAP.get(action.key)?.label) || action.key;
        this.showNotification(`Redo: ${label}`, 'info');
    }

    updateUndoRedoUI() {
        if (typeof document === 'undefined') return;
        const btnUndo = document.getElementById('btn-prog-undo');
        const btnRedo = document.getElementById('btn-prog-redo');
        if (btnUndo) btnUndo.disabled = this.undoStack.length === 0;
        if (btnRedo) btnRedo.disabled = this.redoStack.length === 0;
    }

    /**
     * Restores a 216-byte part snapshot for undo/redo and refreshes UI/sync state.
     */
    _applyPartSnapshot(slot, rawData, source, notificationText) {
        const targetTimbre = slot === 1 ? this.timbreB : this.timbreA;
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
    replacePartWithRawData(targetSlot, rawData, label = 'Replace Part') {
        if (this.isComparing) {
            this.toggleCompare(false);
        }
        const targetTimbre = targetSlot === 1 ? this.timbreB : this.timbreA;
        const prevRawData = new Uint8Array(targetTimbre.rawData);
        const nextRawData = new Uint8Array(rawData);

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

        targetTimbre.rawData = nextRawData;
        if (this.midi && this.midi.liveSync && this.midi.outPort) {
            this.midi.sendProgram(targetTimbre, targetSlot);
        }
        this.refreshEditorControls();
        this.updateUndoRedoUI();
        this.updateSyncStatus('modified');
        if (this.tabSync) {
            this.tabSync.broadcast('PATCH_LOADED', {
                slot: targetSlot,
                rawData: Array.from(targetTimbre.rawData),
                source: 'memory'
            });
        }
    }

    loadMemories() {
        if (typeof window === 'undefined' || !window.localStorage) return;
        try {
            const raw = window.localStorage.getItem('mm2_memories');
            if (!raw) return;
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
        if (typeof window === 'undefined' || !window.localStorage) return;
        try {
            const payload = this.memories.map(m => (m ? Array.from(m.rawData) : null));
            window.localStorage.setItem('mm2_memories', JSON.stringify(payload));
        } catch (e) { }
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

    _clearMemoryDragHover() {
        if (typeof document === 'undefined' || !document.querySelectorAll) return;
        document.querySelectorAll('.memory-btn.slot-drop-hover, .part-btn.slot-drop-hover, .app-main.slot-drop-hover, #editor-grid.slot-drop-hover').forEach(el => {
            el.classList.remove('slot-drop-hover');
        });
    }

    _parseDragPayload(e) {
        try {
            const raw = e && e.dataTransfer && e.dataTransfer.getData ? e.dataTransfer.getData('text/plain') : '';
            if (raw) return JSON.parse(raw);
        } catch (err) { }
        return this._activeMemoryDrag;
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

        const clearHover = () => {
            this._clearMemoryDragHover();
            [...memButtons, ...partButtons, appMain, editorGrid].filter(Boolean).forEach(el => {
                el.classList.remove('slot-drop-hover');
            });
        };

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

            btn.addEventListener('dragover', (e) => {
                const active = this._activeMemoryDrag;
                if (!active) return;
                const validMem = active.kind === 'memory' && active.index !== memIdx && !!this.memories[active.index];
                const validPart = active.kind === 'part';
                if (!validMem && !validPart) return;
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                btn.classList.add('slot-drop-hover');
            });

            btn.addEventListener('dragleave', (e) => {
                e.stopPropagation();
                if (e.relatedTarget && typeof btn.contains === 'function' && btn.contains(e.relatedTarget)) return;
                btn.classList.remove('slot-drop-hover');
            });

            btn.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                btn.classList.remove('slot-drop-hover');
                const data = this._parseDragPayload(e);
                if (!data) return;
                if (data.kind === 'memory' && data.index !== memIdx) {
                    this.copyMemory(data.index, memIdx);
                } else if (data.kind === 'part' && (data.slot === 0 || data.slot === 1)) {
                    this.storePartInMemory(data.slot, memIdx);
                }
                this._activeMemoryDrag = null;
                clearHover();
            });
        });

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

            btn.addEventListener('dragover', (e) => {
                const active = this._activeMemoryDrag;
                if (!active || active.kind !== 'part' || active.slot === slot || this.synthTimbralMode !== 'bitimbral') {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                btn.classList.add('slot-drop-hover');
            });

            btn.addEventListener('dragleave', (e) => {
                e.stopPropagation();
                if (e.relatedTarget && typeof btn.contains === 'function' && btn.contains(e.relatedTarget)) return;
                btn.classList.remove('slot-drop-hover');
            });

            btn.addEventListener('drop', (e) => {
                const data = this._parseDragPayload(e);
                if (!data || data.kind !== 'part' || data.slot === slot || this.synthTimbralMode !== 'bitimbral') {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                btn.classList.remove('slot-drop-hover');
                const srcTimbre = data.slot === 1 ? this.timbreB : this.timbreA;
                const srcLabel = data.slot === 0 ? 'A' : 'B';
                const dstLabel = slot === 0 ? 'A' : 'B';
                this.replacePartWithRawData(slot, srcTimbre.rawData, `Copy Part ${srcLabel} → Part ${dstLabel}`);
                this.showNotification(`Copied Part ${srcLabel} ("${srcTimbre.name}") to Part ${dstLabel}`, 'success');
                this._activeMemoryDrag = null;
                clearHover();
            });
        });

        if (editorGrid) {
            editorGrid.addEventListener('dragover', (e) => {
                const active = this._activeMemoryDrag;
                if (!active || active.kind !== 'part' || this.synthTimbralMode !== 'bitimbral' || this.activeSlot === active.slot) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                editorGrid.classList.add('slot-drop-hover');
            });

            editorGrid.addEventListener('dragleave', (e) => {
                if (e.relatedTarget && typeof editorGrid.contains === 'function' && editorGrid.contains(e.relatedTarget)) return;
                editorGrid.classList.remove('slot-drop-hover');
            });

            editorGrid.addEventListener('drop', (e) => {
                const data = this._parseDragPayload(e);
                if (!data || data.kind !== 'part' || this.synthTimbralMode !== 'bitimbral' || this.activeSlot === data.slot) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                editorGrid.classList.remove('slot-drop-hover');
                const srcTimbre = data.slot === 1 ? this.timbreB : this.timbreA;
                const srcLabel = data.slot === 0 ? 'A' : 'B';
                const dstLabel = this.activeSlot === 0 ? 'A' : 'B';
                this.replacePartWithRawData(this.activeSlot, srcTimbre.rawData, `Copy Part ${srcLabel} → Part ${dstLabel}`);
                this.showNotification(`Copied Part ${srcLabel} ("${srcTimbre.name}") to Part ${dstLabel}`, 'success');
                this._activeMemoryDrag = null;
                clearHover();
            });
        }

        if (appMain) {
            appMain.addEventListener('dragover', (e) => {
                const active = this._activeMemoryDrag;
                if (!active || active.kind !== 'memory' || !this.memories[active.index]) {
                    return;
                }
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                appMain.classList.add('slot-drop-hover');
            });

            appMain.addEventListener('dragleave', (e) => {
                if (e.relatedTarget && typeof appMain.contains === 'function' && appMain.contains(e.relatedTarget)) return;
                appMain.classList.remove('slot-drop-hover');
            });

            appMain.addEventListener('drop', (e) => {
                const data = this._parseDragPayload(e);
                if (!data || data.kind !== 'memory' || !this.memories[data.index]) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                appMain.classList.remove('slot-drop-hover');
                this.loadMemoryToActivePart(data.index);
                this._activeMemoryDrag = null;
                clearHover();
            });
        }
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
    }

    updateLiveSyncUI() {
        if (typeof document === 'undefined') return;
        const connGood = this.isConnectionGood;
        if (!connGood && this.midi && this.midi.liveSync) {
            this.midi.liveSync = false;
            this.midi.saveSettings();
        }
        const isLive = !!(this.midi && this.midi.liveSync && connGood);
        const chkLiveSync = document.getElementById('chk-prog-live-sync');
        if (chkLiveSync) {
            chkLiveSync.disabled = !connGood;
            if (chkLiveSync.checked !== isLive) {
                chkLiveSync.checked = isLive;
            }
            const labelEl = chkLiveSync.parentElement;
            if (labelEl && labelEl.classList) {
                labelEl.classList.toggle('disabled', !connGood);
                labelEl.title = connGood
                    ? 'Real-time NRPN parameter streaming to MM2 hardware'
                    : 'Live Sync unavailable until MicroMonsta 2 connection is verified';
            }
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
    }

    toggleCompare(forceState) {
        const nextState = forceState !== undefined ? forceState : !this.isComparing;
        if (nextState === this.isComparing) return;

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
        this.syncStatus = status;
        if (typeof document === 'undefined') return;
        const badge = document.getElementById('editor-sync-badge');
        if (!badge) return;

        badge.className = `sync-badge ${status}`;
        switch (status) {
            case 'synced':
                badge.textContent = this.midi.liveSync ? 'Live Synced' : 'Synced with MM2';
                badge.title = this.midi.liveSync
                    ? 'Live Parameter Sync active (all tweaks stream immediately via NRPN)'
                    : 'Sound matches hardware state or loaded SysEx file';
                break;
            case 'streaming':
                badge.textContent = 'Streaming NRPN...';
                badge.title = 'Real-time parameter changes transmitting to MM2';
                break;
            case 'modified':
                badge.textContent = 'Modified (Push to sync)';
                badge.title = 'Edits pending. Push to MM2 or enable Live Sync.';
                break;
            case 'fetching':
                badge.textContent = 'Fetching from MM2...';
                badge.title = 'Requesting active edit buffer from synth hardware';
                break;
            case 'failed':
                badge.textContent = 'Sync Failed (Offline)';
                badge.title = 'Hardware did not respond to SysEx dump request. Check cables and channel settings.';
                break;
        }
    }

    fetchActiveProgram(targetSlot = this.activeSlot, opts = {}) {
        if (!this.midi.outPort) {
            this.showNotification('No MIDI Output port selected. Open Settings to connect.', 'error');
            this.switchView('settings');
            return;
        }
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

        this.updateActivePartIndicator();
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
            if (typeof document !== 'undefined' && document.querySelectorAll) {
                document.querySelectorAll('.tab-drop-hover, .slot-drop-hover').forEach(el => {
                    el.classList.remove('tab-drop-hover', 'slot-drop-hover');
                });
            }
        });
    }

    /**
     * Configures an element as a drop target for copying a matching section's parameters.
     */
    wireSectionDropTarget(targetEl, sectionType, targetIndex, timbre, onChange, { hoverClass = 'slot-drop-hover', onDrop } = {}) {
        const resolveTargetIndex = () => (typeof targetIndex === 'function' ? targetIndex() : targetIndex);

        targetEl.addEventListener('dragover', (e) => {
            const active = this._activeDragSection;
            const dstIdx = resolveTargetIndex();
            if (!active || active.kind !== 'section' || active.sectionType !== sectionType || active.sectionIndex === dstIdx) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
            targetEl.classList.add(hoverClass);
        });

        targetEl.addEventListener('dragleave', (e) => {
            e.stopPropagation();
            if (e.relatedTarget && typeof targetEl.contains === 'function' && targetEl.contains(e.relatedTarget)) {
                return;
            }
            targetEl.classList.remove(hoverClass);
        });

        targetEl.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            targetEl.classList.remove(hoverClass);
            try {
                const dstIdx = resolveTargetIndex();
                const raw = e.dataTransfer && e.dataTransfer.getData ? e.dataTransfer.getData('text/plain') : '';
                const data = raw ? JSON.parse(raw) : this._activeDragSection;
                if (data && data.kind === 'section' && data.sectionType === sectionType && data.sectionIndex !== dstIdx) {
                    copySection(sectionType, data.sectionIndex, sectionType, dstIdx, timbre(), onChange);
                    this._activeDragSection = null;
                    if (onDrop) onDrop(data.sectionIndex, dstIdx);
                }
            } catch (err) { }
        });
    }

    createOscillatorPanel(timbre, onChange) {
        if (typeof document === 'undefined') return { card: null };

        const card = document.createElement('div');
        card.className = 'synth-card osc-unified-card';
        card.setAttribute('data-section-type', 'osc');
        card.setAttribute('data-section-index', this.selectedOsc);

        const head = document.createElement('div');
        head.className = 'synth-card-header';

        // Title Group
        const titleGroup = document.createElement('div');
        titleGroup.className = 'card-title-group static';

        const titleText = document.createElement('span');
        titleText.className = 'card-title-text';
        titleText.textContent = 'Oscillator';

        titleGroup.appendChild(titleText);
        head.appendChild(titleGroup);

        // Segmented Tabs: Osc 1, Osc 2, Osc 3
        const tabGroup = document.createElement('div');
        tabGroup.className = 'osc-tabs-group';

        const tabButtons = [];
        for (let i = 1; i <= 3; i++) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `btn-osc-tab ${this.selectedOsc === i ? 'active' : ''}`;
            btn.setAttribute('data-osc', i);
            btn.textContent = `Osc ${i}`;

            // Indicator dots for Mute & Solo
            const muteDot = document.createElement('span');
            muteDot.className = 'tab-dot dot-mute';
            const soloDot = document.createElement('span');
            soloDot.className = 'tab-dot dot-solo';
            btn.appendChild(muteDot);
            btn.appendChild(soloDot);

            // Drag-and-drop source & target to copy directly between oscillators
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

        // Solo / Mute Toolbar
        const soloMuteGroup = document.createElement('div');
        soloMuteGroup.className = 'solo-mute-group';

        const muteBtn = document.createElement('button');
        muteBtn.type = 'button';
        muteBtn.className = 'btn-sm-badge btn-mute';
        muteBtn.textContent = 'M';
        muteBtn.title = 'Mute selected oscillator';
        muteBtn.onclick = (e) => {
            e.stopPropagation();
            const key = 'osc' + this.selectedOsc;
            this.muteState[key] = !this.muteState[key];
            this.applySoloMute();
            updateOscSelection();
        };

        const soloBtn = document.createElement('button');
        soloBtn.type = 'button';
        soloBtn.className = 'btn-sm-badge btn-solo';
        soloBtn.textContent = 'S';
        soloBtn.title = 'Solo selected oscillator';
        soloBtn.onclick = (e) => {
            e.stopPropagation();
            const key = 'osc' + this.selectedOsc;
            this.soloState[key] = !this.soloState[key];
            this.applySoloMute();
            updateOscSelection();
        };

        soloMuteGroup.appendChild(muteBtn);
        soloMuteGroup.appendChild(soloBtn);
        head.appendChild(soloMuteGroup);

        // Section Menu Button (Copy, Paste, Reset, Randomize)
        const menuWrap = document.createElement('div');
        menuWrap.className = 'card-menu-wrap';

        const menuBtn = document.createElement('button');
        menuBtn.type = 'button';
        menuBtn.className = 'card-menu-btn';
        menuBtn.textContent = '⋯';
        menuBtn.title = 'Oscillator Actions (Copy, Paste, Reset, Randomize)';

        const dropdown = document.createElement('div');
        dropdown.className = 'card-dropdown-menu';

        const updateMenuState = () => {
            const clip = getSectionClipboard();
            const canPaste = clip && clip.sectionType === 'osc';
            dropdown.innerHTML = `
                <div class="menu-item" data-action="copy">${ICON_COPY_SVG} <span>Copy Osc ${card.getAttribute('data-section-index')}</span></div>
                <div class="menu-item ${canPaste ? '' : 'disabled'}" data-action="paste">${ICON_PASTE_SVG} <span>Paste Section</span></div>
                <div class="menu-item" data-action="reset">${ICON_RESET_SVG} <span>Reset to Defaults</span></div>
                <div class="menu-item" data-action="randomize">${ICON_RANDOM_SVG} <span>Smart Randomize</span></div>
            `;

            dropdown.querySelector('[data-action="copy"]').onclick = (e) => {
                e.stopPropagation();
                const curIdx = parseInt(card.getAttribute('data-section-index'), 10) || 1;
                copySectionToClipboard('osc', curIdx, timbre());
                closeMenu();
                this.showNotification(`Copied Oscillator ${curIdx} to clipboard`, 'info');
            };

            const pasteEl = dropdown.querySelector('[data-action="paste"]');
            if (canPaste) {
                pasteEl.onclick = (e) => {
                    e.stopPropagation();
                    const curIdx = parseInt(card.getAttribute('data-section-index'), 10) || 1;
                    pasteSectionFromClipboard('osc', curIdx, timbre(), onChange);
                    closeMenu();
                    card.refresh();
                    this.showNotification(`Pasted into Oscillator ${curIdx}`, 'success');
                };
            }

            dropdown.querySelector('[data-action="reset"]').onclick = (e) => {
                e.stopPropagation();
                const curIdx = parseInt(card.getAttribute('data-section-index'), 10) || 1;
                resetSectionToInit('osc', curIdx, timbre(), onChange);
                closeMenu();
                card.refresh();
                this.showNotification(`Reset Oscillator ${curIdx} to defaults`, 'info');
            };

            dropdown.querySelector('[data-action="randomize"]').onclick = (e) => {
                e.stopPropagation();
                const curIdx = parseInt(card.getAttribute('data-section-index'), 10) || 1;
                randomizeSection('osc', curIdx, timbre(), onChange);
                closeMenu();
                card.refresh();
                this.showNotification(`Randomized Oscillator ${curIdx}`, 'success');
            };
        };

        const closeMenu = () => {
            dropdown.classList.remove('open');
            window.removeEventListener('click', closeMenu);
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
        head.appendChild(menuWrap);

        card.appendChild(head);

        // Body with Panes
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
        for (let i = 1; i <= 3; i++) {
            const pane = document.createElement('div');
            pane.className = `osc-pane osc-pane-${i}`;
            pane.style.display = (this.selectedOsc === i) ? 'flex' : 'none';

            // Algorithm select
            pane.appendChild(createSelect(`OSC${i}_ALGO`, timbre, onChange));

            // Knobs row: Shape, Tune, Fine Tune, Mix
            const knobs = document.createElement('div');
            knobs.className = 'knob-row';
            knobs.appendChild(createKnob(`OSC${i}_SHAPE`, timbre, onChange));
            knobs.appendChild(createKnob(`OSC${i}_TUNE`, timbre, onChange));
            knobs.appendChild(createKnob(`OSC${i}_FINETUNE`, timbre, onChange));
            knobs.appendChild(createKnob(`MIX_OSC${i}`, timbre, onChange));
            pane.appendChild(knobs);

            body.appendChild(pane);
            panes.push(pane);
        }

        // Global Oscillator Phase Reset & Noise Generator in footer
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
        noiseMuteBtn.onclick = (e) => {
            e.stopPropagation();
            this.muteState.noise = !this.muteState.noise;
            this.applySoloMute();
            noiseMuteBtn.classList.toggle('active', this.muteState.noise);
        };

        const noiseSoloBtn = document.createElement('button');
        noiseSoloBtn.type = 'button';
        noiseSoloBtn.className = 'btn-sm-badge btn-solo' + (this.soloState.noise ? ' active' : '');
        noiseSoloBtn.textContent = 'S';
        noiseSoloBtn.title = 'Solo Noise Generator';
        noiseSoloBtn.onclick = (e) => {
            e.stopPropagation();
            this.soloState.noise = !this.soloState.noise;
            this.applySoloMute();
            noiseSoloBtn.classList.toggle('active', this.soloState.noise);
        };

        noiseBadges.appendChild(noiseMuteBtn);
        noiseBadges.appendChild(noiseSoloBtn);
        noiseGroup.appendChild(createKnob('MIX_NOISE', timbre, onChange, { small: true }));
        noiseGroup.appendChild(noiseBadges);

        footer.appendChild(noiseGroup);
        footer.appendChild(createSelect('OSC_PHASE_RESET', timbre, onChange));
        body.appendChild(footer);

        card.appendChild(body);

        // Function to update which pane and tab is active
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
                if (active) {
                    pane.querySelectorAll('[data-param]').forEach(el => {
                        if (el.refresh) el.refresh();
                    });
                }
            });

            muteBtn.classList.toggle('active', !!this.muteState['osc' + idx]);
            soloBtn.classList.toggle('active', !!this.soloState['osc' + idx]);
        };

        card.refresh = () => {
            card.querySelectorAll('[data-param]').forEach(el => {
                if (el.refresh) el.refresh();
            });
            updateOscSelection();
        };

        // Initialize state
        updateOscSelection();

        return card;
    }

    createEnvelopePanel(timbre, onChange) {
        if (typeof document === 'undefined') return document.createElement('div');

        const card = document.createElement('div');
        card.className = 'synth-card env-unified-card';
        card.setAttribute('data-section-type', 'env');
        card.setAttribute('data-section-index', this.selectedEnv);

        const head = document.createElement('div');
        head.className = 'synth-card-header';

        // Title Group
        const titleGroup = document.createElement('div');
        titleGroup.className = 'card-title-group static';

        const titleText = document.createElement('span');
        titleText.className = 'card-title-text';
        titleText.textContent = 'Envelopes';

        titleGroup.appendChild(titleText);
        head.appendChild(titleGroup);

        // Segmented Tabs: Env 1, Env 2, Env 3
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

            // Drag-and-drop source & target to copy directly between envelopes
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

        // Section Menu Button (Copy, Paste, Reset, Randomize)
        const menuWrap = document.createElement('div');
        menuWrap.className = 'card-menu-wrap';

        const menuBtn = document.createElement('button');
        menuBtn.type = 'button';
        menuBtn.className = 'card-menu-btn';
        menuBtn.textContent = '⋯';
        menuBtn.title = 'Envelope Actions (Copy, Paste, Reset, Randomize)';

        const dropdown = document.createElement('div');
        dropdown.className = 'card-dropdown-menu';

        const updateMenuState = () => {
            const clip = getSectionClipboard();
            const canPaste = clip && clip.sectionType === 'env';
            dropdown.innerHTML = `
                <div class="menu-item" data-action="copy">${ICON_COPY_SVG} <span>Copy Env ${card.getAttribute('data-section-index')}</span></div>
                <div class="menu-item ${canPaste ? '' : 'disabled'}" data-action="paste">${ICON_PASTE_SVG} <span>Paste Section</span></div>
                <div class="menu-item" data-action="reset">${ICON_RESET_SVG} <span>Reset to Defaults</span></div>
                <div class="menu-item" data-action="randomize">${ICON_RANDOM_SVG} <span>Smart Randomize</span></div>
            `;

            dropdown.querySelector('[data-action="copy"]').onclick = (e) => {
                e.stopPropagation();
                const curIdx = parseInt(card.getAttribute('data-section-index'), 10) || 1;
                copySectionToClipboard('env', curIdx, timbre());
                closeMenu();
                this.showNotification(`Copied Envelope ${curIdx} to clipboard`, 'info');
            };

            const pasteEl = dropdown.querySelector('[data-action="paste"]');
            if (canPaste) {
                pasteEl.onclick = (e) => {
                    e.stopPropagation();
                    const curIdx = parseInt(card.getAttribute('data-section-index'), 10) || 1;
                    pasteSectionFromClipboard('env', curIdx, timbre(), onChange);
                    closeMenu();
                    card.refresh();
                    this.showNotification(`Pasted into Envelope ${curIdx}`, 'success');
                };
            }

            dropdown.querySelector('[data-action="reset"]').onclick = (e) => {
                e.stopPropagation();
                const curIdx = parseInt(card.getAttribute('data-section-index'), 10) || 1;
                resetSectionToInit('env', curIdx, timbre(), onChange);
                closeMenu();
                card.refresh();
                this.showNotification(`Reset Envelope ${curIdx} to defaults`, 'info');
            };

            dropdown.querySelector('[data-action="randomize"]').onclick = (e) => {
                e.stopPropagation();
                const curIdx = parseInt(card.getAttribute('data-section-index'), 10) || 1;
                randomizeSection('env', curIdx, timbre(), onChange);
                closeMenu();
                card.refresh();
                this.showNotification(`Randomized Envelope ${curIdx}`, 'success');
            };
        };

        const closeMenu = () => {
            dropdown.classList.remove('open');
            window.removeEventListener('click', closeMenu);
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
        head.appendChild(menuWrap);

        card.appendChild(head);

        // Body
        const body = document.createElement('div');
        body.className = 'synth-card-body';

        // Top: Row of all 3 ADSR visualizer curves side-by-side
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

            const viz = createADSRVisualizer(i, timbre);
            gCard.appendChild(gLabel);
            gCard.appendChild(viz);

            gCard.onclick = () => {
                this.selectedEnv = i;
                updateEnvSelection();
            };

            graphsRow.appendChild(gCard);
            graphCards.push(gCard);
        }
        body.appendChild(graphsRow);

        // Bottom: Panes for selected envelope controls
        const panes = [];
        for (let i = 1; i <= 3; i++) {
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
            pane.appendChild(knobs);

            pane.appendChild(createSelect(`ENV${i}_RESET`, timbre, onChange));

            this.wireSectionDropTarget(pane, 'env', i, timbre, onChange, {
                hoverClass: 'slot-drop-hover',
                onDrop: (srcIdx, dstIdx) => {
                    card.refresh();
                    this.showNotification(`Copied Env ${srcIdx} to Env ${dstIdx}`, 'success');
                }
            });

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
                if (active) {
                    pane.querySelectorAll('[data-param]').forEach(el => {
                        if (el.refresh) el.refresh();
                    });
                }
            });
        };

        card.refresh = () => {
            card.querySelectorAll('[data-param]').forEach(el => {
                if (el.refresh) el.refresh();
            });
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

    buildEditorUI() {
        if (typeof document === 'undefined') return;
        const grid = document.getElementById('editor-grid');
        if (!grid) return;
        grid.innerHTML = '';

        const timbre = () => this.activeTimbre;
        const onChange = this.createOnChange();

        // Helper to make a rack row container
        const makeRow = (rowClass = '') => {
            const row = document.createElement('div');
            row.className = `rack-row ${rowClass}`;
            return row;
        };

        // Helper to make a standard section card
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

        // ========================================================
        // --- ROW 1: TOP SYNTHESIS ROW (OSCILLATORS, FILTER, ENVELOPES) ---
        // ========================================================
        const row1 = makeRow('rack-row-1');
        row1.appendChild(this.createOscillatorPanel(timbre, onChange));

        // FILTER
        const flt = createSectionCard('Filter', 'flt', 1, timbre, onChange);
        flt.body.appendChild(createFilterCurveVisualizer(timbre));

        const fltSelects = document.createElement('div');
        fltSelects.className = 'select-row';
        fltSelects.appendChild(createSelect('FILTER_ALGO', timbre, onChange));
        const fltCharWrap = createSelect('FILTER_CHARACTER', timbre, onChange);
        fltCharWrap.setAttribute('data-fw-v3-only', 'true');
        fltSelects.appendChild(fltCharWrap);
        flt.body.appendChild(fltSelects);

        // Filter Knobs — Row 1: Cutoff, Resonance, Tracking, Envelope
        const fltRow1Knobs = document.createElement('div');
        fltRow1Knobs.className = 'knob-row flt-main-knobs';
        fltRow1Knobs.appendChild(createKnob('FILTER_FREQ', timbre, onChange, { large: true }));
        fltRow1Knobs.appendChild(createKnob('FILTER_RESO', timbre, onChange, { large: true }));
        fltRow1Knobs.appendChild(createKnob('FILTER_TRACKING', timbre, onChange));
        fltRow1Knobs.appendChild(createKnob('FILTER_ENV2', timbre, onChange));
        flt.body.appendChild(fltRow1Knobs);

        // Filter Knobs — Row 2: FM, Drive, Mix / Volume
        const fltRow2Knobs = document.createElement('div');
        fltRow2Knobs.className = 'knob-row';
        fltRow2Knobs.appendChild(createKnob('FILTER_FM', timbre, onChange));
        fltRow2Knobs.appendChild(createKnob('DRIVE_VOICE', timbre, onChange));
        fltRow2Knobs.appendChild(createKnob('LAY_MASTER_VOLUME', timbre, onChange));
        flt.body.appendChild(fltRow2Knobs);
        row1.appendChild(flt.card);

        // ENVELOPES (1–3 Unified)
        row1.appendChild(this.createEnvelopePanel(timbre, onChange));

        grid.appendChild(row1);

        // ========================================================
        // --- ROW 2: MODULATION ROW (LFOS, MATH, KNOBS & MOD MATRIX) ---
        // ========================================================
        const row2 = makeRow('rack-row-2');

        // Left Column: LFOs (1–3) + Math Operators
        const modLeftCol = document.createElement('div');
        modLeftCol.className = 'mod-left-column';

        // LFOs Group Card (with group-level Copy/Paste/Reset/Randomize in ⋯ menu)
        const lfoGroupCard = createSectionCard('Low Frequency Oscillators', 'lfo_group', 1, timbre, onChange);
        const lfoGrid = document.createElement('div');
        lfoGrid.className = 'lfo-multi-grid';

        for (let l = 1; l <= 3; l++) {
            const subLfo = document.createElement('div');
            subLfo.className = 'lfo-sub-card';
            subLfo.setAttribute('data-lfo', l);

            // Sub-header with draggable badge and inline action buttons
            const subHeader = document.createElement('div');
            subHeader.className = 'lfo-sub-header';

            const badge = document.createElement('div');
            badge.className = 'lfo-badge';
            badge.textContent = `LFO ${l}`;
            badge.title = `LFO ${l} • Drag to copy to another LFO`;

            this.wireSectionDragSource(badge, 'lfo', l, { containerEl: subLfo });
            this.wireSectionDropTarget(subLfo, 'lfo', l, timbre, onChange, {
                hoverClass: 'slot-drop-hover',
                onDrop: (srcIdx, dstIdx) => {
                    subLfo.querySelectorAll('[data-param]').forEach(el => el.refresh && el.refresh());
                    const viz = subLfo.querySelector('.lfo-visualizer');
                    if (viz && viz.refresh) viz.refresh();
                    this.showNotification(`Copied LFO ${srcIdx} to LFO ${dstIdx}`, 'success');
                }
            });

            const actions = document.createElement('div');
            actions.className = 'matrix-slot-actions';

            const btnCopy = document.createElement('button');
            btnCopy.type = 'button';
            btnCopy.className = 'btn-slot-icon';
            btnCopy.title = `Copy LFO ${l} to clipboard`;
            btnCopy.innerHTML = ICON_COPY_SVG;
            btnCopy.onclick = () => {
                copySectionToClipboard('lfo', l, timbre());
                this.showNotification(`Copied LFO ${l} to clipboard`, 'info');
            };

            const btnPaste = document.createElement('button');
            btnPaste.type = 'button';
            btnPaste.className = 'btn-slot-icon';
            btnPaste.title = `Paste into LFO ${l}`;
            btnPaste.innerHTML = ICON_PASTE_SVG;
            btnPaste.onclick = () => {
                const res = pasteSectionFromClipboard('lfo', l, timbre(), onChange);
                if (res) {
                    subLfo.querySelectorAll('[data-param]').forEach(el => el.refresh && el.refresh());
                    const viz = subLfo.querySelector('.lfo-visualizer');
                    if (viz && viz.refresh) viz.refresh();
                    this.showNotification(`Pasted into LFO ${l}`, 'success');
                } else {
                    this.showNotification('Clipboard is empty or contains non-LFO data', 'warning');
                }
            };

            const btnRandom = document.createElement('button');
            btnRandom.type = 'button';
            btnRandom.className = 'btn-slot-icon';
            btnRandom.title = `Smart randomize LFO ${l}`;
            btnRandom.innerHTML = ICON_RANDOM_SVG;
            btnRandom.onclick = () => {
                randomizeSection('lfo', l, timbre(), onChange);
                subLfo.querySelectorAll('[data-param]').forEach(el => el.refresh && el.refresh());
                const viz = subLfo.querySelector('.lfo-visualizer');
                if (viz && viz.refresh) viz.refresh();
                this.showNotification(`Randomized LFO ${l}`, 'info');
            };

            const btnClear = document.createElement('button');
            btnClear.type = 'button';
            btnClear.className = 'btn-slot-icon btn-slot-clear';
            btnClear.title = `Reset LFO ${l} to init defaults`;
            btnClear.textContent = '✕';
            btnClear.onclick = () => {
                resetSectionToInit('lfo', l, timbre(), onChange);
                subLfo.querySelectorAll('[data-param]').forEach(el => el.refresh && el.refresh());
                const viz = subLfo.querySelector('.lfo-visualizer');
                if (viz && viz.refresh) viz.refresh();
                this.showNotification(`Reset LFO ${l} to defaults`, 'info');
            };

            actions.appendChild(btnCopy);
            actions.appendChild(btnPaste);
            actions.appendChild(btnRandom);
            actions.appendChild(btnClear);

            subHeader.appendChild(badge);
            subHeader.appendChild(actions);
            subLfo.appendChild(subHeader);

            subLfo.appendChild(createLFOWaveformPreview(l, timbre));

            const lfoSels = document.createElement('div');
            lfoSels.className = 'select-row';
            lfoSels.appendChild(createSelect(`LFO${l}_WAVE`, timbre, onChange));
            lfoSels.appendChild(createSelect(`LFO${l}_MODE`, timbre, onChange));
            subLfo.appendChild(lfoSels);

            const lfoKnobs = document.createElement('div');
            lfoKnobs.className = 'knob-row';
            lfoKnobs.appendChild(createKnob(`LFO${l}_SPEED`, timbre, onChange));
            subLfo.appendChild(lfoKnobs);

            lfoGrid.appendChild(subLfo);
        }
        lfoGroupCard.body.appendChild(lfoGrid);
        modLeftCol.appendChild(lfoGroupCard.card);

        // Math Operators Card (Compact 2-column layout: Lag on left, Multipliers stacked on right)
        const mathSec = makeSection('Math Operators');
        const mathGrid = document.createElement('div');
        mathGrid.className = 'math-operators-grid';

        // Lag Generator (Left column: source select and amount knob side-by-side in horizontal row)
        const lagBox = document.createElement('div');
        lagBox.className = 'math-sub-panel';
        lagBox.innerHTML = '<div class="fx-sub-title">Lag Generator (Glide)</div>';
        const lagControls = document.createElement('div');
        lagControls.className = 'lag-controls-row';
        lagControls.appendChild(createSelect('LAG_SRC1', timbre, onChange));
        lagControls.appendChild(createKnob('LAG_AMT1', timbre, onChange));
        lagBox.appendChild(lagControls);
        mathGrid.appendChild(lagBox);

        // Multipliers 1 & 2 (Right column: vertically stacked in .math-mult-stack)
        const multStack = document.createElement('div');
        multStack.className = 'math-mult-stack';

        for (let m = 1; m <= 2; m++) {
            const multBox = document.createElement('div');
            multBox.className = 'math-sub-panel';
            multBox.setAttribute('data-mult', m);

            const multBadge = document.createElement('div');
            multBadge.className = 'mult-badge';
            multBadge.textContent = `Multiplier ${m} (A × B)`;
            multBadge.title = `Multiplier ${m} • Drag to copy to another multiplier`;
            multBox.appendChild(multBadge);

            this.wireSectionDragSource(multBadge, 'mult', m, { containerEl: multBox });
            this.wireSectionDropTarget(multBox, 'mult', m, timbre, onChange, {
                hoverClass: 'slot-drop-hover',
                onDrop: (srcIdx, dstIdx) => {
                    multBox.querySelectorAll('[data-param]').forEach(el => el.refresh && el.refresh());
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
        modLeftCol.appendChild(mathSec.card);

        row2.appendChild(modLeftCol);

        // Right Column: Knobs + Modulation Matrix
        const modRightCol = document.createElement('div');
        modRightCol.className = 'mod-right-column';

        // Knobs Card (Hardware Pots & Encoders F, Q, M, E1, E2, E3, E4) placed above Matrix
        const knobsSec = makeSection('Knobs');
        const knobsGrid = document.createElement('div');
        knobsGrid.className = 'knobs-assign-grid';
        knobsGrid.appendChild(createSelect('LAY_POT1_ASSIGN', timbre, onChange));
        knobsGrid.appendChild(createSelect('LAY_POT2_ASSIGN', timbre, onChange));
        knobsGrid.appendChild(createSelect('LAY_POT3_ASSIGN', timbre, onChange));
        knobsGrid.appendChild(createSelect('LAY_ENC1_ASSIGN', timbre, onChange));
        knobsGrid.appendChild(createSelect('LAY_ENC2_ASSIGN', timbre, onChange));
        knobsGrid.appendChild(createSelect('LAY_ENC3_ASSIGN', timbre, onChange));
        knobsGrid.appendChild(createSelect('LAY_ENC4_ASSIGN', timbre, onChange));
        knobsSec.body.appendChild(knobsGrid);
        modRightCol.appendChild(knobsSec.card);

        // Right Column: Modulation Matrix (12 single-row slots)
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

            // Drag badge
            const badge = document.createElement('div');
            badge.className = 'matrix-slot-badge';
            badge.textContent = `${m}`;
            badge.title = `Slot ${m} • Drag to copy to another slot`;

            this.wireSectionDragSource(badge, 'mtx', m, { containerEl: slotRow });
            this.wireSectionDropTarget(slotRow, 'mtx', m, timbre, onChange, {
                hoverClass: 'slot-drop-hover',
                onDrop: (srcIdx, dstIdx) => {
                    slotRow.querySelectorAll('[data-param]').forEach(el => el.refresh && el.refresh());
                    this.showNotification(`Copied Slot ${srcIdx} to Slot ${dstIdx}`, 'success');
                }
            });

            const srcSelect = createSelect(`MTX${m}_SRC`, timbre, onChange);
            srcSelect.classList.add('mtx-select-src');

            const arrow = document.createElement('span');
            arrow.className = 'matrix-arrow';
            arrow.textContent = '→';

            const dstSelect = createSelect(`MTX${m}_DST`, timbre, onChange);
            dstSelect.classList.add('mtx-select-dst');

            const amtSlider = createBipolarSlider(`MTX${m}_AMT`, timbre, onChange, { label: 'Amt' });

            // Action buttons: Copy, Paste, Randomize, Clear
            const actions = document.createElement('div');
            actions.className = 'matrix-slot-actions';

            const btnCopy = document.createElement('button');
            btnCopy.type = 'button';
            btnCopy.className = 'btn-slot-icon';
            btnCopy.title = `Copy Slot ${m} routing to clipboard`;
            btnCopy.innerHTML = ICON_COPY_SVG;
            btnCopy.onclick = () => {
                copySectionToClipboard('mtx', m, timbre());
                this.showNotification(`Copied Matrix Slot ${m} to clipboard`, 'info');
            };

            const btnPaste = document.createElement('button');
            btnPaste.type = 'button';
            btnPaste.className = 'btn-slot-icon';
            btnPaste.title = `Paste into Slot ${m}`;
            btnPaste.innerHTML = ICON_PASTE_SVG;
            btnPaste.onclick = () => {
                const res = pasteSectionFromClipboard('mtx', m, timbre(), onChange);
                if (res) {
                    slotRow.querySelectorAll('[data-param]').forEach(el => el.refresh && el.refresh());
                    this.showNotification(`Pasted into Matrix Slot ${m}`, 'success');
                } else {
                    this.showNotification('Clipboard is empty or contains non-matrix data', 'warning');
                }
            };

            const btnRandom = document.createElement('button');
            btnRandom.type = 'button';
            btnRandom.className = 'btn-slot-icon';
            btnRandom.title = `Smart randomize Slot ${m}`;
            btnRandom.innerHTML = ICON_RANDOM_SVG;
            btnRandom.onclick = () => {
                randomizeSection('mtx', m, timbre(), onChange);
                slotRow.querySelectorAll('[data-param]').forEach(el => el.refresh && el.refresh());
                this.showNotification(`Randomized Matrix Slot ${m}`, 'info');
            };

            const btnClear = document.createElement('button');
            btnClear.type = 'button';
            btnClear.className = 'btn-slot-icon btn-slot-clear';
            btnClear.title = `Clear Slot ${m}`;
            btnClear.textContent = '✕';
            btnClear.onclick = () => {
                resetSectionToInit('mtx', m, timbre(), onChange);
                slotRow.querySelectorAll('[data-param]').forEach(el => el.refresh && el.refresh());
            };

            actions.appendChild(btnCopy);
            actions.appendChild(btnPaste);
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
        modRightCol.appendChild(mtxSec.card);
        row2.appendChild(modRightCol);

        grid.appendChild(row2);

        // ========================================================
        // --- ROW 3: VOICE PERFORMANCE & EFFECTS ---
        // ========================================================
        const row3 = makeRow('rack-row-3');

        // VOICE PERFORMANCE
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
        vceKnobs1.appendChild(createKnob('VCE_PBRANGE_DOWN', timbre, onChange));
        vceKnobs1.appendChild(createKnob('VCE_PBRANGE_UP', timbre, onChange));
        vceCard.body.appendChild(vceKnobs1);
        row3.appendChild(vceCard.card);

        // EFFECTS (Horizontal 2-row layout: Top = Delay & Reverb; Bottom = Chorus/EQ/Morph & Pan)
        const fxSec = createSectionCard('Effects & Space', 'fx', 1, timbre, onChange);
        const fxLayout = document.createElement('div');
        fxLayout.className = 'fx-layout-grid';

        // --- Top Row (Time & Space) ---
        const fxRowTop = document.createElement('div');
        fxRowTop.className = 'fx-row-top';

        // 1. Delay (Horizontal strip with DLY_TYPE on left, knobs on right)
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

        // 2. Reverb (Decay, Mod/Damp, Level in a single row)
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

        // --- Bottom Row (Modulation, Tone & Stereo) ---
        const fxRowBottom = document.createElement('div');
        fxRowBottom.className = 'fx-row-bottom';

        // 3. Chorus, EQ & Morph Unified Sub-panel
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

        // 4. Pan Sub-panel
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
        row3.appendChild(fxSec.card);

        grid.appendChild(row3);

        // ========================================================
        // --- ROW 4: ARPEGGIATOR & CHORDER ENGINES ---
        // ========================================================
        const row4 = makeRow('rack-row-4');

        // Arpeggiator & 16-Step Pattern Sequencer
        const arpSec = makeSection('Arpeggiator & 16-Step Pattern Sequencer');
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
        arpSec.body.appendChild(arpControlsRow);

        const arpSeq = createArpSequencer(timbre, onChange);
        arpSeq.id = 'arp-seq-wrapper';
        arpSec.body.appendChild(arpSeq);
        row4.appendChild(arpSec.card);

        // FW v3 Scaler & Chorder Engine
        const chordSec = makeSection('FW v3 Chorder & Scaler Engine');
        chordSec.card.setAttribute('data-fw-v3-only', 'true');

        // Top Row: Single horizontal flex row
        const chordTopRow = document.createElement('div');
        chordTopRow.className = 'chord-top-row';

        // 1. Stacked toggles (MIDI Input + Chord Expand)
        const chordToggleStack = document.createElement('div');
        chordToggleStack.className = 'chord-toggle-stack';
        chordToggleStack.appendChild(createSelect('KBD_MIDI_INPUT', timbre, onChange));
        chordToggleStack.appendChild(createSelect('KBD_CHORD_EXPAND', timbre, onChange));
        chordTopRow.appendChild(chordToggleStack);

        // 2. Key
        const keySelect = createSelect('KBD_KEY', timbre, onChange);
        keySelect.classList.add('chord-key-select');
        chordTopRow.appendChild(keySelect);

        // 3. Scale
        const scaleSelect = createSelect('KBD_SCALE', timbre, onChange);
        scaleSelect.classList.add('chord-scale-select');
        chordTopRow.appendChild(scaleSelect);

        // 4. Octave
        chordTopRow.appendChild(createKnob('KBD_OCTAVE', timbre, onChange));
        chordSec.body.appendChild(chordTopRow);

        // Scale Degree Section (2 columns)
        const chordDegreesBox = document.createElement('div');
        chordDegreesBox.className = 'chord-degrees-grid';
        chordDegreesBox.innerHTML = '<div class="chord-degrees-title">Scale Degree Chords</div>';

        const chordCols = document.createElement('div');
        chordCols.className = 'chord-degrees-columns';

        // Column 1: Chords 1–4
        const col1 = document.createElement('div');
        col1.className = 'chord-degrees-col';
        for (let d = 1; d <= 4; d++) {
            col1.appendChild(createSelect(`CHORD_TYPE${d}`, timbre, onChange));
        }
        chordCols.appendChild(col1);

        // Column 2: Chords 5–7 + Note
        const col2 = document.createElement('div');
        col2.className = 'chord-degrees-col';
        for (let d = 5; d <= 7; d++) {
            col2.appendChild(createSelect(`CHORD_TYPE${d}`, timbre, onChange));
        }
        const noteEl = document.createElement('div');
        noteEl.className = 'chord-degrees-note';
        noteEl.textContent = 'Degree 1 = Base Chord; Degrees 2–7 require Chord Expand';
        col2.appendChild(noteEl);
        chordCols.appendChild(col2);

        chordDegreesBox.appendChild(chordCols);
        chordSec.body.appendChild(chordDegreesBox);
        row4.appendChild(chordSec.card);

        grid.appendChild(row4);

        // Hook up Program Bar controls
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

    setupProgramBar() {
        const nameInput = document.getElementById('prog-name-input');
        if (nameInput) {
            nameInput.value = this.activeTimbre.name;
            nameInput.onchange = () => {
                this.activeTimbre.name = nameInput.value;
                this.onParameterChanged('LAY_NAME_1', 0); // triggers sync
                if (this.tabSync) {
                    this.tabSync.broadcast('PATCH_META_CHANGE', {
                        slot: this.activeSlot,
                        name: this.activeTimbre.name,
                        category: this.activeTimbre.category
                    });
                }
            };
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
                if (this.tabSync) {
                    this.tabSync.broadcast('PATCH_META_CHANGE', {
                        slot: this.activeSlot,
                        name: this.activeTimbre.name,
                        category: this.activeTimbre.category
                    });
                }
            };
        }

        // Program Tempo Knob in header bar
        const tempoContainer = document.getElementById('prog-tempo-container');
        if (tempoContainer) {
            tempoContainer.innerHTML = '';
            const tempoKnob = createKnob('LAY_TEMPO', () => this.activeTimbre, (k, v, m) => this.onParameterChanged(k, v, m), { small: true });
            tempoContainer.appendChild(tempoKnob);
        }

        // Live Sync switch on program bar
        const chkLiveSync = document.getElementById('chk-prog-live-sync');
        if (chkLiveSync) {
            chkLiveSync.checked = this.midi.liveSync;
            this.updateLiveSyncUI();
            chkLiveSync.onchange = async () => {
                if (!this.isConnectionGood) {
                    chkLiveSync.checked = false;
                    this.updateLiveSyncUI();
                    return;
                }
                if (chkLiveSync.checked) {
                    chkLiveSync.checked = false; // Stay unchecked until choice confirmed
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
                        // Fallback if dialog.showModal not supported
                        this._setLiveSyncState(true);
                        this.updateSyncStatus('synced');
                    } else {
                        this._setLiveSyncState(false, { broadcast: false });
                    }
                } else {
                    this._setLiveSyncState(false);
                    this.updateSyncStatus('modified');
                    this.showNotification('Live Parameter Sync DISABLED (Staged Commit)', 'info');
                }
            };
        }

        // Hardware Fetch Button
        const btnFetch = document.getElementById('btn-prog-fetch');
        if (btnFetch) {
            btnFetch.onclick = () => {
                if (!this.isConnectionGood || (this.midi && this.midi.liveSync)) return;
                this.fetchActiveProgram();
            };
        }

        // Undo & Redo Buttons
        const btnUndo = document.getElementById('btn-prog-undo');
        if (btnUndo) {
            btnUndo.onclick = () => this.undo();
        }

        const btnRedo = document.getElementById('btn-prog-redo');
        if (btnRedo) {
            btnRedo.onclick = () => this.redo();
        }

        this.wireMemoryAndPartDragDrop();
        this.updateMemoryUI();

        // Compare Button
        const btnCompare = document.getElementById('btn-prog-compare');
        if (btnCompare) {
            btnCompare.onclick = () => this.toggleCompare();
        }

        // Program action buttons
        const btnInit = document.getElementById('btn-prog-init');
        if (btnInit) {
            btnInit.onclick = () => {
                const partLabel = `Part ${this.activeSlot === 0 ? 'A' : 'B'}`;
                const liveSyncNote = this.midi.liveSync ? ' and immediately synchronize with connected MicroMonsta 2 hardware' : '';
                if (confirm(`Reset ${partLabel} (${this.activeTimbre.name}) to default INIT values${liveSyncNote}?`)) {
                    this.activeTimbre.rawData = new MM2Program().rawData;
                    if (this.activeSlot === 0) {
                        this.originalSnapshotA = this.activeTimbre.clone();
                    } else {
                        this.originalSnapshotB = this.activeTimbre.clone();
                    }
                    this.undoStack = [];
                    this.redoStack = [];
                    this.updateUndoRedoUI();
                    this.updateSyncStatus(this.midi.liveSync && this.isConnectionGood ? 'synced' : 'modified');
                    this.refreshEditorControls();
                    if (this.tabSync) {
                        this.tabSync.broadcast('PATCH_LOADED', {
                            slot: this.activeSlot,
                            rawData: Array.from(this.activeTimbre.rawData),
                            source: 'init'
                        });
                    }

                    if (this.midi.liveSync && this.isConnectionGood) {
                        try {
                            this.midi.sendProgram(this.activeTimbre, this.activeSlot, true);
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
            fileInput.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                try {
                    const buf = new Uint8Array(await file.arrayBuffer());
                    const msgs = extractSysExMessagesWithMeta(buf);
                    if (msgs.length === 0) {
                        alert('No valid MicroMonsta 2 SysEx program dump found in this file.');
                        return;
                    }
                    this.activeTimbre.rawData = msgs[0].bytes;
                    if (this.activeSlot === 0) {
                        this.originalSnapshotA = this.activeTimbre.clone();
                    } else {
                        this.originalSnapshotB = this.activeTimbre.clone();
                    }
                    this.undoStack = [];
                    this.redoStack = [];
                    this.updateUndoRedoUI();
                    this.updateSyncStatus('synced');
                    this.refreshEditorControls();
                    if (this.tabSync) {
                        this.tabSync.broadcast('PATCH_LOADED', {
                            slot: this.activeSlot,
                            rawData: Array.from(this.activeTimbre.rawData),
                            source: 'file'
                        });
                    }
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
                } catch (err) {
                    alert('Error loading SysEx file: ' + err.message);
                }
                fileInput.value = '';
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
                if (this.activeSlot === 0) {
                    this.timbreB.rawData = this.timbreA.rawData;
                    this.originalSnapshotB = this.timbreB.clone();
                    this.showNotification(`Copied Part A "${this.timbreA.name}" to Part B`, 'success');
                } else {
                    this.timbreA.rawData = this.timbreB.rawData;
                    this.originalSnapshotA = this.timbreA.clone();
                    this.showNotification(`Copied Part B "${this.timbreB.name}" to Part A`, 'success');
                }
                this.refreshEditorControls();
                if (this.tabSync) {
                    const targetTimbre = targetSlot === 1 ? this.timbreB : this.timbreA;
                    this.tabSync.broadcast('PATCH_LOADED', {
                        slot: targetSlot,
                        rawData: Array.from(targetTimbre.rawData),
                        source: 'copy'
                    });
                }
            };
        }
    }

    _openDialog(dialogId, setupFn = null) {
        if (typeof document === 'undefined') return Promise.resolve(null);
        const dialog = document.getElementById(dialogId);
        if (!dialog || typeof dialog.showModal !== 'function' || dialog.open) {
            return Promise.resolve(null);
        }
        if (setupFn) setupFn(dialog);

        return new Promise((resolve) => {
            const onClose = () => {
                dialog.removeEventListener('close', onClose);
                resolve(dialog.returnValue || null);
            };
            dialog.addEventListener('close', onClose);
            try {
                dialog.showModal();
            } catch (e) {
                dialog.removeEventListener('close', onClose);
                resolve(null);
            }
        });
    }

    _sendActiveProgramToHardware() {
        try {
            this.midi.sendProgram(this.activeTimbre, this.activeSlot, true);
            if (this.activeSlot === 0) {
                this.originalSnapshotA = this.activeTimbre.clone();
            } else {
                this.originalSnapshotB = this.activeTimbre.clone();
            }
            this.undoStack = [];
            this.redoStack = [];
            this.updateUndoRedoUI();
            this.updateSyncStatus('synced');
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

    promptSyncAction({ title, description, fetchDetail, pushDetail, ignoreLabel = 'Ignore' } = {}) {
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
        });
    }

    async promptReconnectSync({ isReconnect = true, portName = '' } = {}) {
        if (typeof document === 'undefined') return;
        if (this._isPromptingSync) return;
        this._isPromptingSync = true;

        const portSuffix = portName ? ` (${portName})` : '';
        const choice = await this.promptSyncAction({
            title: isReconnect ? '🔄 MicroMonsta 2 Reconnected' : '🔌 MicroMonsta 2 Connected',
            description: isReconnect
                ? `Communication with your MicroMonsta 2 synthesizer${portSuffix} has been restored. Choose whether to fetch parameters from the hardware, push this editor's parameters to the synth, or ignore:`
                : `Connected to your MicroMonsta 2 synthesizer${portSuffix}. Choose whether to fetch parameters from the hardware, push this editor's parameters to the synth, or ignore:`,
            fetchDetail: 'Reads active edit buffer settings from the synth hardware into Part A and Part B.',
            pushDetail: 'Transmits current patch parameters in the editor to the synth hardware.'
        });

        if (choice === 'fetch') {
            this.fetchActiveProgram(0, { probe: 'load' });
        } else if (choice === 'push') {
            this.showNotification('Pushing patch settings from editor to MM2...', 'info');
            this.pushAllPartsToHardware();
            if (this.midi && this.midi.inPort && this.midi.outPort) {
                setTimeout(() => this.midi.probeHardware(2500), 200);
            }
        } else if (choice === 'ignore') {
            if (this.midi && this.midi.inPort && this.midi.outPort) {
                this.midi.probeHardware(2500);
            }
        } else if (choice === null) {
            this.showNotification(isReconnect ? 'MicroMonsta 2 reconnected!' : 'MicroMonsta 2 connected!', 'success');
        }

        setTimeout(() => {
            this._isPromptingSync = false;
        }, 300);
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
            this.updateSyncStatus('synced');
            this.showNotification('Successfully pushed settings to MicroMonsta 2!', 'success');
        } catch (err) {
            this.showNotification('Failed to push settings: ' + err.message, 'error');
        }
    }

    buildLibrarianUI() {
        const bankTabs = document.getElementById('bank-tabs');
        if (!bankTabs) return;

        // Setup Search and Category filters
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

        // Add Bank button
        const btnAddBank = document.getElementById('btn-add-bank');
        if (btnAddBank) {
            btnAddBank.onclick = () => {
                const name = prompt('Enter name for new bank:', `Bank ${this.librarian.banks.length + 1}`);
                if (name) {
                    this.librarian.addBank(name);
                    this.librarian.activeBankIndex = this.librarian.banks.length - 1;
                    this.renderLibrarianBank();
                }
            };
        }

        // Export Bank button
        const btnExportBank = document.getElementById('btn-export-bank');
        if (btnExportBank) {
            btnExportBank.onclick = () => {
                const fwVer = this.midi ? this.midi.effectiveFirmwareVersion : 3;
                const fwId = this.midi && this.midi.detectedFwId !== null ? this.midi.detectedFwId : SYSEX_V2_FW_ID;
                if (!this.librarian.exportBankFile(this.librarian.activeBankIndex, null, fwVer, fwId)) {
                    alert('Current bank is empty.');
                }
            };
        }

        // Import Bank button
        const btnImportBank = document.getElementById('btn-import-bank');
        const bankFileInput = document.getElementById('bank-file-picker');
        if (btnImportBank && bankFileInput) {
            btnImportBank.onclick = () => bankFileInput.click();
            bankFileInput.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                try {
                    const buf = new Uint8Array(await file.arrayBuffer());
                    const msgs = extractSysExMessagesWithMeta(buf);
                    const count = msgs.length;
                    if (count > 0) {
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
                    } else {
                        alert('No valid MicroMonsta 2 SysEx patches found in file.');
                    }
                } catch (err) {
                    alert('Error importing bank: ' + err.message);
                }
                bankFileInput.value = '';
            };
        }

        // Duplicate Management & Condenser tools
        const btnDetectDups = document.getElementById('btn-detect-duplicates');
        if (btnDetectDups) {
            btnDetectDups.onclick = () => this.showDuplicateModal();
        }

        const btnCondense = document.getElementById('btn-condense-bank');
        if (btnCondense) {
            btnCondense.onclick = () => {
                const confirmed = confirm(
                    `Condense "${this.librarian.activeBank.name}"?\n\nThis will remove duplicate patches and consolidate all slots into a clean sequential bank.`
                );
                if (confirmed) {
                    const res = this.librarian.condenseBank(this.librarian.activeBankIndex);
                    this.renderLibrarianBank();
                    this.showNotification(`Bank condensed! Removed ${res.removedDuplicates} duplicate(s). Total: ${res.finalCount} patches.`, 'success');
                }
            };
        }

        // Delete all patches in the current bank
        const btnDeleteAll = document.getElementById('btn-delete-all-patches');
        if (btnDeleteAll) {
            btnDeleteAll.onclick = () => {
                const bank = this.librarian.activeBank;
                if (!bank) return;
                if (bank.length === 0) {
                    this.showNotification(`"${bank.name}" is already empty.`, 'info');
                    return;
                }
                const confirmed = confirm(
                    `Delete all ${bank.length} patches in "${bank.name}"?\n\nThis cannot be undone.`
                );
                if (confirmed) {
                    const removed = this.librarian.clearBank(this.librarian.activeBankIndex);
                    this.renderLibrarianBank();
                    this.showNotification(`Deleted ${removed} patches from "${bank.name}".`, 'success');
                }
            };
        }

        // Rename the bank itself
        const btnRenameBank = document.getElementById('btn-rename-bank');
        if (btnRenameBank) {
            btnRenameBank.onclick = () => this.renameBank();
        }

        // Delete the bank itself
        const btnDeleteBank = document.getElementById('btn-delete-bank');
        if (btnDeleteBank) {
            btnDeleteBank.onclick = () => this.deleteBank();
        }

        // Dumps from MM2 are always appended to the currently selected bank (no separate target toggle)
    }

    renameBank(index = this.librarian.activeBankIndex) {
        const bank = this.librarian.banks[index];
        if (!bank) return;
        const currentName = bank.name;
        const newName = prompt(`Enter new name for bank "${currentName}":`, currentName);
        if (newName === null) return;
        const trimmed = newName.trim();
        if (!trimmed) {
            this.showNotification('Bank name cannot be empty.', 'warning');
            return;
        }
        if (trimmed === currentName) return;

        const ok = this.librarian.renameBank(index, trimmed);
        if (ok) {
            this.renderLibrarianBank();
            this.showNotification(`Renamed bank to "${trimmed}".`, 'success');
        }
    }

    deleteBank(index = this.librarian.activeBankIndex) {
        const bank = this.librarian.banks[index];
        if (!bank) return;
        if (this.librarian.banks.length <= 1) {
            this.showNotification('Cannot delete the only bank. At least one bank is required.', 'warning');
            return;
        }
        const patchNote = bank.length > 0 ? ` and all of its ${bank.length} patch(es)` : '';
        const confirmed = confirm(`Delete bank "${bank.name}"${patchNote}?\n\nThis cannot be undone.`);
        if (confirmed) {
            const bankName = bank.name;
            const ok = this.librarian.removeBank(index);
            if (ok) {
                this.renderLibrarianBank();
                this.showNotification(`Deleted bank "${bankName}".`, 'success');
            }
        }
    }

    renderLibrarianBank() {
        if (typeof document === 'undefined') return;
        const bankTabs = document.getElementById('bank-tabs');
        const progList = document.getElementById('librarian-prog-list');
        const dupBadge = document.getElementById('bank-duplicates-badge');
        const btnRenameBank = document.getElementById('btn-rename-bank');
        const btnDeleteBank = document.getElementById('btn-delete-bank');

        if (!bankTabs || !progList) return;

        if (btnRenameBank) {
            btnRenameBank.disabled = this.librarian.banks.length === 0;
        }

        if (btnDeleteBank) {
            btnDeleteBank.disabled = this.librarian.banks.length <= 1;
        }

        // Render Bank Tabs with Drag-and-Drop Reordering
        bankTabs.innerHTML = '';
        this.librarian.banks.forEach((bank, idx) => {
            const tab = document.createElement('div');
            tab.className = `bank-tab ${idx === this.librarian.activeBankIndex ? 'active' : ''}`;
            tab.setAttribute('draggable', 'true');
            tab.innerHTML = `
                <span class="bank-tab-drag" title="Drag to reorder banks">⋮⋮</span>
                <span class="bank-tab-title">${bank.name}</span>
                <span class="bank-tab-count">(${bank.length})</span>
                ${this.librarian.banks.length > 1 ? `<button class="bank-tab-close" data-index="${idx}" title="Delete bank ${bank.name}">✕</button>` : ''}
            `;

            tab.onclick = () => {
                this.librarian.activeBankIndex = idx;
                this.renderLibrarianBank();
            };

            const tabTitle = tab.querySelector('.bank-tab-title');
            if (tabTitle) {
                tabTitle.title = 'Double-click to rename';
                tabTitle.ondblclick = (e) => {
                    e.stopPropagation();
                    this.renameBank(idx);
                };
            }

            const closeBtn = tab.querySelector('.bank-tab-close');
            if (closeBtn) {
                closeBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.deleteBank(idx);
                };
            }

            // Drag to reorder banks
            tab.ondragstart = (e) => {
                e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'bank-reorder', fromIndex: idx }));
                tab.classList.add('dragging');
            };
            tab.ondragend = () => tab.classList.remove('dragging');
            tab.ondragover = (e) => e.preventDefault();
            tab.ondrop = (e) => {
                e.preventDefault();
                try {
                    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                    if (data.type === 'bank-reorder') {
                        this.librarian.reorderBanks(data.fromIndex, idx);
                        this.renderLibrarianBank();
                    }
                } catch (err) { }
            };

            bankTabs.appendChild(tab);
        });

        const activeBank = this.librarian.activeBank;
        if (!activeBank) return;

        // Detect Duplicates for active bank
        const dupInfo = activeBank.detectDuplicates(true);
        if (dupBadge) {
            if (dupInfo.duplicatesFound > 0) {
                dupBadge.textContent = `${dupInfo.duplicatesFound} Duplicates Found`;
                dupBadge.className = 'badge badge-warning';
                dupBadge.style.display = 'inline-block';
            } else {
                dupBadge.style.display = 'none';
            }
        }

        // Filter programs
        let visiblePrograms = [];
        for (let i = 0; i < activeBank.programs.length; i++) {
            const p = activeBank.programs[i];
            const matchesCat = this.activeCategoryFilter === 'all' || p.category === parseInt(this.activeCategoryFilter, 10);
            const matchesSearch = !this.searchQuery || p.name.toLowerCase().includes(this.searchQuery);
            if (matchesCat && matchesSearch) {
                visiblePrograms.push({ program: p, originalIndex: i });
            }
        }

        // Render Program Table
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

        visiblePrograms.forEach(({ program, originalIndex }) => {
            const row = document.createElement('div');
            const isDup = dupInfo.duplicateIndices.has(originalIndex);
            row.className = `prog-row ${isDup ? 'is-duplicate' : ''}`;
            row.setAttribute('draggable', 'true');

            const catOptions = LOOKUPS.categories.map((cat, cIdx) =>
                `<option value="${cIdx}" ${cIdx === program.category ? 'selected' : ''}>${cat}</option>`
            ).join('');

            row.innerHTML = `
                <div class="prog-drag-handle" title="Drag to reorder or swap">⋮⋮</div>
                <div class="prog-slot-num">#${(originalIndex + 1).toString().padStart(2, '0')}</div>
                <div class="prog-name">${program.name}</div>
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

            // Category change handler
            const catSelect = row.querySelector('.prog-cat-select');
            if (catSelect) {
                catSelect.onclick = (e) => e.stopPropagation();
                catSelect.onmousedown = (e) => e.stopPropagation();
                catSelect.onchange = (e) => {
                    e.stopPropagation();
                    const newCat = parseInt(e.target.value, 10);
                    program.category = newCat;
                    this.librarian.saveAllBanks();

                    // If this patch is loaded in the editor, update the editor category select
                    if (this.timbreA && (this.timbreA.name === program.name || this.timbreA.computeSoundFingerprint() === program.computeSoundFingerprint())) {
                        this.timbreA.category = newCat;
                        if (this.activeSlot === 0) {
                            const edCat = document.getElementById('prog-category-select');
                            if (edCat) edCat.value = newCat;
                        }
                    }
                    if (this.timbreB && (this.timbreB.name === program.name || this.timbreB.computeSoundFingerprint() === program.computeSoundFingerprint())) {
                        this.timbreB.category = newCat;
                        if (this.activeSlot === 1) {
                            const edCat = document.getElementById('prog-category-select');
                            if (edCat) edCat.value = newCat;
                        }
                    }

                    const catLabel = LOOKUPS.categories[newCat] || 'Misc';
                    this.showNotification(`Updated category for "${program.name}" to ${catLabel}`, 'success');
                };
            }

            // Action button handlers
            row.querySelector('[data-action="load-a"]').onclick = () => {
                this.timbreA.rawData = program.rawData;
                this.originalSnapshotA = this.timbreA.clone();
                this.selectPart(0);
                this.switchView('editor');
                this.showNotification(`Loaded "${program.name}" into Part A!`, 'info');
            };

            row.querySelector('[data-action="load-b"]').onclick = () => {
                this.timbreB.rawData = program.rawData;
                this.originalSnapshotB = this.timbreB.clone();
                this.selectPart(1);
                this.switchView('editor');
                this.showNotification(`Loaded "${program.name}" into Part B!`, 'info');
            };

            row.querySelector('[data-action="export"]').onclick = () => {
                const fwVer = this.midi ? this.midi.effectiveFirmwareVersion : 3;
                const fwId = this.midi && this.midi.detectedFwId !== null ? this.midi.detectedFwId : SYSEX_V2_FW_ID;
                this.librarian.exportProgramFile(program, null, fwVer, fwId);
            };

            row.querySelector('[data-action="delete"]').onclick = () => {
                if (confirm(`Delete patch "${program.name}" from ${activeBank.name}?`)) {
                    activeBank.removeProgram(originalIndex);
                    this.librarian.saveAllBanks();
                    this.renderLibrarianBank();
                }
            };

            // Drag-and-Drop Program Reordering & Swapping
            row.ondragstart = (e) => {
                e.dataTransfer.setData('text/plain', JSON.stringify({
                    type: 'prog-move',
                    bankIndex: this.librarian.activeBankIndex,
                    progIndex: originalIndex
                }));
                row.classList.add('dragging');
            };
            row.ondragend = () => row.classList.remove('dragging');
            row.ondragover = (e) => e.preventDefault();
            row.ondrop = (e) => {
                e.preventDefault();
                try {
                    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                    if (data.type === 'prog-move') {
                        if (e.altKey || e.shiftKey) {
                            // Alt-drop: Swap programs!
                            activeBank.swapPrograms(data.progIndex, originalIndex);
                            this.showNotification(`Swapped slot #${data.progIndex + 1} and slot #${originalIndex + 1}`, 'info');
                        } else {
                            // Standard drop: Reorder
                            activeBank.moveProgram(data.progIndex, originalIndex);
                        }
                        this.librarian.saveAllBanks();
                        this.renderLibrarianBank();
                    }
                } catch (err) { }
            };

            progList.appendChild(row);
        });
    }

    showDuplicateModal() {
        const activeBank = this.librarian.activeBank;
        const dupInfo = activeBank.detectDuplicates(true);

        const modal = document.getElementById('duplicate-modal');
        const body = document.getElementById('duplicate-modal-body');
        if (!modal || !body) return;

        body.innerHTML = '';

        if (dupInfo.duplicatesFound === 0) {
            body.innerHTML = `
                <div class="empty-state">
                    <p class="text-success">✓ Clean bank! No duplicate patches detected in "${activeBank.name}".</p>
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
                        <span>Slot #${(index + 1).toString().padStart(2, '0')}: <strong>${program.name}</strong> (${LOOKUPS.categories[program.category]})</span>
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

    buildSettingsUI() {
        const selIn = document.getElementById('settings-midi-in');
        const selOut = document.getElementById('settings-midi-out');
        const selChan = document.getElementById('settings-base-channel');
        const chkSafe = document.getElementById('settings-safe-mode');
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
                    this.showNotification('Web MIDI reconnected successfully!', 'success');
                } else {
                    this.showNotification('Web MIDI connection failed. Check browser permissions.', 'error');
                }
            };
        }

        if (selIn) {
            selIn.onchange = () => {
                const prevPortId = this.midi.inPort ? this.midi.inPort.id : '';
                this.midi.setInputPort(selIn.value);
                if (this.midi.inPort && this.midi.inPort.id !== prevPortId && this.midi.outPort) {
                    this.showNotification(`Testing MIDI Input "${this.midi.inPort.name}"...`, 'info');
                    this.midi.probeHardware(2500);
                }
            };
        }
        if (selOut) {
            selOut.onchange = () => this.midi.setOutputPort(selOut.value);
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

        const chkPeriodic = document.getElementById('settings-periodic-check');
        if (chkPeriodic) {
            chkPeriodic.checked = !!this.midi.periodicCheck;
            chkPeriodic.onchange = () => {
                this.midi.setPeriodicCheck(chkPeriodic.checked);
                if (chkPeriodic.checked) {
                    this.showNotification('Periodic connection checks enabled.', 'info');
                } else {
                    this.showNotification('Periodic connection checks disabled.', 'info');
                }
            };
        }

        const chkTabSync = document.getElementById('settings-tab-sync');
        if (chkTabSync && this.tabSync) {
            chkTabSync.checked = !!this.tabSync.enabled;
            chkTabSync.onchange = () => {
                this.tabSync.setEnabled(chkTabSync.checked);
                if (chkTabSync.checked) {
                    this.showNotification('Cross-tab synchronization enabled.', 'info');
                } else {
                    this.showNotification('Cross-tab synchronization disabled.', 'info');
                }
            };
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

    applyRemoteParamChange(key, val, slot = 0) {
        const targetTimbre = (slot === 1) ? this.timbreB : this.timbreA;
        targetTimbre.setValue(key, val);

        if (slot === this.activeSlot) {
            this.refreshVisualizerFor(key);

            const oscMatch = key.match(/^OSC(\d)_/);
            const envMatch = key.match(/^ENV(\d)_/);
            let envNum = envMatch ? parseInt(envMatch[1], 10) : 0;
            if (!envNum && (key === 'ENV1_VCA_VEL_SENS' || key === 'ENV1_RESET')) envNum = 1;
            if (!envNum && (key === 'ENV2_FLT_VEL_SENS' || key === 'ENV2_RESET')) envNum = 2;
            if (!envNum && key === 'ENV3_RESET') envNum = 3;

            if (typeof document !== 'undefined') {
                if (oscMatch) {
                    const oscCard = document.querySelector('.osc-unified-card');
                    if (oscCard && oscCard.refresh) oscCard.refresh();
                }
                if (envNum) {
                    const envCard = document.querySelector('.env-unified-card');
                    if (envCard && envCard.refresh) envCard.refresh();
                }

                const el = (this._paramControlMap && this._paramControlMap.get(key)) ||
                    document.querySelector(`.editor-grid [data-param="${key}"], #prog-tempo-container [data-param="${key}"]`);
                if (el && el.refresh) {
                    el.refresh();
                }
            }
        }
    }

    applyRemoteMetaChange(slot, name, category) {
        const targetTimbre = (slot === 1) ? this.timbreB : this.timbreA;
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
        const targetTimbre = (slot === 1) ? this.timbreB : this.timbreA;
        const bytes = (rawData instanceof Uint8Array) ? rawData : new Uint8Array(rawData);
        targetTimbre.rawData = bytes;

        if (slot === 1) {
            this.originalSnapshotB = this.timbreB.clone();
        } else {
            this.originalSnapshotA = this.timbreA.clone();
        }

        if (slot === this.activeSlot) {
            this.undoStack = [];
            this.redoStack = [];
            this.updateUndoRedoUI();
            this.updateSyncStatus('synced');
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

    applyRemoteLiveSync(enabled) {
        this._setLiveSyncState(enabled, { broadcast: false });
        this.updateSyncStatus(enabled && this.isConnectionGood ? 'synced' : 'modified');
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
        this.updateSyncStatus('synced');
        this.refreshEditorControls();
        this.updateActivePartIndicator();
        this.updateConnectionStatus();
        this.showNotification('Synchronized settings from leader window', 'info');
    }

    updateSettingsPortLists() {
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

    buildAuditionUI() {
        const container = document.getElementById('audition-toolbar-container');
        if (!container) return;
        container.innerHTML = '';
        container.appendChild(createKeyboard(this.midi, () => this.activeTimbre));
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
