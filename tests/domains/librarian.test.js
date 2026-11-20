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

    await runSection('\n--- [68] Librarian Cross-Bank & Multi-Select Drag-and-Drop Tests ---', async () => {
        // 1. MM2Bank.moveProgramsGroup unit behavior
        const grpBank = new MM2Bank('GroupTest');
        ['A', 'B', 'C', 'D', 'E'].forEach(n => {
            const p = new MM2Program();
            p.name = n;
            grpBank.addProgram(p);
        });
        grpBank.moveProgramsGroup([2, 4], 1); // C, E -> index 1
        assertEqual(grpBank.programs.map(p => p.name).join(','), 'A,C,E,B,D', 'moveProgramsGroup moves non-contiguous group up consecutively');

        grpBank.moveProgramsGroup([0, 2], 4); // A, E -> end
        assertEqual(grpBank.programs.map(p => p.name).join(','), 'C,B,D,A,E', 'moveProgramsGroup moves non-contiguous group down consecutively to end');

        // 2. App UI: cross-bank single patch drag, multi-select group reorder & cross-bank move with drop tips
        const dndApp = new App();
        dndApp.librarian = {
            banks: [new MM2Bank('BankOne'), new MM2Bank('BankTwo')],
            activeBankIndex: 0,
            get activeBank() { return this.banks[this.activeBankIndex]; },
            saveAllBanks: async () => {},
            moveProgramsToBank: PatchLibrarian.prototype.moveProgramsToBank,
            duplicateBank: PatchLibrarian.prototype.duplicateBank,
            reorderBanks: PatchLibrarian.prototype.reorderBanks
        };
        ['P1', 'P2', 'P3', 'P4'].forEach(n => {
            const p = new MM2Program();
            p.name = n;
            dndApp.librarian.banks[0].addProgram(p);
        });
        const existingB2 = new MM2Program();
        existingB2.name = 'B2_01';
        dndApp.librarian.banks[1].addProgram(existingB2);

        let lastNotif = '';
        dndApp.showNotification = (msg) => { lastNotif = msg; };

        const prevCreateEl = document.createElement;
        document.createElement = (tag) => {
            const el = prevCreateEl.call(document, tag);
            const origQS = el.querySelector ? el.querySelector.bind(el) : () => null;
            el.querySelector = (sel) => {
                const found = origQS(sel);
                if (found) return found;
                if (sel === '.prog-select-cb') {
                    if (!el._cb) el._cb = { checked: false, onclick: null, onmousedown: null };
                    return el._cb;
                }
                return { onclick: null, ondblclick: null };
            };
            return el;
        };

        try {
            const bankTabsEl = document.createElement('div');
            bankTabsEl.id = 'bank-tabs';
            document.registerMockElement('bank-tabs', bankTabsEl);
            const progListEl = document.createElement('div');
            progListEl.id = 'librarian-prog-list';
            document.registerMockElement('librarian-prog-list', progListEl);

            dndApp.renderLibrarianBank();
            assertEqual(bankTabsEl.children.length, 2, 'Rendered 2 bank tabs');
            assertEqual(progListEl.children.length, 4, 'Rendered 4 program rows');

            // Single patch drag to BankTwo tab
            const singleDragStore = {};
            const row0 = progListEl.children[0];
            const bank2Tab = bankTabsEl.children[1];
            row0.ondragstart({
                dataTransfer: {
                    effectAllowed: '',
                    setData: (k, v) => { singleDragStore[k] = v; }
                }
            });
            bank2Tab.ondragover({
                preventDefault: () => {},
                dataTransfer: { dropEffect: '' }
            });
            assert(bank2Tab.classList.contains('slot-drop-hover'), 'Target bank tab highlights on single patch dragover');
            assertEqual(bank2Tab.getAttribute('data-drop-tip'), 'Drop to move "P1" to "BankTwo"', 'Target bank tab shows single patch drop tip');
            bank2Tab.ondrop({
                preventDefault: () => {},
                dataTransfer: { getData: (k) => singleDragStore[k] || '' }
            });
            assertEqual(bank2Tab.getAttribute('data-drop-tip') || '', '', 'Target bank tab clears drop tip after drop');
            assertEqual(dndApp.librarian.banks[0].programs.map(p => p.name).join(','), 'P2,P3,P4', 'Source bank removes moved patch');
            assertEqual(dndApp.librarian.banks[1].programs.map(p => p.name).join(','), 'B2_01,P1', 'Target bank appends moved patch to end');
            assert(lastNotif.includes('BankTwo'), 'Notification mentions target bank');

            // Multi-select patches (index 0: P2 and index 2: P4) and reorder onto index 1 (P3)
            const cb0 = progListEl.children[0].querySelector('.prog-select-cb');
            const cb2 = progListEl.children[2].querySelector('.prog-select-cb');
            cb0.onclick({ stopPropagation: () => {}, shiftKey: false });
            cb2.onclick({ stopPropagation: () => {}, shiftKey: false });
            assertEqual(dndApp.selectedProgIndices.size, 2, 'Multi-select tracks 2 selected patches');

            const groupReorderStore = {};
            progListEl.children[2].ondragstart({
                dataTransfer: {
                    effectAllowed: '',
                    setData: (k, v) => { groupReorderStore[k] = v; }
                }
            });
            const targetRow1 = progListEl.children[1];
            targetRow1.ondragover({
                preventDefault: () => {},
                dataTransfer: { dropEffect: '' }
            });
            assert(targetRow1.classList.contains('slot-drop-hover'), 'Target row highlights on group dragover');
            assert(targetRow1.classList.contains('prog-insert-before'), 'Target row gets prog-insert-before (+) insertion space on dragover');
            assertEqual(targetRow1.getAttribute('data-drop-tip'), 'Drop to move 2 patches to #02', 'Target row shows multi-patch reorder drop tip');
            await targetRow1.ondrop({
                preventDefault: () => {},
                altKey: false,
                shiftKey: false,
                dataTransfer: { getData: (k) => groupReorderStore[k] || '' }
            });
            assert(!targetRow1.classList.contains('prog-insert-before'), 'Target row clears prog-insert-before after drop');
            assertEqual(dndApp.librarian.banks[0].programs.map(p => p.name).join(','), 'P2,P4,P3', 'Group reorder places P2, P4 consecutively and pushes P3 down');
            assertEqual(dndApp.selectedProgIndices.size, 0, 'Selection clears after group reorder');

            // Undo & Redo group reorder
            dndApp.undo();
            assertEqual(dndApp.librarian.banks[0].programs.map(p => p.name).join(','), 'P2,P3,P4', 'Undo restores patch order before group reorder');
            dndApp.redo();
            assertEqual(dndApp.librarian.banks[0].programs.map(p => p.name).join(','), 'P2,P4,P3', 'Redo reapplies group reorder');

            // Single patch drop ON middle of another row copies/pastes patch at that location
            progListEl.children.forEach((rEl, rIdx) => {
                rEl.getBoundingClientRect = () => ({ top: rIdx * 40, bottom: (rIdx + 1) * 40, height: 40 });
            });
            const copyDropStore = {};
            const copyDragDT = {
                effectAllowed: '',
                setData: (k, v) => { copyDropStore[k] = v; }
            };
            progListEl.children[0].ondragstart({
                dataTransfer: copyDragDT
            });
            assertEqual(copyDragDT.effectAllowed, 'copyMove', 'Row dragstart sets effectAllowed to copyMove so copy dropEffect is permitted');
            const row2CenterY = 100; // Middle of row 2 (80..120)
            progListEl.children[2].ondragover({
                preventDefault: () => {},
                stopPropagation: () => {},
                clientY: row2CenterY,
                dataTransfer: { dropEffect: '' }
            });
            assert(!progListEl.children[2].classList.contains('prog-insert-before'), 'Middle drop-on does not show insert-before gap');
            assertEqual(progListEl.children[2].getAttribute('data-drop-tip'), 'Drop to copy patch onto #03 "P3"', 'Middle drop-on shows copy drop tip');
            await progListEl.children[2].ondrop({
                preventDefault: () => {},
                stopPropagation: () => {},
                altKey: false,
                shiftKey: false,
                clientY: row2CenterY,
                dataTransfer: { getData: (k) => copyDropStore[k] || '' }
            });
            assertEqual(dndApp.librarian.banks[0].programs.map(p => p.name).join(','), 'P2,P4,P2', 'Drop-on copies P2 onto slot #03 without removing #01');

            // Undo & Redo copy/paste drop-on
            dndApp.undo();
            assertEqual(dndApp.librarian.banks[0].programs.map(p => p.name).join(','), 'P2,P4,P3', 'Undo restores original patch before copy/paste');
            dndApp.redo();
            assertEqual(dndApp.librarian.banks[0].programs.map(p => p.name).join(','), 'P2,P4,P2', 'Redo reapplies copy/paste');

            // Restore P3 at index 2 for remaining tests
            const restoreP3 = new MM2Program();
            restoreP3.name = 'P3';
            dndApp.librarian.banks[0].setProgram(2, restoreP3);
            dndApp.renderLibrarianBank();

            // Dragging onto same location (own middle or adjacent top edge of row 1) is disallowed/ignored
            progListEl.children.forEach((rEl, rIdx) => {
                rEl.getBoundingClientRect = () => ({ top: rIdx * 40, bottom: (rIdx + 1) * 40, height: 40 });
            });
            const sameStore = {};
            const sameDT = { effectAllowed: '', setData: (k, v) => { sameStore[k] = v; } };
            progListEl.children[0].ondragstart({ dataTransfer: sameDT });
            const sameOverDT = { dropEffect: '' };
            progListEl.children[0].ondragover({
                preventDefault: () => {},
                stopPropagation: () => {},
                clientY: 20, // own middle
                dataTransfer: sameOverDT
            });
            assertEqual(sameOverDT.dropEffect, 'none', 'Drop-on own row sets dropEffect to none');
            assert(!progListEl.children[0].classList.contains('slot-drop-hover'), 'Drop-on own row does not highlight');
            progListEl.children[1].ondragover({
                preventDefault: () => {},
                stopPropagation: () => {},
                clientY: 42, // top edge of row 1 (resolves to same index 0)
                dataTransfer: sameOverDT
            });
            assertEqual(sameOverDT.dropEffect, 'none', 'Insert before adjacent next row (same slot 0) sets dropEffect to none');
            assert(!progListEl.children[1].classList.contains('prog-insert-before'), 'Insert before adjacent next row does not show + gap');
            const undoLenBeforeSame = dndApp.undoStack.length;
            await progListEl.children[0].ondrop({
                preventDefault: () => {},
                stopPropagation: () => {},
                clientY: 20,
                dataTransfer: { getData: (k) => sameStore[k] || '' }
            });
            assertEqual(dndApp.undoStack.length, undoLenBeforeSame, 'Dropping on same location does not record undo entry');

            // Dragging patch into vertical space below end of bank moves it to last slot
            const appMainEl = document.createElement('main');
            dndApp.currentView = 'librarian';
            dndApp.wireMemoryAndPartDragDrop({ memButtons: [], partButtons: [], appMain: appMainEl, editorGrid: null, clearButton: null });
            progListEl.getBoundingClientRect = () => ({ top: 0, bottom: 120 });

            const belowStore = {};
            progListEl.children[0].ondragstart({ dataTransfer: { effectAllowed: '', setData: (k, v) => { belowStore[k] = v; } } });
            await appMainEl.dispatchEvent({
                type: 'dragover',
                clientY: 200,
                preventDefault: () => {},
                stopPropagation: () => {},
                dataTransfer: { dropEffect: '' }
            });
            assert(progListEl.children[2].classList.contains('prog-insert-after'), 'Hovering below bank highlights last row with prog-insert-after (+)');
            assertEqual(appMainEl.getAttribute('data-drop-tip'), 'Drop to move patch to #03', 'Hovering below bank shows move-to-last-slot drop tip');
            await appMainEl.dispatchEvent({
                type: 'drop',
                clientY: 200,
                preventDefault: () => {},
                stopPropagation: () => {},
                dataTransfer: { getData: (k) => belowStore[k] || '' }
            });
            assertEqual(dndApp.librarian.banks[0].programs.map(p => p.name).join(','), 'P4,P3,P2', 'Dropping below bank moves patch to last slot');
            dndApp.undo();
            assertEqual(dndApp.librarian.banks[0].programs.map(p => p.name).join(','), 'P2,P4,P3', 'Undo restores patch order after below-bank drop');

            // Multi-select patches (P2, P4) and drag onto BankTwo tab
            progListEl.children[0].querySelector('.prog-select-cb').onclick({ stopPropagation: () => {}, shiftKey: false });
            progListEl.children[1].querySelector('.prog-select-cb').onclick({ stopPropagation: () => {}, shiftKey: false });
            const groupBankStore = {};
            progListEl.children[0].ondragstart({
                dataTransfer: {
                    effectAllowed: '',
                    setData: (k, v) => { groupBankStore[k] = v; }
                }
            });
            const bank2TabAfter = bankTabsEl.children[1];
            bank2TabAfter.ondragover({
                preventDefault: () => {},
                dataTransfer: { dropEffect: '' }
            });
            assertEqual(bank2TabAfter.getAttribute('data-drop-tip'), 'Drop to move 2 patches to "BankTwo"', 'Target bank tab shows multi-patch drop tip');
            bank2TabAfter.ondrop({
                preventDefault: () => {},
                dataTransfer: { getData: (k) => groupBankStore[k] || '' }
            });
            assertEqual(dndApp.librarian.banks[0].programs.map(p => p.name).join(','), 'P3', 'Source bank retains only unselected patch');
            assertEqual(dndApp.librarian.banks[1].programs.map(p => p.name).join(','), 'B2_01,P1,P2,P4', 'Target bank appends multi-select group to end');

            // Drag BankOne tab onto New Bank button to duplicate with "(copy <N>)" and increment N on collision
            const btnAddBank = document.createElement('button');
            btnAddBank.id = 'btn-add-bank';
            document.registerMockElement('btn-add-bank', btnAddBank);
            dndApp.buildLibrarianUI();

            const dupBankStore1 = {};
            bankTabsEl.children[0].ondragstart({
                dataTransfer: {
                    effectAllowed: '',
                    setData: (k, v) => { dupBankStore1[k] = v; }
                }
            });
            btnAddBank.ondragover({
                preventDefault: () => {},
                dataTransfer: { dropEffect: '' }
            });
            assert(btnAddBank.classList.contains('slot-drop-hover'), 'New Bank button highlights on bank dragover');
            assertEqual(btnAddBank.getAttribute('data-drop-tip'), 'Drop to duplicate "BankOne"', 'New Bank button shows duplicate drop tip');
            btnAddBank.ondrop({
                preventDefault: () => {},
                dataTransfer: { getData: (k) => dupBankStore1[k] || '' }
            });
            assertEqual(btnAddBank.getAttribute('data-drop-tip') || '', '', 'New Bank button clears drop tip after drop');
            assertEqual(dndApp.librarian.banks.length, 3, 'Dropping bank onto New Bank creates a duplicated bank');
            assertEqual(dndApp.librarian.banks[2].name, 'BankOne (copy 1)', 'First duplicate uses "(copy 1)" suffix');
            assertEqual(dndApp.librarian.banks[2].programs.map(p => p.name).join(','), 'P3', 'Duplicated bank clones source programs');
            const dupTabTitle = bankTabsEl.children[2] ? bankTabsEl.children[2].querySelector('.bank-tab-title') : null;
            assert(dupTabTitle && dupTabTitle.children && dupTabTitle.children[0] && dupTabTitle.children[0].className === 'bank-tab-title-input', 'Duplicated bank automatically enters inline rename mode');

            // Duplicate "BankOne (copy 1)" directly via .bank-tabs-bar -> strips "(copy 1)" and increments to "(copy 2)"
            const bankTabsBarEl = document.createElement('div');
            bankTabsBarEl.className = 'bank-tabs-bar';
            const prevQS = document.querySelector;
            document.querySelector = (sel) => (sel === '.bank-tabs-bar' ? bankTabsBarEl : prevQS.call(document, sel));
            try {
                dndApp.buildLibrarianUI();
                const dupBankStore2 = {};
                bankTabsEl.children[2].ondragstart({
                    dataTransfer: {
                        effectAllowed: '',
                        setData: (k, v) => { dupBankStore2[k] = v; }
                    }
                });
                bankTabsBarEl.ondragover({
                    preventDefault: () => {},
                    dataTransfer: { dropEffect: '' }
                });
                assert(btnAddBank.classList.contains('slot-drop-hover'), 'New Bank button highlights when dragging over .bank-tabs-bar');
                assertEqual(btnAddBank.getAttribute('data-drop-tip'), 'Drop to duplicate "BankOne (copy 1)"', '.bank-tabs-bar shows duplicate drop tip');
                bankTabsBarEl.ondrop({
                    preventDefault: () => {},
                    dataTransfer: { getData: (k) => dupBankStore2[k] || '' }
                });
                assertEqual(dndApp.librarian.banks.length, 4, 'Dropping onto .bank-tabs-bar creates duplicated bank');
                assertEqual(dndApp.librarian.banks[3].name, 'BankOne (copy 2)', 'Duplicating "(copy 1)" produces "(copy 2)" instead of "(copy 1) (copy 1)"');

                // Dropping a bank tab into #bank-tabs gap between tabs inserts/reorders instead of duplicating
                bankTabsEl.children.forEach((tabEl, tIdx) => {
                    tabEl.getBoundingClientRect = () => ({ left: tIdx * 100, width: 90 });
                });
                const gapStore = {};
                bankTabsEl.children[0].ondragstart({
                    dataTransfer: {
                        effectAllowed: '',
                        setData: (k, v) => { gapStore[k] = v; }
                    }
                });
                // Drop at clientX = 195 (between tab 1 [100..190] and tab 2 [200..290])
                bankTabsEl.ondragover({
                    preventDefault: () => {},
                    stopPropagation: () => {},
                    clientX: 195,
                    dataTransfer: { dropEffect: '' }
                });
                assert(!btnAddBank.classList.contains('slot-drop-hover'), 'Between-tab dragover does not highlight New Bank button');
                assert(bankTabsEl.children[2].classList.contains('bank-insert-before'), 'Between-tab dragover marks next bank tab with bank-insert-before (+) space');
                bankTabsEl.ondrop({
                    preventDefault: () => {},
                    stopPropagation: () => {},
                    clientX: 195,
                    dataTransfer: { getData: (k) => gapStore[k] || '' }
                });
                assert(!bankTabsEl.children[2].classList.contains('bank-insert-before'), 'Between-tab drop clears bank-insert-before marker');
                assertEqual(dndApp.librarian.banks.length, 4, 'Between-tab drop does not duplicate bank');
                assertEqual(dndApp.librarian.banks.map(b => b.name).join(','), 'BankTwo,BankOne,BankOne (copy 1),BankOne (copy 2)', 'Between-tab drop inserts BankOne between BankTwo and BankOne (copy 1)');
            } finally {
                document.querySelector = prevQS;
                document.registerMockElement('btn-add-bank', null);
            }
        } finally {
            document.createElement = prevCreateEl;
            document.registerMockElement('bank-tabs', null);
            document.registerMockElement('librarian-prog-list', null);
        }
    });

    await runSection('\n--- [67] Librarian & Duplicate Modal HTML Escaping Tests ---', async () => {
        const app = new App();
        const xssBankName = 'Bank "<img src=x onerror=1>&';
        const xssProgName = '<sc>"&';
        const bank1 = new MM2Bank(xssBankName, 0);
        const bank2 = new MM2Bank('Safe Bank', 1);
        const p1 = new MM2Program();
        p1.name = xssProgName;
        const p2 = p1.clone();
        bank1.addProgram(p1);
        bank1.addProgram(p2);
        app.librarian.banks = [bank1, bank2];
        app.librarian.activeBankIndex = 0;

        const bankTabsEl = { innerHTML: '', children: [], appendChild(c) { this.children.push(c); } };
        const progListEl = { innerHTML: '', children: [], appendChild(c) { this.children.push(c); } };
        const modalEl = { classList: new Set(), addCalled: false };
        modalEl.classList = {
            add: (c) => { if (c === 'open') modalEl.addCalled = true; },
            remove: () => {}
        };
        const modalBodyEl = {
            innerHTML: '',
            children: [],
            appendChild(c) { this.children.push(c); },
            querySelector: () => ({ onclick: null })
        };

        document.registerMockElement('bank-tabs', bankTabsEl);
        document.registerMockElement('librarian-prog-list', progListEl);
        document.registerMockElement('duplicate-modal', modalEl);
        document.registerMockElement('duplicate-modal-body', modalBodyEl);

        const prevCreateEl = document.createElement;
        document.createElement = () => ({
            className: '',
            dataset: {},
            style: {},
            innerHTML: '',
            children: [],
            setAttribute: () => {},
            appendChild(c) { this.children.push(c); },
            querySelector: () => ({})
        });

        try {
            app.renderLibrarianBank();
            const tabHtml = bankTabsEl.children[0].innerHTML;
            assert(!tabHtml.includes('<img'), 'Bank tab escapes <img in bank name');
            assert(tabHtml.includes('&lt;img'), 'Bank tab encodes < as &lt;');
            assert(tabHtml.includes('&quot;'), 'Bank tab encodes " as &quot;');
            assert(tabHtml.includes('&amp;'), 'Bank tab encodes & as &amp;');

            const rowHtml = progListEl.children[0].innerHTML;
            assert(!rowHtml.includes('<sc>'), 'Program row escapes <sc> in program name');
            assert(rowHtml.includes('&lt;sc&gt;&quot;&amp;'), 'Program row encodes <sc>"& safely');

            // Test duplicate modal with duplicates present
            app.showDuplicateModal();
            const dupGroupCard = modalBodyEl.children[1];
            const dupList = dupGroupCard.children[0];
            const dupItemHtml = dupList.children[0].innerHTML;
            assert(!dupItemHtml.includes('<sc>'), 'Duplicate modal item escapes <sc> in program name');
            assert(dupItemHtml.includes('&lt;sc&gt;&quot;&amp;'), 'Duplicate modal item encodes <sc>"& safely');

            // Test duplicate modal with clean bank (0 duplicates)
            app.librarian.activeBankIndex = 1;
            bank2.name = xssBankName;
            app.showDuplicateModal();
            assert(!modalBodyEl.innerHTML.includes('<img'), 'Empty duplicate modal escapes <img in bank name');
            assert(modalBodyEl.innerHTML.includes('&lt;img'), 'Empty duplicate modal encodes < as &lt;');
        } finally {
            document.createElement = prevCreateEl;
            document.registerMockElement('bank-tabs', null);
            document.registerMockElement('librarian-prog-list', null);
            document.registerMockElement('duplicate-modal', null);
            document.registerMockElement('duplicate-modal-body', null);
        }
    });

});
