/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
  testEnvironment: "node",
  testPathIgnorePatterns: ["/node_modules/", "/packages/"],
  transform: {
    "^.+.tsx?$": ["ts-jest",{}],
  },
};