'use strict';
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  setupFiles: ['<rootDir>/tests/setup-env.js'],
  globalSetup: '<rootDir>/tests/global-setup.js',
  testTimeout: 20000,
  collectCoverageFrom: ['src/**/*.js', '!src/server.js'],
  coverageDirectory: 'reportes/cobertura',
  coverageReporters: ['text-summary', 'lcov'],
};
