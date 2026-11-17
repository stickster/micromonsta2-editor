/**
 * Domain Tests: Editor Panels, Controls & Visualizers
 */
MM2TestRunner.register('Editor Panels, Controls & Visualizers', async ({ assert, assertEqual, logger, runSection }) => {
    await runSection('\n--- [14] Unified Oscillator Panel & Active Oscillator Selection Tests ---', async () => {
        const app = new App();
        assertEqual(app.selectedOsc, 1, 'App initializes with selectedOsc = 1');

        // Switch to Osc 2
        app.selectedOsc = 2;
        assertEqual(app.selectedOsc, 2, 'selectedOsc successfully updates to 2');
        app.onParameterChanged('OSC2_ALGO', 4);
        app.onParameterChanged('OSC2_SHAPE', 80);
        assertEqual(app.activeTimbre.getValue('OSC2_ALGO'), 4, 'OSC2_ALGO updated to 4');
        assertEqual(app.activeTimbre.getValue('OSC2_SHAPE'), 80, 'OSC2_SHAPE updated to 80');

        // Switch to Osc 3
        app.selectedOsc = 3;
        assertEqual(app.selectedOsc, 3, 'selectedOsc successfully updates to 3');
        app.onParameterChanged('OSC3_TUNE', 76);
        assertEqual(app.activeTimbre.getValue('OSC3_TUNE'), 76, 'OSC3_TUNE updated to 76 (+12 semitones)');

        // Copy Osc 2 to Osc 1 using copySection
        copySection('osc', 2, 'osc', 1, app.activeTimbre);
        assertEqual(app.activeTimbre.getValue('OSC1_ALGO'), 4, 'Osc 1 received Osc 2 algo via section copy');
        assertEqual(app.activeTimbre.getValue('OSC1_SHAPE'), 80, 'Osc 1 received Osc 2 shape via section copy');
    });

    await runSection('\n--- [17] Mixed-Case Patch Names, Toggle Buttons & Bipolar Sliders Tests ---', async () => {
        // 1. Mixed-case patch name preservation
        const prog = new MM2Program();
        prog.name = 'MemHurts';
        assertEqual(prog.name, 'MemHurts', 'Patch name preserves mixed-case ("MemHurts")');

        const roundtrip = new MM2Program(prog.toSysEx());
        assertEqual(roundtrip.name, 'MemHurts', 'Roundtrip serialization preserves mixed-case name');

        // 2. Binary On/Off toggle button
        const toggle = createToggleButton('ARP_OFF_ON', prog);
        const btn = toggle.querySelector('button');
        assert(btn !== null, 'createToggleButton creates a button element');
        assertEqual(btn.getAttribute('aria-pressed'), 'false', 'Initial toggle aria-pressed is false');

        // Click to toggle ON
        btn.click();
        assertEqual(prog.getValue('ARP_OFF_ON'), 1, 'Clicking toggle sets parameter to 1');
        assertEqual(btn.getAttribute('aria-pressed'), 'true', 'Active toggle aria-pressed is true');
        assert(btn.classList.contains('active'), 'Active toggle has "active" CSS class');

        // Click to toggle OFF
        btn.click();
        assertEqual(prog.getValue('ARP_OFF_ON'), 0, 'Clicking toggle again sets parameter to 0');
        assertEqual(btn.getAttribute('aria-pressed'), 'false', 'Inactive toggle aria-pressed is false');

        // 3. Auto-promote binary On/Off dropdowns in createSelect
        const selectContainer = createSelect('ARP_LATCH', prog);
        const selectBtn = selectContainer.querySelector('button.btn-param-toggle');
        assert(selectBtn !== null, 'createSelect automatically returns a toggle button for binary On/Off params');

        // 4. Bipolar slider (-99 to +99)
        prog.setValue('MTX1_AMT', 128);
        const slider = createBipolarSlider('MTX1_AMT', prog);
        const range = slider.querySelector('input[type="range"]');
        const valDisplay = slider.querySelector('.bipolar-val');
        assert(range !== null, 'createBipolarSlider contains range input');
        assertEqual(Number(range.value), 128, 'Bipolar slider center is 128 (0)');
        assertEqual(valDisplay.textContent, '0', 'Center value displays as 0');

        // Set to maximum (+99)
        range.value = '227';
        range.dispatchEvent(new Event('input'));
        assertEqual(prog.getValue('MTX1_AMT'), 227, 'Bipolar slider sets parameter to 227');
        assertEqual(valDisplay.textContent, '+99', 'Value displays as +99');

        // Set to minimum (-99)
        range.value = '29';
        range.dispatchEvent(new Event('input'));
        assertEqual(prog.getValue('MTX1_AMT'), 29, 'Bipolar slider sets parameter to 29');
        assertEqual(valDisplay.textContent, '-99', 'Value displays as -99');

        // Reset to center on double-click
        range.dispatchEvent(new Event('dblclick'));
        assertEqual(prog.getValue('MTX1_AMT'), 128, 'Double-click resets bipolar slider to center 128 (0)');
        assertEqual(valDisplay.textContent, '0', 'Value readout resets to 0');

        // 5. Modulation Matrix slot clipboard and init reset
        prog.setValue('MTX1_SRC', 5);
        prog.setValue('MTX1_DST', 10);
        prog.setValue('MTX1_AMT', 175);

        const clip = copySectionToClipboard('mtx', 1, prog);
        assert(clip !== null, 'copySectionToClipboard succeeds for mtx slot 1');
        assertEqual(clip.data.src, 5, 'Clipboard captured MTX1 source');
        assertEqual(clip.data.dst, 10, 'Clipboard captured MTX1 dest');
        assertEqual(clip.data.amt, 175, 'Clipboard captured MTX1 amount');

        const pasteOk = pasteSectionFromClipboard('mtx', 2, prog);
        assert(pasteOk, 'pasteSectionFromClipboard succeeds for mtx slot 2');
        assertEqual(prog.getValue('MTX2_SRC'), 5, 'Slot 2 received source');
        assertEqual(prog.getValue('MTX2_DST'), 10, 'Slot 2 received dest');
        assertEqual(prog.getValue('MTX2_AMT'), 175, 'Slot 2 received amount');

        resetSectionToInit('mtx', 2, prog);
        assertEqual(prog.getValue('MTX2_SRC'), 0, 'Reset slot 2 source to 0');
        assertEqual(prog.getValue('MTX2_DST'), 0, 'Reset slot 2 dest to 0');
        assertEqual(prog.getValue('MTX2_AMT'), 128, 'Reset slot 2 amount to 128 (0 bipolar)');
    });

    await runSection('\n--- [18] Unified Envelope Panel & Web MIDI Disconnect/Reconnect Detection Tests ---', async () => {
        const app = new App();
        if (app.tabSync) {
            app.tabSync.destroy();
            app.tabSync = null;
        }
        const midi = app.midi;

        // 1. Unified Envelope Selection
        assertEqual(app.selectedEnv, 1, 'App initializes with selectedEnv = 1');
        app.selectedEnv = 2;
        assertEqual(app.selectedEnv, 2, 'selectedEnv updates to 2');

        // Auto-switch to Env 3 on incoming hardware parameter tweak
        // ENV3_ATK is NRPN 59
        midi.onMidiMessage({ data: new Uint8Array([0xBE, 99, 0]), timeStamp: Date.now() });
        midi.onMidiMessage({ data: new Uint8Array([0xBE, 98, 59]), timeStamp: Date.now() });
        midi.onMidiMessage({ data: new Uint8Array([0xBE, 6, 88]), timeStamp: Date.now() });
        assertEqual(app.activeTimbre.getValue('ENV3_ATK'), 88, 'Incoming NRPN 59 updated activeTimbre ENV3_ATK to 88');
        assertEqual(app.selectedEnv, 3, 'Auto-switched active envelope tab to Env 3 on hardware tweak');

        // 2. Web MIDI Device Disconnect and Reconnect Detection
        const mockIn = {
            id: 'mm2-in-port',
            name: 'MicroMonsta 2',
            type: 'input',
            state: 'connected',
            addEventListener: () => { },
            removeEventListener: () => { }
        };
        const mockOut = {
            id: 'mm2-out-port',
            name: 'MicroMonsta 2',
            type: 'output',
            state: 'connected',
            send: () => { }
        };

        midi.midiAccess = {
            inputs: new Map([[mockIn.id, mockIn]]),
            outputs: new Map([[mockOut.id, mockOut]])
        };
        midi.inPort = mockIn;
        midi.outPort = mockOut;
        midi.savedInPortId = mockIn.id;
        midi.savedInPortName = mockIn.name;
        midi.savedOutPortId = mockOut.id;
        midi.savedOutPortName = mockOut.name;

        let disconnectEventFired = false;
        let reconnectEventFired = false;

        midi.on('connection-lost', (ev) => {
            if (ev.type === 'input') disconnectEventFired = true;
        });

        midi.on('connection-restored', (ev) => {
            if (ev.type === 'input') reconnectEventFired = true;
        });

        // Simulate device unplug (state === 'disconnected')
        mockIn.state = 'disconnected';
        mockOut.state = 'disconnected';
        let disconnectOutEventFired = false;
        let reconnectOutEventFired = false;
        midi.on('connection-lost', (ev) => {
            if (ev.type === 'output') disconnectOutEventFired = true;
        });
        midi.on('connection-restored', (ev) => {
            if (ev.type === 'output') reconnectOutEventFired = true;
        });

        midi.onStateChange({
            port: { id: mockIn.id, name: mockIn.name, type: 'input', state: 'disconnected' }
        });
        midi.onStateChange({
            port: { id: mockOut.id, name: mockOut.name, type: 'output', state: 'disconnected' }
        });

        assertEqual(midi.inPort, null, 'inPort is set to null on disconnect');
        assertEqual(midi.outPort, null, 'outPort is set to null on disconnect');
        assert(disconnectEventFired, 'connection-lost event emitted on input port disconnect');
        assert(disconnectOutEventFired, 'connection-lost event emitted on output port disconnect');
        assertEqual(midi.savedInPortName, mockIn.name, 'savedInPortName preserved for automatic reconnection');
        assertEqual(midi.savedOutPortName, mockOut.name, 'savedOutPortName preserved for automatic reconnection');

        // Simulate device re-plug with input port connecting first (and disconnected outPort in map)
        mockIn.state = 'connected';
        midi.onStateChange({
            port: { id: mockIn.id, name: mockIn.name, type: 'input', state: 'connected' }
        });

        assert(midi.inPort !== null, 'inPort automatically re-bound on reconnection');
        assert(reconnectEventFired, 'connection-restored event emitted on input port reconnection');
        assertEqual(midi.outPort, null, 'outPort remains null while output port is still disconnected (not bound to stale port)');

        // Now output port connects
        mockOut.state = 'connected';
        midi.onStateChange({
            port: { id: mockOut.id, name: mockOut.name, type: 'output', state: 'connected' }
        });

        assert(midi.outPort !== null, 'outPort automatically re-bound on reconnection');
        assert(reconnectOutEventFired, 'connection-restored event emitted on output port reconnection');
        assertEqual(midi.outPort.id, mockOut.id, 'outPort correctly restored to reconnected output device');

        // 3. Downstream Router / Hardware Responsiveness Probe and Timeout
        let responsivenessChangedFired = false;
        let timeoutEventFired = false;
        midi.on('hardware-responsiveness-changed', () => { responsivenessChangedFired = true; });
        midi.on('hardware-timeout', () => { timeoutEventFired = true; });

        // Simulate successful incoming packet marking hardware responsive
        midi.markHardwareResponsive(true);
        assertEqual(midi.hardwareResponsive, true, 'Hardware marked responsive on valid incoming packet');
        assert(responsivenessChangedFired, 'hardware-responsiveness-changed event emitted');

        // Trigger probe with short timeout to simulate downstream MM2 disconnected from router
        let probeFetchSent = false;
        mockOut.send = (bytes) => { probeFetchSent = true; };
        midi.probeHardware(50);
        assert(probeFetchSent, 'probeHardware dispatched fetch request to output port');

        await new Promise(r => setTimeout(r, 80));
        assertEqual(midi.hardwareResponsive, false, 'Hardware marked unresponsive after probe timeout');
        assert(timeoutEventFired, 'hardware-timeout event emitted on probe timeout');

        // Simulate incoming hardware message restoring responsiveness
        midi.onMidiMessage({ data: new Uint8Array([0xBE, 74, 64]), timeStamp: Date.now() });
        assertEqual(midi.hardwareResponsive, true, 'Incoming hardware tweak restores hardware responsiveness to true');

        // 4. Periodic Hardware Health Check Setting
        midi.setLeaderStatus(true);
        assertEqual(midi.periodicCheck, false, 'periodicCheck starts disabled by default');
        midi.setPeriodicCheck(true);
        assertEqual(midi.periodicCheck, true, 'setPeriodicCheck(true) enables periodic health checks');
        assert(midi._periodicCheckInterval !== null, 'Periodic check timer is actively running');
        midi.setPeriodicCheck(false);
        assertEqual(midi.periodicCheck, false, 'setPeriodicCheck(false) disables periodic health checks');
        assertEqual(midi._periodicCheckInterval, null, 'Periodic check timer is stopped');

        // 6. Normal polling / health probe response does not overwrite editor status or parameters
        app.updateSyncStatus('modified');
        app.timbreA.name = 'UNSAVED_';
        // Send a probe
        midi.probeHardware(1000);
        assert(midi._isProbing, 'midi._isProbing is true during probe');
        // Simulate incoming SysEx response with different patch name "INIT" from probe
        const probeDump = new Uint8Array(INIT_PROGRAM_BYTES);
        midi.onMidiMessage({ data: probeDump, timeStamp: Date.now() });
        assertEqual(app.timbreA.name, 'UNSAVED_', 'Probe response does not overwrite active editor patch data');
        assertEqual(app.syncStatus, 'modified', 'Probe response does not overwrite app sync status');
        assertEqual(midi.hardwareResponsive, true, 'Probe response marks hardware responsive');
        assertEqual(midi._isProbing, false, '_isProbing flag cleared after probe response');

        // 7. Disconnection during fetch clears fetch timeout and resets fetching status
        app.fetchActiveProgram(0);
        assertEqual(app.syncStatus, 'fetching', 'syncStatus is fetching after fetchActiveProgram');
        assert(app._fetchTimeout !== null, '_fetchTimeout is active');
        assert(app._pendingProbe !== null, '_pendingProbe is active');

        // Trigger connection-lost
        midi.emit('connection-lost', { port: mockOut, type: 'output' });
        assertEqual(app._fetchTimeout, null, '_fetchTimeout cleared on connection-lost');
        assertEqual(app._pendingProbe, null, '_pendingProbe cleared on connection-lost');
        assertEqual(app.syncStatus, 'modified', 'syncStatus restored from fetching to modified/synced');

        // 8. Reconnection prompts sync dialog instead of blind premature auto-fetch
        let reconnectPromptCalled = false;
        app.promptReconnectSync = () => { reconnectPromptCalled = true; };
        assert(app._hasDetectedMM2Once, '_hasDetectedMM2Once is set after first detection');

        // Fire mm2-detected on reconnect
        midi.emit('mm2-detected', { inPort: mockIn, outPort: mockOut });
        assert(reconnectPromptCalled, 'promptReconnectSync called instead of blind auto-fetch on MM2 reconnect');
        assertEqual(app._fetchTimeout, null, 'No lingering fetch timeout started on reconnect');
    });

    await runSection('\n--- [19] Phase 2: Vector SVGs, Group Actions, Exact Key Offsets & Chorder Highlighting Tests ---', async () => {
        // 1. Vector line-drawing SVG constants
        assert(typeof ICON_COPY_SVG === 'string' && ICON_COPY_SVG.includes('stroke="currentColor"'), 'ICON_COPY_SVG is vector line art');
        assert(typeof ICON_PASTE_SVG === 'string' && ICON_PASTE_SVG.includes('stroke="currentColor"'), 'ICON_PASTE_SVG is vector line art');
        assert(typeof ICON_RANDOM_SVG === 'string' && ICON_RANDOM_SVG.includes('stroke="currentColor"'), 'ICON_RANDOM_SVG is vector line art');
        assert(typeof ICON_RESET_SVG === 'string' && ICON_RESET_SVG.includes('stroke="currentColor"'), 'ICON_RESET_SVG is vector line art');

        // 2. lfo_group and mtx_group registered in SECTION_DEFINITIONS
        assert(SECTION_DEFINITIONS.lfo_group !== undefined, 'lfo_group registered in SECTION_DEFINITIONS');
        assertEqual(SECTION_DEFINITIONS.lfo_group.count, 1, 'lfo_group count is 1');
        const lfoParams = SECTION_DEFINITIONS.lfo_group.getParams();
        assertEqual(lfoParams.wave1, 'LFO1_WAVE', 'lfo_group includes LFO1_WAVE');
        assertEqual(lfoParams.speed3, 'LFO3_SPEED', 'lfo_group includes LFO3_SPEED');

        assert(SECTION_DEFINITIONS.mtx_group !== undefined, 'mtx_group registered in SECTION_DEFINITIONS');
        assertEqual(SECTION_DEFINITIONS.mtx_group.count, 1, 'mtx_group count is 1');
        const mtxParams = SECTION_DEFINITIONS.mtx_group.getParams();
        assertEqual(mtxParams.src1, 'MTX1_SRC', 'mtx_group includes MTX1_SRC');
        assertEqual(mtxParams.amt12, 'MTX12_AMT', 'mtx_group includes MTX12_AMT');

        // 3. Group clipboard operations
        const srcProg = new MM2Program();
        const dstProg = new MM2Program();
        srcProg.setValue('LFO1_SPEED', 88);
        srcProg.setValue('LFO2_WAVE', 12);
        srcProg.setValue('LFO3_MODE', 2);
        copySectionToClipboard('lfo_group', 1, srcProg);
        pasteSectionFromClipboard('lfo_group', 1, dstProg);
        assertEqual(dstProg.getValue('LFO1_SPEED'), 88, 'dstProg received LFO1_SPEED from lfo_group');
        assertEqual(dstProg.getValue('LFO2_WAVE'), 12, 'dstProg received LFO2_WAVE from lfo_group');
        assertEqual(dstProg.getValue('LFO3_MODE'), 2, 'dstProg received LFO3_MODE from lfo_group');

        // 4. computeChorderNotes verification
        const chorderProg = new MM2Program();
        chorderProg.setValue('KBD_KEY', 0); // Root: C
        chorderProg.setValue('KBD_SCALE', 0); // Scale: Ionian (Major)

        // With CHORD_TYPE1 = 0 ('Off')
        chorderProg.setValue('CHORD_TYPE1', 0);
        let chordRes = computeChorderNotes(60, chorderProg);
        assertEqual(chordRes.pressed, 60, 'computeChorderNotes retains pressed note 60');
        assertEqual(chordRes.chordNotes.length, 0, 'Off chord produces 0 additional chord notes');

        // With CHORD_TYPE1 = 1 ('TRIAD 1 3 5')
        chorderProg.setValue('CHORD_TYPE1', 1);
        chordRes = computeChorderNotes(60, chorderProg); // C4 -> E4 (64), G4 (67)
        assertEqual(chordRes.chordNotes.length, 2, 'Triad chord produces 2 additional chord notes');
        assert(chordRes.chordNotes.includes(64), 'Triad on C4 includes E4 (64)');
        assert(chordRes.chordNotes.includes(67), 'Triad on C4 includes G4 (67)');

        // Diatonic test on D4 (62) -> Minor triad D, F (65), A (69)
        chordRes = computeChorderNotes(62, chorderProg);
        assert(chordRes.chordNotes.includes(65), 'Triad on D4 includes F4 (65)');
        assert(chordRes.chordNotes.includes(69), 'Triad on D4 includes A4 (69)');

        // Inversion test: TRI1I (3 5 1(+1))
        chorderProg.setValue('CHORD_TYPE1', 2);
        chordRes = computeChorderNotes(60, chorderProg);
        assert(chordRes.chordNotes.includes(64), 'TRI1I includes E4 (64)');
        assert(chordRes.chordNotes.includes(67), 'TRI1I includes G4 (67)');
        assert(chordRes.chordNotes.includes(72), 'TRI1I includes C5 (72)');

        // 5. createKeyboard exact offset and dual lighting verification
        const mockMidi = {
            sentNotes: [],
            sendNote(note, vel, on) { this.sentNotes.push({ note, vel, on }); },
            outPort: null,
            targetChannel: 14
        };

        const kbd = createKeyboard(mockMidi, () => chorderProg);
        const kbdArea = kbd.querySelector('.audition-keyboard-area');
        assert(kbdArea !== null, 'Keyboard area wrapper exists');
        assert(kbdArea.children[0].classList.contains('audition-hint'), 'Keys legend is placed immediately to the left of the keyboard');
        assert(kbdArea.children[1].classList.contains('keyboard-wrapper'), 'Keyboard wrapper follows Keys legend inside keyboard area');
        assertEqual(kbd.querySelector('.audition-controls').querySelector('.audition-hint'), null, 'Keys legend is not inside audition-controls');

        const panicBtn = kbd.querySelector('#kbd-panic');
        assert(panicBtn !== null, 'MIDI Panic button exists in audition controls');
        assert(panicBtn.classList.contains('btn-panic'), 'Panic button has .btn-panic red-outline class');
        const auditionControls = kbd.querySelector('.audition-controls');
        assert(auditionControls.children[auditionControls.children.length - 1] === panicBtn, 'Panic button is placed to the right of Mod wheel control');

        // Verify MidiManager.sendAllNotesOff dispatches CC 123 = 0
        const panicMidi = new MidiManager();
        let panicSentBytes = null;
        panicMidi.baseChannel = 14;
        panicMidi.outPort = { id: 'out-1', name: 'MicroMonsta 2', send: (bytes) => { panicSentBytes = Array.from(bytes); } };
        panicMidi.sendAllNotesOff();
        assertEqual(panicSentBytes[0], 0xBE, 'sendAllNotesOff uses CC status on targetChannel (0xB0 | 14)');
        assertEqual(panicSentBytes[1], 123, 'sendAllNotesOff sends CC 123 (All Notes Off)');
        assertEqual(panicSentBytes[2], 0, 'sendAllNotesOff sends value 0');

        // Verify clicking Panic releases latched notes and triggers sendAllNotesOff
        let kbdAllNotesOffCalled = 0;
        mockMidi.sendAllNotesOff = () => { kbdAllNotesOffCalled++; };
        const latchBtnEl = kbd.querySelector('#kbd-latch');
        latchBtnEl.click();
        assert(latchBtnEl.classList.contains('active'), 'Latch button activates');
        kbd.noteOn(60);
        panicBtn.click();
        assert(!latchBtnEl.classList.contains('active'), 'Panic deactivates Latch');
        assert(!kbd.querySelector('[data-offset="0"]').classList.contains('pressed'), 'Panic releases held/latched keys');
        assertEqual(kbdAllNotesOffCalled, 1, 'Panic calls midiManager.sendAllNotesOff()');

        // Verify '!' key triggers Panic
        latchBtnEl.click();
        assert(latchBtnEl.classList.contains('active'), 'Latch button re-activates before ! key test');
        kbd.noteOn(60);
        window.dispatchEvent({ type: 'keydown', key: '!', code: 'Digit1', shiftKey: true, preventDefault: () => {} });
        assert(!latchBtnEl.classList.contains('active'), '! key triggers Panic and deactivates Latch');
        assertEqual(kbdAllNotesOffCalled, 2, '! key triggers midiManager.sendAllNotesOff()');

        // Verify resetLatchAndNotes() clears global latch and note selections
        latchBtnEl.click();
        kbd.noteOn(36);
        assert(latchBtnEl.classList.contains('active'), 'Latch activates before resetLatchAndNotes');
        assert(kbd.querySelector('[data-offset="0"]').classList.contains('pressed'), 'Note selection active before resetLatchAndNotes');
        kbd.resetLatchAndNotes();
        assert(!latchBtnEl.classList.contains('active'), 'resetLatchAndNotes deactivates Latch');
        assert(!kbd.querySelector('[data-offset="0"]').classList.contains('pressed'), 'resetLatchAndNotes clears active note selections');

        // Verify App resets global latch and note selections on Fetch, enabling Arp, and connection drop/restore
        const appLatch = new App();
        appLatch.midi.outPort = { id: 'out-1', name: 'MicroMonsta 2', send: () => {} };
        appLatch.midi.inPort = { id: 'in-1', name: 'MicroMonsta 2' };
        appLatch.bindEvents();
        appLatch.auditionKeyboard = kbd;
        const appLatchBtn = latchBtnEl;
        const appKey0 = kbd.querySelector('[data-offset="0"]');

        const activateLatchAndNote = () => {
            if (!appLatchBtn.classList.contains('active')) appLatchBtn.click();
            kbd.noteOn(36);
        };

        activateLatchAndNote();
        appLatch.fetchActiveProgram(0);
        clearTimeout(appLatch._fetchTimeout);
        assert(!appLatchBtn.classList.contains('active'), 'Fetch turns off global latch');
        assert(!appKey0.classList.contains('pressed'), 'Fetch clears active note selections');

        activateLatchAndNote();
        appLatch.onParameterChanged('ARP_OFF_ON', 1);
        assert(!appLatchBtn.classList.contains('active'), 'Enabling Arp turns off global latch');
        assert(!appKey0.classList.contains('pressed'), 'Enabling Arp clears active note selections');

        activateLatchAndNote();
        appLatch.midi.emit('connection-lost', { port: appLatch.midi.outPort, type: 'output' });
        assert(!appLatchBtn.classList.contains('active'), 'Dropped connection turns off global latch');
        assert(!appKey0.classList.contains('pressed'), 'Dropped connection clears active note selections');

        activateLatchAndNote();
        appLatch.midi.emit('connection-restored', { port: appLatch.midi.outPort, type: 'output' });
        assert(!appLatchBtn.classList.contains('active'), 'Restored connection turns off global latch');
        assert(!appKey0.classList.contains('pressed'), 'Restored connection clears active note selections');

        // Verify CSS :root width tokens prevent 1200px desktop/screenshot side gutters
        if (typeof require !== 'undefined') {
            const fs = require('fs');
            const path = require('path');
            const cssText = fs.readFileSync(path.join(__dirname, '../../css/style.css'), 'utf8');
            const minMatch = cssText.match(/--min-app-width:\s*(\d+)px/);
            const maxMatch = cssText.match(/--max-app-width:\s*(\d+)px/);
            assert(minMatch && parseInt(minMatch[1], 10) >= 1200, 'CSS :root --min-app-width is at least 1200px');
            assert(maxMatch && parseInt(maxMatch[1], 10) >= 1200, 'CSS :root --max-app-width is at least 1200px to avoid side gutters');
        }

        // Verify 3-octave keyboard renders 37 keys (22 white, 15 black) in same horizontal space
        assertEqual(kbd.querySelectorAll('.key-white').length, 22, '3-octave keyboard renders 22 white keys');
        assertEqual(kbd.querySelectorAll('.key-black').length, 15, '3-octave keyboard renders 15 black keys');
        assertEqual(kbd.querySelectorAll('.key').length, 37, '3-octave keyboard renders 37 total keys (offsets 0..36)');

        kbd.setOctave(3); // Displayed base is 3*12 = 36 (C2). Middle octave is (3+1)*12 = 48 (C3). Offsets 0..36 span notes 36..72

        const key0 = kbd.querySelector('[data-offset="0"]');
        const key12 = kbd.querySelector('[data-offset="12"]');
        const key24 = kbd.querySelector('[data-offset="24"]');
        const key28 = kbd.querySelector('[data-offset="28"]');
        const key31 = kbd.querySelector('[data-offset="31"]');
        const key36 = kbd.querySelector('[data-offset="36"]');

        // Test rightmost C key (note 72): offset = 72 - 36 = 36
        chorderProg.setValue('CHORD_TYPE1', 0); // No chord for single key test
        kbd.noteOn(72);
        assert(key36.classList.contains('pressed'), 'Rightmost C key (offset 36) receives .pressed');
        assert(!key0.classList.contains('pressed'), 'Leftmost C key (offset 0) is NOT pressed when note 72 played');
        kbd.noteOff(72);
        assert(!key36.classList.contains('pressed'), 'Key 36 unpressed on noteOff');

        // Test even octave setting: Octave 4 displayed base is 48 (C3), middle octave is 60 (C4)
        kbd.setOctave(4);
        kbd.noteOn(48);
        assert(key0.classList.contains('pressed'), 'Even octave (Oct 4) maps lower octave C3 (48) to offset 0');
        kbd.noteOff(48);
        assert(!key0.classList.contains('pressed'), 'Key 0 unpressed on noteOff in Oct 4');
        kbd.noteOn(60);
        assert(key12.classList.contains('pressed'), 'Even octave (Oct 4) maps middle octave C4 (60) to offset 12');
        kbd.noteOff(60);
        assert(!key12.classList.contains('pressed'), 'Key 12 unpressed on noteOff in Oct 4');

        // Test Chorder blue (pressed) and orange (chord-note) dual highlighting
        kbd.setOctave(3);
        chorderProg.setValue('CHORD_TYPE1', 1); // Triad on C
        mockMidi.sentNotes = [];
        kbd.noteOn(60); // C4 (offset 24) + chord notes E4 (64, offset 28) & G4 (67, offset 31)

        assertEqual(mockMidi.sentNotes.length, 3, 'Transmitted 3 MIDI noteOn events for triad chord');
        assert(key24.classList.contains('pressed'), 'Physically pressed key 24 has .pressed');
        assert(!key24.classList.contains('chord-note'), 'Pressed key 24 does not have .chord-note (pressed takes precedence)');
        assert(key28.classList.contains('chord-note'), 'Sounding chord note E4 has .chord-note');
        assert(!key28.classList.contains('pressed'), 'Chord note E4 is not marked .pressed');
        assert(key31.classList.contains('chord-note'), 'Sounding chord note G4 has .chord-note');

        // Release note 60
        mockMidi.sentNotes = [];
        kbd.noteOff(60);
        assertEqual(mockMidi.sentNotes.length, 3, 'Transmitted 3 MIDI noteOff events for triad chord');
        assert(!key24.classList.contains('pressed'), 'Key 24 cleared on noteOff');
        assert(!key28.classList.contains('chord-note'), 'Key 28 cleared on noteOff');
        assert(!key31.classList.contains('chord-note'), 'Key 31 cleared on noteOff');

        // Regression test: QWERTY keys (e.g. A-K) play the middle octave of the 3-octave displayed range
        {
            const qwertyMidi = {
                sentNotes: [],
                sendNote(note, vel, on) { this.sentNotes.push({ note, vel, on }); },
                outPort: null,
                targetChannel: 14
            };
            const singleProg = new MM2Program();
            const qKbd = createKeyboard(qwertyMidi, () => singleProg);
            qKbd.setOctave(3); // Displayed: 36..72; Middle octave: 48..59

            const sendKey = (type, code) => {
                if (typeof KeyboardEvent !== 'undefined') {
                    window.dispatchEvent(new KeyboardEvent(type, { code, cancelable: true }));
                } else {
                    window.dispatchEvent({ type, code, key: '', preventDefault: () => {} });
                }
            };

            sendKey('keydown', 'KeyA');
            assertEqual(qwertyMidi.sentNotes[0].note, 48, 'KeyA in Oct 3 plays C3 (MIDI 48, middle octave)');
            assert(qKbd.querySelector('[data-offset="12"]').classList.contains('pressed'), 'KeyA highlights middle octave C (offset 12)');
            assert(!qKbd.querySelector('[data-offset="0"]').classList.contains('pressed'), 'KeyA does not highlight lower octave C (offset 0)');
            sendKey('keyup', 'KeyA');

            qwertyMidi.sentNotes = [];
            sendKey('keydown', 'KeyK');
            assertEqual(qwertyMidi.sentNotes[0].note, 60, 'KeyK in Oct 3 plays C4 (MIDI 60, upper octave C)');
            assert(qKbd.querySelector('[data-offset="24"]').classList.contains('pressed'), 'KeyK highlights upper octave C (offset 24)');
            sendKey('keyup', 'KeyK');
        }

        // Regression test: App-piano tracks notes and enforces part limits (6/12V), unison (1/2/3/6), and assign mode
        {
            const vceMidi = {
                sentNotes: [],
                sendNote(note, vel, on) { this.sentNotes.push({ note, vel, on }); },
                outPort: null,
                targetChannel: 14
            };
            const vceProg = new MM2Program();
            let partVoiceLimit = 12;
            const vKbd = createKeyboard(vceMidi, () => vceProg, () => partVoiceLimit);
            vKbd.setOctave(3);

            // 1. Monotimbral (12V), Modern (0), Unison 1 (0) -> max 12 keys
            vceProg.setValue('VCE_MODE', 0);
            vceProg.setValue('VCE_UNISON', 0);
            assertEqual(vKbd.getMaxActiveKeys(), 12, '12V Modern Unison 1 allows 12 active keys');
            for (let n = 48; n < 60; n++) vKbd.noteOn(n);
            assertEqual(vKbd.getActiveNotes().length, 12, '12 notes held simultaneously in 12V mode');
            vceMidi.sentNotes = [];
            vKbd.noteOn(60); // 13th note steals oldest (48)
            assertEqual(vKbd.getActiveNotes().length, 12, '13th note keeps active count at 12');
            assert(!vKbd.getActiveNotes().includes(48), 'Oldest note (48) stolen on 13th note');
            assert(vKbd.getActiveNotes().includes(60), 'New note (60) is active');
            assertEqual(vceMidi.sentNotes[0].note, 48, 'Modern steals oldest noteOff before new noteOn');
            assertEqual(vceMidi.sentNotes[0].on, false, 'Stolen note sends noteOff');
            assertEqual(vceMidi.sentNotes[1].note, 60, 'New note sends noteOn');
            assertEqual(vceMidi.sentNotes[1].on, true, 'New note sends noteOn=true');
            vKbd.resetLatchAndNotes();

            // 2. Bitimbral (6V), Vintage (1), Unison 2 (1) -> max 3 keys (6 / 2 = 3)
            partVoiceLimit = 6;
            vceProg.setValue('VCE_MODE', 1);
            vceProg.setValue('VCE_UNISON', 1);
            assertEqual(vKbd.getMaxActiveKeys(), 3, '6V Vintage Unison 2 allows 3 active keys');
            vKbd.noteOn(48);
            vKbd.noteOn(50);
            vKbd.noteOn(52);
            vKbd.noteOn(53); // steals 48
            assertEqual(vKbd.getActiveNotes().join(','), '50,52,53', '4th note steals oldest in 6V Unison 2');
            vKbd.resetLatchAndNotes();

            // 3. Bitimbral (6V), Unison 3 (2) -> max 2 keys; Unison 6 (3) -> max 1 key
            vceProg.setValue('VCE_UNISON', 2);
            assertEqual(vKbd.getMaxActiveKeys(), 2, '6V Unison 3 allows 2 active keys');
            vceProg.setValue('VCE_UNISON', 3);
            assertEqual(vKbd.getMaxActiveKeys(), 1, '6V Unison 6 allows 1 active key');

            // 4. Mono (2) -> max 1 key, noteOff(old) before noteOn(new), even with Latch active
            partVoiceLimit = 12;
            vceProg.setValue('VCE_UNISON', 0);
            vceProg.setValue('VCE_MODE', 2); // Mono
            assertEqual(vKbd.getMaxActiveKeys(), 1, 'Mono mode enforces max 1 active key');
            vKbd.querySelector('#kbd-latch').click(); // Enable Latch
            vKbd.noteOn(48);
            vceMidi.sentNotes = [];
            vKbd.noteOn(52);
            assertEqual(vKbd.getActiveNotes().join(','), '52', 'Mono replaces latched note 48 with 52');
            assertEqual(vceMidi.sentNotes.length, 2, 'Mono emits noteOff then noteOn');
            assertEqual(vceMidi.sentNotes[0].note, 48, 'Mono sends noteOff(48) first');
            assertEqual(vceMidi.sentNotes[0].on, false, 'Mono noteOff has on=false');
            assertEqual(vceMidi.sentNotes[1].note, 52, 'Mono sends noteOn(52) second');
            assertEqual(vceMidi.sentNotes[1].on, true, 'Mono noteOn has on=true');

            // 5. Legato (3) -> max 1 key, noteOn(new) before noteOff(old)
            vceProg.setValue('VCE_MODE', 3); // Legato
            assertEqual(vKbd.getMaxActiveKeys(), 1, 'Legato mode enforces max 1 active key');
            vceMidi.sentNotes = [];
            vKbd.noteOn(55);
            assertEqual(vKbd.getActiveNotes().join(','), '55', 'Legato replaces 52 with 55');
            assertEqual(vceMidi.sentNotes.length, 2, 'Legato emits noteOn then noteOff');
            assertEqual(vceMidi.sentNotes[0].note, 55, 'Legato sends noteOn(55) first for overlap');
            assertEqual(vceMidi.sentNotes[0].on, true, 'Legato noteOn has on=true');
            assertEqual(vceMidi.sentNotes[1].note, 52, 'Legato sends noteOff(52) second');
            assertEqual(vceMidi.sentNotes[1].on, false, 'Legato noteOff has on=false');
            vKbd.resetLatchAndNotes();

            // 6. App integration: switching timbral mode or VCE_UNISON/VCE_MODE trims active latched notes
            const vceApp = new App();
            vceApp.setTimbralMode('monotimbral');
            vceApp.auditionKeyboard = createKeyboard(
                vceMidi,
                () => vceApp.activeTimbre,
                () => (vceApp.synthTimbralMode === 'monotimbral' ? 12 : 6)
            );
            vceApp.activeTimbre.setValue('VCE_MODE', 0);
            vceApp.activeTimbre.setValue('VCE_UNISON', 0);
            vceApp.auditionKeyboard.querySelector('#kbd-latch').click();
            for (let n = 48; n < 56; n++) vceApp.auditionKeyboard.noteOn(n);
            assertEqual(vceApp.auditionKeyboard.getActiveNotes().length, 8, '8 notes latched in 12V mode');
            vceApp.setTimbralMode('bitimbral'); // Drops limit from 12 to 6
            assertEqual(vceApp.auditionKeyboard.getActiveNotes().length, 6, 'Switching to bitimbral trims latched notes to 6');
            vceApp.onParameterChanged('VCE_MODE', 2); // Assign mode change resets keyboard (latch + active notes)
            assertEqual(vceApp.auditionKeyboard.getActiveNotes().length, 0, 'Changing VCE_MODE resets active keyboard notes');
            assert(!vceApp.auditionKeyboard.querySelector('#kbd-latch').classList.contains('active'), 'Changing VCE_MODE resets keyboard latch');
            vceApp.onParameterChanged('VCE_MODE', 0); // Back to Modern
            vceApp.auditionKeyboard.querySelector('#kbd-latch').click();
            vceApp.auditionKeyboard.noteOn(48);
            vceApp.auditionKeyboard.noteOn(50);
            assertEqual(vceApp.auditionKeyboard.getActiveNotes().length, 2, '2 notes latched before VCE_UNISON change');
            vceApp.onParameterChanged('VCE_UNISON', 2); // Unison change resets keyboard (latch + active notes)
            assertEqual(vceApp.auditionKeyboard.getActiveNotes().length, 0, 'Changing VCE_UNISON resets active keyboard notes');
            assert(!vceApp.auditionKeyboard.querySelector('#kbd-latch').classList.contains('active'), 'Changing VCE_UNISON resets keyboard latch');
            vceApp.auditionKeyboard.resetLatchAndNotes();
        }

        // Regression test: QWERTY keyboard handler must ignore modifier shortcuts (e.g. Cmd-L)
        {
            const modMidi = {
                sentNotes: [],
                sendNote(note, vel, on) { this.sentNotes.push({ note, vel, on }); },
                outPort: null,
                targetChannel: 14
            };
            const singleNoteProg = new MM2Program();
            const modKbd = createKeyboard(modMidi, () => singleNoteProg);
            modKbd.setOctave(3);

            const dispatchWinKey = (type, opts) => {
                if (typeof KeyboardEvent !== 'undefined') {
                    const ev = new KeyboardEvent(type, { ...opts, cancelable: true });
                    window.dispatchEvent(ev);
                    return ev.defaultPrevented;
                }
                let prevented = false;
                window.dispatchEvent({
                    type,
                    key: '',
                    ...opts,
                    preventDefault: () => { prevented = true; }
                });
                return prevented;
            };

            assertEqual(dispatchWinKey('keydown', { code: 'KeyL', metaKey: true }), false, 'Cmd+L is not preventDefaulted by QWERTY keyboard');
            assertEqual(modMidi.sentNotes.length, 0, 'Cmd+L does not trigger MIDI noteOn');
            assertEqual(dispatchWinKey('keydown', { code: 'KeyL', ctrlKey: true }), false, 'Ctrl+L is not preventDefaulted by QWERTY keyboard');
            assertEqual(dispatchWinKey('keydown', { code: 'KeyL', altKey: true }), false, 'Alt+L is not preventDefaulted by QWERTY keyboard');
            assertEqual(dispatchWinKey('keydown', { code: 'KeyZ', metaKey: true }), false, 'Cmd+Z is not preventDefaulted by QWERTY keyboard');
            assertEqual(modKbd.getCurrentOctave(), 3, 'Cmd+Z does not decrement keyboard octave');

            assertEqual(dispatchWinKey('keydown', { code: 'KeyL' }), true, 'Unmodified KeyL is handled and preventDefaulted by QWERTY keyboard');
            assertEqual(modMidi.sentNotes.length, 1, 'Unmodified KeyL triggers MIDI noteOn');
            dispatchWinKey('keyup', { code: 'KeyL' });
        }

        // Noise Mute & Solo Badges & Right-of-Knob Placement
        const testApp = new App();
        const oscPanel = testApp.createOscillatorPanel(testApp.activeTimbre, () => { });
        const noiseGroup = oscPanel.querySelector('.osc-noise-group');
        assert(noiseGroup !== null, 'Noise group exists in oscillator panel footer');
        assertEqual(noiseGroup.children[0].getAttribute('data-param'), 'MIX_NOISE', 'Noise knob is first child on left');
        const noiseBadges = noiseGroup.children[1];
        assert(noiseBadges.classList.contains('osc-noise-badges'), 'Noise badges are second child immediately to right of knob');

        const noiseMuteBtn = noiseBadges.querySelector('.btn-mute');
        const noiseSoloBtn = noiseBadges.querySelector('.btn-solo');
        assert(noiseMuteBtn !== null, 'Noise mute button exists');
        assert(noiseSoloBtn !== null, 'Noise solo button exists');
        assert(noiseMuteBtn.classList.contains('btn-sm-badge'), 'Noise mute button has .btn-sm-badge class');
        assert(noiseSoloBtn.classList.contains('btn-sm-badge'), 'Noise solo button has .btn-sm-badge class');

        // Toggle Noise Mute
        noiseMuteBtn.click();
        assertEqual(testApp.muteState.noise, true, 'Clicking noise mute sets muteState.noise to true');
        assert(noiseMuteBtn.classList.contains('active'), 'Noise mute button has .active class when muted');

        // Toggle Noise Solo (cancels Noise Mute)
        noiseSoloBtn.click();
        assertEqual(testApp.soloState.noise, true, 'Clicking noise solo sets soloState.noise to true');
        assertEqual(testApp.muteState.noise, false, 'Clicking noise solo cancels muteState.noise');
        assert(noiseSoloBtn.classList.contains('active'), 'Noise solo button has .active class when soloed');
        assert(!noiseMuteBtn.classList.contains('active'), 'Noise mute button loses .active class when soloed');

        // Toggle Noise Mute again (cancels Noise Solo)
        noiseMuteBtn.click();
        assertEqual(testApp.muteState.noise, true, 'Clicking noise mute sets muteState.noise to true');
        assertEqual(testApp.soloState.noise, false, 'Clicking noise mute cancels soloState.noise');
        assert(noiseMuteBtn.classList.contains('active'), 'Noise mute button regains .active class');
        assert(!noiseSoloBtn.classList.contains('active'), 'Noise solo button loses .active class when muted');

        // Oscillator Shape Inactive State for Sine / Sine Full / Sine Half
        for (let oscNum = 1; oscNum <= 3; oscNum++) {
            const algoKey = `OSC${oscNum}_ALGO`;
            const shapeKey = `OSC${oscNum}_SHAPE`;
            const algoSelectWrap = oscPanel.querySelector(`[data-param="${algoKey}"]`);
            const algoSelect = algoSelectWrap.querySelector('select');
            const shapeKnob = oscPanel.querySelector(`[data-param="${shapeKey}"]`);
            assert(shapeKnob !== null, `${shapeKey} knob exists`);

            // Default Sawtooth (6) -> Shape is active
            assert(!shapeKnob.classList.contains('is-disabled'), `${shapeKey} is active for Sawtooth`);
            assertEqual(shapeKnob.getAttribute('tabindex'), '0', `${shapeKey} has tabindex=0 when active`);

            // Sine (0), Sine Full (1), Sine Half (2) -> Shape is inactive
            for (const [idx, label] of [[0, 'Sine'], [1, 'Sine Full'], [2, 'Sine Half']]) {
                testApp.activeTimbre.setValue(algoKey, idx);
                algoSelect.value = String(idx);
                algoSelect.dispatchEvent({ type: 'change' });
                assert(shapeKnob.classList.contains('is-disabled'), `${shapeKey} has .is-disabled for ${label}`);
                assertEqual(shapeKnob.getAttribute('aria-disabled'), 'true', `${shapeKey} has aria-disabled=true for ${label}`);
                assertEqual(shapeKnob.getAttribute('tabindex'), '-1', `${shapeKey} has tabindex=-1 for ${label}`);
            }

            // Disabled Shape knob ignores keyboard stepping and dblclick reset
            testApp.activeTimbre.setValue(shapeKey, 64);
            shapeKnob.dispatchEvent({ type: 'keydown', key: 'ArrowUp', preventDefault: () => { } });
            assertEqual(testApp.activeTimbre.getValue(shapeKey), 64, `Disabled ${shapeKey} ignores ArrowUp`);
            shapeKnob.dispatchEvent({ type: 'dblclick', preventDefault: () => { } });
            assertEqual(testApp.activeTimbre.getValue(shapeKey), 64, `Disabled ${shapeKey} ignores dblclick reset`);

            // Switching back to Sawtooth (6) re-enables Shape knob
            testApp.activeTimbre.setValue(algoKey, 6);
            algoSelect.value = '6';
            algoSelect.dispatchEvent({ type: 'change' });
            assert(!shapeKnob.classList.contains('is-disabled'), `${shapeKey} re-enabled when switching back to Sawtooth`);
            assertEqual(shapeKnob.getAttribute('aria-disabled'), 'false', `${shapeKey} aria-disabled=false when active`);
            assertEqual(shapeKnob.getAttribute('tabindex'), '0', `${shapeKey} tabindex=0 when active`);

            // Refreshing panel updates Shape state from program values (e.g. after Fetch/Load)
            testApp.activeTimbre.setValue(algoKey, 2); // Sine Half
            oscPanel.refresh();
            assert(shapeKnob.classList.contains('is-disabled'), `${shapeKey} becomes inactive on oscPanel.refresh() when ${algoKey}=Sine Half`);
            testApp.activeTimbre.setValue(algoKey, 6);
            oscPanel.refresh();
            assert(!shapeKnob.classList.contains('is-disabled'), `${shapeKey} becomes active on oscPanel.refresh() when ${algoKey}=Sawtooth`);
        }

        // Regression test: Focused <select> arrow keys increment/decrement without opening menu
        {
            const selProg = new MM2Program();
            selProg.setValue('FILTER_ALGO', 2); // Lowpass 3
            const selChanges = [];
            const selWrap = createSelect('FILTER_ALGO', selProg, (k, v) => selChanges.push({ k, v }));
            const selEl = selWrap.querySelector('select');

            const sendArrow = (key, extra = {}) => {
                let prevented = false;
                selEl.dispatchEvent({ type: 'keydown', key, ...extra, preventDefault: () => { prevented = true; } });
                return prevented;
            };

            assertEqual(sendArrow('ArrowDown'), true, 'ArrowDown on focused select calls preventDefault()');
            assertEqual(selProg.getValue('FILTER_ALGO'), 3, 'ArrowDown increments select value');
            assertEqual(selEl.value, '3', 'ArrowDown updates select.value');
            assertEqual(selChanges.length, 1, 'ArrowDown fires onChangeCallback');

            assertEqual(sendArrow('ArrowRight'), true, 'ArrowRight on focused select calls preventDefault()');
            assertEqual(selProg.getValue('FILTER_ALGO'), 4, 'ArrowRight increments select value');

            assertEqual(sendArrow('ArrowUp'), true, 'ArrowUp on focused select calls preventDefault()');
            assertEqual(selProg.getValue('FILTER_ALGO'), 3, 'ArrowUp decrements select value');

            assertEqual(sendArrow('ArrowLeft'), true, 'ArrowLeft on focused select calls preventDefault()');
            assertEqual(selProg.getValue('FILTER_ALGO'), 2, 'ArrowLeft decrements select value');

            // Skips disabled options
            selEl.children[3].disabled = true;
            sendArrow('ArrowDown');
            assertEqual(selProg.getValue('FILTER_ALGO'), 4, 'ArrowDown skips disabled option');

            // Ignores modifier-key arrow combos
            assertEqual(sendArrow('ArrowDown', { metaKey: true }), false, 'Cmd+ArrowDown is not intercepted on select');
            assertEqual(selProg.getValue('FILTER_ALGO'), 4, 'Cmd+ArrowDown does not change select value');
        }

        // Regression test: Arrow keys move +1/-1 on 0-127 value knobs
        {
            const knobProg = new MM2Program();
            knobProg.setValue('OSC1_SHAPE', 50);
            const shapeKnob = createKnob('OSC1_SHAPE', knobProg, () => { });
            shapeKnob.dispatchEvent({ type: 'keydown', key: 'ArrowUp', preventDefault: () => { } });
            assertEqual(knobProg.getValue('OSC1_SHAPE'), 51, 'ArrowUp increments 0-127 knob by +1');
            shapeKnob.dispatchEvent({ type: 'keydown', key: 'ArrowRight', preventDefault: () => { } });
            assertEqual(knobProg.getValue('OSC1_SHAPE'), 52, 'ArrowRight increments 0-127 knob by +1');
            shapeKnob.dispatchEvent({ type: 'keydown', key: 'ArrowDown', preventDefault: () => { } });
            assertEqual(knobProg.getValue('OSC1_SHAPE'), 51, 'ArrowDown decrements 0-127 knob by -1');
            shapeKnob.dispatchEvent({ type: 'keydown', key: 'ArrowLeft', preventDefault: () => { } });
            assertEqual(knobProg.getValue('OSC1_SHAPE'), 50, 'ArrowLeft decrements 0-127 knob by -1');

            knobProg.setValue('FILTER_FREQ', 120);
            const cutoffKnob = createKnob('FILTER_FREQ', knobProg, () => { });
            cutoffKnob.dispatchEvent({ type: 'keydown', key: 'ArrowUp', preventDefault: () => { } });
            assertEqual(knobProg.getValue('FILTER_FREQ'), 121, 'ArrowUp increments Cutoff (0-255) knob by +1');
            cutoffKnob.dispatchEvent({ type: 'keydown', key: 'ArrowDown', preventDefault: () => { } });
            assertEqual(knobProg.getValue('FILTER_FREQ'), 120, 'ArrowDown decrements Cutoff (0-255) knob by -1');
        }

        // Regression test: Direct numerical entry on knob (Enter, blur, arrow keys, Alt-click reset)
        {
            const entryProg = new MM2Program();
            entryProg.setValue('OSC1_SHAPE', 40);
            const entryEvents = [];
            const entryKnob = createKnob('OSC1_SHAPE', entryProg, (k, v, meta) => entryEvents.push({ k, v, meta }));
            assert(entryKnob.title.includes('Alt/Opt-click'), 'Knob tooltip mentions Alt/Opt-click reset');
            const valEl = entryKnob.querySelector('.knob-value');

            // 1. Click value -> opens input, Enter commits and removes input
            valEl.dispatchEvent({ type: 'click', stopPropagation: () => { } });
            let inputEl = valEl.querySelector('input');
            assert(inputEl !== null, 'Clicking knob value opens input');
            inputEl.value = '75';
            inputEl.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault: () => { } });
            assertEqual(entryProg.getValue('OSC1_SHAPE'), 75, 'Enter commits typed knob value');
            assertEqual(valEl.querySelector('input'), null, 'Enter removes input and deactivates entry mode');

            // 2. Blur accepts value and deactivates entry mode
            valEl.dispatchEvent({ type: 'click', stopPropagation: () => { } });
            inputEl = valEl.querySelector('input');
            assert(inputEl !== null, 'Clicking knob value opens input again');
            inputEl.value = '82';
            inputEl.dispatchEvent({ type: 'blur' });
            assertEqual(entryProg.getValue('OSC1_SHAPE'), 82, 'Blur commits typed knob value');
            assertEqual(valEl.querySelector('input'), null, 'Blur removes input and deactivates entry mode');

            // 3. Arrow keys work while value input is focused, and Enter commits
            valEl.dispatchEvent({ type: 'click', stopPropagation: () => { } });
            inputEl = valEl.querySelector('input');
            inputEl.dispatchEvent({ type: 'keydown', key: 'ArrowUp', preventDefault: () => { }, stopPropagation: () => { } });
            assertEqual(entryProg.getValue('OSC1_SHAPE'), 83, 'ArrowUp inside value input increments parameter by +1');
            assertEqual(inputEl.value, '83', 'ArrowUp updates input.value');
            inputEl.dispatchEvent({ type: 'keydown', key: 'ArrowDown', preventDefault: () => { }, stopPropagation: () => { } });
            assertEqual(entryProg.getValue('OSC1_SHAPE'), 82, 'ArrowDown inside value input decrements parameter by -1');
            inputEl.dispatchEvent({ type: 'keydown', key: 'ArrowRight', preventDefault: () => { }, stopPropagation: () => { } });
            assertEqual(entryProg.getValue('OSC1_SHAPE'), 83, 'ArrowRight inside value input increments parameter by +1');
            inputEl.dispatchEvent({ type: 'keydown', key: 'ArrowLeft', preventDefault: () => { }, stopPropagation: () => { } });
            assertEqual(entryProg.getValue('OSC1_SHAPE'), 82, 'ArrowLeft inside value input decrements parameter by -1');
            inputEl.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault: () => { } });
            assertEqual(valEl.querySelector('input'), null, 'Enter after arrow stepping deactivates entry mode');

            // 4. Alt/Opt-click resets knob to default value without opening input
            entryProg.setValue('OSC1_SHAPE', 99);
            const canvasEl = entryKnob.querySelector('canvas');
            canvasEl.dispatchEvent({ type: 'pointerdown', button: 0, altKey: true, preventDefault: () => { } });
            assertEqual(entryProg.getValue('OSC1_SHAPE'), 0, 'Alt-click on knob canvas resets to default (0)');
            await new Promise(r => setTimeout(r, 10));
            entryProg.setValue('OSC1_SHAPE', 99);
            valEl.dispatchEvent({ type: 'click', altKey: true, stopPropagation: () => { } });
            assertEqual(entryProg.getValue('OSC1_SHAPE'), 0, 'Alt-click on knob value resets to default (0)');
            assertEqual(valEl.querySelector('input'), null, 'Alt-click on knob value does not open entry mode');

            // 5. Visible scale & clamping for offset (OSC1_TUNE: -24..+24, raw 40..88, offset 64)
            entryProg.setValue('OSC1_TUNE', 64); // visible 0
            const tuneKnob = createKnob('OSC1_TUNE', entryProg, () => { });
            const tuneValEl = tuneKnob.querySelector('.knob-value');
            tuneValEl.dispatchEvent({ type: 'click', stopPropagation: () => { } });
            let tuneInput = tuneValEl.querySelector('input');
            assertEqual(tuneInput.value, '0', 'Offset knob opens with visible scale (0, not internal 64)');
            tuneInput.value = '10';
            tuneInput.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault: () => { } });
            assertEqual(entryProg.getValue('OSC1_TUNE'), 74, 'Typing unsigned 10 on offset knob sets internal 64+10=74');
            tuneValEl.dispatchEvent({ type: 'click', stopPropagation: () => { } });
            tuneInput = tuneValEl.querySelector('input');
            tuneInput.value = '999';
            tuneInput.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault: () => { } });
            assertEqual(entryProg.getValue('OSC1_TUNE'), 88, 'Typing above visible max clamps to raw max (88 / +24)');
            tuneValEl.dispatchEvent({ type: 'click', stopPropagation: () => { } });
            tuneInput = tuneValEl.querySelector('input');
            tuneInput.value = '-999';
            tuneInput.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault: () => { } });
            assertEqual(entryProg.getValue('OSC1_TUNE'), 40, 'Typing below visible min clamps to raw min (40 / -24)');

            entryProg.setValue('OSC1_TUNE', 64); // visible 0
            tuneValEl.dispatchEvent({ type: 'click', stopPropagation: () => { } });
            tuneInput = tuneValEl.querySelector('input');
            let minusPrevented = false;
            tuneKnob.dispatchEvent({ type: 'keydown', key: '-', target: tuneInput, preventDefault: () => { minusPrevented = true; } });
            assert(!minusPrevented, 'Knob keydown does not preventDefault("-") while numerical entry input is active');
            assertEqual(entryProg.getValue('OSC1_TUNE'), 64, 'Typing "-" during numerical entry does not decrement knob');
            tuneInput.value = '-12';
            tuneInput.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault: () => { } });
            assertEqual(entryProg.getValue('OSC1_TUNE'), 52, 'Typing negative value (-12) on bipolar knob sets internal 64-12=52');

            // 5b. Home/End keys set min/max both when knob is focused and during numerical entry
            tuneKnob.dispatchEvent({ type: 'keydown', key: 'Home', preventDefault: () => { } });
            assertEqual(entryProg.getValue('OSC1_TUNE'), 40, 'Home key on focused knob sets raw min (40)');
            tuneKnob.dispatchEvent({ type: 'keydown', key: 'End', preventDefault: () => { } });
            assertEqual(entryProg.getValue('OSC1_TUNE'), 88, 'End key on focused knob sets raw max (88)');
            entryProg.setValue('OSC1_TUNE', 64);
            tuneValEl.dispatchEvent({ type: 'click', stopPropagation: () => { } });
            tuneInput = tuneValEl.querySelector('input');
            tuneInput.dispatchEvent({ type: 'keydown', key: 'Home', preventDefault: () => { }, stopPropagation: () => { } });
            assertEqual(tuneInput.value, '-24', 'Home key during numerical entry updates input to visible min (-24)');
            assertEqual(entryProg.getValue('OSC1_TUNE'), 40, 'Home key during numerical entry sets raw min (40)');
            tuneInput.dispatchEvent({ type: 'keydown', key: 'End', preventDefault: () => { }, stopPropagation: () => { } });
            assertEqual(tuneInput.value, '24', 'End key during numerical entry updates input to visible max (24)');
            assertEqual(entryProg.getValue('OSC1_TUNE'), 88, 'End key during numerical entry sets raw max (88)');
            tuneInput.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault: () => { } });

            // 5c. Disallow non-numeric keystrokes during numerical entry
            tuneValEl.dispatchEvent({ type: 'click', stopPropagation: () => { } });
            tuneInput = tuneValEl.querySelector('input');
            const isKeyPrevented = (key, extra = {}) => {
                let prevented = false;
                tuneInput.dispatchEvent({ type: 'keydown', key, preventDefault: () => { prevented = true; }, stopPropagation: () => { }, ...extra });
                return prevented;
            };
            assert(isKeyPrevented('a'), 'Letter "a" is disallowed during numerical entry');
            assert(isKeyPrevented('.'), 'Decimal point "." is disallowed during numerical entry');
            assert(isKeyPrevented(' '), 'Space is disallowed during numerical entry');
            assert(!isKeyPrevented('5'), 'Digit "5" is allowed during numerical entry');
            assert(!isKeyPrevented('+'), 'Plus "+" is allowed during numerical entry');
            assert(!isKeyPrevented('-'), 'Minus "-" is allowed during numerical entry');
            assert(!isKeyPrevented('Backspace'), 'Backspace is allowed during numerical entry');
            assert(!isKeyPrevented('Tab'), 'Tab is allowed during numerical entry');
            assert(!isKeyPrevented('a', { metaKey: true }), 'Cmd+A shortcut is allowed during numerical entry');
            tuneInput.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault: () => { } });

            valEl.dispatchEvent({ type: 'click', stopPropagation: () => { } });
            const unipolarInput = valEl.querySelector('input');
            let unipolarMinusPrevented = false;
            unipolarInput.dispatchEvent({ type: 'keydown', key: '-', preventDefault: () => { unipolarMinusPrevented = true; }, stopPropagation: () => { } });
            assert(unipolarMinusPrevented, 'Minus "-" is disallowed during numerical entry on unipolar knobs');
            unipolarInput.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault: () => { } });

            // 6. Visible scale & clamping for displayOffset (LAY_TEMPO: 40..295, raw 0..255, displayOffset 40)
            entryProg.setValue('LAY_TEMPO', 80); // visible 120
            const tempoKnob = createKnob('LAY_TEMPO', entryProg, () => { });
            const tempoValEl = tempoKnob.querySelector('.knob-value');
            tempoValEl.dispatchEvent({ type: 'click', stopPropagation: () => { } });
            let tempoInput = tempoValEl.querySelector('input');
            assertEqual(tempoInput.value, '120', 'displayOffset knob opens with visible scale (120)');
            tempoInput.value = '10';
            tempoInput.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault: () => { } });
            assertEqual(entryProg.getValue('LAY_TEMPO'), 0, 'Typing below visible min (10 < 40) clamps to raw min (0)');
            tempoValEl.dispatchEvent({ type: 'click', stopPropagation: () => { } });
            tempoInput = tempoValEl.querySelector('input');
            tempoInput.value = '500';
            tempoInput.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault: () => { } });
            assertEqual(entryProg.getValue('LAY_TEMPO'), 255, 'Typing above visible max (500 > 295) clamps to raw max (255)');
        }

        // Oscillator Solo/Mute Mutual Cancellation (single oscillator)
        const oscApp = new App();
        oscApp.activeTimbre.setValue('MIX_OSC1', 100);
        oscApp.activeTimbre.setValue('MIX_OSC2', 80);
        const oscOnlyPanel = oscApp.createOscillatorPanel(oscApp.activeTimbre, () => { });
        const oscSoloMuteGroup = oscOnlyPanel.querySelector('.solo-mute-group');
        const oscMuteBtn = oscSoloMuteGroup ? oscSoloMuteGroup.querySelector('.btn-mute') : null;
        const oscSoloBtn = oscSoloMuteGroup ? oscSoloMuteGroup.querySelector('.btn-solo') : null;
        assert(oscMuteBtn !== null && oscSoloBtn !== null, 'Oscillator mute and solo buttons exist');

        oscApp.selectedOsc = 1;
        oscMuteBtn.click();
        assertEqual(oscApp.muteState.osc1, true, 'Osc 1 mute sets muteState.osc1 to true');
        assertEqual(oscApp.soloState.osc1, false, 'Osc 1 soloState remains false');
        assertEqual(oscApp.activeTimbre.getValue('MIX_OSC1'), 0, 'Osc 1 level muted to 0');

        oscSoloBtn.click();
        assertEqual(oscApp.soloState.osc1, true, 'Clicking Osc 1 solo sets soloState.osc1 to true');
        assertEqual(oscApp.muteState.osc1, false, 'Clicking Osc 1 solo cancels muteState.osc1');
        assert(oscSoloBtn.classList.contains('active'), 'Osc 1 solo button is active');
        assert(!oscMuteBtn.classList.contains('active'), 'Osc 1 mute button is deactivated');
        assertEqual(oscApp.activeTimbre.getValue('MIX_OSC1'), 100, 'Osc 1 level restored when soloed');
        assertEqual(oscApp.activeTimbre.getValue('MIX_OSC2'), 0, 'Osc 2 level muted when Osc 1 soloed');

        oscMuteBtn.click();
        assertEqual(oscApp.muteState.osc1, true, 'Clicking Osc 1 mute sets muteState.osc1 to true');
        assertEqual(oscApp.soloState.osc1, false, 'Clicking Osc 1 mute cancels soloState.osc1');
        assert(oscMuteBtn.classList.contains('active'), 'Osc 1 mute button is active');
        assert(!oscSoloBtn.classList.contains('active'), 'Osc 1 solo button is deactivated');
        assertEqual(oscApp.activeTimbre.getValue('MIX_OSC1'), 0, 'Osc 1 level muted to 0');
        assertEqual(oscApp.activeTimbre.getValue('MIX_OSC2'), 80, 'Osc 2 level restored when Osc 1 solo cancelled by mute');

        // Selecting solo on Osc 2 does not cancel mute on Osc 1
        oscApp.selectedOsc = 2;
        oscSoloBtn.click();
        assertEqual(oscApp.soloState.osc2, true, 'Osc 2 soloState is true');
        assertEqual(oscApp.muteState.osc1, true, 'Osc 1 muteState is preserved when soloing Osc 2');
    });

    await runSection('\n--- [21] Voice Panel Glide Label ---', async () => {
        assertEqual(PARAM_MAP.get('VCE_GLIDE').label, 'Glide', 'VCE_GLIDE knob label is "Glide"');
    });

    await runSection('\n--- [22] Voice Panel Pitch Bend Down Range ---', async () => {
        const downDef = PARAM_MAP.get('VCE_PBRANGE_DOWN');
        assertEqual(downDef.min, 52, 'Down min raw value is 52 (-12)');
        assertEqual(downDef.max, 64, 'Down max raw value is 64 (0)');

        const downProg = new MM2Program();
        downProg.setValue('VCE_PBRANGE_DOWN', 10);
        assertEqual(downProg.getValue('VCE_PBRANGE_DOWN'), 52, 'Down clamps below -12 to 52');
        downProg.setValue('VCE_PBRANGE_DOWN', 100);
        assertEqual(downProg.getValue('VCE_PBRANGE_DOWN'), 64, 'Down clamps above 0 to 64');
        downProg.setValue('VCE_PBRANGE_DOWN', 62);

        assertEqual(formatParamDisplay(downDef, 52), '-12', 'Down displays -12 at minimum');
        assertEqual(formatParamDisplay(downDef, 64), '0', 'Down displays 0 at maximum');

        const downKnob = createKnob('VCE_PBRANGE_DOWN', () => downProg, () => { });
        const downCanvas = downKnob.querySelector('canvas') || downKnob;
        downCanvas.dispatchEvent({ type: 'pointerdown', clientX: 100, clientY: 100, preventDefault: () => { } });
        window.dispatchEvent({ type: 'pointermove', clientX: 100, clientY: -1000 }); // drag far up
        assertEqual(downProg.getValue('VCE_PBRANGE_DOWN'), 64, 'Dragging Down knob up reaches 0 (raw 64)');
        window.dispatchEvent({ type: 'pointermove', clientX: 100, clientY: 1000 }); // drag far down
        assertEqual(downProg.getValue('VCE_PBRANGE_DOWN'), 52, 'Dragging Down knob down reaches -12 (raw 52)');
        window.dispatchEvent({ type: 'pointerup' });
    });

    await runSection('\n--- [23] Random LFO Cycle Graphics ---', async () => {
        const lfoProg = new MM2Program();
        const renderLfoYs = (wave, speed) => {
            lfoProg.setValue('LFO1_WAVE', wave);
            lfoProg.setValue('LFO1_SPEED', speed);
            const preview = createLFOWaveformPreview(1, () => lfoProg);
            const d = preview.children[0].children[0].getAttribute('d');
            return d.split(/[ML]/).map(s => s.trim()).filter(Boolean).map(s => parseFloat(s.split(/\s+/)[1]));
        };
        const countTurns = (ys) => {
            let turns = 0;
            let prevDir = 0;
            for (let i = 1; i < ys.length; i++) {
                const diff = ys[i] - ys[i - 1];
                if (Math.abs(diff) < 1e-6) continue;
                const dir = diff > 0 ? 1 : -1;
                if (prevDir !== 0 && dir !== prevDir) turns++;
                prevDir = dir;
            }
            return turns;
        };

        const randBi = renderLfoYs(5, 0);
        const randUni = renderLfoYs(18, 0);
        assert(countTurns(randBi) >= 4, 'Random Bipolar at slowest speed has multiple peaks and valleys');
        assert(countTurns(randUni) >= 4, 'Random Unipolar at slowest speed has multiple peaks and valleys');
        assert(Math.min(...randUni) >= 5 - 1e-6 && Math.max(...randUni) <= 25 + 1e-6, 'Random Unipolar stays within the graph height');
        assert(new Set(randBi.map(y => y.toFixed(3))).size > 40, 'Random Bipolar trace is not a flat or stepped line');

        // S&H graphics are unchanged: held levels only (at most 2 at the slowest speed; the last sample
        // lands on the next cycle boundary)
        const shBi = renderLfoYs(4, 0);
        assert(new Set(shBi.map(y => y.toFixed(3))).size <= 2, 'S&H Bipolar remains held levels at slowest speed');

        // Random traces morph smoothly as speed changes (adjacent speed steps barely differ)
        for (const wave of [5, 18]) {
            let worstMeanDiff = 0;
            let prev = renderLfoYs(wave, 0);
            for (let s = 1; s <= 127; s++) {
                const cur = renderLfoYs(wave, s);
                const meanDiff = cur.reduce((a, y, i) => a + Math.abs(y - prev[i]), 0) / cur.length;
                worstMeanDiff = Math.max(worstMeanDiff, meanDiff);
                prev = cur;
            }
            assert(worstMeanDiff < 1.5, `Random wave ${wave} changes smoothly with speed (worst mean step ${worstMeanDiff.toFixed(2)})`);
        }
    });

    await runSection('\n--- [53] Filter Peak Dot Dragging Tests ---', async () => {
        const fltApp = new App();
        fltApp.activeTimbre.setValue('FILTER_FREQ', 128);
        fltApp.activeTimbre.setValue('FILTER_RESO', 0);
        const fltOnChange = (key, val, meta) => fltApp.onParameterChanged(key, val, meta);
        fltOnChange.beginGroup = (label) => fltApp.beginUndoGroup(label);
        fltOnChange.endGroup = () => fltApp.endUndoGroup();

        const fltViz = createFilterCurveVisualizer(() => fltApp.activeTimbre, fltOnChange);
        const svgEl = fltViz.children[0];
        svgEl.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 48 });
        const dot = svgEl.children.find(c => c.getAttribute('class') === 'filter-cutoff-point');
        assert(dot !== null && dot !== undefined, 'Filter cutoff/peak dot exists');

        const makePtrEvent = (type, clientX, clientY) => ({
            type,
            clientX,
            clientY,
            preventDefault() { },
            stopPropagation() { }
        });

        // 1. pointerdown does not mutate values or create undo entry
        dot.dispatchEvent(makePtrEvent('pointerdown', 100, 20));
        assert(dot.classList.contains('dragging'), 'Dot gains .dragging class on pointerdown');
        assertEqual(fltApp.activeTimbre.getValue('FILTER_FREQ'), 128, 'pointerdown does not change FILTER_FREQ');
        assertEqual(fltApp.activeTimbre.getValue('FILTER_RESO'), 0, 'pointerdown does not change FILTER_RESO');
        assertEqual(fltApp.undoStack.length, 0, 'pointerdown creates 0 undo entries');

        // 2. pointermove right & up updates both FILTER_FREQ and FILTER_RESO simultaneously
        window.dispatchEvent(makePtrEvent('pointermove', 194, 8));
        const movedFreq = fltApp.activeTimbre.getValue('FILTER_FREQ');
        const movedReso = fltApp.activeTimbre.getValue('FILTER_RESO');
        assertEqual(movedFreq, 255, 'Dragging dot to right edge sets FILTER_FREQ to 255');
        assert(movedReso > 50, `Dragging dot upward increases FILTER_RESO (got ${movedReso})`);
        assertEqual(dot.getAttribute('cx'), '194.00', 'Dot cx updates to match dragged cutoff');
        assertEqual(fltApp.undoStack.length, 0, 'Interim drag creates 0 undo entries');

        // 3. pointerup commits a single atomic undo step for both Cutoff & Resonance
        window.dispatchEvent(makePtrEvent('pointerup', 194, 8));
        assert(!dot.classList.contains('dragging'), 'Dot loses .dragging class on pointerup');
        assertEqual(fltApp.undoStack.length, 1, 'Releasing dot creates 1 atomic undo entry');
        assertEqual(fltApp.undoStack[0].type, 'batch', 'Undo entry is a batch group');

        // 4. Single Undo restores both FILTER_FREQ and FILTER_RESO
        fltApp.undo();
        assertEqual(fltApp.activeTimbre.getValue('FILTER_FREQ'), 128, 'Single Undo restores FILTER_FREQ');
        assertEqual(fltApp.activeTimbre.getValue('FILTER_RESO'), 0, 'Single Undo restores FILTER_RESO');

        // 5. Single Redo reapplies both FILTER_FREQ and FILTER_RESO
        fltApp.redo();
        assertEqual(fltApp.activeTimbre.getValue('FILTER_FREQ'), 255, 'Single Redo reapplies FILTER_FREQ');
        assertEqual(fltApp.activeTimbre.getValue('FILTER_RESO'), movedReso, 'Single Redo reapplies FILTER_RESO');
    });

    await runSection('\n--- [56] LFO & Mod Matrix Inline Action Cleanup Tests ---', async () => {
        const prevGetEl56 = document.getElementById;
        try {
            const modGrid = document.createElement('div');
            modGrid.id = 'editor-grid';
            document.getElementById = (id) => (id === 'editor-grid' ? modGrid : prevGetEl56(id));

            const cleanApp = new App();
            cleanApp.buildEditorUI();

            const lfoCards = modGrid.querySelectorAll('.lfo-sub-card');
            assertEqual(lfoCards.length, 3, 'Renders 3 LFO sub-cards');
            lfoCards.forEach((card, idx) => {
                const actionsEl = card.querySelector('.matrix-slot-actions');
                const btns = actionsEl ? actionsEl.querySelectorAll('.btn-slot-icon') : [];
                assertEqual(btns.length, 2, `LFO ${idx + 1} has only Randomize and Reset buttons (no Copy/Paste)`);
                assert(btns.every(b => !/copy|paste/i.test(b.title || '')), `LFO ${idx + 1} has no Copy/Paste button`);
            });

            const mtxRows = modGrid.querySelectorAll('.matrix-slot-row');
            assertEqual(mtxRows.length, 12, 'Renders 12 Mod Matrix slot rows');
            mtxRows.forEach((row, idx) => {
                const actionsEl = row.querySelector('.matrix-slot-actions');
                const btns = actionsEl ? actionsEl.querySelectorAll('.btn-slot-icon') : [];
                assertEqual(btns.length, 2, `Matrix Slot ${idx + 1} has only Randomize and Clear buttons (no Copy/Paste)`);
                assert(btns.every(b => !/copy|paste/i.test(b.title || '')), `Matrix Slot ${idx + 1} has no Copy/Paste button`);
            });
        } catch (e) {
            logger(`  Error: ${e.message}`);
            failed++;
        } finally {
            document.getElementById = prevGetEl56;
        }

        // Section 57: Multiplier Reset Button Tests
    });

    await runSection('\n--- [57] Multiplier Reset Button Tests ---', async () => {
        const prevGetEl57 = document.getElementById;
        try {
            const modGrid = document.createElement('div');
            modGrid.id = 'editor-grid';
            document.getElementById = (id) => (id === 'editor-grid' ? modGrid : prevGetEl57(id));

            const multApp = new App();
            multApp.activeTimbre.setValue('MULT_A1', 18);
            multApp.activeTimbre.setValue('MULT_B1', 12);
            multApp.buildEditorUI();

            const multPanels = modGrid.querySelectorAll('.math-sub-panel');
            const mult1Panel = multPanels.find(p => p.getAttribute('data-mult') === 1 || p.getAttribute('data-mult') === '1');
            assert(mult1Panel !== undefined, 'Multiplier 1 panel exists');

            const resetBtn = mult1Panel.querySelector('.btn-slot-clear');
            assert(resetBtn !== null && resetBtn !== undefined, 'Multiplier 1 has a reset button');

            resetBtn.onclick();
            assertEqual(multApp.activeTimbre.getValue('MULT_A1'), 0, 'Reset sets MULT_A1 to default 0');
            assertEqual(multApp.activeTimbre.getValue('MULT_B1'), 0, 'Reset sets MULT_B1 to default 0');
            assertEqual(multApp.undoStack.length, 1, 'Multiplier reset records 1 atomic undo entry');

            multApp.undo();
            assertEqual(multApp.activeTimbre.getValue('MULT_A1'), 18, 'Undo restores MULT_A1');
            assertEqual(multApp.activeTimbre.getValue('MULT_B1'), 12, 'Undo restores MULT_B1');

            multApp.redo();
            assertEqual(multApp.activeTimbre.getValue('MULT_A1'), 0, 'Redo reapplies MULT_A1 reset');
            assertEqual(multApp.activeTimbre.getValue('MULT_B1'), 0, 'Redo reapplies MULT_B1 reset');
        } catch (e) {
            logger(`  Error: ${e.message}`);
            failed++;
        } finally {
            document.getElementById = prevGetEl57;
        }

        // Section 58: LFO Drag-to-Destination Mod Matrix Mapping Tests
    });

    await runSection('\n--- [61] Filter Visualizer Self-Oscillation Singularity Tests ---', async () => {
        const singProg = new MM2Program();
        singProg.setValue('FILTER_FREQ', 170);
        singProg.setValue('FILTER_RESO', 127);

        for (let algo = 0; algo <= 7; algo++) {
            singProg.setValue('FILTER_ALGO', algo);
            const viz = createFilterCurveVisualizer(() => singProg, () => { });
            const svgEl = viz.children[0];
            const paths = svgEl.children.filter(c => c.tagName === 'PATH');
            const dot = svgEl.children.find(c => c.getAttribute('class') === 'filter-cutoff-point');

            paths.forEach((p, idx) => {
                const d = p.getAttribute('d') || '';
                assert(!d.includes('NaN') && !d.includes('Infinity'), `Algo ${algo} path ${idx} contains no NaN/Infinity at cutoff=170 reso=127`);
            });
            const cx = dot.getAttribute('cx') || '';
            const cy = dot.getAttribute('cy') || '';
            assert(!cx.includes('NaN') && !cy.includes('NaN'), `Algo ${algo} cutoff dot has finite coordinates (${cx}, ${cy})`);
        }
    });

    await runSection('\n--- [63] Sequencer Control Cleanups (Note/Mod Sections, A, Copy Targets) ---', async () => {
        const seqCleanProg = new MM2Program();
        const seqCleanEl = createArpSequencer(() => seqCleanProg, () => { });
        const titleEl = seqCleanEl.querySelector('.sequencer-title');
        const noteTools = seqCleanEl.querySelector('#seq-note-tools');
        const modTools = seqCleanEl.querySelector('#seq-mod-tools');
        const clearBtn = seqCleanEl.querySelector('#seq-clear-btn');
        const randBtn = seqCleanEl.querySelector('#seq-random-btn');
        const autoBtn = seqCleanEl.querySelector('#seq-note-auto-btn');
        const modRandBtn = seqCleanEl.querySelector('#seq-mod-random-btn');
        const modClearBtn = seqCleanEl.querySelector('#seq-mod-clear-btn');

        assertEqual(titleEl.textContent, 'SEQUENCER', 'Sequencer title is SEQUENCER');
        assert(noteTools !== null && modTools !== null, 'Sequencer renders separate Note and Mod tool sections');
        assertEqual(noteTools.querySelector('.seq-group-label').textContent, 'Note', 'Note section has Note label');
        assertEqual(modTools.querySelector('.seq-group-label').textContent, 'Mod', 'Mod section has Mod label');
        assert(clearBtn.className.includes('btn-slot-icon') && clearBtn.className.includes('btn-slot-clear'), 'seq-clear-btn uses slot icon clear classes');
        assert(!clearBtn.className.includes('btn-subtle'), 'seq-clear-btn does not use btn-subtle color override');
        assertEqual(clearBtn.textContent, '✕', 'seq-clear-btn renders ✕ icon');
        assert(randBtn.className.includes('btn-slot-icon'), 'seq-random-btn uses slot icon class');
        assert(!randBtn.className.includes('btn-subtle'), 'seq-random-btn does not use btn-subtle color override');
        assert(randBtn.innerHTML.includes('<svg'), 'seq-random-btn renders SVG randomize icon');
        assert(autoBtn !== null && autoBtn.textContent === 'A', 'Note section renders A (Auto) button');
        assert(modRandBtn !== null && modRandBtn.innerHTML.includes('<svg'), 'Mod section renders Random SVG button');
        assert(modClearBtn !== null && modClearBtn.textContent === '✕', 'Mod section renders Clear ✕ button');

        // Note A button sets Note steps to Auto (0) without altering Mod levels
        for (let i = 1; i <= 16; i++) {
            const n = String(i).padStart(2, '0');
            seqCleanProg.setValue(`ARP_PTN_STEP${n}`, 11);
            seqCleanProg.setValue(`ARP_PTN_STEP_MOD${n}`, 3);
        }
        autoBtn.click();
        assertEqual(seqCleanProg.getValue('ARP_PTN_STEP01'), 0, 'Note A button sets step 1 Note to Auto (0)');
        assertEqual(seqCleanProg.getValue('ARP_PTN_STEP16'), 0, 'Note A button sets step 16 Note to Auto (0)');
        assertEqual(seqCleanProg.getValue('ARP_PTN_STEP_MOD01'), 3, 'Note A button preserves Mod level');

        // Note Clear button sets Note steps to Off (1) without altering Mod levels
        seqCleanProg.setValue('ARP_PTN_STEP_MOD01', 2);
        clearBtn.click();
        assertEqual(seqCleanProg.getValue('ARP_PTN_STEP01'), 1, 'Note Clear sets step 1 Note to Off (1)');
        assertEqual(seqCleanProg.getValue('ARP_PTN_STEP_MOD01'), 2, 'Note Clear preserves Mod level');

        // Mod Clear button sets Mod levels to Mid (1) without altering Note steps
        seqCleanProg.setValue('ARP_PTN_STEP01', 6);
        modClearBtn.click();
        assertEqual(seqCleanProg.getValue('ARP_PTN_STEP_MOD01'), 1, 'Mod Clear resets step 1 Mod level to Mid (1)');
        assertEqual(seqCleanProg.getValue('ARP_PTN_STEP_MOD16'), 1, 'Mod Clear resets step 16 Mod level to Mid (1)');
        assertEqual(seqCleanProg.getValue('ARP_PTN_STEP01'), 6, 'Mod Clear preserves Note mode');

        // Mod Random button randomizes Mod levels without altering Note steps
        modRandBtn.click();
        assertEqual(seqCleanProg.getValue('ARP_PTN_STEP01'), 6, 'Mod Random preserves Note mode');

        // Chords toggle + arrow inside Note section (defaults to ON)
        const chordsBtn = seqCleanEl.querySelector('#seq-chords-btn');
        const chordsArrow = seqCleanEl.querySelector('.seq-tool-arrow');
        assert(noteTools.children.indexOf(chordsBtn) < noteTools.children.indexOf(clearBtn), 'Chords toggle appears to the left of Note Clear button');
        assert(noteTools.children.indexOf(randBtn) < noteTools.children.indexOf(clearBtn), 'Note Random button appears to the left of Note Clear button');
        assert(chordsArrow !== null && chordsArrow.textContent === '←', 'Left-facing arrow indicator (←) is rendered');
        assert(noteTools.children.indexOf(chordsBtn) < noteTools.children.indexOf(chordsArrow) &&
            noteTools.children.indexOf(chordsArrow) < noteTools.children.indexOf(randBtn), 'Left-facing arrow appears between Chords toggle and Note Random button');
        assert(chordsBtn !== null, 'seq-chords-btn toggle exists');
        assert(chordsBtn.className.includes('btn-param-toggle'), 'seq-chords-btn uses btn-param-toggle styling');
        assertEqual(chordsBtn.querySelector('.toggle-label').textContent, 'Chords', 'Chords toggle label is Chords');
        const chordsBadge = chordsBtn.querySelector('.toggle-state-badge');
        assert(chordsBadge !== null, 'Chords toggle includes OFF/ON state badge');
        assertEqual(chordsBadge.textContent, 'ON', 'Chords toggle state badge starts as ON');
        assert(chordsBtn.className.includes('active'), 'Chords toggle starts with active class');
        assertEqual(chordsBtn.getAttribute('aria-pressed'), 'true', 'Chords toggle aria-pressed starts true');

        chordsBtn.click();
        assert(!chordsBtn.className.includes('active'), 'Chords toggle removes active class when OFF');
        assertEqual(chordsBtn.getAttribute('aria-pressed'), 'false', 'Chords toggle aria-pressed updates to false');
        assertEqual(chordsBadge.textContent, 'OFF', 'Chords toggle state badge updates to OFF');

        let sawChord = false;
        for (let run = 0; run < 20; run++) {
            randBtn.click();
            for (let i = 1; i <= 16; i++) {
                const n = String(i).padStart(2, '0');
                if (seqCleanProg.getValue(`ARP_PTN_STEP${n}`) === 11) {
                    sawChord = true;
                    break;
                }
            }
            if (sawChord) break;
        }
        assertEqual(sawChord, false, 'Randomize omits Chord (11) when Chords toggle is OFF');
    });

    await runSection('\n--- [64] Control Focus Cleanup Tests ---', async () => {
        const focusProg = new MM2Program();

        // Toggle button blurs after click
        const toggleWrap = createToggleButton('ARP_OFF_ON', focusProg);
        const toggleBtn = toggleWrap.querySelector('button') || toggleWrap.children[0];
        let toggleBlurred = false;
        toggleBtn.blur = () => { toggleBlurred = true; };
        toggleBtn.click();
        assertEqual(toggleBlurred, true, 'Toggle button blurs after click');

        // Select blurs after change
        const selectWrap = createSelect('FILTER_ALGO', focusProg);
        const selectEl = selectWrap.querySelector('.control-select');
        let selectBlurred = false;
        selectEl.blur = () => { selectBlurred = true; };
        selectEl.value = '1';
        selectEl.dispatchEvent({ type: 'change', target: selectEl });
        assertEqual(selectBlurred, true, 'Select blurs after change');

        // Knob blurs after dblclick, wheel, and pointerup
        const knobWrap = createKnob('FILTER_FREQ', focusProg);
        let knobBlurs = 0;
        knobWrap.blur = () => { knobBlurs++; };
        knobWrap.dispatchEvent({ type: 'dblclick', preventDefault: () => {} });
        assertEqual(knobBlurs, 1, 'Knob blurs after dblclick reset');
        knobWrap.dispatchEvent({ type: 'wheel', deltaY: -10, preventDefault: () => {} });
        assertEqual(knobBlurs, 2, 'Knob blurs after wheel');

        const canvas = knobWrap.querySelector('.knob-canvas');
        const origWinAdd = window.addEventListener;
        const origWinRem = window.removeEventListener;
        const winHandlers = new Map();
        window.addEventListener = (ev, fn) => winHandlers.set(ev, fn);
        window.removeEventListener = (ev) => winHandlers.delete(ev);
        try {
            canvas.dispatchEvent({ type: 'pointerdown', button: 0, clientX: 10, clientY: 10, preventDefault: () => {} });
            const upFn = winHandlers.get('pointerup');
            assert(typeof upFn === 'function', 'Knob registers pointerup listener on drag');
            upFn();
            assertEqual(knobBlurs, 3, 'Knob blurs after pointerup');
        } finally {
            window.addEventListener = origWinAdd;
            window.removeEventListener = origWinRem;
        }

        // Global setupControlFocusCleanup blurs any button on click and select on change
        if (typeof MM2App !== 'undefined' && MM2App.prototype && typeof MM2App.prototype.setupControlFocusCleanup === 'function') {
            const docListeners = [];
            const origDocAdd = document.addEventListener;
            const origBoundFlag = document._mm2FocusCleanupBound;
            document._mm2FocusCleanupBound = false;
            document.addEventListener = (ev, fn, useCapture) => {
                docListeners.push({ ev, fn, useCapture });
            };
            try {
                MM2App.prototype.setupControlFocusCleanup.call({});
                const clickHook = docListeners.find(l => l.ev === 'click' && l.useCapture === true);
                const changeHook = docListeners.find(l => l.ev === 'change' && l.useCapture === true);
                assert(!!clickHook, 'setupControlFocusCleanup registers capture-phase click listener');
                assert(!!changeHook, 'setupControlFocusCleanup registers capture-phase change listener');

                let anyBtnBlurred = false;
                const anyBtn = { tagName: 'BUTTON', blur: () => { anyBtnBlurred = true; } };
                const childInBtn = { tagName: 'SVG', closest: (sel) => (sel === 'button' ? anyBtn : null) };
                clickHook.fn({ target: childInBtn });
                assertEqual(anyBtnBlurred, true, 'Capture click listener blurs ancestor button');

                let anySelectBlurred = false;
                const anySelect = { tagName: 'SELECT', blur: () => { anySelectBlurred = true; } };
                changeHook.fn({ target: anySelect });
                assertEqual(anySelectBlurred, true, 'Capture change listener blurs select element');
            } finally {
                document.addEventListener = origDocAdd;
                document._mm2FocusCleanupBound = origBoundFlag;
            }
        }
    });

    await runSection('\n--- [66] RTZ Toggle Consistency With Phase Reset Tests ---', async () => {
        const prog = new MM2Program();
        const rtzEl = createToggleButton('ENV1_RESET', () => prog, () => {});
        const rtzBtn = rtzEl.querySelector('button.btn-param-toggle');
        const rtzLabel = rtzBtn ? rtzBtn.querySelector('.toggle-label') : null;
        const rtzBadge = rtzBtn ? rtzBtn.querySelector('.toggle-state-badge') : null;

        assert(rtzBtn !== null, 'RTZ renders a btn-param-toggle button');
        assertEqual(rtzLabel && rtzLabel.textContent, 'RTZ', 'RTZ button label is RTZ');
        assert(rtzBadge !== null, 'RTZ button includes toggle-state-badge');
        assertEqual(rtzBadge.textContent, 'OFF', 'RTZ state badge starts as OFF');

        rtzBtn.click();
        assertEqual(prog.getValue('ENV1_RESET'), 1, 'Clicking RTZ sets ENV1_RESET to 1');
        assert(rtzBtn.classList.contains('active'), 'RTZ button gains active class when ON');
        assertEqual(rtzBadge.textContent, 'ON', 'RTZ state badge updates to ON');
    });

});
