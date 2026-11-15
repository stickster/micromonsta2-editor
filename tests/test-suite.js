/**
 * Comprehensive Automated Test Suite for MicroMonsta 2 Editor & Patch Librarian
 *
 * Domain suites are registered in tests/domains/*.test.js via MM2TestRunner
 * (defined in tests/test-helpers.js).
 */

async function runAllTests(logger = console.log) {
    return MM2TestRunner.runAll(logger);
}
