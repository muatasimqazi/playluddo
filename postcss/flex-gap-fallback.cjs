// Turbopack/Lightning-CSS-safe flexbox `gap` fallback.
//
// Flexbox `gap` is Chrome 84+ / Safari 14.1+; LG webOS TVs run Chromium 79 and
// ignore it, so anything spaced with `display:flex; gap:` collapses together.
// The off-the-shelf flex-gap-polyfill emits CSS-variable cascades that Turbopack's
// Lightning CSS parser rejects, so this emits plain margins instead, scoped under
// `html.no-flex-gap` — a class a feature-detect (app/layout.tsx) only adds on
// browsers that lack flex gap, so native-gap browsers never see these margins.
//
// Two strategies, chosen per rule:
//   - Non-wrapping flex: margin between adjacent items on the main axis only
//     (margin-left for rows, margin-top for columns). No container shift.
//   - Wrapping flex: every item gets top+left margin and the container gets an
//     equal negative margin to cancel the outer edge — the standard emulation
//     that also spaces wrapped lines. Known limit: the container's negative
//     margin can interact with a sibling's `margin:auto`/background.
//
// Not a goal: pixel-perfect `space-between`/`space-around` distribution.

const PROCESSED = Symbol("flexGapFallbackDone");

// A length we can safely turn into margins. Skips 0, var()/env() (can't negate
// reliably) and anything non-lengthy.
function usable(value) {
  if (!value) return false;
  const v = value.trim();
  if (v === "0" || v === "0px" || v === "0rem" || v === "0em") return false;
  if (/var\(|env\(/.test(v)) return false;
  return true;
}

function negate(value) {
  // calc() handles any unit and keeps Lightning CSS happy.
  return `calc(-1 * (${value.trim()}))`;
}

module.exports = () => ({
  postcssPlugin: "flex-gap-fallback",
  Rule(rule, { Rule, Declaration }) {
    if (rule[PROCESSED]) return;
    if (!rule.selector || rule.selector.includes("html.no-flex-gap")) return;

    let isFlex = false;
    let column = false;
    let wrap = false;
    let gapRow = null;
    let gapCol = null;

    rule.each((node) => {
      if (node.type !== "decl") return;
      const prop = node.prop.toLowerCase();
      const value = node.value.trim();
      if (prop === "display" && /(^|\s)(inline-)?flex(\s|$)/.test(value)) isFlex = true;
      else if (prop === "flex-direction") column = /column/.test(value);
      else if (prop === "flex-wrap") wrap = /(^|\s)wrap/.test(value);
      else if (prop === "flex-flow") {
        if (/column/.test(value)) column = true;
        if (/(^|\s)wrap/.test(value)) wrap = true;
      } else if (prop === "gap") {
        const parts = value.split(/\s+/);
        gapRow = parts[0];
        gapCol = parts[1] || parts[0];
      } else if (prop === "row-gap") gapRow = value;
      else if (prop === "column-gap") gapCol = value;
    });

    if (!isFlex) return;

    const scoped = (suffix) =>
      rule.selectors.map((s) => `html.no-flex-gap ${s}${suffix}`).join(", ");
    const mark = (r) => {
      r[PROCESSED] = true;
      return r;
    };

    if (wrap) {
      // Space every item on both axes; pull the container back by the same
      // amount so the outer edges line up and wrapped lines are spaced too.
      const decls = [];
      const negs = [];
      if (usable(gapRow)) {
        decls.push(new Declaration({ prop: "margin-top", value: gapRow.trim() }));
        negs.push(new Declaration({ prop: "margin-top", value: negate(gapRow) }));
      }
      if (usable(gapCol)) {
        decls.push(new Declaration({ prop: "margin-left", value: gapCol.trim() }));
        negs.push(new Declaration({ prop: "margin-left", value: negate(gapCol) }));
      }
      if (!decls.length) return;
      const childRule = mark(new Rule({ selector: scoped(" > *") }));
      decls.forEach((d) => childRule.append(d));
      const contRule = mark(new Rule({ selector: scoped("") }));
      negs.forEach((d) => contRule.append(d));
      rule.after(childRule);
      childRule.after(contRule);
    } else {
      // Single line: one margin between adjacent items on the main axis.
      const amount = column ? gapRow : gapCol;
      if (!usable(amount)) return;
      const marginProp = column ? "margin-top" : "margin-left";
      const fallback = mark(new Rule({ selector: scoped(" > * + *") }));
      fallback.append(new Declaration({ prop: marginProp, value: amount.trim() }));
      rule.after(fallback);
    }
  },
});
module.exports.postcss = true;
