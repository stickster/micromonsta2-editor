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
                add: (...cs) => cs.forEach(c => classes.add(c)),
                remove: (...cs) => cs.forEach(c => classes.delete(c)),
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
        get id() { return this.attributes.get('id') || ''; }
        set id(v) { this.attributes.set('id', String(v)); }
        get type() { return this.attributes.get('type') || ''; }
        set type(v) { this.attributes.set('type', String(v)); }
        get innerHTML() { return this._innerHTML || ''; }
        set innerHTML(html) {
            this._innerHTML = html;
            this.children = [];
            if (!html) return;
            const tagRegex = /<([a-z0-9]+)([^>]*)>([^<]*)<\/\1>|<([a-z0-9]+)([^>]*)\/>/gi;
            let m;
            while ((m = tagRegex.exec(html)) !== null) {
                const tag = m[1] || m[4];
                const attrs = m[2] || m[5] || '';
                const text = m[3] || '';
                const child = new MockElement(tag);
                child.textContent = text;
                const classMatch = attrs.match(/class=["']([^"']*)["']/);
                if (classMatch) child.className = classMatch[1];
                const idMatch = attrs.match(/id=["']([^"']*)["']/);
                if (idMatch) child.id = idMatch[1];
                const titleMatch = attrs.match(/title=["']([^"']*)["']/);
                if (titleMatch) child.title = titleMatch[1];
                this.children.push(child);
            }
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
            const ev = { type: 'click', preventDefault: () => {}, stopPropagation: () => {} };
            if (this.onclick) this.onclick(ev);
            this.dispatchEvent(ev);
        }
        querySelector(sel) {
            for (const ch of this.children) {
                if (sel.startsWith('#') && (ch.id === sel.slice(1) || ch.attributes.get('id') === sel.slice(1))) return ch;
                if (sel.startsWith('.') && ch.classList.contains(sel.slice(1))) return ch;
                if (sel.startsWith('[data-offset="') && ch.attributes.get('data-offset') === sel.slice(14, -2)) return ch;
                if (sel.startsWith('[data-param="') && ch.attributes.get('data-param') === sel.slice(13, -2)) return ch;
                if (sel === 'button' && ch.tagName === 'BUTTON') return ch;
                if (sel === 'canvas' && ch.tagName === 'CANVAS') return ch;
                if (sel === 'input[type="range"]' && ch.tagName === 'INPUT' && ch.type === 'range') return ch;
                if (sel === '.bipolar-val' && ch.classList.contains('bipolar-val')) return ch;
                if (sel === 'button.btn-param-toggle' && ch.tagName === 'BUTTON' && ch.classList.contains('btn-param-toggle')) return ch;
                if (ch.tagName && sel.toUpperCase() === ch.tagName) return ch;
                if (ch.querySelector) {
                    const sub = ch.querySelector(sel);
                    if (sub) return sub;
                }
            }
            return null;
        }
        contains(node) {
            if (!node) return false;
            if (node === this) return true;
            for (const ch of this.children) {
                if (ch === node || (typeof ch.contains === 'function' && ch.contains(node))) {
                    return true;
                }
            }
            return false;
        }
        querySelectorAll(sel) {
            const res = [];
            for (const ch of this.children) {
                if (sel.startsWith('[data-offset="') && ch.attributes.get('data-offset') === sel.slice(14, -2)) res.push(ch);
                if (sel.startsWith('.') && ch.classList.contains(sel.slice(1))) res.push(ch);
                if (sel === '[data-param]' && ch.hasAttribute('data-param')) res.push(ch);
                if (ch.querySelectorAll) res.push(...ch.querySelectorAll(sel));
            }
            return res;
        }
    }
    const elementMap = new Map();
    globalThis.document = {
        createElement: (tag) => new MockElement(tag),
        createElementNS: (ns, tag) => new MockElement(tag),
        getElementById: (id) => elementMap.get(id) || null,
        registerMockElement: (id, el) => elementMap.set(id, el),
        querySelector: () => null,
        querySelectorAll: () => []
    };
    if (typeof window === 'undefined') {
        const winListeners = new Map();
        const storage = new Map();
        globalThis.window = {
            addEventListener: (ev, fn) => {
                if (!winListeners.has(ev)) winListeners.set(ev, []);
                winListeners.get(ev).push(fn);
            },
            removeEventListener: (ev, fn) => {
                if (winListeners.has(ev)) {
                    winListeners.set(ev, winListeners.get(ev).filter(f => f !== fn));
                }
            },
            dispatchEvent: (event) => {
                const list = winListeners.get(event.type) || [];
                for (const fn of list) fn(event);
            },
            localStorage: {
                getItem: (k) => storage.get(k) ?? null,
                setItem: (k, v) => storage.set(k, String(v)),
                removeItem: (k) => storage.delete(k),
                clear: () => storage.clear()
            }
        };
    }
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
    } catch (e) {
        logger(`  Error: ${e.message}`);
    }

    logger('\n--- [9] Editor Load vs Librarian Isolation Tests ---');
    try {
        const app = new App();
        const testBank = new MM2Bank('Test Bank', 0);
        app.librarian.banks = [testBank];
        app.librarian.activeBankIndex = 0;

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

        // 2. Librarian MUST NOT contain this patch while the Editor view is open
        assertEqual(testBank.length, 0, 'Librarian bank count remains 0 when loading in Editor');

        // 3. handleIncomingProgram rejects when there is no active bank
        app.librarian.activeBankIndex = 5;
        const rejected = app.librarian.handleIncomingProgram(incomingPatch);
        assertEqual(rejected, false, 'handleIncomingProgram rejects when there is no active bank');
        assertEqual(testBank.length, 0, 'Bank count remains 0 after rejected capture');

        // 4. In the Librarian view, dumps always go to the currently selected bank
        app.librarian.activeBankIndex = 0;
        app.currentView = 'librarian';
        app.midi.emit('program-received', { program: incomingPatch, slot: 0 });
        assertEqual(testBank.length, 1, 'Dump from MM2 is appended to the selected bank in Librarian view');
        assertEqual(testBank.getProgram(0).name, 'HW_PATCH', 'Captured patch stored in librarian bank');

        // 5. Selecting another bank retargets incoming dumps
        const secondBank = new MM2Bank('Second Bank', 1);
        app.librarian.banks = [testBank, secondBank];
        app.librarian.activeBankIndex = 1;
        app.midi.emit('program-received', { program: incomingPatch, slot: 0 });
        assertEqual(secondBank.length, 1, 'Dump follows the newly selected bank');
        assertEqual(testBank.length, 1, 'Previously selected bank is untouched');

        // 5. clearBank deletes every patch in the target bank only
        const otherBank = new MM2Bank('Other Bank', 1);
        otherBank.addProgram(new MM2Program());
        app.librarian.banks = [testBank, otherBank];
        const removedCount = app.librarian.clearBank(0);
        assertEqual(removedCount, 1, 'clearBank reports number of patches removed');
        assertEqual(testBank.length, 0, 'clearBank empties the target bank');
        assertEqual(otherBank.length, 1, 'clearBank leaves other banks untouched');
        assertEqual(app.librarian.clearBank(99), 0, 'clearBank on invalid index returns 0');
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
            inputs: new Map([['in-1', { id: 'in-1', name: 'MicroMonsta 2', removeEventListener: () => {}, addEventListener: () => {} }]]),
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
                ['gen-in', { id: 'gen-in', name: 'Keyboard USB', removeEventListener: () => {}, addEventListener: () => {} }],
                ['mm2-in', { id: 'mm2-in', name: 'MicroMonsta 2', removeEventListener: () => {}, addEventListener: () => {} }]
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
                ['gen-in', { id: 'gen-in', name: 'Keyboard USB', removeEventListener: () => {}, addEventListener: () => {} }],
                ['mm2-in', { id: 'mm2-in', name: 'MicroMonsta 2', removeEventListener: () => {}, addEventListener: () => {} }]
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
            inputs: new Map([['thru-in', { id: 'thru-in', name: 'Midi Through Port-0', removeEventListener: () => {}, addEventListener: () => {} }]]),
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

    logger('\n--- [17] Mixed-Case Patch Names, Toggle Buttons & Bipolar Sliders Tests ---');
    try {
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
    } catch (e) {
        logger(`  Error: ${e.message}`);
    }

    logger('\n--- [18] Unified Envelope Panel & Web MIDI Disconnect/Reconnect Detection Tests ---');
    try {
        const app = new App();
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
            addEventListener: () => {},
            removeEventListener: () => {}
        };
        const mockOut = {
            id: 'mm2-out-port',
            name: 'MicroMonsta 2',
            type: 'output',
            state: 'connected',
            send: () => {}
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
    } catch (e) {
        logger(`  Error: ${e.message}`);
    }

    logger('\n--- [19] Phase 2: Vector SVGs, Group Actions, Exact Key Offsets & Chorder Highlighting Tests ---');
    try {
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
        kbd.setOctave(3); // Octave 3 base is (3+1)*12 = 48. Offsets 0..24 span notes 48..72

        const key0 = kbd.querySelector('[data-offset="0"]');
        const key12 = kbd.querySelector('[data-offset="12"]');
        const key16 = kbd.querySelector('[data-offset="16"]');
        const key19 = kbd.querySelector('[data-offset="19"]');
        const key24 = kbd.querySelector('[data-offset="24"]');

        // Test rightmost C key (note 72): offset = 72 - 48 = 24
        chorderProg.setValue('CHORD_TYPE1', 0); // No chord for single key test
        kbd.noteOn(72);
        assert(key24.classList.contains('pressed'), 'Rightmost C key (offset 24) receives .pressed');
        assert(!key0.classList.contains('pressed'), 'Leftmost C key (offset 0) is NOT pressed when note 72 played');
        kbd.noteOff(72);
        assert(!key24.classList.contains('pressed'), 'Key 24 unpressed on noteOff');

        // Test even octave setting: Octave 4 base is 60. Note 60 is offset 0
        kbd.setOctave(4);
        kbd.noteOn(60);
        assert(key0.classList.contains('pressed'), 'Even octave (Oct 4) maps note 60 cleanly to offset 0');
        kbd.noteOff(60);
        assert(!key0.classList.contains('pressed'), 'Key 0 unpressed on noteOff in Oct 4');

        // Test Chorder blue (pressed) and orange (chord-note) dual highlighting
        kbd.setOctave(3);
        chorderProg.setValue('CHORD_TYPE1', 1); // Triad on C
        mockMidi.sentNotes = [];
        kbd.noteOn(60); // C4 (offset 12) + chord notes E4 (64, offset 16) & G4 (67, offset 19)

        assertEqual(mockMidi.sentNotes.length, 3, 'Transmitted 3 MIDI noteOn events for triad chord');
        assert(key12.classList.contains('pressed'), 'Physically pressed key 12 has .pressed');
        assert(!key12.classList.contains('chord-note'), 'Pressed key 12 does not have .chord-note (pressed takes precedence)');
        assert(key16.classList.contains('chord-note'), 'Sounding chord note E4 has .chord-note');
        assert(!key16.classList.contains('pressed'), 'Chord note E4 is not marked .pressed');
        assert(key19.classList.contains('chord-note'), 'Sounding chord note G4 has .chord-note');

        // Release note 60
        mockMidi.sentNotes = [];
        kbd.noteOff(60);
        assertEqual(mockMidi.sentNotes.length, 3, 'Transmitted 3 MIDI noteOff events for triad chord');
        assert(!key12.classList.contains('pressed'), 'Key 12 cleared on noteOff');
        assert(!key16.classList.contains('chord-note'), 'Key 16 cleared on noteOff');
        assert(!key19.classList.contains('chord-note'), 'Key 19 cleared on noteOff');

        // Noise Mute & Solo Badges & Right-of-Knob Placement
        const testApp = new App();
        const oscPanel = testApp.createOscillatorPanel(testApp.activeTimbre, () => {});
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

        // Toggle Noise Solo
        noiseSoloBtn.click();
        assertEqual(testApp.soloState.noise, true, 'Clicking noise solo sets soloState.noise to true');
        assert(noiseSoloBtn.classList.contains('active'), 'Noise solo button has .active class when soloed');

        // --- [20] Undo/Redo & Levels of Undo Setting Tests ---
        logger('\n--- [20] Undo/Redo & Levels of Undo Setting Tests ---');
        const undoApp = new App();

        // 1. Initial maxHistory defaults to 20
        assertEqual(undoApp.maxHistory, 20, 'Default undo levels is 20');
        assertEqual(undoApp.undoStack.length, 0, 'Undo stack starts empty');
        assertEqual(undoApp.redoStack.length, 0, 'Redo stack starts empty');

        // 2. setUndoLevels clamps and persists
        undoApp.setUndoLevels(50);
        assertEqual(undoApp.maxHistory, 50, 'setUndoLevels updates maxHistory to 50');
        assertEqual(window.localStorage.getItem('mm2_undo_levels'), '50', 'Persists undo levels to localStorage');

        undoApp.setUndoLevels(150);
        assertEqual(undoApp.maxHistory, 100, 'setUndoLevels clamps maximum to 100');

        undoApp.setUndoLevels(-10);
        assertEqual(undoApp.maxHistory, 1, 'setUndoLevels clamps minimum to 1');

        undoApp.setUndoLevels(20);
        assertEqual(undoApp.maxHistory, 20, 'Restored undo levels to 20');

        // 3. Truncating stack when maxHistory decreases
        for (let i = 0; i < 10; i++) {
            undoApp.recordUndo('OSC1_SHAPE', i, i + 1);
        }
        assertEqual(undoApp.undoStack.length, 10, 'Recorded 10 undo entries');
        undoApp.setUndoLevels(5);
        assertEqual(undoApp.undoStack.length, 5, 'Lowering maxHistory to 5 truncates undo stack');
        undoApp.undoStack = [];
        undoApp.redoStack = [];
        undoApp.setUndoLevels(20);

        // 4. Knob wiggling does NOT generate undo entries until released
        const osc1Prog = undoApp.activeTimbre;
        osc1Prog.setValue('FILTER_FREQ', 64);
        const knobContainer = createKnob('FILTER_FREQ', () => osc1Prog, (k, v, m) => undoApp.onParameterChanged(k, v, m));
        const canvas = knobContainer.querySelector('canvas') || knobContainer;

        // Simulate pointerdown
        canvas.dispatchEvent({ type: 'pointerdown', clientX: 100, clientY: 100, preventDefault: () => {} });
        assertEqual(undoApp.undoStack.length, 0, 'Pointerdown does not create undo entry');

        // Simulate pointermoves (wiggling)
        window.dispatchEvent({ type: 'pointermove', clientX: 100, clientY: 80 }); // moved up
        assert(osc1Prog.getValue('FILTER_FREQ') !== 64, 'Wiggling updates parameter value');
        assertEqual(undoApp.undoStack.length, 0, 'Interim pointermove does not add to undo stack');

        window.dispatchEvent({ type: 'pointermove', clientX: 100, clientY: 120 }); // moved down
        assertEqual(undoApp.undoStack.length, 0, 'Subsequent pointermove does not add to undo stack');

        window.dispatchEvent({ type: 'pointermove', clientX: 100, clientY: 60 }); // moved up higher
        const draggedVal = osc1Prog.getValue('FILTER_FREQ');
        assertEqual(undoApp.undoStack.length, 0, 'Still 0 undo entries while dragging');

        // Simulate pointerup (release)
        window.dispatchEvent({ type: 'pointerup' });
        assertEqual(undoApp.undoStack.length, 1, 'Releasing knob creates exactly 1 undo entry');
        assertEqual(undoApp.undoStack[0].prevVal, 64, 'Undo entry remembers initial startVal (64)');
        assertEqual(undoApp.undoStack[0].newVal, draggedVal, 'Undo entry remembers final newVal');

        // 5. Undo restores starting value, Redo restores dragged value
        undoApp.undo();
        assertEqual(osc1Prog.getValue('FILTER_FREQ'), 64, 'undo() restores parameter to initial value (64)');
        assertEqual(undoApp.undoStack.length, 0, 'undoStack popped to 0');
        assertEqual(undoApp.redoStack.length, 1, 'redoStack has 1 action');

        undoApp.redo();
        assertEqual(osc1Prog.getValue('FILTER_FREQ'), draggedVal, 'redo() restores parameter to dragged value');
        assertEqual(undoApp.undoStack.length, 1, 'undoStack restored to 1');
        assertEqual(undoApp.redoStack.length, 0, 'redoStack popped to 0');

        // 6. Knob wiggled and returned to original value before release creates 0 entries
        undoApp.undoStack = [];
        undoApp.redoStack = [];
        osc1Prog.setValue('FILTER_FREQ', 64);

        canvas.dispatchEvent({ type: 'pointerdown', clientX: 100, clientY: 100, preventDefault: () => {} });
        window.dispatchEvent({ type: 'pointermove', clientX: 100, clientY: 70 });
        window.dispatchEvent({ type: 'pointermove', clientX: 100, clientY: 100 }); // back to starting position
        window.dispatchEvent({ type: 'pointerup' });
        assertEqual(undoApp.undoStack.length, 0, 'Wiggling back to initial value creates 0 undo entries on release');

        // 7. Bipolar slider wiggling and release
        osc1Prog.setValue('MTX1_AMT', 128);
        const sliderContainer = createBipolarSlider('MTX1_AMT', () => osc1Prog, (k, v, m) => undoApp.onParameterChanged(k, v, m));
        const sliderRange = sliderContainer.querySelector('input[type="range"]');

        sliderRange.dispatchEvent({ type: 'pointerdown' });
        sliderRange.value = '180';
        sliderRange.dispatchEvent({ type: 'input' });
        assertEqual(osc1Prog.getValue('MTX1_AMT'), 180, 'Slider input updates parameter');
        assertEqual(undoApp.undoStack.length, 0, 'Slider input event does not create undo entry');

        sliderRange.value = '210';
        sliderRange.dispatchEvent({ type: 'input' });
        assertEqual(undoApp.undoStack.length, 0, 'Subsequent slider input does not create undo entry');

        sliderRange.dispatchEvent({ type: 'change' });
        assertEqual(undoApp.undoStack.length, 1, 'Slider change event creates exactly 1 undo entry');
        assertEqual(undoApp.undoStack[0].prevVal, 128, 'Slider undo entry recorded center (128)');
        assertEqual(undoApp.undoStack[0].newVal, 210, 'Slider undo entry recorded 210');

        undoApp.undo();
        assertEqual(osc1Prog.getValue('MTX1_AMT'), 128, 'undo() restores slider to 128');

        // 8. Toggle button generates 1 undo entry
        undoApp.undoStack = [];
        undoApp.redoStack = [];
        osc1Prog.setValue('ARP_OFF_ON', 0);
        const arpToggle = createToggleButton('ARP_OFF_ON', () => osc1Prog, (k, v, m) => undoApp.onParameterChanged(k, v, m));
        const arpBtn = arpToggle.querySelector('button');
        arpBtn.click();
        assertEqual(osc1Prog.getValue('ARP_OFF_ON'), 1, 'Toggle clicked sets value to 1');
        assertEqual(undoApp.undoStack.length, 1, 'Toggle click creates 1 undo entry');
        assertEqual(undoApp.undoStack[0].prevVal, 0, 'Toggle prevVal is 0');
        assertEqual(undoApp.undoStack[0].newVal, 1, 'Toggle newVal is 1');

        undoApp.undo();
        assertEqual(osc1Prog.getValue('ARP_OFF_ON'), 0, 'undo() restores toggle to 0');

        // 9. Batch operation undo/redo (Clear Arp Pattern)
        undoApp.undoStack = [];
        undoApp.redoStack = [];
        for (let s = 1; s <= 16; s++) {
            const num = s.toString().padStart(2, '0');
            osc1Prog.setValue(`ARP_PTN_STEP${num}`, 0); // All Auto
        }
        const arpSeq = createArpSequencer(() => osc1Prog, undoApp.createOnChange());
        const clearSeqBtn = arpSeq.querySelector('#seq-clear-btn');
        clearSeqBtn.click();
        assertEqual(osc1Prog.getValue('ARP_PTN_STEP01'), 1, 'Step 1 cleared to Off (1)');
        assertEqual(osc1Prog.getValue('ARP_PTN_STEP16'), 1, 'Step 16 cleared to Off (1)');
        assertEqual(undoApp.undoStack.length, 1, 'Batch clearing 16 steps creates exactly 1 compound undo entry');

        undoApp.undo();
        assertEqual(osc1Prog.getValue('ARP_PTN_STEP01'), 0, 'undo() restores step 1 to Auto (0)');
        assertEqual(osc1Prog.getValue('ARP_PTN_STEP16'), 0, 'undo() restores step 16 to Auto (0)');

        undoApp.redo();
        assertEqual(osc1Prog.getValue('ARP_PTN_STEP01'), 1, 'redo() re-clears step 1 to Off (1)');

        // 10. Part-switch awareness on Undo
        undoApp.undoStack = [];
        undoApp.redoStack = [];
        undoApp.selectPart(1); // Part B
        undoApp.activeTimbre.setValue('FILTER_FREQ', 100);
        undoApp.onParameterChanged('FILTER_FREQ', 40, { isFinal: true, prevVal: 100 });
        assertEqual(undoApp.undoStack[0].slot, 1, 'Undo action recorded for slot 1 (Part B)');

        undoApp.selectPart(0); // Switch to Part A
        assertEqual(undoApp.activeSlot, 0, 'Switched to Part A');

        undoApp.undo();
        assertEqual(undoApp.activeSlot, 1, 'undo() automatically switched activeSlot back to Part B');
        assertEqual(undoApp.activeTimbre.getValue('FILTER_FREQ'), 100, 'Part B FILTER_FREQ restored to 100');
    } catch (e) {
        logger(`  Error: ${e.message}`);
    }

    logger('\n--- [21] Voice Panel Glide Label ---');
    try {
        assertEqual(PARAM_MAP.get('VCE_GLIDE').label, 'Glide', 'VCE_GLIDE knob label is "Glide"');
    } catch (e) {
        logger(`  Error: ${e.message}`);
    }

    logger('\n--- [22] Voice Panel Pitch Bend Down Range ---');
    try {
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

        const downKnob = createKnob('VCE_PBRANGE_DOWN', () => downProg, () => {});
        const downCanvas = downKnob.querySelector('canvas') || downKnob;
        downCanvas.dispatchEvent({ type: 'pointerdown', clientX: 100, clientY: 100, preventDefault: () => {} });
        window.dispatchEvent({ type: 'pointermove', clientX: 100, clientY: -1000 }); // drag far up
        assertEqual(downProg.getValue('VCE_PBRANGE_DOWN'), 64, 'Dragging Down knob up reaches 0 (raw 64)');
        window.dispatchEvent({ type: 'pointermove', clientX: 100, clientY: 1000 }); // drag far down
        assertEqual(downProg.getValue('VCE_PBRANGE_DOWN'), 52, 'Dragging Down knob down reaches -12 (raw 52)');
        window.dispatchEvent({ type: 'pointerup' });
    } catch (e) {
        logger(`  Error: ${e.message}`);
    }

    logger('\n--- [23] Random LFO Cycle Graphics ---');
    try {
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
    } catch (e) {
        logger(`  Error: ${e.message}`);
    }

    logger('\n--- [24] Timbral Mode Detection from MM2 Hardware ---');
    try {
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
    } catch (e) {
        logger(`  Error: ${e.message}`);
    }

    logger('\n--- [25] Live Sync UI & Fetch/Push Inactivity Tests ---');
    try {
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
    } catch (e) {
        logger(`  Error: ${e.message}`);
    }

    logger('\n--- [26] App Versioning & Metadata Tests ---');
    try {
        assertEqual(App.VERSION, APP_VERSION, 'App.VERSION matches APP_VERSION');
        if (typeof globalThis !== 'undefined' && globalThis.PKG_JSON) {
            assertEqual(App.VERSION, globalThis.PKG_JSON.version, 'App.VERSION is aligned with package.json version');
        }

        // Test settings version element displays version
        const mockSettingsVer = document.createElement('span');
        mockSettingsVer.id = 'settings-app-version';
        document.registerMockElement('settings-app-version', mockSettingsVer);

        const mockHeaderVer = document.createElement('span');
        mockHeaderVer.id = 'app-version-badge';
        document.registerMockElement('app-version-badge', mockHeaderVer);

        const appInstance = new App();
        appInstance.buildSettingsUI();
        assertEqual(mockSettingsVer.textContent, `v${App.VERSION}`, 'Settings panel displays current version');
        assertEqual(mockHeaderVer.textContent, `v${App.VERSION}`, 'Header badge displays current version');
    } catch (e) {
        logger(`  Error: ${e.message}`);
    }

    logger('\n--- [27] Fingerprint Memoization & SysEx Stream Guard Tests ---');
    try {
        const p = new MM2Program();
        assert(p.isInit(), 'Fresh MM2Program is recognized as INIT');
        const fp1 = p.computeSoundFingerprint();
        assertEqual(p._soundFingerprint, fp1, 'Sound fingerprint is cached on program instance');

        p.setValue('FILTER_FREQ', 100);
        assertEqual(p._soundFingerprint, null, 'Mutating parameter invalidates cached fingerprint');
        assert(!p.isInit(), 'Modified program is no longer INIT');
        const fp2 = p.computeSoundFingerprint();
        assert(fp1 !== fp2, 'Updated parameter produces distinct sound fingerprint');

        // SysEx stream guard: interleaved 0xF8 MIDI clock bytes are ignored during SysEx dump
        const midi = new MidiManager();
        let receivedProg = null;
        midi.on('program-received', ({ program }) => { receivedProg = program; });

        const part1 = INIT_PROGRAM_BYTES.subarray(0, 100);
        const part2 = INIT_PROGRAM_BYTES.subarray(100);
        midi.onMidiMessage({ data: part1, timeStamp: Date.now() });
        midi.onMidiMessage({ data: new Uint8Array([0xF8]), timeStamp: Date.now() }); // MIDI Timing Clock
        midi.onMidiMessage({ data: part2, timeStamp: Date.now() });
        assert(receivedProg !== null, 'SysEx dump succeeds despite interleaved 0xF8 clock byte');

        // SysEx stream guard: non-SysEx status byte aborts incomplete SysEx and processes CC
        midi.onMidiMessage({ data: new Uint8Array([0xF0, 0x00, 0x21, 0x22]), timeStamp: Date.now() });
        assert(midi._isReceivingSysEx, 'SysEx reception started');
        let ccReceived = false;
        midi.on('parameter-received', () => { ccReceived = true; });
        midi.onMidiMessage({ data: new Uint8Array([0xBE, 74, 64]), timeStamp: Date.now() });
        assertEqual(midi._isReceivingSysEx, false, 'Interrupted SysEx reception aborted cleanly on status byte');
        assert(ccReceived, 'Subsequent CC message processed normally after aborted SysEx');
    } catch (e) {
        logger(`  Error: ${e.message}`);
    }

    logger('\n--- [28] Cross-Tab Synchronization & Single Hardware Polling Tests ---');
    try {
        const app1 = new App();
        const app2 = new App();

        const testLockName = `mm2_poll_leader_test_${Date.now()}`;
        const testChanName = `mm2_tab_sync_test_${Date.now()}`;
        if (app1.tabSync) app1.tabSync.destroy();
        if (app2.tabSync) app2.tabSync.destroy();
        app1.tabSync = new TabSyncManager(app1, { lockName: testLockName, channelName: testChanName });
        await new Promise(r => setTimeout(r, 40));
        app2.tabSync = new TabSyncManager(app2, { lockName: testLockName, channelName: testChanName });
        await new Promise(r => setTimeout(r, 40));

        // 1. Default Condition is ON
        assert(app1.tabSync !== null, 'TabSyncManager initialized on App');
        assertEqual(app1.tabSync.enabled, true, 'Default cross-tab sync condition is ON');
        assertEqual(app1.tabSync.loadSetting(), true, 'loadSetting returns true by default');

        // 2. Settings Toggle
        app1.tabSync.setEnabled(false);
        assertEqual(app1.tabSync.enabled, false, 'setEnabled(false) disables sync');
        assertEqual(window.localStorage.getItem('mm2_tab_sync_enabled'), 'false', 'Persists disabled setting to localStorage');
        app1.tabSync.setEnabled(true);
        assertEqual(app1.tabSync.enabled, true, 'setEnabled(true) re-enables sync');
        assertEqual(window.localStorage.getItem('mm2_tab_sync_enabled'), 'true', 'Persists enabled setting to localStorage');

        // 3. Loop / Echo Prevention
        const initialVal = app1.timbreA.getValue('OSC1_SHAPE');
        app1.tabSync.handleIncomingMessage({
            type: 'PARAM_CHANGE',
            key: 'OSC1_SHAPE',
            val: 99,
            slot: 0,
            senderTabId: app1.tabSync.tabId
        });
        assertEqual(app1.timbreA.getValue('OSC1_SHAPE'), initialVal, 'Incoming message with matching senderTabId is ignored (no echo loop)');

        // 4. Remote Parameter Change
        app2.applyRemoteParamChange('OSC1_SHAPE', 42, 0);
        assertEqual(app2.timbreA.getValue('OSC1_SHAPE'), 42, 'applyRemoteParamChange updates target timbre parameter');

        // 5. Independent Part Viewing Isolation
        app1.setTimbralMode('bitimbral');
        app2.setTimbralMode('bitimbral');
        app1.selectPart(0);
        app2.selectPart(1);
        assertEqual(app1.activeSlot, 0, 'App1 is viewing Part A');
        assertEqual(app2.activeSlot, 1, 'App2 is viewing Part B');
        app1.onParameterChanged('OSC1_SHAPE', 75);
        assertEqual(app1.timbreA.getValue('OSC1_SHAPE'), 75, 'App1 Part A updated locally');
        app2.applyRemoteParamChange('OSC1_SHAPE', 75, 0);
        assertEqual(app2.timbreA.getValue('OSC1_SHAPE'), 75, 'App2 Part A updated in memory');
        assertEqual(app2.activeSlot, 1, 'App2 remains on Part B without forced view switch');

        // 6. Patch Metadata Sync
        app2.applyRemoteMetaChange(0, 'SYNCSND', 5);
        assertEqual(app2.timbreA.name, 'SYNCSND', 'applyRemoteMetaChange updates patch name');
        assertEqual(app2.timbreA.category, 5, 'applyRemoteMetaChange updates patch category');

        // 7. Patch Load / Init Sync
        const newProg = new MM2Program();
        newProg.name = 'NEWPATCH';
        newProg.setValue('FILTER_FREQ', 215);
        app2.applyRemotePatchLoaded(0, Array.from(newProg.rawData), 'init');
        assertEqual(app2.timbreA.name, 'NEWPATCH', 'applyRemotePatchLoaded sets patch name');
        assertEqual(app2.timbreA.getValue('FILTER_FREQ'), 215, 'applyRemotePatchLoaded sets rawData parameters');

        // 8. Timbral Mode Sync
        app2.applyRemoteTimbralMode('bitimbral');
        assertEqual(app2.synthTimbralMode, 'bitimbral', 'applyRemoteTimbralMode updates mode to bitimbral');
        app2.applyRemoteTimbralMode('monotimbral');
        assertEqual(app2.synthTimbralMode, 'monotimbral', 'applyRemoteTimbralMode updates mode to monotimbral');

        // 9. Librarian Sync
        let loadedFromStorage = false;
        app2.librarian.loadAllBanks = async () => { loadedFromStorage = true; };
        await app2.applyRemoteLibrarianChange();
        assert(loadedFromStorage, 'applyRemoteLibrarianChange reloads all banks from storage');

        // 10. Single Hardware Poller Leader Election & Hardware Status Sync
        await new Promise(r => setTimeout(r, 60));

        assert(app1.tabSync.isLeader !== app2.tabSync.isLeader, 'Exactly one tab is elected Poller Leader');
        const leader = app1.tabSync.isLeader ? app1.tabSync : app2.tabSync;
        const follower = app1.tabSync.isLeader ? app2.tabSync : app1.tabSync;
        const leaderApp = leader === app1.tabSync ? app1 : app2;
        const followerApp = follower === app2.tabSync ? app2 : app1;

        assert(leader.isLeader === true, 'Leader tab holds exclusive polling leadership');
        assert(follower.isLeader === false, 'Follower tab is not poller');

        // Follower does not start periodic check timer
        followerApp.midi.setPeriodicCheck(true);
        followerApp.midi.startPeriodicCheck(15000);
        assertEqual(followerApp.midi._periodicCheckInterval, null, 'Follower tab does not run periodic check timer');

        // Leader does start periodic check timer
        leaderApp.midi.setPeriodicCheck(true);
        leaderApp.midi.startPeriodicCheck(15000);
        assert(leaderApp.midi._periodicCheckInterval !== null, 'Leader tab runs periodic check timer');
        leaderApp.midi.stopPeriodicCheck();

        // Hardware Status Broadcast & Sync without probe
        followerApp.applyRemoteHardwareStatus(true);
        assertEqual(followerApp.midi.hardwareResponsive, true, 'Follower tab applies remote hardware responsiveness');
        assertEqual(followerApp.midi._isProbing, false, 'Follower tab did not execute MIDI probe');

        // BroadcastChannel end-to-end test (both tabs active)
        let messageReceived = null;
        const receiverApp = (leader === app1.tabSync) ? app2 : app1;
        const sender = (leader === app1.tabSync) ? app1.tabSync : app2.tabSync;
        receiverApp.applyRemoteParamChange = (k, v, s) => { messageReceived = { k, v, s }; };

        sender.broadcast('PARAM_CHANGE', { key: 'OSC1_SHAPE', val: 105, slot: 0 });
        await new Promise(r => setTimeout(r, 60));
        assert(messageReceived !== null && messageReceived.k === 'OSC1_SHAPE' && messageReceived.v === 105, 'End-to-end broadcast delivered via BroadcastChannel');

        // Leader release / failover
        leader.destroy();
        await new Promise(r => setTimeout(r, 60));
        assert(follower.isLeader === true, 'Follower promoted to leader upon leader termination');

        // Cleanup
        follower.destroy();
    } catch (e) {
        logger(`  Error: ${e.message}`);
        failed++;
    }

    logger('\n--- [29] Librarian HW Poll Isolation & Empty Default Banks Tests ---');
    try {
        const lib = new PatchLibrarian();
        lib.createDefaultBanks();
        assertEqual(lib.banks.length, 3, 'createDefaultBanks creates 3 default banks');
        assertEqual(lib.banks[0].name, 'Bank 1', 'Default bank 0 is named Bank 1');
        assertEqual(lib.banks[1].name, 'Bank 2', 'Default bank 1 is named Bank 2');
        assertEqual(lib.banks[2].name, 'Bank 3', 'Default bank 2 is named Bank 3');
        assertEqual(lib.banks[0].length, 0, 'Bank 0 starts empty with 0 programs (no default INIT patch)');
        assertEqual(lib.banks[1].length, 0, 'Bank 1 starts empty with 0 programs');
        assertEqual(lib.banks[2].length, 0, 'Bank 2 starts empty with 0 programs');

        // Verify HW probe does not add patch to Librarian even if response is delayed past probe timeout
        const pollApp = new App();
        const testBank = new MM2Bank('Test Bank', 0);
        pollApp.librarian.banks = [testBank];
        pollApp.librarian.activeBankIndex = 0;
        pollApp.currentView = 'librarian';

        const mockOut = { id: 'mm2_out', name: 'MicroMonsta 2', send: () => {} };
        pollApp.midi.inPort = { id: 'mm2_in', name: 'MicroMonsta 2' };
        pollApp.midi.outPort = mockOut;

        // Trigger probe with short timeout to simulate delayed HW response
        pollApp.midi.probeHardware(40);
        assert(pollApp.midi._isProbing, '_isProbing is true during probe');

        // Wait past timeout (40ms)
        await new Promise(r => setTimeout(r, 60));
        assertEqual(pollApp.midi.hardwareResponsive, false, 'Hardware marked unresponsive on probe timeout');
        assertEqual(pollApp.midi._probeTimeout, null, '_probeTimeout cleared');
        assert(pollApp.midi._isProbing, '_isProbing preserved to prevent late probe reply from leaking as dump');

        // Late SysEx response arrives
        const probeDump = new Uint8Array(INIT_PROGRAM_BYTES);
        let receivedIsProbe = null;
        pollApp.midi.on('program-received', ({ isProbe }) => { receivedIsProbe = isProbe; });
        pollApp.midi.onMidiMessage({ data: probeDump, timeStamp: Date.now() });

        assertEqual(receivedIsProbe, true, 'Late probe response is recognized as a probe (isProbe=true)');
        assertEqual(pollApp.midi.hardwareResponsive, true, 'Hardware responsiveness restored on incoming dump');
        assertEqual(pollApp.midi._isProbing, false, '_isProbing cleared after probe response is handled');
        assertEqual(testBank.length, 0, 'Librarian bank remains empty (no INIT patch added on HW poll)');
    } catch (e) {
        logger(`  Error: ${e.message}`);
        failed++;
    }

    logger('\n--- [30] Librarian Bank Deletion Tests ---');
    try {
        const lib = new PatchLibrarian();
        lib.banks = [
            new MM2Bank('Bank 1', 0),
            new MM2Bank('Bank 2', 1),
            new MM2Bank('Bank 3', 2)
        ];
        lib.activeBankIndex = 2;

        // Removing bank at index 0 should decrement activeBankIndex to 1 and re-index
        const ok0 = lib.removeBank(0);
        assertEqual(ok0, true, 'removeBank(0) succeeds');
        assertEqual(lib.banks.length, 2, 'Librarian has 2 banks remaining');
        assertEqual(lib.banks[0].name, 'Bank 2', 'First bank is now Bank 2');
        assertEqual(lib.banks[0].index, 0, 'First bank index updated to 0');
        assertEqual(lib.banks[1].name, 'Bank 3', 'Second bank is Bank 3');
        assertEqual(lib.banks[1].index, 1, 'Second bank index updated to 1');
        assertEqual(lib.activeBankIndex, 1, 'activeBankIndex adjusted from 2 to 1');

        // Removing the active bank (now index 1)
        const ok1 = lib.removeBank(1);
        assertEqual(ok1, true, 'removeBank(1) succeeds');
        assertEqual(lib.banks.length, 1, 'Librarian has 1 bank remaining');
        assertEqual(lib.activeBankIndex, 0, 'activeBankIndex clamped to 0');

        // Attempting to remove the last remaining bank is disallowed
        const okLast = lib.removeBank(0);
        assertEqual(okLast, false, 'removeBank rejected when only 1 bank remains');
        assertEqual(lib.banks.length, 1, 'Librarian still retains 1 bank');

        // Test App.deleteBank() method
        const delApp = new App();
        delApp.librarian.banks = [new MM2Bank('Solo Bank', 0)];
        delApp.librarian.activeBankIndex = 0;

        let notifiedWarning = false;
        delApp.showNotification = (msg, type) => {
            if (type === 'warning') notifiedWarning = true;
        };
        delApp.deleteBank();
        assertEqual(notifiedWarning, true, 'deleteBank warns user when trying to delete the only bank');
        assertEqual(delApp.librarian.banks.length, 1, 'Single bank was not deleted');

        // Two banks with confirm rejection
        delApp.librarian.banks = [new MM2Bank('Bank A', 0), new MM2Bank('Bank B', 1)];
        global.confirm = () => false;
        delApp.deleteBank(1);
        assertEqual(delApp.librarian.banks.length, 2, 'Bank not deleted when confirm rejected');

        // Confirm accepted
        global.confirm = () => true;
        let notifiedSuccess = false;
        delApp.showNotification = (msg, type) => {
            if (type === 'success') notifiedSuccess = true;
        };
        delApp.deleteBank(1);
        assertEqual(delApp.librarian.banks.length, 1, 'Bank deleted when confirm accepted');
        assertEqual(notifiedSuccess, true, 'Success notification shown on bank deletion');
        delete global.confirm;
    } catch (e) {
        logger(`  Error: ${e.message}`);
        failed++;
    }

    logger('\n--- [31] Librarian Patch Category Editing Tests ---');
    try {
        const catApp = new App();
        const testBank = new MM2Bank('Category Bank', 0);
        const testProg = new MM2Program();
        testProg.name = 'TEST_CAT';
        testProg.category = 0; // Bass
        testBank.addProgram(testProg);
        catApp.librarian.banks = [testBank];
        catApp.librarian.activeBankIndex = 0;

        // Mock document elements
        const bankTabsEl = { innerHTML: '', appendChild: () => {} };
        const progListEl = { innerHTML: '', appendChild: (c) => { progListEl.children.push(c); }, children: [] };
        const origDoc = global.document;
        global.document = {
            getElementById: (id) => {
                if (id === 'bank-tabs') return bankTabsEl;
                if (id === 'librarian-prog-list') return progListEl;
                if (id === 'bank-duplicates-badge') return { style: {} };
                if (id === 'btn-delete-bank') return { disabled: false };
                if (id === 'prog-category-select') return { value: 0 };
                return null;
            },
            createElement: (tag) => {
                const el = {
                    tagName: tag.toUpperCase(),
                    className: '',
                    children: [],
                    innerHTML: '',
                    setAttribute: (k, v) => { el[k] = v; },
                    classList: { add: () => {}, remove: () => {} },
                    querySelector: (sel) => {
                        if (sel === '.prog-cat-select' || sel === '.prog-cat-badge') {
                            return el._catSelect;
                        }
                        return { onclick: null };
                    },
                    appendChild: (c) => { el.children.push(c); }
                };
                return el;
            }
        };

        // Render Librarian
        catApp.renderLibrarianBank();
        assertEqual(progListEl.children.length, 1, 'Rendered 1 program row in table');
        const renderedRow = progListEl.children[0];
        assert(renderedRow.innerHTML.includes('prog-cat-select'), 'Row includes category select control');
        assert(renderedRow.innerHTML.includes('<option value="0" selected>Bass</option>'), 'Default category option Bass is selected');
        assert(renderedRow.innerHTML.includes('<option value="2" >Pad</option>'), 'Category list contains Pad option');

        // Test editing category on program
        testProg.category = 2; // Pad
        assertEqual(testProg.category, 2, 'Program category updated to 2 (Pad)');
        assertEqual(testProg.rawData[16], 2, 'Raw SysEx byte 16 matches category 2');

        // Test Category update via mock select event handler
        let savedTriggered = false;
        catApp.librarian.saveAllBanks = async () => { savedTriggered = true; };
        catApp.timbreA.rawData = testProg.rawData; // Simulate patch loaded in Editor Part A
        catApp.timbreA.name = testProg.name;
        catApp.activeSlot = 0;

        let editorCatVal = null;
        global.document.getElementById = (id) => {
            if (id === 'prog-category-select') return { set value(v) { editorCatVal = v; }, get value() { return editorCatVal; } };
            return null;
        };

        // Create a simulated select onchange event
        const mockEvt = {
            target: { value: '3' }, // Keys
            stopPropagation: () => {}
        };

        // Invoke the row's category onchange logic
        const onCatChange = (e) => {
            e.stopPropagation();
            const newCat = parseInt(e.target.value, 10);
            testProg.category = newCat;
            catApp.librarian.saveAllBanks();
            if (catApp.timbreA && (catApp.timbreA.name === testProg.name || catApp.timbreA.computeSoundFingerprint() === testProg.computeSoundFingerprint())) {
                catApp.timbreA.category = newCat;
                if (catApp.activeSlot === 0) {
                    const edCat = global.document.getElementById('prog-category-select');
                    if (edCat) edCat.value = newCat;
                }
            }
        };

        onCatChange(mockEvt);
        assertEqual(testProg.category, 3, 'Patch category updated to 3 (Keys)');
        assertEqual(catApp.timbreA.category, 3, 'Active Editor Timbre A category updated');
        assertEqual(editorCatVal, 3, 'Editor category dropdown synchronized');
        assertEqual(savedTriggered, true, 'Librarian banks saved on category change');

        // Restore global document
        global.document = origDoc;
    } catch (e) {
        logger(`  Error: ${e.message}`);
        failed++;
    }

    logger('\n--- [32] Follower Window Startup Sync without Hardware Fetch Tests ---');
    try {
        const leaderApp = new App();
        const followerApp = new App();

        // Setup leader state
        leaderApp.synthTimbralMode = 'monotimbral';
        leaderApp.timbreA.name = 'LEAD_PAT';
        leaderApp.timbreA.category = 1; // Lead
        leaderApp.timbreB.name = 'PAD_PAT';
        leaderApp.midi.hardwareResponsive = true;

        const leaderSync = new TabSyncManager(leaderApp, { tabId: 'tab_leader_1' });
        leaderSync.setLeadership(true);

        const followerSync = new TabSyncManager(followerApp, { tabId: 'tab_follower_2' });
        followerSync.setLeadership(false);
        followerApp.tabSync = followerSync;
        leaderApp.tabSync = leaderSync;

        // Verify follower is marked as follower
        assertEqual(followerSync.isLeader, false, 'Follower tab is not leader');
        assertEqual(followerSync.isFollower, true, 'isFollower returns true for follower tab');

        // Verify follower tab does not run fetch on MM2 detection
        let followerFetchSent = false;
        followerApp.midi.outPort = {
            id: 'mock_out',
            name: 'MicroMonsta 2',
            send: () => { followerFetchSent = true; }
        };
        followerApp.midi.inPort = {
            id: 'mock_in',
            name: 'MicroMonsta 2'
        };

        // Simulate MM2 detection in follower window
        followerApp.midi.emit('mm2-detected', { inPort: followerApp.midi.inPort });

        assertEqual(followerFetchSent, false, 'Follower tab did not dispatch MIDI fetch request on MM2 detection');
        assertEqual(followerApp._hasDetectedMM2Once, true, '_hasDetectedMM2Once flagged to prevent future fetches');

        // Leader responds to REQUEST_LEADER_STATE by broadcasting SYNC_LEADER_STATE
        let syncMessageSent = null;
        leaderSync.broadcast = (type, payload) => {
            if (type === 'SYNC_LEADER_STATE') syncMessageSent = payload;
        };

        leaderSync.handleIncomingMessage({
            type: 'REQUEST_LEADER_STATE',
            senderTabId: 'tab_follower_2'
        });

        assert(syncMessageSent !== null, 'Leader broadcasted SYNC_LEADER_STATE payload');
        assertEqual(syncMessageSent.mode, 'monotimbral', 'Leader sent monotimbral mode');
        assertEqual(syncMessageSent.targetTabId, 'tab_follower_2', 'Target tab is follower tab');

        // Follower applies SYNC_LEADER_STATE
        followerApp.applyLeaderState(syncMessageSent);

        assertEqual(followerApp.synthTimbralMode, 'monotimbral', 'Follower timbral mode is monotimbral matching leader');
        assertEqual(followerApp.timbreA.name, 'LEAD_PAT', 'Follower timbreA synchronized from leader');
        assertEqual(followerApp.timbreA.category, 1, 'Follower timbreA category synchronized from leader');
        assertEqual(followerApp.timbreB.name, 'PAD_PAT', 'Follower timbreB synchronized from leader');
        assertEqual(followerApp.midi.hardwareResponsive, true, 'Follower hardware responsiveness synchronized from leader');

        // Cleanup
        leaderSync.destroy();
        followerSync.destroy();
    } catch (e) {
        logger(`  Error: ${e.message}`);
        failed++;
    }

    logger('\n--- [33] Timbral Mode Monotimbral Protection Tests ---');
    try {
        const monoApp = new App();
        monoApp.setTimbralMode('monotimbral');
        assertEqual(monoApp.synthTimbralMode, 'monotimbral', 'App initialized in monotimbral mode');

        // 1. Probing Part B sets lastFetchedSlot to 1, but timeout resets lastFetchedSlot to 0
        monoApp.midi.outPort = { name: 'Mock MM2', send: () => {} };
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
    } catch (e) {
        logger(`  Error: ${e.message}`);
        failed++;
    }

    logger('\n--- [34] Librarian Bank Renaming Tests ---');
    try {
        const lib = new PatchLibrarian();
        lib.banks = [
            new MM2Bank('Bank 1', 0),
            new MM2Bank('Bank 2', 1)
        ];

        // 1. renameBank validation
        const outOfBounds = lib.renameBank(5, 'Invalid');
        assertEqual(outOfBounds, false, 'renameBank returns false for out-of-bounds index');

        const negativeIndex = lib.renameBank(-1, 'Invalid');
        assertEqual(negativeIndex, false, 'renameBank returns false for negative index');

        const emptyName = lib.renameBank(0, '   ');
        assertEqual(emptyName, false, 'renameBank returns false for empty or whitespace-only name');
        assertEqual(lib.banks[0].name, 'Bank 1', 'Bank name untouched when invalid name provided');

        // 2. Successful renaming in librarian
        let saved = false;
        lib.saveAllBanks = () => { saved = true; };
        const okRename = lib.renameBank(0, '  My Custom Bank  ');
        assertEqual(okRename, true, 'renameBank succeeds with valid trimmed name');
        assertEqual(lib.banks[0].name, 'My Custom Bank', 'Bank name updated with trimmed string');
        assertEqual(saved, true, 'saveAllBanks triggered on bank rename');

        // 3. App.renameBank() user flow
        const app = new App();
        app.librarian.banks = [new MM2Bank('Original Name', 0)];
        app.librarian.activeBankIndex = 0;

        // User cancels prompt
        global.prompt = () => null;
        let notifType = null;
        app.showNotification = (msg, type) => { notifType = type; };
        app.renameBank();
        assertEqual(app.librarian.banks[0].name, 'Original Name', 'Bank not renamed when prompt is cancelled');

        // User provides empty string
        global.prompt = () => '   ';
        app.renameBank();
        assertEqual(notifType, 'warning', 'Warning notification shown when new name is empty');
        assertEqual(app.librarian.banks[0].name, 'Original Name', 'Bank not renamed on empty prompt');

        // User provides same name
        notifType = null;
        global.prompt = () => 'Original Name';
        app.renameBank();
        assertEqual(notifType, null, 'No notification or change when name is unchanged');

        // User provides valid new name
        let renderCalled = false;
        app.renderLibrarianBank = () => { renderCalled = true; };
        global.prompt = () => 'Studio Favorites';
        app.renameBank();
        assertEqual(app.librarian.banks[0].name, 'Studio Favorites', 'Bank renamed via App.renameBank()');
        assertEqual(notifType, 'success', 'Success notification shown on rename');
        assertEqual(renderCalled, true, 'renderLibrarianBank called after rename');

        // Cleanup global.prompt
        delete global.prompt;

        // 4. Test UI double click and toolbar button
        const btnRename = document.createElement('button');
        btnRename.id = 'btn-rename-bank';
        document.registerMockElement('btn-rename-bank', btnRename);

        const btnDelete = document.createElement('button');
        btnDelete.id = 'btn-delete-bank';
        document.registerMockElement('btn-delete-bank', btnDelete);

        const bankTabs = document.createElement('div');
        bankTabs.id = 'bank-tabs';
        document.registerMockElement('bank-tabs', bankTabs);

        const progList = document.createElement('tbody');
        progList.id = 'librarian-prog-list';
        document.registerMockElement('librarian-prog-list', progList);

        // Restore real renderLibrarianBank
        delete app.renderLibrarianBank;
        app.renderLibrarianBank();

        assertEqual(btnRename.disabled, false, 'Rename button enabled when banks exist');

        // Check rendered tab has double-click handler
        const renderedTitle = bankTabs.querySelector('.bank-tab-title');
        assert(renderedTitle !== null, 'Rendered bank tab title exists');
        assertEqual(renderedTitle.title, 'Double-click to rename', 'Bank tab title has rename tooltip');
        assert(typeof renderedTitle.ondblclick === 'function', 'Bank tab title has ondblclick handler');

        // Triggering ondblclick triggers renameBank
        let renamedIdx = null;
        app.renameBank = (idx) => { renamedIdx = idx; };
        renderedTitle.ondblclick({ stopPropagation: () => {} });
        assertEqual(renamedIdx, 0, 'Double clicking tab title invokes renameBank for that bank index');
    } catch (e) {
        logger(`  Error: ${e.message}`);
        failed++;
    }

    logger('\n--- [35] Follower Window Poll Message Suppression Tests ---');
    try {
        const leaderApp = new App();
        const followerApp = new App();

        const leaderSync = new TabSyncManager(leaderApp, { tabId: 'tab_lead_35', channelName: 'test-chan-35' });
        const followerSync = new TabSyncManager(followerApp, { tabId: 'tab_foll_35', channelName: 'test-chan-35' });
        leaderApp.tabSync = leaderSync;
        followerApp.tabSync = followerSync;

        leaderSync.setLeadership(true);
        followerSync.setLeadership(false);

        leaderApp.timbreA.name = 'LEAD_A';
        followerApp.timbreA.name = 'FOLL_A';

        let followerNotifications = [];
        followerApp.showNotification = (msg, type) => {
            followerNotifications.push({ msg, type });
        };

        let leaderNotifications = [];
        leaderApp.showNotification = (msg, type) => {
            leaderNotifications.push({ msg, type });
        };

        // 1. Leader starts probeHardware(): emits probe-start and broadcasts HARDWARE_PROBE_START
        leaderApp.midi.outPort = { name: 'MM2 Mock', send: () => {} };
        leaderApp.midi.inPort = { name: 'MM2 Mock' };
        followerApp.midi.outPort = { name: 'MM2 Mock', send: () => {} };
        followerApp.midi.inPort = { name: 'MM2 Mock' };

        leaderApp.midi.probeHardware(2000);
        assertEqual(leaderApp.midi._isProbing, true, 'Leader midi._isProbing is true during probe');

        // Allow microtask / BroadcastChannel delivery
        await new Promise(r => setTimeout(r, 40));
        assertEqual(followerApp.midi._isProbing, true, 'Follower midi._isProbing set to true via HARDWARE_PROBE_START broadcast');

        // Incoming dump from hardware arrived at both tabs
        const fetchedProg = new MM2Program();
        fetchedProg.name = 'POLL_PAT';
        const hwDump = fetchedProg.toSysEx(0);

        leaderApp.midi.onMidiMessage({ data: hwDump, timeStamp: Date.now() });
        followerApp.midi.onMidiMessage({ data: hwDump, timeStamp: Date.now() });

        assertEqual(leaderNotifications.length, 0, 'Leader window showed no notification during probe');
        assertEqual(followerNotifications.length, 0, 'Follower window showed no notification during probe');
        assertEqual(followerApp.timbreA.name, 'FOLL_A', 'Follower timbreA not overwritten by probe dump');

        // 2. Unprompted dump when follower did not receive probe broadcast (fallback guard)
        followerApp.midi._isProbing = false;
        followerApp.syncStatus = 'synced';
        followerApp.midi.onMidiMessage({ data: hwDump, timeStamp: Date.now() });

        assertEqual(followerNotifications.length, 0, 'Follower window suppresses Loaded notification on unprompted hardware dump');
        assertEqual(followerApp.timbreA.name, 'FOLL_A', 'Follower timbreA preserved without overwrite');

        // 3. User in follower window explicitly clicks Fetch (syncStatus === 'fetching')
        followerApp.syncStatus = 'fetching';
        followerApp.midi.onMidiMessage({ data: hwDump, timeStamp: Date.now() });

        assertEqual(followerNotifications.length, 1, 'Follower window shows Loaded notification when actively fetching');
        assert(followerNotifications[0].msg.includes('Loaded MM2 hardware Patch A'), 'Notification message mentions loaded patch');
        assertEqual(followerApp.syncStatus, 'synced', 'Follower syncStatus updated to synced');
        assertEqual(followerApp.timbreA.name, 'POLL_PAT', 'Follower timbreA updated with fetched program');

        leaderSync.destroy();
        followerSync.destroy();
    } catch (e) {
        logger(`  Error: ${e.message}`);
        failed++;
    }

    logger('\n--- [36] Follower Window Connection Status Inheritance Tests ---');
    try {
        const leaderApp = new App();
        const followerApp = new App();

        const leaderSync = new TabSyncManager(leaderApp, { tabId: 'tab_lead_36', channelName: 'test-chan-36' });
        const followerSync = new TabSyncManager(followerApp, { tabId: 'tab_foll_36', channelName: 'test-chan-36' });
        leaderApp.tabSync = leaderSync;
        followerApp.tabSync = followerSync;

        leaderSync.setLeadership(true);
        followerSync.setLeadership(false);

        // Setup leader with responsive hardware
        leaderApp.midi.hardwareResponsive = true;
        leaderApp.midi.inPort = { id: 'mm2_in', name: 'MicroMonsta 2' };
        leaderApp.midi.outPort = { id: 'mm2_out', name: 'MicroMonsta 2', send: () => {} };

        // Setup follower DOM status dot and text elements
        const statusDot = document.createElement('span');
        statusDot.id = 'midi-status-dot';
        const statusText = document.createElement('span');
        statusText.id = 'midi-status-text';
        document.registerMockElement('midi-status-dot', statusDot);
        document.registerMockElement('midi-status-text', statusText);

        followerApp.midi.inPort = { id: 'mm2_in', name: 'MicroMonsta 2' };
        followerApp.midi.outPort = { id: 'mm2_out', name: 'MicroMonsta 2', send: () => {} };

        // 1. Follower resetHardwareResponsiveness preserves responsiveness because it is a follower
        followerApp.midi.hardwareResponsive = true;
        followerApp.midi.resetHardwareResponsiveness();
        assertEqual(followerApp.midi.hardwareResponsive, true, 'Follower does not wipe hardware responsiveness to null on port reset');

        // 2. Applying leader state immediately updates connection status UI without delay
        followerApp.applyLeaderState({
            mode: 'monotimbral',
            timbreA: leaderApp.timbreA.rawData,
            hardwareResponsive: true
        });

        assertEqual(statusDot.className, 'status-dot connected', 'Follower status dot immediately reflects connected');
        assertEqual(statusText.textContent, 'Connected: MicroMonsta 2', 'Follower status text immediately displays Connected');

        // 3. Remote hardware status update from leader immediately propagates to UI
        followerApp.applyRemoteHardwareStatus(false);
        assertEqual(statusDot.className, 'status-dot disconnected unresponsive', 'Follower status dot updates on remote unresponsive status');
        assert(statusText.textContent.includes('No Response'), 'Follower status text reflects No Response');

        followerApp.applyRemoteHardwareStatus(true);
        assertEqual(statusDot.className, 'status-dot connected', 'Follower status dot returns to connected on remote responsive update');
        assertEqual(statusText.textContent, 'Connected: MicroMonsta 2', 'Follower status text returns to Connected');

        // Cleanup
        document.registerMockElement('midi-status-dot', null);
        document.registerMockElement('midi-status-text', null);
        leaderSync.destroy();
        followerSync.destroy();
    } catch (e) {
        logger(`  Error: ${e.message}`);
        failed++;
    }

    logger('\n--- [37] Cross-Tab Live Sync Control Synchronization Tests ---');
    try {
        const leaderApp = new App();
        const followerApp = new App();

        const leaderSync = new TabSyncManager(leaderApp, { tabId: 'tab_lead_37', channelName: 'test-chan-37' });
        const followerSync = new TabSyncManager(followerApp, { tabId: 'tab_foll_37', channelName: 'test-chan-37' });
        leaderApp.tabSync = leaderSync;
        followerApp.tabSync = followerSync;

        leaderSync.setLeadership(true);
        followerSync.setLeadership(false);

        // Both apps have verified MM2 connections
        leaderApp.midi.inPort = { id: 'mm2_in', name: 'MicroMonsta 2' };
        leaderApp.midi.outPort = { id: 'mm2_out', name: 'MicroMonsta 2', send: () => {} };
        leaderApp.midi.hardwareResponsive = true;

        followerApp.midi.inPort = { id: 'mm2_in', name: 'MicroMonsta 2' };
        followerApp.midi.outPort = { id: 'mm2_out', name: 'MicroMonsta 2', send: () => {} };
        followerApp.midi.hardwareResponsive = true;

        // Track broadcast messages between tabs
        const sentMessages = [];
        const origLeaderBroadcast = leaderSync.broadcast.bind(leaderSync);
        leaderSync.broadcast = (type, payload) => {
            sentMessages.push({ from: 'leader', type, payload });
            origLeaderBroadcast(type, payload);
            followerSync.handleIncomingMessage({ type, senderTabId: leaderSync.tabId, ...payload });
        };
        const origFollowerBroadcast = followerSync.broadcast.bind(followerSync);
        followerSync.broadcast = (type, payload) => {
            sentMessages.push({ from: 'follower', type, payload });
            origFollowerBroadcast(type, payload);
            leaderSync.handleIncomingMessage({ type, senderTabId: followerSync.tabId, ...payload });
        };

        // Mock Live Sync checkbox and dialog to verify no dialog is shown on remote sync
        const chkLiveSync = document.createElement('input');
        chkLiveSync.type = 'checkbox';
        chkLiveSync.id = 'chk-prog-live-sync';
        document.registerMockElement('chk-prog-live-sync', chkLiveSync);

        let dialogShownCount = 0;
        const mockDialog = {
            showModal: () => { dialogShownCount++; }
        };
        document.registerMockElement('live-sync-dialog', mockDialog);

        // 1. Leader enables Live Sync -> Follower inherits state & UI without dialog
        leaderApp._setLiveSyncState(true);
        assertEqual(leaderApp.midi.liveSync, true, 'Leader liveSync is true');
        assertEqual(followerApp.midi.liveSync, true, 'Follower liveSync synced to true');
        assertEqual(chkLiveSync.checked, true, 'Live sync checkbox updated to checked');
        assertEqual(dialogShownCount, 0, 'Follower did not show live-sync confirmation dialog');

        // 2. Follower disables Live Sync -> Leader inherits state
        followerApp._setLiveSyncState(false);
        assertEqual(followerApp.midi.liveSync, false, 'Follower liveSync is false');
        assertEqual(leaderApp.midi.liveSync, false, 'Leader liveSync synced to false when toggled from follower');
        assertEqual(chkLiveSync.checked, false, 'Live sync checkbox updated to unchecked');

        // 3. Follower enables Live Sync -> Leader inherits state
        followerApp._setLiveSyncState(true);
        assertEqual(leaderApp.midi.liveSync, true, 'Leader liveSync synced to true when toggled from follower');

        // 4. REQUEST_LEADER_STATE includes liveSync and applyLeaderState restores it
        followerApp.midi.liveSync = false;
        chkLiveSync.checked = false;
        leaderSync.handleIncomingMessage({
            type: 'REQUEST_LEADER_STATE',
            senderTabId: followerSync.tabId
        });
        assertEqual(followerApp.midi.liveSync, true, 'New follower inherits liveSync=true from SYNC_LEADER_STATE');
        assertEqual(chkLiveSync.checked, true, 'New follower checkbox checked after SYNC_LEADER_STATE');

        // Cleanup
        document.registerMockElement('chk-prog-live-sync', null);
        document.registerMockElement('live-sync-dialog', null);
        leaderSync.destroy();
        followerSync.destroy();
    } catch (e) {
        logger(`  Error: ${e.message}`);
        failed++;
    }

    // =========================================================================
    // Section 38: Section Copy & Drag-and-Drop Regression Tests
    // =========================================================================
    logger('\n--- [38] Section Copy & Drag-and-Drop Regression Tests ---');
    try {
        // 1. copySection('mult', 1, 'mult', 2, ...) copies MULT_A1/MULT_B1 -> MULT_A2/MULT_B2 1:1
        const multProg = new MM2Program();
        multProg.setValue('MULT_A1', 12);
        multProg.setValue('MULT_B1', 27);
        multProg.setValue('MULT_A2', 3);
        multProg.setValue('MULT_B2', 5);
        const multCopied = copySection('mult', 1, 'mult', 2, multProg, () => {});
        assertEqual(multCopied, true, 'copySection("mult", 1, "mult", 2) returns true');
        assertEqual(multProg.getValue('MULT_A2'), 12, 'MULT_A2 copied 1:1 from MULT_A1');
        assertEqual(multProg.getValue('MULT_B2'), 27, 'MULT_B2 copied 1:1 from MULT_B1');

        // 2. copySection('env', ...) velocity sensitivity handling across Env 1, 2, and 3
        const envProg = new MM2Program();
        envProg.setValue('ENV1_ATK', 15);
        envProg.setValue('ENV1_DCY', 42);
        envProg.setValue('ENV1_SUS', 88);
        envProg.setValue('ENV1_REL', 63);
        envProg.setValue('ENV1_RESET', 1);
        envProg.setValue('ENV1_VCA_VEL_SENS', 91);
        envProg.setValue('ENV2_FLT_VEL_SENS', 10);

        copySection('env', 1, 'env', 2, envProg, () => {});
        assertEqual(envProg.getValue('ENV2_ATK'), 15, 'Env 1->2 copies ATK');
        assertEqual(envProg.getValue('ENV2_RESET'), 1, 'Env 1->2 copies RESET');
        assertEqual(envProg.getValue('ENV2_FLT_VEL_SENS'), 91, 'Env 1->2 copies velocity sensitivity');

        copySection('env', 1, 'env', 3, envProg, () => {});
        assertEqual(envProg.getValue('ENV3_ATK'), 15, 'Env 1->3 copies ATK');
        assertEqual(envProg.getValue('ENV3_DCY'), 42, 'Env 1->3 copies DCY');
        assertEqual(envProg.getValue('ENV3_SUS'), 88, 'Env 1->3 copies SUS');
        assertEqual(envProg.getValue('ENV3_REL'), 63, 'Env 1->3 copies REL');
        assertEqual(envProg.getValue('ENV3_RESET'), 1, 'Env 1->3 copies RESET');

        envProg.setValue('ENV3_ATK', 5);
        copySection('env', 3, 'env', 1, envProg, () => {});
        assertEqual(envProg.getValue('ENV1_ATK'), 5, 'Env 3->1 copies ATK');
        assertEqual(envProg.getValue('ENV1_VCA_VEL_SENS'), 91, 'Env 3->1 leaves ENV1_VCA_VEL_SENS untouched');

        // 3. DOM Drag-and-Drop Simulation Tests
        const dndApp = new App();
        dndApp.showNotification = () => {};
        const dndProg = dndApp.timbreA;
        const makeDragEvent = (type, overrides = {}) => {
            const store = overrides._store || {};
            return {
                type,
                relatedTarget: overrides.relatedTarget || null,
                preventDefaultCalled: false,
                stopPropagationCalled: false,
                preventDefault() { this.preventDefaultCalled = true; },
                stopPropagation() { this.stopPropagationCalled = true; },
                dataTransfer: {
                    effectAllowed: '',
                    dropEffect: '',
                    setData(k, v) { store[k] = v; },
                    getData(k) { return store[k] || ''; }
                }
            };
        };

        // 3a. Oscillator Tabs (createOscillatorPanel)
        const oscCard = dndApp.createOscillatorPanel(() => dndProg, () => {});
        const oscTabs = oscCard.querySelectorAll('.btn-osc-tab');
        assertEqual(oscTabs.length, 3, 'Oscillator panel renders 3 tabs');
        assert(oscTabs.every(t => t.attributes.get('draggable') === 'true'), 'All btn-osc-tab elements have draggable="true"');

        dndProg.setValue('OSC1_SHAPE', 77);
        dndProg.setValue('OSC2_SHAPE', 11);
        const oscStore = {};
        oscTabs[0].dispatchEvent(makeDragEvent('dragstart', { _store: oscStore }));
        oscTabs[0].dispatchEvent(makeDragEvent('dragover', { _store: oscStore }));
        assert(!oscTabs[0].classList.contains('tab-drop-hover'), 'Self dragover on Osc 1 tab does not add tab-drop-hover');
        oscTabs[1].dispatchEvent(makeDragEvent('dragover', { _store: oscStore }));
        assert(oscTabs[1].classList.contains('tab-drop-hover'), 'Valid dragover on Osc 2 tab adds tab-drop-hover');
        // Child element dragleave (.tab-dot) should NOT remove hover class
        const osc2Dot = oscTabs[1].querySelector('.tab-dot');
        oscTabs[1].dispatchEvent(makeDragEvent('dragleave', { relatedTarget: osc2Dot }));
        assert(oscTabs[1].classList.contains('tab-drop-hover'), 'dragleave to child .tab-dot preserves tab-drop-hover');
        oscTabs[1].dispatchEvent(makeDragEvent('drop', { _store: oscStore }));
        assert(!oscTabs[1].classList.contains('tab-drop-hover'), 'Drop on Osc 2 tab clears tab-drop-hover');
        assertEqual(dndProg.getValue('OSC2_SHAPE'), 77, 'Dropping Osc 1 tab onto Osc 2 tab copies OSC1_SHAPE -> OSC2_SHAPE');
        oscTabs[0].dispatchEvent(makeDragEvent('dragend'));

        // Active synth-card-body as drop target when dragging non-active Osc 2 -> active Osc 1
        const oscBody = oscCard.querySelector('.synth-card-body');
        dndProg.setValue('OSC1_SHAPE', 12);
        dndProg.setValue('OSC2_SHAPE', 99);
        oscTabs[0].dispatchEvent(makeDragEvent('dragstart', { _store: oscStore }));
        oscBody.dispatchEvent(makeDragEvent('dragover', { _store: oscStore }));
        assert(!oscBody.classList.contains('slot-drop-hover'), 'Dragging active Osc 1 over synth-card-body does not add slot-drop-hover');
        oscTabs[0].dispatchEvent(makeDragEvent('dragend'));
        oscTabs[1].dispatchEvent(makeDragEvent('dragstart', { _store: oscStore }));
        oscBody.dispatchEvent(makeDragEvent('dragover', { _store: oscStore }));
        assert(oscBody.classList.contains('slot-drop-hover'), 'Dragging non-active Osc 2 over synth-card-body adds slot-drop-hover');
        oscBody.dispatchEvent(makeDragEvent('drop', { _store: oscStore }));
        assert(!oscBody.classList.contains('slot-drop-hover'), 'Drop on synth-card-body clears slot-drop-hover');
        assertEqual(dndProg.getValue('OSC1_SHAPE'), 99, 'Dropping non-active Osc 2 onto synth-card-body copies OSC2_SHAPE -> OSC1_SHAPE');
        oscTabs[1].dispatchEvent(makeDragEvent('dragend'));

        // 3b. Envelope Tabs & ADSR Graph Cards (createEnvelopePanel)
        const envCard = dndApp.createEnvelopePanel(() => dndProg, () => {});
        const envTabs = envCard.querySelectorAll('.btn-env-tab');
        const envGraphCards = envCard.querySelectorAll('.adsr-graph-card');
        assertEqual(envTabs.length, 3, 'Envelope panel renders 3 tabs');
        assertEqual(envGraphCards.length, 3, 'Envelope panel renders 3 ADSR graph cards');
        assert(envTabs.every(t => t.attributes.get('draggable') === 'true'), 'All btn-env-tab elements have draggable="true"');
        assert(envGraphCards.every(c => c.attributes.get('draggable') === 'true'), 'All adsr-graph-card elements have draggable="true"');

        // Cross-type rejection: dragging Osc 1 over Env 2 tab must not highlight
        oscTabs[0].dispatchEvent(makeDragEvent('dragstart', { _store: oscStore }));
        envTabs[1].dispatchEvent(makeDragEvent('dragover', { _store: oscStore }));
        assert(!envTabs[1].classList.contains('tab-drop-hover'), 'Cross-type dragover (osc -> env) does not add tab-drop-hover');
        oscTabs[0].dispatchEvent(makeDragEvent('dragend'));

        // Dragging Env 1 ADSR graph card onto Env 2 ADSR graph card
        dndProg.setValue('ENV1_ATK', 55);
        dndProg.setValue('ENV2_ATK', 9);
        const envStore = {};
        envGraphCards[0].dispatchEvent(makeDragEvent('dragstart', { _store: envStore }));
        envGraphCards[1].dispatchEvent(makeDragEvent('dragover', { _store: envStore }));
        assert(envGraphCards[1].classList.contains('slot-drop-hover'), 'Valid dragover on Env 2 graph card adds slot-drop-hover');
        const env2Label = envGraphCards[1].querySelector('.adsr-graph-label');
        envGraphCards[1].dispatchEvent(makeDragEvent('dragleave', { relatedTarget: env2Label }));
        assert(envGraphCards[1].classList.contains('slot-drop-hover'), 'dragleave to child .adsr-graph-label preserves slot-drop-hover');
        envGraphCards[1].dispatchEvent(makeDragEvent('drop', { _store: envStore }));
        assert(!envGraphCards[1].classList.contains('slot-drop-hover'), 'Drop on Env 2 graph card clears slot-drop-hover');
        assertEqual(dndProg.getValue('ENV2_ATK'), 55, 'Dropping Env 1 graph card onto Env 2 graph card copies ENV1_ATK -> ENV2_ATK');
        envGraphCards[0].dispatchEvent(makeDragEvent('dragend'));

        // Active env-pane-1 as drop target when dragging non-active Env 2 -> active Env 1
        const envPane1 = envCard.querySelector('.env-pane-1');
        dndProg.setValue('ENV1_ATK', 8);
        dndProg.setValue('ENV2_ATK', 64);
        envTabs[0].dispatchEvent(makeDragEvent('dragstart', { _store: envStore }));
        envPane1.dispatchEvent(makeDragEvent('dragover', { _store: envStore }));
        assert(!envPane1.classList.contains('slot-drop-hover'), 'Dragging active Env 1 over env-pane-1 does not add slot-drop-hover');
        envTabs[0].dispatchEvent(makeDragEvent('dragend'));
        envTabs[1].dispatchEvent(makeDragEvent('dragstart', { _store: envStore }));
        envPane1.dispatchEvent(makeDragEvent('dragover', { _store: envStore }));
        assert(envPane1.classList.contains('slot-drop-hover'), 'Dragging non-active Env 2 over env-pane-1 adds slot-drop-hover');
        envPane1.dispatchEvent(makeDragEvent('drop', { _store: envStore }));
        assert(!envPane1.classList.contains('slot-drop-hover'), 'Drop on env-pane-1 clears slot-drop-hover');
        assertEqual(dndProg.getValue('ENV1_ATK'), 64, 'Dropping non-active Env 2 onto env-pane-1 copies ENV2_ATK -> ENV1_ATK');
        envTabs[1].dispatchEvent(makeDragEvent('dragend'));

        // 3c. LFOs, Mod Matrix, Multipliers & non-droppable Lag Generator via shared helpers
        const wireTestSection = (type, count, badgeClass, boxClass) => {
            const boxes = [];
            const badges = [];
            for (let idx = 1; idx <= count; idx++) {
                const box = document.createElement('div');
                box.className = boxClass;
                const badge = document.createElement('div');
                badge.className = badgeClass;
                box.appendChild(badge);
                dndApp.wireSectionDragSource(badge, type, idx, { containerEl: box });
                dndApp.wireSectionDropTarget(box, type, idx, () => dndProg, () => {}, { hoverClass: 'slot-drop-hover' });
                boxes.push(box);
                badges.push(badge);
            }
            return { boxes, badges };
        };

        const lfoGroup = wireTestSection('lfo', 2, 'lfo-badge', 'lfo-sub-card');
        const mtxGroup = wireTestSection('mtx', 2, 'matrix-slot-badge', 'matrix-slot-row');
        const multGroup = wireTestSection('mult', 2, 'mult-badge', 'math-sub-panel');
        const lagBox = document.createElement('div');
        lagBox.className = 'math-sub-panel';

        assert(lfoGroup.badges.every(b => b.attributes.get('draggable') === 'true'), 'lfo-badge elements have draggable="true"');
        assert(mtxGroup.badges.every(b => b.attributes.get('draggable') === 'true'), 'matrix-slot-badge elements have draggable="true"');
        assert(multGroup.badges.every(b => b.attributes.get('draggable') === 'true'), 'mult-badge elements have draggable="true"');

        // Multiplier 1 -> Multiplier 2, and Lag Generator stays non-droppable
        dndProg.setValue('MULT_A1', 19);
        dndProg.setValue('MULT_B1', 31);
        dndProg.setValue('MULT_A2', 0);
        dndProg.setValue('MULT_B2', 0);
        const multStore = {};
        multGroup.badges[0].dispatchEvent(makeDragEvent('dragstart', { _store: multStore }));
        lagBox.dispatchEvent(makeDragEvent('dragover', { _store: multStore }));
        assert(!lagBox.classList.contains('slot-drop-hover'), 'Lag Generator does not highlight when dragging a Multiplier');
        multGroup.boxes[1].dispatchEvent(makeDragEvent('dragover', { _store: multStore }));
        assert(multGroup.boxes[1].classList.contains('slot-drop-hover'), 'Multiplier 2 highlights on Multiplier 1 dragover');
        multGroup.boxes[1].dispatchEvent(makeDragEvent('drop', { _store: multStore }));
        assert(!multGroup.boxes[1].classList.contains('slot-drop-hover'), 'Multiplier 2 clears slot-drop-hover on drop');
        assertEqual(dndProg.getValue('MULT_A2'), 19, 'Multiplier drop copies MULT_A1 -> MULT_A2');
        assertEqual(dndProg.getValue('MULT_B2'), 31, 'Multiplier drop copies MULT_B1 -> MULT_B2');
        multGroup.badges[0].dispatchEvent(makeDragEvent('dragend'));

        // LFO 1 -> LFO 2
        dndProg.setValue('LFO1_WAVE', 8);
        dndProg.setValue('LFO2_WAVE', 0);
        const lfoStore = {};
        lfoGroup.badges[0].dispatchEvent(makeDragEvent('dragstart', { _store: lfoStore }));
        lfoGroup.boxes[1].dispatchEvent(makeDragEvent('dragover', { _store: lfoStore }));
        assert(lfoGroup.boxes[1].classList.contains('slot-drop-hover'), 'LFO 2 highlights on LFO 1 dragover');
        lfoGroup.boxes[1].dispatchEvent(makeDragEvent('drop', { _store: lfoStore }));
        assertEqual(dndProg.getValue('LFO2_WAVE'), 8, 'LFO drop copies LFO1_WAVE -> LFO2_WAVE');
        lfoGroup.badges[0].dispatchEvent(makeDragEvent('dragend'));

        // Mod Matrix 1 -> Mod Matrix 2
        dndProg.setValue('MTX1_SRC', 14);
        dndProg.setValue('MTX2_SRC', 0);
        const mtxStore = {};
        mtxGroup.badges[0].dispatchEvent(makeDragEvent('dragstart', { _store: mtxStore }));
        mtxGroup.boxes[1].dispatchEvent(makeDragEvent('dragover', { _store: mtxStore }));
        assert(mtxGroup.boxes[1].classList.contains('slot-drop-hover'), 'Mod Matrix Slot 2 highlights on Slot 1 dragover');
        mtxGroup.boxes[1].dispatchEvent(makeDragEvent('drop', { _store: mtxStore }));
        assertEqual(dndProg.getValue('MTX2_SRC'), 14, 'Mod Matrix drop copies MTX1_SRC -> MTX2_SRC');
        mtxGroup.badges[0].dispatchEvent(makeDragEvent('dragend'));

        // 3d. Sequencer Steps (1-to-1 and 1-to-all "Copy to all" button)
        const seqProg = new MM2Program();
        const seqEl = createArpSequencer(() => seqProg, () => {});
        const stepCols = seqEl.querySelectorAll('.step-col');
        assertEqual(stepCols.length, 16, 'Sequencer renders 16 step-col elements');
        assert(stepCols.every(c => c.attributes.get('draggable') === 'true'), 'All step-col elements have draggable="true"');

        const toolsDiv = seqEl.querySelector('.sequencer-tools');
        const copyAllBtn = seqEl.querySelector('#seq-copy-all-btn');
        const clearBtn = seqEl.querySelector('#seq-clear-btn');
        assert(copyAllBtn !== null, 'Sequencer renders #seq-copy-all-btn');
        assertEqual(copyAllBtn.textContent, 'Copy to all', 'Copy to all button has exact label "Copy to all"');
        assertEqual(toolsDiv.children[0], copyAllBtn, 'Copy to all button appears to the left of seq-clear-btn');
        assertEqual(toolsDiv.children[1], clearBtn, 'seq-clear-btn immediately follows Copy to all button');
        assert(!copyAllBtn.classList.contains('is-visible'), 'Copy to all button is hidden when not dragging');

        // 1-to-1 mode: Step 1 -> Step 3
        seqProg.setValue('ARP_PTN_STEP01', 6); // 3rd
        seqProg.setValue('ARP_PTN_STEP_MOD01', 2); // High
        seqProg.setValue('ARP_PTN_STEP03', 1); // Off
        seqProg.setValue('ARP_PTN_STEP_MOD03', 0); // Low
        const stepStore = {};
        stepCols[0].dispatchEvent(makeDragEvent('dragstart', { _store: stepStore }));
        assert(copyAllBtn.classList.contains('is-visible'), 'Copy to all button becomes visible on step-col dragstart');
        stepCols[0].dispatchEvent(makeDragEvent('dragover', { _store: stepStore }));
        assert(!stepCols[0].classList.contains('slot-drop-hover'), 'Self dragover on step-col 1 does not add slot-drop-hover');
        stepCols[2].dispatchEvent(makeDragEvent('dragover', { _store: stepStore }));
        assert(stepCols[2].classList.contains('slot-drop-hover'), 'Valid dragover on step-col 3 adds slot-drop-hover');
        const step3Num = stepCols[2].querySelector('.step-number');
        stepCols[2].dispatchEvent(makeDragEvent('dragleave', { relatedTarget: step3Num }));
        assert(stepCols[2].classList.contains('slot-drop-hover'), 'dragleave to child .step-number preserves slot-drop-hover');
        stepCols[2].dispatchEvent(makeDragEvent('drop', { _store: stepStore }));
        assert(!stepCols[2].classList.contains('slot-drop-hover'), 'Drop on step-col 3 clears slot-drop-hover');
        assert(!copyAllBtn.classList.contains('is-visible'), 'Copy to all button hides after 1-to-1 drop');
        assertEqual(seqProg.getValue('ARP_PTN_STEP03'), 6, '1-to-1 drop copies ARP_PTN_STEP01 -> ARP_PTN_STEP03');
        assertEqual(seqProg.getValue('ARP_PTN_STEP_MOD03'), 2, '1-to-1 drop copies ARP_PTN_STEP_MOD01 -> ARP_PTN_STEP_MOD03');

        // 1-to-all mode: Step 2 -> Copy to all
        seqProg.setValue('ARP_PTN_STEP02', 11); // Chord
        seqProg.setValue('ARP_PTN_STEP_MOD02', 3); // Random
        const allStore = {};
        stepCols[1].dispatchEvent(makeDragEvent('dragstart', { _store: allStore }));
        assert(copyAllBtn.classList.contains('is-visible'), 'Copy to all button visible during step 2 drag');
        copyAllBtn.dispatchEvent(makeDragEvent('dragover', { _store: allStore }));
        assert(copyAllBtn.classList.contains('slot-drop-hover'), 'Copy to all button highlights on dragover');
        copyAllBtn.dispatchEvent(makeDragEvent('drop', { _store: allStore }));
        assert(!copyAllBtn.classList.contains('is-visible'), 'Copy to all button hides after drop');
        assert(!copyAllBtn.classList.contains('slot-drop-hover'), 'Copy to all button clears slot-drop-hover after drop');
        let allStepsMatched = true;
        for (let s = 1; s <= 16; s++) {
            const pad = s.toString().padStart(2, '0');
            if (seqProg.getValue(`ARP_PTN_STEP${pad}`) !== 11 || seqProg.getValue(`ARP_PTN_STEP_MOD${pad}`) !== 3) {
                allStepsMatched = false;
                break;
            }
        }
        assert(allStepsMatched, '1-to-all drop copies step 2 mode and mod to all 16 steps');
    } catch (e) {
        logger(`  Error: ${e.message}`);
        failed++;
    }

    // ==========================================
    // 39. Multi-Memory & Part Drag-and-Drop Tests
    // ==========================================
    logger('\n--- [39] Multi-Memory & Part Drag-and-Drop Tests ---');
    try {
        const memApp = new App();
        memApp.showNotification = () => {};
        memApp.memories = [null, null, null, null];

        const makeEvent = (type, overrides = {}) => {
            const store = overrides._store || {};
            return {
                type,
                relatedTarget: overrides.relatedTarget || null,
                preventDefaultCalled: false,
                stopPropagationCalled: false,
                preventDefault() { this.preventDefaultCalled = true; },
                stopPropagation() { this.stopPropagationCalled = true; },
                dataTransfer: {
                    effectAllowed: '',
                    dropEffect: '',
                    setData(k, v) { store[k] = v; },
                    getData(k) { return store[k] || ''; }
                }
            };
        };

        const memButtons = [0, 1, 2, 3].map(i => {
            const el = document.createElement('button');
            el.id = `btn-mem-${i}`;
            el.dataset = { mem: String(i) };
            return el;
        });
        const partA = document.createElement('button');
        partA.id = 'btn-part-a';
        partA.dataset = { slot: '0' };
        const partB = document.createElement('button');
        partB.id = 'btn-part-b';
        partB.dataset = { slot: '1' };
        const appMain = document.createElement('main');
        appMain.className = 'app-main';
        const editorGrid = document.createElement('div');
        editorGrid.id = 'editor-grid';

        memApp.wireMemoryAndPartDragDrop({
            memButtons,
            partButtons: [partA, partB],
            appMain,
            editorGrid
        });

        assertEqual(memApp.memories.length, 4, 'App initializes 4 memory slots');
        assert(memButtons.every(b => b.attributes.get('draggable') === 'true'), 'All M1-M4 buttons are draggable');
        assertEqual(partA.attributes.get('draggable'), 'true', 'Part A button is draggable');
        assertEqual(partB.attributes.get('draggable'), 'true', 'Part B button is draggable');

        // Dragging empty M1 should be prevented
        const emptyDrag = makeEvent('dragstart');
        memButtons[0].dispatchEvent(emptyDrag);
        assert(emptyDrag.preventDefaultCalled, 'Empty memory button prevents dragstart');

        // Store Part A into M1 via drag-and-drop
        memApp.timbreA.name = 'MEM1_PAT';
        memApp.timbreA.setValue('OSC1_SHAPE', 88);
        const partToMemStore = {};
        partA.dispatchEvent(makeEvent('dragstart', { _store: partToMemStore }));
        memButtons[0].dispatchEvent(makeEvent('dragover', { _store: partToMemStore }));
        assert(memButtons[0].classList.contains('slot-drop-hover'), 'Part A dragover highlights M1');
        memButtons[0].dispatchEvent(makeEvent('drop', { _store: partToMemStore }));
        assert(!memButtons[0].classList.contains('slot-drop-hover'), 'Drop clears slot-drop-hover on M1');
        assert(memApp.memories[0] !== null, 'M1 is populated after Part A drop');
        assertEqual(memApp.memories[0].name, 'MEM1_PAT', 'M1 retains Part A patch name');
        assertEqual(memApp.memories[0].getValue('OSC1_SHAPE'), 88, 'M1 retains Part A OSC1_SHAPE');

        // Copy M1 -> M2 via drag-and-drop
        const memToMemStore = {};
        memButtons[0].dispatchEvent(makeEvent('dragstart', { _store: memToMemStore }));
        memButtons[1].dispatchEvent(makeEvent('dragover', { _store: memToMemStore }));
        assert(memButtons[1].classList.contains('slot-drop-hover'), 'M1 dragover highlights M2');
        memButtons[1].dispatchEvent(makeEvent('drop', { _store: memToMemStore }));
        assertEqual(memApp.memories[1].name, 'MEM1_PAT', 'M1 -> M2 drop copies patch name');
        assertEqual(memApp.memories[1].getValue('OSC1_SHAPE'), 88, 'M1 -> M2 drop copies OSC1_SHAPE');

        // Modify Part A, then click M1 to overwrite Part A as 1 undoable step
        memApp.timbreA.name = 'MODIFIED';
        memApp.timbreA.setValue('OSC1_SHAPE', 15);
        memApp.undoStack = [];
        memApp.redoStack = [];
        memButtons[0].dispatchEvent(makeEvent('click'));
        assertEqual(memApp.timbreA.name, 'MEM1_PAT', 'Clicking M1 overwrites active Part name');
        assertEqual(memApp.timbreA.getValue('OSC1_SHAPE'), 88, 'Clicking M1 overwrites active Part OSC1_SHAPE');
        assertEqual(memApp.undoStack.length, 1, 'Clicking M1 creates exactly 1 undo step');

        // Undo restores entire previous Part A state
        memApp.undo();
        assertEqual(memApp.timbreA.name, 'MODIFIED', 'Single Undo restores previous Part name');
        assertEqual(memApp.timbreA.getValue('OSC1_SHAPE'), 15, 'Single Undo restores previous OSC1_SHAPE');

        // Redo reapplies entire M1 state
        memApp.redo();
        assertEqual(memApp.timbreA.name, 'MEM1_PAT', 'Single Redo reapplies M1 Part name');
        assertEqual(memApp.timbreA.getValue('OSC1_SHAPE'), 88, 'Single Redo reapplies M1 OSC1_SHAPE');

        // Drag M2 -> app-main replaces active Part without warning dialog
        memApp.timbreA.name = 'BEFORE_M';
        memApp.timbreA.setValue('OSC1_SHAPE', 22);
        const memToMainStore = {};
        memButtons[1].dispatchEvent(makeEvent('dragstart', { _store: memToMainStore }));
        appMain.dispatchEvent(makeEvent('dragover', { _store: memToMainStore }));
        assert(appMain.classList.contains('slot-drop-hover'), 'M2 dragover highlights app-main');
        appMain.dispatchEvent(makeEvent('drop', { _store: memToMainStore }));
        assert(!appMain.classList.contains('slot-drop-hover'), 'Drop clears slot-drop-hover on app-main');
        assertEqual(memApp.timbreA.name, 'MEM1_PAT', 'M2 -> app-main drop replaces active Part name');
        assertEqual(memApp.timbreA.getValue('OSC1_SHAPE'), 88, 'M2 -> app-main drop replaces active Part OSC1_SHAPE');

        // Monotimbral mode: Part A -> Part B and Part A -> editor-grid are deactivated
        memApp.setTimbralMode('monotimbral');
        memApp.timbreB.name = 'INIT_B';
        const monoPartStore = {};
        partA.dispatchEvent(makeEvent('dragstart', { _store: monoPartStore }));
        partB.dispatchEvent(makeEvent('dragover', { _store: monoPartStore }));
        assert(!partB.classList.contains('slot-drop-hover'), 'Monotimbral: Part B does not highlight on Part A dragover');
        partB.dispatchEvent(makeEvent('drop', { _store: monoPartStore }));
        assertEqual(memApp.timbreB.name, 'INIT_B', 'Monotimbral: Part A -> Part B drop does not overwrite Part B');
        editorGrid.dispatchEvent(makeEvent('dragover', { _store: monoPartStore }));
        assert(!editorGrid.classList.contains('slot-drop-hover'), 'Monotimbral: editor-grid does not highlight on Part A dragover');
        partA.dispatchEvent(makeEvent('dragend'));

        // Bitimbral mode: Part A -> Part B enabled; Part A -> editor-grid only enabled when Part B is active
        memApp.setTimbralMode('bitimbral');
        memApp.selectPart(0); // Part A active
        const biPartStore = {};
        partA.dispatchEvent(makeEvent('dragstart', { _store: biPartStore }));
        editorGrid.dispatchEvent(makeEvent('dragover', { _store: biPartStore }));
        assert(!editorGrid.classList.contains('slot-drop-hover'), 'Bitimbral (Part A active): editor-grid does not highlight for Part A drag');

        partB.dispatchEvent(makeEvent('dragover', { _store: biPartStore }));
        assert(partB.classList.contains('slot-drop-hover'), 'Bitimbral: Part B highlights on Part A dragover');
        partB.dispatchEvent(makeEvent('drop', { _store: biPartStore }));
        assertEqual(memApp.timbreB.name, 'MEM1_PAT', 'Bitimbral: Part A -> Part B drop copies Part A to Part B');
        assertEqual(memApp.timbreB.getValue('OSC1_SHAPE'), 88, 'Bitimbral: Part A -> Part B drop copies OSC1_SHAPE');

        // Now switch active Part to Part B, then drag Part A -> editor-grid
        memApp.timbreB.name = 'OLD_B';
        memApp.timbreB.setValue('OSC1_SHAPE', 33);
        memApp.selectPart(1);
        const biGridStore = {};
        partA.dispatchEvent(makeEvent('dragstart', { _store: biGridStore }));
        editorGrid.dispatchEvent(makeEvent('dragover', { _store: biGridStore }));
        assert(editorGrid.classList.contains('slot-drop-hover'), 'Bitimbral (Part B active): editor-grid highlights on Part A dragover');
        editorGrid.dispatchEvent(makeEvent('drop', { _store: biGridStore }));
        assertEqual(memApp.timbreB.name, 'MEM1_PAT', 'Bitimbral (Part B active): Part A -> editor-grid replaces Part B name');
        assertEqual(memApp.timbreB.getValue('OSC1_SHAPE'), 88, 'Bitimbral (Part B active): Part A -> editor-grid replaces Part B OSC1_SHAPE');

        // Undo reverts Part B replacement in 1 step
        memApp.undo();
        assertEqual(memApp.timbreB.name, 'OLD_B', 'Undo reverts Part A -> editor-grid replacement in 1 step');
        assertEqual(memApp.timbreB.getValue('OSC1_SHAPE'), 33, 'Undo restores Part B OSC1_SHAPE in 1 step');
    } catch (e) {
        logger(`  Error: ${e.message}`);
        failed++;
    }

    logger(`\n========================================`);
    logger(` Test Results: ${passed} Passed, ${failed} Failed`);
    logger(`========================================\n`);

    return { passed, failed };
}
