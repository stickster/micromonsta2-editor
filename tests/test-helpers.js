/**
 * Shared Test Harness & Headless Node Mock DOM for MicroMonsta 2 Test Suite
 */

// Headless Node mock DOM support for control unit tests
if (typeof document === 'undefined') {
    class MockElement {
        constructor(tag) {
            this.tagName = (tag || 'div').toUpperCase();
            this.children = [];
            this.attributes = new Map();
            const classes = new Set();
            this.classList = {
                _classes: classes,
                add: (...cs) => cs.forEach(c => classes.add(c)),
                remove: (...cs) => cs.forEach(c => classes.delete(c)),
                toggle: (c, force) => {
                    if (force !== undefined) {
                        if (force) classes.add(c);
                        else classes.delete(c);
                    } else {
                        if (classes.has(c)) classes.delete(c);
                        else classes.add(c);
                    }
                },
                contains: (c) => classes.has(c)
            };
            this.style = {};
            this._listeners = new Map();
            this.value = '';
            this.textContent = '';
        }
        get id() { return this.attributes.get('id') || ''; }
        set id(v) { this.attributes.set('id', String(v)); }
        get type() { return this.attributes.get('type') || ''; }
        set type(v) { this.attributes.set('type', String(v)); }
        get innerHTML() { return this._innerHTML || ''; }
        set innerHTML(html) {
            this._innerHTML = html;
            this.children = [];
            if (!html) return;
            const tagRegex = /<([a-z0-9]+)([^>]*)>([^<]*)<\/\1>|<([a-z0-9]+)([^>]*)\/>/gi;
            let m;
            while ((m = tagRegex.exec(html)) !== null) {
                const tag = m[1] || m[4];
                const attrs = m[2] || m[5] || '';
                const text = m[3] || '';
                const child = new MockElement(tag);
                child.textContent = text;
                const classMatch = attrs.match(/class=["']([^"']*)["']/);
                if (classMatch) child.className = classMatch[1];
                const idMatch = attrs.match(/id=["']([^"']*)["']/);
                if (idMatch) child.id = idMatch[1];
                const titleMatch = attrs.match(/title=["']([^"']*)["']/);
                if (titleMatch) child.title = titleMatch[1];
                this.children.push(child);
            }
        }
        get className() {
            return Array.from(this.classList._classes).join(' ');
        }
        set className(str) {
            this.classList._classes.clear();
            if (str) {
                str.trim().split(/\s+/).forEach(c => this.classList._classes.add(c));
            }
        }
        appendChild(child) {
            this.children.push(child);
            return child;
        }
        setAttribute(k, v) { this.attributes.set(k, String(v)); }
        getAttribute(k) { return this.attributes.get(k) ?? null; }
        hasAttribute(k) { return this.attributes.has(k); }
        addEventListener(ev, fn) {
            if (!this._listeners.has(ev)) this._listeners.set(ev, []);
            this._listeners.get(ev).push(fn);
        }
        removeEventListener(ev, fn) {
            if (this._listeners.has(ev)) {
                this._listeners.set(ev, this._listeners.get(ev).filter(f => f !== fn));
            }
        }
        dispatchEvent(event) {
            const list = this._listeners.get(event.type) || [];
            for (const fn of list) fn(event);
        }
        click() {
            const ev = { type: 'click', preventDefault: () => { }, stopPropagation: () => { } };
            if (this.onclick) this.onclick(ev);
            this.dispatchEvent(ev);
        }
        querySelector(sel) {
            for (const ch of this.children) {
                if (sel.startsWith('#') && (ch.id === sel.slice(1) || ch.attributes.get('id') === sel.slice(1))) return ch;
                if (sel.startsWith('.') && ch.classList.contains(sel.slice(1))) return ch;
                if (sel.startsWith('[data-offset="') && ch.attributes.get('data-offset') === sel.slice(14, -2)) return ch;
                if (sel.startsWith('[data-param="') && ch.attributes.get('data-param') === sel.slice(13, -2)) return ch;
                if (sel === 'button' && ch.tagName === 'BUTTON') return ch;
                if (sel === 'canvas' && ch.tagName === 'CANVAS') return ch;
                if (sel === 'input[type="range"]' && ch.tagName === 'INPUT' && ch.type === 'range') return ch;
                if (sel === '.bipolar-val' && ch.classList.contains('bipolar-val')) return ch;
                if (sel === 'button.btn-param-toggle' && ch.tagName === 'BUTTON' && ch.classList.contains('btn-param-toggle')) return ch;
                if (ch.tagName && sel.toUpperCase() === ch.tagName) return ch;
                if (ch.querySelector) {
                    const sub = ch.querySelector(sel);
                    if (sub) return sub;
                }
            }
            return null;
        }
        contains(node) {
            if (!node) return false;
            if (node === this) return true;
            for (const ch of this.children) {
                if (ch === node || (typeof ch.contains === 'function' && ch.contains(node))) {
                    return true;
                }
            }
            return false;
        }
        querySelectorAll(sel) {
            const res = [];
            for (const ch of this.children) {
                if (sel.startsWith('[data-offset="') && ch.attributes.get('data-offset') === sel.slice(14, -2)) res.push(ch);
                if (sel.startsWith('.') && ch.classList.contains(sel.slice(1))) res.push(ch);
                if (sel === '[data-param]' && ch.hasAttribute('data-param')) res.push(ch);
                if (ch.querySelectorAll) res.push(...ch.querySelectorAll(sel));
            }
            return res;
        }
    }
    const elementMap = new Map();
    globalThis.document = {
        createElement: (tag) => new MockElement(tag),
        createElementNS: (ns, tag) => new MockElement(tag),
        getElementById: (id) => elementMap.get(id) || null,
        registerMockElement: (id, el) => elementMap.set(id, el),
        querySelector: () => null,
        querySelectorAll: () => []
    };
    if (typeof window === 'undefined') {
        const winListeners = new Map();
        const storage = new Map();
        globalThis.__mm2ResetMockEnv = () => {
            storage.clear();
            elementMap.clear();
        };
        globalThis.window = {
            addEventListener: (ev, fn) => {
                if (!winListeners.has(ev)) winListeners.set(ev, []);
                winListeners.get(ev).push(fn);
            },
            removeEventListener: (ev, fn) => {
                if (winListeners.has(ev)) {
                    winListeners.set(ev, winListeners.get(ev).filter(f => f !== fn));
                }
            },
            dispatchEvent: (event) => {
                const list = winListeners.get(event.type) || [];
                for (const fn of list) fn(event);
            },
            localStorage: {
                getItem: (k) => storage.get(k) ?? null,
                setItem: (k, v) => storage.set(k, String(v)),
                removeItem: (k) => storage.delete(k),
                clear: () => storage.clear()
            }
        };
    }
    if (typeof Event === 'undefined') {
        globalThis.Event = class {
            constructor(type) { this.type = type; }
        };
    }
}

/**
 * Domain-modular test registry and runner.
 */
const MM2TestRunner = {
    _suites: [],

    register(domainName, suiteFn) {
        this._suites.push({ domainName, suiteFn });
    },

    async runAll(logger = console.log) {
        let passed = 0;
        let failed = 0;

        function assert(condition, testName) {
            if (condition) {
                passed++;
                logger(`✓ PASS: ${testName}`);
            } else {
                failed++;
                logger(`✗ FAIL: ${testName}`);
                throw new Error(`Assertion failed: ${testName}`);
            }
        }

        function assertEqual(actual, expected, testName) {
            if (actual === expected) {
                passed++;
                logger(`✓ PASS: ${testName}`);
            } else {
                failed++;
                logger(`✗ FAIL: ${testName} (Expected ${expected}, got ${actual})`);
                throw new Error(`Assertion failed: ${testName} (Expected ${expected}, got ${actual})`);
            }
        }

        async function runSection(title, fn) {
            if (typeof globalThis.__mm2ResetMockEnv === 'function') {
                globalThis.__mm2ResetMockEnv();
            }
            logger(title);
            try {
                await fn();
            } catch (e) {
                logger(`  Error: ${e.message}`);
                failed++;
            }
        }

        const ctx = { assert, assertEqual, logger, runSection };
        for (const { suiteFn } of this._suites) {
            await suiteFn(ctx);
        }

        logger(`\n========================================`);
        logger(` Test Results: ${passed} Passed, ${failed} Failed`);
        logger(`========================================\n`);

        return { passed, failed };
    }
};
