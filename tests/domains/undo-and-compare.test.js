/**
 * Domain Tests: Undo/Redo & Compare Buffer
 */
MM2TestRunner.register('Undo/Redo & Compare Buffer', async ({ assert, assertEqual, logger, runSection }) => {
    await runSection('\n--- [11] Live Editing Undo/Redo & Compare Buffer Tests ---', async () => {
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

        // Live Sync disables Compare
        const mockBtnCompare = { disabled: false, title: '', textContent: 'Compare: Off', classList: { add() {}, remove() {} } };
        document.registerMockElement('btn-prog-compare', mockBtnCompare);
        app.midi.inPort = { id: 'in-1', name: 'MicroMonsta 2' };
        app.midi.outPort = { id: 'out-1', name: 'MicroMonsta 2', send: () => { } };
        app.midi.hardwareResponsive = true;

        // Entering Live Sync while comparing exits Compare and disables button
        app.toggleCompare(true);
        assertEqual(app.isComparing, true, 'Compare mode entered before Live Sync');
        app.midi.liveSync = true;
        app.updateLiveSyncUI();
        assertEqual(app.isComparing, false, 'Enabling Live Sync exits Compare mode');
        assertEqual(mockBtnCompare.disabled, true, 'Compare button is disabled in Live Sync mode');

        // toggleCompare(true) is a no-op while Live Sync is active
        app.toggleCompare(true);
        assertEqual(app.isComparing, false, 'toggleCompare(true) is ignored while Live Sync is active');

        // Disabling Live Sync re-enables Compare button
        app.midi.liveSync = false;
        app.updateLiveSyncUI();
        assertEqual(mockBtnCompare.disabled, false, 'Compare button is re-enabled when Live Sync is disabled');
        document.registerMockElement('btn-prog-compare', null);
    });

    await runSection('\n--- [20] Undo/Redo & Levels of Undo Setting Tests ---', async () => {
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
        canvas.dispatchEvent({ type: 'pointerdown', clientX: 100, clientY: 100, preventDefault: () => { } });
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

        canvas.dispatchEvent({ type: 'pointerdown', clientX: 100, clientY: 100, preventDefault: () => { } });
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
        undoApp.setTimbralMode('bitimbral');
        undoApp.selectPart(1); // Part B
        undoApp.activeTimbre.setValue('FILTER_FREQ', 100);
        undoApp.onParameterChanged('FILTER_FREQ', 40, { isFinal: true, prevVal: 100 });
        assertEqual(undoApp.undoStack[0].slot, 1, 'Undo action recorded for slot 1 (Part B)');

        undoApp.selectPart(0); // Switch to Part A
        assertEqual(undoApp.activeSlot, 0, 'Switched to Part A');

        undoApp.undo();
        assertEqual(undoApp.activeSlot, 1, 'undo() automatically switched activeSlot back to Part B');
        assertEqual(undoApp.activeTimbre.getValue('FILTER_FREQ'), 100, 'Part B FILTER_FREQ restored to 100');
    });

    await runSection('\n--- [52] Fetch Patch Rewrite Atomic Undo/Redo Tests ---', async () => {
        const fetchUndoApp = new App();
        fetchUndoApp.midi.saveSettings = () => { };
        let sendProgramCalls = 0;
        fetchUndoApp.midi.sendProgram = () => { sendProgramCalls++; };
        fetchUndoApp.midi.sendParameter = () => { };
        fetchUndoApp.midi.inPort = { id: 'in-1', name: 'MicroMonsta 2' };
        fetchUndoApp.midi.outPort = { id: 'out-1', name: 'MicroMonsta 2', send: () => { } };
        fetchUndoApp.midi.hardwareResponsive = true;
        fetchUndoApp.midi.liveSync = true;

        // 1. Make a local edit before Fetch
        const defaultFilterFreq = fetchUndoApp.timbreA.getValue('FILTER_FREQ');
        fetchUndoApp.onParameterChanged('OSC1_SHAPE', 42, { isFinal: true, prevVal: 0 });
        fetchUndoApp.timbreA.name = 'MY_PATCH';
        assertEqual(fetchUndoApp.undoStack.length, 1, 'Prior parameter edit recorded on undoStack');

        // 2. Simulate Fetch (program-received) for Part A
        const fetchedA = new MM2Program();
        fetchedA.name = 'HW_PATCH';
        fetchedA.setValue('OSC1_SHAPE', 99);
        fetchedA.setValue('FILTER_FREQ', 180);
        fetchUndoApp.midi.emit('program-received', { program: fetchedA, slot: 0, isProbe: false });

        assertEqual(fetchUndoApp.timbreA.name, 'HW_PATCH', 'Fetch loads hardware patch name into Part A');
        assertEqual(fetchUndoApp.timbreA.getValue('OSC1_SHAPE'), 99, 'Fetch loads hardware OSC1_SHAPE');
        assertEqual(fetchUndoApp.timbreA.getValue('FILTER_FREQ'), 180, 'Fetch loads hardware FILTER_FREQ');
        assertEqual(sendProgramCalls, 0, 'Fetch does not echo received patch back to hardware even with liveSync on');
        assertEqual(fetchUndoApp.syncStatus, 'synced', 'Fetch updates syncStatus to synced when connected');
        assertEqual(fetchUndoApp.undoStack.length, 2, 'Fetch pushes atomic part-snapshot without clearing prior undo history');
        assertEqual(fetchUndoApp.undoStack[1].type, 'part-snapshot', 'Fetch undo entry is a part-snapshot');
        assertEqual(fetchUndoApp.undoStack[1].slot, 0, 'Fetch undo entry targets slot 0');

        // 3. Single Undo restores entire pre-Fetch Part A state
        fetchUndoApp.undo();
        assertEqual(fetchUndoApp.timbreA.name, 'MY_PATCH', 'Single Undo restores pre-Fetch patch name');
        assertEqual(fetchUndoApp.timbreA.getValue('OSC1_SHAPE'), 42, 'Single Undo restores pre-Fetch OSC1_SHAPE');
        assertEqual(fetchUndoApp.timbreA.getValue('FILTER_FREQ'), defaultFilterFreq, 'Single Undo restores pre-Fetch FILTER_FREQ');
        assertEqual(fetchUndoApp.undoStack.length, 1, 'Undo preserves prior edit on undoStack');

        // 4. Second Undo restores the earlier parameter edit
        fetchUndoApp.undo();
        assertEqual(fetchUndoApp.timbreA.getValue('OSC1_SHAPE'), 0, 'Second Undo restores edit made prior to Fetch');

        // 5. Redo reapplies prior edit and then Fetch patch
        fetchUndoApp.redo();
        assertEqual(fetchUndoApp.timbreA.getValue('OSC1_SHAPE'), 42, 'First Redo reapplies prior parameter edit');
        fetchUndoApp.redo();
        assertEqual(fetchUndoApp.timbreA.name, 'HW_PATCH', 'Second Redo reapplies fetched hardware patch name');
        assertEqual(fetchUndoApp.timbreA.getValue('OSC1_SHAPE'), 99, 'Second Redo reapplies fetched OSC1_SHAPE');
        assertEqual(fetchUndoApp.timbreA.getValue('FILTER_FREQ'), 180, 'Second Redo reapplies fetched FILTER_FREQ');

        // 6. Fetch on Part B while viewing Part A is also an atomic undoable step
        fetchUndoApp.setTimbralMode('bitimbral');
        fetchUndoApp.selectPart(0);
        fetchUndoApp.timbreB.name = 'ORIG_B';
        fetchUndoApp.timbreB.setValue('OSC1_SHAPE', 11);

        const fetchedB = new MM2Program();
        fetchedB.name = 'HW_PAT_B';
        fetchedB.setValue('OSC1_SHAPE', 77);
        fetchUndoApp.midi.emit('program-received', { program: fetchedB, slot: 1, isProbe: false });

        assertEqual(fetchUndoApp.timbreB.name, 'HW_PAT_B', 'Fetch loads Part B hardware patch');
        assertEqual(fetchUndoApp.timbreB.getValue('OSC1_SHAPE'), 77, 'Fetch loads Part B OSC1_SHAPE');

        fetchUndoApp.undo();
        assertEqual(fetchUndoApp.activeSlot, 1, 'Undo of Part B Fetch switches activeSlot to Part B');
        assertEqual(fetchUndoApp.timbreB.name, 'ORIG_B', 'Undo restores previous Part B patch name');
        assertEqual(fetchUndoApp.timbreB.getValue('OSC1_SHAPE'), 11, 'Undo restores previous Part B OSC1_SHAPE');
    });

    await runSection('\n--- [55] Init Button Atomic Undo/Redo Tests ---', async () => {
        const prevGetEl55 = document.getElementById;
        const prevConfirm55 = global.confirm;
        try {
            const btnInit = document.createElement('button');
            btnInit.id = 'btn-prog-init';
            document.getElementById = (id) => (id === 'btn-prog-init' ? btnInit : prevGetEl55(id));
            global.confirm = () => true;

            const initApp = new App();
            initApp.timbreA.name = 'CUSTOM';
            initApp.onParameterChanged('OSC1_SHAPE', 88, { isFinal: true });
            assertEqual(initApp.undoStack.length, 1, 'Prior edit recorded on undoStack before Init');

            initApp.setupProgramBar();
            btnInit.onclick();

            assertEqual(initApp.timbreA.name, 'INIT', 'Init resets patch name to INIT');
            assertEqual(initApp.timbreA.getValue('OSC1_SHAPE'), 0, 'Init resets OSC1_SHAPE to default 0');
            assertEqual(initApp.undoStack.length, 2, 'Init pushes part-snapshot without clearing prior undo history');
            assertEqual(initApp.undoStack[1].type, 'part-snapshot', 'Init undo entry is a part-snapshot');

            initApp.undo();
            assertEqual(initApp.timbreA.name, 'CUSTOM', 'Single Undo restores pre-Init patch name');
            assertEqual(initApp.timbreA.getValue('OSC1_SHAPE'), 88, 'Single Undo restores pre-Init OSC1_SHAPE');
            assertEqual(initApp.undoStack.length, 1, 'Prior edit remains on undoStack after undoing Init');

            initApp.undo();
            assertEqual(initApp.timbreA.getValue('OSC1_SHAPE'), 0, 'Second Undo restores pre-edit OSC1_SHAPE');

            initApp.redo();
            assertEqual(initApp.timbreA.getValue('OSC1_SHAPE'), 88, 'First Redo reapplies prior edit');

            initApp.redo();
            assertEqual(initApp.timbreA.name, 'INIT', 'Second Redo reapplies Init patch name');
            assertEqual(initApp.timbreA.getValue('OSC1_SHAPE'), 0, 'Second Redo reapplies Init OSC1_SHAPE');
        } catch (e) {
            logger(`  Error: ${e.message}`);
            failed++;
        } finally {
            document.getElementById = prevGetEl55;
            global.confirm = prevConfirm55;
        }

        // Section 56: LFO & Mod Matrix Inline Action Cleanup Tests
    });

    await runSection('\n--- [60] Push Preserves Undo/Redo Buffer Tests ---', async () => {
        const pushUndoApp = new App();
        pushUndoApp.midi.outPort = { name: 'Mock MM2 Out', send() { } };
        pushUndoApp.midi.inPort = { name: 'Mock MM2 In' };
        pushUndoApp.midi.markHardwareResponsive(true);

        pushUndoApp.onParameterChanged('OSC1_SHAPE', 42, { isFinal: true });
        pushUndoApp.onParameterChanged('FILTER_FREQ', 180, { isFinal: true });
        pushUndoApp.undo();
        assertEqual(pushUndoApp.undoStack.length, 1, 'undoStack has 1 entry before Push');
        assertEqual(pushUndoApp.redoStack.length, 1, 'redoStack has 1 entry before Push');

        const ok = pushUndoApp._sendActiveProgramToHardware();
        assertEqual(ok, true, 'Push to hardware succeeds');
        assertEqual(pushUndoApp.undoStack.length, 1, 'Push preserves undoStack');
        assertEqual(pushUndoApp.redoStack.length, 1, 'Push preserves redoStack');

        pushUndoApp.redo();
        assertEqual(pushUndoApp.activeTimbre.getValue('FILTER_FREQ'), 180, 'Redo works after Push');
        pushUndoApp.undo();
        pushUndoApp.undo();
        assertEqual(pushUndoApp.activeTimbre.getValue('OSC1_SHAPE'), 0, 'Undo works after Push');
    });

});
