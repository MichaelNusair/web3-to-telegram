module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": "@swc/jest",
  },
  moduleNameMapper: {
    "/opt/nodejs/commonsLayer/(.*)$": "<rootDir>/layers/commonsLayer",
  },
};
