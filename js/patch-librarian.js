/**
 * Patch Librarian Model and Storage for MicroMonsta 2
 * Provides IndexedDB persistence, bank management, drag-and-drop reordering,
 * program swapping, duplicate alerting/flagging, and bank condensation.
 */

const DB_NAME = 'MM2_Editor_Librarian_DB';
const DB_VERSION = 1;
const STORE_BANKS = 'banks';

class PatchLibrarian {
    constructor() {
        this.banks = [];
        this.activeBankIndex = 0;
        this.receivingBankIndex = -1; // -1 means auto-receive into active bank or none
        this.db = null;
        this._listeners = new Map();
    }

    on(event, cb) {
        if (!this._listeners.has(event)) this._listeners.set(event, new Set());
        this._listeners.get(event).add(cb);
    }

    off(event, cb) {
        if (this._listeners.has(event)) this._listeners.get(event).delete(cb);
    }

    emit(event, data) {
        if (this._listeners.has(event)) {
            for (const cb of this._listeners.get(event)) {
                try { cb(data); } catch (e) { console.error(`Error in Librarian [${event}]:`, e); }
            }
        }
    }

    get activeBank() {
        return this.banks[this.activeBankIndex] || null;
    }

    async init() {
        await this.initDB();
        await this.loadAllBanks();
        if (this.banks.length === 0) {
            this.createDefaultBanks();
            await this.saveAllBanks();
        }
        this.emit('update', { type: 'ready' });
    }

    initDB() {
        return new Promise((resolve) => {
            if (typeof indexedDB === 'undefined') {
                console.warn('IndexedDB unavailable, falling back to in-memory/localStorage');
                resolve(null);
                return;
            }

            try {
                const req = indexedDB.open(DB_NAME, DB_VERSION);
                req.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(STORE_BANKS)) {
                        db.createObjectStore(STORE_BANKS, { keyPath: 'id' });
                    }
                };
                req.onsuccess = (e) => {
                    this.db = e.target.result;
                    resolve(this.db);
                };
                req.onerror = (e) => {
                    console.warn('IndexedDB failed to open:', e);
                    resolve(null);
                };
            } catch (e) {
                console.warn('IndexedDB unavailable in this context, falling back to localStorage:', e);
                resolve(null);
            }
        });
    }

    createDefaultBanks() {
        this.banks = [
            new MM2Bank('Bank A', 0),
            new MM2Bank('Bank B', 1),
            new MM2Bank('Bank C', 2)
        ];
        // Populate Bank A with a starter INIT program
        this.banks[0].addProgram(new MM2Program());
    }

    async loadAllBanks() {
        if (!this.db) {
            // LocalStorage fallback
            if (typeof window !== 'undefined') {
                try {
                    const raw = window.localStorage.getItem('mm2_librarian_banks');
                    if (raw) {
                        const parsed = JSON.parse(raw);
                        this.banks = parsed.map((bData, idx) => {
                            const bank = new MM2Bank(bData.name, idx);
                            if (bData.programs) {
                                for (const pBytes of bData.programs) {
                                    bank.addProgram(new MM2Program(new Uint8Array(pBytes)));
                                }
                            }
                            return bank;
                        });
                    }
                } catch (e) {
                    console.warn('Failed to load banks from localStorage:', e);
                }
            }
            return;
        }

        return new Promise((resolve) => {
            try {
                const tx = this.db.transaction(STORE_BANKS, 'readonly');
                const store = tx.objectStore(STORE_BANKS);
                const req = store.getAll();
                req.onsuccess = () => {
                    const records = req.result || [];
                    if (records.length > 0) {
                        records.sort((a, b) => a.index - b.index);
                        this.banks = records.map((rec) => {
                            const bank = new MM2Bank(rec.name, rec.index);
                            if (rec.programs) {
                                for (const pBytes of rec.programs) {
                                    bank.addProgram(new MM2Program(new Uint8Array(pBytes)));
                                }
                            }
                            return bank;
                        });
                    }
                    resolve();
                };
                req.onerror = () => resolve();
            } catch (e) {
                console.warn('Error reading from IndexedDB:', e);
                resolve();
            }
        });
    }

    async saveAllBanks() {
        this.emit('update', { type: 'save' });

        if (!this.db) {
            // LocalStorage fallback
            if (typeof window !== 'undefined') {
                try {
                    const serializable = this.banks.map(b => ({
                        name: b.name,
                        index: b.index,
                        programs: b.programs.map(p => Array.from(p.rawData))
                    }));
                    window.localStorage.setItem('mm2_librarian_banks', JSON.stringify(serializable));
                } catch (e) {
                    console.warn('Failed to save to localStorage:', e);
                }
            }
            return;
        }

        return new Promise((resolve) => {
            try {
                const tx = this.db.transaction(STORE_BANKS, 'readwrite');
                const store = tx.objectStore(STORE_BANKS);
                store.clear().onsuccess = () => {
                    for (let i = 0; i < this.banks.length; i++) {
                        const b = this.banks[i];
                        store.put({
                            id: `bank_${i}`,
                            index: i,
                            name: b.name,
                            programs: b.programs.map(p => p.rawData)
                        });
                    }
                };
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            } catch (e) {
                console.warn('Failed to write to IndexedDB:', e);
                resolve();
            }
        });
    }

    addBank(name = `Bank ${this.banks.length + 1}`) {
        const newBank = new MM2Bank(name, this.banks.length);
        this.banks.push(newBank);
        this.saveAllBanks();
        return newBank;
    }

    removeBank(index) {
        if (this.banks.length <= 1) return false;
        this.banks.splice(index, 1);
        for (let i = 0; i < this.banks.length; i++) {
            this.banks[i].index = i;
        }
        if (this.activeBankIndex >= this.banks.length) {
            this.activeBankIndex = this.banks.length - 1;
        }
        this.saveAllBanks();
        return true;
    }

    /**
     * Drag-to-reorder banks
     */
    reorderBanks(fromIndex, toIndex) {
        if (
            fromIndex < 0 || fromIndex >= this.banks.length ||
            toIndex < 0 || toIndex >= this.banks.length
        ) return false;

        const [item] = this.banks.splice(fromIndex, 1);
        this.banks.splice(toIndex, 0, item);
        for (let i = 0; i < this.banks.length; i++) {
            this.banks[i].index = i;
        }
        this.activeBankIndex = toIndex;
        this.saveAllBanks();
        return true;
    }

    /**
     * Swaps programs across or within banks
     */
    swapPrograms(bankIndexA, progIndexA, bankIndexB, progIndexB) {
        const bankA = this.banks[bankIndexA];
        const bankB = this.banks[bankIndexB];
        if (!bankA || !bankB) return false;

        const progA = bankA.getProgram(progIndexA);
        const progB = bankB.getProgram(progIndexB);
        if (!progA || !progB) return false;

        bankA.setProgram(progIndexA, progB);
        bankB.setProgram(progIndexB, progA);
        this.saveAllBanks();
        return true;
    }

    /**
     * Move or copy program from one bank to another
     */
    moveProgram(sourceBankIdx, sourceProgIdx, targetBankIdx, targetProgIdx, isCopy = false) {
        const srcBank = this.banks[sourceBankIdx];
        const dstBank = this.banks[targetBankIdx];
        if (!srcBank || !dstBank) return false;

        const prog = srcBank.getProgram(sourceProgIdx);
        if (!prog) return false;

        const itemToInsert = isCopy ? prog.clone() : prog;
        if (!isCopy) {
            srcBank.removeProgram(sourceProgIdx);
        }

        if (targetProgIdx < 0 || targetProgIdx >= dstBank.length) {
            dstBank.addProgram(itemToInsert);
        } else {
            dstBank.programs.splice(targetProgIdx, 0, itemToInsert);
        }

        this.saveAllBanks();
        return true;
    }

    /**
     * Handles incoming captured program from MM2 hardware.
     * Only adds to bank if a receiving bank target is explicitly designated (receivingBankIndex >= 0).
     */
    handleIncomingProgram(program) {
        if (this.receivingBankIndex < 0 || this.receivingBankIndex >= this.banks.length) {
            // Auto-capture target is not active: do not add to librarian
            return false;
        }

        const targetBank = this.banks[this.receivingBankIndex];
        if (!targetBank) return false;

        targetBank.addProgram(program);
        this.saveAllBanks();
        this.emit('program-captured', {
            bankIndex: targetBank.index,
            programIndex: targetBank.length - 1,
            program
        });
        return true;
    }

    /**
     * Runs duplicate detection on a bank or across all banks
     */
    detectDuplicates(bankIndex = null, soundOnly = true) {
        if (bankIndex !== null) {
            const bank = this.banks[bankIndex];
            return bank ? bank.detectDuplicates(soundOnly) : null;
        }

        // Cross-bank duplicate detection
        const allGroups = new Map();
        let totalDups = 0;
        const duplicateItems = [];

        for (let b = 0; b < this.banks.length; b++) {
            const bank = this.banks[b];
            for (let p = 0; p < bank.programs.length; p++) {
                const prog = bank.programs[p];
                const key = soundOnly ? prog.computeSoundFingerprint() : prog.computeFullSignature();
                if (!allGroups.has(key)) {
                    allGroups.set(key, [{ bankIndex: b, progIndex: p, program: prog }]);
                } else {
                    allGroups.get(key).push({ bankIndex: b, progIndex: p, program: prog });
                    duplicateItems.push({ bankIndex: b, progIndex: p, program: prog });
                    totalDups++;
                }
            }
        }

        const groups = Array.from(allGroups.values()).filter(g => g.length > 1);
        return {
            duplicatesFound: totalDups,
            groups
        };
    }

    /**
     * Removes duplicates from a given bank
     */
    removeDuplicates(bankIndex, soundOnly = true) {
        const bank = this.banks[bankIndex];
        if (!bank) return 0;
        const count = bank.removeDuplicates(soundOnly);
        this.saveAllBanks();
        return count;
    }

    /**
     * Condenses a given bank (removes duplicates and optionally INIT patches)
     */
    condenseBank(bankIndex, options = { removeDuplicates: true, removeInits: false }) {
        const bank = this.banks[bankIndex];
        if (!bank) return null;
        const res = bank.condenseBank(options);
        this.saveAllBanks();
        return res;
    }

    /**
     * Export a single program as .syx file download
     */
    exportProgramFile(program, fileName = null) {
        const sysex = program.toSysEx();
        const cleanName = (program.name || 'patch').replace(/[^a-zA-Z0-9_-]/g, '_');
        const finalName = fileName || `${cleanName}.MM2-PGM.syx`;
        PatchLibrarian.downloadBlob(sysex, finalName);
    }

    /**
     * Export an entire bank as a .syx file download
     */
    exportBankFile(bankIndex, fileName = null) {
        const bank = this.banks[bankIndex];
        if (!bank || bank.length === 0) return false;
        const sysex = bank.toBankSysEx();
        const cleanName = (bank.name || `bank_${bankIndex + 1}`).replace(/[^a-zA-Z0-9_-]/g, '_');
        const finalName = fileName || `${cleanName}.MM2-BANK.syx`;
        PatchLibrarian.downloadBlob(sysex, finalName);
        return true;
    }

    /**
     * Helper to trigger client-side download of a binary file
     */
    static downloadBlob(bytes, filename) {
        const blob = new Blob([bytes], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}
