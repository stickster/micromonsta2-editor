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


/**
 * Resolves a program reference which can be either an MM2Program instance or a dynamic provider function
 */
function resolveProgram(program) {
    return typeof program === 'function' ? program() : program;
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

    for (const [role, val] of Object.entries(currentSectionClipboard.data)) {
        const dstKey = dstParams[role];
        if (dstKey) {
            let clampedVal = val;
            if (targetType === 'osc' && role === 'algo' && targetIndex === 1 && clampedVal > 15) {
                clampedVal = 15;
            }
            program.setValue(dstKey, clampedVal);
            if (onChangeCallback) onChangeCallback(dstKey, clampedVal);
        }
    }
    return true;
}

function copySection(sourceType, sourceIndex, targetType, targetIndex, program, onChangeCallback) {
    program = resolveProgram(program);
    if (!program || sourceType !== targetType) return false;
    const def = SECTION_DEFINITIONS[sourceType];
    if (!def) return false;

    const srcParams = def.getParams(sourceIndex);
    const dstParams = def.getParams(targetIndex);

    for (const [role, srcKey] of Object.entries(srcParams)) {
        const dstKey = dstParams[role];
        if (dstKey && srcKey) {
            let val = program.getValue(srcKey);
            if (sourceType === 'osc' && role === 'algo' && targetIndex === 1 && val > 15) {
                val = 15;
            }
            program.setValue(dstKey, val);
            if (onChangeCallback) onChangeCallback(dstKey, val);
        }
    }
    return true;
}

function resetSectionToInit(sectionType, sectionIndex, program, onChangeCallback) {
    program = resolveProgram(program);
    const def = SECTION_DEFINITIONS[sectionType];
    if (!def || !program) return;
    const params = def.getParams(sectionIndex);
    for (const paramKey of Object.values(params)) {
        const pDef = PARAM_MAP.get(paramKey);
        if (pDef) {
            const defVal = pDef.default ?? 0;
            program.setValue(paramKey, defVal);
            if (onChangeCallback) onChangeCallback(paramKey, defVal);
        }
    }
}

function randomizeSection(sectionType, sectionIndex, program, onChangeCallback) {
    program = resolveProgram(program);
    const def = SECTION_DEFINITIONS[sectionType];
    if (!def || !def.randomize || !program) return;
    const randomized = def.randomize(program, sectionIndex);
    for (const [paramKey, val] of Object.entries(randomized)) {
        program.setValue(paramKey, val);
        if (onChangeCallback) onChangeCallback(paramKey, val);
    }
}

/**
 * Creates an interactive rotary knob element
 */
function createKnob(paramKey, program, onChangeCallback, opts = {}) {
    const def = PARAM_MAP.get(paramKey);
    if (!def) {
        console.warn(`Cannot create knob for unknown parameter: ${paramKey}`);
        const div = document.createElement('div');
        div.textContent = paramKey;
        return div;
    }

    const container = document.createElement('div');
    const isLarge = !!opts.large;
    const isSmall = !!opts.small;
    container.className = `knob-container ${isLarge ? 'knob-large' : ''} ${isSmall ? 'knob-small' : ''}`;
    container.setAttribute('data-param', paramKey);
    container.setAttribute('tabindex', '0');
    container.title = `${def.title || def.label || paramKey} (Default: ${formatParamDisplay(def, def.default ?? 0)}) • Double-click/Right-click to reset • Click value to type`;

    const min = def.min ?? 0;
    const max = def.max ?? (def.values ? def.values.length - 1 : 127);
    const range = Math.max(1, Math.abs(max - min));
    const isBipolar = (min < 0) || (def.offset && def.offset > 0);

    const dialWrap = document.createElement('div');
    dialWrap.className = 'knob-dial';

    const size = isLarge ? 58 : (isSmall ? 36 : 44);
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

    container.appendChild(dialWrap);
    container.appendChild(labelEl);
    container.appendChild(valueEl);

    const ctx = canvas.getContext ? canvas.getContext('2d') : null;
    const getProg = () => resolveProgram(program);

    function drawKnob() {
        if (!ctx) return;
        const prog = getProg();
        const val = prog ? prog.getValue(paramKey) : (def.default ?? 0);
        const norm = (val - min) / range;
        const clampedNorm = Math.min(Math.max(norm, 0), 1);

        const w = canvas.width;
        const h = canvas.height;
        const cx = w / 2;
        const cy = h / 2;
        const r = (w / 2) - 6;

        ctx.clearRect(0, 0, w, h);

        // 1. Outer Track Arc (from 135 deg to 405 deg, 270 deg span)
        const startRad = (135 * Math.PI) / 180;
        const endRad = (405 * Math.PI) / 180;
        const trackWidth = isLarge ? 7 : (isSmall ? 4 : 5);

        ctx.lineWidth = trackWidth;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#222630';
        ctx.beginPath();
        ctx.arc(cx, cy, r, startRad, endRad, false);
        ctx.stroke();

        // 2. Active Gauge Arc (Audiothingies orange #f76d22 or cyan for bipolar / mod)
        const gaugeColor = opts.color || (isBipolar ? '#00d2ff' : '#f76d22');
        ctx.strokeStyle = gaugeColor;

        if (isBipolar) {
            const centerRad = (270 * Math.PI) / 180; // 12 o'clock
            const curRad = startRad + clampedNorm * (270 * Math.PI / 180);
            if (Math.abs(curRad - centerRad) > 0.02) {
                ctx.beginPath();
                if (curRad >= centerRad) {
                    ctx.arc(cx, cy, r, centerRad, curRad, false);
                } else {
                    ctx.arc(cx, cy, r, curRad, centerRad, false);
                }
                ctx.stroke();
            }
        } else {
            const curRad = startRad + clampedNorm * (270 * Math.PI / 180);
            if (clampedNorm > 0.01) {
                ctx.beginPath();
                ctx.arc(cx, cy, r, startRad, curRad, false);
                ctx.stroke();
            }
        }

        // 3. Shaded Knob Cap (Metallic brushed gradient)
        const capR = r - (isLarge ? 9 : (isSmall ? 5 : 7));
        ctx.beginPath();
        ctx.arc(cx, cy, capR, 0, Math.PI * 2);
        if (ctx.createConicGradient) {
            const grad = ctx.createConicGradient(0, cx, cy);
            grad.addColorStop(0, '#16181f');
            grad.addColorStop(0.25, '#2e3444');
            grad.addColorStop(0.5, '#1b1d24');
            grad.addColorStop(0.75, '#2e3444');
            grad.addColorStop(1, '#16181f');
            ctx.fillStyle = grad;
        } else {
            ctx.fillStyle = '#1e222d';
        }
        ctx.fill();

        // 4. Subtle Outer Border of Cap
        ctx.beginPath();
        ctx.arc(cx, cy, capR, 0, Math.PI * 2);
        ctx.strokeStyle = '#3d4455';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // 5. Beveled Inner Center
        ctx.beginPath();
        ctx.arc(cx, cy, capR * 0.72, 0, Math.PI * 2);
        ctx.fillStyle = '#121418';
        ctx.fill();

        // 6. Pointer Needle Line
        const pointerAngle = -135 + clampedNorm * 270;
        const pointerRad = ((pointerAngle - 90) * Math.PI) / 180;
        const pStart = capR * 0.2;
        const pEnd = capR * 0.88;

        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(pointerRad) * pStart, cy + Math.sin(pointerRad) * pStart);
        ctx.lineTo(cx + Math.cos(pointerRad) * pEnd, cy + Math.sin(pointerRad) * pEnd);
        ctx.lineWidth = isLarge ? 4 : (isSmall ? 2.5 : 3);
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        // Update value text (if not currently focused input)
        if (!valueEl.querySelector('input')) {
            valueEl.textContent = formatParamDisplay(def, val);
        }
    }

    function updateVisual() {
        drawKnob();
    }

    // Dual-axis Drag Interaction (both Vertical and Horizontal drag supported)
    let startX = 0;
    let startY = 0;
    let startVal = 0;
    let isDragging = false;

    function onPointerDown(e) {
        if (e.button === 2) return; // Ignore right-click on pointerdown (handled by contextmenu)
        e.preventDefault();
        startX = e.clientX;
        startY = e.clientY;
        const prog = getProg();
        startVal = prog ? prog.getValue(paramKey) : 0;
        isDragging = true;
        dialWrap.classList.add('active');
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
    }

    function onPointerMove(e) {
        if (!isDragging) return;
        const delta = (startY - e.clientY) + (e.clientX - startX);
        const sensitivity = (e.shiftKey || e.ctrlKey) ? 0.001 : 0.005;
        const deltaVal = delta * sensitivity * range;
        let newVal = Math.round(startVal + deltaVal);
        newVal = Math.min(Math.max(newVal, min), max);

        const prog = getProg();
        if (prog && newVal !== prog.getValue(paramKey)) {
            prog.setValue(paramKey, newVal);
            updateVisual();
            if (onChangeCallback) onChangeCallback(paramKey, newVal);
        }
    }

    function onPointerUp() {
        if (!isDragging) return;
        isDragging = false;
        dialWrap.classList.remove('active');
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
    }

    canvas.addEventListener('pointerdown', onPointerDown);

    // Mouse wheel support
    container.addEventListener('wheel', (e) => {
        e.preventDefault();
        const step = (e.shiftKey || e.ctrlKey) ? 1 : Math.max(1, Math.round(range / 64));
        const dir = e.deltaY < 0 ? 1 : -1;
        const prog = getProg();
        if (prog) {
            let cur = prog.getValue(paramKey);
            let newVal = Math.min(Math.max(cur + dir * step, min), max);
            if (newVal !== cur) {
                prog.setValue(paramKey, newVal);
                updateVisual();
                if (onChangeCallback) onChangeCallback(paramKey, newVal);
            }
        }
    }, { passive: false });

    // Reset helper
    function resetToDefault() {
        const defVal = def.default ?? (isBipolar ? (def.offset ?? min) : min);
        const prog = getProg();
        if (prog) {
            prog.setValue(paramKey, defVal);
            updateVisual();
            if (onChangeCallback) onChangeCallback(paramKey, defVal);
        }
    }

    // Double click to reset
    container.addEventListener('dblclick', (e) => {
        e.preventDefault();
        resetToDefault();
    });

    // Right click (contextmenu) to reset
    container.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        resetToDefault();
    });

    // Hover / Focus Keyboard Stepping (+ / -, Arrow keys)
    container.addEventListener('keydown', (e) => {
        const prog = getProg();
        if (!prog) return;

        if (['ArrowUp', 'ArrowRight', '+', '='].includes(e.key)) {
            e.preventDefault();
            const step = (e.shiftKey || e.ctrlKey) ? 1 : Math.max(1, Math.round(range / 64));
            let newVal = Math.min(max, prog.getValue(paramKey) + step);
            if (newVal !== prog.getValue(paramKey)) {
                prog.setValue(paramKey, newVal);
                updateVisual();
                if (onChangeCallback) onChangeCallback(paramKey, newVal);
            }
        } else if (['ArrowDown', 'ArrowLeft', '-', '_'].includes(e.key)) {
            e.preventDefault();
            const step = (e.shiftKey || e.ctrlKey) ? 1 : Math.max(1, Math.round(range / 64));
            let newVal = Math.max(min, prog.getValue(paramKey) - step);
            if (newVal !== prog.getValue(paramKey)) {
                prog.setValue(paramKey, newVal);
                updateVisual();
                if (onChangeCallback) onChangeCallback(paramKey, newVal);
            }
        } else if (e.key === 'Home') {
            e.preventDefault();
            prog.setValue(paramKey, min);
            updateVisual();
            if (onChangeCallback) onChangeCallback(paramKey, min);
        } else if (e.key === 'End') {
            e.preventDefault();
            prog.setValue(paramKey, max);
            updateVisual();
            if (onChangeCallback) onChangeCallback(paramKey, max);
        }
    });

    // Click-to-Type Value Editing
    valueEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (valueEl.querySelector('input')) return;

        const prog = getProg();
        const curVal = prog ? prog.getValue(paramKey) : 0;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'knob-value-input';
        input.value = curVal + (def.displayOffset || 0);

        valueEl.textContent = '';
        valueEl.appendChild(input);
        input.focus();
        input.select();

        let committed = false;
        function commit() {
            if (committed) return;
            committed = true;
            const raw = input.value.trim();
            let parsed = parseInt(raw, 10);
            if (!isNaN(parsed)) {
                parsed -= (def.displayOffset || 0);
                if (def.offset && (raw.startsWith('+') || raw.startsWith('-'))) {
                    parsed = parsed + def.offset;
                }
                parsed = Math.min(Math.max(parsed, min), max);
                const currentProg = getProg();
                if (currentProg) {
                    currentProg.setValue(paramKey, parsed);
                    if (onChangeCallback) onChangeCallback(paramKey, parsed);
                }
            }
            updateVisual();
        }

        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                commit();
            } else if (ev.key === 'Escape') {
                ev.preventDefault();
                committed = true;
                updateVisual();
            }
        });
        input.addEventListener('blur', commit);
    });

    container.refresh = updateVisual;
    updateVisual();

    return container;
}

/**
 * Creates a select dropdown bound to a parameter
 */
function createSelect(paramKey, program, onChangeCallback) {
    const def = PARAM_MAP.get(paramKey);
    if (!def) return document.createElement('div');

    const container = document.createElement('div');
    container.className = 'select-container';
    container.setAttribute('data-param', paramKey);

    const label = document.createElement('label');
    label.className = 'control-label';
    label.textContent = def.label || paramKey;
    label.title = def.title || paramKey;

    const select = document.createElement('select');
    select.className = 'control-select';

    const min = def.min ?? 0;
    const max = def.max ?? (def.values ? def.values.length - 1 : 127);

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

    const getProg = () => resolveProgram(program);

    function updateVisual() {
        const prog = getProg();
        if (prog) {
            select.value = prog.getValue(paramKey);
        }
    }

    select.addEventListener('change', () => {
        const val = parseInt(select.value, 10);
        const prog = getProg();
        if (prog) {
            prog.setValue(paramKey, val);
        }
        if (onChangeCallback) onChangeCallback(paramKey, val);
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
    if (def.displayOffset) return `${val + def.displayOffset}`;
    if (def.offset && def.offset > 0) {
        const diff = val - def.offset;
        return diff > 0 ? `+${diff}` : `${diff}`;
    }
    return `${val}`;
}

/**
 * Creates an interactive SVG ADSR curve visualizer for Envelope 1, 2, or 3
 */
function createADSRVisualizer(envNumber, program) {
    const container = document.createElement('div');
    container.className = 'visualizer-box adsr-visualizer';
    container.title = `Envelope ${envNumber} ADSR Curve`;
    container.setAttribute('data-env', envNumber);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 160 48');
    svg.setAttribute('class', 'visualizer-svg');

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const gradId = `adsr-grad-${envNumber}-${Math.random().toString(36).substring(2, 6)}`;
    defs.innerHTML = `
        <linearGradient id="${gradId}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="var(--accent-cyan)" stop-opacity="0.4" />
            <stop offset="100%" stop-color="var(--accent-cyan)" stop-opacity="0.02" />
        </linearGradient>
    `;
    svg.appendChild(defs);

    const pathBg = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathBg.setAttribute('class', 'adsr-fill');
    pathBg.setAttribute('fill', `url(#${gradId})`);

    const pathLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathLine.setAttribute('class', 'adsr-stroke');

    svg.appendChild(pathBg);
    svg.appendChild(pathLine);
    container.appendChild(svg);

    const getProg = () => resolveProgram(program);

    function updateVisual() {
        const prog = getProg();
        if (!prog) return;
        const atk = prog.getValue(`ENV${envNumber}_ATK`);
        const dcy = prog.getValue(`ENV${envNumber}_DCY`);
        const sus = prog.getValue(`ENV${envNumber}_SUS`);
        const rel = prog.getValue(`ENV${envNumber}_REL`);

        const padX = 6;
        const totalW = 160 - padX * 2;
        const h = 48;
        const padY = 6;
        const bottomY = h - padY;
        const topY = padY;

        // Stage times (assumed exponential knob taper): 0 -> instant, 1..127 -> ~2 ms .. 10 s.
        const T_MIN = 0.002, T_MAX = 10;
        const toTime = (v) => (v <= 0 ? 0 : T_MIN * Math.pow(T_MAX / T_MIN, (v - 1) / 126));
        const tA = toTime(atk), tD = toTime(dcy), tR = toTime(rel);
        const susNorm = sus / 127;

        // Fixed-length sustain hold, drawn as 25% of the total shown time (min 0.3 s)
        const tSus = Math.max(0.3, (tA + tD + tR) / 3);
        const tTotal = tA + tD + tSus + tR;

        const plotW = 160 - padX * 2;
        const xOf = (t) => padX + (t / tTotal) * plotW;
        const yOf = (lvl) => bottomY - lvl * (bottomY - topY);

        // Analog-style RC segments: each stage runs ~4 time constants (tau = T/4),
        // normalized so the stage lands exactly on its target level.
        const K = 4;
        const norm = 1 - Math.exp(-K);
        const curve = (t0, dur, from, to, steps) => {
            let d = '';
            for (let i = 1; i <= steps; i++) {
                const f = i / steps;
                const e = (1 - Math.exp(-K * f)) / norm; // 0..1 charging curve
                d += ` L ${xOf(t0 + f * dur).toFixed(2)} ${yOf(from + (to - from) * e).toFixed(2)}`;
            }
            return d;
        };

        let strokePath = `M ${padX} ${yOf(0)}`;
        let t = 0;
        // Attack: RC charge 0 -> 1 (concave, fast start)
        if (tA > 0) strokePath += curve(t, tA, 0, 1, 24); else strokePath += ` L ${xOf(0)} ${yOf(1)}`;
        t += tA;
        // Decay: exponential fall 1 -> sustain
        if (tD > 0) strokePath += curve(t, tD, 1, susNorm, 24); else strokePath += ` L ${xOf(t)} ${yOf(susNorm)}`;
        t += tD;
        // Sustain hold
        strokePath += ` L ${xOf(t + tSus).toFixed(2)} ${yOf(susNorm).toFixed(2)}`;
        t += tSus;
        // Release: exponential fall sustain -> 0
        if (tR > 0) strokePath += curve(t, tR, susNorm, 0, 24); else strokePath += ` L ${xOf(t)} ${yOf(0)}`;
        const fillPath = `${strokePath} L ${padX} ${bottomY} Z`;

        pathLine.setAttribute('d', strokePath);
        pathBg.setAttribute('d', fillPath);
    }

    container.refresh = updateVisual;
    updateVisual();
    return container;
}

/**
 * Creates an interactive SVG Filter frequency response curve
 */
function createFilterCurveVisualizer(program) {
    const container = document.createElement('div');
    container.className = 'visualizer-box filter-visualizer';
    container.title = 'Filter Magnitude Response (20 Hz–20 kHz, log; +24 to −48 dB)';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 200 48');
    svg.setAttribute('class', 'visualizer-svg');

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
        <linearGradient id="filter-curve-grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="var(--accent-cyan)" stop-opacity="0.35" />
            <stop offset="100%" stop-color="var(--accent-cyan)" stop-opacity="0.0" />
        </linearGradient>
    `;
    svg.appendChild(defs);

    const pathBg = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathBg.setAttribute('class', 'filter-fill');
    pathBg.setAttribute('fill', 'url(#filter-curve-grad)');

    const pathLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathLine.setAttribute('class', 'filter-stroke');

    const cutoffPoint = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    cutoffPoint.setAttribute('class', 'filter-cutoff-point');
    cutoffPoint.setAttribute('r', '3');

    svg.appendChild(pathBg);
    svg.appendChild(pathLine);
    svg.appendChild(cutoffPoint);
    container.appendChild(svg);

    const getProg = () => resolveProgram(program);

    function updateVisual() {
        const prog = getProg();
        if (!prog) return;
        const freq = prog.getValue('FILTER_FREQ'); // 0..255
        const reso = prog.getValue('FILTER_RESO'); // 0..127
        const algo = prog.getValue('FILTER_ALGO'); // 0..7 (LP1..4, HP2, BP2, Notch, Phaser)

        // Log frequency axis 20 Hz..20 kHz; cutoff knob 0..255 maps log-linearly onto it (assumed).
        const F_MIN = 20, F_MAX = 20000;
        const cutoffHz = F_MIN * Math.pow(F_MAX / F_MIN, freq / 255);
        const normReso = reso / 127;

        const w = 200;
        const x0 = 6, x1 = w - 6;
        const yTop = 4, yBot = 44;
        const DB_MAX = 24, DB_MIN = -48;
        const dbToY = (db) => yBot - ((Math.max(DB_MIN, Math.min(DB_MAX, db)) - DB_MIN) / (DB_MAX - DB_MIN)) * (yBot - yTop);
        const hzToX = (hz) => x0 + (Math.log(hz / F_MIN) / Math.log(F_MAX / F_MIN)) * (x1 - x0);

        // Minimal complex helpers: [re, im]
        const cmul = (p, q) => [p[0] * q[0] - p[1] * q[1], p[0] * q[1] + p[1] * q[0]];
        const cadd = (p, q) => [p[0] + q[0], p[1] + q[1]];
        const cdiv = (p, q) => {
            const d = q[0] * q[0] + q[1] * q[1];
            return [(p[0] * q[0] + p[1] * q[1]) / d, (p[1] * q[0] - p[0] * q[1]) / d];
        };
        const cabs = (p) => Math.hypot(p[0], p[1]);
        const cpow = (p, n) => { let r = [1, 0]; for (let i = 0; i < n; i++) r = cmul(r, p); return r; };

        // Q for 2-pole sections: 0.5 (no peak) up to 20 at max resonance (exponential)
        const Q = 0.5 * Math.pow(40, normReso);

        // Magnitude |H(jΩ)| for normalized frequency Ω = f / fc (analog prototypes)
        function magnitude(omega) {
            const s_ = [0, omega];
            const one = [1, 0];
            const onePlusS = cadd(one, s_);
            const biquad = cadd(cadd(cmul(s_, s_), [0, omega / Q]), one); // s² + s/Q + 1
            switch (algo) {
                case 0: return cabs(cdiv(one, onePlusS)); // 1 pole, 6 dB/oct, no resonance
                case 1: return cabs(cdiv(one, biquad)); // 2 pole, 12 dB/oct
                case 2: { // 3-pole ladder with feedback k (self-oscillates at k = 8)
                    const k = normReso * 8;
                    return cabs(cdiv(one, cadd(cpow(onePlusS, 3), [k, 0])));
                }
                case 3: { // 4-pole ladder with feedback k (self-oscillates at k = 4)
                    const k = normReso * 4;
                    return cabs(cdiv(one, cadd(cpow(onePlusS, 4), [k, 0])));
                }
                case 4: return cabs(cdiv(cmul(s_, s_), biquad)); // 2-pole highpass
                case 5: return cabs(cdiv([0, omega / Q], biquad)); // 2-pole bandpass (peak gain 1)
                case 6: return cabs(cdiv(cadd(cmul(s_, s_), one), biquad)); // notch
                default: { // Phaser: input + 2-stage allpass, notch at cutoff
                    const ap = cdiv([1, -omega], onePlusS);
                    const A = cmul(ap, ap);
                    return cabs(cadd(one, A)) / 2;
                }
            }
        }

        const N = 120;
        let strokePath = '';
        for (let i = 0; i <= N; i++) {
            const x = x0 + (i / N) * (x1 - x0);
            const hz = F_MIN * Math.pow(F_MAX / F_MIN, i / N);
            const db = 20 * Math.log10(Math.max(1e-6, magnitude(hz / cutoffHz)));
            strokePath += `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${dbToY(db).toFixed(2)} `;
        }
        strokePath = strokePath.trim();

        const cutDb = 20 * Math.log10(Math.max(1e-6, magnitude(1)));
        cutoffPoint.setAttribute('cx', hzToX(cutoffHz).toFixed(2));
        cutoffPoint.setAttribute('cy', dbToY(cutDb).toFixed(2));

        const bottomLevel = yBot;
        const fillPath = `${strokePath} L ${x1} ${bottomLevel} L ${x0} ${bottomLevel} Z`;
        pathLine.setAttribute('d', strokePath);
        pathBg.setAttribute('d', fillPath);
    }

    container.refresh = updateVisual;
    updateVisual();
    return container;
}

/**
 * Creates an interactive SVG LFO Waveform Preview
 */
function createLFOWaveformPreview(lfoNumber, program) {
    const container = document.createElement('div');
    container.className = 'visualizer-box lfo-visualizer';
    container.title = `LFO ${lfoNumber} Waveform Preview`;
    container.setAttribute('data-lfo', lfoNumber);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 36');
    svg.setAttribute('class', 'visualizer-svg');

    const pathLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathLine.setAttribute('class', 'lfo-stroke');

    const nameText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    nameText.setAttribute('x', '5');
    nameText.setAttribute('y', '32');
    nameText.setAttribute('class', 'lfo-text');

    svg.appendChild(pathLine);
    svg.appendChild(nameText);
    container.appendChild(svg);

    const getProg = () => resolveProgram(program);

    function updateVisual() {
        const prog = getProg();
        if (!prog) return;
        const wave = prog.getValue(`LFO${lfoNumber}_WAVE`);
        const waveNames = LOOKUPS.lfoWaves;
        nameText.textContent = waveNames[wave] || `Wave ${wave}`;

        const mid = 15;
        const amp = 10;
        const x0 = 6, x1 = 94;
        const speedDef = PARAM_MAP.get(`LFO${lfoNumber}_SPEED`);
        const speed = prog.getValue(`LFO${lfoNumber}_SPEED`);

        // Cycles shown across the window: 1 at slowest speed, up to MAX_CYCLES at fastest (log-compressed).
        const MAX_CYCLES = 12;
        let pos; // 0..1 position along the speed range
        const syncLabel = speedDef && speedDef.values ? speedDef.values[speed] : null;
        if (speed >= 128 && syncLabel) {
            // Tempo-synced divisions: period in whole notes (32/1 slowest ... 64t fastest)
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
            pos = Math.min(1, Math.max(0, speed / 127)); // free-running rate
        }
        const cycles = 1 + Math.round(pos * (MAX_CYCLES - 1)); // whole cycles so the trace ends cleanly

        const yOf = (v) => mid - v * amp; // v in -1..1
        const yUni = (v) => mid + amp - v * 2 * amp; // v in 0..1 spans full height

        // Deterministic pseudo-random value per cycle index (-1..1)
        const rnd = (n) => {
            const r = Math.sin(n * 127.1 + lfoNumber * 311.7) * 43758.5453;
            return (r - Math.floor(r)) * 2 - 1;
        };

        const periodic = (fn) => {
            const N = 360;
            let out = '';
            for (let i = 0; i <= N; i++) {
                const f = i / N;
                const ph = f * cycles;
                out += `${i === 0 ? 'M' : 'L'} ${(x0 + f * (x1 - x0)).toFixed(2)} ${fn(ph).toFixed(2)} `;
            }
            return out.trim();
        };
        const frac = (v) => v - Math.floor(v);
        let d = '';

        switch (wave) {
            case 0: // Sine
                d = periodic((ph) => yOf(Math.sin(2 * Math.PI * ph)));
                break;
            case 1: // Triangle (starts at 0, rising)
                d = periodic((ph) => {
                    const f = frac(ph);
                    return yOf(f < 0.25 ? 4 * f : f < 0.75 ? 2 - 4 * f : 4 * f - 4);
                });
                break;
            case 2: // Sawtooth (ramp up, snap down)
                d = periodic((ph) => yOf(2 * frac(ph + 0.5) - 1));
                break;
            case 3: // Square (50% duty)
                d = periodic((ph) => yOf(frac(ph) < 0.5 ? 1 : -1));
                break;
            case 4: // S&H Bipolar: new random level each cycle, held
            case 17: { // S&H Unipolar
                const uni = wave === 17;
                d = periodic((ph) => {
                    const v = rnd(Math.floor(ph));
                    return uni ? yUni((v + 1) / 2) : yOf(v);
                });
                break;
            }
            case 5: // Random Bipolar: smooth interpolation between random levels
            case 18: { // Random Unipolar
                const uni = wave === 18;
                d = periodic((ph) => {
                    const n = Math.floor(ph);
                    const f = frac(ph);
                    const sm = f * f * (3 - 2 * f);
                    const v = rnd(n) + (rnd(n + 1) - rnd(n)) * sm;
                    return uni ? yUni((v + 1) / 2) : yOf(v);
                });
                break;
            }
            case 6: case 7: case 8: // Attack A/B/C
                d = `M 6 ${mid + amp} Q 50 ${mid + amp} 94 ${mid - amp}`;
                break;
            case 9: case 10: case 11: // Decay A/B/C
                d = `M 6 ${mid - amp} Q 50 ${mid + amp} 94 ${mid + amp}`;
                break;
            case 12: case 13: case 14: // Attack-Decay A/B/C
                d = `M 6 ${mid + amp} Q 30 ${mid - amp} 50 ${mid - amp} Q 70 ${mid - amp} 94 ${mid + amp}`;
                break;
            case 15: // Square 1 > 0
                d = `M 6 ${mid - amp} L 65 ${mid - amp} L 65 ${mid + amp} L 94 ${mid + amp}`;
                break;
            case 16: // Square 0 > 1
                d = `M 6 ${mid + amp} L 65 ${mid + amp} L 65 ${mid - amp} L 94 ${mid - amp}`;
                break;
            default:
                d = periodic(() => mid);
                break;
        }

        pathLine.setAttribute('d', d);
    }

    container.refresh = updateVisual;
    updateVisual();
    return container;
}

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

    const titleGroup = document.createElement('div');
    titleGroup.className = 'card-title-group';
    titleGroup.setAttribute('draggable', 'true');
    titleGroup.title = 'Drag to copy settings to another section of the same type';

    const dragHandle = document.createElement('span');
    dragHandle.className = 'card-drag-handle';
    dragHandle.textContent = '⋮⋮';

    const titleText = document.createElement('span');
    titleText.className = 'card-title-text';
    titleText.textContent = title;

    titleGroup.appendChild(dragHandle);
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
            <div class="menu-item" data-action="copy">📋 Copy Section</div>
            <div class="menu-item ${canPaste ? '' : 'disabled'}" data-action="paste">📥 Paste Section</div>
            <div class="menu-item" data-action="reset">↺ Reset to Defaults</div>
            <div class="menu-item" data-action="randomize">🎲 Smart Randomize</div>
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

    // Section Drag-and-Drop Setup
    titleGroup.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({
            kind: 'section',
            sectionType,
            sectionIndex
        }));
        card.classList.add('is-dragging');
        document.querySelectorAll(`.synth-card[data-section-type="${sectionType}"]`).forEach(c => {
            if (c !== card) c.classList.add('valid-drop-target');
        });
    });

    titleGroup.addEventListener('dragend', () => {
        card.classList.remove('is-dragging');
        document.querySelectorAll('.valid-drop-target').forEach(c => c.classList.remove('valid-drop-target'));
        document.querySelectorAll('.drop-hover').forEach(c => c.classList.remove('drop-hover'));
    });

    card.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (card.classList.contains('valid-drop-target')) {
            card.classList.add('drop-hover');
        }
    });

    card.addEventListener('dragleave', () => {
        card.classList.remove('drop-hover');
    });

    card.addEventListener('drop', (e) => {
        e.preventDefault();
        card.classList.remove('drop-hover');
        try {
            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
            if (data.kind === 'section' && data.sectionType === sectionType && data.sectionIndex !== sectionIndex) {
                copySection(data.sectionType, data.sectionIndex, sectionType, sectionIndex, program, onChangeCallback);
                card.refresh();
                if (window.app && window.app.showNotification) {
                    window.app.showNotification(`Copied Section ${data.sectionIndex} to ${sectionIndex}`, 'success');
                }
            }
        } catch (err) {}
    });

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
    titleSpan.textContent = '16-Step Pattern Sequencer';
    header.appendChild(titleSpan);

    const toolsDiv = document.createElement('div');
    toolsDiv.className = 'sequencer-tools';

    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn btn-sm btn-subtle';
    clearBtn.id = 'seq-clear-btn';
    clearBtn.title = 'Clear all steps to Off';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', () => {
        const prog = getProg();
        if (prog) {
            for (let i = 1; i <= 16; i++) {
                const numStr = i.toString().padStart(2, '0');
                prog.setValue(`ARP_PTN_STEP${numStr}`, 1); // Off
                if (onChangeCallback) onChangeCallback(`ARP_PTN_STEP${numStr}`, 1);
            }
        }
        container.refresh();
    });
    toolsDiv.appendChild(clearBtn);

    const fillBtn = document.createElement('button');
    fillBtn.className = 'btn btn-sm btn-subtle';
    fillBtn.id = 'seq-fill-btn';
    fillBtn.title = 'Fill all steps with Auto';
    fillBtn.textContent = 'Fill';
    fillBtn.addEventListener('click', () => {
        const prog = getProg();
        if (prog) {
            for (let i = 1; i <= 16; i++) {
                const numStr = i.toString().padStart(2, '0');
                prog.setValue(`ARP_PTN_STEP${numStr}`, 0); // Auto
                if (onChangeCallback) onChangeCallback(`ARP_PTN_STEP${numStr}`, 0);
            }
        }
        container.refresh();
    });
    toolsDiv.appendChild(fillBtn);

    const randBtn = document.createElement('button');
    randBtn.className = 'btn btn-sm btn-subtle';
    randBtn.id = 'seq-random-btn';
    randBtn.title = 'Generate musical random pattern';
    randBtn.textContent = 'Random';
    randBtn.addEventListener('click', () => {
        const pool = [0, 0, 1, 2, 4, 5, 6, 11]; // Musical probability weights
        const prog = getProg();
        if (prog) {
            for (let i = 1; i <= 16; i++) {
                const numStr = i.toString().padStart(2, '0');
                const stepMode = pool[Math.floor(Math.random() * pool.length)];
                const modLvl = Math.floor(Math.random() * 4);
                prog.setValue(`ARP_PTN_STEP${numStr}`, stepMode);
                prog.setValue(`ARP_PTN_STEP_MOD${numStr}`, modLvl);
                if (onChangeCallback) {
                    onChangeCallback(`ARP_PTN_STEP${numStr}`, stepMode);
                    onChangeCallback(`ARP_PTN_STEP_MOD${numStr}`, modLvl);
                }
            }
        }
        container.refresh();
    });
    toolsDiv.appendChild(randBtn);

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

        const stepNum = document.createElement('div');
        stepNum.className = 'step-number';
        stepNum.textContent = i;

        const modeBtn = document.createElement('select');
        modeBtn.className = 'step-mode-btn';
        modeBtn.title = `Step ${i} note mode`;
        STEP_MODES.forEach((txt, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = txt;
            modeBtn.appendChild(opt);
        });

        const modBtn = document.createElement('select');
        modBtn.className = 'step-mod-btn';
        modBtn.title = `Step ${i} modulation level`;
        MOD_LEVELS.forEach((txt, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = txt;
            modBtn.appendChild(opt);
        });

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
                const next = parseInt(modeBtn.value, 10);
                prog.setValue(stepKey, next);
                updateStep();
                if (onChangeCallback) onChangeCallback(stepKey, next);
            }
        });

        modBtn.addEventListener('change', () => {
            const prog = getProg();
            if (prog) {
                const next = parseInt(modBtn.value, 10);
                prog.setValue(modKey, next);
                updateStep();
                if (onChangeCallback) onChangeCallback(modKey, next);
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

/**
 * Creates an interactive audition keyboard (Mouse, Touch, and Computer Keyboard QWERTY input)
 */
function createKeyboard(midiManager) {
    const container = document.createElement('div');
    container.className = 'audition-bar';

    let currentOctave = 3;
    let velocity = 100;
    let latchActive = false;

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
        <div class="audition-hint" title="Playable via computer keys A-K, Z/X for octave">⌨️ Keys: A-K</div>
    `;

    const kbdWrapper = document.createElement('div');
    kbdWrapper.className = 'keyboard-wrapper';

    // 25 keys: 2 octaves from C to C
    const whiteKeys = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24];
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
        { note: 22, pos: 12 }
    ];

    const activeNotes = new Set();
    const keyElements = new Map();

    function noteOn(noteNumber) {
        if (activeNotes.has(noteNumber)) return;
        activeNotes.add(noteNumber);
        midiManager.sendNote(noteNumber, velocity, true);
        const el = keyElements.get(noteNumber % 24);
        if (el) el.classList.add('pressed');
    }

    function noteOff(noteNumber) {
        if (!activeNotes.has(noteNumber)) return;
        if (latchActive) return; // Keep sounding if latched
        activeNotes.delete(noteNumber);
        midiManager.sendNote(noteNumber, 0, false);
        const el = keyElements.get(noteNumber % 24);
        if (el) el.classList.remove('pressed');
    }

    function releaseAllNotes() {
        for (const note of Array.from(activeNotes)) {
            midiManager.sendNote(note, 0, false);
            activeNotes.delete(note);
        }
        keyElements.forEach(el => el.classList.remove('pressed'));
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
            const note = (currentOctave + 1) * 12 + offset;
            noteOn(note);
        });
        key.addEventListener('pointerup', () => {
            const note = (currentOctave + 1) * 12 + offset;
            noteOff(note);
        });
        key.addEventListener('pointerleave', () => {
            const note = (currentOctave + 1) * 12 + offset;
            noteOff(note);
        });
    });

    // Render black keys
    const blackContainer = document.createElement('div');
    blackContainer.className = 'keys-black-row';

    blackKeys.forEach(({ note: offset, pos }) => {
        const key = document.createElement('div');
        key.className = 'key key-black';
        key.style.left = `${(pos + 1) * (100 / 15) - (100 / 30)}%`;
        key.setAttribute('data-offset', offset);
        blackContainer.appendChild(key);
        keyElements.set(offset, key);

        key.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const note = (currentOctave + 1) * 12 + offset;
            noteOn(note);
        });
        key.addEventListener('pointerup', () => {
            const note = (currentOctave + 1) * 12 + offset;
            noteOff(note);
        });
        key.addEventListener('pointerleave', () => {
            const note = (currentOctave + 1) * 12 + offset;
            noteOff(note);
        });
    });

    kbdWrapper.appendChild(whiteContainer);
    kbdWrapper.appendChild(blackContainer);

    container.appendChild(controls);
    container.appendChild(kbdWrapper);

    // Octave controls
    const octDisplay = controls.querySelector('#oct-display');
    controls.querySelector('#oct-down').addEventListener('click', () => {
        if (currentOctave > 0) {
            currentOctave--;
            octDisplay.textContent = `Oct ${currentOctave}`;
        }
    });
    controls.querySelector('#oct-up').addEventListener('click', () => {
        if (currentOctave < 7) {
            currentOctave++;
            octDisplay.textContent = `Oct ${currentOctave}`;
        }
    });

    // Latch toggle
    const latchBtn = controls.querySelector('#kbd-latch');
    latchBtn.addEventListener('click', () => {
        latchActive = !latchActive;
        latchBtn.classList.toggle('active', latchActive);
        if (!latchActive) {
            releaseAllNotes();
        }
    });

    // Pitch wheel (snaps to center on release)
    const pitchSlider = controls.querySelector('#pitch-wheel');
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

    // Modulation wheel
    const modSlider = controls.querySelector('#mod-wheel');
    modSlider.addEventListener('input', () => {
        const val = parseInt(modSlider.value, 10);
        if (midiManager.outPort) {
            const ch = midiManager.targetChannel;
            midiManager.outPort.send(new Uint8Array([0xB0 | ch, 1, val & 127]));
        }
    });

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

    if (typeof window !== 'undefined') {
        window.addEventListener('keydown', (e) => {
            const activeTag = document.activeElement ? document.activeElement.tagName : '';
            if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;

            if (e.code === 'KeyZ') {
                if (currentOctave > 0) {
                    currentOctave--;
                    octDisplay.textContent = `Oct ${currentOctave}`;
                }
            } else if (e.code === 'KeyX') {
                if (currentOctave < 7) {
                    currentOctave++;
                    octDisplay.textContent = `Oct ${currentOctave}`;
                }
            } else if (e.code === 'Space') {
                e.preventDefault();
                latchBtn.click();
            } else if (KEY_NOTE_MAP[e.code] !== undefined) {
                e.preventDefault();
                const note = (currentOctave + 1) * 12 + KEY_NOTE_MAP[e.code];
                noteOn(note);
            }
        });

        window.addEventListener('keyup', (e) => {
            const activeTag = document.activeElement ? document.activeElement.tagName : '';
            if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;

            if (KEY_NOTE_MAP[e.code] !== undefined) {
                e.preventDefault();
                const note = (currentOctave + 1) * 12 + KEY_NOTE_MAP[e.code];
                noteOff(note);
            }
        });
    }

    return container;
}

