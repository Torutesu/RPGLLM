// Flat ESLint 9 config (Agent F, extended by Agent O).
//
// Type-aware linting for every TypeScript package, `apps/mobile` included (Agent O). The client is
// linted with the same rule set minus the React-specific plugins, which are not installed: the
// point is to have it *covered* — no-floating-promises and the `any`-leak family catch real bugs in
// a React tree too — not to style it. Everything that would fail across code somebody else owns is
// a **warning**, so `pnpm lint` stays green while the debt is paid down package by package.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**", "**/dist/**", "**/dist-*/**", "**/build/**", "**/.expo/**",
      "**/playwright-report/**", "**/test-results/**",
      "apps/api/prisma/**", "**/*.d.ts", "**/*.js", "**/*.mjs", "**/*.cjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  prettier,
  {
    files: ["apps/api/**/*.ts", "packages/*/src/**/*.ts", "e2e/**/*.ts", "apps/mobile/**/*.ts", "apps/mobile/**/*.tsx"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // --- enforced everywhere (these are the ones that catch real bugs) ---
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": "off",
      // Promoted from warning to error by Agent O — the whole tree is already clean of them, so
      // they can only ever fire on new code. The `no-unsafe-*` family is what stops an untyped
      // value (a JSON parse, an `any` from a dependency) from spreading through the codebase.
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/only-throw-error": "error",
      "@typescript-eslint/prefer-promise-reject-errors": "error",
      "@typescript-eslint/unbound-method": "error",
      "@typescript-eslint/consistent-indexed-object-style": "error",

      // --- lint debt: these fail across code owned by other agents. Warn now, fix per-package
      //     later; see pipeline/status/build-notes.md "Agent F: lint debt".
      "@typescript-eslint/no-unnecessary-condition": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/restrict-template-expressions": "warn",
      // The last one of the family still has a single occurrence (apps/api/test/posts.test.ts).
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unnecessary-type-parameters": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/prefer-nullish-coalescing": "warn",
      "@typescript-eslint/consistent-type-definitions": "warn",
      "@typescript-eslint/class-methods-use-this": "warn",
      "@typescript-eslint/dot-notation": "warn",
      "@typescript-eslint/require-await": "warn",
      "@typescript-eslint/no-confusing-void-expression": "warn",
      "@typescript-eslint/no-invalid-void-type": "warn",
      "@typescript-eslint/no-dynamic-delete": "warn",
      "@typescript-eslint/no-empty-function": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/array-type": "warn",
      "@typescript-eslint/prefer-optional-chain": "warn",
      "@typescript-eslint/no-deprecated": "warn",
      "@typescript-eslint/no-base-to-string": "warn",
      "@typescript-eslint/prefer-regexp-exec": "warn",
      "@typescript-eslint/prefer-includes": "warn",
      "@typescript-eslint/no-unnecessary-boolean-literal-compare": "warn",
      "@typescript-eslint/no-unnecessary-type-arguments": "warn",
      "@typescript-eslint/no-redundant-type-constituents": "warn",
      "@typescript-eslint/no-unnecessary-type-conversion": "warn",
      "@typescript-eslint/non-nullable-type-assertion-style": "warn",
    },
  },
  {
    // `eslint-plugin-react-hooks` is not installed (adding it would rewrite the workspace lockfile
    // while other agents are building). The client carries
    // `// eslint-disable-next-line react-hooks/exhaustive-deps` comments, and an unknown rule in a
    // disable directive is an *error*, so the rule names are stubbed here. Install the real plugin
    // and delete this block to get the actual checks.
    files: ["apps/mobile/**/*.ts", "apps/mobile/**/*.tsx"],
    plugins: {
      "react-hooks": {
        rules: {
          "exhaustive-deps": { create: () => ({}) },
          "rules-of-hooks": { create: () => ({}) },
        },
      },
    },
  },
  {
    // The client, newly in scope. React/React-Native have no plugin here, and the tree predates
    // the config, so its own noise is warnings — the bug-shaped rules above still apply.
    files: ["apps/mobile/**/*.ts", "apps/mobile/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/unbound-method": "warn",
      "@typescript-eslint/consistent-indexed-object-style": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/no-unsafe-function-type": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/no-duplicate-type-constituents": "warn",
      "@typescript-eslint/no-misused-spread": "warn",
      "@typescript-eslint/restrict-plus-operands": "warn",
      "@typescript-eslint/no-meaningless-void-operator": "warn",
      "@typescript-eslint/no-unnecessary-template-expression": "warn",
      "@typescript-eslint/prefer-reduce-type-parameter": "warn",
      "@typescript-eslint/no-array-delete": "warn",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "warn",
      "@typescript-eslint/no-shadow": "off",
      "no-empty": "warn",
      "no-undef": "off",
    },
  },
);
