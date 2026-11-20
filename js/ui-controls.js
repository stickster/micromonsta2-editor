/**
 * UI Controls for MicroMonsta 2 Editor
 * - Custom Rotary Knobs (SVG Arc, Dual-axis Drag & Wheel, Double/Right-click reset, Fine Shift, Click-to-Type, Keyboard Stepping)
 * - Select Dropdowns
 * - Interactive Real-Time Visualizers:
 *     * ADSR Envelope Curves (SVG)
 *     * Filter Frequency Response Curves (SVG)
 *     * LFO Waveform Previews (SVG)
 * - Section Drag-and-Drop Copying & Section Clipboard Menu (Copy, Paste, Reset, Smart Randomize)
 * - 16-Step Arpeggiator / Pattern Sequencer
 * - Interactive Audition Keyboard (Mouse, Touch, and Computer Keyboard QWERTY playback)
 */

// Single-Color Line-Drawing SVG Icons for UI Actions
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v !== undefined && v !== null) {
            el.setAttribute(k, String(v));
        }
    }
    return el;
}

function svgIcon(inner) {
    return `<svg class="icon-line" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

const ICON_COPY_SVG = svgIcon('<rect x="5" y="5" width="9" height="9" rx="1.5"></rect><path d="M11 2.5H3.5A1.5 1.5 0 0 0 2 4v7.5"></path>');
const ICON_PASTE_SVG = svgIcon('<path d="M5.5 3H4a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 4 15h8a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 12 3h-1.5"></path><rect x="5.5" y="1" width="5" height="3" rx="1"></rect><path d="M8 7v5M5.5 9.5 8 12l2.5-2.5"></path>');
const ICON_RANDOM_SVG = svgIcon('<path d="M2 13h3.5l5-10H14M11.5 3H14v2.5M2 3h3.5l1.5 3M9 10l1.5 3H14M11.5 13H14v-2.5"></path>');
const ICON_RESET_SVG = svgIcon('<path d="M2.5 7.5A5.5 5.5 0 1 1 4 11.5"></path><path d="M2.5 3.5v4h4"></path>');

/**
 * Resolves a program reference which can be either an MM2Program instance or a dynamic provider function
 */
function resolveProgram(program) {
    return typeof program === 'function' ? program() : program;
}

function createVisualizerBox(className, title, viewBox, dataAttr) {
    const container = document.createElement('div');
    container.className = `visualizer-box ${className}`;
    container.title = title;
    if (dataAttr) {
        container.setAttribute(dataAttr[0], dataAttr[1]);
    }
    const svg = svgEl('svg', { viewBox, class: 'visualizer-svg' });
    container.appendChild(svg);
    return { container, svg };
}

function createSvgGradient(id, topOpacity, botOpacity) {
    const defs = svgEl('defs');
    const grad = svgEl('linearGradient', { id, x1: '0%', y1: '0%', x2: '0%', y2: '100%' });
    grad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': 'var(--accent-cyan)', 'stop-opacity': topOpacity }));
    grad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': 'var(--accent-cyan)', 'stop-opacity': botOpacity }));
    defs.appendChild(grad);
    return defs;
}

function withChangeGroup(onChangeCallback, label, fn) {
    if (onChangeCallback && typeof onChangeCallback.beginGroup === 'function') {
        onChangeCallback.beginGroup(label);
    }
    try {
        return fn();
    } finally {
        if (onChangeCallback && typeof onChangeCallback.endGroup === 'function') {
            onChangeCallback.endGroup();
        }
    }
}

function getParamBounds(def) {
    const min = def.min ?? 0;
    const max = def.max ?? (def.values ? def.values.length - 1 : 127);
    const range = Math.max(1, Math.abs(max - min));
    return { min, max, range };
}

function toDisplayNumber(def, val) {
    if (!def) return val;
    if (def.displayOffset) return val + def.displayOffset;
    if (def.offset && def.offset > 0) return val - def.offset;
    return val;
}

function fromDisplayNumber(def, num) {
    if (!def) return num;
    if (def.displayOffset) return num - def.displayOffset;
    if (def.offset && def.offset > 0) return num + def.offset;
    return num;
}

function initParamControl(paramKey, program, className) {
    const def = PARAM_MAP.get(paramKey);
    const container = document.createElement('div');
    const getProg = () => resolveProgram(program);
    if (!def) {
        return { def: null, container, getProg };
    }
    container.className = className;
    container.setAttribute('data-param', paramKey);
    return { def, container, getProg };
}

function commitParamValue(getProg, paramKey, val, cb, meta = { isFinal: true }) {
    const prog = getProg();
    const prevVal = prog ? prog.getValue(paramKey) : val;
    if (prog) {
        prog.setValue(paramKey, val);
    }
    if (cb) cb(paramKey, val, { prevVal, ...meta });
    return prevVal;
}

function bindResetActions(el, resetFn, isDisabledFn) {
    el.addEventListener('dblclick', (e) => {
        if (isDisabledFn && isDisabledFn()) return;
        e.preventDefault();
        resetFn();
    });
    el.addEventListener('contextmenu', (e) => {
        if (isDisabledFn && isDisabledFn()) return;
        e.preventDefault();
        resetFn();
    });
}

function createDebouncedCommitter(getProg, paramKey, onChangeCallback, delayMs = 350) {
    let timer = null;
    let startVal = null;
    return {
        begin(curVal) {
            if (startVal === null) startVal = curVal;
            return startVal;
        },
        schedule() {
            clearTimeout(timer);
            timer = setTimeout(() => {
                const prog = getProg();
                const finalVal = prog ? prog.getValue(paramKey) : startVal;
                if (startVal !== null && finalVal !== startVal && onChangeCallback) {
                    onChangeCallback(paramKey, finalVal, { isFinal: true, prevVal: startVal });
                }
                startVal = null;
            }, delayMs);
        }
    };
}

function startWindowPointerDrag(onMove, onEnd) {
    if (typeof window === 'undefined') return;
    const finish = (e) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
        onEnd(e);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
}

function attachInlineValueEditor({
    triggerEl,
    def,
    min,
    max,
    getProg,
    paramKey,
    onChangeCallback,
    refresh,
    inputClassName,
    inputType = 'text',
    shouldOpen
}) {
    triggerEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (shouldOpen && !shouldOpen(e)) return;
        if (triggerEl.querySelector('input')) return;

        const prog = getProg();
        const defaultFallback = def.default ?? min;
        const initialVal = prog ? prog.getValue(paramKey) : defaultFallback;

        const input = document.createElement('input');
        input.type = inputType;
        input.className = inputClassName;
        if (inputType === 'number') {
            input.min = toDisplayNumber(def, min);
            input.max = toDisplayNumber(def, max);
        }
        input.value = String(toDisplayNumber(def, initialVal));

        triggerEl.textContent = '';
        triggerEl.appendChild(input);
        if (input.focus) input.focus();
        if (input.select) input.select();

        let committed = false;
        const closeInput = () => {
            if (input.parentNode === triggerEl && triggerEl.removeChild) {
                triggerEl.removeChild(input);
            } else {
                triggerEl.innerHTML = '';
            }
            refresh();
        };

        const commit = () => {
            if (committed) return;
            committed = true;
            const parsedNum = parseInt(input.value.trim(), 10);
            if (!isNaN(parsedNum)) {
                const targetVal = Math.min(max, Math.max(min, fromDisplayNumber(def, parsedNum)));
                const currentProg = getProg();
                if (currentProg && targetVal !== initialVal) {
                    currentProg.setValue(paramKey, targetVal);
                    if (onChangeCallback) onChangeCallback(paramKey, targetVal, { isFinal: true, prevVal: initialVal });
                }
            }
            closeInput();
        };

        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                commit();
            } else if (ev.key === 'Escape') {
                ev.preventDefault();
                committed = true;
                const currentProg = getProg();
                if (currentProg && currentProg.getValue(paramKey) !== initialVal) {
                    currentProg.setValue(paramKey, initialVal);
                    if (onChangeCallback) onChangeCallback(paramKey, initialVal, { isInterim: true, prevVal: initialVal });
                }
                closeInput();
            } else if (inputType === 'text' && ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'Home', 'End'].includes(ev.key)) {
                ev.preventDefault();
                ev.stopPropagation();
                const currentProg = getProg();
                const cur = currentProg ? currentProg.getValue(paramKey) : initialVal;
                let nextVal;
                if (ev.key === 'Home') {
                    nextVal = min;
                } else if (ev.key === 'End') {
                    nextVal = max;
                } else {
                    const delta = (ev.key === 'ArrowUp' || ev.key === 'ArrowRight') ? 1 : -1;
                    nextVal = Math.min(Math.max(cur + delta, min), max);
                }
                if (currentProg && nextVal !== cur) {
                    currentProg.setValue(paramKey, nextVal);
                    if (onChangeCallback) onChangeCallback(paramKey, nextVal, { isInterim: true, prevVal: initialVal });
                    refresh();
                }
                input.value = String(toDisplayNumber(def, nextVal));
                if (input.select) input.select();
            } else if (inputType === 'text') {
                const allowsNegative = toDisplayNumber(def, min) < 0;
                const isAllowedChar = ev.key === '-' ? allowsNegative : /^[0-9+]$/.test(ev.key);
                if (!ev.ctrlKey && !ev.metaKey && !['Backspace', 'Delete', 'Tab'].includes(ev.key) && !isAllowedChar) {
                    ev.preventDefault();
                }
            }
        });
        input.addEventListener('blur', commit);
    });
}

function createToggleButtonElement({ label, title, className = 'btn-param-toggle', id, showStateBadge = true, initialOn = false }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    if (id) button.id = id;
    if (title) button.title = title;

    const labelSpan = document.createElement('span');
    labelSpan.className = 'toggle-label';
    labelSpan.textContent = label;
    button.appendChild(labelSpan);

    let stateSpan = null;
    if (showStateBadge) {
        stateSpan = document.createElement('span');
        stateSpan.className = 'toggle-state-badge';
        button.appendChild(stateSpan);
    }

    const setOn = (isOn) => {
        const active = !!isOn;
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
        button.classList.toggle('active', active);
        if (stateSpan) stateSpan.textContent = active ? 'ON' : 'OFF';
    };
    setOn(initialOn);

    return { button, stateSpan, setOn };
}

// Section definitions for modular copying, clipboard, and smart randomization
const SECTION_DEFINITIONS = {
    osc: {
        title: 'Oscillator',
        count: 3,
        getParams: (idx) => ({
            algo: `OSC${idx}_ALGO`,
            shape: `OSC${idx}_SHAPE`,
            tune: `OSC${idx}_TUNE`,
            finetune: `OSC${idx}_FINETUNE`,
            mix: `MIX_OSC${idx}`
        }),
        randomize: (program, idx) => {
            const maxAlgo = idx === 1 ? 15 : 19;
            return {
                [`OSC${idx}_ALGO`]: Math.floor(Math.random() * (maxAlgo + 1)),
                [`OSC${idx}_SHAPE`]: Math.floor(Math.random() * 128),
                [`OSC${idx}_TUNE`]: 64 + (Math.floor(Math.random() * 5) - 2) * 12,
                [`OSC${idx}_FINETUNE`]: 64 + Math.floor(Math.random() * 11) - 5,
                [`MIX_OSC${idx}`]: Math.floor(Math.random() * 64) + 64
            };
        }
    },
    env: {
        title: 'Envelope',
        count: 3,
        getParams: (idx) => {
            const p = {
                atk: `ENV${idx}_ATK`,
                dcy: `ENV${idx}_DCY`,
                sus: `ENV${idx}_SUS`,
                rel: `ENV${idx}_REL`,
                reset: `ENV${idx}_RESET`
            };
            if (idx === 1) p.vel = 'ENV1_VCA_VEL_SENS';
            if (idx === 2) p.vel = 'ENV2_FLT_VEL_SENS';
            return p;
        },
        randomize: (program, idx) => {
            const res = {
                [`ENV${idx}_ATK`]: Math.floor(Math.random() * 70),
                [`ENV${idx}_DCY`]: Math.floor(Math.random() * 90) + 10,
                [`ENV${idx}_SUS`]: Math.floor(Math.random() * 128),
                [`ENV${idx}_REL`]: Math.floor(Math.random() * 90) + 10,
                [`ENV${idx}_RESET`]: Math.random() > 0.5 ? 1 : 0
            };
            if (idx === 1) res.ENV1_VCA_VEL_SENS = Math.floor(Math.random() * 90);
            if (idx === 2) res.ENV2_FLT_VEL_SENS = Math.floor(Math.random() * 90);
            return res;
        }
    },
    lfo: {
        title: 'LFO',
        count: 3,
        getParams: (idx) => ({
            wave: `LFO${idx}_WAVE`,
            speed: `LFO${idx}_SPEED`,
            mode: `LFO${idx}_MODE`
        }),
        randomize: (program, idx) => ({
            [`LFO${idx}_WAVE`]: Math.floor(Math.random() * 19),
            [`LFO${idx}_SPEED`]: Math.floor(Math.random() * 80) + 20,
            [`LFO${idx}_MODE`]: Math.floor(Math.random() * 4)
        })
    },
    flt: {
        title: 'Filter',
        count: 1,
        getParams: () => ({
            algo: 'FILTER_ALGO',
            freq: 'FILTER_FREQ',
            reso: 'FILTER_RESO',
            env2: 'FILTER_ENV2',
            track: 'FILTER_TRACKING',
            fm: 'FILTER_FM',
            char: 'FILTER_CHARACTER'
        }),
        randomize: () => ({
            FILTER_ALGO: Math.floor(Math.random() * 8),
            FILTER_FREQ: Math.floor(Math.random() * 210) + 30,
            FILTER_RESO: Math.floor(Math.random() * 85),
            FILTER_ENV2: Math.floor(Math.random() * 120) + 68,
            FILTER_TRACKING: Math.floor(Math.random() * 100),
            FILTER_FM: Math.floor(Math.random() * 50)
        })
    },
    mtx: {
        title: 'Mod Matrix Slot',
        count: 12,
        getParams: (idx) => ({
            src: `MTX${idx}_SRC`,
            dst: `MTX${idx}_DST`,
            amt: `MTX${idx}_AMT`
        }),
        randomize: (program, idx) => ({
            [`MTX${idx}_SRC`]: Math.floor(Math.random() * 44) + 1,
            [`MTX${idx}_DST`]: Math.floor(Math.random() * 44) + 1,
            [`MTX${idx}_AMT`]: 128 + (Math.floor(Math.random() * 140) - 70)
        })
    },
    mult: {
        title: 'Multiplier',
        count: 2,
        getParams: (idx) => ({
            a: `MULT_A${idx}`,
            b: `MULT_B${idx}`
        }),
        randomize: (program, idx) => ({
            [`MULT_A${idx}`]: Math.floor(Math.random() * 45),
            [`MULT_B${idx}`]: Math.floor(Math.random() * 45)
        })
    },
    arp_step: {
        title: 'Sequencer Step',
        count: 16,
        getParams: (idx) => {
            const numStr = idx.toString().padStart(2, '0');
            return {
                mode: `ARP_PTN_STEP${numStr}`,
                mod: `ARP_PTN_STEP_MOD${numStr}`
            };
        }
    },
    fx: {
        title: 'Effects & EQ',
        count: 1,
        getParams: () => ({
            dlyType: 'DLY_TYPE',
            dlyTime: 'DLY_PARAM1',
            dlyFeed: 'DLY_PARAM2',
            dlySend: 'DLY_PARAM3',
            revDecay: 'REV_PARAM1',
            revMod: 'REV_PARAM2',
            revSend: 'REV_PARAM3',
            chorus: 'IFX_CHORUS',
            eq: 'IFX_EQ',
            morph: 'MORPH_KNOB'
        }),
        randomize: () => ({
            DLY_TYPE: Math.floor(Math.random() * 5),
            DLY_PARAM1: Math.floor(Math.random() * 135),
            DLY_PARAM2: Math.floor(Math.random() * 80) + 15,
            DLY_PARAM3: Math.floor(Math.random() * 70),
            REV_PARAM1: Math.floor(Math.random() * 90) + 20,
            REV_PARAM2: Math.floor(Math.random() * 80),
            REV_PARAM3: Math.floor(Math.random() * 70),
            IFX_CHORUS: Math.floor(Math.random() * 4),
            IFX_EQ: 128 + Math.floor(Math.random() * 40) - 20
        })
    },
    lfo_group: {
        title: 'Low Frequency Oscillators (1–3)',
        count: 1,
        getParams: () => ({
            wave1: 'LFO1_WAVE', speed1: 'LFO1_SPEED', mode1: 'LFO1_MODE',
            wave2: 'LFO2_WAVE', speed2: 'LFO2_SPEED', mode2: 'LFO2_MODE',
            wave3: 'LFO3_WAVE', speed3: 'LFO3_SPEED', mode3: 'LFO3_MODE'
        }),
        randomize: () => {
            const res = {};
            for (let l = 1; l <= 3; l++) {
                res[`LFO${l}_WAVE`] = Math.floor(Math.random() * 19);
                res[`LFO${l}_SPEED`] = Math.floor(Math.random() * 80) + 20;
                res[`LFO${l}_MODE`] = Math.floor(Math.random() * 4);
            }
            return res;
        }
    },
    mtx_group: {
        title: 'Modulation Matrix (12 Slots)',
        count: 1,
        getParams: () => {
            const p = {};
            for (let m = 1; m <= 12; m++) {
                p[`src${m}`] = `MTX${m}_SRC`;
                p[`dst${m}`] = `MTX${m}_DST`;
                p[`amt${m}`] = `MTX${m}_AMT`;
            }
            return p;
        },
        randomize: () => {
            const res = {};
            for (let m = 1; m <= 12; m++) {
                res[`MTX${m}_SRC`] = Math.floor(Math.random() * 44) + 1;
                res[`MTX${m}_DST`] = Math.floor(Math.random() * 44) + 1;
                res[`MTX${m}_AMT`] = 128 + (Math.floor(Math.random() * 140) - 70);
            }
            return res;
        }
    }
};

let currentSectionClipboard = null;

function getSectionClipboard() {
    return currentSectionClipboard;
}

function copySectionToClipboard(sectionType, sectionIndex, program) {
    program = resolveProgram(program);
    const def = SECTION_DEFINITIONS[sectionType];
    if (!def || !program) return null;
    const params = def.getParams(sectionIndex);
    const data = {};
    for (const [role, paramKey] of Object.entries(params)) {
        data[role] = program.getValue(paramKey);
    }
    currentSectionClipboard = {
        sectionType,
        sourceIndex: sectionIndex,
        data,
        timestamp: Date.now()
    };
    return currentSectionClipboard;
}

function pasteSectionFromClipboard(targetType, targetIndex, program, onChangeCallback) {
    program = resolveProgram(program);
    if (!program || !currentSectionClipboard || currentSectionClipboard.sectionType !== targetType) return false;
    const def = SECTION_DEFINITIONS[targetType];
    if (!def) return false;
    const dstParams = def.getParams(targetIndex);

    withChangeGroup(onChangeCallback, `Paste ${targetType.toUpperCase()} ${targetIndex}`, () => {
        for (const [role, val] of Object.entries(currentSectionClipboard.data)) {
            const dstKey = dstParams[role];
            if (dstKey) {
                let clampedVal = val;
                if (targetType === 'osc' && role === 'algo' && targetIndex === 1 && clampedVal > 15) {
                    clampedVal = 15;
                }
                const prevVal = program.getValue(dstKey);
                program.setValue(dstKey, clampedVal);
                if (onChangeCallback) onChangeCallback(dstKey, clampedVal, { isFinal: true, prevVal });
            }
        }
    });
    return true;
}

function copySection(sourceType, sourceIndex, targetType, targetIndex, program, onChangeCallback) {
    program = resolveProgram(program);
    if (!program || sourceType !== targetType) return false;
    const def = SECTION_DEFINITIONS[sourceType];
    if (!def) return false;

    const srcParams = def.getParams(sourceIndex);
    const dstParams = def.getParams(targetIndex);

    withChangeGroup(onChangeCallback, `Copy ${sourceType.toUpperCase()} ${sourceIndex}->${targetIndex}`, () => {
        for (const [role, srcKey] of Object.entries(srcParams)) {
            const dstKey = dstParams[role];
            if (dstKey && srcKey) {
                let val = program.getValue(srcKey);
                if (sourceType === 'osc' && role === 'algo' && targetIndex === 1 && val > 15) {
                    val = 15;
                }
                const prevVal = program.getValue(dstKey);
                program.setValue(dstKey, val);
                if (onChangeCallback) onChangeCallback(dstKey, val, { isFinal: true, prevVal });
            }
        }
    });
    return true;
}

function resetSectionToInit(sectionType, sectionIndex, program, onChangeCallback) {
    program = resolveProgram(program);
    const def = SECTION_DEFINITIONS[sectionType];
    if (!def || !program) return;
    const params = def.getParams(sectionIndex);
    const initProgram = (sectionType === 'mtx_group' && typeof MM2Program !== 'undefined') ? new MM2Program() : null;

    withChangeGroup(onChangeCallback, `Reset ${sectionType.toUpperCase()} ${sectionIndex}`, () => {
        for (const paramKey of Object.values(params)) {
            const pDef = PARAM_MAP.get(paramKey);
            if (pDef) {
                const defVal = initProgram ? initProgram.getValue(paramKey) : (pDef.default ?? 0);
                const prevVal = program.getValue(paramKey);
                program.setValue(paramKey, defVal);
                if (onChangeCallback) onChangeCallback(paramKey, defVal, { isFinal: true, prevVal });
            }
        }
    });
}

function randomizeSection(sectionType, sectionIndex, program, onChangeCallback) {
    program = resolveProgram(program);
    const def = SECTION_DEFINITIONS[sectionType];
    if (!def || !def.randomize || !program) return;
    const randomized = def.randomize(program, sectionIndex);

    withChangeGroup(onChangeCallback, `Randomize ${sectionType.toUpperCase()} ${sectionIndex}`, () => {
        for (const [paramKey, val] of Object.entries(randomized)) {
            const prevVal = program.getValue(paramKey);
            program.setValue(paramKey, val);
            if (onChangeCallback) onChangeCallback(paramKey, val, { isFinal: true, prevVal });
        }
    });
}

const KNOB_START_RAD = (135 * Math.PI) / 180;
const KNOB_END_RAD = (405 * Math.PI) / 180;
const KNOB_SPAN_RAD = (270 * Math.PI) / 180;
const KNOB_CENTER_RAD = (270 * Math.PI) / 180;

function drawKnobCanvas(canvas, ctx, { val, min, range, isLarge, isSmall, isBipolar, isActive, color }) {
    if (!ctx) return;
    const clampedNorm = Math.min(Math.max((val - min) / range, 0), 1);
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const trackWidth = isLarge ? 6 : (isSmall ? 4.5 : 5);
    const r = (w / 2) - 8;

    ctx.clearRect(0, 0, w, h);

    // 1. Flat Matte Inner Disc (high-contrast backdrop for centered readout)
    const discR = Math.max(4, r - trackWidth - 2);
    ctx.beginPath();
    ctx.arc(cx, cy, discR, 0, Math.PI * 2);
    ctx.fillStyle = '#191c23';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 2. Outer Track Arc (from 135 deg to 405 deg, 270 deg span)
    const curRad = KNOB_START_RAD + clampedNorm * KNOB_SPAN_RAD;
    ctx.lineWidth = trackWidth;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#252a35';
    ctx.beginPath();
    ctx.arc(cx, cy, r, KNOB_START_RAD, KNOB_END_RAD, false);
    ctx.stroke();

    // 3. Active Gauge Arc (Audiothingies orange #f76d22 or cyan for bipolar / mod)
    const gaugeColor = color || (isBipolar ? '#00d2ff' : '#f76d22');
    ctx.strokeStyle = gaugeColor;

    if (isBipolar) {
        ctx.beginPath();
        ctx.arc(cx + Math.cos(KNOB_CENTER_RAD) * r, cy + Math.sin(KNOB_CENTER_RAD) * r, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = '#525b6e';
        ctx.fill();

        if (Math.abs(curRad - KNOB_CENTER_RAD) > 0.02) {
            ctx.beginPath();
            ctx.arc(cx, cy, r, Math.min(KNOB_CENTER_RAD, curRad), Math.max(KNOB_CENTER_RAD, curRad), false);
            ctx.stroke();
        }
    } else if (clampedNorm > 0.01) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, KNOB_START_RAD, curRad, false);
        ctx.stroke();
    }

    // 4. Highlight Dot on Colored Ring at Current Value
    const dotX = cx + Math.cos(curRad) * r;
    const dotY = cy + Math.sin(curRad) * r;
    const dotR = isActive
        ? (isLarge ? 5.5 : (isSmall ? 4.2 : 4.8))
        : (isLarge ? 4.5 : (isSmall ? 3.5 : 4.0));

    if (ctx.save) ctx.save();
    ctx.shadowColor = gaugeColor;
    ctx.shadowBlur = isActive ? 12 : 6;
    ctx.beginPath();
    ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = gaugeColor;
    ctx.stroke();
    if (ctx.restore) ctx.restore();
}

function attachKnobPointerDrag({
    container,
    canvas,
    valueEl,
    dialWrap,
    paramKey,
    bounds,
    getProg,
    onChangeCallback,
    drawKnob,
    resetToDefault,
    isDisabled,
    setSuppressNextClick
}) {
    const { min, max, range } = bounds;
    let startX = 0;
    let startY = 0;
    let startVal = 0;
    let isDragging = false;
    let hasDragged = false;

    const onPointerMove = (e) => {
        if (!isDragging) return;
        if (!hasDragged && Math.hypot(e.clientX - startX, e.clientY - startY) > 3) {
            hasDragged = true;
        }
        const delta = (startY - e.clientY) + (e.clientX - startX);
        const sensitivity = (e.shiftKey || e.ctrlKey) ? 0.001 : 0.005;
        const newVal = Math.min(Math.max(Math.round(startVal + delta * sensitivity * range), min), max);

        const prog = getProg();
        if (prog && newVal !== prog.getValue(paramKey)) {
            prog.setValue(paramKey, newVal);
            drawKnob();
            if (onChangeCallback) onChangeCallback(paramKey, newVal, { isInterim: true, prevVal: startVal });
        }
    };

    const onPointerUp = () => {
        if (!isDragging) return;
        isDragging = false;
        if (hasDragged) {
            setSuppressNextClick(true);
            setTimeout(() => setSuppressNextClick(false), 0);
        }
        dialWrap.classList.remove('active');
        drawKnob();

        const prog = getProg();
        const finalVal = prog ? prog.getValue(paramKey) : startVal;
        if (finalVal !== startVal && onChangeCallback) {
            onChangeCallback(paramKey, finalVal, { isFinal: true, prevVal: startVal });
        }
        if (typeof container.blur === 'function') container.blur();
    };

    const onPointerDown = (e) => {
        if (isDisabled() || e.button === 2) return;
        if (e.target && e.target.tagName === 'INPUT') return;
        if (typeof document !== 'undefined' && document.activeElement &&
            document.activeElement.classList && document.activeElement.classList.contains('knob-value-input') &&
            document.activeElement !== e.target) {
            document.activeElement.blur();
        }
        e.preventDefault();
        if (e.altKey && e.button === 0) {
            setSuppressNextClick(true);
            setTimeout(() => setSuppressNextClick(false), 0);
            resetToDefault();
            return;
        }
        startX = e.clientX;
        startY = e.clientY;
        const prog = getProg();
        startVal = prog ? prog.getValue(paramKey) : 0;
        isDragging = true;
        hasDragged = false;
        dialWrap.classList.add('active');
        drawKnob();
        startWindowPointerDrag(onPointerMove, onPointerUp);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    valueEl.addEventListener('pointerdown', onPointerDown);
}

function attachDebouncedStepping({ container, valueEl, paramKey, bounds, getProg, onChangeCallback, drawKnob, isDisabled }) {
    const { min, max, range } = bounds;
    const wheelCommitter = createDebouncedCommitter(getProg, paramKey, onChangeCallback);
    const keyCommitter = createDebouncedCommitter(getProg, paramKey, onChangeCallback);

    container.addEventListener('wheel', (e) => {
        if (isDisabled()) return;
        e.preventDefault();
        const step = (e.shiftKey || e.ctrlKey) ? 1 : Math.max(1, Math.round(range / 64));
        const dir = e.deltaY < 0 ? 1 : -1;
        const prog = getProg();
        if (prog) {
            const cur = prog.getValue(paramKey);
            const startVal = wheelCommitter.begin(cur);
            const newVal = Math.min(Math.max(cur + dir * step, min), max);
            if (newVal !== cur) {
                prog.setValue(paramKey, newVal);
                drawKnob();
                if (onChangeCallback) onChangeCallback(paramKey, newVal, { isInterim: true, prevVal: startVal });
            }
            wheelCommitter.schedule();
        }
        if (typeof container.blur === 'function') container.blur();
    }, { passive: false });

    container.addEventListener('keydown', (e) => {
        if (isDisabled()) return;
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
        if (valueEl.querySelector('input')) return;
        const prog = getProg();
        if (!prog) return;

        let delta = 0;
        if (['ArrowUp', 'ArrowRight', '+', '='].includes(e.key)) delta = 1;
        else if (['ArrowDown', 'ArrowLeft', '-', '_'].includes(e.key)) delta = -1;

        if (delta !== 0) {
            e.preventDefault();
            const cur = prog.getValue(paramKey);
            const startVal = keyCommitter.begin(cur);
            const newVal = Math.min(max, Math.max(min, cur + delta));
            if (newVal !== cur) {
                prog.setValue(paramKey, newVal);
                drawKnob();
                if (onChangeCallback) onChangeCallback(paramKey, newVal, { isInterim: true, prevVal: startVal });
                keyCommitter.schedule();
            }
        } else if (e.key === 'Home' || e.key === 'End') {
            e.preventDefault();
            const target = e.key === 'Home' ? min : max;
            const cur = prog.getValue(paramKey);
            if (cur !== target) {
                commitParamValue(getProg, paramKey, target, onChangeCallback, { isFinal: true, prevVal: cur });
                drawKnob();
            }
        }
    });
}

/**
 * Creates an interactive rotary knob element
 */
function createKnob(paramKey, program, onChangeCallback, opts = {}) {
    const { def, container, getProg } = initParamControl(paramKey, program, '');
    if (!def) {
        console.warn(`Cannot create knob for unknown parameter: ${paramKey}`);
        container.textContent = paramKey;
        return container;
    }

    const isLarge = !!opts.large;
    const isSmall = !!opts.small;
    container.className = `knob-container ${isLarge ? 'knob-large' : ''} ${isSmall ? 'knob-small' : ''}`;
    container.setAttribute('tabindex', '0');
    container.title = `${def.title || def.label || paramKey} (Default: ${formatParamDisplay(def, def.default ?? 0)}) • Double-click/Right-click/Alt/Opt-click to reset • Click value to type`;

    const bounds = getParamBounds(def);
    const { min, max, range } = bounds;
    // Offset-based params only draw from center when the offset lies inside the range.
    // Ranges that end at the offset (e.g. -12..0 pitch bend down) behave like unipolar knobs.
    const offsetIsRelative = !!(def.offset && def.offset >= max);
    const isBipolar = (min < 0) || (def.offset && def.offset > 0 && !offsetIsRelative);

    const dialWrap = document.createElement('div');
    dialWrap.className = 'knob-dial';

    const size = isLarge ? 58 : (isSmall ? 38 : 44);
    const canvas = document.createElement('canvas');
    canvas.className = 'knob-canvas';
    canvas.width = size * 2; // 2x Retina resolution
    canvas.height = size * 2;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    dialWrap.appendChild(canvas);

    const labelEl = document.createElement('div');
    labelEl.className = 'knob-label';
    labelEl.textContent = def.label || paramKey;

    const valueEl = document.createElement('div');
    valueEl.className = 'knob-value editable';
    valueEl.title = 'Click to enter exact value';
    dialWrap.appendChild(valueEl);

    container.appendChild(dialWrap);
    container.appendChild(labelEl);

    const ctx = canvas.getContext ? canvas.getContext('2d') : null;

    function drawKnob() {
        const prog = getProg();
        const val = prog ? prog.getValue(paramKey) : (def.default ?? 0);
        drawKnobCanvas(canvas, ctx, {
            val,
            min,
            range,
            isLarge,
            isSmall,
            isBipolar,
            isActive: dialWrap.classList.contains('active'),
            color: opts.color
        });
        if (!valueEl.querySelector('input')) {
            valueEl.textContent = formatParamDisplay(def, val);
        }
    }

    let isDisabled = false;
    let suppressNextClick = false;

    function resetToDefault() {
        const defVal = def.default ?? (isBipolar ? (def.offset ?? min) : min);
        const prog = getProg();
        if (prog && prog.getValue(paramKey) !== defVal) {
            commitParamValue(getProg, paramKey, defVal, onChangeCallback);
            drawKnob();
        }
        if (typeof container.blur === 'function') container.blur();
    }

    attachKnobPointerDrag({
        container,
        canvas,
        valueEl,
        dialWrap,
        paramKey,
        bounds,
        getProg,
        onChangeCallback,
        drawKnob,
        resetToDefault,
        isDisabled: () => isDisabled,
        setSuppressNextClick: (v) => { suppressNextClick = v; }
    });

    attachDebouncedStepping({
        container,
        valueEl,
        paramKey,
        bounds,
        getProg,
        onChangeCallback,
        drawKnob,
        isDisabled: () => isDisabled
    });

    bindResetActions(container, resetToDefault, () => isDisabled);

    attachInlineValueEditor({
        triggerEl: valueEl,
        def,
        min,
        max,
        getProg,
        paramKey,
        onChangeCallback,
        refresh: drawKnob,
        inputClassName: 'knob-value-input',
        inputType: 'text',
        shouldOpen: (e) => {
            if (isDisabled) return false;
            if (suppressNextClick) {
                suppressNextClick = false;
                return false;
            }
            if (e.altKey) {
                resetToDefault();
                return false;
            }
            return true;
        }
    });

    container.setDisabled = (disabled) => {
        isDisabled = !!disabled;
        container.classList.toggle('is-disabled', isDisabled);
        container.setAttribute('aria-disabled', isDisabled ? 'true' : 'false');
        container.setAttribute('tabindex', isDisabled ? '-1' : '0');
        valueEl.classList.toggle('editable', !isDisabled);
    };

    container.refresh = drawKnob;
    drawKnob();

    return container;
}

/**
 * Creates a toggle button bound to a binary On/Off parameter
 */
function createToggleButton(paramKey, program, onChangeCallback) {
    const { def, container, getProg } = initParamControl(paramKey, program, 'toggle-container');
    if (!def) return container;

    const { button, setOn } = createToggleButtonElement({
        label: def.label || paramKey,
        title: `${def.title || def.label || paramKey} (Click to toggle)`,
        showStateBadge: true
    });

    function updateVisual() {
        const prog = getProg();
        if (prog) {
            setOn(prog.getValue(paramKey) === 1);
        }
    }

    button.addEventListener('click', (e) => {
        e.preventDefault();
        const prog = getProg();
        if (prog) {
            const next = prog.getValue(paramKey) === 1 ? 0 : 1;
            commitParamValue(getProg, paramKey, next, onChangeCallback);
            updateVisual();
        }
        if (typeof button.blur === 'function') button.blur();
    });

    container.appendChild(button);
    container.refresh = updateVisual;
    updateVisual();

    return container;
}

function renderBipolarFill(fillBar, val, min, max, center) {
    const diff = val - center;
    if (diff > 0) {
        const widthPct = Math.min(1, Math.max(0, diff / (max - center))) * 50;
        fillBar.style.left = '50%';
        fillBar.style.width = `${widthPct}%`;
        fillBar.className = 'bipolar-fill fill-pos';
    } else if (diff < 0) {
        const widthPct = Math.min(1, Math.max(0, (center - val) / (center - min))) * 50;
        fillBar.style.left = `${50 - widthPct}%`;
        fillBar.style.width = `${widthPct}%`;
        fillBar.className = 'bipolar-fill fill-neg';
    } else {
        fillBar.style.left = '50%';
        fillBar.style.width = '0%';
        fillBar.className = 'bipolar-fill';
    }
    return diff;
}

/**
 * Creates a bidirectional bipolar slider (-99 to +99) bound to a parameter (e.g. MTX AMT)
 */
function createBipolarSlider(paramKey, program, onChangeCallback, opts = {}) {
    const { def, container, getProg } = initParamControl(paramKey, program, 'bipolar-slider-container');
    if (!def) return container;

    const min = def.min ?? 29;
    const max = def.max ?? 227;
    const center = def.offset ?? 128;
    const defaultVal = def.default ?? center;

    const label = document.createElement('span');
    label.className = 'bipolar-label';
    label.textContent = opts.label ?? (def.label || 'Amt');
    label.title = def.title || paramKey;

    const trackWrap = document.createElement('div');
    trackWrap.className = 'bipolar-track-wrap';

    const track = document.createElement('div');
    track.className = 'bipolar-track';

    const zeroMark = document.createElement('div');
    zeroMark.className = 'bipolar-zero-mark';
    track.appendChild(zeroMark);

    const fillBar = document.createElement('div');
    fillBar.className = 'bipolar-fill';
    track.appendChild(fillBar);

    const rangeInput = document.createElement('input');
    rangeInput.type = 'range';
    rangeInput.className = 'bipolar-range';
    rangeInput.min = min;
    rangeInput.max = max;
    rangeInput.step = 1;
    rangeInput.value = defaultVal;
    rangeInput.title = `${def.title || paramKey} • Double/right-click to center (0)`;

    trackWrap.appendChild(track);
    trackWrap.appendChild(rangeInput);

    const valDisplay = document.createElement('span');
    valDisplay.className = 'bipolar-val editable';
    valDisplay.title = 'Click to type exact value (-99 to +99)';

    container.appendChild(label);
    container.appendChild(trackWrap);
    container.appendChild(valDisplay);

    function updateVisual() {
        const prog = getProg();
        const val = prog ? prog.getValue(paramKey) : defaultVal;
        rangeInput.value = val;
        const diff = renderBipolarFill(fillBar, val, min, max, center);
        valDisplay.textContent = diff > 0 ? `+${diff}` : `${diff}`;
    }

    let startVal = null;

    rangeInput.addEventListener('pointerdown', () => {
        const prog = getProg();
        startVal = prog ? prog.getValue(paramKey) : parseInt(rangeInput.value, 10);
    });

    rangeInput.addEventListener('input', () => {
        const val = parseInt(rangeInput.value, 10);
        const prog = getProg();
        if (startVal === null) {
            startVal = prog ? prog.getValue(paramKey) : val;
        }
        if (prog) prog.setValue(paramKey, val);
        updateVisual();
        if (onChangeCallback) onChangeCallback(paramKey, val, { isInterim: true, prevVal: startVal });
    });

    const commitSlider = () => {
        const val = parseInt(rangeInput.value, 10);
        if (startVal !== null && val !== startVal && onChangeCallback) {
            onChangeCallback(paramKey, val, { isFinal: true, prevVal: startVal });
        }
        startVal = null;
    };
    rangeInput.addEventListener('change', commitSlider);
    rangeInput.addEventListener('pointerup', commitSlider);

    bindResetActions(rangeInput, () => {
        const prog = getProg();
        if (prog && prog.getValue(paramKey) !== center) {
            commitParamValue(getProg, paramKey, center, onChangeCallback);
            updateVisual();
        }
    });

    attachInlineValueEditor({
        triggerEl: valDisplay,
        def: { ...def, offset: center, displayOffset: undefined },
        min,
        max,
        getProg,
        paramKey,
        onChangeCallback,
        refresh: updateVisual,
        inputClassName: 'bipolar-val-input',
        inputType: 'number'
    });

    container.refresh = updateVisual;
    updateVisual();

    return container;
}

/**
 * Creates a select dropdown bound to a parameter
 */
function createSelect(paramKey, program, onChangeCallback) {
    const { def, container, getProg } = initParamControl(paramKey, program, 'select-container');
    if (!def) return container;

    // Auto-promote binary On/Off dropdowns to clean toggle buttons
    if (def.values && def.values.length === 2 && def.values[0] === 'Off' && def.values[1] === 'On') {
        return createToggleButton(paramKey, program, onChangeCallback);
    }

    const label = document.createElement('label');
    label.className = 'control-label';
    label.textContent = def.label || paramKey;
    label.title = def.title || paramKey;

    const select = document.createElement('select');
    select.className = 'control-select';

    const { min, max } = getParamBounds(def);

    if (def.values && def.values.length > 0) {
        def.values.forEach((valText, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = valText;
            select.appendChild(opt);
        });
    } else {
        for (let i = min; i <= max; i++) {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = formatParamDisplay(def, i);
            select.appendChild(opt);
        }
    }

    function updateVisual() {
        const prog = getProg();
        if (prog) {
            select.value = prog.getValue(paramKey);
        }
    }

    const commitSelectValue = (val) => commitParamValue(getProg, paramKey, val, onChangeCallback);

    select.addEventListener('change', () => {
        commitSelectValue(parseInt(select.value, 10));
        if (typeof select.blur === 'function') select.blur();
    });

    select.addEventListener('keydown', (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        let delta = 0;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') delta = 1;
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') delta = -1;
        if (!delta) return;

        e.preventDefault();
        const opts = Array.from(select.options || select.children || []);
        if (opts.length === 0) return;

        const curStr = String(select.value);
        let curIdx = opts.findIndex(o => String(o.value) === curStr);
        if (curIdx === -1) curIdx = 0;

        let nextIdx = curIdx + delta;
        while (nextIdx >= 0 && nextIdx < opts.length && opts[nextIdx].disabled) {
            nextIdx += delta;
        }
        if (nextIdx >= 0 && nextIdx < opts.length && nextIdx !== curIdx) {
            const nextVal = parseInt(opts[nextIdx].value, 10);
            select.value = String(nextVal);
            commitSelectValue(nextVal);
        }
    });

    container.appendChild(label);
    container.appendChild(select);
    container.refresh = updateVisual;
    updateVisual();

    return container;
}

/**
 * Formats parameter value for display
 */
function formatParamDisplay(def, val) {
    if (!def) return `${val}`;
    if (def.values && def.values[val] !== undefined) {
        return def.values[val];
    }
    const num = toDisplayNumber(def, val);
    if (def.offset && def.offset > 0 && !def.displayOffset) {
        return num > 0 ? `+${num}` : `${num}`;
    }
    return `${num}`;
}

const ADSR_T_MIN = 0.002;
const ADSR_T_MAX = 10;
const ADSR_RC_K = 4;
const ADSR_RC_NORM = 1 - Math.exp(-ADSR_RC_K);

/**
 * Creates an interactive SVG ADSR curve visualizer for Envelope 1, 2, or 3
 */
function createADSRVisualizer(envNumber, program) {
    const { container, svg } = createVisualizerBox(
        'adsr-visualizer',
        `Envelope ${envNumber} ADSR Curve`,
        '0 0 160 96',
        ['data-env', envNumber]
    );

    const gradId = `adsr-grad-${envNumber}-${Math.random().toString(36).substring(2, 6)}`;
    svg.appendChild(createSvgGradient(gradId, '0.4', '0.02'));

    const pathBg = svgEl('path', { class: 'adsr-fill', fill: `url(#${gradId})` });
    const pathLine = svgEl('path', { class: 'adsr-stroke' });
    svg.appendChild(pathBg);
    svg.appendChild(pathLine);

    const getProg = () => resolveProgram(program);

    function updateVisual() {
        const prog = getProg();
        if (!prog) return;
        const atk = prog.getValue(`ENV${envNumber}_ATK`);
        const dcy = prog.getValue(`ENV${envNumber}_DCY`);
        const sus = prog.getValue(`ENV${envNumber}_SUS`);
        const rel = prog.getValue(`ENV${envNumber}_REL`);

        const padX = 6;
        const h = 96;
        const padY = 6;
        const bottomY = h - padY;
        const topY = padY;

        const toTime = (v) => (v <= 0 ? 0 : ADSR_T_MIN * Math.pow(ADSR_T_MAX / ADSR_T_MIN, (v - 1) / 126));
        const tA = toTime(atk), tD = toTime(dcy), tR = toTime(rel);
        const susNorm = sus / 127;

        const tSus = Math.max(0.3, (tA + tD + tR) / 3);
        const tTotal = tA + tD + tSus + tR;

        const plotW = 160 - padX * 2;
        const xOf = (t) => padX + (t / tTotal) * plotW;
        const yOf = (lvl) => bottomY - lvl * (bottomY - topY);

        const curve = (t0, dur, from, to, steps) => {
            let d = '';
            for (let i = 1; i <= steps; i++) {
                const f = i / steps;
                const e = (1 - Math.exp(-ADSR_RC_K * f)) / ADSR_RC_NORM;
                d += ` L ${xOf(t0 + f * dur).toFixed(2)} ${yOf(from + (to - from) * e).toFixed(2)}`;
            }
            return d;
        };

        let strokePath = `M ${padX} ${yOf(0)}`;
        let t = 0;
        if (tA > 0) strokePath += curve(t, tA, 0, 1, 24); else strokePath += ` L ${xOf(0)} ${yOf(1)}`;
        t += tA;
        if (tD > 0) strokePath += curve(t, tD, 1, susNorm, 24); else strokePath += ` L ${xOf(t)} ${yOf(susNorm)}`;
        t += tD;
        strokePath += ` L ${xOf(t + tSus).toFixed(2)} ${yOf(susNorm).toFixed(2)}`;
        t += tSus;
        if (tR > 0) strokePath += curve(t, tR, susNorm, 0, 24); else strokePath += ` L ${xOf(t)} ${yOf(0)}`;
        const fillPath = `${strokePath} L ${padX} ${bottomY} Z`;

        pathLine.setAttribute('d', strokePath);
        pathBg.setAttribute('d', fillPath);
    }

    container.refresh = updateVisual;
    updateVisual();
    return container;
}

const FILTER_FREQ_MIN = 20;
const FILTER_FREQ_MAX = 20000;
const FILTER_DB_MIN = -48;
const FILTER_DB_MAX = 24;
const FILTER_VIEW_W = 200;
const FILTER_VIEW_H = 84;
const FILTER_X0 = 6;
const FILTER_X1 = FILTER_VIEW_W - 6;
const FILTER_Y_TOP = 6;
const FILTER_Y_BOT = 78;
const FILTER_FLOOR_EPSILON = 0.5;
const FILTER_RESO_DRAG_SPAN = 42;

function computeFilterMagnitude(omega, algo, Q, normReso) {
    const cmul = (p, q) => [p[0] * q[0] - p[1] * q[1], p[0] * q[1] + p[1] * q[0]];
    const cadd = (p, q) => [p[0] + q[0], p[1] + q[1]];
    const cdiv = (p, q) => {
        const d = q[0] * q[0] + q[1] * q[1];
        if (d < 1e-12) return [1e6, 0];
        return [(p[0] * q[0] + p[1] * q[1]) / d, (p[1] * q[0] - p[0] * q[1]) / d];
    };
    const cabs = (p) => Math.hypot(p[0], p[1]);
    const cpow = (p, n) => { let r = [1, 0]; for (let i = 0; i < n; i++) r = cmul(r, p); return r; };

    const s_ = [0, omega];
    const one = [1, 0];
    const onePlusS = cadd(one, s_);
    const biquad = cadd(cadd(cmul(s_, s_), [0, omega / Q]), one);

    switch (algo) {
        case 0: return cabs(cdiv(one, onePlusS));
        case 1: return cabs(cdiv(one, biquad));
        case 2: return cabs(cdiv(one, cadd(cpow(onePlusS, 3), [normReso * 8, 0])));
        case 3: return cabs(cdiv(one, cadd(cpow(onePlusS, 4), [normReso * 4, 0])));
        case 4: return cabs(cdiv(cmul(s_, s_), biquad));
        case 5: return cabs(cdiv([0, omega / Q], biquad));
        case 6: return cabs(cdiv(cadd(cmul(s_, s_), one), biquad));
        default: {
            const ap = cdiv([1, -omega], onePlusS);
            return cabs(cadd(one, cmul(ap, ap))) / 2;
        }
    }
}

function splitPassStopPaths(pts) {
    let curvePath = '';
    let floorPath = '';
    let curveStarted = false;
    let floorStarted = false;
    const floorThreshold = FILTER_DB_MIN + FILTER_FLOOR_EPSILON;

    for (let i = 0; i < pts.length; i++) {
        const pt = pts[i];
        const isFloor = pt.db <= floorThreshold;
        const prevOnFloor = i > 0 && pts[i - 1].db <= floorThreshold;
        const nextOnFloor = i < pts.length - 1 && pts[i + 1].db <= floorThreshold;

        if (!isFloor || !prevOnFloor || !nextOnFloor) {
            if (!isFloor || prevOnFloor !== nextOnFloor) {
                curvePath += `${!curveStarted ? 'M' : 'L'} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)} `;
                curveStarted = true;
            }
        } else {
            curveStarted = false;
        }

        if (isFloor) {
            floorPath += `${!floorStarted ? 'M' : 'L'} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)} `;
            floorStarted = true;
        } else {
            floorStarted = false;
        }
    }

    return { curvePath: curvePath.trim(), floorPath: floorPath.trim() };
}

function attachFilterDrag(svg, cutoffPoint, getProg, onChange, updateVisual) {
    const toSvgCoords = (clientX, clientY) => {
        const rect = svg.getBoundingClientRect ? svg.getBoundingClientRect() : null;
        if (!rect || !rect.width || !rect.height) {
            return { x: clientX, y: clientY };
        }
        return {
            x: ((clientX - rect.left) / rect.width) * FILTER_VIEW_W,
            y: ((clientY - rect.top) / rect.height) * FILTER_VIEW_H
        };
    };

    const syncFilterKnob = (key) => {
        if (typeof document === 'undefined') return;
        document.querySelectorAll(`[data-param="${key}"]`).forEach(el => {
            if (el.refresh) el.refresh();
        });
    };

    let dragState = null;

    const onPointerMove = (e) => {
        if (!dragState) return;
        const pt = toSvgCoords(e.clientX, e.clientY);
        const normX = Math.max(0, Math.min(1, (pt.x - FILTER_X0) / (FILTER_X1 - FILTER_X0)));
        const nextFreq = Math.round(normX * 255);
        const deltaY = dragState.startY - pt.y;
        const nextReso = Math.max(0, Math.min(127, Math.round(dragState.startReso + (deltaY / FILTER_RESO_DRAG_SPAN) * 127)));

        if (nextFreq !== dragState.curFreq) {
            dragState.curFreq = nextFreq;
            onChange('FILTER_FREQ', nextFreq, { isInterim: true, prevVal: dragState.startFreq });
            syncFilterKnob('FILTER_FREQ');
        }
        if (nextReso !== dragState.curReso) {
            dragState.curReso = nextReso;
            onChange('FILTER_RESO', nextReso, { isInterim: true, prevVal: dragState.startReso });
            syncFilterKnob('FILTER_RESO');
        }
        updateVisual();
    };

    const onPointerUp = () => {
        if (!dragState) return;
        const { startFreq, startReso, curFreq, curReso } = dragState;
        dragState = null;
        cutoffPoint.classList.remove('dragging');

        const freqChanged = curFreq !== startFreq;
        const resoChanged = curReso !== startReso;
        if (freqChanged || resoChanged) {
            withChangeGroup(onChange, 'Filter Cutoff & Resonance', () => {
                if (freqChanged) {
                    onChange('FILTER_FREQ', curFreq, { isFinal: true, prevVal: startFreq });
                    syncFilterKnob('FILTER_FREQ');
                }
                if (resoChanged) {
                    onChange('FILTER_RESO', curReso, { isFinal: true, prevVal: startReso });
                    syncFilterKnob('FILTER_RESO');
                }
            });
        }
    };

    cutoffPoint.addEventListener('pointerdown', (e) => {
        const prog = getProg();
        if (!prog) return;
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();

        const pt = toSvgCoords(e.clientX, e.clientY);
        const startFreq = prog.getValue('FILTER_FREQ');
        const startReso = prog.getValue('FILTER_RESO');
        dragState = {
            startY: pt.y,
            startFreq,
            startReso,
            curFreq: startFreq,
            curReso: startReso
        };
        cutoffPoint.classList.add('dragging');
        startWindowPointerDrag(onPointerMove, onPointerUp);
    });
}

/**
 * Creates an interactive SVG Filter frequency response curve
 */
function createFilterCurveVisualizer(program, onChange) {
    const { container, svg } = createVisualizerBox(
        'filter-visualizer',
        'Filter Magnitude Response (20 Hz–20 kHz, log; +24 to −48 dB) — Drag dot to adjust Cutoff & Resonance',
        `0 0 ${FILTER_VIEW_W} ${FILTER_VIEW_H}`
    );

    svg.appendChild(createSvgGradient('filter-curve-grad', '0.35', '0.0'));

    const pathBg = svgEl('path', { class: 'filter-fill', fill: 'url(#filter-curve-grad)' });
    const pathStopband = svgEl('path', { class: 'filter-stroke-stopband' });
    const pathPassband = svgEl('path', { class: 'filter-stroke' });
    const cutoffPoint = svgEl('circle', { class: 'filter-cutoff-point', r: '3' });

    svg.appendChild(pathBg);
    svg.appendChild(pathStopband);
    svg.appendChild(pathPassband);
    svg.appendChild(cutoffPoint);

    const getProg = () => resolveProgram(program);

    function updateVisual() {
        const prog = getProg();
        if (!prog) return;
        const freq = prog.getValue('FILTER_FREQ');
        const reso = prog.getValue('FILTER_RESO');
        const algo = prog.getValue('FILTER_ALGO');

        const cutoffHz = FILTER_FREQ_MIN * Math.pow(FILTER_FREQ_MAX / FILTER_FREQ_MIN, freq / 255);
        const normReso = reso / 127;
        const Q = 0.5 * Math.pow(40, normReso);

        const dbToY = (db) => FILTER_Y_BOT - ((Math.max(FILTER_DB_MIN, Math.min(FILTER_DB_MAX, db)) - FILTER_DB_MIN) / (FILTER_DB_MAX - FILTER_DB_MIN)) * (FILTER_Y_BOT - FILTER_Y_TOP);
        const hzToX = (hz) => FILTER_X0 + (Math.log(hz / FILTER_FREQ_MIN) / Math.log(FILTER_FREQ_MAX / FILTER_FREQ_MIN)) * (FILTER_X1 - FILTER_X0);

        const N = 120;
        let strokePath = '';
        const pts = [];
        for (let i = 0; i <= N; i++) {
            const x = FILTER_X0 + (i / N) * (FILTER_X1 - FILTER_X0);
            const hz = FILTER_FREQ_MIN * Math.pow(FILTER_FREQ_MAX / FILTER_FREQ_MIN, i / N);
            const db = 20 * Math.log10(Math.max(1e-6, computeFilterMagnitude(hz / cutoffHz, algo, Q, normReso)));
            const y = dbToY(db);
            pts.push({ x, y, hz, db });
            strokePath += `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)} `;
        }

        const { curvePath, floorPath } = splitPassStopPaths(pts);
        const cutDb = 20 * Math.log10(Math.max(1e-6, computeFilterMagnitude(1, algo, Q, normReso)));
        cutoffPoint.setAttribute('cx', hzToX(cutoffHz).toFixed(2));
        cutoffPoint.setAttribute('cy', dbToY(cutDb).toFixed(2));

        const fillPath = `${strokePath.trim()} L ${FILTER_X1} ${FILTER_Y_BOT} L ${FILTER_X0} ${FILTER_Y_BOT} Z`;
        pathPassband.setAttribute('d', curvePath);
        pathStopband.setAttribute('d', floorPath);
        pathBg.setAttribute('d', fillPath);
    }

    if (onChange) {
        attachFilterDrag(svg, cutoffPoint, getProg, onChange, updateVisual);
    }

    container.refresh = updateVisual;
    updateVisual();
    return container;
}

const LFO_MAX_CYCLES = 12;

function computeLfoCycles(speed, speedDef) {
    let pos;
    const syncLabel = speedDef && speedDef.values ? speedDef.values[speed] : null;
    if (speed >= 128 && syncLabel) {
        const period = (lbl) => {
            let m = /^(\d+)\/(\d+)$/.exec(lbl);
            if (m) return parseInt(m[1], 10) / parseInt(m[2], 10);
            m = /^(\d+)([dt])$/.exec(lbl);
            if (m) return (1 / parseInt(m[1], 10)) * (m[2] === 'd' ? 1.5 : 2 / 3);
            return 1;
        };
        const slowest = period(speedDef.values[128]);
        const fastest = period(speedDef.values[speedDef.values.length - 1]);
        pos = Math.log(slowest / period(syncLabel)) / Math.log(slowest / fastest);
    } else {
        pos = Math.min(1, Math.max(0, speed / 127));
    }
    return { pos, cycles: 1 + Math.round(pos * (LFO_MAX_CYCLES - 1)) };
}

function buildLfoWavePath(wave, cycles, pos, lfoNumber) {
    const mid = 15;
    const amp = 10;
    const x0 = 6, x1 = 94;
    const yOf = (v) => mid - v * amp;
    const yUni = (v) => mid + amp - v * 2 * amp;
    const frac = (v) => v - Math.floor(v);
    const rnd = (n) => {
        const r = Math.sin(n * 127.1 + lfoNumber * 311.7) * 43758.5453;
        return (r - Math.floor(r)) * 2 - 1;
    };
    const periodic = (fn) => {
        const N = 360;
        let out = '';
        for (let i = 0; i <= N; i++) {
            const f = i / N;
            out += `${i === 0 ? 'M' : 'L'} ${(x0 + f * (x1 - x0)).toFixed(2)} ${fn(f * cycles).toFixed(2)} `;
        }
        return out.trim();
    };

    switch (wave) {
        case 0: return periodic((ph) => yOf(Math.sin(2 * Math.PI * ph)));
        case 1: return periodic((ph) => {
            const f = frac(ph);
            return yOf(f < 0.25 ? 4 * f : f < 0.75 ? 2 - 4 * f : 4 * f - 4);
        });
        case 2: return periodic((ph) => yOf(2 * frac(ph + 0.5) - 1));
        case 3: return periodic((ph) => yOf(frac(ph) < 0.5 ? 1 : -1));
        case 4:
        case 17: {
            const uni = wave === 17;
            return periodic((ph) => {
                const v = rnd(Math.floor(ph));
                return uni ? yUni((v + 1) / 2) : yOf(v);
            });
        }
        case 5:
        case 18: {
            const uni = wave === 18;
            const nodes = 3 + pos * 21;
            const valueNoise = (t, seed) => {
                const n = Math.floor(t);
                const f = frac(t);
                const sm = f * f * (3 - 2 * f);
                return rnd(n + seed) + (rnd(n + 1 + seed) - rnd(n + seed)) * sm;
            };
            const N = 360;
            let d = '';
            for (let i = 0; i <= N; i++) {
                const f = i / N;
                const v = 0.65 * valueNoise(f * nodes, 0) + 0.35 * valueNoise(f * nodes * 2.3, 1000);
                const y = uni ? yUni((v + 1) / 2) : yOf(v);
                d += `${i === 0 ? 'M' : 'L'} ${(x0 + f * (x1 - x0)).toFixed(2)} ${y.toFixed(2)} `;
            }
            return d.trim();
        }
        case 6: case 7: case 8:
            return `M 6 ${mid + amp} Q 50 ${mid + amp} 94 ${mid - amp}`;
        case 9: case 10: case 11:
            return `M 6 ${mid - amp} Q 50 ${mid + amp} 94 ${mid + amp}`;
        case 12: case 13: case 14:
            return `M 6 ${mid + amp} Q 30 ${mid - amp} 50 ${mid - amp} Q 70 ${mid - amp} 94 ${mid + amp}`;
        case 15:
            return `M 6 ${mid - amp} L 65 ${mid - amp} L 65 ${mid + amp} L 94 ${mid + amp}`;
        case 16:
            return `M 6 ${mid + amp} L 65 ${mid + amp} L 65 ${mid - amp} L 94 ${mid - amp}`;
        default:
            return periodic(() => mid);
    }
}

/**
 * Creates an interactive SVG LFO Waveform Preview
 */
function createLFOWaveformPreview(lfoNumber, program) {
    const { container, svg } = createVisualizerBox(
        'lfo-visualizer',
        `LFO ${lfoNumber} Waveform Preview`,
        '0 0 100 36',
        ['data-lfo', lfoNumber]
    );

    const pathLine = svgEl('path', { class: 'lfo-stroke' });
    const nameText = svgEl('text', { x: '5', y: '32', class: 'lfo-text' });
    svg.appendChild(pathLine);
    svg.appendChild(nameText);

    const getProg = () => resolveProgram(program);

    function updateVisual() {
        const prog = getProg();
        if (!prog) return;
        const wave = prog.getValue(`LFO${lfoNumber}_WAVE`);
        nameText.textContent = LOOKUPS.lfoWaves[wave] || `Wave ${wave}`;

        const speedKey = `LFO${lfoNumber}_SPEED`;
        const { pos, cycles } = computeLfoCycles(prog.getValue(speedKey), PARAM_MAP.get(speedKey));
        pathLine.setAttribute('d', buildLfoWavePath(wave, cycles, pos, lfoNumber));
    }

    container.refresh = updateVisual;
    updateVisual();
    return container;
}

/**
 * Sets and clears the shared floating drop-tip banner (rendered on body::after).
 */
function setAppDropTip(el, text) {
    if (el && typeof el.setAttribute === 'function') {
        el.setAttribute('data-drop-tip', text);
    }
    if (typeof document !== 'undefined' && document.body && typeof document.body.setAttribute === 'function') {
        document.body.setAttribute('data-drop-tip', text);
    }
}

function clearAppDropTip(el) {
    const clearNode = (node) => {
        if (!node) return;
        if (typeof node.removeAttribute === 'function') {
            node.removeAttribute('data-drop-tip');
        } else if (typeof node.setAttribute === 'function') {
            node.setAttribute('data-drop-tip', '');
        }
    };
    clearNode(el);
    if (typeof document !== 'undefined' && document.body) {
        clearNode(document.body);
    }
}

let _activeCardSectionDrag = null;

/**
 * Creates a synthesizer card with Drag-and-Drop section copying and Action Menu (Copy, Paste, Reset, Randomize)
 */
function createSectionCard(title, sectionType, sectionIndex, program, onChangeCallback, opts = {}) {
    const card = document.createElement('div');
    card.className = `synth-card ${opts.className || ''}`;
    card.setAttribute('data-section-type', sectionType);
    card.setAttribute('data-section-index', sectionIndex);

    const head = document.createElement('div');
    head.className = 'synth-card-header';

    const isSingleton = (SECTION_DEFINITIONS[sectionType] && SECTION_DEFINITIONS[sectionType].count === 1) || opts.isSingleton;

    const titleGroup = document.createElement('div');
    titleGroup.className = isSingleton ? 'card-title-group static' : 'card-title-group';
    if (!isSingleton) {
        titleGroup.setAttribute('draggable', 'true');
        titleGroup.title = 'Drag to copy settings to another section of the same type';

        const dragHandle = document.createElement('span');
        dragHandle.className = 'card-drag-handle';
        dragHandle.textContent = '⋮⋮';
        titleGroup.appendChild(dragHandle);
    }

    const titleText = document.createElement('span');
    titleText.className = 'card-title-text';
    titleText.textContent = title;
    titleGroup.appendChild(titleText);
    head.appendChild(titleGroup);

    // Optional Solo / Mute toolbar (for Oscillators, Noise, etc.)
    if (opts.hasSoloMute) {
        const soloMuteGroup = document.createElement('div');
        soloMuteGroup.className = 'solo-mute-group';

        const muteBtn = document.createElement('button');
        muteBtn.className = 'btn-sm-badge btn-mute';
        muteBtn.textContent = 'M';
        muteBtn.title = 'Mute this sound source';
        muteBtn.onclick = (e) => {
            e.stopPropagation();
            const isMuted = muteBtn.classList.toggle('active');
            if (opts.onMute) opts.onMute(isMuted);
        };

        const soloBtn = document.createElement('button');
        soloBtn.className = 'btn-sm-badge btn-solo';
        soloBtn.textContent = 'S';
        soloBtn.title = 'Solo this sound source';
        soloBtn.onclick = (e) => {
            e.stopPropagation();
            const isSolo = soloBtn.classList.toggle('active');
            if (opts.onSolo) opts.onSolo(isSolo);
        };

        soloMuteGroup.appendChild(muteBtn);
        soloMuteGroup.appendChild(soloBtn);
        head.appendChild(soloMuteGroup);
    }

    // Section Menu Button (Copy, Paste, Reset, Randomize)
    const menuWrap = document.createElement('div');
    menuWrap.className = 'card-menu-wrap';

    const menuBtn = document.createElement('button');
    menuBtn.className = 'card-menu-btn';
    menuBtn.textContent = '⋯';
    menuBtn.title = 'Section Actions (Copy, Paste, Reset, Randomize)';

    const dropdown = document.createElement('div');
    dropdown.className = 'card-dropdown-menu';

    function updateMenuState() {
        const clip = getSectionClipboard();
        const canPaste = clip && clip.sectionType === sectionType;
        dropdown.innerHTML = `
            <div class="menu-item" data-action="copy">${ICON_COPY_SVG} <span>Copy Section</span></div>
            <div class="menu-item ${canPaste ? '' : 'disabled'}" data-action="paste">${ICON_PASTE_SVG} <span>Paste Section</span></div>
            <div class="menu-item" data-action="reset">${ICON_RESET_SVG} <span>Reset to Defaults</span></div>
            <div class="menu-item" data-action="randomize">${ICON_RANDOM_SVG} <span>Smart Randomize</span></div>
        `;

        dropdown.querySelector('[data-action="copy"]').onclick = (e) => {
            e.stopPropagation();
            copySectionToClipboard(sectionType, sectionIndex, program);
            closeMenu();
            if (window.app && window.app.showNotification) {
                window.app.showNotification(`Copied ${title} to clipboard`, 'info');
            }
        };

        const pasteEl = dropdown.querySelector('[data-action="paste"]');
        if (canPaste) {
            pasteEl.onclick = (e) => {
                e.stopPropagation();
                pasteSectionFromClipboard(sectionType, sectionIndex, program, onChangeCallback);
                closeMenu();
                card.refresh();
                if (window.app && window.app.showNotification) {
                    window.app.showNotification(`Pasted into ${title}`, 'success');
                }
            };
        }

        dropdown.querySelector('[data-action="reset"]').onclick = (e) => {
            e.stopPropagation();
            resetSectionToInit(sectionType, sectionIndex, program, onChangeCallback);
            closeMenu();
            card.refresh();
            if (window.app && window.app.showNotification) {
                window.app.showNotification(`Reset ${title} to defaults`, 'info');
            }
        };

        dropdown.querySelector('[data-action="randomize"]').onclick = (e) => {
            e.stopPropagation();
            randomizeSection(sectionType, sectionIndex, program, onChangeCallback);
            closeMenu();
            card.refresh();
            if (window.app && window.app.showNotification) {
                window.app.showNotification(`Randomized ${title}`, 'success');
            }
        };
    }

    function closeMenu() {
        dropdown.classList.remove('open');
        window.removeEventListener('click', closeMenu);
    }

    menuBtn.onclick = (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains('open');
        document.querySelectorAll('.card-dropdown-menu.open').forEach(m => m.classList.remove('open'));
        if (!isOpen) {
            updateMenuState();
            dropdown.classList.add('open');
            window.addEventListener('click', closeMenu);
        }
    };

    menuWrap.appendChild(menuBtn);
    menuWrap.appendChild(dropdown);
    head.appendChild(menuWrap);

    // Section Drag-and-Drop Setup (multi-instance sections only)
    if (!isSingleton) {
        titleGroup.addEventListener('dragstart', (e) => {
            _activeCardSectionDrag = { kind: 'section', sectionType, sectionIndex };
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData('text/plain', JSON.stringify(_activeCardSectionDrag));
            }
            card.classList.add('is-dragging');
            document.querySelectorAll(`.synth-card[data-section-type="${sectionType}"]`).forEach(c => {
                if (c !== card) c.classList.add('valid-drop-target');
            });
        });

        titleGroup.addEventListener('dragend', () => {
            _activeCardSectionDrag = null;
            card.classList.remove('is-dragging');
            document.querySelectorAll('.valid-drop-target').forEach(c => c.classList.remove('valid-drop-target'));
            document.querySelectorAll('.drop-hover').forEach(c => {
                c.classList.remove('drop-hover');
                clearAppDropTip(c);
            });
            clearAppDropTip(null);
        });

        card.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (card.classList.contains('valid-drop-target')) {
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
                card.classList.add('drop-hover');
                const secLabel = sectionType.toUpperCase();
                if (_activeCardSectionDrag && _activeCardSectionDrag.sectionType === sectionType) {
                    setAppDropTip(card, `Drop to copy ${secLabel} ${_activeCardSectionDrag.sectionIndex} to ${secLabel} ${sectionIndex}`);
                }
            }
        });

        card.addEventListener('dragleave', () => {
            card.classList.remove('drop-hover');
            clearAppDropTip(card);
        });

        card.addEventListener('drop', (e) => {
            e.preventDefault();
            card.classList.remove('drop-hover');
            clearAppDropTip(card);
            _activeCardSectionDrag = null;
            try {
                const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                if (data.kind === 'section' && data.sectionType === sectionType && data.sectionIndex !== sectionIndex) {
                    copySection(data.sectionType, data.sectionIndex, sectionType, sectionIndex, program, onChangeCallback);
                    card.refresh();
                    if (window.app && window.app.showNotification) {
                        window.app.showNotification(`Copied Section ${data.sectionIndex} to ${sectionIndex}`, 'success');
                    }
                }
            } catch (err) { }
        });
    }

    card.appendChild(head);

    const body = document.createElement('div');
    body.className = 'synth-card-body';
    card.appendChild(body);

    card.refresh = () => {
        card.querySelectorAll('[data-param]').forEach(el => {
            if (el.refresh) el.refresh();
        });
        card.querySelectorAll('.visualizer-box').forEach(v => {
            if (v.refresh) v.refresh();
        });
    };

    return { card, body };
}

/**
 * Creates a 16-step Arpeggiator pattern sequencer control
 */
function createArpSequencer(program, onChangeCallback) {
    const container = document.createElement('div');
    container.className = 'arp-sequencer-card';

    const getProg = () => resolveProgram(program);

    const header = document.createElement('div');
    header.className = 'sequencer-header';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'sequencer-title';
    titleSpan.textContent = 'SEQUENCER';
    header.appendChild(titleSpan);

    const toolsDiv = document.createElement('div');
    toolsDiv.className = 'sequencer-tools';

    let activeStepDrag = null;
    const dropTargetBtns = [];

    const copyLabel = document.createElement('span');
    copyLabel.className = 'seq-copy-label';
    copyLabel.id = 'seq-copy-label';
    copyLabel.textContent = 'Copy';
    toolsDiv.appendChild(copyLabel);

    const setDropTargetsVisible = (visible) => {
        copyLabel.classList.toggle('is-visible', visible);
        dropTargetBtns.forEach((btn) => {
            btn.classList.toggle('is-visible', visible);
            if (!visible) btn.classList.remove('slot-drop-hover');
        });
    };

    const createCopyDropTarget = ({ id, label, title, mode }) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-sm seq-copy-all-btn';
        btn.id = id;
        btn.title = title;
        btn.textContent = label;

        btn.addEventListener('dragover', (e) => {
            if (activeStepDrag === null) return;
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
            btn.classList.add('slot-drop-hover');
            setAppDropTip(btn, `Drop to copy ${label.toLowerCase()} from Step ${activeStepDrag} to all steps`);
        });
        btn.addEventListener('dragleave', (e) => {
            e.stopPropagation();
            btn.classList.remove('slot-drop-hover');
            clearAppDropTip(btn);
        });
        btn.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            clearAppDropTip(btn);
            setDropTargetsVisible(false);
            try {
                const raw = e.dataTransfer && e.dataTransfer.getData ? e.dataTransfer.getData('text/plain') : '';
                const data = raw ? JSON.parse(raw) : (activeStepDrag !== null ? { kind: 'arp_step', stepIndex: activeStepDrag } : null);
                const srcIdx = data && data.kind === 'arp_step' ? data.stepIndex : null;
                const prog = getProg();
                if (prog && srcIdx >= 1 && srcIdx <= 16) {
                    const srcPad = srcIdx.toString().padStart(2, '0');
                    const srcNote = prog.getValue(`ARP_PTN_STEP${srcPad}`);
                    const srcMod = prog.getValue(`ARP_PTN_STEP_MOD${srcPad}`);
                    if (onChangeCallback && onChangeCallback.beginGroup) {
                        onChangeCallback.beginGroup(`${label} from Step ${srcIdx}`);
                    }
                    for (let dst = 1; dst <= 16; dst++) {
                        if (dst !== srcIdx) {
                            if (mode === 'both') {
                                copySection('arp_step', srcIdx, 'arp_step', dst, prog, onChangeCallback);
                            } else {
                                const dstPad = dst.toString().padStart(2, '0');
                                const key = mode === 'note' ? `ARP_PTN_STEP${dstPad}` : `ARP_PTN_STEP_MOD${dstPad}`;
                                const val = mode === 'note' ? srcNote : srcMod;
                                const prevVal = prog.getValue(key);
                                prog.setValue(key, val);
                                if (onChangeCallback) onChangeCallback(key, val, { isFinal: true, prevVal });
                            }
                        }
                    }
                    if (onChangeCallback && onChangeCallback.endGroup) {
                        onChangeCallback.endGroup();
                    }
                    container.refresh();
                    if (window.app && window.app.showNotification) {
                        window.app.showNotification(`${label}: Step ${srcIdx} applied to all steps`, 'success');
                    }
                }
            } catch (err) { }
            activeStepDrag = null;
        });

        dropTargetBtns.push(btn);
        toolsDiv.appendChild(btn);
        return btn;
    };

    createCopyDropTarget({
        id: 'seq-copy-all-btn',
        label: 'All',
        title: 'Drop a step here to copy Note and Mod to all 16 steps',
        mode: 'both'
    });
    createCopyDropTarget({
        id: 'seq-copy-note-btn',
        label: 'Note',
        title: 'Drop a step here to copy Note to all 16 steps',
        mode: 'note'
    });
    createCopyDropTarget({
        id: 'seq-copy-mod-btn',
        label: 'Mod',
        title: 'Drop a step here to copy Mod to all 16 steps',
        mode: 'mod'
    });

    const applyStepBatch = (groupLabel, applyFn) => {
        const prog = getProg();
        if (prog) {
            if (onChangeCallback && onChangeCallback.beginGroup) {
                onChangeCallback.beginGroup(groupLabel);
            }
            const setStepParam = (key, val) => {
                const prev = prog.getValue(key);
                prog.setValue(key, val);
                if (onChangeCallback) onChangeCallback(key, val, { isFinal: true, prevVal: prev });
            };
            for (let i = 1; i <= 16; i++) {
                const numStr = i.toString().padStart(2, '0');
                applyFn(numStr, setStepParam);
            }
            if (onChangeCallback && onChangeCallback.endGroup) {
                onChangeCallback.endGroup();
            }
        }
        container.refresh();
    };

    // Note section
    const noteGroup = document.createElement('div');
    noteGroup.className = 'seq-tool-group';
    noteGroup.id = 'seq-note-tools';

    const noteGroupLabel = document.createElement('span');
    noteGroupLabel.className = 'seq-group-label';
    noteGroupLabel.textContent = 'Note';
    noteGroup.appendChild(noteGroupLabel);

    let includeChords = true;
    const chordsBtn = document.createElement('button');
    chordsBtn.type = 'button';
    chordsBtn.className = 'btn-param-toggle seq-chords-btn active';
    chordsBtn.id = 'seq-chords-btn';
    chordsBtn.title = 'Include Chord steps when randomizing pattern (Click to toggle)';
    chordsBtn.setAttribute('aria-pressed', 'true');

    const chordsLabel = document.createElement('span');
    chordsLabel.className = 'toggle-label';
    chordsLabel.textContent = 'Chords';
    chordsBtn.appendChild(chordsLabel);

    const chordsStateBadge = document.createElement('span');
    chordsStateBadge.className = 'toggle-state-badge';
    chordsStateBadge.textContent = 'ON';
    chordsBtn.appendChild(chordsStateBadge);

    chordsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        includeChords = !includeChords;
        chordsBtn.setAttribute('aria-pressed', includeChords ? 'true' : 'false');
        chordsBtn.classList.toggle('active', includeChords);
        chordsStateBadge.textContent = includeChords ? 'ON' : 'OFF';
    });
    noteGroup.appendChild(chordsBtn);

    const chordsArrow = document.createElement('span');
    chordsArrow.className = 'seq-tool-arrow';
    chordsArrow.setAttribute('aria-hidden', 'true');
    chordsArrow.textContent = '←';
    noteGroup.appendChild(chordsArrow);

    const randBtn = document.createElement('button');
    randBtn.type = 'button';
    randBtn.className = 'btn-slot-icon';
    randBtn.id = 'seq-random-btn';
    randBtn.title = 'Randomize Note steps';
    randBtn.innerHTML = ICON_RANDOM_SVG;
    randBtn.addEventListener('click', () => {
        const basePool = [0, 0, 1, 2, 3, 4, 5, 6, 10, 11]; // Musical probability weights (3 = < -1, 10 = > +1, 11 = Chord)
        const pool = includeChords ? basePool : basePool.filter(v => v !== 11);
        applyStepBatch('Randomize Arp Note Pattern', (numStr, setStepParam) => {
            setStepParam(`ARP_PTN_STEP${numStr}`, pool[Math.floor(Math.random() * pool.length)]);
        });
    });
    noteGroup.appendChild(randBtn);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn-slot-icon btn-slot-clear';
    clearBtn.id = 'seq-clear-btn';
    clearBtn.title = 'Clear all Note steps to Off';
    clearBtn.textContent = '✕';
    clearBtn.addEventListener('click', () => {
        applyStepBatch('Clear Arp Note Pattern', (numStr, setStepParam) => {
            setStepParam(`ARP_PTN_STEP${numStr}`, 1); // Off
        });
    });
    noteGroup.appendChild(clearBtn);

    const autoBtn = document.createElement('button');
    autoBtn.type = 'button';
    autoBtn.className = 'btn-slot-icon seq-btn-auto';
    autoBtn.id = 'seq-note-auto-btn';
    autoBtn.title = 'Fill all Note steps with Auto';
    autoBtn.textContent = 'A';
    autoBtn.addEventListener('click', () => {
        applyStepBatch('Fill Arp Note Pattern with Auto', (numStr, setStepParam) => {
            setStepParam(`ARP_PTN_STEP${numStr}`, 0); // Auto
        });
    });
    noteGroup.appendChild(autoBtn);

    toolsDiv.appendChild(noteGroup);

    // Mod section
    const modGroup = document.createElement('div');
    modGroup.className = 'seq-tool-group';
    modGroup.id = 'seq-mod-tools';

    const modGroupLabel = document.createElement('span');
    modGroupLabel.className = 'seq-group-label';
    modGroupLabel.textContent = 'Mod';
    modGroup.appendChild(modGroupLabel);

    const modRandBtn = document.createElement('button');
    modRandBtn.type = 'button';
    modRandBtn.className = 'btn-slot-icon';
    modRandBtn.id = 'seq-mod-random-btn';
    modRandBtn.title = 'Randomize Mod levels';
    modRandBtn.innerHTML = ICON_RANDOM_SVG;
    modRandBtn.addEventListener('click', () => {
        applyStepBatch('Randomize Arp Mod Pattern', (numStr, setStepParam) => {
            setStepParam(`ARP_PTN_STEP_MOD${numStr}`, Math.floor(Math.random() * 4));
        });
    });
    modGroup.appendChild(modRandBtn);

    const modClearBtn = document.createElement('button');
    modClearBtn.type = 'button';
    modClearBtn.className = 'btn-slot-icon btn-slot-clear';
    modClearBtn.id = 'seq-mod-clear-btn';
    modClearBtn.title = 'Reset all Mod levels to Mid';
    modClearBtn.textContent = '✕';
    modClearBtn.addEventListener('click', () => {
        applyStepBatch('Clear Arp Mod Pattern to Mid', (numStr, setStepParam) => {
            setStepParam(`ARP_PTN_STEP_MOD${numStr}`, 1); // Mid
        });
    });
    modGroup.appendChild(modClearBtn);

    toolsDiv.appendChild(modGroup);

    header.appendChild(toolsDiv);
    container.appendChild(header);

    const stepsGrid = document.createElement('div');
    stepsGrid.className = 'steps-grid';

    const STEP_MODES = [
        'Auto', 'Off', 'Tie', '< -1', '1st', '2nd', '3rd', '4th', '5th', '6th', '> +1', 'Chord'
    ];
    const MOD_LEVELS = ['Low', 'Mid', 'High', 'Random'];

    const stepElements = [];

    for (let i = 1; i <= 16; i++) {
        const numStr = i.toString().padStart(2, '0');
        const stepKey = `ARP_PTN_STEP${numStr}`;
        const modKey = `ARP_PTN_STEP_MOD${numStr}`;

        const col = document.createElement('div');
        col.className = 'step-col';
        col.setAttribute('data-step', i);
        col.setAttribute('draggable', 'true');
        col.title = `Step ${i} • Drag to copy to another step or "Copy to all"`;

        col.addEventListener('dragstart', (e) => {
            activeStepDrag = i;
            const payload = { kind: 'arp_step', stepIndex: i };
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'copy';
                e.dataTransfer.setData('text/plain', JSON.stringify(payload));
            }
            col.classList.add('is-dragging');
            setDropTargetsVisible(true);
        });
        col.addEventListener('dragend', () => {
            activeStepDrag = null;
            col.classList.remove('is-dragging');
            setDropTargetsVisible(false);
            stepsGrid.querySelectorAll('.step-col.slot-drop-hover').forEach(el => {
                el.classList.remove('slot-drop-hover');
                clearAppDropTip(el);
            });
            clearAppDropTip(null);
        });
        col.addEventListener('dragover', (e) => {
            if (activeStepDrag === null || activeStepDrag === i) return;
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
            col.classList.add('slot-drop-hover');
            setAppDropTip(col, `Drop to copy Step ${activeStepDrag} to Step ${i}`);
        });
        col.addEventListener('dragleave', (e) => {
            e.stopPropagation();
            if (e.relatedTarget && typeof col.contains === 'function' && col.contains(e.relatedTarget)) {
                return;
            }
            col.classList.remove('slot-drop-hover');
            clearAppDropTip(col);
        });
        col.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            col.classList.remove('slot-drop-hover');
            clearAppDropTip(col);
            setDropTargetsVisible(false);
            try {
                const raw = e.dataTransfer && e.dataTransfer.getData ? e.dataTransfer.getData('text/plain') : '';
                const data = raw ? JSON.parse(raw) : (activeStepDrag !== null ? { kind: 'arp_step', stepIndex: activeStepDrag } : null);
                const srcIdx = data && data.kind === 'arp_step' ? data.stepIndex : null;
                if (srcIdx && srcIdx !== i) {
                    copySection('arp_step', srcIdx, 'arp_step', i, getProg(), onChangeCallback);
                    container.refresh();
                    if (window.app && window.app.showNotification) {
                        window.app.showNotification(`Copied Step ${srcIdx} to Step ${i}`, 'success');
                    }
                }
            } catch (err) { }
            activeStepDrag = null;
        });

        const stepNum = document.createElement('div');
        stepNum.className = 'step-number';
        stepNum.textContent = i;

        const wireShortClosedLabels = (selectEl, entries) => {
            if (!selectEl || !entries || entries.length === 0) return;
            const showLong = () => entries.forEach(({ opt, longLabel }) => { opt.textContent = longLabel; });
            const showShort = () => entries.forEach(({ opt, shortLabel }) => { opt.textContent = shortLabel; });
            showShort();
            selectEl.addEventListener('mousedown', showLong);
            selectEl.addEventListener('focus', showLong);
            selectEl.addEventListener('blur', showShort);
            selectEl.addEventListener('change', showShort);
        };

        const modeBtn = document.createElement('select');
        modeBtn.className = 'step-mode-btn';
        modeBtn.title = `Step ${i} note mode`;
        const SHORT_MODE_LABELS = { 3: '<-1', 10: '>+1', 11: 'Cho' };
        const shortModeEntries = [];
        STEP_MODES.forEach((txt, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = txt;
            if (SHORT_MODE_LABELS[idx]) {
                shortModeEntries.push({ opt, shortLabel: SHORT_MODE_LABELS[idx], longLabel: txt });
            }
            modeBtn.appendChild(opt);
        });
        wireShortClosedLabels(modeBtn, shortModeEntries);

        const modBtn = document.createElement('select');
        modBtn.className = 'step-mod-btn';
        modBtn.setAttribute('data-fw-v3-only', 'true');
        modBtn.title = `Step ${i} modulation level`;
        const shortModEntries = [];
        MOD_LEVELS.forEach((txt, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = txt;
            if (idx === 3) {
                shortModEntries.push({ opt, shortLabel: 'Rnd', longLabel: txt });
            }
            modBtn.appendChild(opt);
        });
        wireShortClosedLabels(modBtn, shortModEntries);

        col.appendChild(stepNum);
        col.appendChild(modeBtn);
        col.appendChild(modBtn);
        stepsGrid.appendChild(col);

        function updateStep() {
            const prog = getProg();
            if (!prog) return;

            const stepCount = prog.getValue('ARP_PTN_LENGTH') + 1; // stored 0..15 = 1..16 steps
            col.classList.toggle('step-disabled', i > stepCount);

            const modeVal = prog.getValue(stepKey);
            modeBtn.value = modeVal;
            modeBtn.setAttribute('data-mode', modeVal);
            modeBtn.classList.toggle('active', modeVal !== 1); // 1 is Off

            const modVal = prog.getValue(modKey);
            modBtn.value = modVal;
            modBtn.setAttribute('data-mod', modVal);
        }

        modeBtn.addEventListener('change', () => {
            const prog = getProg();
            if (prog) {
                const prev = prog.getValue(stepKey);
                const next = parseInt(modeBtn.value, 10);
                prog.setValue(stepKey, next);
                updateStep();
                if (onChangeCallback) onChangeCallback(stepKey, next, { isFinal: true, prevVal: prev });
            }
        });

        modBtn.addEventListener('change', () => {
            const prog = getProg();
            if (prog) {
                const prev = prog.getValue(modKey);
                const next = parseInt(modBtn.value, 10);
                prog.setValue(modKey, next);
                updateStep();
                if (onChangeCallback) onChangeCallback(modKey, next, { isFinal: true, prevVal: prev });
            }
        });

        stepElements.push({ col, updateStep, stepKey, modKey });
    }

    container.appendChild(stepsGrid);

    container.refresh = () => {
        stepElements.forEach(s => s.updateStep());
    };

    container.refresh();
    return container;
}

const SCALE_INTERVALS = [
    [0, 2, 4, 5, 7, 9, 11], // 0: Ionian (major)
    [0, 2, 3, 5, 7, 9, 10], // 1: Dorian
    [0, 1, 3, 5, 7, 8, 10], // 2: Phrygian
    [0, 2, 4, 6, 7, 9, 11], // 3: Lydian
    [0, 2, 4, 5, 7, 9, 10], // 4: Mixolydian
    [0, 2, 3, 5, 7, 8, 10], // 5: Aeolian (minor)
    [0, 1, 3, 5, 6, 8, 10], // 6: Locrian
    [0, 2, 3, 5, 7, 9, 11], // 7: Melodic minor
    [0, 1, 3, 5, 7, 9, 10], // 8: Dorian flat 2
    [0, 2, 4, 6, 8, 9, 11], // 9: Lydian augmented
    [0, 2, 4, 6, 7, 9, 10], // 10: Lydian dominant
    [0, 2, 4, 5, 7, 8, 10], // 11: Mixolydian flat 6
    [0, 2, 3, 5, 6, 8, 10], // 12: Locrian sharp 2
    [0, 1, 3, 4, 6, 8, 10], // 13: Altered
    [0, 2, 3, 5, 7, 8, 11], // 14: Harmonic minor
    [0, 1, 3, 5, 6, 9, 10], // 15: Locrian natural 6
    [0, 2, 4, 5, 8, 9, 11], // 16: Ionian sharp 5
    [0, 2, 3, 6, 7, 9, 10], // 17: Dorian sharp 4
    [0, 1, 4, 5, 7, 8, 10], // 18: Phrygian dominant
    [0, 3, 4, 6, 7, 9, 11], // 19: Lydian sharp 2
    [0, 1, 3, 4, 6, 8, 9]   // 20: Super Locrian
];

function computeChorderNotes(noteNumber, program) {
    program = resolveProgram(program);
    if (!program) return { pressed: noteNumber, chordNotes: [] };

    const chordType1 = program.getValue('CHORD_TYPE1') || 0;
    const isExpand = program.getValue('KBD_CHORD_EXPAND') === 1;

    const root = program.getValue('KBD_KEY') || 0;
    const scaleIdx = program.getValue('KBD_SCALE') || 0;
    const intervals = SCALE_INTERVALS[scaleIdx] || SCALE_INTERVALS[0];

    const semi = ((noteNumber - root) % 12 + 12) % 12;
    const oct = Math.floor((noteNumber - root) / 12);

    let degree = 0;
    let minDiff = 999;
    for (let i = 0; i < intervals.length; i++) {
        const diff = Math.abs(intervals[i] - semi);
        if (diff < minDiff || (diff === minDiff && intervals[i] <= semi)) {
            minDiff = diff;
            degree = i;
        }
    }

    const chordIdx = isExpand ? (program.getValue(`CHORD_TYPE${degree + 1}`) || chordType1) : chordType1;
    if (!chordIdx || typeof LOOKUPS === 'undefined' || !LOOKUPS.chords || !LOOKUPS.chords[chordIdx]) {
        return { pressed: noteNumber, chordNotes: [] };
    }

    const chordStr = LOOKUPS.chords[chordIdx];
    if (!chordStr || chordStr === 'Off') {
        return { pressed: noteNumber, chordNotes: [] };
    }

    const tokens = chordStr.trim().split(/\s+/).slice(1);
    const chordNotes = [];

    for (const tok of tokens) {
        const m = tok.match(/^(\d+)(?:\(([+-]?\d+)\))?$/);
        if (!m) continue;
        const tone = parseInt(m[1], 10);
        const octShift = m[2] ? parseInt(m[2], 10) : 0;
        const toneOffset = tone - 1;
        const targetDegreeIndex = degree + toneOffset;
        const targetOct = oct + Math.floor(targetDegreeIndex / 7) + octShift;
        const normalizedDegree = ((targetDegreeIndex % 7) + 7) % 7;
        const generatedNote = targetOct * 12 + root + intervals[normalizedDegree];
        if (generatedNote !== noteNumber && !chordNotes.includes(generatedNote)) {
            chordNotes.push(generatedNote);
        }
    }

    return { pressed: noteNumber, chordNotes };
}

/**
 * Creates an interactive audition keyboard (Mouse, Touch, and Computer Keyboard QWERTY input)
 */
function createKeyboard(midiManager, getActiveProgram, getVoiceLimit = () => 12) {
    const container = document.createElement('div');
    container.className = 'audition-bar';

    let currentOctave = 3;
    let velocity = 100;
    let activeSlot = 0;

    const createPartState = () => ({
        latchActive: false,
        activePressedNotes: new Set(),
        physicallyHeldNotes: new Set(),
        activeSoundingChordNotes: new Map() // pressedNote -> [chordNotes]
    });
    const partStates = [createPartState(), createPartState()];
    const getState = (slot = activeSlot) => partStates[slot === 1 ? 1 : 0];

    const controls = document.createElement('div');
    controls.className = 'audition-controls';
    controls.innerHTML = `
        <div class="audition-octave">
            <button class="btn btn-sm" id="oct-down" title="Octave Down (Z key)">Oct -</button>
            <span class="octave-label" id="oct-display">Oct 3</span>
            <button class="btn btn-sm" id="oct-up" title="Octave Up (X key)">Oct +</button>
            <button class="btn btn-sm btn-subtle" id="kbd-latch" title="Hold / Latch Audition Notes (Spacebar)">Latch</button>
        </div>
        <div class="audition-wheels">
            <div class="wheel-box" title="Pitch Bend Wheel">
                <span class="wheel-label">Pitch</span>
                <input type="range" class="wheel-slider" id="pitch-wheel" min="0" max="16383" value="8192">
            </div>
            <div class="wheel-box" title="Modulation Wheel (CC 1)">
                <span class="wheel-label">Mod</span>
                <input type="range" class="wheel-slider" id="mod-wheel" min="0" max="127" value="0">
            </div>
        </div>
        <button class="btn btn-sm btn-panic" id="kbd-panic" title="MIDI Panic — All Notes Off (CC 123, ! key)">Panic</button>
    `;

    const kbdWrapper = document.createElement('div');
    kbdWrapper.className = 'keyboard-wrapper';

    // 37 keys: 3 octaves from C to C (offsets 0 to 36); middle octave is offsets 12..23
    const whiteKeys = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24, 26, 28, 29, 31, 33, 35, 36];
    const blackKeys = [
        { note: 1, pos: 0 },
        { note: 3, pos: 1 },
        { note: 6, pos: 3 },
        { note: 8, pos: 4 },
        { note: 10, pos: 5 },
        { note: 13, pos: 7 },
        { note: 15, pos: 8 },
        { note: 18, pos: 10 },
        { note: 20, pos: 11 },
        { note: 22, pos: 12 },
        { note: 25, pos: 14 },
        { note: 27, pos: 15 },
        { note: 30, pos: 17 },
        { note: 32, pos: 18 },
        { note: 34, pos: 19 }
    ];
    const maxOffset = 36;

    const keyElements = new Map();

    // Displayed range is centered on currentOctave (middle octave = (currentOctave + 1) * 12)
    function getDisplayedBaseNote() {
        return currentOctave * 12;
    }

    function updateKeyboardHighlights() {
        keyElements.forEach(el => {
            el.classList.remove('pressed');
            el.classList.remove('chord-note');
        });

        const baseNote = getDisplayedBaseNote();
        const state = getState();

        // Highlight chord voicing notes in darker part color
        for (const cNotes of state.activeSoundingChordNotes.values()) {
            for (const cNote of cNotes) {
                const offset = cNote - baseNote;
                if (offset >= 0 && offset <= maxOffset) {
                    const el = keyElements.get(offset);
                    if (el) el.classList.add('chord-note');
                }
            }
        }

        // Highlight physically pressed/latched notes in part color (takes precedence)
        for (const pNote of state.activePressedNotes) {
            const offset = pNote - baseNote;
            if (offset >= 0 && offset <= maxOffset) {
                const el = keyElements.get(offset);
                if (el) {
                    el.classList.remove('chord-note');
                    el.classList.add('pressed');
                }
            }
        }
    }

    function getVoiceSettings() {
        const rawLimit = typeof getVoiceLimit === 'function' ? getVoiceLimit() : 12;
        const voiceLimit = rawLimit === 6 ? 6 : 12;
        const prog = getActiveProgram ? resolveProgram(getActiveProgram) : null;
        if (!prog) {
            return { voiceLimit, modeIndex: 0, unisonVoices: 1, maxKeys: voiceLimit, isLegato: false };
        }
        if (prog.getValue('ARP_OFF_ON')) {
            // Arpeggiator steps through notes one voice at a time, so piano can track unlimited held notes
            return { voiceLimit, modeIndex: 0, unisonVoices: 1, maxKeys: Infinity, isLegato: false };
        }
        const modeIndex = prog.getValue('VCE_MODE') || 0; // 0: Modern, 1: Vintage, 2: Mono, 3: Legato
        const unisonIndex = prog.getValue('VCE_UNISON') || 0; // 0: 1, 1: 2, 2: 3, 3: 6
        const unisonVoices = [1, 2, 3, 6][unisonIndex] || 1;
        const isMonoMode = modeIndex === 2 || modeIndex === 3;
        const maxKeys = isMonoMode ? 1 : Math.max(1, Math.floor(voiceLimit / unisonVoices));
        return { voiceLimit, modeIndex, unisonVoices, maxKeys, isLegato: modeIndex === 3 };
    }

    function getMaxActiveKeys() {
        return getVoiceSettings().maxKeys;
    }

    function sendNoteForSlot(slot, noteNumber, vel, on) {
        if (slot === activeSlot || typeof midiManager.activeSlot !== 'number') {
            midiManager.sendNote(noteNumber, vel, on);
            return;
        }
        const prevSlot = midiManager.activeSlot;
        midiManager.activeSlot = slot;
        try {
            midiManager.sendNote(noteNumber, vel, on);
        } finally {
            midiManager.activeSlot = prevSlot;
        }
    }

    function releaseNote(noteNumber, slot = activeSlot) {
        const state = getState(slot);
        state.physicallyHeldNotes.delete(noteNumber);
        if (!state.activePressedNotes.has(noteNumber)) return;

        state.activePressedNotes.delete(noteNumber);
        sendNoteForSlot(slot, noteNumber, 0, false);

        const chordNotes = state.activeSoundingChordNotes.get(noteNumber) || [];
        for (const cNote of chordNotes) {
            sendNoteForSlot(slot, cNote, 0, false);
        }
        state.activeSoundingChordNotes.delete(noteNumber);

        if (slot === activeSlot) {
            updateKeyboardHighlights();
        }
    }

    function enforceVoiceLimit(targetMax = getMaxActiveKeys(), slot = activeSlot) {
        const state = getState(slot);
        while (state.activePressedNotes.size > targetMax) {
            const oldest = state.activePressedNotes.values().next().value;
            releaseNote(oldest, slot);
        }
    }

    function noteOn(noteNumber) {
        const state = getState();
        if (!state.latchActive && isArpLatchActive()) {
            // In arp-latch mode without global latch, a new note/group replaces previously latched notes
            if (state.physicallyHeldNotes.size === 0 && state.activePressedNotes.size > 0) {
                releaseAllNotes();
            }
            state.physicallyHeldNotes.add(noteNumber);
            if (state.activePressedNotes.has(noteNumber)) return;
        } else {
            state.physicallyHeldNotes.add(noteNumber);
            if (state.activePressedNotes.has(noteNumber)) {
                if (state.latchActive) {
                    releaseNote(noteNumber);
                }
                return;
            }
        }

        const { maxKeys, isLegato } = getVoiceSettings();
        if (!isLegato && state.activePressedNotes.size >= maxKeys) {
            enforceVoiceLimit(maxKeys - 1);
        }

        state.activePressedNotes.add(noteNumber);
        midiManager.sendNote(noteNumber, velocity, true);

        const prog = getActiveProgram ? resolveProgram(getActiveProgram) : null;
        if (prog) {
            const { chordNotes } = computeChorderNotes(noteNumber, prog);
            state.activeSoundingChordNotes.set(noteNumber, chordNotes);
            for (const cNote of chordNotes) {
                midiManager.sendNote(cNote, velocity, true);
            }
        } else {
            state.activeSoundingChordNotes.set(noteNumber, []);
        }

        if (isLegato && state.activePressedNotes.size > maxKeys) {
            enforceVoiceLimit(maxKeys);
        }

        updateKeyboardHighlights();
    }

    function isArpLatchActive() {
        const prog = getActiveProgram ? resolveProgram(getActiveProgram) : null;
        return !!(prog && prog.getValue('ARP_OFF_ON') && prog.getValue('ARP_LATCH'));
    }

    function isAnyLatchActive(slot = activeSlot) {
        const state = getState(slot);
        return state.latchActive || (slot === activeSlot && isArpLatchActive());
    }

    function noteOff(noteNumber, slot = activeSlot) {
        const state = getState(slot);
        state.physicallyHeldNotes.delete(noteNumber);
        if (isAnyLatchActive(slot)) return;
        releaseNote(noteNumber, slot);
    }

    function releaseAllNotes(slot = activeSlot) {
        const state = getState(slot);
        for (const note of Array.from(state.activePressedNotes)) {
            sendNoteForSlot(slot, note, 0, false);
        }
        for (const cNotes of state.activeSoundingChordNotes.values()) {
            for (const cNote of cNotes) {
                sendNoteForSlot(slot, cNote, 0, false);
            }
        }
        state.activePressedNotes.clear();
        state.physicallyHeldNotes.clear();
        state.activeSoundingChordNotes.clear();
        if (slot === activeSlot) {
            updateKeyboardHighlights();
        }
    }

    // Render white keys
    const whiteContainer = document.createElement('div');
    whiteContainer.className = 'keys-white-row';

    whiteKeys.forEach((offset) => {
        const key = document.createElement('div');
        key.className = 'key key-white';
        key.setAttribute('data-offset', offset);
        whiteContainer.appendChild(key);
        keyElements.set(offset, key);

        key.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            const note = getDisplayedBaseNote() + offset;
            key.setAttribute('data-active-note', String(note));
            noteOn(note);
        });
        key.addEventListener('pointerup', () => {
            const noteAttr = key.getAttribute('data-active-note');
            const note = noteAttr !== null ? parseInt(noteAttr, 10) : (getDisplayedBaseNote() + offset);
            key.removeAttribute('data-active-note');
            noteOff(note);
        });
        key.addEventListener('pointerleave', () => {
            const noteAttr = key.getAttribute('data-active-note');
            if (noteAttr !== null) {
                const note = parseInt(noteAttr, 10);
                key.removeAttribute('data-active-note');
                noteOff(note);
            }
        });
    });

    // Render black keys
    const blackContainer = document.createElement('div');
    blackContainer.className = 'keys-black-row';

    blackKeys.forEach(({ note: offset, pos }) => {
        const key = document.createElement('div');
        key.className = 'key key-black';
        key.style.left = `${(pos + 1) * (100 / whiteKeys.length)}%`;
        key.setAttribute('data-offset', offset);
        blackContainer.appendChild(key);
        keyElements.set(offset, key);

        key.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const note = getDisplayedBaseNote() + offset;
            key.setAttribute('data-active-note', String(note));
            noteOn(note);
        });
        key.addEventListener('pointerup', () => {
            const noteAttr = key.getAttribute('data-active-note');
            const note = noteAttr !== null ? parseInt(noteAttr, 10) : (getDisplayedBaseNote() + offset);
            key.removeAttribute('data-active-note');
            noteOff(note);
        });
        key.addEventListener('pointerleave', () => {
            const noteAttr = key.getAttribute('data-active-note');
            if (noteAttr !== null) {
                const note = parseInt(noteAttr, 10);
                key.removeAttribute('data-active-note');
                noteOff(note);
            }
        });
    });

    kbdWrapper.appendChild(whiteContainer);
    kbdWrapper.appendChild(blackContainer);

    const kbdArea = document.createElement('div');
    kbdArea.className = 'audition-keyboard-area';
    const hint = document.createElement('div');
    hint.className = 'audition-hint';
    hint.title = 'Playable via computer keys A-K (middle octave), Z/X for octave';
    hint.textContent = '⌨️ Keys: A-K';
    kbdArea.appendChild(hint);
    kbdArea.appendChild(kbdWrapper);

    container.appendChild(controls);
    container.appendChild(kbdArea);

    // Octave controls
    const octDisplay = controls.querySelector('#oct-display');
    const octDown = controls.querySelector('#oct-down');
    if (octDown) {
        octDown.addEventListener('click', () => {
            if (currentOctave > 0) {
                currentOctave--;
                if (octDisplay) octDisplay.textContent = `Oct ${currentOctave}`;
                updateKeyboardHighlights();
            }
        });
    }

    const octUp = controls.querySelector('#oct-up');
    if (octUp) {
        octUp.addEventListener('click', () => {
            if (currentOctave < 7) {
                currentOctave++;
                if (octDisplay) octDisplay.textContent = `Oct ${currentOctave}`;
                updateKeyboardHighlights();
            }
        });
    }

    // Latch toggle (per active part)
    const latchBtn = controls.querySelector('#kbd-latch');
    if (latchBtn) {
        latchBtn.addEventListener('click', () => {
            const state = getState();
            state.latchActive = !state.latchActive;
            latchBtn.classList.toggle('active', state.latchActive);
            if (!isAnyLatchActive()) {
                releaseAllNotes();
            }
        });
    }

    function resetLatchAndNotes(slot = activeSlot) {
        const state = getState(slot);
        state.latchActive = false;
        if (slot === activeSlot && latchBtn) {
            latchBtn.classList.remove('active');
        }
        releaseAllNotes(slot);
    }

    function resetAllLatchAndNotes() {
        resetLatchAndNotes(0);
        resetLatchAndNotes(1);
    }

    // MIDI Panic (All Notes Off)
    const panicBtn = controls.querySelector('#kbd-panic');
    if (panicBtn) {
        panicBtn.addEventListener('click', () => {
            resetAllLatchAndNotes();
            if (typeof midiManager.sendAllNotesOff === 'function') {
                midiManager.sendAllNotesOff();
            } else if (midiManager.outPort) {
                const ch = midiManager.targetChannel;
                midiManager.outPort.send(new Uint8Array([0xB0 | ch, 123, 0]));
            }
        });
    }

    // Pitch wheel (snaps to center on release)
    const pitchSlider = controls.querySelector('#pitch-wheel');
    if (pitchSlider) {
        pitchSlider.addEventListener('input', () => {
            const val = parseInt(pitchSlider.value, 10);
            if (midiManager.outPort) {
                const ch = midiManager.targetChannel;
                midiManager.outPort.send(new Uint8Array([0xE0 | ch, val & 127, (val >> 7) & 127]));
            }
        });
        pitchSlider.addEventListener('pointerup', () => {
            pitchSlider.value = 8192;
            if (midiManager.outPort) {
                const ch = midiManager.targetChannel;
                midiManager.outPort.send(new Uint8Array([0xE0 | ch, 0, 64]));
            }
        });
    }

    // Modulation wheel
    const modSlider = controls.querySelector('#mod-wheel');
    if (modSlider) {
        modSlider.addEventListener('input', () => {
            const val = parseInt(modSlider.value, 10);
            if (midiManager.outPort) {
                const ch = midiManager.targetChannel;
                midiManager.outPort.send(new Uint8Array([0xB0 | ch, 1, val & 127]));
            }
        });
    }

    // QWERTY Keyboard Note Mapping
    const KEY_NOTE_MAP = {
        'KeyA': 0,  // C
        'KeyW': 1,  // C#
        'KeyS': 2,  // D
        'KeyE': 3,  // D#
        'KeyD': 4,  // E
        'KeyF': 5,  // F
        'KeyT': 6,  // F#
        'KeyG': 7,  // G
        'KeyY': 8,  // G#
        'KeyH': 9,  // A
        'KeyU': 10, // A#
        'KeyJ': 11, // B
        'KeyK': 12, // C (+1)
        'KeyO': 13, // C# (+1)
        'KeyL': 14  // D (+1)
    };

    const activeQwertyNotes = new Map(); // e.code -> noteNumber

    if (typeof window !== 'undefined') {
        window.addEventListener('keydown', (e) => {
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            const activeTag = document.activeElement ? document.activeElement.tagName : '';
            if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;

            if (e.code === 'KeyZ') {
                if (currentOctave > 0) {
                    currentOctave--;
                    octDisplay.textContent = `Oct ${currentOctave}`;
                    updateKeyboardHighlights();
                }
            } else if (e.code === 'KeyX') {
                if (currentOctave < 7) {
                    currentOctave++;
                    octDisplay.textContent = `Oct ${currentOctave}`;
                    updateKeyboardHighlights();
                }
            } else if (e.code === 'Space') {
                e.preventDefault();
                latchBtn.click();
            } else if (e.key === '!') {
                e.preventDefault();
                if (panicBtn) panicBtn.click();
            } else if (KEY_NOTE_MAP[e.code] !== undefined && !activeQwertyNotes.has(e.code)) {
                e.preventDefault();
                const note = (currentOctave + 1) * 12 + KEY_NOTE_MAP[e.code];
                activeQwertyNotes.set(e.code, { note, slot: activeSlot });
                noteOn(note);
            }
        });

        window.addEventListener('keyup', (e) => {
            const activeTag = document.activeElement ? document.activeElement.tagName : '';
            if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;

            if (activeQwertyNotes.has(e.code)) {
                e.preventDefault();
                const entry = activeQwertyNotes.get(e.code);
                activeQwertyNotes.delete(e.code);
                noteOff(entry.note, entry.slot);
            }
        });
    }

    container.getCurrentOctave = () => currentOctave;
    container.setOctave = (oct) => {
        currentOctave = Math.max(0, Math.min(7, oct));
        if (octDisplay) octDisplay.textContent = `Oct ${currentOctave}`;
        updateKeyboardHighlights();
    };
    container.setActivePart = (slot) => {
        const nextSlot = slot === 1 ? 1 : 0;
        if (nextSlot !== activeSlot) {
            getState().physicallyHeldNotes.clear();
            activeSlot = nextSlot;
        }
        container.classList.toggle('part-b', activeSlot === 1);
        if (latchBtn) {
            latchBtn.classList.toggle('active', getState().latchActive);
        }
        updateKeyboardHighlights();
    };
    container.getActivePart = () => activeSlot;
    container.noteOn = noteOn;
    container.noteOff = noteOff;
    container.getActiveNotes = (slot = activeSlot) => Array.from(getState(slot).activePressedNotes);
    container.getMaxActiveKeys = getMaxActiveKeys;
    container.enforceVoiceLimit = () => enforceVoiceLimit();
    container.releaseIfUnlatched = () => {
        if (!isAnyLatchActive()) releaseAllNotes();
    };
    container.updateKeyboardHighlights = updateKeyboardHighlights;
    container.resetLatchAndNotes = resetLatchAndNotes;
    container.resetAllLatchAndNotes = resetAllLatchAndNotes;

    return container;
}

if (typeof globalThis !== 'undefined') {
    globalThis.ICON_COPY_SVG = ICON_COPY_SVG;
    globalThis.ICON_PASTE_SVG = ICON_PASTE_SVG;
    globalThis.ICON_RANDOM_SVG = ICON_RANDOM_SVG;
    globalThis.ICON_RESET_SVG = ICON_RESET_SVG;
    globalThis.computeChorderNotes = computeChorderNotes;
    globalThis.SCALE_INTERVALS = SCALE_INTERVALS;
}

