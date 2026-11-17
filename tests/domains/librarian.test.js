/**
 * Domain Tests: Patch Librarian, Banks & Duplicates
 */
MM2TestRunner.register('Patch Librarian, Banks & Duplicates', async ({ assert, assertEqual, logger, runSection }) => {
    await runSection('\n--- [4] Bank Multi-Patch Extraction & Librarian Tests ---', async () => {
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
    });

    await runSection('\n--- [5] Duplicate Detection & Condensation Tests ---', async () => {
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
    });

    await runSection('\n--- [9] Editor Load vs Librarian Isolation Tests ---', async () => {
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
    });

    await runSection('\n--- [27] Fingerprint Memoization & SysEx Stream Guard Tests ---', async () => {
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
    });

    await runSection('\n--- [29] Librarian HW Poll Isolation & Empty Default Banks Tests ---', async () => {
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

        const mockOut = { id: 'mm2_out', name: 'MicroMonsta 2', send: () => { } };
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
    });

    await runSection('\n--- [30] Librarian Bank Deletion Tests ---', async () => {
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
        await delApp.deleteBank();
        assertEqual(notifiedWarning, true, 'deleteBank warns user when trying to delete the only bank');
        assertEqual(delApp.librarian.banks.length, 1, 'Single bank was not deleted');

        // Two banks with app-styled dialog rejection (never calls browser confirm)
        delApp.librarian.banks = [new MM2Bank('Bank A', 0), new MM2Bank('Bank B', 1)];
        let confirmCalled = false;
        global.confirm = () => { confirmCalled = true; return true; };

        const deleteDialog = document.createElement('dialog');
        deleteDialog.id = 'delete-bank-dialog';
        deleteDialog.open = false;
        deleteDialog.returnValue = '';
        deleteDialog._listeners = {};
        deleteDialog.addEventListener = (evt, fn) => { deleteDialog._listeners[evt] = fn; };
        deleteDialog.removeEventListener = (evt, fn) => {
            if (deleteDialog._listeners[evt] === fn) delete deleteDialog._listeners[evt];
        };
        const deleteDesc = document.createElement('p');
        deleteDesc.id = 'delete-bank-desc';
        document.registerMockElement('delete-bank-dialog', deleteDialog);
        document.registerMockElement('delete-bank-desc', deleteDesc);

        let nextDialogAction = 'cancel';
        deleteDialog.showModal = () => {
            deleteDialog.returnValue = nextDialogAction;
            if (deleteDialog._listeners.close) deleteDialog._listeners.close();
        };

        await delApp.deleteBank(1);
        assertEqual(confirmCalled, false, 'deleteBank does not invoke browser confirm()');
        assert(deleteDesc.textContent.includes('Bank B'), 'Delete bank dialog description includes bank name');
        assertEqual(delApp.librarian.banks.length, 2, 'Bank not deleted when dialog canceled');

        // App-styled dialog accepted
        nextDialogAction = 'confirm';
        let notifiedSuccess = false;
        delApp.showNotification = (msg, type) => {
            if (type === 'success') notifiedSuccess = true;
        };
        await delApp.deleteBank(1);
        assertEqual(confirmCalled, false, 'deleteBank does not invoke browser confirm() on confirm');
        assertEqual(delApp.librarian.banks.length, 1, 'Bank deleted when app dialog confirmed');
        assertEqual(notifiedSuccess, true, 'Success notification shown on bank deletion');
        delete global.confirm;
    });

    await runSection('\n--- [31] Librarian Patch Category Editing Tests ---', async () => {
        const catApp = new App();
        const testBank = new MM2Bank('Category Bank', 0);
        const testProg = new MM2Program();
        testProg.name = 'TEST_CAT';
        testProg.category = 0; // Bass
        testBank.addProgram(testProg);
        catApp.librarian.banks = [testBank];
        catApp.librarian.activeBankIndex = 0;

        // Mock document elements
        const bankTabsEl = { innerHTML: '', appendChild: () => { } };
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
                    classList: { add: () => { }, remove: () => { } },
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
            stopPropagation: () => { }
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
    });

    await runSection('\n--- [34] Librarian Bank Renaming Tests ---', async () => {
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

        // 3. Inline bank tab renaming UI flow
        const app = new App();
        app.librarian.banks = [new MM2Bank('Studio Favorites', 0)];
        app.librarian.activeBankIndex = 0;

        let notifType = null;
        app.showNotification = (msg, type) => { notifType = type; };

        const bankTabs = document.createElement('div');
        bankTabs.id = 'bank-tabs';
        document.registerMockElement('bank-tabs', bankTabs);

        const progList = document.createElement('tbody');
        progList.id = 'librarian-prog-list';
        document.registerMockElement('librarian-prog-list', progList);

        app.renderLibrarianBank();

        // Check rendered tab has double-click inline edit handler
        const renderedTab = bankTabs.querySelector('.bank-tab');
        const renderedTitle = bankTabs.querySelector('.bank-tab-title');
        assert(renderedTitle !== null, 'Rendered bank tab title exists');
        assertEqual(renderedTitle.title, 'Double-click to rename', 'Bank tab title has double-click rename tooltip');
        assertEqual(renderedTitle.onclick || null, null, 'Bank tab title does not have onclick handler');
        assert(typeof renderedTitle.ondblclick === 'function', 'Bank tab title has ondblclick handler');

        // Clicking active tab does not re-render/destroy DOM before double-click
        renderedTab.onclick();
        assert(bankTabs.querySelector('.bank-tab-title') === renderedTitle, 'Clicking active tab preserves tab title element for dblclick');

        // Double-clicking tab title enters inline edit mode
        renderedTitle.ondblclick({ stopPropagation: () => { } });
        const inlineInput = renderedTitle.querySelector('input');
        assert(inlineInput !== null, 'Double-clicking tab title replaces title with inline input');
        assertEqual(inlineInput.className, 'bank-tab-title-input', 'Inline input has expected class');
        assertEqual(inlineInput.value, 'Studio Favorites', 'Inline input pre-filled with current bank name');
        assertEqual(renderedTab.getAttribute('draggable'), 'false', 'Parent tab dragging disabled during inline edit');

        // Double-clicking again while editing does not create a second input
        renderedTitle.ondblclick({ stopPropagation: () => { } });
        assertEqual(renderedTitle.children.length, 1, 'Double-clicking again while editing does not duplicate input');

        // Pressing Escape cancels rename and exits entry mode
        notifType = null;
        inlineInput.value = 'Canceled Name';
        inlineInput.onkeydown({ key: 'Escape', preventDefault: () => { }, stopPropagation: () => { } });
        inlineInput.onblur(); // Subsequent blur after Escape must be a no-op
        assertEqual(app.librarian.banks[0].name, 'Studio Favorites', 'Escape cancels rename without modifying bank name');
        assertEqual(notifType, null, 'Escape cancellation does not emit notification');
        assertEqual(renderedTitle.querySelector('input'), null, 'Escape deactivates entry mode');
        assertEqual(renderedTitle.textContent, 'Studio Favorites', 'Escape restores original bank title text');
        assertEqual(renderedTab.getAttribute('draggable'), 'true', 'Parent tab dragging restored after Escape');

        // Double-clicking and pressing Enter accepts trimmed rename and exits entry mode
        renderedTitle.ondblclick({ stopPropagation: () => { } });
        const enterInput = renderedTitle.querySelector('input');
        enterInput.value = '  Live Set  ';
        enterInput.onkeydown({ key: 'Enter', preventDefault: () => { }, stopPropagation: () => { } });
        assertEqual(app.librarian.banks[0].name, 'Live Set', 'Enter commits trimmed bank name');
        assertEqual(notifType, 'success', 'Success notification shown on Enter rename');
        const updatedTitle = bankTabs.querySelector('.bank-tab-title');
        assertEqual(updatedTitle.querySelector('input'), null, 'Enter deactivates entry mode');
        assertEqual(updatedTitle.textContent, 'Live Set', 'Rendered tab title updated after Enter');

        // Empty/whitespace name on blur warns and restores original name
        notifType = null;
        updatedTitle.ondblclick({ stopPropagation: () => { } });
        const emptyInput = updatedTitle.querySelector('input');
        emptyInput.value = '   ';
        emptyInput.onblur();
        assertEqual(notifType, 'warning', 'Warning notification shown for empty inline bank name');
        assertEqual(app.librarian.banks[0].name, 'Live Set', 'Bank name unchanged when inline input is empty');
        assertEqual(updatedTitle.querySelector('input'), null, 'Blur deactivates entry mode on empty input');

        // Valid name on blur commits rename
        notifType = null;
        updatedTitle.ondblclick({ stopPropagation: () => { } });
        const blurInput = updatedTitle.querySelector('input');
        blurInput.value = 'Ambient Pads';
        blurInput.onblur();
        assertEqual(app.librarian.banks[0].name, 'Ambient Pads', 'Blur commits valid inline bank name');
        assertEqual(notifType, 'success', 'Success notification shown on blur rename');
        assertEqual(bankTabs.querySelector('.bank-tab-title').querySelector('input'), null, 'Blur deactivates entry mode');

        // Create Bank button creates bank tab and enters inline edit mode without browser prompt
        const btnAddBank = document.createElement('button');
        btnAddBank.id = 'btn-add-bank';
        document.registerMockElement('btn-add-bank', btnAddBank);
        app.buildLibrarianUI();

        let promptCalled = false;
        global.prompt = () => { promptCalled = true; return 'Should Not Prompt'; };
        btnAddBank.onclick();
        delete global.prompt;

        assertEqual(promptCalled, false, 'Create Bank does not invoke browser prompt()');
        assertEqual(app.librarian.banks.length, 2, 'Create Bank adds a new bank');
        assertEqual(app.librarian.activeBankIndex, 1, 'Create Bank selects the newly created bank');
        const createdTab = bankTabs.children[1];
        const createdTitle = createdTab ? createdTab.querySelector('.bank-tab-title') : null;
        const createdInput = createdTitle ? createdTitle.querySelector('input') : null;
        assert(createdInput !== null, 'Create Bank puts new bank tab title into inline edit mode');
        assertEqual(createdInput.className, 'bank-tab-title-input', 'Create Bank inline input has expected class');
        assertEqual(createdInput.value, 'Bank 2', 'Create Bank inline input defaults to Bank 2');

        createdInput.value = 'Bass Bank';
        createdInput.onkeydown({ key: 'Enter', preventDefault: () => { }, stopPropagation: () => { } });
        assertEqual(app.librarian.banks[1].name, 'Bass Bank', 'Enter commits custom name for newly created bank');
        assertEqual(bankTabs.children[1].querySelector('.bank-tab-title').querySelector('input'), null, 'Enter exits inline edit mode on newly created bank');
    });

    await runSection('\n--- [67] App Confirm & Alert Dialog Tests ---', async () => {
        const dlgApp = new App();
        if (dlgApp.tabSync) {
            dlgApp.tabSync.destroy();
            dlgApp.tabSync = null;
        }
        dlgApp.showNotification = () => { };

        const confirmDialog = document.createElement('dialog');
        confirmDialog.id = 'app-confirm-dialog';
        const confirmTitle = document.createElement('h3');
        confirmTitle.id = 'app-confirm-title';
        const confirmDesc = document.createElement('p');
        confirmDesc.id = 'app-confirm-desc';
        const confirmOkBtn = document.createElement('button');
        confirmOkBtn.id = 'app-confirm-ok-btn';
        let nextConfirmValue = 'cancel';
        confirmDialog.showModal = () => {
            confirmDialog.returnValue = nextConfirmValue;
            confirmDialog.dispatchEvent(new Event('close'));
        };

        const alertDialog = document.createElement('dialog');
        alertDialog.id = 'app-alert-dialog';
        const alertTitle = document.createElement('h3');
        alertTitle.id = 'app-alert-title';
        const alertDesc = document.createElement('p');
        alertDesc.id = 'app-alert-desc';
        let alertShownCount = 0;
        alertDialog.showModal = () => {
            alertShownCount++;
            alertDialog.returnValue = 'ok';
            alertDialog.dispatchEvent(new Event('close'));
        };

        document.registerMockElement('app-confirm-dialog', confirmDialog);
        document.registerMockElement('app-confirm-title', confirmTitle);
        document.registerMockElement('app-confirm-desc', confirmDesc);
        document.registerMockElement('app-confirm-ok-btn', confirmOkBtn);
        document.registerMockElement('app-alert-dialog', alertDialog);
        document.registerMockElement('app-alert-title', alertTitle);
        document.registerMockElement('app-alert-desc', alertDesc);

        const bankTabs = document.createElement('div');
        bankTabs.id = 'bank-tabs';
        document.registerMockElement('bank-tabs', bankTabs);

        const btnExportBank = document.createElement('button');
        btnExportBank.id = 'btn-export-bank';
        const btnCondense = document.createElement('button');
        btnCondense.id = 'btn-condense-bank';
        const btnDeleteAll = document.createElement('button');
        btnDeleteAll.id = 'btn-delete-all-patches';
        document.registerMockElement('btn-export-bank', btnExportBank);
        document.registerMockElement('btn-condense-bank', btnCondense);
        document.registerMockElement('btn-delete-all-patches', btnDeleteAll);

        let browserDialogCalled = false;
        global.confirm = () => { browserDialogCalled = true; return true; };
        global.alert = () => { browserDialogCalled = true; };

        try {
            dlgApp.buildLibrarianUI();

            // 1. Exporting empty bank shows app-alert-dialog
            await btnExportBank.onclick();
            assertEqual(browserDialogCalled, false, 'Export empty bank does not invoke browser alert()');
            assertEqual(alertShownCount, 1, 'Export empty bank opens app-alert-dialog');
            assertEqual(alertTitle.textContent, 'Empty Bank', 'Alert dialog title set to Empty Bank');
            assertEqual(alertDesc.textContent, 'Current bank is empty.', 'Alert dialog description set');

            // 2. Condense bank uses app-confirm-dialog
            dlgApp.librarian.addBank('Test Bank');
            const p1 = new MM2Program();
            p1.name = 'DUP_PAT';
            dlgApp.librarian.activeBank.addProgram(p1);
            dlgApp.librarian.activeBank.addProgram(p1.clone());
            assertEqual(dlgApp.librarian.activeBank.length, 2, 'Bank has 2 duplicate patches');

            nextConfirmValue = 'cancel';
            await btnCondense.onclick();
            assertEqual(browserDialogCalled, false, 'Condense bank does not invoke browser confirm()');
            assertEqual(dlgApp.librarian.activeBank.length, 2, 'Condense canceled leaves 2 patches');

            nextConfirmValue = 'confirm';
            await btnCondense.onclick();
            assertEqual(dlgApp.librarian.activeBank.length, 1, 'Condense confirmed removes duplicate');

            // 3. Delete all patches uses app-confirm-dialog
            nextConfirmValue = 'cancel';
            await btnDeleteAll.onclick();
            assertEqual(dlgApp.librarian.activeBank.length, 1, 'Delete all canceled preserves patch');

            nextConfirmValue = 'confirm';
            await btnDeleteAll.onclick();
            assertEqual(dlgApp.librarian.activeBank.length, 0, 'Delete all confirmed clears bank');
        } finally {
            delete global.confirm;
            delete global.alert;
            document.registerMockElement('app-confirm-dialog', null);
            document.registerMockElement('app-confirm-title', null);
            document.registerMockElement('app-confirm-desc', null);
            document.registerMockElement('app-confirm-ok-btn', null);
            document.registerMockElement('app-alert-dialog', null);
            document.registerMockElement('app-alert-title', null);
            document.registerMockElement('app-alert-desc', null);
            document.registerMockElement('bank-tabs', null);
            document.registerMockElement('btn-export-bank', null);
            document.registerMockElement('btn-condense-bank', null);
            document.registerMockElement('btn-delete-all-patches', null);
        }
    });

});
