import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import tsParser from "@typescript-eslint/parser";
import nxPlugin from "@nx/eslint-plugin";
import importPlugin from "eslint-plugin-import";
import unusedImportsPlugin from "eslint-plugin-unused-imports";
const parent = [
  pluginJs.configs.recommended,
  {
    plugins: {
      "@nx": nxPlugin,
      import: importPlugin,
      "unused-imports": unusedImportsPlugin,
    },
  },
  {
    languageOptions: {
      parser: tsParser,
      globals: { ...globals.node },
    },
  },
  eslintPluginPrettier,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
  },
  {
    rules: {
      "prettier/prettier": ["off"],
      "@typescript-eslint/no-explicit-any": ["warn"],
      "@typescript-eslint/no-unused-vars": ["off"],
      "array-callback-return": ["error"],
      "unused-imports/no-unused-imports": ["error"],
      // 'import/no-duplicates': ['error'],
    },
  },
  {
    ignores: ["build/*", "**/build/*", "dist/*", "**/dist/*"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname, // or __dirname for commonJS
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": ["error"],
    },
  },
  {
    files: ["**/*.tsx", "**/*.test.ts"],
    rules: {
      // Exclude vibe coded UI from assertions
      "@typescript-eslint/consistent-type-assertions": ["off"],
    },
  },
];

export default [
  ...parent,
  {
    ignores: ["cdk.out/*"],
  },
];
