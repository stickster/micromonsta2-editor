/**
 * CLI Test Runner for MicroMonsta 2 Test Suite
 */

import { runAllTests } from './test-suite.js';

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
