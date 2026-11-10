/**
 * Main Application Controller for MicroMonsta 2 HTML Editor and Patch Librarian
 */

class App {
    constructor() {
        this.midi = new MidiManager();
        this.librarian = new PatchLibrarian();

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
            } catch (e) {}
        }

        // Live Editing, History & Compare State
        this.undoStack = [];
        this.redoStack = [];
        this.maxHistory = 50;
        this.originalSnapshotA = this.timbreA.clone();
        this.originalSnapshotB = this.timbreB.clone();
        this.isComparing = false;
        this.compareSavedProgram = null;

        // Sound Design Solo & Mute States & Active Oscillator Tab
        this.selectedOsc = 1; // Active oscillator tab (1, 2, or 3)
        this.soloState = { osc1: false, osc2: false, osc3: false, noise: false };
        this.muteState = { osc1: false, osc2: false, osc3: false, noise: false };
        this.savedMixerLevels = null;
        this.syncStatus = 'synced'; // 'synced' | 'modified' | 'streaming' | 'fetching'

        this.bindEvents();
    }

    get activeTimbre() {
        return this.activeSlot === 0 ? this.timbreA : this.timbreB;
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
            this.showNotification(`MM2 detected on ${inPort.name}. Loading Patch A settings...`, 'info');
            this.fetchActiveProgram(0);
            if (this.synthTimbralMode !== 'monotimbral') {
                setTimeout(() => this.fetchActiveProgram(1), 400);
            }
        });

        // MIDI Event Listeners
        this.midi.on('program-received', ({ program, slot }) => {
            clearTimeout(this._fetchTimeout);
            console.log(`Captured program from MM2: "${program.name}" for slot ${slot}`);
            if (slot === 1) {
                this.timbreB.rawData = program.rawData;
                this.originalSnapshotB = this.timbreB.clone();
                if (this.synthTimbralMode === 'monotimbral') {
                    this.setTimbralMode('bitimbral');
                }
            } else {
                this.timbreA.rawData = program.rawData;
                this.originalSnapshotA = this.timbreA.clone();
            }
            this.undoStack = [];
            this.redoStack = [];
            this.updateUndoRedoUI();
            // When loading Editor or working in Editor, do not add patch to Librarian!
            // Only capture if user is in Librarian view and has designated a receiving bank target
            if (this.currentView === 'librarian' && this.librarian.receivingBankIndex >= 0) {
                this.librarian.handleIncomingProgram(program);
            }
            this.refreshEditorControls();
            this.updateActivePartIndicator();
            this.updateSyncStatus('synced');
            this.showNotification(`Loaded MM2 hardware Patch ${slot === 1 ? 'B' : 'A'} ("${program.name}")`, 'success');
        });

        this.midi.on('port-change', () => {
            this.updateConnectionStatus();
            this.updateSettingsPortLists();
            this.updateMidiPermissionUI();
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

                if (typeof document !== 'undefined') {
                    if (oscMatch) {
                        const oscCard = document.querySelector('.osc-unified-card');
                        if (oscCard && oscCard.refresh) oscCard.refresh();
                    }

                    // Refresh the specific control in the UI
                    const el = document.querySelector(`.editor-grid [data-param="${paramKey}"], #prog-tempo-container [data-param="${paramKey}"]`);
                    if (el && el.refresh) {
                        el.refresh();
                    }

                    if (paramKey === 'ARP_PTN_LENGTH') this.refreshVisualizerFor(paramKey);

                    // Refresh visualizers if affected
                    if (paramKey.startsWith('ENV')) {
                        const envNum = paramKey.charAt(3);
                        const viz = document.querySelector(`.adsr-visualizer[data-env="${envNum}"]`);
                        if (viz && viz.refresh) viz.refresh();
                    } else if (paramKey.startsWith('FILTER_') || paramKey === 'DRIVE_VOICE') {
                        const viz = document.querySelector('.filter-visualizer');
                        if (viz && viz.refresh) viz.refresh();
                    } else if (paramKey.startsWith('LFO')) {
                        const lfoNum = paramKey.charAt(3);
                        const viz = document.querySelector(`.lfo-visualizer[data-lfo="${lfoNum}"]`);
                        if (viz && viz.refresh) viz.refresh();
                    }

                    this.updateSyncStatus('synced');
                }
            }
        });

        this.midi.on('connection-lost', ({ port, type }) => {
            const name = (port && port.name) ? port.name : 'MicroMonsta 2';
            this.showNotification(`⚠️ MIDI Connection Lost: ${name} (${type}) disconnected. Reconnecting automatically when plugged back in...`, 'warning');
            this.updateConnectionStatus();
            this.updateSettingsPortLists();
        });

        this.midi.on('connection-restored', ({ port, type }) => {
            const name = (port && port.name) ? port.name : 'MicroMonsta 2';
            this.showNotification(`✓ MIDI Connection Restored: ${name} (${type})`, 'success');
            this.updateConnectionStatus();
            this.updateSettingsPortLists();
        });

        this.midi.on('error', (err) => {
            this.showNotification(err, 'error');
            this.updateMidiPermissionUI();
        });

        // Librarian Listeners
        this.librarian.on('update', () => {
            this.renderLibrarianBank();
        });
    }

    updateConnectionStatus() {
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
            dot.className = 'status-dot connected';
            text.textContent = `Connected: ${outName}`;
            text.title = `In: ${inName}\nOut: ${outName}`;
        } else if (this.midi.inPort || this.midi.outPort) {
            dot.className = 'status-dot partial';
            text.textContent = `Partial: ${outName || inName}`;
        } else {
            dot.className = 'status-dot disconnected';
            text.textContent = 'Disconnected (Click to setup)';
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
            } catch (e) {}
        }
        if (mode === 'monotimbral' && this.activeSlot !== 0) {
            this.selectPart(0);
        }
        this.updateTimbralModeUI();
    }

    updateTimbralModeUI() {
        if (typeof document === 'undefined') return;
        const isMono = this.synthTimbralMode === 'monotimbral';
        const btnPartB = document.getElementById('btn-part-b');
        const btnCopyOther = document.getElementById('btn-prog-copy-other');
        const modeIndicator = document.getElementById('synth-mode-indicator');

        if (modeIndicator) {
            const labels = {
                monotimbral: 'Monotimbral (12V)',
                bitimbral: 'Bitimbral (6+6V)',
                combi: 'Combi'
            };
            modeIndicator.textContent = labels[this.synthTimbralMode] || 'Monotimbral (12V)';
            modeIndicator.className = `mode-indicator-badge mode-${this.synthTimbralMode}`;
            modeIndicator.title = 'Synth Timbral Mode (Display Only — must be adjusted on MM2 hardware)';
        }

        if (btnPartB) {
            btnPartB.style.display = isMono ? 'none' : 'inline-block';
        }
        if (btnCopyOther) {
            // When in monotimbral mode, Copy A/B settings should be hidden!
            btnCopyOther.style.display = isMono ? 'none' : 'inline-flex';
        }

        this.updateActivePartIndicator();
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
        this.buildEditorUI();
        this.updateActivePartIndicator();
    }

    onParameterChanged(key, val, recordUndo = true) {
        if (this.isComparing) {
            this.toggleCompare(false);
        }

        if (recordUndo) {
            const prevVal = this.activeTimbre.getValue(key);
            if (prevVal !== val) {
                this.recordUndo(key, prevVal, val);
            }
        }
        this.activeTimbre.setValue(key, val);
        this.refreshVisualizerFor(key);

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

    recordUndo(key, prevVal, newVal) {
        if (prevVal === newVal) return;
        this.undoStack.push({ key, prevVal, newVal, slot: this.activeSlot });
        if (this.undoStack.length > this.maxHistory) {
            this.undoStack.shift();
        }
        this.redoStack = [];
        this.updateUndoRedoUI();
    }

    undo() {
        if (this.undoStack.length === 0) return;
        const action = this.undoStack.pop();
        this.redoStack.push(action);

        if (this.activeSlot !== action.slot) {
            this.selectPart(action.slot);
        }

        this.activeTimbre.setValue(action.key, action.prevVal);
        if (this.midi.liveSync) {
            this.midi.sendParameter(action.key, action.prevVal);
        }
        this.refreshEditorControls();
        this.updateUndoRedoUI();
        this.showNotification(`Undo: ${action.key}`, 'info');
    }

    redo() {
        if (this.redoStack.length === 0) return;
        const action = this.redoStack.pop();
        this.undoStack.push(action);

        if (this.activeSlot !== action.slot) {
            this.selectPart(action.slot);
        }

        this.activeTimbre.setValue(action.key, action.newVal);
        if (this.midi.liveSync) {
            this.midi.sendParameter(action.key, action.newVal);
        }
        this.refreshEditorControls();
        this.updateUndoRedoUI();
        this.showNotification(`Redo: ${action.key}`, 'info');
    }

    updateUndoRedoUI() {
        if (typeof document === 'undefined') return;
        const btnUndo = document.getElementById('btn-prog-undo');
        const btnRedo = document.getElementById('btn-prog-redo');
        if (btnUndo) btnUndo.disabled = this.undoStack.length === 0;
        if (btnRedo) btnRedo.disabled = this.redoStack.length === 0;
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
        }
    }

    fetchActiveProgram(targetSlot = this.activeSlot) {
        if (!this.midi.outPort) {
            this.showNotification('No MIDI Output port selected. Open Settings to connect.', 'error');
            this.switchView('settings');
            return;
        }
        this.updateSyncStatus('fetching');
        const slot = targetSlot;

        // Clear existing fetch timer and set a 3.0s fallback timeout
        clearTimeout(this._fetchTimeout);
        this._fetchTimeout = setTimeout(() => {
            if (this.syncStatus === 'fetching') {
                this.updateSyncStatus(this.midi.liveSync ? 'synced' : 'modified');
                this.showNotification(`Fetch timed out: No response from MM2 on ${this.midi.outPort.name}. Check MIDI cable connections.`, 'warning');
            }
        }, 3000);

        this.midi.fetchProgram(slot);
        this.showNotification(`Fetching Part ${slot === 0 ? 'A' : 'B'} from MicroMonsta 2...`, 'info');
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

        this.updateActivePartIndicator();
        this.updateTimbralModeUI();
        this.updateUndoRedoUI();
    }

    createOscillatorPanel(timbre, onChange) {
        if (typeof document === 'undefined') return { card: null };

        const card = document.createElement('div');
        card.className = 'synth-card osc-unified-card';
        card.setAttribute('data-section-type', 'osc');
        card.setAttribute('data-section-index', this.selectedOsc);

        const head = document.createElement('div');
        head.className = 'synth-card-header';

        // Title Group with Drag Handle
        const titleGroup = document.createElement('div');
        titleGroup.className = 'card-title-group';
        titleGroup.setAttribute('draggable', 'true');
        titleGroup.title = 'Drag active oscillator settings to another section';

        const dragHandle = document.createElement('span');
        dragHandle.className = 'card-drag-handle';
        dragHandle.textContent = '⋮⋮';

        const titleText = document.createElement('span');
        titleText.className = 'card-title-text';
        titleText.textContent = 'Oscillator';

        titleGroup.appendChild(dragHandle);
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

            // Drag-and-drop drop target to copy directly between oscillators
            btn.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                btn.classList.add('tab-drop-hover');
            });
            btn.addEventListener('dragleave', (e) => {
                e.stopPropagation();
                btn.classList.remove('tab-drop-hover');
            });
            btn.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                btn.classList.remove('tab-drop-hover');
                try {
                    const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                    if (data && data.kind === 'section' && data.sectionType === 'osc') {
                        copySection('osc', data.sectionIndex, 'osc', i, timbre(), onChange);
                        card.refresh();
                        this.showNotification(`Copied Osc ${data.sectionIndex} to Osc ${i}`, 'success');
                    }
                } catch (err) {}
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
                <div class="menu-item" data-action="copy">📋 Copy Osc ${card.getAttribute('data-section-index')}</div>
                <div class="menu-item ${canPaste ? '' : 'disabled'}" data-action="paste">📥 Paste Section</div>
                <div class="menu-item" data-action="reset">↺ Reset to Defaults</div>
                <div class="menu-item" data-action="randomize">🎲 Smart Randomize</div>
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

        // Drag start on header title
        titleGroup.addEventListener('dragstart', (e) => {
            const curIdx = parseInt(card.getAttribute('data-section-index'), 10) || 1;
            e.dataTransfer.setData('text/plain', JSON.stringify({
                kind: 'section',
                sectionType: 'osc',
                sectionIndex: curIdx
            }));
            card.classList.add('is-dragging');
        });

        titleGroup.addEventListener('dragend', () => {
            card.classList.remove('is-dragging');
        });

        card.appendChild(head);

        // Body with Panes
        const body = document.createElement('div');
        body.className = 'synth-card-body';

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

        // Global Oscillator Phase Reset setting at the footer
        const footer = document.createElement('div');
        footer.className = 'osc-footer-strip';
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

    buildEditorUI() {
        if (typeof document === 'undefined') return;
        const grid = document.getElementById('editor-grid');
        if (!grid) return;
        grid.innerHTML = '';

        const timbre = () => this.activeTimbre;
        const onChange = (key, val) => this.onParameterChanged(key, val);

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
        // --- ROW 1: SOUND GENERATION (OSCILLATOR 1/2/3) & FILTER ---
        // ========================================================
        const row1 = makeRow('rack-row-1');
        row1.appendChild(this.createOscillatorPanel(timbre, onChange));

        // FILTER & MIXER
        const flt = createSectionCard('Filter & Mixer', 'flt', 1, timbre, onChange, {
            hasSoloMute: true,
            soloMuteLabel: 'Noise',
            onSolo: (s) => { this.soloState.noise = s; this.applySoloMute(); },
            onMute: (m) => { this.muteState.noise = m; this.applySoloMute(); }
        });
        flt.body.appendChild(createFilterCurveVisualizer(timbre));

        const fltSelects = document.createElement('div');
        fltSelects.className = 'select-row';
        fltSelects.appendChild(createSelect('FILTER_ALGO', timbre, onChange));
        fltSelects.appendChild(createSelect('FILTER_CHARACTER', timbre, onChange));
        flt.body.appendChild(fltSelects);

        const fltMainKnobs = document.createElement('div');
        fltMainKnobs.className = 'knob-row flt-main-knobs';
        fltMainKnobs.appendChild(createKnob('FILTER_FREQ', timbre, onChange, { large: true }));
        fltMainKnobs.appendChild(createKnob('FILTER_RESO', timbre, onChange, { large: true }));
        flt.body.appendChild(fltMainKnobs);

        const fltSubKnobs = document.createElement('div');
        fltSubKnobs.className = 'knob-row';
        fltSubKnobs.appendChild(createKnob('FILTER_ENV2', timbre, onChange));
        fltSubKnobs.appendChild(createKnob('FILTER_TRACKING', timbre, onChange));
        fltSubKnobs.appendChild(createKnob('FILTER_FM', timbre, onChange));
        flt.body.appendChild(fltSubKnobs);

        const mixKnobs = document.createElement('div');
        mixKnobs.className = 'knob-row';
        mixKnobs.appendChild(createKnob('MIX_NOISE', timbre, onChange));
        mixKnobs.appendChild(createKnob('DRIVE_VOICE', timbre, onChange));
        mixKnobs.appendChild(createKnob('LAY_MASTER_VOLUME', timbre, onChange));
        flt.body.appendChild(mixKnobs);
        row1.appendChild(flt.card);

        grid.appendChild(row1);

        // ========================================================
        // --- ROW 2: VOICE PERFORMANCE & EFFECTS/PAN ---
        // ========================================================
        const row2 = makeRow('rack-row-2');

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
        vceCard.body.appendChild(vceKnobs1);

        const vceKnobs2 = document.createElement('div');
        vceKnobs2.className = 'knob-row';
        vceKnobs2.appendChild(createKnob('VCE_PBRANGE_DOWN', timbre, onChange));
        vceKnobs2.appendChild(createKnob('VCE_PBRANGE_UP', timbre, onChange));
        vceCard.body.appendChild(vceKnobs2);
        row2.appendChild(vceCard.card);

        // EFFECTS & PAN
        const fxSec = createSectionCard('Effects & Pan', 'fx', 1, timbre, onChange);
        const panRow = document.createElement('div');
        panRow.className = 'pan-strip';
        panRow.appendChild(createSelect('PAN_MODE', timbre, onChange));
        panRow.appendChild(createKnob('VCE_PAN_SPREAD', timbre, onChange));
        panRow.appendChild(createSelect('IFX_CHORUS', timbre, onChange));
        fxSec.body.appendChild(panRow);

        const fxPanels = document.createElement('div');
        fxPanels.className = 'fx-panels-row';

        // Delay
        const dlyBox = document.createElement('div');
        dlyBox.className = 'fx-sub-panel';
        dlyBox.innerHTML = '<div class="fx-sub-title">Delay</div>';
        dlyBox.appendChild(createSelect('DLY_TYPE', timbre, onChange));
        const dlyKnobs = document.createElement('div');
        dlyKnobs.className = 'knob-row';
        dlyKnobs.appendChild(createKnob('DLY_PARAM1', timbre, onChange));
        dlyKnobs.appendChild(createKnob('DLY_PARAM2', timbre, onChange));
        dlyKnobs.appendChild(createKnob('DLY_PARAM3', timbre, onChange));
        dlyBox.appendChild(dlyKnobs);
        fxPanels.appendChild(dlyBox);

        // Reverb
        const revBox = document.createElement('div');
        revBox.className = 'fx-sub-panel';
        revBox.innerHTML = '<div class="fx-sub-title">Reverb</div>';
        const revKnobs = document.createElement('div');
        revKnobs.className = 'knob-row';
        revKnobs.appendChild(createKnob('REV_PARAM1', timbre, onChange));
        revKnobs.appendChild(createKnob('REV_PARAM2', timbre, onChange));
        revKnobs.appendChild(createKnob('REV_PARAM3', timbre, onChange));
        revBox.appendChild(revKnobs);
        fxPanels.appendChild(revBox);

        fxSec.body.appendChild(fxPanels);

        const eqRow = document.createElement('div');
        eqRow.className = 'knob-row';
        eqRow.appendChild(createKnob('IFX_EQ', timbre, onChange));
        eqRow.appendChild(createKnob('MORPH_KNOB', timbre, onChange));
        fxSec.body.appendChild(eqRow);

        row2.appendChild(fxSec.card);
        grid.appendChild(row2);

        // ========================================================
        // --- ROW 3: MODULATION MATRIX (12 SLOTS) & MACRO KNOBS ---
        // ========================================================
        const row3 = makeRow('rack-row-3');

        // Matrix
        const mtxSec = createSectionCard('Modulation Matrix (12 Slots)', 'mtx_group', 1, timbre, onChange);
        const mtxGrid = document.createElement('div');
        mtxGrid.className = 'matrix-grid-monsta';

        for (let m = 1; m <= 12; m++) {
            const slotBox = document.createElement('div');
            slotBox.className = 'matrix-slot';

            const slotHead = document.createElement('div');
            slotHead.className = 'matrix-slot-head';

            const slotTitle = document.createElement('span');
            slotTitle.className = 'matrix-slot-title';
            slotTitle.textContent = `Slot ${m}`;

            const btnClear = document.createElement('button');
            btnClear.className = 'btn-clear-slot';
            btnClear.title = 'Clear this matrix routing';
            btnClear.textContent = '✕';
            btnClear.onclick = () => {
                timbre.setValue(`MTX${m}_SRC`, 0);
                timbre.setValue(`MTX${m}_DST`, 0);
                timbre.setValue(`MTX${m}_AMT`, 128); // 0 bipolar
                onChange(`MTX${m}_SRC`, 0);
                onChange(`MTX${m}_DST`, 0);
                onChange(`MTX${m}_AMT`, 128);
                slotBox.querySelectorAll('[data-param]').forEach(el => el.refresh && el.refresh());
            };

            slotHead.appendChild(slotTitle);
            slotHead.appendChild(btnClear);
            slotBox.appendChild(slotHead);

            const slotContent = document.createElement('div');
            slotContent.className = 'matrix-slot-content';

            const selBox = document.createElement('div');
            selBox.className = 'matrix-selects';
            selBox.appendChild(createSelect(`MTX${m}_SRC`, timbre, onChange));
            selBox.appendChild(createSelect(`MTX${m}_DST`, timbre, onChange));

            slotContent.appendChild(selBox);
            slotContent.appendChild(createKnob(`MTX${m}_AMT`, timbre, onChange, { small: true }));
            slotBox.appendChild(slotContent);
            mtxGrid.appendChild(slotBox);
        }
        mtxSec.body.appendChild(mtxGrid);
        row3.appendChild(mtxSec.card);

        // Hardware Macro Knobs & Encoder Assignments
        const macroSec = makeSection('Hardware Knobs & Macro Assignments');
        const macroRow = document.createElement('div');
        macroRow.className = 'macro-grid';

        const potGroup = document.createElement('div');
        potGroup.className = 'macro-group';
        potGroup.innerHTML = '<div class="macro-group-title">Physical Pots (F, Q, M)</div>';
        const potSelects = document.createElement('div');
        potSelects.className = 'select-row';
        potSelects.appendChild(createSelect('LAY_POT1_ASSIGN', timbre, onChange));
        potSelects.appendChild(createSelect('LAY_POT2_ASSIGN', timbre, onChange));
        potSelects.appendChild(createSelect('LAY_POT3_ASSIGN', timbre, onChange));
        potGroup.appendChild(potSelects);
        macroRow.appendChild(potGroup);

        const encGroup = document.createElement('div');
        encGroup.className = 'macro-group';
        encGroup.innerHTML = '<div class="macro-group-title">Display Encoders (1–4)</div>';
        const encSelects = document.createElement('div');
        encSelects.className = 'select-row';
        encSelects.appendChild(createSelect('LAY_ENC1_ASSIGN', timbre, onChange));
        encSelects.appendChild(createSelect('LAY_ENC2_ASSIGN', timbre, onChange));
        encSelects.appendChild(createSelect('LAY_ENC3_ASSIGN', timbre, onChange));
        encSelects.appendChild(createSelect('LAY_ENC4_ASSIGN', timbre, onChange));
        encGroup.appendChild(encSelects);
        macroRow.appendChild(encGroup);

        macroSec.body.appendChild(macroRow);
        row3.appendChild(macroSec.card);

        grid.appendChild(row3);

        // ========================================================
        // --- ROW 4: ENVELOPES (1-3), LFOS (1-3), MATH OPERATORS ---
        // ========================================================
        const row4 = makeRow('rack-row-4');

        // Envelopes Group Card
        const envGroupCard = makeSection('Envelopes (1–3)');
        const envGrid = document.createElement('div');
        envGrid.className = 'env-multi-grid';

        for (let e = 1; e <= 3; e++) {
            const isAmp = e === 1;
            const isFlt = e === 2;
            const title = isAmp ? 'Env 1 (Amp / VCA)' : (isFlt ? 'Env 2 (Filter)' : 'Env 3 (Modulation)');
            const subEnv = createSectionCard(title, 'env', e, timbre, onChange, { className: 'env-sub-card' });
            subEnv.body.appendChild(createADSRVisualizer(e, timbre));

            const eKnobs = document.createElement('div');
            eKnobs.className = 'knob-row';
            eKnobs.appendChild(createKnob(`ENV${e}_ATK`, timbre, onChange));
            eKnobs.appendChild(createKnob(`ENV${e}_DCY`, timbre, onChange));
            eKnobs.appendChild(createKnob(`ENV${e}_SUS`, timbre, onChange));
            eKnobs.appendChild(createKnob(`ENV${e}_REL`, timbre, onChange));
            if (isAmp) eKnobs.appendChild(createKnob('ENV1_VCA_VEL_SENS', timbre, onChange));
            if (isFlt) eKnobs.appendChild(createKnob('ENV2_FLT_VEL_SENS', timbre, onChange));
            subEnv.body.appendChild(eKnobs);

            subEnv.body.appendChild(createSelect(`ENV${e}_RESET`, timbre, onChange));
            envGrid.appendChild(subEnv.card);
        }
        envGroupCard.body.appendChild(envGrid);
        row4.appendChild(envGroupCard.card);

        // LFOs Group Card
        const lfoGroupCard = makeSection('Low Frequency Oscillators (1–3)');
        const lfoGrid = document.createElement('div');
        lfoGrid.className = 'lfo-multi-grid';

        for (let l = 1; l <= 3; l++) {
            const subLfo = createSectionCard(`LFO ${l}`, 'lfo', l, timbre, onChange, { className: 'lfo-sub-card' });
            subLfo.body.appendChild(createLFOWaveformPreview(l, timbre));

            const lfoSels = document.createElement('div');
            lfoSels.className = 'select-row';
            lfoSels.appendChild(createSelect(`LFO${l}_WAVE`, timbre, onChange));
            lfoSels.appendChild(createSelect(`LFO${l}_MODE`, timbre, onChange));
            subLfo.body.appendChild(lfoSels);

            const lfoKnobs = document.createElement('div');
            lfoKnobs.className = 'knob-row';
            lfoKnobs.appendChild(createKnob(`LFO${l}_SPEED`, timbre, onChange));
            subLfo.body.appendChild(lfoKnobs);

            lfoGrid.appendChild(subLfo.card);
        }
        lfoGroupCard.body.appendChild(lfoGrid);
        row4.appendChild(lfoGroupCard.card);

        // Math Operators Card
        const mathSec = makeSection('Math Operators (Lag & Multipliers)');
        const mathGrid = document.createElement('div');
        mathGrid.className = 'math-operators-grid';

        // Lag Generator
        const lagBox = document.createElement('div');
        lagBox.className = 'math-sub-panel';
        lagBox.innerHTML = '<div class="fx-sub-title">Lag Generator (Portamento/Glide)</div>';
        lagBox.appendChild(createSelect('LAG_SRC1', timbre, onChange));
        const lagKnobs = document.createElement('div');
        lagKnobs.className = 'knob-row';
        lagKnobs.appendChild(createKnob('LAG_AMT1', timbre, onChange));
        lagBox.appendChild(lagKnobs);
        mathGrid.appendChild(lagBox);

        // Multipliers 1 & 2
        const mult1Box = document.createElement('div');
        mult1Box.className = 'math-sub-panel';
        mult1Box.innerHTML = '<div class="fx-sub-title">Multiplier 1 (Src A × Src B)</div>';
        const mult1Sels = document.createElement('div');
        mult1Sels.className = 'select-row';
        mult1Sels.appendChild(createSelect('MULT_A1', timbre, onChange));
        mult1Sels.appendChild(createSelect('MULT_B1', timbre, onChange));
        mult1Box.appendChild(mult1Sels);
        mathGrid.appendChild(mult1Box);

        const mult2Box = document.createElement('div');
        mult2Box.className = 'math-sub-panel';
        mult2Box.innerHTML = '<div class="fx-sub-title">Multiplier 2 (Src A × Src B)</div>';
        const mult2Sels = document.createElement('div');
        mult2Sels.className = 'select-row';
        mult2Sels.appendChild(createSelect('MULT_A2', timbre, onChange));
        mult2Sels.appendChild(createSelect('MULT_B2', timbre, onChange));
        mult2Box.appendChild(mult2Sels);
        mathGrid.appendChild(mult2Box);

        mathSec.body.appendChild(mathGrid);
        row4.appendChild(mathSec.card);

        grid.appendChild(row4);

        // ========================================================
        // --- ROW 5: ARPEGGIATOR & CHORDER ENGINES ---
        // ========================================================
        const row5 = makeRow('rack-row-5');

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
        arpModStack.appendChild(createSelect('ARP_STEPSEQ_DEST', timbre, onChange));
        arpModStack.appendChild(createSelect('ARP_STEPSEQ_POLARITY', timbre, onChange));
        arpControlsRow.appendChild(arpModStack);
        arpSec.body.appendChild(arpControlsRow);

        const arpSeq = createArpSequencer(timbre, onChange);
        arpSeq.id = 'arp-seq-wrapper';
        arpSec.body.appendChild(arpSeq);
        row5.appendChild(arpSec.card);

        // FW v3 Scaler & Chorder Engine
        const chordSec = makeSection('FW v3 Chorder & Scaler Engine');
        const chordTopRow = document.createElement('div');
        chordTopRow.className = 'chord-top-row';
        chordTopRow.appendChild(createSelect('KBD_MIDI_INPUT', timbre, onChange));
        chordTopRow.appendChild(createSelect('KBD_KEY', timbre, onChange));
        chordTopRow.appendChild(createSelect('KBD_SCALE', timbre, onChange));
        chordTopRow.appendChild(createKnob('KBD_OCTAVE', timbre, onChange));
        chordTopRow.appendChild(createSelect('KBD_CHORD_EXPAND', timbre, onChange));
        chordSec.body.appendChild(chordTopRow);

        const chordDegreesBox = document.createElement('div');
        chordDegreesBox.className = 'chord-degrees-grid';
        chordDegreesBox.innerHTML = '<div class="chord-degrees-title">Scale Degree Chords (Degree 1 = Base Chord; Degrees 2–7 require Chord Expand)</div>';
        const degreesRow = document.createElement('div');
        degreesRow.className = 'select-row chord-degrees-row';
        for (let d = 1; d <= 7; d++) {
            degreesRow.appendChild(createSelect(`CHORD_TYPE${d}`, timbre, onChange));
        }
        chordDegreesBox.appendChild(degreesRow);
        chordSec.body.appendChild(chordDegreesBox);
        row5.appendChild(chordSec.card);

        grid.appendChild(row5);

        // Hook up Program Bar controls
        this.setupProgramBar();
    }

    setupProgramBar() {
        const nameInput = document.getElementById('prog-name-input');
        if (nameInput) {
            nameInput.value = this.activeTimbre.name;
            nameInput.onchange = () => {
                this.activeTimbre.name = nameInput.value;
                this.onParameterChanged('LAY_NAME_1', 0); // triggers sync
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
            };
        }

        // Program Tempo Knob in header bar
        const tempoContainer = document.getElementById('prog-tempo-container');
        if (tempoContainer) {
            tempoContainer.innerHTML = '';
            const tempoKnob = createKnob('LAY_TEMPO', () => this.activeTimbre, (k, v) => this.onParameterChanged(k, v), { small: true });
            tempoContainer.appendChild(tempoKnob);
        }

        // Live Sync switch on program bar
        const chkLiveSync = document.getElementById('chk-prog-live-sync');
        if (chkLiveSync) {
            chkLiveSync.checked = this.midi.liveSync;
            chkLiveSync.onchange = () => {
                if (chkLiveSync.checked) {
                    const dialog = document.getElementById('live-sync-dialog');
                    if (dialog && typeof dialog.showModal === 'function') {
                        chkLiveSync.checked = false; // Stay unchecked until choice confirmed
                        const onClose = () => {
                            dialog.removeEventListener('close', onClose);
                            const choice = dialog.returnValue;
                            if (choice === 'fetch') {
                                this.midi.liveSync = true;
                                chkLiveSync.checked = true;
                                this.midi.saveSettings();
                                this.fetchActiveProgram();
                                this.showNotification('Live Sync ENABLED (Fetched MM2 hardware settings)', 'success');
                            } else if (choice === 'push') {
                                this.midi.liveSync = true;
                                chkLiveSync.checked = true;
                                this.midi.saveSettings();
                                this.confirmAndSendProgram();
                                this.showNotification('Live Sync ENABLED (Pushed patch to MM2)', 'success');
                            } else {
                                this.midi.liveSync = false;
                                chkLiveSync.checked = false;
                                this.midi.saveSettings();
                            }
                        };
                        dialog.addEventListener('close', onClose);
                        dialog.showModal();
                    } else {
                        // Fallback if dialog.showModal not supported
                        this.midi.liveSync = true;
                        this.midi.saveSettings();
                        this.updateSyncStatus('synced');
                    }
                } else {
                    this.midi.liveSync = false;
                    this.midi.saveSettings();
                    this.updateSyncStatus('modified');
                    this.showNotification('Live Parameter Sync DISABLED (Staged Commit)', 'info');
                }
            };
        }

        // Hardware Fetch Button
        const btnFetch = document.getElementById('btn-prog-fetch');
        if (btnFetch) {
            btnFetch.onclick = () => this.fetchActiveProgram();
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

        // Compare Button
        const btnCompare = document.getElementById('btn-prog-compare');
        if (btnCompare) {
            btnCompare.onclick = () => this.toggleCompare();
        }

        // Program action buttons
        const btnInit = document.getElementById('btn-prog-init');
        if (btnInit) {
            btnInit.onclick = () => {
                if (confirm(`Reset Part ${this.activeSlot === 0 ? 'A' : 'B'} (${this.activeTimbre.name}) to default INIT values?`)) {
                    this.activeTimbre.rawData = new MM2Program().rawData;
                    if (this.activeSlot === 0) {
                        this.originalSnapshotA = this.activeTimbre.clone();
                    } else {
                        this.originalSnapshotB = this.activeTimbre.clone();
                    }
                    this.undoStack = [];
                    this.redoStack = [];
                    this.updateUndoRedoUI();
                    this.updateSyncStatus('modified');
                    this.refreshEditorControls();
                    this.showNotification('Program initialized to defaults.', 'info');
                }
            };
        }

        const btnSave = document.getElementById('btn-prog-save');
        if (btnSave) {
            btnSave.onclick = () => {
                this.librarian.exportProgramFile(this.activeTimbre);
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
                    const msgs = extractSysExMessages(buf);
                    if (msgs.length === 0) {
                        alert('No valid MicroMonsta 2 SysEx program dump found in this file.');
                        return;
                    }
                    this.activeTimbre.rawData = msgs[0];
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
                    this.showNotification(`Loaded program "${this.activeTimbre.name}" from ${file.name}`, 'success');
                } catch (err) {
                    alert('Error loading SysEx file: ' + err.message);
                }
                fileInput.value = '';
            };
        }

        const btnPush = document.getElementById('btn-prog-push');
        if (btnPush) {
            btnPush.onclick = () => this.confirmAndSendProgram();
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
                if (this.activeSlot === 0) {
                    this.timbreB.rawData = this.timbreA.rawData;
                    this.originalSnapshotB = this.timbreB.clone();
                    this.showNotification(`Copied Part A "${this.timbreA.name}" to Part B`, 'success');
                } else {
                    this.timbreA.rawData = this.timbreB.rawData;
                    this.originalSnapshotA = this.timbreA.clone();
                    this.showNotification(`Copied Part B "${this.timbreB.name}" to Part A`, 'success');
                }
                this.buildEditorUI();
            };
        }
    }

    async confirmAndSendProgram() {
        if (!this.midi.outPort) {
            alert('No MIDI Output port is selected. Please open MIDI Settings and select H12MIDI-Pro Port 5.');
            this.switchView('settings');
            return;
        }

        const slotLabel = this.activeSlot === 0 ? 'Layer A' : 'Layer B';
        const progName = this.activeTimbre.name;

        // Strict Confirmation Gate as required by user!
        const confirmed = confirm(
            `Hardware Write Confirmation:\n\nSend program "${progName}" to MicroMonsta 2 (${slotLabel}) via port "${this.midi.outPort.name}"?\n\nThis will update the active edit buffer on the synth.`
        );

        if (!confirmed) return;

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
            this.showNotification(`Successfully sent "${progName}" to MM2 ${slotLabel}!`, 'success');
        } catch (err) {
            alert('Failed to send program: ' + err.message);
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
                if (!this.librarian.exportBankFile(this.librarian.activeBankIndex)) {
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
                    const count = this.librarian.activeBank.loadFromSysEx(buf);
                    if (count > 0) {
                        await this.librarian.saveAllBanks();
                        this.renderLibrarianBank();
                        this.showNotification(`Imported ${count} patches into "${this.librarian.activeBank.name}"`, 'success');
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

        // Mark as auto-capture target toggle
        const chkCapture = document.getElementById('chk-bank-capture-target');
        if (chkCapture) {
            chkCapture.onchange = () => {
                this.librarian.receivingBankIndex = chkCapture.checked ? this.librarian.activeBankIndex : -1;
                this.renderLibrarianBank();
            };
        }
    }

    renderLibrarianBank() {
        if (typeof document === 'undefined') return;
        const bankTabs = document.getElementById('bank-tabs');
        const progList = document.getElementById('librarian-prog-list');
        const chkCapture = document.getElementById('chk-bank-capture-target');
        const dupBadge = document.getElementById('bank-duplicates-badge');

        if (!bankTabs || !progList) return;

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
                ${idx === this.librarian.receivingBankIndex ? '<span class="rec-badge" title="Receiving MM2 Dumps">REC</span>' : ''}
            `;

            tab.onclick = () => {
                this.librarian.activeBankIndex = idx;
                this.renderLibrarianBank();
            };

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
                } catch (err) {}
            };

            bankTabs.appendChild(tab);
        });

        const activeBank = this.librarian.activeBank;
        if (!activeBank) return;

        if (chkCapture) {
            chkCapture.checked = this.librarian.receivingBankIndex === this.librarian.activeBankIndex;
        }

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

            const catName = LOOKUPS.categories[program.category] || 'Misc';

            row.innerHTML = `
                <div class="prog-drag-handle" title="Drag to reorder or swap">⋮⋮</div>
                <div class="prog-slot-num">#${(originalIndex + 1).toString().padStart(2, '0')}</div>
                <div class="prog-name">${program.name}</div>
                <div class="prog-cat-badge">${catName}</div>
                ${isDup ? '<div class="prog-dup-badge" title="Identical sound parameters detected">Duplicate</div>' : ''}
                <div class="prog-actions">
                    <button class="btn btn-sm btn-action" data-action="load-a" title="Load into Part A">Part A</button>
                    <button class="btn btn-sm btn-action" data-action="load-b" title="Load into Part B">Part B</button>
                    <button class="btn btn-sm btn-action" data-action="export" title="Export .syx">Export</button>
                    <button class="btn btn-sm btn-danger" data-action="delete" title="Delete">✕</button>
                </div>
            `;

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
                this.librarian.exportProgramFile(program);
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
                } catch (err) {}
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

        this.updateSettingsPortLists();
        this.updateMidiPermissionUI();

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
            selIn.onchange = () => this.midi.setInputPort(selIn.value);
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
        container.appendChild(createKeyboard(this.midi));
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
