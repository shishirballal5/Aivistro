/** End-to-end tests run against REAL MySQL and Redis (see README: "Running the tests"). */
module.exports = {
  rootDir: '.',
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json', diagnostics: { ignoreCodes: [151001] } }] },
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/setup-env.ts'],
  testTimeout: 30000,
};
