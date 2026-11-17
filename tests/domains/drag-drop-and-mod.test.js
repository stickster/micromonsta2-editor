/**
 * Domain Tests: Section Drag-and-Drop, Copy/Paste & Mod Matrix
 */
MM2TestRunner.register('Section Drag-and-Drop, Copy/Paste & Mod Matrix', async ({ assert, assertEqual, logger, runSection }) => {
    await runSection('\n--- [10] Section Drag-and-Drop, Copy, Paste & Smart Randomize Tests ---', async () => {
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
    });

    await runSection('\n--- [38] Section Copy & Drag-and-Drop Regression Tests ---', async () => {
        // 1. copySection('mult', 1, 'mult', 2, ...) copies MULT_A1/MULT_B1 -> MULT_A2/MULT_B2 1:1
        const multProg = new MM2Program();
        multProg.setValue('MULT_A1', 12);
        multProg.setValue('MULT_B1', 27);
        multProg.setValue('MULT_A2', 3);
        multProg.setValue('MULT_B2', 5);
        const multCopied = copySection('mult', 1, 'mult', 2, multProg, () => { });
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

        copySection('env', 1, 'env', 2, envProg, () => { });
        assertEqual(envProg.getValue('ENV2_ATK'), 15, 'Env 1->2 copies ATK');
        assertEqual(envProg.getValue('ENV2_RESET'), 1, 'Env 1->2 copies RESET');
        assertEqual(envProg.getValue('ENV2_FLT_VEL_SENS'), 91, 'Env 1->2 copies velocity sensitivity');

        copySection('env', 1, 'env', 3, envProg, () => { });
        assertEqual(envProg.getValue('ENV3_ATK'), 15, 'Env 1->3 copies ATK');
        assertEqual(envProg.getValue('ENV3_DCY'), 42, 'Env 1->3 copies DCY');
        assertEqual(envProg.getValue('ENV3_SUS'), 88, 'Env 1->3 copies SUS');
        assertEqual(envProg.getValue('ENV3_REL'), 63, 'Env 1->3 copies REL');
        assertEqual(envProg.getValue('ENV3_RESET'), 1, 'Env 1->3 copies RESET');

        envProg.setValue('ENV3_ATK', 5);
        copySection('env', 3, 'env', 1, envProg, () => { });
        assertEqual(envProg.getValue('ENV1_ATK'), 5, 'Env 3->1 copies ATK');
        assertEqual(envProg.getValue('ENV1_VCA_VEL_SENS'), 91, 'Env 3->1 leaves ENV1_VCA_VEL_SENS untouched');

        // 3. DOM Drag-and-Drop Simulation Tests
        const dndApp = new App();
        dndApp.showNotification = () => { };
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
        const oscCard = dndApp.createOscillatorPanel(() => dndProg, () => { });
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
        const envCard = dndApp.createEnvelopePanel(() => dndProg, () => { });
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
                dndApp.wireSectionDropTarget(box, type, idx, () => dndProg, () => { }, { hoverClass: 'slot-drop-hover' });
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
        const seqEl = createArpSequencer(() => seqProg, () => { });
        const stepCols = seqEl.querySelectorAll('.step-col');
        assertEqual(stepCols.length, 16, 'Sequencer renders 16 step-col elements');
        assert(stepCols.every(c => c.attributes.get('draggable') === 'true'), 'All step-col elements have draggable="true"');

        const toolsDiv = seqEl.querySelector('.sequencer-tools');
        const copyLabel = seqEl.querySelector('#seq-copy-label');
        const copyAllBtn = seqEl.querySelector('#seq-copy-all-btn');
        const copyNoteBtn = seqEl.querySelector('#seq-copy-note-btn');
        const copyModBtn = seqEl.querySelector('#seq-copy-mod-btn');
        const noteTools = seqEl.querySelector('#seq-note-tools');
        assert(copyLabel !== null && copyLabel.textContent === 'Copy', 'Sequencer renders #seq-copy-label with text "Copy"');
        assert(!copyLabel.classList.contains('is-visible'), 'Copy label is hidden when not dragging');
        assert(copyAllBtn !== null, 'Sequencer renders #seq-copy-all-btn');
        assert(copyNoteBtn !== null, 'Sequencer renders #seq-copy-note-btn');
        assert(copyModBtn !== null, 'Sequencer renders #seq-copy-mod-btn');
        assertEqual(copyAllBtn.textContent, 'All', 'All drop target button has exact label "All"');
        assertEqual(copyNoteBtn.textContent, 'Note', 'Note drop target button has exact label "Note"');
        assertEqual(copyModBtn.textContent, 'Mod', 'Mod drop target button has exact label "Mod"');
        assertEqual(toolsDiv.children[0], copyLabel, 'Copy label appears at the left of copy drop targets');
        assertEqual(toolsDiv.children[1], copyAllBtn, 'All drop target follows Copy label');
        assert(toolsDiv.children.indexOf(noteTools) > toolsDiv.children.indexOf(copyAllBtn), 'Note tools appear to the right of copy drop targets');
        assert(!copyAllBtn.classList.contains('is-visible'), 'All drop target button is hidden when not dragging');

        // 1-to-1 mode: Step 1 -> Step 3
        seqProg.setValue('ARP_PTN_STEP01', 6); // 3rd
        seqProg.setValue('ARP_PTN_STEP_MOD01', 2); // High
        seqProg.setValue('ARP_PTN_STEP03', 1); // Off
        seqProg.setValue('ARP_PTN_STEP_MOD03', 0); // Low
        const stepStore = {};
        stepCols[0].dispatchEvent(makeDragEvent('dragstart', { _store: stepStore }));
        assert(copyLabel.classList.contains('is-visible'), 'Copy label becomes visible on step-col dragstart');
        assert(copyAllBtn.classList.contains('is-visible'), 'Copy All button becomes visible on step-col dragstart');
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

        // Copy Note only & Copy Mod only drop targets
        seqProg.setValue('ARP_PTN_STEP01', 4);     // 1st
        seqProg.setValue('ARP_PTN_STEP_MOD01', 0); // Low
        seqProg.setValue('ARP_PTN_STEP05', 1);     // Off
        seqProg.setValue('ARP_PTN_STEP_MOD05', 2); // High
        const noteOnlyStore = {};
        stepCols[0].dispatchEvent(makeDragEvent('dragstart', { _store: noteOnlyStore }));
        assert(copyNoteBtn.classList.contains('is-visible') && copyModBtn.classList.contains('is-visible'), 'Copy Note and Copy Mod become visible on dragstart');
        copyNoteBtn.dispatchEvent(makeDragEvent('drop', { _store: noteOnlyStore }));
        assert(!copyNoteBtn.classList.contains('is-visible'), 'Copy Note hides after drop');
        assertEqual(seqProg.getValue('ARP_PTN_STEP05'), 4, 'Copy Note copies step 1 Note to step 5');
        assertEqual(seqProg.getValue('ARP_PTN_STEP_MOD05'), 2, 'Copy Note preserves step 5 Mod level');

        const modOnlyStore = {};
        stepCols[0].dispatchEvent(makeDragEvent('dragstart', { _store: modOnlyStore }));
        copyModBtn.dispatchEvent(makeDragEvent('drop', { _store: modOnlyStore }));
        assert(!copyModBtn.classList.contains('is-visible'), 'Copy Mod hides after drop');
        assertEqual(seqProg.getValue('ARP_PTN_STEP_MOD05'), 0, 'Copy Mod copies step 1 Mod level to step 5');
        assertEqual(seqProg.getValue('ARP_PTN_STEP05'), 4, 'Copy Mod preserves step 5 Note mode');
    });

    await runSection('\n--- [39] Multi-Memory & Part Drag-and-Drop Tests ---', async () => {
        const memApp = new App();
        memApp.showNotification = () => { };
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

        // Clear all memories button resets M1-M4 and disables when empty
        const clearBtn = document.createElement('button');
        clearBtn.id = 'btn-mem-clear';
        document.registerMockElement('btn-mem-clear', clearBtn);
        memApp.wireMemoryAndPartDragDrop({
            memButtons,
            partButtons: [partA, partB],
            appMain,
            editorGrid,
            clearButton: clearBtn
        });
        memApp.updateMemoryUI();
        assertEqual(clearBtn.disabled, false, 'Memory Clear button is enabled when memories are populated');

        // Dragging a Part in Init state to a populated memory clears that memory
        memApp.timbreA.name = 'POP_PAT';
        memApp.timbreA.setValue('OSC1_SHAPE', 77);
        const popStore = {};
        partA.dispatchEvent(makeEvent('dragstart', { _store: popStore }));
        memButtons[0].dispatchEvent(makeEvent('drop', { _store: popStore }));
        assert(memApp.memories[0] !== null, 'M1 is populated before Init drag');

        memApp.timbreA = new MM2Program(); // Init state
        const initDropStore = {};
        partA.dispatchEvent(makeEvent('dragstart', { _store: initDropStore }));
        memButtons[0].dispatchEvent(makeEvent('drop', { _store: initDropStore }));
        assertEqual(memApp.memories[0], null, 'Dragging Init patch to M1 clears M1');

        clearBtn.click();
        assert(memApp.memories.every(m => m === null), 'Clicking Clear resets all M1-M4 memories to null');
        assertEqual(clearBtn.disabled, true, 'Memory Clear button disables after clearing all memories');
        document.registerMockElement('btn-mem-clear', null);

        // View-aware Memory drop behavior: Editor vs Librarian vs Settings
        const viewAppMain = document.createElement('main');
        memApp.wireMemoryAndPartDragDrop({
            memButtons: [],
            partButtons: [],
            appMain: viewAppMain,
            editorGrid: null,
            clearButton: null
        });
        const m1Patch = new MM2Program();
        m1Patch.name = 'LIB_MEM1';
        m1Patch.setValue('OSC1_SHAPE', 91);
        memApp.memories[0] = m1Patch;
        memApp.timbreA.name = 'KEEP_ED';
        memApp.timbreA.setValue('OSC1_SHAPE', 12);
        memApp.selectPart(0);

        // Settings mode: appMain rejects Memory drop
        memApp.currentView = 'settings';
        const settingsStore = {};
        memButtons[0].dispatchEvent(makeEvent('dragstart', { _store: settingsStore }));
        viewAppMain.dispatchEvent(makeEvent('dragover', { _store: settingsStore }));
        assert(!viewAppMain.classList.contains('slot-drop-hover'), 'Settings mode: appMain does not highlight on Memory dragover');
        await viewAppMain.dispatchEvent(makeEvent('drop', { _store: settingsStore }));
        assertEqual(memApp.timbreA.name, 'KEEP_ED', 'Settings mode: appMain drop does not replace active part');

        // Librarian mode: appMain drop adds Memory to current bank without modifying Editor part
        const libBank = new MM2Bank('TestBank');
        const existingProg = new MM2Program();
        existingProg.name = 'EXIST_01';
        existingProg.setValue('OSC1_SHAPE', 22);
        libBank.addProgram(existingProg);
        memApp.librarian = {
            banks: [libBank],
            activeBankIndex: 0,
            get activeBank() { return this.banks[this.activeBankIndex]; },
            saveAllBanks: async () => {}
        };
        const prevCreateEl = document.createElement;
        document.createElement = (tag) => {
            const el = prevCreateEl.call(document, tag);
            const origQS = el.querySelector ? el.querySelector.bind(el) : () => null;
            el.querySelector = (sel) => origQS(sel) || { onclick: null };
            return el;
        };
        try {
            const bankTabsEl = document.createElement('div');
            bankTabsEl.id = 'bank-tabs';
            document.registerMockElement('bank-tabs', bankTabsEl);
            const progListEl = document.createElement('div');
            progListEl.id = 'librarian-prog-list';
            document.registerMockElement('librarian-prog-list', progListEl);
            memApp.currentView = 'librarian';

            const libAppStore = {};
            memButtons[0].dispatchEvent(makeEvent('dragstart', { _store: libAppStore }));
            viewAppMain.dispatchEvent(makeEvent('dragover', { _store: libAppStore }));
            assert(viewAppMain.classList.contains('slot-drop-hover'), 'Librarian mode: appMain highlights on Memory dragover');
            assertEqual(viewAppMain.getAttribute('data-drop-tip'), 'Drop to add Memory M1 to "TestBank"', 'Librarian mode: appMain shows drop tip on Memory dragover');
            await viewAppMain.dispatchEvent(makeEvent('drop', { _store: libAppStore }));
            assertEqual(viewAppMain.getAttribute('data-drop-tip') || '', '', 'Librarian mode: appMain clears drop tip after drop');
            assertEqual(memApp.timbreA.name, 'KEEP_ED', 'Librarian mode: appMain drop does not overwrite Editor active part');
            assertEqual(libBank.length, 2, 'Librarian mode: appMain drop adds Memory patch to active bank');
            assertEqual(libBank.getProgram(1).name, 'LIB_MEM1', 'Librarian mode: added bank patch matches Memory name');
            assertEqual(libBank.getProgram(1).getValue('OSC1_SHAPE'), 91, 'Librarian mode: added bank patch matches Memory parameters');

            // Librarian mode: drop onto individual bank program row warns via _confirmDialog
            memApp.renderLibrarianBank();
            const firstRow = progListEl.children[0];
            assert(!!firstRow, 'Librarian mode: rendered program row exists');

            let confirmCalls = 0;
            let nextConfirmResult = false;
            memApp._confirmDialog = async (opts) => {
                confirmCalls++;
                assert(opts && typeof opts.description === 'string' && opts.description.includes('EXIST_01'), 'Librarian row drop warning names target bank patch');
                return nextConfirmResult;
            };

            // Cancel in dialog -> does not replace
            const rowCancelStore = {};
            memButtons[0].dispatchEvent(makeEvent('dragstart', { _store: rowCancelStore }));
            firstRow.ondragover(makeEvent('dragover', { _store: rowCancelStore }));
            assert(firstRow.classList.contains('slot-drop-hover'), 'Librarian row highlights on Memory dragover');
            assertEqual(firstRow.getAttribute('data-drop-tip'), 'Drop to replace #01 "EXIST_01" with Memory M1', 'Librarian row shows replace drop tip on Memory dragover');
            await firstRow.ondrop(makeEvent('drop', { _store: rowCancelStore }));
            assertEqual(firstRow.getAttribute('data-drop-tip') || '', '', 'Librarian row clears drop tip after drop');
            assertEqual(confirmCalls, 1, 'Librarian row drop prompts _confirmDialog before replacing');
            assertEqual(libBank.getProgram(0).name, 'EXIST_01', 'Canceling confirmation keeps original bank patch');

            // Confirm in dialog -> replaces bank program
            nextConfirmResult = true;
            const rowConfirmStore = {};
            memButtons[0].dispatchEvent(makeEvent('dragstart', { _store: rowConfirmStore }));
            await firstRow.ondrop(makeEvent('drop', { _store: rowConfirmStore }));
            assertEqual(confirmCalls, 2, 'Confirmed librarian row drop prompts _confirmDialog');
            assertEqual(libBank.getProgram(0).name, 'LIB_MEM1', 'Confirmed librarian row drop replaces target bank patch name');
            assertEqual(libBank.getProgram(0).getValue('OSC1_SHAPE'), 91, 'Confirmed librarian row drop replaces target bank patch parameters');

            // Editor mode: appMain drop replaces active part
            memApp.currentView = 'editor';
            const editorDropStore = {};
            memButtons[0].dispatchEvent(makeEvent('dragstart', { _store: editorDropStore }));
            viewAppMain.dispatchEvent(makeEvent('dragover', { _store: editorDropStore }));
            assertEqual(viewAppMain.getAttribute('data-drop-tip'), 'Drop to load Memory M1 into Part A', 'Editor mode: appMain shows load drop tip on Memory dragover');
            await viewAppMain.dispatchEvent(makeEvent('drop', { _store: editorDropStore }));
            assertEqual(viewAppMain.getAttribute('data-drop-tip') || '', '', 'Editor mode: appMain clears drop tip after drop');
            assertEqual(memApp.timbreA.name, 'LIB_MEM1', 'Editor mode: appMain drop replaces active part name');
            assertEqual(memApp.timbreA.getValue('OSC1_SHAPE'), 91, 'Editor mode: appMain drop replaces active part parameters');
        } finally {
            document.createElement = prevCreateEl;
            document.registerMockElement('bank-tabs', null);
            document.registerMockElement('librarian-prog-list', null);
        }
    });

    await runSection('\n--- [54] Mod Matrix Source & Destination Drag/Drop Tests ---', async () => {
        const prevGetEl54 = document.getElementById;
        try {
            const modGrid = document.createElement('div');
            modGrid.id = 'editor-grid';
            document.getElementById = (id) => (id === 'editor-grid' ? modGrid : prevGetEl54(id));

            const mtxApp = new App();
            mtxApp.activeTimbre.setValue('MTX1_SRC', 18); // LFO1
            mtxApp.activeTimbre.setValue('MTX1_DST', 13); // Cutoff
            mtxApp.activeTimbre.setValue('MTX2_SRC', 3);  // Velocity
            mtxApp.activeTimbre.setValue('MTX2_DST', 5);  // Shape 1

            mtxApp.buildEditorUI();

            const srcControls = modGrid.querySelectorAll('.mtx-select-src');
            const dstControls = modGrid.querySelectorAll('.mtx-select-dst');
            assertEqual(srcControls.length, 12, 'Mod Matrix renders 12 source controls');
            assertEqual(dstControls.length, 12, 'Mod Matrix renders 12 destination controls');
            assert(srcControls[0].getAttribute('draggable') === 'true', 'Mod Matrix source control is draggable');
            assert(dstControls[0].getAttribute('draggable') === 'true', 'Mod Matrix destination control is draggable');

            const makeMtxDragEvent = (type, extra = {}) => {
                const store = extra._store || {};
                return {
                    type,
                    relatedTarget: extra.relatedTarget || null,
                    preventDefault() { },
                    stopPropagation() { },
                    dataTransfer: {
                        effectAllowed: '',
                        dropEffect: '',
                        setData(k, v) { store[k] = v; },
                        getData(k) { return store[k] || ''; }
                    }
                };
            };

            // 1. Source -> Source drag/drop copies MTX1_SRC -> MTX2_SRC and is undoable
            const srcStore = {};
            srcControls[0].dispatchEvent(makeMtxDragEvent('dragstart', { _store: srcStore }));
            srcControls[1].dispatchEvent(makeMtxDragEvent('dragover', { _store: srcStore }));
            assert(srcControls[1].classList.contains('slot-drop-hover'), 'Source dragover on another source adds slot-drop-hover');
            // Cross-field dragover (source -> destination) should be ignored
            dstControls[1].dispatchEvent(makeMtxDragEvent('dragover', { _store: srcStore }));
            assert(!dstControls[1].classList.contains('slot-drop-hover'), 'Source dragover on destination does not add slot-drop-hover');
            dstControls[1].dispatchEvent(makeMtxDragEvent('drop', { _store: srcStore }));
            assertEqual(mtxApp.activeTimbre.getValue('MTX2_DST'), 5, 'Dropping source on destination does not modify destination');

            srcControls[1].dispatchEvent(makeMtxDragEvent('drop', { _store: srcStore }));
            assert(!srcControls[1].classList.contains('slot-drop-hover'), 'Drop on source clears slot-drop-hover');
            assertEqual(mtxApp.activeTimbre.getValue('MTX2_SRC'), 18, 'Dropping source 1 onto source 2 copies MTX1_SRC to MTX2_SRC');
            assertEqual(mtxApp.undoStack.length, 1, 'Source drag/drop records 1 undo entry');

            mtxApp.undo();
            assertEqual(mtxApp.activeTimbre.getValue('MTX2_SRC'), 3, 'Undo restores previous MTX2_SRC');
            mtxApp.redo();
            assertEqual(mtxApp.activeTimbre.getValue('MTX2_SRC'), 18, 'Redo reapplies copied MTX2_SRC');

            // 2. Destination -> Destination drag/drop copies MTX1_DST -> MTX2_DST and is undoable
            const dstStore = {};
            dstControls[0].dispatchEvent(makeMtxDragEvent('dragstart', { _store: dstStore }));
            dstControls[1].dispatchEvent(makeMtxDragEvent('dragover', { _store: dstStore }));
            assert(dstControls[1].classList.contains('slot-drop-hover'), 'Destination dragover on another destination adds slot-drop-hover');
            srcControls[1].dispatchEvent(makeMtxDragEvent('dragover', { _store: dstStore }));
            assert(!srcControls[1].classList.contains('slot-drop-hover'), 'Destination dragover on source does not add slot-drop-hover');

            dstControls[1].dispatchEvent(makeMtxDragEvent('drop', { _store: dstStore }));
            assertEqual(mtxApp.activeTimbre.getValue('MTX2_DST'), 13, 'Dropping destination 1 onto destination 2 copies MTX1_DST to MTX2_DST');
            assertEqual(mtxApp.undoStack.length, 2, 'Destination drag/drop records 1 undo entry');

            mtxApp.undo();
            assertEqual(mtxApp.activeTimbre.getValue('MTX2_DST'), 5, 'Undo restores previous MTX2_DST');
            mtxApp.redo();
            assertEqual(mtxApp.activeTimbre.getValue('MTX2_DST'), 13, 'Redo reapplies copied MTX2_DST');
        } catch (e) {
            logger(`  Error: ${e.message}`);
            failed++;
        } finally {
            document.getElementById = prevGetEl54;
        }

        // Section 55: Init Button Atomic Undo/Redo Tests
    });

    await runSection('\n--- [58] LFO Drag-to-Destination Mod Matrix Mapping Tests ---', async () => {
        const prevGetEl58 = document.getElementById;
        try {
            const modGrid = document.createElement('div');
            modGrid.id = 'editor-grid';
            document.getElementById = (id) => (id === 'editor-grid' ? modGrid : prevGetEl58(id));

            const lfoDstApp = new App();
            // Occupy slot 1 so next empty slot should be slot 2
            lfoDstApp.activeTimbre.setValue('MTX1_SRC', 1);
            lfoDstApp.activeTimbre.setValue('MTX1_DST', 2);
            lfoDstApp.buildEditorUI();

            const lfoBadges = modGrid.querySelectorAll('.lfo-badge');
            assertEqual(lfoBadges.length, 3, 'Renders 3 LFO badges');
            const cutoffControl = modGrid.querySelectorAll('[data-param]').find(el => el.getAttribute('data-param') === 'FILTER_FREQ');
            assert(cutoffControl !== undefined, 'FILTER_FREQ control exists in editor grid');

            const makeLfoDragEvent = (type, extra = {}) => {
                const store = extra._store || {};
                return {
                    type,
                    relatedTarget: extra.relatedTarget || null,
                    preventDefault() { },
                    stopPropagation() { },
                    dataTransfer: {
                        effectAllowed: '',
                        dropEffect: '',
                        setData(k, v) { store[k] = v; },
                        getData(k) { return store[k] || ''; }
                    }
                };
            };

            // 1. Drag LFO 1 onto Cutoff when slot 2 is empty
            const lfo1Store = {};
            lfoBadges[0].dispatchEvent(makeLfoDragEvent('dragstart', { _store: lfo1Store }));
            cutoffControl.dispatchEvent(makeLfoDragEvent('dragover', { _store: lfo1Store }));
            assert(cutoffControl.classList.contains('lfo-dst-drop-hover'), 'Dragover with LFO 1 adds lfo-dst-drop-hover to Cutoff');

            cutoffControl.dispatchEvent(makeLfoDragEvent('drop', { _store: lfo1Store }));
            assert(!cutoffControl.classList.contains('lfo-dst-drop-hover'), 'Drop clears lfo-dst-drop-hover');
            assertEqual(lfoDstApp.activeTimbre.getValue('MTX2_SRC'), 18, 'Drop sets MTX2_SRC to LFO1 (18)');
            assertEqual(lfoDstApp.activeTimbre.getValue('MTX2_DST'), 13, 'Drop sets MTX2_DST to Cutoff (13)');
            assertEqual(lfoDstApp.activeTimbre.getValue('MTX2_AMT'), 160, 'Drop initializes MTX2_AMT to non-zero depth (160)');
            assertEqual(lfoDstApp.undoStack.length, 1, 'LFO-to-destination drop records 1 atomic undo entry');

            // 2. Undo & Redo
            lfoDstApp.undo();
            assertEqual(lfoDstApp.activeTimbre.getValue('MTX2_SRC'), 0, 'Undo clears MTX2_SRC');
            assertEqual(lfoDstApp.activeTimbre.getValue('MTX2_DST'), 0, 'Undo clears MTX2_DST');
            assertEqual(lfoDstApp.activeTimbre.getValue('MTX2_AMT'), 128, 'Undo restores MTX2_AMT to 128');

            lfoDstApp.redo();
            assertEqual(lfoDstApp.activeTimbre.getValue('MTX2_SRC'), 18, 'Redo restores MTX2_SRC');
            assertEqual(lfoDstApp.activeTimbre.getValue('MTX2_DST'), 13, 'Redo restores MTX2_DST');

            // 3. Drag Env 2 (tab button and graph card) and Mult 1 onto destination controls
            const envTabs = modGrid.querySelectorAll('.btn-env-tab');
            const envGraphCards = modGrid.querySelectorAll('.adsr-graph-card');
            const multBadges = modGrid.querySelectorAll('.mult-badge');
            const resoControl = modGrid.querySelectorAll('[data-param]').find(el => el.getAttribute('data-param') === 'FILTER_RESO');
            const driveControl = modGrid.querySelectorAll('[data-param]').find(el => el.getAttribute('data-param') === 'DRIVE_VOICE');
            const shape1Control = modGrid.querySelectorAll('[data-param]').find(el => el.getAttribute('data-param') === 'OSC1_SHAPE');

            const env2TabStore = {};
            envTabs[1].dispatchEvent(makeLfoDragEvent('dragstart', { _store: env2TabStore }));
            resoControl.dispatchEvent(makeLfoDragEvent('dragover', { _store: env2TabStore }));
            assert(resoControl.classList.contains('lfo-dst-drop-hover'), 'Dragover with Env 2 tab adds lfo-dst-drop-hover to Resonance');
            resoControl.dispatchEvent(makeLfoDragEvent('drop', { _store: env2TabStore }));
            assertEqual(lfoDstApp.activeTimbre.getValue('MTX3_SRC'), 14, 'Drop from Env 2 tab sets MTX3_SRC to Env2 (14)');
            assertEqual(lfoDstApp.activeTimbre.getValue('MTX3_DST'), 14, 'Drop from Env 2 tab sets MTX3_DST to Resonance (14)');

            const env3CardStore = {};
            envGraphCards[2].dispatchEvent(makeLfoDragEvent('dragstart', { _store: env3CardStore }));
            driveControl.dispatchEvent(makeLfoDragEvent('dragover', { _store: env3CardStore }));
            assert(driveControl.classList.contains('lfo-dst-drop-hover'), 'Dragover with Env 3 graph card adds lfo-dst-drop-hover to Drive');
            driveControl.dispatchEvent(makeLfoDragEvent('drop', { _store: env3CardStore }));
            assertEqual(lfoDstApp.activeTimbre.getValue('MTX4_SRC'), 16, 'Drop from Env 3 graph card sets MTX4_SRC to Env3 (16)');
            assertEqual(lfoDstApp.activeTimbre.getValue('MTX4_DST'), 16, 'Drop from Env 3 graph card sets MTX4_DST to Drive (16)');

            const mult1Store = {};
            multBadges[0].dispatchEvent(makeLfoDragEvent('dragstart', { _store: mult1Store }));
            shape1Control.dispatchEvent(makeLfoDragEvent('dragover', { _store: mult1Store }));
            assert(shape1Control.classList.contains('lfo-dst-drop-hover'), 'Dragover with Mult 1 adds lfo-dst-drop-hover to Shape 1');
            shape1Control.dispatchEvent(makeLfoDragEvent('drop', { _store: mult1Store }));
            assertEqual(lfoDstApp.activeTimbre.getValue('MTX5_SRC'), 42, 'Drop from Mult 1 sets MTX5_SRC to Mult 1 (42)');
            assertEqual(lfoDstApp.activeTimbre.getValue('MTX5_DST'), 5, 'Drop from Mult 1 sets MTX5_DST to Shape 1 (5)');

            // 4. Dragging LFO 1 over LFO 2 Speed clears slot-drop-hover on LFO 2 sub-card
            const lfo2Card = modGrid.querySelectorAll('.lfo-sub-card').find(c => String(c.getAttribute('data-lfo')) === '2');
            const lfo2Speed = modGrid.querySelectorAll('[data-param]').find(el => el.getAttribute('data-param') === 'LFO2_SPEED');
            const lfo1ToLfo2Store = {};
            lfoBadges[0].dispatchEvent(makeLfoDragEvent('dragstart', { _store: lfo1ToLfo2Store }));
            lfo2Card.dispatchEvent(makeLfoDragEvent('dragover', { _store: lfo1ToLfo2Store }));
            assert(lfo2Card.classList.contains('slot-drop-hover'), 'Dragover on LFO 2 card adds slot-drop-hover');
            lfo2Speed.dispatchEvent(makeLfoDragEvent('dragover', { _store: lfo1ToLfo2Store }));
            assert(!lfo2Card.classList.contains('slot-drop-hover'), 'Entering LFO 2 speed knob clears slot-drop-hover on LFO 2 card');
            assert(lfo2Speed.classList.contains('lfo-dst-drop-hover'), 'Entering LFO 2 speed knob adds lfo-dst-drop-hover');
            lfo2Speed.dispatchEvent(makeLfoDragEvent('drop', { _store: lfo1ToLfo2Store }));
            assertEqual(lfoDstApp.activeTimbre.getValue('MTX6_SRC'), 18, 'Drop on LFO 2 speed sets MTX6_SRC to LFO1 (18)');
            assertEqual(lfoDstApp.activeTimbre.getValue('MTX6_DST'), 37, 'Drop on LFO 2 speed sets MTX6_DST to LFO 2 (37)');

            // 5. When all 12 mod matrix slots are occupied, dragover/drop does nothing
            for (let m = 1; m <= 12; m++) {
                lfoDstApp.activeTimbre.setValue(`MTX${m}_SRC`, 1);
                lfoDstApp.activeTimbre.setValue(`MTX${m}_DST`, 2);
            }
            const lfo2Store = {};
            lfoBadges[1].dispatchEvent(makeLfoDragEvent('dragstart', { _store: lfo2Store }));
            resoControl.dispatchEvent(makeLfoDragEvent('dragover', { _store: lfo2Store }));
            assert(!resoControl.classList.contains('lfo-dst-drop-hover'), 'No lfo-dst-drop-hover when mod matrix is full');
            resoControl.dispatchEvent(makeLfoDragEvent('drop', { _store: lfo2Store }));
            assertEqual(lfoDstApp.activeTimbre.getValue('MTX12_DST'), 2, 'Drop does not overwrite any slot when mod matrix is full');
        } catch (e) {
            logger(`  Error: ${e.message}`);
            failed++;
        } finally {
            document.getElementById = prevGetEl58;
        }

        // Section 59: Whole Mod Matrix Reset to Init-Patch Tests
    });

    await runSection('\n--- [59] Whole Mod Matrix Reset to Init-Patch Tests ---', async () => {
        const mtxResetApp = new App();
        const initProg = new MM2Program();
        mtxResetApp.activeTimbre.setValue('OSC1_SHAPE', 77);
        mtxResetApp.activeTimbre.setValue('MTX1_SRC', 5);
        mtxResetApp.activeTimbre.setValue('MTX1_DST', 13);
        mtxResetApp.activeTimbre.setValue('MTX1_AMT', 180);
        mtxResetApp.activeTimbre.setValue('MTX2_SRC', 18);
        mtxResetApp.activeTimbre.setValue('MTX2_DST', 14);
        mtxResetApp.activeTimbre.setValue('MTX2_AMT', 160);

        const onChange = mtxResetApp.createOnChange();
        resetSectionToInit('mtx_group', 1, mtxResetApp.activeTimbre, onChange);

        assertEqual(mtxResetApp.activeTimbre.getValue('OSC1_SHAPE'), 77, 'Resetting whole mod matrix does not alter non-matrix params');
        assertEqual(mtxResetApp.activeTimbre.getValue('MTX1_SRC'), initProg.getValue('MTX1_SRC'), 'MTX1_SRC matches Init-patch (21)');
        assertEqual(mtxResetApp.activeTimbre.getValue('MTX1_DST'), initProg.getValue('MTX1_DST'), 'MTX1_DST matches Init-patch (1)');
        assertEqual(mtxResetApp.activeTimbre.getValue('MTX1_AMT'), initProg.getValue('MTX1_AMT'), 'MTX1_AMT matches Init-patch (136)');
        assertEqual(mtxResetApp.activeTimbre.getValue('MTX2_SRC'), 0, 'MTX2_SRC resets to 0');
        assertEqual(mtxResetApp.activeTimbre.getValue('MTX2_DST'), 0, 'MTX2_DST resets to 0');
        assertEqual(mtxResetApp.activeTimbre.getValue('MTX2_AMT'), 128, 'MTX2_AMT resets to 128');
        assertEqual(mtxResetApp.undoStack.length, 1, 'Whole mod matrix reset records 1 atomic undo entry');

        mtxResetApp.undo();
        assertEqual(mtxResetApp.activeTimbre.getValue('MTX1_SRC'), 5, 'Undo restores previous MTX1_SRC');
        assertEqual(mtxResetApp.activeTimbre.getValue('MTX2_SRC'), 18, 'Undo restores previous MTX2_SRC');

        mtxResetApp.redo();
        assertEqual(mtxResetApp.activeTimbre.getValue('MTX1_SRC'), initProg.getValue('MTX1_SRC'), 'Redo reapplies Init-patch MTX1_SRC');
        assertEqual(mtxResetApp.activeTimbre.getValue('MTX2_SRC'), 0, 'Redo reapplies cleared MTX2_SRC');
    });

    await runSection('\n--- [69] Editor Drag-and-Drop Drop Tips Tests ---', async () => {
        const makeEvt = (type, extra = {}) => {
            const store = extra._store || {};
            return {
                type,
                relatedTarget: extra.relatedTarget || null,
                preventDefault() { },
                stopPropagation() { },
                dataTransfer: {
                    effectAllowed: '',
                    dropEffect: '',
                    setData(k, v) { store[k] = v; },
                    getData(k) { return store[k] || ''; }
                }
            };
        };

        const tipApp = new App();
        tipApp.setTimbralMode('bitimbral', { broadcast: false });
        const mBtns = [0, 1].map(i => {
            const b = document.createElement('button');
            b.dataset = { mem: String(i) };
            return b;
        });
        const pA = document.createElement('button');
        pA.dataset = { slot: '0' };
        const pB = document.createElement('button');
        pB.dataset = { slot: '1' };
        const eGrid = document.createElement('div');
        tipApp.wireMemoryAndPartDragDrop({ memButtons: mBtns, partButtons: [pA, pB], appMain: null, editorGrid: eGrid, clearButton: null });

        // 1. Memory -> Memory
        const m1 = new MM2Program();
        m1.name = 'MEM_ONE';
        tipApp.memories[0] = m1;
        const mCopyStore = {};
        mBtns[0].dispatchEvent(makeEvt('dragstart', { _store: mCopyStore }));
        mBtns[1].dispatchEvent(makeEvt('dragover', { _store: mCopyStore }));
        assertEqual(mBtns[1].getAttribute('data-drop-tip'), 'Drop to copy Memory M1 to M2', 'Memory -> Memory shows copy drop tip');
        mBtns[1].dispatchEvent(makeEvt('dragleave', { _store: mCopyStore }));
        assertEqual(mBtns[1].getAttribute('data-drop-tip') || '', '', 'Memory -> Memory clears drop tip on dragleave');

        // 2. Part -> Memory (non-Init vs Init)
        tipApp.timbreA.name = 'CUSTOM';
        tipApp.timbreA.setValue('OSC1_SHAPE', 55);
        const pMemStore = {};
        pA.dispatchEvent(makeEvt('dragstart', { _store: pMemStore }));
        mBtns[0].dispatchEvent(makeEvt('dragover', { _store: pMemStore }));
        assertEqual(mBtns[0].getAttribute('data-drop-tip'), 'Drop to store Part A in Memory M1', 'Non-Init Part -> Memory shows store drop tip');

        tipApp.timbreA = new MM2Program();
        mBtns[0].dispatchEvent(makeEvt('dragover', { _store: pMemStore }));
        assertEqual(mBtns[0].getAttribute('data-drop-tip'), 'Drop to clear Memory M1', 'Init Part -> Memory shows clear drop tip');

        // 3 & 4. Part A -> Part B button vs Part A -> editorGrid (Part B active): consistent tip
        const pPartStore = {};
        pA.dispatchEvent(makeEvt('dragstart', { _store: pPartStore }));
        pB.dispatchEvent(makeEvt('dragover', { _store: pPartStore }));
        assertEqual(pB.getAttribute('data-drop-tip'), 'Drop to copy Part A to Part B', 'Part A -> Part B button shows copy drop tip');
        tipApp.selectPart(1);
        eGrid.dispatchEvent(makeEvt('dragover', { _store: pPartStore }));
        assertEqual(eGrid.getAttribute('data-drop-tip'), 'Drop to copy Part A to Part B', 'Part A -> editorGrid (Part B active) uses identical copy drop tip');

        // 5. Section copy (OSC tab vs OSC body consistent tip)
        const oscTab1 = document.createElement('button');
        const oscTab2 = document.createElement('button');
        const oscBody = document.createElement('div');
        tipApp.wireSectionDragSource(oscTab1, 'osc', 1);
        tipApp.wireSectionDropTarget(oscTab2, 'osc', 2, () => tipApp.activeTimbre, () => {});
        tipApp.wireSectionDropTarget(oscBody, 'osc', 2, () => tipApp.activeTimbre, () => {});
        const oscStore = {};
        oscTab1.dispatchEvent(makeEvt('dragstart', { _store: oscStore }));
        oscTab2.dispatchEvent(makeEvt('dragover', { _store: oscStore }));
        oscBody.dispatchEvent(makeEvt('dragover', { _store: oscStore }));
        assertEqual(oscTab2.getAttribute('data-drop-tip'), 'Drop to copy OSC 1 to OSC 2', 'OSC tab drop target shows copy drop tip');
        assertEqual(oscBody.getAttribute('data-drop-tip'), 'Drop to copy OSC 1 to OSC 2', 'OSC body drop target uses identical copy drop tip');

        // 6. Mod Matrix Src/Dst field copy
        const src1 = document.createElement('div');
        const src2 = document.createElement('div');
        tipApp.wireMtxFieldDragDrop(src1, 'src', 1, () => tipApp.activeTimbre, () => {});
        tipApp.wireMtxFieldDragDrop(src2, 'src', 2, () => tipApp.activeTimbre, () => {});
        const mtxFieldStore = {};
        src1.dispatchEvent(makeEvt('dragstart', { _store: mtxFieldStore }));
        src2.dispatchEvent(makeEvt('dragover', { _store: mtxFieldStore }));
        assertEqual(src2.getAttribute('data-drop-tip'), 'Drop to copy Slot 1 Source to Slot 2', 'Mtx field drop target shows copy drop tip');

        // 7. Mod source -> parameter control
        const modContainer = document.createElement('div');
        const lfoDrag = document.createElement('span');
        const paramCtrl = document.createElement('div');
        paramCtrl.setAttribute('data-param', 'FILTER_FREQ');
        modContainer.appendChild(paramCtrl);
        tipApp.wireSectionDragSource(lfoDrag, 'lfo', 1);
        tipApp.wireModSourceToDestinationDropTargets(modContainer, () => tipApp.activeTimbre, () => {});
        const modStore = {};
        lfoDrag.dispatchEvent(makeEvt('dragstart', { _store: modStore }));
        paramCtrl.dispatchEvent(makeEvt('dragover', { _store: modStore }));
        assert((paramCtrl.getAttribute('data-drop-tip') || '').includes('Add to mod matrix: LFO 1 ->'), 'Mod destination control shows mod matrix drop tip');

        // 8. Sequencer step -> step and step -> Copy All
        const seqProg = new MM2Program();
        const seqEl = createArpSequencer(() => seqProg, () => {});
        const steps = seqEl.querySelectorAll('.step-col');
        const copyAllBtn = seqEl.querySelectorAll('.seq-copy-all-btn')[0];
        const seqStore = {};
        steps[0].dispatchEvent(makeEvt('dragstart', { _store: seqStore }));
        steps[1].dispatchEvent(makeEvt('dragover', { _store: seqStore }));
        assertEqual(steps[1].getAttribute('data-drop-tip'), 'Drop to copy Step 1 to Step 2', 'Sequencer step shows copy drop tip');
        copyAllBtn.dispatchEvent(makeEvt('dragover', { _store: seqStore }));
        assert((copyAllBtn.getAttribute('data-drop-tip') || '').includes('from Step 1 to all steps'), 'Sequencer copy-all button shows copy drop tip');

        // 9. Sequencer step mod/note short closed labels ("Rnd" / "Cho") vs long open labels ("Random" / "Chord")
        const modSel = steps[0].querySelector('.step-mod-btn');
        const rndOpt = modSel ? modSel.children[3] : null;
        assert(!!rndOpt, 'Sequencer step mod dropdown has Random option');
        assertEqual(rndOpt.textContent, 'Rnd', 'Random option displays short label "Rnd" when closed');
        modSel.dispatchEvent({ type: 'mousedown' });
        assertEqual(rndOpt.textContent, 'Random', 'Random option displays full label "Random" when opening dropdown');
        modSel.value = '3';
        modSel.dispatchEvent({ type: 'change' });
        assertEqual(rndOpt.textContent, 'Rnd', 'Random option reverts to "Rnd" after selection change');

        const noteSel = steps[0].querySelector('.step-mode-btn');
        const octDownOpt = noteSel ? noteSel.children[3] : null;
        const octUpOpt = noteSel ? noteSel.children[10] : null;
        const choOpt = noteSel ? noteSel.children[11] : null;
        assert(!!choOpt, 'Sequencer step note dropdown has Chord option');
        assertEqual(octDownOpt.textContent, '<-1', 'Octave down displays short label "<-1" when closed');
        assertEqual(octUpOpt.textContent, '>+1', 'Octave up displays short label ">+1" when closed');
        assertEqual(choOpt.textContent, 'Cho', 'Chord option displays short label "Cho" when closed');
        noteSel.dispatchEvent({ type: 'mousedown' });
        assertEqual(octDownOpt.textContent, '< -1', 'Octave down displays full label "< -1" when opening dropdown');
        assertEqual(octUpOpt.textContent, '> +1', 'Octave up displays full label "> +1" when opening dropdown');
        assertEqual(choOpt.textContent, 'Chord', 'Chord option displays full label "Chord" when opening dropdown');
        noteSel.value = '11';
        noteSel.dispatchEvent({ type: 'change' });
        assertEqual(octDownOpt.textContent, '<-1', 'Octave down reverts to "<-1" after selection change');
        assertEqual(octUpOpt.textContent, '>+1', 'Octave up reverts to ">+1" after selection change');
        assertEqual(choOpt.textContent, 'Cho', 'Chord option reverts to "Cho" after selection change');

    });

});
