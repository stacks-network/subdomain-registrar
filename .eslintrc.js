module.exports = {
  root: true,
  parser: "@babel/eslint-parser",
  plugins: ["eslint-plugin-prettier"],
  env: {
    es6: true,
    node: true,
    commonjs: true,
  },
  parserOptions: {
    tsconfigRootDir: __dirname,
    ecmaVersion: 2020,
    sourceType: "module",
    project: ["./tsconfig.json"], // Specify it only for TypeScript files
  },
  overrides: [
    {
      files: ["*.ts", "*.tsx"], // Your TypeScript files extension
      extends: ["@stacks/eslint-config"],
    },
  ],
  rules: {
    "comma-dangle": ["error", "never"],
    quotes: [2, "single"],
    "eol-last": 2,
    "no-debugger": 1,

    noMixedRequires: 0,
    noUnderscoreDangle: 0,
    noMultiSpaces: 0,
    noTrailingSpaces: 0,
    noExtraBooleanCast: 0,
    "no-undef": 2,
    "no-unused-vars": 2,
    "no-var": 2,
    noParamReassign: 0,
    noElseReturn: 0,
    noConsole: 0,
    "prefer-const": 2,
    newCap: 0,
    camelCase: 0,
    semi: [2, "never"],
    "valid-jsdoc": ["error"],
  },
};
