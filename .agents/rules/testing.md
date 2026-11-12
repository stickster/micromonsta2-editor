# Testing & Verification Guidelines

- **Command-Line Test Suite:** Always run the test suite before submitting or committing any changes:
  ```sh
  node tests/cli-runner.js
  ```
- **Zero Failures Required:** All tests must pass with 0 errors.
- **Regression Testing:** Whenever fixing a bug or adding a feature, add corresponding test cases to `tests/test-suite.js`.
