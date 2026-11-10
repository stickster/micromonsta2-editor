/**
 * Comprehensive Automated Test Suite for MicroMonsta 2 Editor & Patch Librarian
 */

// Headless Node mock DOM support for control unit tests
if (typeof document === 'undefined') {
    class MockElement {
        constructor(tag) {
            this.tagName = (tag || 'div').toUpperCase();
            this.children = [];
            this.attributes = new Map();
            const classes = new Set();
            this.classList = {
                _classes: classes,
                add: (c) => classes.add(c),
                remove: (c) => classes.delete(c),
                toggle: (c, force) => {
                    if (force !== undefined) {
                        if (force) classes.add(c);
                        else classes.delete(c);
                    } else {
                        if (classes.has(c)) classes.delete(c);
                        else classes.add(c);
                    }
                },
                contains: (c) => classes.has(c)
            };
            this.style = {};
            this._listeners = new Map();
            this.value = '';
            this.textContent = '';
        }
        get className() {
            return Array.from(this.classList._classes).join(' ');
        }
        set className(str) {
            this.classList._classes.clear();
            if (str) {
                str.trim().split(/\s+/).forEach(c => this.classList._classes.add(c));
            }
        }
        appendChild(child) {
            this.children.push(child);
            return child;
        }
        setAttribute(k, v) { this.attributes.set(k, String(v)); }
        getAttribute(k) { return this.attributes.get(k) ?? null; }
        hasAttribute(k) { return this.attributes.has(k); }
        addEventListener(ev, fn) {
            if (!this._listeners.has(ev)) this._listeners.set(ev, []);
            this._listeners.get(ev).push(fn);
        }
        removeEventListener(ev, fn) {
            if (this._listeners.has(ev)) {
                this._listeners.set(ev, this._listeners.get(ev).filter(f => f !== fn));
            }
        }
        dispatchEvent(event) {
            const list = this._listeners.get(event.type) || [];
            for (const fn of list) fn(event);
        }
        click() {
            this.dispatchEvent({ type: 'click', preventDefault: () => {}, stopPropagation: () => {} });
        }
        querySelector(sel) {
            for (const ch of this.children) {
                if (sel === 'button' && ch.tagName === 'BUTTON') return ch;
                if (sel === 'input[type="range"]' && ch.tagName === 'INPUT' && ch.type === 'range') return ch;
                if (sel === '.bipolar-val' && ch.classList.contains('bipolar-val')) return ch;
                if (sel === 'button.btn-param-toggle' && ch.tagName === 'BUTTON' && ch.classList.contains('btn-param-toggle')) return ch;
                if (ch.querySelector) {
                    const sub = ch.querySelector(sel);
                    if (sub) return sub;
                }
            }
            return null;
        }
        querySelectorAll(sel) {
            const res = [];
            for (const ch of this.children) {
                if (sel === '[data-param]' && ch.hasAttribute('data-param')) res.push(ch);
                if (ch.querySelectorAll) res.push(...ch.querySelectorAll(sel));
            }
            return res;
        }
    }
    globalThis.document = {
        createElement: (tag) => new MockElement(tag),
        getElementById: (id) => null,
        querySelector: () => null,
        querySelectorAll: () => []
    };
    if (typeof Event === 'undefined') {
        globalThis.Event = class {
            constructor(type) { this.type = type; }
        };
    }
}

async function runAllTests(logger = console.log) {
    let passed = 0;
    let failed = 0;

    function assert(condition, testName) {
        if (condition) {
            passed++;
            logger(`✓ PASS: ${testName}`);
        } else {
            failed++;
            logger(`✗ FAIL: ${testName}`);
            throw new Error(`Assertion failed: ${testName}`);
        }
    }

    function assertEqual(actual, expected, testName) {
        if (actual === expected) {
            passed++;
            logger(`✓ PASS: ${testName}`);
        } else {
            failed++;
            logger(`✗ FAIL: ${testName} (Expected ${expected}, got ${actual})`);
            throw new Error(`Assertion failed: ${testName} (Expected ${expected}, got ${actual})`);
        }
    }

    logger('\n--- [1] SysEx Validation Tests ---');
    try {
        assertEqual(validateSysEx(INIT_PROGRAM_BYTES), 3, 'Validates default v3 Init Program');

        const badHeader = new Uint8Array(INIT_PROGRAM_BYTES);
        badHeader[1] = 0x7F;
        assertEqual(validateSysEx(badHeader), 0, 'Rejects invalid SysEx manufacturer header');

        const badLength = new Uint8Array(200);
        assertEqual(validateSysEx(badLength), 0, 'Rejects non-standard SysEx length');

        const nonMidiBytes = new Uint8Array(INIT_PROGRAM_BYTES);
        nonMidiBytes[20] = 0x80; // Byte > 127
        assertEqual(validateSysEx(nonMidiBytes), 0, 'Rejects SysEx packet with data byte > 127');
    } catch (e) {
        logger(`  Error: ${e.message}`);
    }

    logger('\n--- [2] MM2Program Parameter & Serialization Tests ---');
    try {
        const prog = new MM2Program();
        assertEqual(prog.name, 'INIT', 'Default program name is INIT');
        assertEqual(prog.category, 13, 'Default program category is 13 (User1/Misc)');

        prog.name = 'ACIDPAD';
        assertEqual(prog.name, 'ACIDPAD', 'Correctly updates program name');

        // Test 7-bit parameter
        prog.setValue('OSC1_SHAPE', 64);
        assertEqual(prog.getValue('OSC1_SHAPE'), 64, 'Sets and gets 7-bit parameter OSC1_SHAPE');

        // Test parameter clamping
        prog.setValue('OSC1_SHAPE', 999);
        assertEqual(prog.getValue('OSC1_SHAPE'), 127, 'Clamps parameter above maximum to 127');

        prog.setValue('OSC1_SHAPE', -50);
        assertEqual(prog.getValue('OSC1_SHAPE'), 0, 'Clamps parameter below minimum to 0');

        // Test 14-bit (long) parameter (e.g. FILTER_FREQ: 0..255)
        prog.setValue('FILTER_FREQ', 215);
        assertEqual(prog.getValue('FILTER_FREQ'), 215, 'Sets and gets 14-bit long parameter FILTER_FREQ');

        // Test SysEx serialization roundtrip
        const serialized = prog.toSysEx(0); // Layer A
        assertEqual(serialized.length, SYSEX_V3_LEN, 'Serialized SysEx length is exactly 216 bytes');
        assertEqual(serialized[6], 0x01, 'Serialized SysEx command is 0x01 (Layer A)');

        const roundtrip = new MM2Program(serialized);
        assertEqual(roundtrip.name, 'ACIDPAD', 'Roundtrip deserialized program retains name');
        assertEqual(roundtrip.getValue('FILTER_FREQ'), 215, 'Roundtrip deserialized program retains 14-bit filter cutoff');
        assertEqual(roundtrip.getValue('OSC1_SHAPE'), 0, 'Roundtrip deserialized program retains OSC1_SHAPE');
    } catch (e) {
        logger(`  Error: ${e.message}`);
    }

    logger('\n--- [3] SysEx v2 to v3 Converter Tests ---');
    try {
        // Construct a synthetic valid v2 SysEx program dump (176 bytes)
        const v2 = new Uint8Array(SYSEX_V2_LEN);
        v2.set([0xF0, 0x00, 0x21, 0x22, 0x4D, 0x02, 0x03, 0x21]); // v2.1 header
        v2[SYSEX_V2_LEN - 1] = 0xF7;
        const testNameBytes = new TextEncoder().encode('V2LEGACY');
        v2.set(testNameBytes, 8);
        v2[16] = 2; // Category: Pad

        assertEqual(validateSysEx(v2), 2, 'Validates synthetic v2 program dump');

        const converted = convertV2toV3(v2);
        assertEqual(converted.length, SYSEX_V3_LEN, 'Converted v2->v3 is 216 bytes');
        assertEqual(validateSysEx(converted), 3, 'Converted buffer validates as v3 SysEx');

        const v3Prog = new MM2Program(converted);
        assertEqual(v3Prog.name, 'V2LEGACY', 'Converted program retains original patch name');
        assertEqual(v3Prog.category, 2, 'Converted program retains category index');
    } catch (e) {
        logger(`  Error: ${e.message}`);
    }

    logger('\n--- [4] Bank Multi-Patch Extraction & Librarian Tests ---');
    try {
        const bank = new MM2Bank('Test Bank', 0);
        const p1 = new MM2Program();
        p1.name = 'BASS_01';
        p1.category = 0; // Bass

        const p2 = new MM2Program();
        p2.name = 'LEAD_01';
        p2.category = 1; // Lead

        bank.addProgram(p1);
        bank.addProgram(p2);
        assertEqual(bank.length, 2, 'Bank contains 2 programs');

        // Test multi-patch bank serialization
        const bankBytes = bank.toBankSysEx();
        assertEqual(bankBytes.length, 2 * SYSEX_V3_LEN, 'Bank SysEx size equals 2 * 216 bytes');

        const extracted = extractSysExMessages(bankBytes);
        assertEqual(extracted.length, 2, 'extractSysExMessages accurately splits bank into 2 patches');

        // Test program reordering
        bank.moveProgram(0, 1);
        assertEqual(bank.getProgram(0).name, 'LEAD_01', 'moveProgram reorders programs correctly');
        assertEqual(bank.getProgram(1).name, 'BASS_01', 'Second program moved to slot 1');

        // Test program swapping
        bank.swapPrograms(0, 1);
        assertEqual(bank.getProgram(0).name, 'BASS_01', 'swapPrograms restores slot 0');
        assertEqual(bank.getProgram(1).name, 'LEAD_01', 'swapPrograms restores slot 1');
    } catch (e) {
        logger(`  Error: ${e.message}`);
    }

    logger('\n--- [5] Duplicate Detection & Condensation Tests ---');
    try {
        const bank = new MM2Bank('Dedup Bank', 0);
        const orig = new MM2Program();
        orig.name = 'SOLO_SYN';
        orig.setValue('OSC1_TUNE', 72);
        orig.setValue('FILTER_FREQ', 190);

        // Add original and two identical duplicates
        bank.addProgram(orig);
        bank.addProgram(orig.clone());
        bank.addProgram(orig.clone());

        // Add a different sound
        const diff = orig.clone();
        diff.name = 'DIFF_SYN';
        diff.setValue('FILTER_FREQ', 80);
        bank.addProgram(diff);

        assertEqual(bank.length, 4, 'Bank initially has 4 patches');

        // Run duplicate detection
        const dupInfo = bank.detectDuplicates(true);
        assertEqual(dupInfo.duplicatesFound, 2, 'Detects exactly 2 redundant duplicates');
        assertEqual(dupInfo.groups.length, 1, 'Identifies 1 duplicate group');
        assertEqual(dupInfo.groups[0].entries.length, 3, 'Group contains all 3 matching copies');

        // Remove duplicates
        const removed = bank.removeDuplicates(true);
        assertEqual(removed, 2, 'removeDuplicates removed exactly 2 copies');
        assertEqual(bank.length, 2, 'Bank now contains 2 unique patches');

        // Condense bank test
        const condenseRes = bank.condenseBank({ removeDuplicates: true, removeInits: false });
        assertEqual(condenseRes.finalCount, 2, 'Bank condenser maintains unique patches');
    } catch (e) {
        logger(`  Error: ${e.message}`);
    }

    logger('\n--- [6] MIDI NRPN Generation & Hardware Safe Mode Tests ---');
    try {
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
    } catch (e) {
        logger(`  Error: ${e.message}`);
    }

    logger('\n--- [7] MM2 Detection, Fetch Commands & Timbral Mode Tests ---');
    try {
        // Test fetch SysEx command buffers
        assertEqual(SYSEX_FETCH_A.length, 8, 'SYSEX_FETCH_A is 8 bytes');
        assertEqual(SYSEX_FETCH_A[6], 0x41, 'SYSEX_FETCH_A command byte is 0x41 (ASCII A)');
        assertEqual(SYSEX_FETCH_B.length, 8, 'SYSEX_FETCH_B is 8 bytes');
        assertEqual(SYSEX_FETCH_B[6], 0x42, 'SYSEX_FETCH_B command byte is 0x42 (ASCII B)');

        // Test MM2 port identification
        const midi = new MidiManager();
        assert(midi.isMM2Port({ name: 'H12MIDI-Pro Port 5' }), 'Recognizes H12MIDI-Pro Port 5 as MM2 port');
        assert(midi.isMM2Port({ name: 'MicroMonsta 2 Synthesizer' }), 'Recognizes MicroMonsta by name');
        assert(!midi.isMM2Port({ name: 'H12MIDI-Pro Port 1' }), 'Distinguishes Port 1 from MM2 Port 5');
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
    } catch (e) {
        logger(`  Error: ${e.message}`);
    }

    logger('\n--- [8] Timbral Mode Display-Only Indicator & Hardware State Tests ---');
    try {
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
    } catch (e) {
        logger(`  Error: ${e.message}`);
    }

    logger('\n--- [9] Editor Load vs Librarian Isolation Tests ---');
    try {
        const app = new App();
        const testBank = new MM2Bank('Test Bank', 0);
        app.librarian.banks = [testBank];
        app.librarian.activeBankIndex = 0;
        app.librarian.receivingBankIndex = -1; // Default: auto-capture OFF

        assertEqual(app.currentView, 'editor', 'App initializes in Editor view by default');
        assertEqual(testBank.length, 0, 'Librarian bank starts empty');

        // Simulate incoming MM2 dump when loading Editor
        const incomingPatch = new MM2Program();
        incomingPatch.name = 'HW_PATCH';
        incomingPatch.setValue('FILTER_FREQ', 88);

        app.midi.emit('program-received', { program: incomingPatch, slot: 0 });

        // 1. Editor buffer must be updated
        assertEqual(app.timbreA.name, 'HW_PATCH', 'Editor timbreA loaded incoming hardware patch');
        assertEqual(app.timbreA.getValue('FILTER_FREQ'), 88, 'Editor timbreA parameter updated');

        // 2. Librarian MUST NOT contain this patch
        assertEqual(testBank.length, 0, 'Librarian bank count remains 0 when loading in Editor');

        // 3. handleIncomingProgram directly rejects when receivingBankIndex is -1
        const rejected = app.librarian.handleIncomingProgram(incomingPatch);
        assertEqual(rejected, false, 'handleIncomingProgram rejects when auto-capture is not active');
        assertEqual(testBank.length, 0, 'Bank count remains 0 after rejected capture');

        // 4. Only when auto-capture is explicitly activated does it add to the designated bank
        app.librarian.receivingBankIndex = 0;
        const accepted = app.librarian.handleIncomingProgram(incomingPatch);
        assertEqual(accepted, true, 'handleIncomingProgram accepts when auto-capture is active on bank');
        assertEqual(testBank.length, 1, 'Bank count increments to 1 when auto-capture is enabled');
        assertEqual(testBank.getProgram(0).name, 'HW_PATCH', 'Captured patch stored in librarian bank');
    } catch (e) {
        logger(`  Error: ${e.message}`);
    }

    logger('\n--- [10] Section Drag-and-Drop, Copy, Paste & Smart Randomize Tests ---');
    try {
        const prog = new MM2Program();
        // Setup distinct values on Oscillator 1
        prog.setValue('OSC1_ALGO', 5);
        prog.setValue('OSC1_SHAPE', 99);
        prog.setValue('OSC1_TUNE', 52);
        prog.setValue('OSC1_FINETUNE', 70);
        prog.setValue('MIX_OSC1', 88);

        // Copy Oscillator 1 to Oscillator 2
        const copyRes = copySection('osc', 1, 'osc', 2, prog);
        assert(copyRes, 'copySection succeeded for Osc 1 -> Osc 2');
        assertEqual(prog.getValue('OSC2_ALGO'), 5, 'Osc 2 received Osc 1 algorithm');
        assertEqual(prog.getValue('OSC2_SHAPE'), 99, 'Osc 2 received Osc 1 shape');
        assertEqual(prog.getValue('OSC2_TUNE'), 52, 'Osc 2 received Osc 1 tune');
        assertEqual(prog.getValue('OSC2_FINETUNE'), 70, 'Osc 2 received Osc 1 finetune');
        assertEqual(prog.getValue('MIX_OSC2'), 88, 'Osc 2 received Osc 1 mix level');

        // Test algorithm clamping when copying wavetable (algo > 15) from Osc 2 to Osc 1 (max 15)
        prog.setValue('OSC2_ALGO', 18);
        copySection('osc', 2, 'osc', 1, prog);
        assertEqual(prog.getValue('OSC1_ALGO'), 15, 'Osc 1 clamped wavetable algorithm to max 15');

        // Test Section Clipboard
        prog.setValue('ENV1_ATK', 35);
        prog.setValue('ENV1_DCY', 75);
        prog.setValue('ENV1_SUS', 110);
        prog.setValue('ENV1_REL', 90);

        const clip = copySectionToClipboard('env', 1, prog);
        assert(clip !== null, 'copySectionToClipboard returned valid clipboard entry');
        assertEqual(clip.data.atk, 35, 'Clipboard captured Env 1 attack');

        // Paste to Env 2
        const pasteRes = pasteSectionFromClipboard('env', 2, prog);
        assert(pasteRes, 'pasteSectionFromClipboard succeeded for matching section type');
        assertEqual(prog.getValue('ENV2_ATK'), 35, 'Env 2 received pasted attack');
        assertEqual(prog.getValue('ENV2_SUS'), 110, 'Env 2 received pasted sustain');

        // Reject incompatible section paste (e.g. Env -> LFO)
        const badPaste = pasteSectionFromClipboard('lfo', 1, prog);
        assert(!badPaste, 'pasteSectionFromClipboard correctly rejected type mismatch');

        // Reset section
        resetSectionToInit('osc', 1, prog);
        assertEqual(prog.getValue('OSC1_SHAPE'), 0, 'resetSectionToInit restored Osc 1 shape to default 0');

        // Randomize section
        randomizeSection('flt', 1, prog);
        const randCutoff = prog.getValue('FILTER_FREQ');
        assert(randCutoff >= 0 && randCutoff <= 255, 'randomizeSection generated valid filter cutoff');
    } catch (e) {
        logger(`  Error: ${e.message}`);
    }

    logger('\n--- [11] Live Editing Undo/Redo & Compare Buffer Tests ---');
    try {
        const app = new App();
        const initialCutoff = app.activeTimbre.getValue('FILTER_FREQ'); // Default 255
        assertEqual(initialCutoff, 255, 'Initial filter cutoff is 255');

        // Apply change and verify undo
        app.onParameterChanged('FILTER_FREQ', 180);
        assertEqual(app.undoStack.length, 1, 'Undo stack recorded parameter change');

        app.undo();
        assertEqual(app.activeTimbre.getValue('FILTER_FREQ'), 255, 'Undo restored filter cutoff to 255');
        assertEqual(app.redoStack.length, 1, 'Redo stack contains undid change');

        app.redo();
        assertEqual(app.activeTimbre.getValue('FILTER_FREQ'), 180, 'Redo restored modified cutoff to 180');

        // Test Compare Buffer (A/B testing original vs edited)
        app.originalSnapshotA = app.activeTimbre.clone(); // Snapshot cutoff = 180
        app.activeTimbre.setValue('FILTER_FREQ', 60);     // Edited cutoff = 60

        app.toggleCompare(true); // Switch to Original
        assertEqual(app.isComparing, true, 'Compare mode is active');
        assertEqual(app.activeTimbre.getValue('FILTER_FREQ'), 180, 'Compare mode auditions original sound snapshot');

        app.toggleCompare(false); // Return to Edited
        assertEqual(app.isComparing, false, 'Compare mode exited');
        assertEqual(app.activeTimbre.getValue('FILTER_FREQ'), 60, 'Exiting compare mode restored edited sound');
    } catch (e) {
        logger(`  Error: ${e.message}`);
    }

    logger('\n--- [12] FW v3 Chorder, Scaler, Macro Knobs & Math Operators Tests ---');
    try {
        const prog = new MM2Program();

        // 1. Physical Macro Knobs & Encoder Assignments
        prog.setValue('LAY_POT1_ASSIGN', 16); // Cutoff
        prog.setValue('LAY_POT2_ASSIGN', 17); // Reso
        prog.setValue('LAY_POT3_ASSIGN', 1);  // Mod Knob
        prog.setValue('LAY_ENC1_ASSIGN', 21); // Attack 1
        assertEqual(prog.getValue('LAY_POT1_ASSIGN'), 16, 'Sets LAY_POT1_ASSIGN to 16');
        assertEqual(prog.getValue('LAY_ENC1_ASSIGN'), 21, 'Sets LAY_ENC1_ASSIGN to 21');

        // 2. Math Operators (Lag & Multipliers)
        prog.setValue('LAG_SRC1', 5); // Mod Wheel
        prog.setValue('LAG_AMT1', 64);
        prog.setValue('MULT_A1', 12); // Env 1
        prog.setValue('MULT_B1', 18); // LFO 1
        assertEqual(prog.getValue('LAG_SRC1'), 5, 'Sets LAG_SRC1 to 5');
        assertEqual(prog.getValue('LAG_AMT1'), 64, 'Sets LAG_AMT1 to 64');
        assertEqual(prog.getValue('MULT_A1'), 12, 'Sets MULT_A1 to 12');
        assertEqual(prog.getValue('MULT_B1'), 18, 'Sets MULT_B1 to 18');

        // 3. FW v3 Scaler & Chorder Engine
        prog.setValue('KBD_MIDI_INPUT', 1);
        prog.setValue('KBD_KEY', 4);   // E
        prog.setValue('KBD_SCALE', 1); // Dorian
        prog.setValue('KBD_OCTAVE', 65); // +1 octave
        prog.setValue('KBD_CHORD_EXPAND', 1);
        prog.setValue('CHORD_TYPE1', 1); // TRIAD 1 3 5
        prog.setValue('CHORD_TYPE2', 13); // SUS2
        prog.setValue('CHORD_TYPE7', 28); // 7TH

        assertEqual(prog.getValue('KBD_MIDI_INPUT'), 1, 'Sets KBD_MIDI_INPUT to 1');
        assertEqual(prog.getValue('KBD_KEY'), 4, 'Sets KBD_KEY to 4 (E)');
        assertEqual(prog.getValue('KBD_SCALE'), 1, 'Sets KBD_SCALE to 1 (Dorian)');
        assertEqual(prog.getValue('CHORD_TYPE1'), 1, 'Sets CHORD_TYPE1 to 1');
        assertEqual(prog.getValue('CHORD_TYPE7'), 28, 'Sets CHORD_TYPE7 to 28');

        // 4. SysEx roundtrip serialization retaining new parameters
        const serialized = prog.toSysEx(0);
        const roundtrip = new MM2Program(serialized);
        assertEqual(roundtrip.getValue('LAY_POT1_ASSIGN'), 16, 'Roundtrip preserves LAY_POT1_ASSIGN');
        assertEqual(roundtrip.getValue('MULT_A1'), 12, 'Roundtrip preserves MULT_A1');
        assertEqual(roundtrip.getValue('KBD_KEY'), 4, 'Roundtrip preserves KBD_KEY');
        assertEqual(roundtrip.getValue('CHORD_TYPE7'), 28, 'Roundtrip preserves CHORD_TYPE7');
    } catch (e) {
        logger(`  Error: ${e.message}`);
    }

    logger('\n--- [13] Hardware Pot/Encoder Assignment, Dynamic Timbre Resolution & Live Hardware Sync Tests ---');
    try {
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
        assertEqual(app.activeTimbre.getValue('LAY_POT3_ASSIGN'), 1,  'Hardware dump LAY_POT3_ASSIGN (Pot M) is 1');
        assertEqual(app.activeTimbre.getValue('LAY_ENC1_ASSIGN'), 21, 'Hardware dump LAY_ENC1_ASSIGN (Encoder 1) is 21');
        assertEqual(app.activeTimbre.getValue('LAY_ENC4_ASSIGN'), 24, 'Hardware dump LAY_ENC4_ASSIGN (Encoder 4) is 24');

        // 3. SysEx serialization places pot & encoder assignments at bytes 17-23
        const sysex = app.activeTimbre.toSysEx(0);
        assertEqual(sysex[17], 16, 'SysEx byte 17 is LAY_POT1_ASSIGN (16 = Cutoff)');
        assertEqual(sysex[18], 17, 'SysEx byte 18 is LAY_POT2_ASSIGN (17 = Resonance)');
        assertEqual(sysex[19], 1,  'SysEx byte 19 is LAY_POT3_ASSIGN (1 = Mod Knob)');
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

    } catch (e) {
        logger(`  Error: ${e.message}`);
    }

    logger('\n--- [14] Unified Oscillator Panel & Active Oscillator Selection Tests ---');
    try {
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
    } catch (e) {
        logger(`  Error: ${e.message}`);
    }

    logger('\n--- [15] Web MIDI Chrome Compatibility, Channel Auto-Migration & Live Sync Fetch Tests ---');
    try {
        // 1. MidiManager channel auto-migration from stale 0 (Ch 1) to 14 (Ch 15)
        const midi = new MidiManager();
        midi.baseChannel = 0;
        midi.savedBaseChannel = 0;
        midi.midiAccess = {
            inputs: new Map([['in-1', { id: 'in-1', name: 'H12MIDI-Pro Port 5', removeEventListener: () => {}, addEventListener: () => {} }]]),
            outputs: new Map([['out-1', { id: 'out-1', name: 'H12MIDI-Pro Port 5' }]])
        };
        midi.autoSelectPorts();
        assertEqual(midi.baseChannel, 14, 'Auto-migrated stale baseChannel 0 to 14 (Channel 15) on MM2 Port 5');
        assertEqual(midi.targetChannel, 14, 'targetChannel for Part A is 14 (Ch 15)');
        midi.activeSlot = 1;
        assertEqual(midi.targetChannel, 15, 'targetChannel for Part B is 15 (Ch 16)');

        // 2. Prioritizes MM2 Port over other generic connected ports
        const multiPortMidi = new MidiManager();
        multiPortMidi.savedInPortName = 'Keyboard USB';
        multiPortMidi.midiAccess = {
            inputs: new Map([
                ['gen-in', { id: 'gen-in', name: 'Keyboard USB', removeEventListener: () => {}, addEventListener: () => {} }],
                ['mm2-in', { id: 'mm2-in', name: 'H12MIDI-Pro Port 5', removeEventListener: () => {}, addEventListener: () => {} }]
            ]),
            outputs: new Map([
                ['gen-out', { id: 'gen-out', name: 'Speakers MIDI' }],
                ['mm2-out', { id: 'mm2-out', name: 'H12MIDI-Pro Port 5' }]
            ])
        };
        multiPortMidi.autoSelectPorts();
        assertEqual(multiPortMidi.inPort.id, 'mm2-in', 'Prioritizes MM2 input port over generic saved port');
        assertEqual(multiPortMidi.outPort.id, 'mm2-out', 'Prioritizes MM2 output port over generic output port');

        // 3. App Live Sync & Fetch status transitions
        const app = new App();
        let sentSysEx = null;
        app.midi.outPort = {
            send: (buf) => { sentSysEx = Array.from(buf); }
        };
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
    } catch (e) {
        logger(`  Error: ${e.message}`);
    }

    logger('\n--- [16] Hardware Knob Tweak (CC & NRPN) & Multi-Packet SysEx Stream Reassembly Tests ---');
    try {
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
    } catch (e) {
        logger(`  Error: ${e.message}`);
    }

    logger(`\n========================================`);
    logger(` Test Results: ${passed} Passed, ${failed} Failed`);
    logger(`========================================\n`);

    return { passed, failed };
}
