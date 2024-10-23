module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverage: true,
  "modulePaths": [
    "<rootDir>",
    "components"
  ],
  "moduleDirectories": [
    "node_modules"
  ],
};