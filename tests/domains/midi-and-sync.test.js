/**
 * Domain Tests: MIDI, Hardware Sync & Connection Lifecycle
 */
MM2TestRunner.register('MIDI, Hardware Sync & Connection Lifecycle', async ({ assert, assertEqual, logger, runSection }) => {
    await runSection('\n--- [6] MIDI NRPN Generation & Hardware Safe Mode Tests ---', async () => {
        // Test 7-bit NRPN packet
        const nrpn7 = MidiManager.buildNRPN7(0, 44, 100);
        assertEqual(nrpn7[0], 0xB0, 'NRPN7 CC Status on Ch 1 is 0xB0');
        assertEqual(nrpn7[1], 99, 'NRPN7 MSB CC is 99');
        assertEqual(nrpn7[4], 98, 'NRPN7 LSB CC is 98');
        assertEqual(nrpn7[5], 44, 'NRPN7 LSB parameter number is 44');
        assertEqual(nrpn7[8], 100, 'NRPN7 data value is 100');

        // Test 14-bit NRPN packet
        const nrpn14 = MidiManager.buildNRPN14(1, 43, 200); // Ch 2, nrpn 43, val 200
        assertEqual(nrpn14[0], 0xB1, 'NRPN14 CC Status on Ch 2 is 0xB1');
        assertEqual(nrpn14[7], 6, 'NRPN14 Data MSB Controller is CC 6');
        assertEqual(nrpn14[8], 1, 'NRPN14 Data MSB is 1');
        assertEqual(nrpn14[10], 38, 'NRPN14 Data LSB Controller is CC 38');
        assertEqual(nrpn14[11], 72, 'NRPN14 Data LSB is 72 (200 = 128 + 72)');

        // Test Hardware SysEx Transmit
        const midi = new MidiManager();
        let noPortThrown = false;
        try {
            midi.sendProgram(new MM2Program(), 0);
        } catch (err) {
            noPortThrown = true;
        }
        assert(noPortThrown, 'sendProgram requires valid output port');

        const testPackets = [];
        midi.outPort = { send: (bytes) => testPackets.push(bytes) };
        const sentOk = midi.sendProgram(new MM2Program(), 0);
        assert(sentOk, 'sendProgram successfully transmits SysEx directly without safe mode gate');
    });

    await runSection('\n--- [7] MM2 Detection, Fetch Commands & Timbral Mode Tests ---', async () => {
        // Test fetch SysEx command buffers
        assertEqual(SYSEX_FETCH_A.length, 8, 'SYSEX_FETCH_A is 8 bytes');
        assertEqual(SYSEX_FETCH_A[6], 0x41, 'SYSEX_FETCH_A command byte is 0x41 (ASCII A)');
        assertEqual(SYSEX_FETCH_B.length, 8, 'SYSEX_FETCH_B is 8 bytes');
        assertEqual(SYSEX_FETCH_B[6], 0x42, 'SYSEX_FETCH_B command byte is 0x42 (ASCII B)');

        // Test MM2 port identification
        const midi = new MidiManager();
        assert(midi.isMM2Port({ name: 'MicroMonsta 2' }), 'Recognizes MicroMonsta 2 as MM2 port');
        assert(midi.isMM2Port({ name: 'MicroMonsta 2' }), 'Recognizes MicroMonsta by name');
        assert(!midi.isMM2Port({ name: 'Generic USB MIDI Device' }), 'Distinguishes generic device from MM2');
        assert(!midi.isMM2Port({ name: 'IAC Driver Bus 1' }), 'Ignores generic virtual ports');

        // Test fetchProgram dispatching
        let sentBytes = null;
        midi.outPort = {
            send: (buf) => { sentBytes = Array.from(buf); }
        };

        const resA = midi.fetchProgram(0);
        assert(resA, 'fetchProgram(0) succeeded');
        assertEqual(sentBytes[6], 0x41, 'fetchProgram(0) transmits request for Part A (0x41)');

        const resB = midi.fetchProgram(1);
        assert(resB, 'fetchProgram(1) succeeded');
        assertEqual(sentBytes[6], 0x42, 'fetchProgram(1) transmits request for Part B (0x42)');
    });

    await runSection('\n--- [8] Timbral Mode Display-Only Indicator & Hardware State Tests ---', async () => {
        const app = new App();
        app.synthTimbralMode = 'monotimbral';

        // 1. User selection attempts via onModeSelectChange are blocked (display-only)
        const changeResult = app.onModeSelectChange('bitimbral');
        assertEqual(changeResult, false, 'onModeSelectChange returns false because mode indicator is display-only');
        assertEqual(app.synthTimbralMode, 'monotimbral', 'Synth mode remains monotimbral when user attempts manual change');

        // 2. Programmatic hardware state updates via setTimbralMode work as expected
        app.setTimbralMode('bitimbral');
        assertEqual(app.synthTimbralMode, 'bitimbral', 'setTimbralMode updates synth mode to bitimbral');

        app.setTimbralMode('combi');
        assertEqual(app.synthTimbralMode, 'combi', 'setTimbralMode updates synth mode to combi');

        // 3. Invalid mode strings are ignored
        app.setTimbralMode('invalid_mode');
        assertEqual(app.synthTimbralMode, 'combi', 'setTimbralMode ignores invalid mode values');

        // 4. Switching back to monotimbral resets active part to Part A if Part B was selected
        app.activeSlot = 1; // Part B
        app.setTimbralMode('monotimbral');
        assertEqual(app.synthTimbralMode, 'monotimbral', 'setTimbralMode updates synth mode back to monotimbral');
        assertEqual(app.activeSlot, 0, 'Active slot automatically resets to Part A (0) in monotimbral mode');

        // 5. Receiving a Part B dump from MM2 hardware automatically updates mode indicator to bitimbral
        const partBDump = new MM2Program();
        partBDump.name = 'LAYER_B';
        app.midi.emit('program-received', { program: partBDump, slot: 1 });
        assertEqual(app.synthTimbralMode, 'bitimbral', 'Receiving Part B hardware dump updates display indicator to bitimbral');

        // 6. Copy Part button dynamic label and title tests
        const mockCopyBtn = document.createElement('button');
        mockCopyBtn.id = 'btn-prog-copy-other';
        document.registerMockElement('btn-prog-copy-other', mockCopyBtn);

        app.setTimbralMode('bitimbral');
        app.selectPart(0);
        assertEqual(mockCopyBtn.textContent, 'Copy A → B', 'Copy button shows "Copy A → B" when viewing Part A');
        assert(mockCopyBtn.title.includes('Part A'), 'Copy button tooltip describes copying from Part A to Part B');

        app.selectPart(1);
        assertEqual(mockCopyBtn.textContent, 'Copy B → A', 'Copy button shows "Copy B → A" when viewing Part B');
        assert(mockCopyBtn.title.includes('Part B'), 'Copy button tooltip describes copying from Part B to Part A');

        app.selectPart(0);
        assertEqual(mockCopyBtn.textContent, 'Copy A → B', 'Copy button returns to "Copy A → B" when switching back to Part A');
        document.registerMockElement('btn-prog-copy-other', null);
    });

    await runSection('\n--- [13] Hardware Pot/Encoder Assignment, Dynamic Timbre Resolution & Live Hardware Sync Tests ---', async () => {
        const app = new App();

        // 1. Dynamic program resolution: resolveProgram works with instances and functions
        assertEqual(resolveProgram(app.timbreA), app.timbreA, 'resolveProgram returns instance when passed directly');
        const dynamicGetter = () => app.activeTimbre;
        assertEqual(resolveProgram(dynamicGetter), app.timbreA, 'resolveProgram resolves activeTimbre dynamically (Part A)');

        // Switch to Part B and verify dynamic getter tracks the change
        app.activeSlot = 1;
        assertEqual(resolveProgram(dynamicGetter), app.timbreB, 'resolveProgram tracks Part B when activeSlot is 1');
        app.activeSlot = 0;

        // 2. In-place mutation when incoming hardware dump is received
        const originalTimbreA = app.timbreA;
        const hwDump = new MM2Program();
        hwDump.name = 'MY_PATCH';
        hwDump.setValue('LAY_POT1_ASSIGN', 16); // Cutoff
        hwDump.setValue('LAY_POT2_ASSIGN', 17); // Reso
        hwDump.setValue('LAY_POT3_ASSIGN', 1);  // Mod Knob
        hwDump.setValue('LAY_ENC1_ASSIGN', 21); // Attack 1
        hwDump.setValue('LAY_ENC2_ASSIGN', 22); // Decay 1
        hwDump.setValue('LAY_ENC3_ASSIGN', 23); // Sustain 1
        hwDump.setValue('LAY_ENC4_ASSIGN', 24); // Release 1

        app.midi.emit('program-received', { program: hwDump, slot: 0 });

        assertEqual(app.timbreA, originalTimbreA, 'timbreA reference is preserved via in-place rawData mutation');
        assertEqual(app.activeTimbre.name, 'MY_PATCH', 'activeTimbre reflects patch name from hardware dump');
        assertEqual(app.activeTimbre.getValue('LAY_POT1_ASSIGN'), 16, 'Hardware dump LAY_POT1_ASSIGN (Pot F) is 16');
        assertEqual(app.activeTimbre.getValue('LAY_POT2_ASSIGN'), 17, 'Hardware dump LAY_POT2_ASSIGN (Pot Q) is 17');
        assertEqual(app.activeTimbre.getValue('LAY_POT3_ASSIGN'), 1, 'Hardware dump LAY_POT3_ASSIGN (Pot M) is 1');
        assertEqual(app.activeTimbre.getValue('LAY_ENC1_ASSIGN'), 21, 'Hardware dump LAY_ENC1_ASSIGN (Encoder 1) is 21');
        assertEqual(app.activeTimbre.getValue('LAY_ENC4_ASSIGN'), 24, 'Hardware dump LAY_ENC4_ASSIGN (Encoder 4) is 24');

        // 3. SysEx serialization places pot & encoder assignments at bytes 17-23
        const sysex = app.activeTimbre.toSysEx(0);
        assertEqual(sysex[17], 16, 'SysEx byte 17 is LAY_POT1_ASSIGN (16 = Cutoff)');
        assertEqual(sysex[18], 17, 'SysEx byte 18 is LAY_POT2_ASSIGN (17 = Resonance)');
        assertEqual(sysex[19], 1, 'SysEx byte 19 is LAY_POT3_ASSIGN (1 = Mod Knob)');
        assertEqual(sysex[20], 21, 'SysEx byte 20 is LAY_ENC1_ASSIGN (21 = Env 1 Attack)');
        assertEqual(sysex[21], 22, 'SysEx byte 21 is LAY_ENC2_ASSIGN (22 = Env 1 Decay)');
        assertEqual(sysex[22], 23, 'SysEx byte 22 is LAY_ENC3_ASSIGN (23 = Env 1 Sustain)');
        assertEqual(sysex[23], 24, 'SysEx byte 23 is LAY_ENC4_ASSIGN (24 = Env 1 Release)');

        // 4. Real-time parameter sync sends NRPN 10-16 for pots and encoders when Safe Mode is unlocked
        const sentMidiMessages = [];
        app.midi.outPort = {
            send: (buf) => { sentMidiMessages.push(Array.from(buf)); }
        };
        app.midi.liveSync = true;
        app.midi.safeMode = false;

        // Change Pot F (LAY_POT1_ASSIGN) to 44 (Env 2 Attack)
        app.onParameterChanged('LAY_POT1_ASSIGN', 44);
        assertEqual(app.activeTimbre.getValue('LAY_POT1_ASSIGN'), 44, 'activeTimbre updated LAY_POT1_ASSIGN to 44');
        const pot1Msg = sentMidiMessages[sentMidiMessages.length - 1];
        assertEqual(pot1Msg[1], 99, 'NRPN MSB CC is 99');
        assertEqual(pot1Msg[2], 0, 'NRPN MSB is 0');
        assertEqual(pot1Msg[4], 98, 'NRPN LSB CC is 98');
        assertEqual(pot1Msg[5], 10, 'NRPN param number is 10 (LAY_POT1_ASSIGN)');
        assertEqual(pot1Msg[7], 6, 'Data Entry MSB CC is 6');
        assertEqual(pot1Msg[8], 44, 'NRPN value is 44');

        // Change Encoder 1 (LAY_ENC1_ASSIGN) to 27
        app.onParameterChanged('LAY_ENC1_ASSIGN', 27);
        assertEqual(app.activeTimbre.getValue('LAY_ENC1_ASSIGN'), 27, 'activeTimbre updated LAY_ENC1_ASSIGN to 27');
        const enc1Msg = sentMidiMessages[sentMidiMessages.length - 1];
        assertEqual(enc1Msg[5], 13, 'NRPN param number is 13 (LAY_ENC1_ASSIGN)');
        assertEqual(enc1Msg[8], 27, 'NRPN value is 27');

        // Change Encoder 4 (LAY_ENC4_ASSIGN) to 59
        app.onParameterChanged('LAY_ENC4_ASSIGN', 59);
        const enc4Msg = sentMidiMessages[sentMidiMessages.length - 1];
        assertEqual(enc4Msg[5], 16, 'NRPN param number is 16 (LAY_ENC4_ASSIGN)');
        assertEqual(enc4Msg[8], 59, 'NRPN value is 59');

        // 4b. Live Sync transmits NRPN directly (non-destructive RAM tweak)
        app.midi.liveSync = true;
        const countBefore = sentMidiMessages.length;
        app.onParameterChanged('OSC1_SHAPE', 42);
        assertEqual(sentMidiMessages.length, countBefore + 1, 'sendParameter sends NRPN when liveSync is true');

        // 4c. When Live Sync is disabled, parameter edits do not transmit NRPN
        app.midi.liveSync = false;
        app.onParameterChanged('OSC1_SHAPE', 50);
        assertEqual(sentMidiMessages.length, countBefore + 1, 'sendParameter does not transmit when liveSync is false');

        // 5. In-place copy between Part A and Part B
        const originalTimbreB = app.timbreB;
        app.activeSlot = 0;
        app.timbreA.name = 'PART_A';
        app.timbreB.rawData = app.timbreA.rawData;
        assertEqual(app.timbreB, originalTimbreB, 'timbreB instance identity preserved during Part copy');
        assertEqual(app.timbreB.name, 'PART_A', 'timbreB received name from Part A');
        app.timbreA.name = 'MODIFIED';
        assertEqual(app.timbreB.name, 'PART_A', 'timbreA and timbreB have independent rawData buffers');
    });

    await runSection('\n--- [15] Web MIDI Chrome Compatibility, Channel Auto-Migration & Live Sync Fetch Tests ---', async () => {
        // 1. MidiManager channel auto-migration from stale 0 (Ch 1) to 14 (Ch 15)
        const midi = new MidiManager();
        midi.baseChannel = 0;
        midi.savedBaseChannel = 0;
        midi.midiAccess = {
            inputs: new Map([['in-1', { id: 'in-1', name: 'MicroMonsta 2', removeEventListener: () => { }, addEventListener: () => { } }]]),
            outputs: new Map([['out-1', { id: 'out-1', name: 'MicroMonsta 2' }]])
        };
        midi.autoSelectPorts();
        assertEqual(midi.baseChannel, 14, 'Auto-migrated stale baseChannel 0 to 14 (Channel 15) on MM2');
        assertEqual(midi.targetChannel, 14, 'targetChannel for Part A is 14 (Ch 15)');
        midi.activeSlot = 1;
        assertEqual(midi.targetChannel, 15, 'targetChannel for Part B is 15 (Ch 16)');

        // 2. Saved port preference & MM2 port auto-selection
        const defaultMidi = new MidiManager();
        defaultMidi.midiAccess = {
            inputs: new Map([
                ['gen-in', { id: 'gen-in', name: 'Keyboard USB', removeEventListener: () => { }, addEventListener: () => { } }],
                ['mm2-in', { id: 'mm2-in', name: 'MicroMonsta 2', removeEventListener: () => { }, addEventListener: () => { } }]
            ]),
            outputs: new Map([
                ['gen-out', { id: 'gen-out', name: 'Speakers MIDI' }],
                ['mm2-out', { id: 'mm2-out', name: 'MicroMonsta 2' }]
            ])
        };
        defaultMidi.autoSelectPorts();
        assertEqual(defaultMidi.inPort.id, 'mm2-in', 'Auto-selects MM2 input port when no user preference is saved');
        assertEqual(defaultMidi.outPort.id, 'mm2-out', 'Auto-selects MM2 output port when no user preference is saved');

        const userSelectedMidi = new MidiManager();
        userSelectedMidi.savedInPortName = 'Keyboard USB';
        userSelectedMidi.midiAccess = {
            inputs: new Map([
                ['gen-in', { id: 'gen-in', name: 'Keyboard USB', removeEventListener: () => { }, addEventListener: () => { } }],
                ['mm2-in', { id: 'mm2-in', name: 'MicroMonsta 2', removeEventListener: () => { }, addEventListener: () => { } }]
            ]),
            outputs: new Map([
                ['gen-out', { id: 'gen-out', name: 'Speakers MIDI' }],
                ['mm2-out', { id: 'mm2-out', name: 'MicroMonsta 2' }]
            ])
        };
        userSelectedMidi.autoSelectPorts();
        assertEqual(userSelectedMidi.inPort.id, 'gen-in', 'Preserves user-selected non-MM2 input port even when MM2 is connected');
        assertEqual(userSelectedMidi.outPort.id, 'mm2-out', 'Still auto-selects MM2 output port when no output preference is saved');

        // 2b. Verify no greedy auto-selection when only generic/virtual ports exist
        const genericOnlyMidi = new MidiManager();
        genericOnlyMidi.midiAccess = {
            inputs: new Map([['thru-in', { id: 'thru-in', name: 'Midi Through Port-0', removeEventListener: () => { }, addEventListener: () => { } }]]),
            outputs: new Map([['thru-out', { id: 'thru-out', name: 'Midi Through Port-0' }]])
        };
        genericOnlyMidi.savedInPortName = '';
        genericOnlyMidi.savedOutPortName = '';
        genericOnlyMidi.autoSelectPorts();
        assertEqual(genericOnlyMidi.inPort, null, 'Does not auto-select generic/virtual input port when no MM2 is connected');
        assertEqual(genericOnlyMidi.outPort, null, 'Does not auto-select generic/virtual output port when no MM2 is connected');

        // 3. App Live Sync & Fetch status transitions
        const app = new App();
        let sentSysEx = null;
        app.midi.inPort = { id: 'in-1', name: 'MicroMonsta 2' };
        app.midi.outPort = {
            id: 'out-1',
            name: 'MicroMonsta 2',
            send: (buf) => { sentSysEx = Array.from(buf); }
        };
        app.midi.hardwareResponsive = true;
        app.midi.liveSync = true;
        app.updateSyncStatus('synced');
        assertEqual(app.syncStatus, 'synced', 'Initial status is synced');

        // Trigger fetchActiveProgram with Live Sync enabled
        app.fetchActiveProgram(0);
        assertEqual(app.syncStatus, 'fetching', 'fetchActiveProgram sets status to fetching');
        assert(sentSysEx !== null && sentSysEx[6] === 0x41, 'Transmitted SysEx fetch request for Part A');

        // Simulate incoming hardware program dump response
        const dummyProg = new MM2Program();
        dummyProg.name = 'FETCHED';
        app.midi.emit('program-received', { program: dummyProg, slot: 0 });
        assertEqual(app.syncStatus, 'synced', 'Receiving hardware dump restores syncStatus to synced');
        assertEqual(app.timbreA.name, 'FETCHED', 'timbreA loaded fetched program data');

        // 4. Live Sync parameter tweak status transition
        app.onParameterChanged('OSC1_SHAPE', 99);
        assertEqual(app.syncStatus, 'streaming', 'Parameter tweak sets status to streaming');
    });

    await runSection('\n--- [16] Hardware Knob Tweak (CC & NRPN) & Multi-Packet SysEx Stream Reassembly Tests ---', async () => {
        const app = new App();
        const midi = app.midi;
        midi.baseChannel = 14; // Channel 15 (0-indexed 14)

        // 1. Multi-packet SysEx chunk reassembly (simulating CoreMIDI USB-MIDI packet fragmentation)
        const fullDump = new Uint8Array(INIT_PROGRAM_BYTES);
        // Modify name in dump to "CHUNKED"
        const nameBytes = new TextEncoder().encode('CHUNKED ');
        fullDump.set(nameBytes, 8);
        fullDump[51] = 0;   // Cutoff MSB
        fullDump[52] = 120; // Cutoff LSB = 120
        fullDump[53] = 45;  // Reso = 45

        let capturedProgram = null;
        midi.on('program-received', ({ program }) => {
            capturedProgram = program;
        });

        // Split the 216-byte dump into chunks of 11 bytes (20 chunks total)
        const chunkSize = 11;
        for (let i = 0; i < fullDump.length; i += chunkSize) {
            const chunk = fullDump.subarray(i, Math.min(i + chunkSize, fullDump.length));
            midi.onMidiMessage({ data: chunk, timeStamp: Date.now() });
        }

        assert(capturedProgram !== null, 'Reassembled multi-chunk SysEx dump successfully');
        assertEqual(capturedProgram.name, 'CHUNKED', 'Captured program name matches chunked payload');
        assertEqual(capturedProgram.getValue('FILTER_FREQ'), 120, 'Captured program cutoff is 120');
        assertEqual(capturedProgram.getValue('FILTER_RESO'), 45, 'Captured program resonance is 45');
        assertEqual(app.activeTimbre.getValue('FILTER_FREQ'), 120, 'app.activeTimbre cutoff updated to 120 on SysEx receipt');

        // 2. Incoming Standard MIDI CC from MM2 hardware (Cutoff = CC 74 on Ch 15: 0xBE)
        // CC 74 value 64 scales to 129 (Math.round(64 * 255 / 127))
        midi.onMidiMessage({ data: new Uint8Array([0xBE, 74, 64]), timeStamp: Date.now() });
        assertEqual(app.activeTimbre.getValue('FILTER_FREQ'), 129, 'Incoming CC 74 updated activeTimbre FILTER_FREQ to 129');

        // 3. Incoming Standard MIDI CC for Resonance (CC 71 = 80)
        midi.onMidiMessage({ data: new Uint8Array([0xBE, 71, 80]), timeStamp: Date.now() });
        assertEqual(app.activeTimbre.getValue('FILTER_RESO'), 80, 'Incoming CC 71 updated activeTimbre FILTER_RESO to 80');

        // 4. Incoming Standard MIDI CC for Osc 1 Shape (CC 39 = 55)
        midi.onMidiMessage({ data: new Uint8Array([0xBE, 39, 55]), timeStamp: Date.now() });
        assertEqual(app.activeTimbre.getValue('OSC1_SHAPE'), 55, 'Incoming CC 39 updated activeTimbre OSC1_SHAPE to 55');

        // 5. Incoming NRPN message sequence (OSC1_TUNE = NRPN 29, set to 76 semitones [+12])
        // NRPN MSB (CC 99) = 0, NRPN LSB (CC 98) = 29, Data MSB (CC 6) = 76
        midi.onMidiMessage({ data: new Uint8Array([0xBE, 99, 0]), timeStamp: Date.now() });
        midi.onMidiMessage({ data: new Uint8Array([0xBE, 98, 29]), timeStamp: Date.now() });
        midi.onMidiMessage({ data: new Uint8Array([0xBE, 6, 76]), timeStamp: Date.now() });
        assertEqual(app.activeTimbre.getValue('OSC1_TUNE'), 76, 'Incoming NRPN 29 updated activeTimbre OSC1_TUNE to 76');

        // 6. Oscillator auto-tab switching when tweaking Osc 3 on hardware
        app.selectedOsc = 1;
        // Tweaking Osc 3 shape via CC 45 = 90
        midi.onMidiMessage({ data: new Uint8Array([0xBE, 45, 90]), timeStamp: Date.now() });
        assertEqual(app.activeTimbre.getValue('OSC3_SHAPE'), 90, 'Incoming CC 45 updated activeTimbre OSC3_SHAPE to 90');
        assertEqual(app.selectedOsc, 3, 'Auto-switched active oscillator tab to Osc 3 on hardware tweak');
    });

    await runSection('\n--- [24] Timbral Mode Detection from MM2 Hardware ---', async () => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const makeProbeApp = (staleMode, timeoutMs = 20) => {
            const probeApp = new App();
            const sent = [];
            probeApp.midi.outPort = { name: 'Mock MM2', send: (bytes) => sent.push(Array.from(bytes)) };
            probeApp.modeProbeTimeoutMs = timeoutMs;
            probeApp.setTimbralMode(staleMode);
            return { probeApp, sent };
        };
        const partA = new MM2Program();
        partA.name = 'PART_A';
        const partB = new MM2Program();
        partB.name = 'PART_B';

        // 1. Monotimbral hardware: Part B request goes unanswered, so a stale bitimbral flag is corrected
        const mono = makeProbeApp('bitimbral');
        mono.probeApp.fetchActiveProgram(0);
        mono.probeApp.midi.emit('program-received', { program: partA, slot: 0 });
        await wait(250);
        assert(mono.sent.some(m => m[6] === 0x42), 'Part B is probed after reading Part A');
        assertEqual(mono.probeApp.synthTimbralMode, 'monotimbral', 'No Part B reply detects monotimbral mode');

        // 2. Two-layer hardware: Part B reply switches a stale mono flag to bitimbral without touching the editor's Part B
        const bi = makeProbeApp('monotimbral', 500);
        bi.probeApp.timbreB.name = 'EDITOR_B';
        bi.probeApp.fetchActiveProgram(0);
        bi.probeApp.midi.emit('program-received', { program: partA, slot: 0 });
        await wait(200);
        bi.probeApp.midi.emit('program-received', { program: partB, slot: 1 });
        await wait(60);
        assertEqual(bi.probeApp.synthTimbralMode, 'bitimbral', 'Part B reply detects bitimbral mode');
        assertEqual(bi.probeApp.timbreB.name, 'EDITOR_B', 'Mode probe leaves the editor Part B untouched');

        // 3. Initial detection also loads Part B into the editor
        const detect = makeProbeApp('monotimbral', 500);
        detect.probeApp.fetchActiveProgram(0, { probe: 'load' });
        detect.probeApp.midi.emit('program-received', { program: partA, slot: 0 });
        await wait(200);
        detect.probeApp.midi.emit('program-received', { program: partB, slot: 1 });
        await wait(60);
        assertEqual(detect.probeApp.synthTimbralMode, 'bitimbral', 'Initial detection finds bitimbral mode');
        assertEqual(detect.probeApp.timbreB.name, 'PART_B', 'Initial detection loads Part B into the editor');

        // 4. Fetching Part B directly never triggers a probe
        const direct = makeProbeApp('monotimbral');
        direct.probeApp.fetchActiveProgram(1);
        assertEqual(direct.probeApp._pendingProbe, null, 'Fetching Part B does not schedule a mode probe');
        clearTimeout(direct.probeApp._fetchTimeout);
    });

    await runSection('\n--- [25] Live Sync UI & Fetch/Push Inactivity Tests ---', async () => {
        const testApp = new App();
        const chkLiveSync = document.createElement('input');
        chkLiveSync.type = 'checkbox';
        chkLiveSync.id = 'chk-prog-live-sync';
        document.registerMockElement('chk-prog-live-sync', chkLiveSync);

        const btnFetch = document.createElement('button');
        btnFetch.id = 'btn-prog-fetch';
        document.registerMockElement('btn-prog-fetch', btnFetch);

        const btnPush = document.createElement('button');
        btnPush.id = 'btn-prog-push';
        document.registerMockElement('btn-prog-push', btnPush);

        // When disconnected / unverified, Live Sync toggle and Fetch/Push buttons are disabled
        testApp.updateLiveSyncUI();
        assertEqual(btnFetch.disabled, true, 'Fetch button disabled when hardware is disconnected');
        assertEqual(btnPush.disabled, true, 'Push button disabled when hardware is disconnected');
        assertEqual(chkLiveSync.disabled, true, 'Live sync checkbox is disabled when hardware is disconnected');
        assertEqual(chkLiveSync.checked, false, 'Live sync checkbox remains unchecked when disconnected');

        // Simulate verified good hardware connection
        testApp.midi.inPort = { id: 'in-1', name: 'MicroMonsta 2' };
        testApp.midi.outPort = { id: 'out-1', name: 'MicroMonsta 2' };
        testApp.midi.hardwareResponsive = true;

        // Initially Live Sync is false
        testApp.midi.liveSync = false;
        testApp.updateLiveSyncUI();
        assertEqual(chkLiveSync.disabled, false, 'Live sync checkbox enabled when connection is good');
        assertEqual(btnFetch.disabled, false, 'Fetch button enabled when Live Sync is false');
        assertEqual(btnPush.disabled, false, 'Push button enabled when Live Sync is false');
        assertEqual(chkLiveSync.checked, false, 'Live sync checkbox is unchecked');

        // Turn Live Sync on
        testApp.midi.liveSync = true;
        testApp.updateLiveSyncUI();
        assertEqual(btnFetch.disabled, true, 'Fetch button disabled when Live Sync is true');
        assertEqual(btnPush.disabled, true, 'Push button disabled when Live Sync is true');
        assertEqual(chkLiveSync.checked, true, 'Live sync checkbox is checked');

        // If connection drops while Live Sync is active, Live Sync auto-disables
        testApp.midi.hardwareResponsive = false;
        testApp.updateConnectionStatus();
        assertEqual(testApp.midi.liveSync, false, 'Live Sync automatically turns off if hardware becomes unresponsive');
        assertEqual(btnFetch.disabled, true, 'Fetch button disables when hardware becomes unresponsive');
        assertEqual(btnPush.disabled, true, 'Push button disables when hardware becomes unresponsive');
        assertEqual(chkLiveSync.disabled, true, 'Live sync checkbox disables when hardware becomes unresponsive');
        assertEqual(chkLiveSync.checked, false, 'Live sync checkbox unchecks when hardware becomes unresponsive');
    });

    await runSection('\n--- [33] Timbral Mode Monotimbral Protection Tests ---', async () => {
        const monoApp = new App();
        monoApp.setTimbralMode('monotimbral');
        assertEqual(monoApp.synthTimbralMode, 'monotimbral', 'App initialized in monotimbral mode');

        // 1. Probing Part B sets lastFetchedSlot to 1, but timeout resets lastFetchedSlot to 0
        monoApp.midi.outPort = { name: 'Mock MM2', send: () => { } };
        monoApp.modeProbeTimeoutMs = 30;
        monoApp.probeTimbralMode();
        assertEqual(monoApp.midi.lastFetchedSlot, 1, 'lastFetchedSlot set to 1 during mode probe');
        assert(monoApp._modeProbe !== null, '_modeProbe active');

        // Wait for probe timeout
        await new Promise(r => setTimeout(r, 50));
        assertEqual(monoApp._modeProbe, null, '_modeProbe cleared after timeout');
        assertEqual(monoApp.synthTimbralMode, 'monotimbral', 'Mode remains monotimbral after probe timeout');
        assertEqual(monoApp.midi.lastFetchedSlot, 0, 'lastFetchedSlot reset to 0 after probe timeout');

        // 2. Incoming hardware dump with targetCmd=3 after timeout is routed to slot 0
        const hwDump = new Uint8Array(INIT_PROGRAM_BYTES);
        let receivedSlot = null;
        monoApp.midi.on('program-received', ({ slot }) => { receivedSlot = slot; });
        monoApp.midi.onMidiMessage({ data: hwDump, timeStamp: Date.now() });

        assertEqual(receivedSlot, 0, 'Subsequent incoming dump routed to slot 0, not stuck on slot 1');
        assertEqual(monoApp.synthTimbralMode, 'monotimbral', 'Mode remains monotimbral');

        // 3. Consuming a Part B fetch resets lastFetchedSlot to 0
        monoApp.midi.lastFetchedSlot = 1;
        monoApp.midi.handleCompleteSysEx(hwDump);
        assertEqual(monoApp.midi.lastFetchedSlot, 0, 'lastFetchedSlot consumed and reset to 0');
    });

    await runSection('\n--- [40] Push Confirmation App Dialog Tests ---', async () => {
        const pushApp = new App();
        const pushMidi = pushApp.midi;
        pushMidi.saveSettings = () => { };
        pushApp.showNotification = () => { };
        let switchedView = null;
        pushApp.switchView = (v) => { switchedView = v; };

        // 1. Missing outPort shows notification and switches to settings without browser alert
        pushMidi.outPort = null;
        const noPortResult = await pushApp.confirmAndSendProgram();
        assertEqual(noPortResult, false, 'confirmAndSendProgram returns false when outPort is missing');
        assertEqual(switchedView, 'settings', 'confirmAndSendProgram switches to settings when outPort is missing');

        // 2. App dialog confirm / cancel / v2 incompatibility note
        let sentCount = 0;
        pushMidi.inPort = { id: 'mm2-in', name: 'MicroMonsta 2' };
        pushMidi.outPort = { id: 'mm2-out', name: 'MicroMonsta 2', send: () => { sentCount++; } };
        pushMidi.hardwareResponsive = true;
        pushApp.activeSlot = 0;
        pushApp.activeTimbre.name = 'PAD_TEST';
        pushApp.updateSyncStatus('modified');

        const mockDesc = { textContent: '' };
        const mockIncompat = { textContent: '', style: { display: 'none' } };
        let nextReturnValue = 'cancel';
        const listeners = {};
        const mockPushDialog = {
            open: false,
            returnValue: '',
            addEventListener: (ev, fn) => { listeners[ev] = fn; },
            removeEventListener: (ev, fn) => { if (listeners[ev] === fn) delete listeners[ev]; },
            showModal: () => {
                mockPushDialog.returnValue = nextReturnValue;
                if (listeners.close) listeners.close();
            }
        };
        document.registerMockElement('push-confirm-dialog', mockPushDialog);
        document.registerMockElement('push-confirm-desc', mockDesc);
        document.registerMockElement('push-confirm-incompat', mockIncompat);

        nextReturnValue = 'cancel';
        const cancelResult = await pushApp.confirmAndSendProgram();
        assertEqual(cancelResult, false, 'Canceling push-confirm-dialog returns false');
        assertEqual(sentCount, 0, 'Canceling push-confirm-dialog does not send MIDI SysEx');
        assert(mockDesc.textContent.includes('PAD_TEST'), 'Push dialog description includes patch name');
        assert(mockDesc.textContent.includes('Layer A'), 'Push dialog description includes layer name');
        assertEqual(mockIncompat.style.display, 'none', 'Incompatibility notice hidden in v3 mode');

        // Confirm with v2 incompatibilities
        pushMidi.detectedFirmwareVersion = 2;
        pushApp.activeTimbre.setValue('CHORD_TYPE1', 3);
        nextReturnValue = 'confirm';
        const confirmResult = await pushApp.confirmAndSendProgram();
        assertEqual(confirmResult, true, 'Confirming push-confirm-dialog returns true');
        assertEqual(sentCount, 1, 'Confirming push-confirm-dialog sends MIDI SysEx');
        assertEqual(pushApp.syncStatus, 'synced', 'Confirming push updates syncStatus to synced');
        assertEqual(mockIncompat.style.display, '', 'Incompatibility notice shown in v2 mode when v3 features present');
        assert(mockIncompat.textContent.includes('Chorder'), 'Incompatibility notice mentions v3-only features');

        document.registerMockElement('push-confirm-dialog', null);
        document.registerMockElement('push-confirm-desc', null);
        document.registerMockElement('push-confirm-incompat', null);
    });

    await runSection('\n--- [41] Connection Sync Prompt Tests ---', async () => {
        const connApp = new App();
        const connMidi = connApp.midi;
        connMidi.saveSettings = () => { };
        connApp.showNotification = () => { };
        const promptCalls = [];
        connApp.promptReconnectSync = (opts) => { promptCalls.push(opts || {}); };

        // 1. Initial MM2 detection prompts instead of auto-fetching
        connMidi.emit('mm2-detected', { inPort: { name: 'MicroMonsta 2' }, outPort: { name: 'MicroMonsta 2' } });
        assertEqual(promptCalls.length, 1, 'Initial mm2-detected triggers sync prompt');
        assertEqual(promptCalls[0].isReconnect, false, 'Initial mm2-detected passes isReconnect=false');
        assert(!connApp._fetchTimeout, 'Initial mm2-detected does not start blind auto-fetch');

        // 2. Subsequent MM2 detection (reconnect) prompts with isReconnect=true
        connMidi.emit('mm2-detected', { inPort: { name: 'MicroMonsta 2' }, outPort: { name: 'MicroMonsta 2' } });
        assertEqual(promptCalls.length, 2, 'Reconnect mm2-detected triggers sync prompt');
        assertEqual(promptCalls[1].isReconnect, true, 'Reconnect mm2-detected passes isReconnect=true');

        // 3. Generic (non-MM2) dual-port connection also prompts
        const genApp = new App();
        const genMidi = genApp.midi;
        genMidi.saveSettings = () => { };
        genApp.showNotification = () => { };
        const genPromptCalls = [];
        genApp.promptReconnectSync = (opts) => { genPromptCalls.push(opts || {}); };

        genMidi.inPort = { id: 'gen-in', name: 'USB MIDI In' };
        genMidi.outPort = null;
        genMidi.emit('port-change', { type: 'input', port: genMidi.inPort });
        assertEqual(genPromptCalls.length, 0, 'Single input port does not trigger connection prompt');

        genMidi.outPort = { id: 'gen-out', name: 'USB MIDI Out' };
        genMidi.emit('port-change', { type: 'output', port: genMidi.outPort });
        assertEqual(genPromptCalls.length, 1, 'Dual generic ports trigger connection sync prompt');

        // Disconnecting and reconnecting generic ports prompts again
        genMidi.outPort = null;
        genMidi.emit('port-change', { type: 'output', port: null });
        genMidi.outPort = { id: 'gen-out', name: 'USB MIDI Out' };
        genMidi.emit('port-change', { type: 'output', port: genMidi.outPort });
        assertEqual(genPromptCalls.length, 2, 'Reconnecting generic ports triggers connection sync prompt again');
        assertEqual(genPromptCalls[1].isReconnect, true, 'Reconnecting generic ports passes isReconnect=true');

        // 4. Follower tab does not prompt on port-change
        const folApp = new App();
        folApp.midi.saveSettings = () => { };
        folApp.showNotification = () => { };
        folApp.tabSync = { isLeader: false, isFollower: true, requestLeaderState: () => { } };
        let folPrompted = false;
        folApp.promptReconnectSync = () => { folPrompted = true; };
        folApp.midi.inPort = { id: 'gen-in', name: 'USB MIDI In' };
        folApp.midi.outPort = { id: 'gen-out', name: 'USB MIDI Out' };
        folApp.midi.emit('port-change', { type: 'output', port: folApp.midi.outPort });
        assertEqual(folPrompted, false, 'Follower tab does not prompt on port-change');
    });

    await runSection('\n--- [42] Unified Fetch/Push/Ignore Sync Dialog Tests ---', async () => {
        const syncApp = new App();
        const syncMidi = syncApp.midi;
        syncMidi.saveSettings = () => { };
        syncApp.showNotification = () => { };

        const titleEl = { textContent: '' };
        const descEl = { textContent: '' };
        const fetchEl = { textContent: '' };
        const pushEl = { textContent: '' };
        const ignoreBtn = { textContent: '' };
        let nextChoice = 'ignore';
        const syncListeners = {};
        const mockSyncDialog = {
            open: false,
            returnValue: '',
            addEventListener: (ev, fn) => { syncListeners[ev] = fn; },
            removeEventListener: (ev, fn) => { if (syncListeners[ev] === fn) delete syncListeners[ev]; },
            showModal: () => {
                mockSyncDialog.returnValue = nextChoice;
                if (syncListeners.close) syncListeners.close();
            }
        };

        document.registerMockElement('sync-action-dialog', mockSyncDialog);
        document.registerMockElement('sync-action-title', titleEl);
        document.registerMockElement('sync-action-desc', descEl);
        document.registerMockElement('sync-action-fetch-detail', fetchEl);
        document.registerMockElement('sync-action-push-detail', pushEl);
        document.registerMockElement('sync-action-ignore-btn', ignoreBtn);

        let fetchCount = 0;
        let pushAllCount = 0;
        let probeCount = 0;
        syncApp.fetchActiveProgram = () => { fetchCount++; syncApp.updateSyncStatus('fetching'); };
        syncApp.pushAllPartsToHardware = () => { pushAllCount++; };
        syncMidi.probeHardware = () => { probeCount++; return true; };

        // 1. promptReconnectSync uses unified dialog for ignore / fetch / push
        syncMidi.inPort = { id: 'mm2-in', name: 'MicroMonsta 2' };
        syncMidi.outPort = { id: 'mm2-out', name: 'MicroMonsta 2', send: () => { } };
        nextChoice = 'ignore';
        await syncApp.promptReconnectSync({ isReconnect: false, portName: 'MicroMonsta 2' });
        assertEqual(fetchCount, 0, 'Connection sync ignore does not fetch');
        assertEqual(pushAllCount, 0, 'Connection sync ignore does not push');
        assertEqual(probeCount, 1, 'Connection sync ignore probes hardware to exit Standby');
        assertEqual(titleEl.textContent, '🔌 MicroMonsta 2 Connected', 'Initial connection title set');
        assertEqual(ignoreBtn.textContent, 'Ignore', 'Ignore button label is consistent');

        syncApp._isPromptingSync = false;
        nextChoice = 'fetch';
        await syncApp.promptReconnectSync({ isReconnect: true, portName: 'MicroMonsta 2' });
        assertEqual(fetchCount, 1, 'Connection sync fetch triggers fetchActiveProgram');
        assertEqual(titleEl.textContent, '🔄 MicroMonsta 2 Reconnected', 'Reconnect title set');

        syncApp._isPromptingSync = false;
        nextChoice = 'push';
        await syncApp.promptReconnectSync({ isReconnect: true, portName: 'MicroMonsta 2' });
        assertEqual(pushAllCount, 1, 'Connection sync push triggers pushAllPartsToHardware');

        // 2. Live sync toggle uses the same unified sync-action-dialog (when HW differs or check times out)
        syncMidi.inPort = { id: 'mm2-in', name: 'MicroMonsta 2' };
        syncMidi.outPort = { id: 'mm2-out', name: 'MicroMonsta 2', send: () => { } };
        syncMidi.hardwareResponsive = true;
        syncMidi.requestProgramDump = async () => null;
        const chkLiveSync = document.createElement('input');
        chkLiveSync.type = 'checkbox';
        chkLiveSync.id = 'chk-prog-live-sync';
        document.registerMockElement('chk-prog-live-sync', chkLiveSync);

        // Minimal mock elements needed by buildEditorUI
        syncApp.setupProgramBar();

        // Ignore keeps liveSync disabled
        nextChoice = 'ignore';
        chkLiveSync.checked = true;
        await chkLiveSync.onchange();
        assertEqual(syncMidi.liveSync, false, 'Live sync ignore keeps liveSync disabled');

        // Fetch defers enabling liveSync until program-received completes
        nextChoice = 'fetch';
        chkLiveSync.checked = true;
        await chkLiveSync.onchange();
        assertEqual(syncMidi.liveSync, false, 'Live sync fetch does not enable liveSync before fetch completes');
        assertEqual(fetchCount, 2, 'Live sync fetch triggers fetchActiveProgram');
        syncMidi.emit('program-received', { program: new MM2Program(), slot: 0, isProbe: false });
        assertEqual(syncMidi.liveSync, true, 'Live sync fetch enables liveSync after program-received');

        // Failed fetch (connection-lost) keeps liveSync disabled
        syncApp._setLiveSyncState(false);
        nextChoice = 'fetch';
        chkLiveSync.checked = true;
        await chkLiveSync.onchange();
        syncMidi.emit('connection-lost', { port: syncMidi.outPort, type: 'output' });
        assertEqual(syncMidi.liveSync, false, 'Live sync stays disabled when fetch fails');

        // Disable and test Push
        syncApp._setLiveSyncState(false);
        let sentProgCount = 0;
        syncMidi.outPort.send = () => { sentProgCount++; };
        nextChoice = 'push';
        chkLiveSync.checked = true;
        await chkLiveSync.onchange();
        assertEqual(syncMidi.liveSync, true, 'Live sync push enables liveSync');
        assertEqual(sentProgCount, 1, 'Live sync push sends active program to MM2');

        // Cleanup
        document.registerMockElement('sync-action-dialog', null);
        document.registerMockElement('sync-action-title', null);
        document.registerMockElement('sync-action-desc', null);
        document.registerMockElement('sync-action-fetch-detail', null);
        document.registerMockElement('sync-action-push-detail', null);
        document.registerMockElement('sync-action-ignore-btn', null);
        document.registerMockElement('chk-prog-live-sync', null);
    });

    await runSection('\n--- [43] MIDI Input Port Selection Verification Tests ---', async () => {
        const inApp = new App();
        const inMidi = inApp.midi;
        inMidi.saveSettings = () => { };
        inApp.showNotification = () => { };

        const portIn1 = { id: 'in-1', name: 'Port In 1', state: 'connected', addEventListener: () => { }, removeEventListener: () => { } };
        const portIn2 = { id: 'in-2', name: 'Port In 2', state: 'connected', addEventListener: () => { }, removeEventListener: () => { } };
        const portOut = { id: 'out-1', name: 'Port Out 1', state: 'connected', send: () => { } };

        inMidi.midiAccess = {
            inputs: new Map([['in-1', portIn1], ['in-2', portIn2]]),
            outputs: new Map([['out-1', portOut]])
        };
        inMidi.outPort = portOut;

        let probeCount = 0;
        inMidi.probeHardware = () => { probeCount++; return true; };

        const selIn = document.createElement('select');
        selIn.id = 'settings-midi-in';
        document.registerMockElement('settings-midi-in', selIn);

        inApp.buildSettingsUI();

        // 1. Selecting a new MIDI Input port probes hardware to verify it works
        selIn.value = 'in-1';
        selIn.onchange();
        assertEqual(inMidi.inPort && inMidi.inPort.id, 'in-1', 'inPort updated to in-1');
        assertEqual(probeCount, 1, 'Selecting new MIDI Input port triggers probeHardware');

        // 2. Selecting the same port again does not trigger a redundant probe
        selIn.onchange();
        assertEqual(probeCount, 1, 'Re-selecting same MIDI Input port does not trigger redundant probe');

        // 3. Switching to a different MIDI Input port triggers a new probe
        selIn.value = 'in-2';
        selIn.onchange();
        assertEqual(inMidi.inPort && inMidi.inPort.id, 'in-2', 'inPort updated to in-2');
        assertEqual(probeCount, 2, 'Switching to a different MIDI Input port triggers probeHardware');

        // 4. Clearing the MIDI Input port does not trigger a probe
        selIn.value = '';
        selIn.onchange();
        assertEqual(inMidi.inPort, null, 'inPort cleared to null');
        assertEqual(probeCount, 2, 'Clearing MIDI Input port does not trigger probeHardware');

        document.registerMockElement('settings-midi-in', null);
    });

    await runSection('\n--- [44] Sync Status Recovery on Connection Restored Tests ---', async () => {
        const recApp = new App();
        const recMidi = recApp.midi;
        recMidi.saveSettings = () => { };
        recMidi.liveSync = false;
        recApp.showNotification = () => { };
        recMidi.inPort = { id: 'in-1', name: 'MicroMonsta 2' };
        recMidi.outPort = { id: 'out-1', name: 'MicroMonsta 2' };

        // 1. After sync failed, hardware becoming responsive clears 'failed' status
        recApp.updateSyncStatus('failed');
        recMidi.markHardwareResponsive(true);
        assertEqual(recApp.syncStatus, 'modified', 'Sync failed clears to modified when hardware becomes responsive');

        // 2. connection-restored with both ports clears 'failed' status
        recApp.updateSyncStatus('failed');
        recMidi.emit('connection-restored', { port: recMidi.inPort, type: 'input' });
        assertEqual(recApp.syncStatus, 'modified', 'Sync failed clears on connection-restored when both ports exist');
    });

    await runSection('\n--- [45] Fetch Notification Outcome Tests ---', async () => {
        const fetchApp = new App();
        const fetchMidi = fetchApp.midi;
        fetchMidi.saveSettings = () => { };
        fetchMidi.outPort = { id: 'out-1', name: 'MicroMonsta 2', send: () => { } };
        const notifications = [];
        fetchApp.showNotification = (msg, type) => { notifications.push({ msg, type }); };

        // 1. Calling fetchActiveProgram does not emit an attempt popup
        fetchApp.fetchActiveProgram(0, { probe: false });
        assertEqual(notifications.length, 0, 'fetchActiveProgram does not show attempt popup');

        // 2. Receiving program-received emits a success popup
        fetchMidi.emit('program-received', { program: new MM2Program(), slot: 0, isProbe: false });
        assertEqual(notifications.length, 1, 'program-received emits one notification');
        assertEqual(notifications[0].type, 'success', 'program-received notification is success');
    });

    await runSection('\n--- [46] Sync Status Updates on Connection Failure Tests ---', async () => {
        const failApp = new App();
        const failMidi = failApp.midi;
        failMidi.saveSettings = () => { };
        failApp.showNotification = () => { };
        failMidi.inPort = { id: 'in-1', name: 'MicroMonsta 2' };
        failMidi.outPort = { id: 'out-1', name: 'MicroMonsta 2' };
        failMidi.markHardwareResponsive(true);

        // 1. Hardware becoming unresponsive transitions 'synced' -> 'failed'
        failApp.updateSyncStatus('synced');
        failMidi.markHardwareResponsive(false);
        assertEqual(failApp.syncStatus, 'failed', 'Sync status changes from synced to failed when hardware becomes unresponsive');

        // 2. connection-lost transitions 'synced' -> 'failed'
        failApp.updateSyncStatus('synced');
        failMidi.emit('connection-lost', { port: failMidi.outPort, type: 'output' });
        assertEqual(failApp.syncStatus, 'failed', 'Sync status changes from synced to failed on connection-lost');
    });

    await runSection('\n--- [47] Output Port Switch Connection Status Tests ---', async () => {
        const outApp = new App();
        const outMidi = outApp.midi;
        outMidi.saveSettings = () => { };
        outApp.showNotification = () => { };

        const portIn = { id: 'in-1', name: 'Port In', state: 'connected', addEventListener: () => { }, removeEventListener: () => { } };
        const badOut = { id: 'out-bad', name: 'Wrong Out', state: 'connected', send: () => { } };
        const goodOut = { id: 'out-good', name: 'Correct Out', state: 'connected', send: () => { } };

        outMidi.midiAccess = {
            inputs: new Map([['in-1', portIn]]),
            outputs: new Map([['out-bad', badOut], ['out-good', goodOut]])
        };
        outMidi.setInputPort('in-1');
        outMidi.setOutputPort('out-bad');
        outMidi.markHardwareResponsive(false);

        const statusDot = { className: '' };
        const statusText = { textContent: '', title: '' };
        document.registerMockElement('midi-status-dot', statusDot);
        document.registerMockElement('midi-status-text', statusText);

        const selOut = document.createElement('select');
        selOut.id = 'settings-midi-out';
        document.registerMockElement('settings-midi-out', selOut);

        outApp.buildSettingsUI();

        let outProbeCount = 0;
        outMidi.probeHardware = () => { outProbeCount++; return true; };

        // Switch from bad output port to good output port
        selOut.value = 'out-good';
        selOut.onchange();

        // Status should immediately reset from 'No Response' to 'Standby' (not remain stale 'No Response'), and probe
        assertEqual(outMidi.hardwareResponsive, null, 'Switching output port resets stale hardwareResponsive=false before port-change');
        assertEqual(statusText.textContent, 'Standby', 'Connection status resets from No Response to Standby on output port change');
        assertEqual(outProbeCount, 1, 'Switching to a new output port probes hardware when input port is set');

        // When probe response arrives, status becomes Connected
        outMidi.markHardwareResponsive(true);
        assertEqual(statusText.textContent, 'Connected', 'Connection status updates to Connected when new output port responds');

        document.registerMockElement('midi-status-dot', null);
        document.registerMockElement('midi-status-text', null);
        document.registerMockElement('settings-midi-out', null);
    });

    await runSection('\n--- [48] MIDI I/O Port Change Outcome Notification Tests ---', async () => {
        const ioApp = new App();
        const ioMidi = ioApp.midi;
        ioMidi.saveSettings = () => { };
        const ioNotifications = [];
        ioApp.showNotification = (msg, type) => { ioNotifications.push({ msg, type }); };

        const in1 = { id: 'in-1', name: 'USB In 1', state: 'connected', addEventListener: () => { }, removeEventListener: () => { } };
        const in2 = { id: 'in-2', name: 'USB In 2', state: 'connected', addEventListener: () => { }, removeEventListener: () => { } };
        const out1 = { id: 'out-1', name: 'USB Out 1', state: 'connected', send: () => { } };
        const out2 = { id: 'out-2', name: 'USB Out 2', state: 'connected', send: () => { } };

        ioMidi.midiAccess = {
            inputs: new Map([['in-1', in1], ['in-2', in2]]),
            outputs: new Map([['out-1', out1], ['out-2', out2]])
        };
        ioMidi.setInputPort('in-1');
        ioMidi.setOutputPort('out-1');
        ioMidi.probeHardware = () => true;

        const selIn = document.createElement('select');
        selIn.id = 'settings-midi-in';
        const selOut = document.createElement('select');
        selOut.id = 'settings-midi-out';
        document.registerMockElement('settings-midi-in', selIn);
        document.registerMockElement('settings-midi-out', selOut);

        ioApp.buildSettingsUI();

        // 1. Changing Input port does not show an attempt popup, shows success on probe-end
        ioNotifications.length = 0;
        selIn.value = 'in-2';
        selIn.onchange();
        assertEqual(ioNotifications.length, 0, 'Changing MIDI Input port does not show attempt popup');
        ioMidi.emit('probe-end', { success: true });
        assertEqual(ioNotifications.length, 1, 'Successful probe shows one notification');
        assertEqual(ioNotifications[0].type, 'success', 'Successful Input port probe shows success popup');
        assert(ioNotifications[0].msg.includes('USB In 2'), 'Success popup names the Input port');

        // 2. Changing Output port does not show an attempt popup, shows warning on hardware-timeout
        ioNotifications.length = 0;
        selOut.value = 'out-2';
        selOut.onchange();
        assertEqual(ioNotifications.length, 0, 'Changing MIDI Output port does not show attempt popup');
        ioMidi.emit('hardware-timeout', { inPort: in2, outPort: out2 });
        ioMidi.emit('probe-end', { success: false });
        assertEqual(ioNotifications.length, 1, 'Failed Output port probe shows one failure notification');
        assertEqual(ioNotifications[0].type, 'warning', 'Failed Output port probe shows warning popup');

        document.registerMockElement('settings-midi-in', null);
        document.registerMockElement('settings-midi-out', null);
    });

    await runSection('\n--- [49] Non-Connected Sync Status Invariant Tests ---', async () => {
        const mockBadge = { className: 'sync-badge synced', textContent: 'Synced', title: '' };
        document.registerMockElement('editor-sync-badge', mockBadge);

        const offApp = new App();
        const offMidi = offApp.midi;
        offMidi.saveSettings = () => { };
        offMidi.liveSync = false;
        offApp.showNotification = () => { };

        // 1. Fresh App starts offline (not synced)
        assertEqual(offApp.syncStatus, 'offline', 'Fresh App starts with syncStatus offline');

        // 2. Calling updateSyncStatus('synced') or ('streaming') while Disconnected forces 'offline'
        offApp.updateSyncStatus('synced');
        assertEqual(offApp.syncStatus, 'offline', 'Disconnected: updateSyncStatus(synced) resolves to offline');
        assertEqual(mockBadge.className, 'sync-badge offline', 'Disconnected: badge class is sync-badge offline');
        assertEqual(mockBadge.textContent, 'Not Synced (Offline)', 'Disconnected: badge text is Not Synced (Offline)');

        offApp.updateSyncStatus('streaming');
        assertEqual(offApp.syncStatus, 'offline', 'Disconnected: updateSyncStatus(streaming) resolves to offline');

        // 3. Partial (outPort only) cannot be synced
        offMidi.outPort = { id: 'out-1', name: 'USB Out' };
        offApp.updateSyncStatus('synced');
        assertEqual(offApp.syncStatus, 'offline', 'Partial: cannot be synced');

        // 4. Standby (both ports, hardwareResponsive === null) cannot be synced
        offMidi.inPort = { id: 'in-1', name: 'USB In' };
        offMidi.hardwareResponsive = null;
        offApp.updateSyncStatus('synced');
        assertEqual(offApp.syncStatus, 'offline', 'Standby: cannot be synced');

        // 5. No Response (hardwareResponsive === false) resolves to failed
        offMidi.hardwareResponsive = false;
        offApp.updateSyncStatus('synced');
        assertEqual(offApp.syncStatus, 'failed', 'No Response: updateSyncStatus(synced) resolves to failed');
        assertEqual(mockBadge.textContent, 'Sync Failed (Offline)', 'No Response: badge text is Sync Failed (Offline)');

        // 6. Connected allows synced, then losing connection via state-change clears synced -> offline
        offMidi.hardwareResponsive = true;
        offApp.updateSyncStatus('synced');
        assertEqual(offApp.syncStatus, 'synced', 'Connected: updateSyncStatus(synced) succeeds');
        assertEqual(mockBadge.textContent, 'Synced with MM2', 'Connected: badge text is Synced with MM2');

        offMidi.inPort = null;
        offMidi.hardwareResponsive = null;
        offMidi.emit('state-change');
        assertEqual(offApp.syncStatus, 'offline', 'Losing port via state-change clears synced to offline');
        assertEqual(mockBadge.className, 'sync-badge offline', 'Losing port updates badge class to sync-badge offline');
        assertEqual(mockBadge.textContent, 'Not Synced (Offline)', 'Losing port updates badge text to Not Synced (Offline)');

        document.registerMockElement('editor-sync-badge', null);
    });

    await runSection('\n--- [50] Initial App Load Hardware Probe & Standby Exit Tests ---', async () => {
        // 1. App.init() probes hardware when both ports are auto-selected so Standby exits to Connected
        const initApp = new App();
        initApp.librarian.init = async () => { };
        initApp.buildEditorUI = () => { };
        initApp.buildLibrarianUI = () => { };
        initApp.buildSettingsUI = () => { };
        initApp.buildAuditionUI = () => { };
        initApp.switchView = () => { };
        initApp.showNotification = () => { };
        initApp.promptReconnectSync = async () => { };

        const statusDot = { className: '' };
        const statusText = { textContent: '', title: '' };
        document.registerMockElement('midi-status-dot', statusDot);
        document.registerMockElement('midi-status-text', statusText);

        let initProbeCount = 0;
        let sentSysEx = null;
        const mockIn = { id: 'mm2-in', name: 'MicroMonsta 2', state: 'connected', addEventListener: () => { }, removeEventListener: () => { } };
        const mockOut = {
            id: 'mm2-out',
            name: 'MicroMonsta 2',
            state: 'connected',
            send: (msg) => { sentSysEx = msg; }
        };
        initApp.midi.saveSettings = () => { };
        initApp.midi.init = async () => {
            initApp.midi.midiAccess = {
                inputs: new Map([['mm2-in', mockIn]]),
                outputs: new Map([['mm2-out', mockOut]])
            };
            initApp.midi.autoSelectPorts();
            return true;
        };
        const origProbe = initApp.midi.probeHardware.bind(initApp.midi);
        initApp.midi.probeHardware = (timeoutMs) => {
            initProbeCount++;
            return origProbe(timeoutMs);
        };

        await initApp.init();
        assertEqual(initProbeCount, 1, 'App.init() probes hardware when both MIDI I/O ports are set');
        assertEqual(statusText.textContent, 'Standby', 'Status is Standby while awaiting initial probe response');
        assert(sentSysEx && sentSysEx.length === 8, 'Initial probe dispatches SysEx fetch request');

        // Simulate MM2 replying with a valid v3 SysEx program dump
        const replyProg = new MM2Program();
        replyProg.name = 'INIT_HW';
        initApp.midi.handleCompleteSysEx(replyProg.toSysEx(0, 3));
        assertEqual(initApp.midi.hardwareResponsive, true, 'Hardware marked responsive on initial probe reply');
        assertEqual(statusText.textContent, 'Connected', 'Status transitions from Standby to Connected after initial probe reply');
        assertEqual(initApp.midi._isProbing, false, 'Probe flag cleared after reply');

        // 2. Follower tab does not probe on App.init()
        const followerInitApp = new App();
        followerInitApp.librarian.init = async () => { };
        followerInitApp.buildEditorUI = () => { };
        followerInitApp.buildLibrarianUI = () => { };
        followerInitApp.buildSettingsUI = () => { };
        followerInitApp.buildAuditionUI = () => { };
        followerInitApp.switchView = () => { };
        followerInitApp.tabSync = { isLeader: false, isFollower: true, requestLeaderState: () => { } };
        let followerProbeCount = 0;
        followerInitApp.midi.saveSettings = () => { };
        followerInitApp.midi.init = async () => {
            followerInitApp.midi.inPort = mockIn;
            followerInitApp.midi.outPort = mockOut;
            return true;
        };
        followerInitApp.midi.probeHardware = () => { followerProbeCount++; return true; };
        await followerInitApp.init();
        assertEqual(followerProbeCount, 0, 'Follower tab does not probe hardware on App.init()');

        // 3. Dismissing promptReconnectSync (choice === null) probes only when unverified
        const dismissApp = new App();
        dismissApp.midi.saveSettings = () => { };
        dismissApp.showNotification = () => { };
        dismissApp.midi.inPort = mockIn;
        dismissApp.midi.outPort = mockOut;
        let dismissProbeCount = 0;
        dismissApp.midi.probeHardware = () => { dismissProbeCount++; return true; };
        dismissApp.promptSyncAction = async () => null;

        await dismissApp.promptReconnectSync({ isReconnect: false, portName: 'MicroMonsta 2' });
        assertEqual(dismissProbeCount, 1, 'Dismissing sync dialog probes hardware when hardwareResponsive is null');

        dismissApp._isPromptingSync = false;
        dismissApp.midi.hardwareResponsive = true;
        await dismissApp.promptReconnectSync({ isReconnect: false, portName: 'MicroMonsta 2' });
        assertEqual(dismissProbeCount, 1, 'Dismissing sync dialog skips redundant probe when already Connected');

        // 4. fetchActiveProgram cancels in-flight probe so reply is not discarded
        const cancelApp = new App();
        cancelApp.midi.saveSettings = () => { };
        cancelApp.showNotification = () => { };
        cancelApp.midi.inPort = mockIn;
        cancelApp.midi.outPort = mockOut;
        cancelApp.midi.probeHardware(2500);
        assertEqual(cancelApp.midi._isProbing, true, 'Probe sets _isProbing=true');
        cancelApp.fetchActiveProgram(0);
        assertEqual(cancelApp.midi._isProbing, false, 'fetchActiveProgram cancels in-flight probe');
        clearTimeout(cancelApp._fetchTimeout);

        document.registerMockElement('midi-status-dot', null);
        document.registerMockElement('midi-status-text', null);
    });

    await runSection('\n--- [51] USB Power-On Reconnect Probe Retries & Sync Dialog Gating Tests ---', async () => {
        const gateApp = new App();
        gateApp.midi.saveSettings = () => { };
        gateApp.showNotification = () => { };
        gateApp.bindEvents();

        const fetchBtn = { disabled: false, title: '' };
        const pushBtn = { disabled: false, title: '' };
        const statusEl = { style: { display: 'none' }, textContent: '', className: '' };
        const titleEl = { textContent: '' };
        const descEl = { textContent: '' };
        const fetchDetailEl = { textContent: '' };
        const pushDetailEl = { textContent: '' };
        const ignoreBtn = { textContent: '' };
        const gateListeners = {};
        const gateDialog = {
            open: false,
            returnValue: '',
            addEventListener: (ev, fn) => { gateListeners[ev] = fn; },
            removeEventListener: (ev, fn) => { if (gateListeners[ev] === fn) delete gateListeners[ev]; },
            showModal: () => {
                gateDialog.open = true;
            }
        };

        document.registerMockElement('sync-action-dialog', gateDialog);
        document.registerMockElement('sync-action-title', titleEl);
        document.registerMockElement('sync-action-desc', descEl);
        document.registerMockElement('sync-action-fetch-detail', fetchDetailEl);
        document.registerMockElement('sync-action-push-detail', pushDetailEl);
        document.registerMockElement('sync-action-ignore-btn', ignoreBtn);
        document.registerMockElement('sync-action-fetch-btn', fetchBtn);
        document.registerMockElement('sync-action-push-btn', pushBtn);
        document.registerMockElement('sync-action-status', statusEl);

        gateApp.midi.inPort = { id: 'mm2-in', name: 'MicroMonsta 2' };
        gateApp.midi.outPort = { id: 'mm2-out', name: 'MicroMonsta 2', send: () => { } };
        gateApp.midi.hardwareResponsive = null;

        // 1. Opening reconnect dialog before MM2 responds disables Fetch/Push
        const promptPromise = gateApp.promptReconnectSync({ isReconnect: true, portName: 'MicroMonsta 2' });
        assertEqual(fetchBtn.disabled, true, 'Reconnect dialog disables Fetch while MM2 is unverified');
        assertEqual(pushBtn.disabled, true, 'Reconnect dialog disables Push while MM2 is unverified');
        assertEqual(statusEl.style.display, '', 'Reconnect dialog shows waiting status while MM2 is unverified');
        assert(statusEl.className.includes('waiting'), 'Reconnect dialog status has waiting class');

        // 2. When MM2 finishes booting and responds, Fetch/Push unlock automatically
        gateApp.midi.markHardwareResponsive(true);
        assertEqual(fetchBtn.disabled, false, 'Reconnect dialog enables Fetch once MM2 responds');
        assertEqual(pushBtn.disabled, false, 'Reconnect dialog enables Push once MM2 responds');
        assert(statusEl.className.includes('ready'), 'Reconnect dialog status transitions to ready');

        // Close dialog as ignore
        gateDialog.open = false;
        gateDialog.returnValue = 'ignore';
        if (gateListeners.close) gateListeners.close();
        await promptPromise;

        // 3. Non-reconnect promptSyncAction (e.g. Live Sync) does not gate Fetch/Push
        const livePromptPromise = gateApp.promptSyncAction({
            title: 'Enable Live Sync',
            description: 'Test',
            fetchDetail: 'Fetch',
            pushDetail: 'Push'
        });
        assertEqual(fetchBtn.disabled, false, 'Live sync dialog keeps Fetch enabled when connected');
        assertEqual(pushBtn.disabled, false, 'Live sync dialog keeps Push enabled when connected');
        assertEqual(statusEl.style.display, 'none', 'Live sync dialog hides reconnect waiting status');
        gateDialog.open = false;
        gateDialog.returnValue = 'ignore';
        if (gateListeners.close) gateListeners.close();
        await livePromptPromise;

        // 4. Probe retries allow USB-powered MM2 to boot before timing out
        const retryMidi = new MidiManager();
        retryMidi.saveSettings = () => { };
        let retrySendCount = 0;
        let retryTimeoutCount = 0;
        let retryProbeResult = null;
        retryMidi.inPort = { id: 'mm2-in', name: 'MicroMonsta 2' };
        retryMidi.outPort = { id: 'mm2-out', name: 'MicroMonsta 2', send: () => { retrySendCount++; } };
        retryMidi.on('hardware-timeout', () => { retryTimeoutCount++; });
        retryMidi.on('probe-end', ({ success }) => { retryProbeResult = success; });

        retryMidi.probeHardware(15, { retries: 2 });
        assertEqual(retrySendCount, 1, 'Initial probe dispatches first request');
        await new Promise(r => setTimeout(r, 22));
        assertEqual(retrySendCount, 2, 'Probe retries after first interval while MM2 boots');
        assertEqual(retryTimeoutCount, 0, 'Probe does not emit hardware-timeout before retries are exhausted');

        // Simulate MM2 finishing boot and replying to second probe
        const bootProg = new MM2Program();
        bootProg.name = 'BOOTED';
        retryMidi.handleCompleteSysEx(bootProg.toSysEx(0, 3));
        assertEqual(retryMidi.hardwareResponsive, true, 'MM2 marked responsive after delayed boot reply');
        assertEqual(retryTimeoutCount, 0, 'No hardware-timeout emitted when retry succeeds');
        assertEqual(retryProbeResult, true, 'probe-end emits success=true when retry succeeds');

        // 5. Exhausting all retries marks hardware unresponsive and emits hardware-timeout
        const failMidi = new MidiManager();
        failMidi.saveSettings = () => { };
        let failSendCount = 0;
        let failTimeoutCount = 0;
        let failProbeResult = null;
        failMidi.inPort = { id: 'mm2-in', name: 'MicroMonsta 2' };
        failMidi.outPort = { id: 'mm2-out', name: 'MicroMonsta 2', send: () => { failSendCount++; } };
        failMidi.on('hardware-timeout', () => { failTimeoutCount++; });
        failMidi.on('probe-end', ({ success }) => { failProbeResult = success; });

        failMidi.probeHardware(15, { retries: 2 });
        await new Promise(r => setTimeout(r, 80));
        assertEqual(failSendCount, 3, 'Probe dispatches initial attempt plus 2 retries before failing');
        assertEqual(failTimeoutCount, 1, 'hardware-timeout emitted once after all retries fail');
        assertEqual(failMidi.hardwareResponsive, false, 'Hardware marked unresponsive after all retries fail');
        assertEqual(failProbeResult, false, 'probe-end emits success=false when all retries fail');

        document.registerMockElement('sync-action-dialog', null);
        document.registerMockElement('sync-action-title', null);
        document.registerMockElement('sync-action-desc', null);
        document.registerMockElement('sync-action-fetch-detail', null);
        document.registerMockElement('sync-action-push-detail', null);
        document.registerMockElement('sync-action-ignore-btn', null);
        document.registerMockElement('sync-action-fetch-btn', null);
        document.registerMockElement('sync-action-push-btn', null);
        document.registerMockElement('sync-action-status', null);
    });

    await runSection('\n--- [62] Skip Sync Dialog When Hardware & Editor Already Match ---', async () => {
        // 1. programsMatch helper
        const progA = new MM2Program();
        progA.name = 'LEAD_01';
        progA.setValue('FILTER_FREQ', 120);
        const syxActive = progA.toSysEx(-1); // CMD_LOAD_ACTIVE (0x03)
        const syxLayerA = progA.toSysEx(0);  // CMD_LOAD_A (0x01)
        assert(programsMatch(syxActive, syxLayerA), 'programsMatch ignores OFFSET_CMD differences');
        assert(programsMatch(progA, syxActive), 'programsMatch compares MM2Program and raw SysEx');

        const progDiffName = progA.clone();
        progDiffName.name = 'LEAD_02';
        assert(!programsMatch(progA, progDiffName), 'programsMatch detects patch name differences');

        const progDiffParam = progA.clone();
        progDiffParam.setValue('FILTER_FREQ', 121);
        assert(!programsMatch(progA, progDiffParam), 'programsMatch detects parameter differences');

        const v2Bytes = progA.toSysEx(0, 2);
        assert(programsMatch(progA, v2Bytes), 'programsMatch normalizes v2 SysEx to v3 for comparison');

        // 2. requestProgramDump read-only peek + timeout
        const peekApp = new App();
        peekApp.midi.saveSettings = () => { };
        peekApp.showNotification = () => { };
        peekApp.modeProbeTimeoutMs = 25;
        peekApp.midi.inPort = { id: 'peek-in', name: 'MicroMonsta 2' };

        const hwPartA = new MM2Program();
        hwPartA.name = 'HW_A';
        hwPartA.setValue('OSC1_SHAPE', 77);
        const hwPartB = new MM2Program();
        hwPartB.name = 'HW_B';
        hwPartB.setValue('OSC2_SHAPE', 55);

        let hwRespondPartB = false;
        peekApp.midi.outPort = {
            id: 'peek-out',
            name: 'MicroMonsta 2',
            send: (bytes) => {
                if (bytes[6] === 0x41) {
                    setTimeout(() => {
                        peekApp.midi.handleCompleteSysEx(hwPartA.toSysEx(-1));
                    }, 5);
                } else if (bytes[6] === 0x42 && hwRespondPartB) {
                    setTimeout(() => {
                        peekApp.midi.handleCompleteSysEx(hwPartB.toSysEx(-1));
                    }, 5);
                }
            }
        };

        const beforeName = peekApp.timbreA.name;
        const peekResult = await peekApp.midi.requestProgramDump(0, { timeoutMs: 50 });
        assert(peekResult !== null && peekResult.program.name === 'HW_A', 'requestProgramDump resolves with hardware Part A dump');
        assertEqual(peekApp.timbreA.name, beforeName, 'requestProgramDump does not mutate editor timbreA');

        const timeoutResult = await peekApp.midi.requestProgramDump(1, { timeoutMs: 25 });
        assertEqual(timeoutResult, null, 'requestProgramDump resolves null on timeout');
        assertEqual(peekApp.midi.hardwareResponsive, true, 'requestProgramDump timeout does not mark hardware unresponsive by default');

        // 3. Live Sync activation skips dialog when HW matches editor
        let modalShownCount = 0;
        const peekSyncDialog = {
            open: false,
            returnValue: 'ignore',
            _listeners: {},
            addEventListener: (ev, fn) => { peekSyncDialog._listeners[ev] = fn; },
            removeEventListener: (ev, fn) => { if (peekSyncDialog._listeners[ev] === fn) delete peekSyncDialog._listeners[ev]; },
            showModal: () => {
                modalShownCount++;
                peekSyncDialog.returnValue = 'ignore';
                if (peekSyncDialog._listeners.close) peekSyncDialog._listeners.close();
            }
        };
        document.registerMockElement('sync-action-dialog', peekSyncDialog);
        const chkLive = document.createElement('input');
        chkLive.type = 'checkbox';
        chkLive.id = 'chk-prog-live-sync';
        document.registerMockElement('chk-prog-live-sync', chkLive);
        peekApp.setupProgramBar();

        peekApp.timbreA = hwPartA.clone();
        chkLive.checked = true;
        await chkLive.onchange();
        assertEqual(modalShownCount, 0, 'Live Sync activation skips dialog when HW and editor match');
        assertEqual(peekApp.midi.liveSync, true, 'Live Sync is enabled immediately when HW and editor match');

        // Live Sync activation shows dialog when HW differs from editor
        peekApp._setLiveSyncState(false);
        peekApp.timbreA.setValue('OSC1_SHAPE', 12);
        chkLive.checked = true;
        await chkLive.onchange();
        assertEqual(modalShownCount, 1, 'Live Sync activation shows dialog when HW and editor differ');
        assertEqual(peekApp.midi.liveSync, false, 'Live Sync remains disabled when mismatch dialog is ignored');

        // 4. Reconnect skips dialog when HW and editor match (monotimbral)
        modalShownCount = 0;
        peekApp._isPromptingSync = false;
        peekApp.timbreA = hwPartA.clone();
        peekApp.setTimbralMode('monotimbral');
        hwRespondPartB = false;
        await peekApp.promptReconnectSync({ isReconnect: true, portName: 'MicroMonsta 2' });
        assertEqual(modalShownCount, 0, 'Reconnect skips dialog when monotimbral Part A matches and Part B is silent');
        assertEqual(peekApp.syncStatus, 'synced', 'Reconnect sets syncStatus to synced when matched');

        // 5. Reconnect skips dialog when bitimbral Part A & Part B both match
        peekApp._isPromptingSync = false;
        peekApp.setTimbralMode('bitimbral');
        peekApp.timbreA = hwPartA.clone();
        peekApp.timbreB = hwPartB.clone();
        hwRespondPartB = true;
        await peekApp.promptReconnectSync({ isReconnect: true, portName: 'MicroMonsta 2' });
        assertEqual(modalShownCount, 0, 'Reconnect skips dialog when bitimbral Part A and Part B both match');

        // 6. Reconnect shows dialog when Part A matches but Part B differs
        peekApp._isPromptingSync = false;
        peekApp.timbreB.setValue('OSC2_SHAPE', 99);
        await peekApp.promptReconnectSync({ isReconnect: true, portName: 'MicroMonsta 2' });
        assertEqual(modalShownCount, 1, 'Reconnect shows dialog when Part A matches but Part B differs');

        // 7. Reconnect shows dialog immediately without probing Part B when Part A differs
        peekApp._isPromptingSync = false;
        let partBQueried = false;
        const origOutSend = peekApp.midi.outPort.send;
        peekApp.midi.outPort.send = (bytes) => {
            if (bytes[6] === 0x42) partBQueried = true;
            origOutSend(bytes);
        };
        peekApp.timbreA.setValue('OSC1_SHAPE', 1);
        await peekApp.promptReconnectSync({ isReconnect: true, portName: 'MicroMonsta 2' });
        assertEqual(modalShownCount, 2, 'Reconnect shows dialog when Part A differs');
        assertEqual(partBQueried, false, 'Reconnect skips Part B probe when Part A already differs');

        document.registerMockElement('sync-action-dialog', null);
        document.registerMockElement('chk-prog-live-sync', null);
    });

    await runSection('\n--- [65] Disabling Live Sync Preserves Synced Status Tests ---', async () => {
        const app = new App();
        if (app.tabSync) {
            app.tabSync.destroy();
            app.tabSync = null;
        }
        app.showNotification = () => { };
        app.midi.inPort = { id: 'in-1', name: 'MicroMonsta 2' };
        app.midi.outPort = { id: 'out-1', name: 'MicroMonsta 2', send: () => { } };
        app.midi.hardwareResponsive = true;

        const badge = document.createElement('span');
        badge.id = 'editor-sync-badge';
        document.registerMockElement('editor-sync-badge', badge);

        const chkLiveSync = document.createElement('input');
        chkLiveSync.type = 'checkbox';
        chkLiveSync.id = 'chk-prog-live-sync';
        document.registerMockElement('chk-prog-live-sync', chkLiveSync);

        app.setupProgramBar();
        app._setLiveSyncState(true);
        app.updateSyncStatus('synced');
        assertEqual(app.syncStatus, 'synced', 'Initial syncStatus is synced');
        assertEqual(badge.textContent, 'Live Synced', 'Badge shows Live Synced while Live Sync is active');

        // Uncheck Live Sync while synced -> should remain synced ("Synced with MM2"), not Modified
        chkLiveSync.checked = false;
        await chkLiveSync.onchange();
        assertEqual(app.midi.liveSync, false, 'Live Sync disabled');
        assertEqual(app.syncStatus, 'synced', 'Disabling Live Sync preserves synced status');
        assertEqual(badge.textContent, 'Synced with MM2', 'Badge updates to Synced with MM2 instead of Modified');

        // Subsequent parameter change while Live Sync is off -> now becomes Modified
        app.onParameterChanged('FILTER_FREQ', 140);
        assertEqual(app.syncStatus, 'modified', 'Parameter change after disabling Live Sync sets status to modified');
        assertEqual(badge.textContent, 'Modified (Push to sync)', 'Badge updates to Modified after parameter change');

        // Remote disable via applyRemoteLiveSync(false) while synced also preserves synced
        app._setLiveSyncState(true);
        app.updateSyncStatus('synced');
        app.applyRemoteLiveSync(false);
        assertEqual(app.syncStatus, 'synced', 'applyRemoteLiveSync(false) preserves synced status');
        assertEqual(badge.textContent, 'Synced with MM2', 'applyRemoteLiveSync(false) updates badge to Synced with MM2');

        document.registerMockElement('editor-sync-badge', null);
        document.registerMockElement('chk-prog-live-sync', null);
    });

});
