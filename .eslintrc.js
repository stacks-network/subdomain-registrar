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
    project: "./tsconfig.json",
    ecmaVersion: 2020,
    sourceType: "module",
  },
  overrides: [
    {
      files: ["*.ts", "*.tsx"], // Your TypeScript files extension

      // As mentioned in the comments, you should extend TypeScript plugins here,
      // instead of extending them outside the `overrides`.
      // If you don't want to extend any rules, you don't need an `extends` attribute.
      extends: ["@stacks/eslint-config"],

      parserOptions: {
        project: ["./tsconfig.json"], // Specify it only for TypeScript files
      },
    },
  ],
  //   ignorePatterns: ["lib/*", "client/*", "utils/*"],
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
    // "prettier/prettier": "error",

    // "@typescript-eslint/no-inferrable-types": "off",
    // "@typescript-eslint/camelcase": "off",
    // "@typescript-eslint/no-empty-function": "off",
    // "@typescript-eslint/no-use-before-define": ["error", "nofunc"],
    // "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],
    // "no-warning-comments": "warn",
    // "tsdoc/syntax": "error",
    // // TODO: fix these
    // "@typescript-eslint/no-unsafe-assignment": "off",
    // "@typescript-eslint/no-unsafe-member-access": "off",
    // "@typescript-eslint/no-unsafe-call": "off",
    // "@typescript-eslint/restrict-template-expressions": "off",
    // "@typescript-eslint/explicit-module-boundary-types": "off",
    // "@typescript-eslint/restrict-plus-operands": "off",

    // // TODO: temporarily disable this until the express async handler is typed correctly
    // "@typescript-eslint/no-misused-promises": "off",
  },
};
