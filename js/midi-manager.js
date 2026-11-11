/**
 * Web MIDI API Manager for MicroMonsta 2
 * Enforces Hardware Safe Mode, manages ports,
 * handles incoming program capture, and builds NRPN/SysEx messages.
 */

const MIDI_STATUS_CC = 0xB0;
const CC_NRPN_MSB = 99;     // 0x63
const CC_NRPN_LSB = 98;     // 0x62
const CC_DATA_MSB = 6;      // 0x06
const CC_DATA_LSB = 38;     // 0x26

class MidiManager {
    static SETTINGS_KEY = 'mm2_editor_midi_settings';

    constructor() {
        this.midiAccess = null;
        this.inPort = null;
        this.outPort = null;
        this.baseChannel = 14; // Default to Channel 15 (0-indexed 14) for MM2 hardware setup
        this.savedBaseChannel = undefined;
        this.activeSlot = 0;  // 0 for Part A, 1 for Part B
        this.liveSync = false; // Configurable: Live Sync vs Staged Commit
        this.autoCapture = true; // Automatically loads incoming SysEx dumps
        this.periodicCheck = false; // Periodic idle probe for downstream MM2 hardware
        this.lastFetchedSlot = 0; // Tracks most recently requested slot (0=Part A, 1=Part B)
        this.hardwareResponsive = null; // null: unknown/untested, true: responding, false: unresponsive
        this._probeTimeout = null;
        this._isProbing = false;
        this._periodicCheckInterval = null;
        this._lastMidiActivity = Date.now();

        // SysEx multi-packet chunk accumulator
        this._sysexBuffer = [];
        this._isReceivingSysEx = false;

        // Incoming NRPN decoding state
        this._incomingNrpnMsb = null;
        this._incomingNrpnLsb = null;
        this._incomingDataMsb = null;
        this._incomingDataLsb = null;

        this._listeners = new Map();
        this.onMidiMessage = this.onMidiMessage.bind(this);
        this.onStateChange = this.onStateChange.bind(this);
        this.loadSettings();
    }

    on(event, callback) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
        }
        this._listeners.get(event).add(callback);
    }

    off(event, callback) {
        if (this._listeners.has(event)) {
            this._listeners.get(event).delete(callback);
        }
    }

    emit(event, data) {
        if (this._listeners.has(event)) {
            for (const cb of this._listeners.get(event)) {
                try {
                    cb(data);
                } catch (e) {
                    console.error(`Error in MIDI event listener [${event}]:`, e);
                }
            }
        }
    }

    get isSupported() {
        return typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess;
    }

    async init() {
        if (!this.isSupported) {
            this.permissionError = 'Web MIDI API not supported';
            this.emit('error', 'Web MIDI API is not supported in this browser. Please use Chrome, Edge, or Opera.');
            return false;
        }

        try {
            this.midiAccess = await navigator.requestMIDIAccess({ sysex: true });
            this.permissionError = null;
            this.midiAccess.addEventListener('statechange', this.onStateChange);
            this.autoSelectPorts();
            this.emit('state-change', { initialized: true });
            return true;
        } catch (err) {
            console.error('Failed to initialize Web MIDI with SysEx:', err);
            this.permissionError = err.message || err.name || 'Permission Denied';
            this.emit('error', 'Failed to acquire Web MIDI with SysEx permissions: ' + err.message);
            this.emit('permission-error', { error: err });
            return false;
        }
    }

    async reconnect() {
        return await this.init();
    }

    getInputs() {
        if (!this.midiAccess) return [];
        return Array.from(this.midiAccess.inputs.values()).filter(p => !p.state || p.state === 'connected');
    }

    getOutputs() {
        if (!this.midiAccess) return [];
        return Array.from(this.midiAccess.outputs.values()).filter(p => !p.state || p.state === 'connected');
    }

    autoSelectPorts() {
        const inputs = this.getInputs();
        const outputs = this.getOutputs();

        // 1. Identify MM2 ports (targeting MicroMonsta)
        const mm2In = inputs.find(i => this.isMM2Port(i));
        const mm2Out = outputs.find(o => this.isMM2Port(o));

        // 2. Identify saved ports
        let matchedIn = null;
        if (this.savedInPortName || this.savedInPortId) {
            matchedIn = inputs.find(i => (this.savedInPortName && i.name === this.savedInPortName) || (this.savedInPortId && i.id === this.savedInPortId));
        }
        let matchedOut = null;
        if (this.savedOutPortName || this.savedOutPortId) {
            matchedOut = outputs.find(o => (this.savedOutPortName && o.name === this.savedOutPortName) || (this.savedOutPortId && o.id === this.savedOutPortId));
        }

        // Prioritize saved port if present; if a saved port preference exists but is temporarily disconnected,
        // do not fall back to an unrelated port so we don't clobber the user's saved preference during reconnects.
        const hasSavedIn = !!(this.savedInPortName || this.savedInPortId);
        const targetIn = matchedIn || mm2In || (hasSavedIn ? null : inputs[0]);
        if (targetIn && (!this.inPort || this.inPort.id !== targetIn.id)) {
            this.setInputPort(targetIn.id);
        }

        const hasSavedOut = !!(this.savedOutPortName || this.savedOutPortId);
        const targetOut = matchedOut || mm2Out || (hasSavedOut ? null : outputs[0]);
        if (targetOut && (!this.outPort || this.outPort.id !== targetOut.id)) {
            this.setOutputPort(targetOut.id);
        }

        // Auto-migrate baseChannel to 14 (Channel 15) if MM2 detected and baseChannel is unset or 0 (stale default)
        if ((this.isMM2Port(this.inPort) || this.isMM2Port(this.outPort)) && (this.baseChannel === 0 || this.savedBaseChannel === undefined || this.savedBaseChannel === 0)) {
            console.log('[MidiManager] Detected MM2 with Channel 1. Auto-migrating base channel to 14 (Channel 15).');
            this.baseChannel = 14;
            this.savedBaseChannel = 14;
            this.saveSettings();
            this.emit('base-channel-changed', this.baseChannel);
        }
    }

    setInputPort(portId) {
        if (this.inPort && this.inPort.id === portId) return;
        if (this.inPort) {
            this.inPort.removeEventListener('midimessage', this.onMidiMessage);
        }
        const port = this.midiAccess ? this.midiAccess.inputs.get(portId) : null;
        this.inPort = port || null;
        if (this.inPort) {
            this.inPort.addEventListener('midimessage', this.onMidiMessage);
            this.savedInPortId = this.inPort.id;
            this.savedInPortName = this.inPort.name;
        } else {
            this.savedInPortId = '';
            this.savedInPortName = '';
        }
        this.saveSettings();
        this.emit('port-change', { type: 'input', port: this.inPort });
        this.resetHardwareResponsiveness();
        this.checkMM2Detection();
    }

    setOutputPort(portId) {
        if (this.outPort && this.outPort.id === portId) return;
        const port = this.midiAccess ? this.midiAccess.outputs.get(portId) : null;
        this.outPort = port || null;
        if (this.outPort) {
            this.savedOutPortId = this.outPort.id;
            this.savedOutPortName = this.outPort.name;
        } else {
            this.savedOutPortId = '';
            this.savedOutPortName = '';
        }
        this.saveSettings();
        this.emit('port-change', { type: 'output', port: this.outPort });
        this.resetHardwareResponsiveness();
        this.checkMM2Detection();
    }

    isMM2Port(port) {
        if (!port || !port.name) return false;
        const n = port.name.toLowerCase();
        return n.includes('micromonsta');
    }

    setPeriodicCheck(enabled) {
        this.periodicCheck = !!enabled;
        this.saveSettings();
        if (this.periodicCheck) {
            this.startPeriodicCheck();
        } else {
            this.stopPeriodicCheck();
        }
    }

    startPeriodicCheck(intervalMs = 15000) {
        this.stopPeriodicCheck();
        if (!this.periodicCheck) return;
        this._periodicCheckInterval = setInterval(() => {
            // Only probe if both ports are connected and synth has been idle for at least 10s
            if (!this.inPort || !this.outPort) return;
            const idleTime = Date.now() - (this._lastMidiActivity || 0);
            if (idleTime >= 10000 && !this._probeTimeout) {
                this.probeHardware(2500);
            }
        }, intervalMs);
    }

    stopPeriodicCheck() {
        if (this._periodicCheckInterval) {
            clearInterval(this._periodicCheckInterval);
            this._periodicCheckInterval = null;
        }
    }

    resetHardwareResponsiveness() {
        if (!this.inPort || !this.outPort) {
            this.hardwareResponsive = null;
            if (this._probeTimeout) {
                clearTimeout(this._probeTimeout);
                this._probeTimeout = null;
            }
        }
    }

    markHardwareResponsive(responsive) {
        const prev = this.hardwareResponsive;
        const changed = prev !== responsive;
        this.hardwareResponsive = responsive;
        if (this._probeTimeout) {
            clearTimeout(this._probeTimeout);
            this._probeTimeout = null;
        }
        if (changed) {
            this.emit('hardware-responsiveness-changed', { responsive, previous: prev });
        }
    }

    /**
     * Probes downstream MM2 reachability by requesting Part A.
     * If no reply arrives within timeoutMs, marks hardware as unresponsive.
     * Flagged as a probe so background health checks do not overwrite active editor patch data.
     */
    probeHardware(timeoutMs = 2000) {
        if (!this.inPort || !this.outPort) return false;
        if (this._probeTimeout) clearTimeout(this._probeTimeout);

        this._isProbing = true;
        this._probeTimeout = setTimeout(() => {
            this._probeTimeout = null;
            this._isProbing = false;
            this.markHardwareResponsive(false);
            this.emit('hardware-timeout', { inPort: this.inPort, outPort: this.outPort });
        }, timeoutMs);

        return this.fetchProgram(0);
    }

    checkMM2Detection() {
        if (this.inPort && this.outPort && this.isMM2Port(this.inPort) && this.isMM2Port(this.outPort)) {
            console.log('[MidiManager] MM2 Hardware Detected on', this.inPort.name);
            this.emit('mm2-detected', { inPort: this.inPort, outPort: this.outPort });
        }
    }

    onStateChange(event) {
        const port = event.port;
        console.log(`[MIDI State Change] ${port.name} (${port.type}) -> ${port.state}`);
        this.emit('state-change', event);

        if (port.state === 'disconnected') {
            if (port.type === 'input' && this.inPort && (this.inPort.id === port.id || this.inPort === port)) {
                try {
                    this.inPort.removeEventListener('midimessage', this.onMidiMessage);
                } catch (e) {}
                this.inPort = null;
                this.hardwareResponsive = null;
                this.emit('connection-lost', { port, type: 'input' });
                this.emit('port-change', { type: 'input', port: null });
            }
            if (port.type === 'output' && this.outPort && (this.outPort.id === port.id || this.outPort === port)) {
                this.outPort = null;
                this.hardwareResponsive = null;
                this.emit('connection-lost', { port, type: 'output' });
                this.emit('port-change', { type: 'output', port: null });
            }
        } else if (port.state === 'connected') {
            const hadIn = !!this.inPort;
            const hadOut = !!this.outPort;
            this.autoSelectPorts();
            if (!hadIn && this.inPort) {
                this.emit('connection-restored', { port: this.inPort, type: 'input' });
            }
            if (!hadOut && this.outPort) {
                this.emit('connection-restored', { port: this.outPort, type: 'output' });
            }
        }
    }

    onMidiMessage(event) {
        this._lastMidiActivity = Date.now();
        const data = event.data;
        if (!data || data.length === 0) return;

        // 1. Process incoming SysEx (single packet or multi-packet chunks)
        let hasSysEx = false;
        for (let i = 0; i < data.length; i++) {
            const byte = data[i];
            if (byte === 0xF0) {
                this._sysexBuffer = [0xF0];
                this._isReceivingSysEx = true;
                hasSysEx = true;
            } else if (this._isReceivingSysEx) {
                this._sysexBuffer.push(byte);
                hasSysEx = true;
                if (byte === 0xF7) {
                    this._isReceivingSysEx = false;
                    const fullSysEx = new Uint8Array(this._sysexBuffer);
                    this._sysexBuffer = [];
                    this.handleCompleteSysEx(fullSysEx);
                }
            }
        }
        if (hasSysEx || this._isReceivingSysEx) {
            return;
        }

        const status = data[0] & 0xF0;
        const channel = data[0] & 0x0F;

        // 2. Auto-detect MM2 channel from incoming channel voice messages (CC, Note On/Off, Pitch Bend)
        if (status === 0x80 || status === 0x90 || status === 0xB0 || status === 0xE0) {
            if (this.baseChannel !== channel && channel !== (this.baseChannel + 1) % 16) {
                console.log(`[MIDI In] Auto-detected MM2 MIDI Channel: ${channel + 1}`);
                this.baseChannel = channel;
                this.saveSettings();
                this.emit('base-channel-changed', this.baseChannel);
            }
        }

        // 3. Handle Control Change (CC) and NRPN Parameter Edits from MM2 Hardware
        if (status === 0xB0 && data.length >= 3) {
            const ccNum = data[1];
            const ccVal = data[2];

            // A. Check for NRPN controllers
            if (ccNum === CC_NRPN_MSB) {
                this._incomingNrpnMsb = ccVal;
                return;
            } else if (ccNum === CC_NRPN_LSB) {
                this._incomingNrpnLsb = ccVal;
                return;
            } else if (ccNum === CC_DATA_MSB) {
                this._incomingDataMsb = ccVal;
                this._incomingDataLsb = null;
                this.dispatchIncomingNRPN(channel);
                return;
            } else if (ccNum === CC_DATA_LSB) {
                this._incomingDataLsb = ccVal;
                this.dispatchIncomingNRPN(channel);
                return;
            }

            // B. Check for Standard CC mapped parameter
            const ccDef = MM2_CC_MAP.get(ccNum);
            if (ccDef) {
                let val = ccVal;
                if (ccDef.scale) {
                    val = Math.round(ccVal * ccDef.scale);
                }
                const slot = (channel === (this.baseChannel + 1) % 16) ? 1 : 0;
                this.markHardwareResponsive(true);
                this.emit('parameter-received', {
                    paramKey: ccDef.key,
                    value: val,
                    slot,
                    source: 'cc',
                    cc: ccNum
                });
                return;
            }
        }

        // Emit raw message for MIDI monitor
        this.emit('raw-midi', {
            data: Array.from(data),
            time: event.timeStamp
        });
    }

    handleCompleteSysEx(data) {
        const version = validateSysEx(data);
        if (version > 0) {
            const normalized = normalizeProgram(data);
            const program = new MM2Program(normalized);
            const targetCmd = normalized[6]; // 1: A, 2: B, 3: Active (every hardware reply uses 0x03)
            const slot = targetCmd === 2 ? 1 : (targetCmd === 1 ? 0 : (this.lastFetchedSlot || 0));

            console.log(`[MIDI In] MM2 Program received: "${program.name}" for Slot ${slot === 0 ? 'A' : 'B'} (${data.length} bytes)`);
            const isProbe = this._isProbing;
            this._isProbing = false;
            this.markHardwareResponsive(true);
            this.emit('program-received', {
                program,
                slot,
                rawBytes: normalized,
                version,
                isProbe
            });
        }
    }

    dispatchIncomingNRPN(channel) {
        if (this._incomingNrpnMsb === null || this._incomingNrpnLsb === null || this._incomingDataMsb === null) {
            return;
        }
        const nrpnNum = (this._incomingNrpnMsb << 7) | this._incomingNrpnLsb;
        const paramDef = NRPN_TO_PARAM.get(nrpnNum);
        if (!paramDef) return;

        let val;
        if (paramDef.long) {
            val = (this._incomingDataMsb << 7) | (this._incomingDataLsb || 0);
        } else {
            val = this._incomingDataMsb;
        }

        const slot = (channel === (this.baseChannel + 1) % 16) ? 1 : 0;
        this.markHardwareResponsive(true);
        this.emit('parameter-received', {
            paramKey: paramDef.key,
            value: val,
            slot,
            source: 'nrpn',
            nrpn: nrpnNum
        });
    }

    get targetChannel() {
        // Channel 0-15 (baseChannel + activeSlot)
        return (this.baseChannel + this.activeSlot) & 0x0F;
    }

    /**
     * Builds standard 7-bit MIDI NRPN message
     */
    static buildNRPN7(channel, nrpnNum, value) {
        const status = (MIDI_STATUS_CC | (channel & 0x0F));
        return new Uint8Array([
            status, CC_NRPN_MSB, (nrpnNum >> 7) & 127,
            status, CC_NRPN_LSB, nrpnNum & 127,
            status, CC_DATA_MSB, value & 127
        ]);
    }

    /**
     * Builds standard 14-bit MIDI NRPN message
     */
    static buildNRPN14(channel, nrpnNum, value) {
        const status = (MIDI_STATUS_CC | (channel & 0x0F));
        return new Uint8Array([
            status, CC_NRPN_MSB, (nrpnNum >> 7) & 127,
            status, CC_NRPN_LSB, nrpnNum & 127,
            status, CC_DATA_MSB, (value >> 7) & 127,
            status, CC_DATA_LSB, value & 127
        ]);
    }

    /**
     * Sends a parameter value to MM2 via NRPN.
     * When liveSync is enabled, parameter tweaks stream in real-time to the MM2 edit buffer.
     * Note: NRPN parameter edits alter the live RAM buffer and are non-destructive,
     * whereas flash memory overwrites (SysEx dump) are guarded by safeMode in sendProgram.
     */
    sendParameter(paramKey, value, force = false) {
        if (!this.outPort) return false;
        if (!this.liveSync && !force) return false;

        const def = PARAM_MAP.get(paramKey);
        if (!def || def.nrpn === undefined) return false;

        const ch = this.targetChannel;
        const msg = def.long
            ? MidiManager.buildNRPN14(ch, def.nrpn, value)
            : MidiManager.buildNRPN7(ch, def.nrpn, value);

        try {
            this.outPort.send(msg);
            this.emit('midi-out', { type: 'nrpn', key: paramKey, value, bytes: msg });
            return true;
        } catch (err) {
            console.error('Failed to send MIDI NRPN:', err);
            return false;
        }
    }

    /**
     * Sends a complete program to the synth via SysEx
     * @param {MM2Program} program 
     * @param {number} targetSlot 0 for A, 1 for B, -1 for active
     */
    sendProgram(program, targetSlot = -1) {
        if (!this.outPort) {
            throw new Error('No MIDI Output port selected');
        }

        const sysex = program.toSysEx(targetSlot);
        try {
            this.outPort.send(sysex);
            console.log(`[MIDI Out] Sent Program "${program.name}" to Slot ${targetSlot}`);
            this.emit('midi-out', { type: 'sysex', name: program.name, bytes: sysex });
            return true;
        } catch (err) {
            console.error('Failed to send SysEx program:', err);
            throw err;
        }
    }

    /**
     * Requests MM2 to dump the current sound program for Part A (0) or Part B (1).
     * This is a read-only query that does not modify hardware memory.
     */
    fetchProgram(slot = 0) {
        if (!this.outPort) return false;
        this.lastFetchedSlot = slot === 1 ? 1 : 0;
        const msg = new Uint8Array(slot === 1 ? SYSEX_FETCH_B : SYSEX_FETCH_A);
        try {
            this.outPort.send(msg);
            console.log(`[MIDI Out] Requested hardware dump for Part ${slot === 1 ? 'B' : 'A'}`);
            this.emit('midi-out', { type: 'fetch-request', slot, bytes: msg });
            return true;
        } catch (err) {
            console.warn('Failed to send fetch request:', err);
            return false;
        }
    }

    /**
     * Sends a test note on / off for sound auditioning
     */
    sendNote(noteNumber, velocity = 100, on = true) {
        if (!this.outPort) return;
        const status = (on ? 0x90 : 0x80) | this.targetChannel;
        this.outPort.send(new Uint8Array([status, noteNumber & 127, velocity & 127]));
    }

    loadSettings() {
        if (typeof window === 'undefined') return;
        try {
            const raw = window.localStorage.getItem(MidiManager.SETTINGS_KEY);
            if (raw) {
                const s = JSON.parse(raw);
                this.savedInPortId = s.savedInPortId || '';
                this.savedInPortName = s.savedInPortName || '';
                this.savedOutPortId = s.savedOutPortId || '';
                this.savedOutPortName = s.savedOutPortName || '';
                this.savedBaseChannel = s.baseChannel;
                this.baseChannel = s.baseChannel !== undefined ? s.baseChannel : 14;
                this.liveSync = s.liveSync ?? false;
                this.autoCapture = s.autoCapture ?? true;
                this.periodicCheck = s.periodicCheck ?? false;
            }
        } catch (e) {
            console.warn('Failed to parse MIDI settings from localStorage', e);
        }
        if (this.periodicCheck) {
            this.startPeriodicCheck();
        }
    }

    saveSettings() {
        if (typeof window === 'undefined') return;
        try {
            this.savedBaseChannel = this.baseChannel;
            const s = {
                savedInPortId: this.savedInPortId,
                savedInPortName: this.savedInPortName,
                savedOutPortId: this.savedOutPortId,
                savedOutPortName: this.savedOutPortName,
                baseChannel: this.baseChannel,
                liveSync: this.liveSync,
                autoCapture: this.autoCapture,
                periodicCheck: this.periodicCheck
            };
            window.localStorage.setItem(MidiManager.SETTINGS_KEY, JSON.stringify(s));
        } catch (e) {
            console.warn('Failed to save MIDI settings to localStorage', e);
        }
    }
}
