import path from "node:path";

// process.cwd() is the project root during `next build`/`next dev`. import.meta.url
// resolves inside .next when Turbopack evaluates this config, so it can't be used.
const here = process.cwd();

const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    // Flexbox `gap` fallback for browsers without it (Chrome <84, e.g. webOS
    // TVs on Chromium 79). Scoped under html.no-flex-gap so native-gap browsers
    // are untouched. See postcss/flex-gap-fallback.cjs. Absolute path: Turbopack
    // runs PostCSS from its own build dir, where a relative path won't resolve.
    [path.join(here, "postcss", "flex-gap-fallback.cjs")]: {},
  },
};

export default config;
