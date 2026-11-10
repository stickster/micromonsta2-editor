/**
 * MicroMonsta 2 SysEx Parser, Program Model, and Bank Librarian Engine
 */

/**
 * Validates whether a byte array is a valid MM2 SysEx program dump.
 * Returns 3 if v3, 2 if v2, or 0 if invalid.
 */
function validateSysEx(bytes) {
    if (!bytes || !(bytes instanceof Uint8Array)) return 0;
    const len = bytes.length;
    if (len !== SYSEX_V3_LEN && len !== SYSEX_V2_LEN) return 0;

    for (let i = 0; i < SYSEX_HEADER.length; i++) {
        if (bytes[i] !== SYSEX_HEADER[i]) return 0;
    }
    const cmd = bytes[OFFSET_CMD];
    if (cmd < CMD_LOAD_A || cmd > CMD_LOAD_ACTIVE) return 0;
    if (bytes[len - 1] !== SYSEX_END) return 0;

    for (let i = 1; i < len - 1; i++) {
        if (bytes[i] > 127) return 0;
    }

    if (len === SYSEX_V3_LEN) return 3;
    if (len === SYSEX_V2_LEN) return 2;
    return 0;
}

/**
 * Reads a 1-byte or 2-byte (14-bit MIDI) value from buffer
 */
function readBytes(buf, offset, size) {
    if (size === 2) {
        return (buf[offset] << 7) + buf[offset + 1];
    }
    return buf[offset];
}

/**
 * Writes a 1-byte or 2-byte (14-bit MIDI) value to buffer
 */
function writeBytes(buf, offset, size, val) {
    if (size === 2) {
        buf[offset] = (val >> 7) & 127;
        buf[offset + 1] = val & 127;
    } else {
        buf[offset] = val & 127;
    }
}

/**
 * Clamps a number between min and max
 */
function clamp(v, min, max) {
    return Math.min(Math.max(v, min), max);
}

/**
 * Converts a v2 program dump (176 bytes) to a v3 program dump (216 bytes)
 */
function convertV2toV3(v2Bytes) {
    if (validateSysEx(v2Bytes) !== 2) {
        throw new Error('Provided buffer is not a valid MicroMonsta 2 firmware v2 program dump');
    }
    const v3 = new Uint8Array(SYSEX_V3_LEN);
    v3.set(v2Bytes.subarray(0, OFFSET_FW));
    v3[OFFSET_FW] = SYSEX_V3_FW_ID;
    v3[SYSEX_V3_LEN - 1] = SYSEX_END;

    for (const [, v2Off, v3Off, size, rule] of V2_V3_MAP) {
        let val = readBytes(v2Bytes, v2Off, size);
        switch (rule) {
            case 'zero':
                val = 0;
                break;
            case 'source':
                if (val > 35) val = clamp(val + 5, 0, 44);
                break;
            case 'destination':
                if (val > 7) val = clamp(val + 1, 0, 44);
                if (val > 27) val = clamp(val + 4, 0, 44);
                break;
            case 'assign':
                if (val > 45) val = clamp(val + 2, 0, 59);
                break;
        }
        writeBytes(v3, v3Off, size, val);
    }

    for (const [, v3Off, size, defaultVal] of V3_NEW_PARAMS) {
        writeBytes(v3, v3Off, size, defaultVal);
    }

    // Drive fixup if needed
    if (v3[60] === 0) {
        for (let s = 0; s < 10; s++) {
            const src = v3[85 + 2 * s];
            const dst = v3[86 + 2 * s];
            const amt = readBytes(v3, 109 + 2 * s, 2);
            if (dst === 16 && src !== 0 && amt !== 128) {
                v3[60] = 1;
                break;
            }
        }
    }

    return v3;
}

/**
 * Normalizes any program buffer (v2 or v3) to v3 Uint8Array
 */
function normalizeProgram(bytes) {
    const version = validateSysEx(bytes);
    if (version === 3) {
        return new Uint8Array(bytes);
    } else if (version === 2) {
        return convertV2toV3(bytes);
    }
    return null;
}

/**
 * Extracts all valid MM2 SysEx messages from an arbitrary byte array (e.g. .syx file containing a full bank)
 */
function extractSysExMessages(rawBytes) {
    const messages = [];
    let startIdx = -1;
    for (let i = 0; i < rawBytes.length; i++) {
        if (rawBytes[i] === SYSEX_START) {
            startIdx = i;
        } else if (rawBytes[i] === SYSEX_END && startIdx >= 0) {
            const msg = rawBytes.subarray(startIdx, i + 1);
            if (validateSysEx(msg) > 0) {
                messages.push(normalizeProgram(msg));
            }
            startIdx = -1;
        }
    }
    return messages;
}

/**
 * Represents a single MicroMonsta 2 sound program (Firmware v3, 216 bytes)
 */
class MM2Program {
    constructor(sourceData = null) {
        this._data = new Uint8Array(SYSEX_V3_LEN);
        if (sourceData) {
            const norm = normalizeProgram(sourceData);
            if (norm) {
                this._data.set(norm);
            } else {
                this._data.set(INIT_PROGRAM_BYTES);
            }
        } else {
            this._data.set(INIT_PROGRAM_BYTES);
        }
        this._selected = false;
    }

    get rawData() {
        return this._data;
    }

    set rawData(bytes) {
        const norm = normalizeProgram(bytes);
        if (!norm) throw new Error('Invalid MicroMonsta 2 SysEx program data');
        this._data.set(norm);
    }

    get name() {
        const slice = this._data.subarray(OFFSET_NAME, OFFSET_NAME + 8);
        return new TextDecoder().decode(slice).trimEnd();
    }

    set name(str) {
        const clean = (str || '').padEnd(8, ' ').slice(0, 8);
        const encoded = new TextEncoder().encode(clean);
        this._data.set(encoded, OFFSET_NAME);
    }

    get category() {
        return this._data[OFFSET_CAT];
    }

    set category(catIndex) {
        this._data[OFFSET_CAT] = clamp(catIndex, 0, 15);
    }

    get selected() {
        return this._selected;
    }

    set selected(val) {
        this._selected = !!val;
    }

    getValue(key) {
        const def = PARAM_MAP.get(key);
        if (!def) throw new Error(`Unknown parameter key: "${key}"`);
        if (def.long) {
            return (this._data[def.sysEx] << 7) + this._data[def.sysEx + 1];
        }
        return this._data[def.sysEx];
    }

    setValue(key, value) {
        const def = PARAM_MAP.get(key);
        if (!def) throw new Error(`Unknown parameter key: "${key}"`);
        let min = def.min ?? 0;
        let max = def.max ?? (def.values ? def.values.length - 1 : 127);
        if (max < min) [min, max] = [max, min];
        const clamped = clamp(Math.round(value), min, max);

        if (def.long) {
            this._data[def.sysEx] = (clamped >> 7) & 127;
            this._data[def.sysEx + 1] = clamped & 127;
        } else {
            this._data[def.sysEx] = clamped & 127;
        }
    }

    /**
     * Serializes program to 216-byte SysEx Uint8Array ready for transmission or export
     * @param {number} targetLayer 0 for Layer A, 1 for Layer B, -1/default for Active Layer
     */
    toSysEx(targetLayer = -1) {
        const out = new Uint8Array(this._data);
        for (let i = 0; i < SYSEX_HEADER.length; i++) {
            out[i] = SYSEX_HEADER[i];
        }
        out[OFFSET_CMD] = targetLayer === 0 ? CMD_LOAD_A : (targetLayer === 1 ? CMD_LOAD_B : CMD_LOAD_ACTIVE);
        out[OFFSET_FW] = SYSEX_V3_FW_ID;
        out[SYSEX_V3_LEN - 1] = SYSEX_END;
        return out;
    }

    /**
     * Deep copy of this program
     */
    clone() {
        const copy = new MM2Program(this._data);
        copy.selected = this._selected;
        return copy;
    }

    /**
     * Computes a deterministic hexadecimal fingerprint of the sound parameters (bytes 16 to 214).
     * Two patches with identical sound parameter fingerprints will sound identical regardless of name.
     */
    computeSoundFingerprint() {
        const soundBytes = this._data.subarray(16, SYSEX_V3_LEN - 1);
        let hex = '';
        for (let i = 0; i < soundBytes.length; i++) {
            hex += soundBytes[i].toString(16).padStart(2, '0');
        }
        return hex;
    }

    /**
     * Full signature including name, category, and parameters
     */
    computeFullSignature() {
        return `${this.name}__${this.category}__${this.computeSoundFingerprint()}`;
    }

    /**
     * Checks if this program is an INIT/default program
     */
    isInit() {
        const initProg = new MM2Program(INIT_PROGRAM_BYTES);
        return this.computeSoundFingerprint() === initProg.computeSoundFingerprint();
    }
}

/**
 * Represents a Bank of MicroMonsta 2 programs with librarian tools:
 * - Drag-and-drop reordering
 * - Program swapping
 * - Duplicate detection & alerting
 * - Duplicate removal
 * - Bank condensation
 */
class MM2Bank {
    constructor(name = 'Bank 1', index = 0) {
        this.name = name;
        this.index = index;
        this.programs = [];
        this._isReceiving = false;
    }

    get length() {
        return this.programs.length;
    }

    get isReceiving() {
        return this._isReceiving;
    }

    set isReceiving(val) {
        this._isReceiving = !!val;
    }

    clear() {
        this.programs = [];
    }

    addProgram(program) {
        if (!(program instanceof MM2Program)) {
            program = new MM2Program(program);
        }
        this.programs.push(program);
        return this.programs.length - 1;
    }

    getProgram(index) {
        return this.programs[index] || null;
    }

    setProgram(index, program) {
        if (index >= 0 && index < this.programs.length) {
            this.programs[index] = program instanceof MM2Program ? program : new MM2Program(program);
        }
    }

    removeProgram(index) {
        if (index >= 0 && index < this.programs.length) {
            return this.programs.splice(index, 1)[0];
        }
        return null;
    }

    /**
     * Swaps two programs in the bank
     */
    swapPrograms(indexA, indexB) {
        if (
            indexA >= 0 && indexA < this.programs.length &&
            indexB >= 0 && indexB < this.programs.length
        ) {
            const temp = this.programs[indexA];
            this.programs[indexA] = this.programs[indexB];
            this.programs[indexB] = temp;
            return true;
        }
        return false;
    }

    /**
     * Moves a program from one position to another (reordering)
     */
    moveProgram(fromIndex, toIndex) {
        if (
            fromIndex >= 0 && fromIndex < this.programs.length &&
            toIndex >= 0 && toIndex < this.programs.length
        ) {
            const [item] = this.programs.splice(fromIndex, 1);
            this.programs.splice(toIndex, 0, item);
            return true;
        }
        return false;
    }

    sortByName(ascending = true) {
        this.programs.sort((a, b) => {
            const cmp = a.name.localeCompare(b.name);
            return ascending ? cmp : -cmp;
        });
    }

    sortByCategory(ascending = true) {
        this.programs.sort((a, b) => {
            const catDiff = a.category - b.category;
            if (catDiff !== 0) return ascending ? catDiff : -catDiff;
            return a.name.localeCompare(b.name);
        });
    }

    /**
     * Scans the bank for duplicate patches.
     * Returns:
     * {
     *   duplicatesFound: number,
     *   duplicateIndices: Set<number>, // Indices of items that are redundant duplicates
     *   groups: Array<{ key: string, programs: Array<{ index: number, program: MM2Program }> }>
     * }
     */
    detectDuplicates(soundOnly = true) {
        const groupMap = new Map();
        const duplicateIndices = new Set();
        let totalDuplicates = 0;

        for (let i = 0; i < this.programs.length; i++) {
            const p = this.programs[i];
            const key = soundOnly ? p.computeSoundFingerprint() : p.computeFullSignature();
            if (!groupMap.has(key)) {
                groupMap.set(key, [{ index: i, program: p }]);
            } else {
                const grp = groupMap.get(key);
                grp.push({ index: i, program: p });
                duplicateIndices.add(i);
                totalDuplicates++;
            }
        }

        const groups = [];
        for (const [key, list] of groupMap.entries()) {
            if (list.length > 1) {
                groups.push({ key, entries: list });
            }
        }

        return {
            duplicatesFound: totalDuplicates,
            duplicateIndices,
            groups
        };
    }

    /**
     * Removes duplicate patches.
     * @param {boolean} soundOnly If true, treats patches with identical sound parameters as duplicates
     * @returns {number} count of removed duplicates
     */
    removeDuplicates(soundOnly = true) {
        const seen = new Set();
        const kept = [];
        let removed = 0;

        for (let i = 0; i < this.programs.length; i++) {
            const p = this.programs[i];
            const key = soundOnly ? p.computeSoundFingerprint() : p.computeFullSignature();
            if (seen.has(key)) {
                removed++;
            } else {
                seen.add(key);
                kept.push(p);
            }
        }
        this.programs = kept;
        return removed;
    }

    /**
     * Condenses the bank by removing duplicate patches and (optionally) INIT patches,
     * consolidating remaining patches into a contiguous bank.
     * @param {Object} options { removeDuplicates: true, removeInits: false }
     */
    condenseBank(options = { removeDuplicates: true, removeInits: false }) {
        let removedDuplicates = 0;
        if (options.removeDuplicates) {
            removedDuplicates = this.removeDuplicates(true);
        }
        let removedInits = 0;
        if (options.removeInits) {
            const nonInit = this.programs.filter(p => !p.isInit());
            removedInits = this.programs.length - nonInit.length;
            this.programs = nonInit;
        }
        return {
            removedDuplicates,
            removedInits,
            finalCount: this.programs.length
        };
    }

    /**
     * Serializes all programs into a single concatenated SysEx Uint8Array
     */
    toBankSysEx() {
        const total = this.programs.length * SYSEX_V3_LEN;
        const out = new Uint8Array(total);
        for (let i = 0; i < this.programs.length; i++) {
            out.set(this.programs[i].toSysEx(), i * SYSEX_V3_LEN);
        }
        return out;
    }

    /**
     * Populates bank from raw .syx byte buffer (single or multi-patch)
     * Returns count of imported patches
     */
    loadFromSysEx(buffer) {
        const msgs = extractSysExMessages(buffer);
        let count = 0;
        for (const msg of msgs) {
            this.addProgram(new MM2Program(msg));
            count++;
        }
        return count;
    }
}
