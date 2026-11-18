module.exports = {
  testEnvironment: 'node',
  transform: { '^.+\\.(t|j)s$': ['@swc/jest'] },
  transformIgnorePatterns: ['/node_modules/(?!@noble/)'],
  testMatch: ['<rootDir>/test/**/*.test.ts'],
};
