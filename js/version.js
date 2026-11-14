// ============================================================================
// MICRO MONSTA 2 EDITOR & LIBRARIAN - CANONICAL VERSION SOURCE
// ============================================================================
// THIS IS THE ONE AND ONLY PLACE IN THE CODE TO CHANGE THE APPLICATION VERSION.
// When bumping the version, update the string literal below.
// The pre-commit hook automatically keeps package.json in sync with this value.
// ============================================================================

const APP_VERSION = '0.3.0';

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { APP_VERSION };
}
