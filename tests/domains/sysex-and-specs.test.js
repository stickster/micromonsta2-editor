/**
 * Domain Tests: SysEx, Specs & Firmware Compatibility
 */
MM2TestRunner.register('SysEx, Specs & Firmware Compatibility', async ({ assert, assertEqual, logger, runSection }) => {
    await runSection('\n--- [1] SysEx Validation Tests ---', async () => {
        assertEqual(validateSysEx(INIT_PROGRAM_BYTES), 3, 'Validates default v3 Init Program');

        const badHeader = new Uint8Array(INIT_PROGRAM_BYTES);
        badHeader[1] = 0x7F;
        assertEqual(validateSysEx(badHeader), 0, 'Rejects invalid SysEx manufacturer header');

        const badLength = new Uint8Array(200);
        assertEqual(validateSysEx(badLength), 0, 'Rejects non-standard SysEx length');

        const nonMidiBytes = new Uint8Array(INIT_PROGRAM_BYTES);
        nonMidiBytes[20] = 0x80; // Byte > 127
        assertEqual(validateSysEx(nonMidiBytes), 0, 'Rejects SysEx packet with data byte > 127');
    });

    await runSection('\n--- [2] MM2Program Parameter & Serialization Tests ---', async () => {
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
    });

    await runSection('\n--- [3] SysEx v2 to v3 Converter Tests ---', async () => {
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
    });

    await runSection('\n--- [12] FW v3 Chorder, Scaler, Macro Knobs & Math Operators Tests ---', async () => {
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
    });

    await runSection('\n--- [26] App Versioning & Metadata Tests ---', async () => {
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

        if (typeof globalThis !== 'undefined' && globalThis.INDEX_HTML) {
            const repoUrl = 'https://github.com/stickster/micromonsta2-editor';
            for (const badgeId of ['app-version-badge', 'settings-app-version']) {
                const match = globalThis.INDEX_HTML.match(new RegExp(`<a\\b[^>]*id="${badgeId}"[^>]*>`, 'i'));
                assert(!!match, `${badgeId} is rendered as an <a> link in index.html`);
                if (match) {
                    assert(match[0].includes(`href="${repoUrl}"`), `${badgeId} links to ${repoUrl}`);
                    assert(match[0].includes('target="_blank"'), `${badgeId} opens in a new tab`);
                    assert(match[0].includes('rel="noopener noreferrer"'), `${badgeId} includes rel="noopener noreferrer"`);
                }
            }

            assert(
                globalThis.INDEX_HTML.includes(`href="css/style.css?v=${App.VERSION}"`),
                `index.html stylesheet includes ?v=${App.VERSION} cache-buster`
            );
            const expectedScripts = [
                'js/version.js', 'js/mm2-specs.js', 'js/sysex-parser.js', 'js/patch-librarian.js',
                'js/tab-sync.js', 'js/midi-manager.js', 'js/ui-controls.js', 'js/app.js'
            ];
            for (const scriptPath of expectedScripts) {
                assert(
                    globalThis.INDEX_HTML.includes(`src="${scriptPath}?v=${App.VERSION}"`),
                    `index.html script ${scriptPath} includes ?v=${App.VERSION} cache-buster`
                );
            }
        }
    });

    await runSection('\n--- [39] Firmware 2.x Compatibility Tests ---', async () => {
        // 1. v3 -> v2 conversion and round-trip
        const p3 = new MM2Program();
        p3.name = 'V2TEST';
        p3.category = 4; // Organ
        p3.setValue('OSC1_SHAPE', 77);
        p3.setValue('FILTER_FREQ', 210);
        p3.setValue('FILTER_RESO', 68);
        p3.setValue('FILTER_CHARACTER', 1); // Vintage in v3
        p3.setValue('DRIVE_VOICE', 45);
        p3.setValue('MTX1_SRC', 41); // Lag (v2 index 36)
        p3.setValue('MTX1_DST', 9);  // Mix 1 (v2 index 8)
        p3.setValue('MTX1_AMT', 175);
        p3.setValue('MTX2_DST', 32); // Release 1 (v2 index 27)
        p3.setValue('LAY_POT1_ASSIGN', 48); // Lag (v2 index 46)

        const v2Out = p3.toSysEx(0, 2, SYSEX_V2_FW_ID);
        assertEqual(v2Out.length, SYSEX_V2_LEN, 'v3->v2 SysEx is 176 bytes');
        assertEqual(validateSysEx(v2Out), 2, 'v3->v2 SysEx validates as firmware v2');
        assertEqual(v2Out[OFFSET_FW], SYSEX_V2_FW_ID, 'v3->v2 SysEx sets OFFSET_FW to 0x10');
        assertEqual(v2Out[151], 2, 'v3->v2 sets v2 FILTER_CHARACTER (offset 151) to Hard (2)');

        const rt = new MM2Program(v2Out);
        assertEqual(rt.name, 'V2TEST', 'v3->v2->v3 round-trip preserves name');
        assertEqual(rt.category, 4, 'v3->v2->v3 round-trip preserves category');
        assertEqual(rt.getValue('OSC1_SHAPE'), 77, 'v3->v2->v3 round-trip preserves OSC1_SHAPE');
        assertEqual(rt.getValue('FILTER_FREQ'), 210, 'v3->v2->v3 round-trip preserves 14-bit FILTER_FREQ');
        assertEqual(rt.getValue('FILTER_RESO'), 68, 'v3->v2->v3 round-trip preserves FILTER_RESO');
        assertEqual(rt.getValue('FILTER_CHARACTER'), 0, 'v2->v3 sets FILTER_CHARACTER to MM2 (0)');
        assertEqual(rt.getValue('DRIVE_VOICE'), 45, 'v3->v2->v3 round-trip preserves DRIVE_VOICE');
        assertEqual(rt.getValue('MTX1_SRC'), 41, 'v3->v2->v3 round-trip preserves shifted mod source (Lag)');
        assertEqual(rt.getValue('MTX1_DST'), 9, 'v3->v2->v3 round-trip preserves shifted mod dest (Mix 1)');
        assertEqual(rt.getValue('MTX1_AMT'), 175, 'v3->v2->v3 round-trip preserves MTX1_AMT');
        assertEqual(rt.getValue('MTX2_DST'), 32, 'v3->v2->v3 round-trip preserves shifted mod dest (Release 1)');
        assertEqual(rt.getValue('LAY_POT1_ASSIGN'), 48, 'v3->v2->v3 round-trip preserves shifted pot assign (Lag)');

        // 2. v3-only feature detection and safe clamping
        const pIncompat = new MM2Program();
        pIncompat.setValue('CHORD_TYPE1', 3);
        pIncompat.setValue('MTX11_SRC', 5);
        pIncompat.setValue('MTX1_SRC', 36); // Arp (v3-only)
        pIncompat.setValue('MTX1_DST', 28); // Sustain 1 (v3-only)
        pIncompat.setValue('LAY_POT1_ASSIGN', 46); // Matrix 11 (v3-only)
        const incompatInfo = detectV3Incompatibilities(pIncompat);
        assert(incompatInfo.hasIncompatibilities, 'detectV3Incompatibilities flags v3-only features');
        assert(incompatInfo.reasons.includes('Chorder & Scaler Engine'), 'Detects Chorder & Scaler incompatibility');
        assert(incompatInfo.reasons.includes('Mod Matrix Slots 11–12'), 'Detects Matrix 11–12 incompatibility');

        const downgraded = new MM2Program(pIncompat.toSysEx(-1, 2));
        assertEqual(downgraded.getValue('MTX1_SRC'), 0, 'v3-only Arp mod source clamps to Off (0) in v2');
        assertEqual(downgraded.getValue('MTX1_DST'), 0, 'v3-only Sustain 1 mod dest clamps to Off (0) in v2');
        assertEqual(downgraded.getValue('LAY_POT1_ASSIGN'), 0, 'v3-only Matrix 11 assign clamps to SYSTEM (0) in v2');

        // 3. Bank v2 export & extractSysExMessagesWithMeta
        const v2Bank = new MM2Bank('V2Bank', 0);
        v2Bank.addProgram(p3);
        v2Bank.addProgram(new MM2Program());
        const bankV2Bytes = v2Bank.toBankSysEx(2, 0x10);
        assertEqual(bankV2Bytes.length, 2 * SYSEX_V2_LEN, 'toBankSysEx(2) produces 2 * 176 bytes');
        const metaMsgs = extractSysExMessagesWithMeta(bankV2Bytes);
        assertEqual(metaMsgs.length, 2, 'extractSysExMessagesWithMeta extracts 2 messages');
        assertEqual(metaMsgs[0].version, 2, 'extractSysExMessagesWithMeta preserves version 2');
        assertEqual(metaMsgs[0].fwId, 0x10, 'extractSysExMessagesWithMeta preserves fwId 0x10');

        // 4. MidiManager v2 auto-detection, NRPN/CC routing, and disconnect reset
        const sentMidiPackets = [];
        const v2Midi = new MidiManager();
        v2Midi.outPort = {
            id: 'mock-v2-out',
            name: 'MicroMonsta 2',
            send: (bytes) => sentMidiPackets.push(Array.from(bytes))
        };
        v2Midi.liveSync = true;
        v2Midi.baseChannel = 0;
        v2Midi.activeSlot = 0;

        assertEqual(v2Midi.effectiveFirmwareVersion, 3, 'MidiManager defaults to v3 before hardware dump');
        v2Midi.handleCompleteSysEx(v2Out);
        assertEqual(v2Midi.detectedFirmwareVersion, 2, 'Receiving 176-byte dump sets detectedFirmwareVersion to 2');
        assertEqual(v2Midi.detectedFwId, 0x10, 'Receiving 176-byte dump captures detectedFwId 0x10');
        assertEqual(v2Midi.effectiveFirmwareVersion, 2, 'effectiveFirmwareVersion switches to 2');

        sentMidiPackets.length = 0;
        v2Midi.sendProgram(p3, 0);
        assertEqual(sentMidiPackets[0].length, SYSEX_V2_LEN, 'sendProgram in v2 mode transmits 176-byte SysEx');

        sentMidiPackets.length = 0;
        v2Midi.sendParameter('DRIVE_VOICE', 55, true);
        assertEqual(sentMidiPackets[0][5], 48, 'v2 sendParameter sends DRIVE_VOICE on NRPN 48');

        sentMidiPackets.length = 0;
        v2Midi.sendParameter('MTX1_AMT', 200, true);
        assertEqual(sentMidiPackets[0][5], 72, 'v2 sendParameter sends MTX1_AMT on NRPN 72');
        assertEqual(sentMidiPackets[0].length, 12, 'v2 MTX1_AMT is 14-bit NRPN (12 bytes)');

        sentMidiPackets.length = 0;
        v2Midi.sendParameter('IFX_EQ', 150, true);
        assertEqual(sentMidiPackets[0][5], 107, 'v2 sendParameter sends IFX_EQ on NRPN 107');

        sentMidiPackets.length = 0;
        v2Midi.sendParameter('MORPH_KNOB', 64, true);
        assertEqual(sentMidiPackets[0][0], 0xB0, 'v2 sendParameter sends MORPH_KNOB as CC on channel 1');
        assertEqual(sentMidiPackets[0][1], 70, 'v2 sendParameter sends MORPH_KNOB on CC 70');
        assertEqual(sentMidiPackets[0][2], 64, 'v2 sendParameter sends MORPH_KNOB value 64');

        sentMidiPackets.length = 0;
        const v3OnlySent = v2Midi.sendParameter('CHORD_TYPE1', 2, true);
        assertEqual(v3OnlySent, false, 'v2 sendParameter skips v3-only CHORD_TYPE1');
        assertEqual(sentMidiPackets.length, 0, 'v2 sendParameter transmits nothing for v3-only param');

        // Incoming v2 NRPN decoding
        let receivedV2Param = null;
        v2Midi.on('parameter-received', (ev) => { receivedV2Param = ev; });
        v2Midi.onMidiMessage({ data: new Uint8Array([0xB0, 99, 0]) });
        v2Midi.onMidiMessage({ data: new Uint8Array([0xB0, 98, 48]) });
        v2Midi.onMidiMessage({ data: new Uint8Array([0xB0, 6, 88]) });
        assertEqual(receivedV2Param && receivedV2Param.paramKey, 'DRIVE_VOICE', 'v2 incoming NRPN 48 decodes as DRIVE_VOICE');
        assertEqual(receivedV2Param && receivedV2Param.value, 88, 'v2 incoming NRPN 48 decodes value 88');

        // Disconnect resets firmware detection
        v2Midi.setOutputPort(null);
        assertEqual(v2Midi.detectedFirmwareVersion, null, 'Disconnecting port resets detectedFirmwareVersion to null');
        assertEqual(v2Midi.effectiveFirmwareVersion, 3, 'effectiveFirmwareVersion reverts to 3 on disconnect');

        // 5. UI badge and v3-only element adaptation
        if (typeof app !== 'undefined' && app && typeof document !== 'undefined') {
            app.midi.setDetectedFirmware(2, 0x10);
            const badge = document.getElementById('fw-version-badge');
            assertEqual(badge && badge.textContent, 'FW v2.x', 'Header badge shows FW v2.x when v2 detected');
            assertEqual(badge && badge.getAttribute('href'), 'https://www.audiothingies.com/tools/micromonsta2_updater/', 'FW v2.x badge links to updater');
            assertEqual(badge && badge.title, 'Update firmware', 'FW v2.x badge tooltip says Update firmware');
            const v3Els = document.querySelectorAll('[data-fw-v3-only="true"]');
            assert(v3Els.length > 0 && Array.from(v3Els).every(el => el.classList.contains('fw-v3-only-hidden')), 'All v3-only UI elements are hidden in v2.x mode');
            app.midi.setDetectedFirmware(null, null);
            assertEqual(badge && badge.textContent, 'FW v3.x', 'Header badge reverts to FW v3.x when detection resets');
            assert(badge && !badge.hasAttribute('href'), 'FW v3.x badge is not clickable (no href)');
            assert(Array.from(v3Els).every(el => !el.classList.contains('fw-v3-only-hidden')), 'v3-only UI elements are visible again in v3.x mode');
        }
    });

});
