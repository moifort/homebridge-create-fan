module.exports = {
  roots: ['<rootDir>/src'],
  preset: 'ts-jest',
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.data.ts', '!src/**/*.type.ts', '!src/**/*.test.ts'],
  coverageReporters: ['lcov'],
};
