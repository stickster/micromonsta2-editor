/**
 * CLI Test Runner for MicroMonsta 2 Test Suite
 * Executes scripts in the exact same global order as index.html / tests/index.html
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.resolve(__dirname, '..');
global.PKG_JSON = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const scriptFiles = [
    'js/version.js',
    'js/mm2-specs.js',
    'js/sysex-parser.js',
    'js/patch-librarian.js',
    'js/midi-manager.js',
    'js/ui-controls.js',
    'js/app.js',
    'tests/test-suite.js'
];

for (const relPath of scriptFiles) {
    const fullPath = path.join(rootDir, relPath);
    const code = fs.readFileSync(fullPath, 'utf8');
    vm.runInThisContext(code, { filename: fullPath });
}

runAllTests(console.log).then(({ passed, failed }) => {
    if (failed > 0) {
        console.error(`Tests failed with ${failed} errors.`);
        process.exit(1);
    } else {
        console.log(`All ${passed} tests passed successfully!`);
        process.exit(0);
    }
}).catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
