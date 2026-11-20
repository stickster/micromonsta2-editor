/**
 * Domain Tests: Cross-Tab Synchronization
 */
MM2TestRunner.register('Cross-Tab Synchronization', async ({ assert, assertEqual, logger, runSection }) => {
    await runSection('\n--- [28] Cross-Tab Synchronization & Single Hardware Polling Tests ---', async () => {
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
    });

    await runSection('\n--- [32] Follower Window Startup Sync without Hardware Fetch Tests ---', async () => {
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
    });

    await runSection('\n--- [35] Follower Window Poll Message Suppression Tests ---', async () => {
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
        leaderApp.midi.outPort = { name: 'MM2 Mock', send: () => { } };
        leaderApp.midi.inPort = { name: 'MM2 Mock' };
        followerApp.midi.outPort = { name: 'MM2 Mock', send: () => { } };
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
        assert(followerNotifications[0].msg.includes('Loaded MM2 hardware patch'), 'Notification message mentions loaded patch');
        assert(!followerNotifications[0].msg.includes('Patch A') && !followerNotifications[0].msg.includes('POLL_PAT'), 'Notification message omits Part A/B and patch name');
        assertEqual(followerApp.syncStatus, 'synced', 'Follower syncStatus updated to synced');
        assertEqual(followerApp.timbreA.name, 'POLL_PAT', 'Follower timbreA updated with fetched program');

        leaderSync.destroy();
        followerSync.destroy();
    });

    await runSection('\n--- [36] Follower Window Connection Status Inheritance Tests ---', async () => {
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
        leaderApp.midi.outPort = { id: 'mm2_out', name: 'MicroMonsta 2', send: () => { } };

        // Setup follower DOM status dot and text elements
        const statusDot = document.createElement('span');
        statusDot.id = 'midi-status-dot';
        const statusText = document.createElement('span');
        statusText.id = 'midi-status-text';
        document.registerMockElement('midi-status-dot', statusDot);
        document.registerMockElement('midi-status-text', statusText);

        followerApp.midi.inPort = { id: 'mm2_in', name: 'MicroMonsta 2' };
        followerApp.midi.outPort = { id: 'mm2_out', name: 'MicroMonsta 2', send: () => { } };

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
        assertEqual(statusText.textContent, 'Connected', 'Follower status text immediately displays Connected');

        // 3. Remote hardware status update from leader immediately propagates to UI
        followerApp.applyRemoteHardwareStatus(false);
        assertEqual(statusDot.className, 'status-dot disconnected unresponsive', 'Follower status dot updates on remote unresponsive status');
        assert(statusText.textContent.includes('No Response'), 'Follower status text reflects No Response');

        followerApp.applyRemoteHardwareStatus(true);
        assertEqual(statusDot.className, 'status-dot connected', 'Follower status dot returns to connected on remote responsive update');
        assertEqual(statusText.textContent, 'Connected', 'Follower status text returns to Connected');

        // Cleanup
        document.registerMockElement('midi-status-dot', null);
        document.registerMockElement('midi-status-text', null);
        leaderSync.destroy();
        followerSync.destroy();
    });

    await runSection('\n--- [37] Cross-Tab Live Sync Control Synchronization Tests ---', async () => {
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
        leaderApp.midi.outPort = { id: 'mm2_out', name: 'MicroMonsta 2', send: () => { } };
        leaderApp.midi.hardwareResponsive = true;

        followerApp.midi.inPort = { id: 'mm2_in', name: 'MicroMonsta 2' };
        followerApp.midi.outPort = { id: 'mm2_out', name: 'MicroMonsta 2', send: () => { } };
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

        // Mock Live Sync button and dialog to verify no dialog is shown on remote sync
        const btnLiveSync = document.createElement('button');
        btnLiveSync.id = 'btn-prog-live-sync';
        btnLiveSync.className = 'btn-param-toggle btn-live-sync';
        document.registerMockElement('btn-prog-live-sync', btnLiveSync);

        let dialogShownCount = 0;
        const mockDialog = {
            showModal: () => { dialogShownCount++; }
        };
        document.registerMockElement('sync-action-dialog', mockDialog);

        // 1. Leader enables Live Sync -> Follower inherits state & UI without dialog
        leaderApp._setLiveSyncState(true);
        assertEqual(leaderApp.midi.liveSync, true, 'Leader liveSync is true');
        assertEqual(followerApp.midi.liveSync, true, 'Follower liveSync synced to true');
        assert(btnLiveSync.classList.contains('active'), 'Live sync button updated to active');
        assertEqual(btnLiveSync.getAttribute('aria-pressed'), 'true', 'Live sync button aria-pressed updated to true');
        assertEqual(dialogShownCount, 0, 'Follower did not show live-sync confirmation dialog');

        // 2. Follower disables Live Sync -> Leader inherits state
        followerApp._setLiveSyncState(false);
        assertEqual(followerApp.midi.liveSync, false, 'Follower liveSync is false');
        assertEqual(leaderApp.midi.liveSync, false, 'Leader liveSync synced to false when toggled from follower');
        assert(!btnLiveSync.classList.contains('active'), 'Live sync button updated to inactive');
        assertEqual(btnLiveSync.getAttribute('aria-pressed'), 'false', 'Live sync button aria-pressed updated to false');

        // 3. Follower enables Live Sync -> Leader inherits state
        followerApp._setLiveSyncState(true);
        assertEqual(leaderApp.midi.liveSync, true, 'Leader liveSync synced to true when toggled from follower');

        // 4. REQUEST_LEADER_STATE includes liveSync and applyLeaderState restores it
        followerApp.midi.liveSync = false;
        btnLiveSync.classList.remove('active');
        leaderSync.handleIncomingMessage({
            type: 'REQUEST_LEADER_STATE',
            senderTabId: followerSync.tabId
        });
        assertEqual(followerApp.midi.liveSync, true, 'New follower inherits liveSync=true from SYNC_LEADER_STATE');
        assert(btnLiveSync.classList.contains('active'), 'New follower button active after SYNC_LEADER_STATE');

        // Cleanup
        document.registerMockElement('btn-prog-live-sync', null);
        document.registerMockElement('sync-action-dialog', null);
        leaderSync.destroy();
        followerSync.destroy();
    });

    await runSection('\n--- [50] Fallback Leader Election Initial Follower Transition Tests ---', async () => {
        const prevLocks = navigator.locks;
        try {
            Object.defineProperty(navigator, 'locks', {
                value: undefined,
                configurable: true
            });
        } catch (e) {
            navigator.locks = undefined;
        }

        const now = Date.now();
        window.localStorage.setItem(TabSyncManager.FALLBACK_LEASE_KEY_ID, 'existing_leader_tab');
        window.localStorage.setItem(TabSyncManager.FALLBACK_LEASE_KEY_TS, String(now));

        const followerApp = new App();
        if (followerApp.tabSync) followerApp.tabSync.destroy();
        let leadershipApplied = null;
        followerApp.midi.setLeaderStatus = (val) => { leadershipApplied = val; };

        const sync = new TabSyncManager(followerApp, { tabId: 'tab_new_follower', channelName: 'test-chan-50' });

        assertEqual(sync.isLeader, false, 'Fallback election transitions initial isLeader from null to false when lease is held');
        assertEqual(sync.isFollower, true, 'isFollower is true immediately when another tab holds the fallback lease');
        assertEqual(leadershipApplied, false, 'setLeadership(false) notifies midi.setLeaderStatus(false) on initial fallback check');

        sync.destroy();
        window.localStorage.removeItem(TabSyncManager.FALLBACK_LEASE_KEY_ID);
        window.localStorage.removeItem(TabSyncManager.FALLBACK_LEASE_KEY_TS);
        try {
            Object.defineProperty(navigator, 'locks', {
                value: prevLocks,
                configurable: true
            });
        } catch (e) {
            navigator.locks = prevLocks;
        }
    });

});
