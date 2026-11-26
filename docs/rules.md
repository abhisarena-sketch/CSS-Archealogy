# Rules

Generated from the rule metadata by `node scripts/generate-rules-doc.mjs`. Run
`css-archaeology explain <rule-id>` for the same information in a terminal.

Each rule has a default **severity** (how much the issue matters). **Confidence** (how sure the analysis is that
the finding is real) is computed per finding from evidence and is listed in every finding with the factors that
raised or lowered it. See [configuration](configuration.md#rules) to turn rules off, change severity or set options.

| Rule | Analyzer (`analysis` key) | Default severity |
|---|---|---|
| [`unused-selector`](#unused-selector) | unused-selectors (`unusedSelectors`) | low |
| [`duplicate-declaration`](#duplicate-declaration) | duplicate-declarations (`duplicateDeclarations`) | medium |
| [`repeated-declaration-block`](#repeated-declaration-block) | duplicate-declarations (`duplicateDeclarations`) | low |
| [`high-specificity`](#high-specificity) | specificity (`specificityConflicts`) | low |
| [`complex-selector`](#complex-selector) | specificity (`specificityConflicts`) | low |
| [`overqualified-selector`](#overqualified-selector) | specificity (`specificityConflicts`) | info |
| [`specificity-hack`](#specificity-hack) | specificity (`specificityConflicts`) | low |
| [`specificity-escalation`](#specificity-escalation) | specificity (`specificityConflicts`) | medium |
| [`important-overuse`](#important-overuse) | specificity (`specificityConflicts`) | low |
| [`conflicting-declaration`](#conflicting-declaration) | specificity (`specificityConflicts`) | medium |
| [`specificity-conflict`](#specificity-conflict) | specificity (`specificityConflicts`) | low |
| [`overridden-declaration`](#overridden-declaration) | overridden-declarations (`overriddenDeclarations`) | medium |
| [`duplicate-media-query`](#duplicate-media-query) | media-queries (`mediaQueries`) | low |
| [`inconsistent-breakpoint`](#inconsistent-breakpoint) | media-queries (`mediaQueries`) | low |
| [`redundant-media-declaration`](#redundant-media-declaration) | media-queries (`mediaQueries`) | low |
| [`repeated-across-breakpoints`](#repeated-across-breakpoints) | media-queries (`mediaQueries`) | info |
| [`repeated-value`](#repeated-value) | design-tokens (`designTokens`) | info |
| [`hardcoded-token-value`](#hardcoded-token-value) | design-tokens (`designTokens`) | low |
| [`near-duplicate-color`](#near-duplicate-color) | design-tokens (`designTokens`) | low |
| [`oversized-stylesheet`](#oversized-stylesheet) | complexity (`complexity`) | medium |
| [`deep-nesting`](#deep-nesting) | complexity (`complexity`) | low |
| [`parse-error`](#parse-error) | parser | medium |

## unused-selector

**Potentially unused selector.** No scanned source file references the classes, ids, elements or attributes this selector requires.

- Analyzer: `unused-selectors`
- Default severity: `low`
- Options (defaults):
  - `checkElements`: `true`
  - `checkAttributes`: `true`
  - `runtimeStatePrefixes`: `["is-","has-","js-","active","open","show","visible","hidden","disabled","selected","collapsed","expanded"]`

A selector can only match if markup contains everything it requires. CSS Archaeology collects class, id, element and attribute references from HTML, JSX/TSX (className, clsx/classnames/cva calls, DOM APIs), CSS Modules imports, Tailwind @apply and every string literal in scripts. A selector is reported only when at least one requirement is not found anywhere. Static analysis cannot see runtime-generated markup, CMS content, third-party components or class names built from unresolved variables, so this is always labelled "potentially unused". Nothing is ever deleted automatically.

## duplicate-declaration

**Duplicate declaration.** The same property and value is declared more than once for the same selector under the same at-rule conditions.

- Analyzer: `duplicate-declarations`
- Default severity: `medium`

Duplicates are grouped by selector, property, value and full at-rule context (media, supports, container, layer, scope). Declarations under different media queries are never treated as duplicates. Consolidation is reported as safe only when no declaration of the same property with a different value appears between the duplicates on an overlapping selector.

## repeated-declaration-block

**Repeated declaration block.** Several rules with different selectors share an identical set of declarations.

- Analyzer: `duplicate-declarations`
- Default severity: `low`
- Options (defaults):
  - `minDeclarations`: `3`
  - `minOccurrences`: `2`

Identical declaration blocks repeated across selectors are a repeated styling pattern. They can often be expressed once with a shared class, a selector list or a design token. This is a maintainability hint, not a bug.

## high-specificity

**Excessively specific selector.** The selector specificity exceeds the configured maximum, making it hard to override.

- Analyzer: `specificity`
- Default severity: `low`
- Options (defaults):
  - `max`: `[0,4,4]`

Specificity is shown as (ids, classes/attributes/pseudo-classes, elements). Selectors above the threshold (default (0,4,4); any id exceeds it) force later overrides to escalate specificity or use !important.

## complex-selector

**Unnecessarily complex selector.** The selector chains more compounds or simple selectors than the configured maximum.

- Analyzer: `specificity`
- Default severity: `low`
- Options (defaults):
  - `maxCompounds`: `4`
  - `maxSimpleSelectors`: `8`

Long descendant chains couple styles to markup structure, are slower to match and are hard to reuse.

## overqualified-selector

**Overqualified selector.** An element type qualifies a class or id in the same compound (for example div.card).

- Analyzer: `specificity`
- Default severity: `info`

Qualifying a class or id with an element type adds specificity and ties the style to one element type, usually without need.

## specificity-hack

**Specificity hack.** A simple selector is repeated in one compound (for example .btn.btn) only to raise specificity.

- Analyzer: `specificity`
- Default severity: `low`

Repeating a class or id has no effect on matching and exists only to win the cascade; it signals a specificity war.

## specificity-escalation

**Repeated specificity escalation.** The same target is styled at several increasing specificity levels that set the same properties.

- Analyzer: `specificity`
- Default severity: `medium`
- Options (defaults):
  - `minLevels`: `3`

When one element is styled through an escalating series of selectors that set the same properties, each new override has to out-rank the last. This is a common source of fragile CSS.

## important-overuse

**!important overuse.** A stylesheet uses !important on a large share of its declarations.

- Analyzer: `specificity`
- Default severity: `low`
- Options (defaults):
  - `maxRatio`: `0.1`
  - `minCount`: `5`

!important bypasses specificity and source order. Heavy use makes the cascade unpredictable and leads to !important battles.

## conflicting-declaration

**Conflicting declarations.** The same selector sets a property to different values under the same conditions, and the winner depends on stylesheet load order or competing !important flags.

- Analyzer: `specificity`
- Default severity: `medium`

Reported only when the outcome is fragile: identical selectors with different values in different stylesheets whose load order is not known, or several !important declarations for the same target. Values that differ by media query, supports condition or state (for example :hover) are intentional variations and are not reported.

## specificity-conflict

**Specificity collision.** A later rule for the same target loses to an earlier, much more specific rule.

- Analyzer: `specificity`
- Default severity: `low`

The later rule targets the same key selector and sets a different value, but an earlier rule wins for elements matched by both because it is more specific by at least an id or two classes. If the later rule was meant to override, it will not. Contextual styling (an earlier, deliberately more specific rule) can be intentional, so confidence is medium.

## overridden-declaration

**Overridden declaration.** A declaration is always overridden by another declaration that applies to the same elements under the same or broader conditions.

- Analyzer: `overridden-declarations`
- Default severity: `medium`

For every element the selector matches, another declaration of the same property (or a shorthand that resets it) applies under the same or broader at-rule conditions and wins the cascade by importance, layer, specificity or source order. The overridden declaration is dead code. Cascade evaluation is approximate: selectors are compared structurally, media queries are compared as written, and cross-file order depends on how stylesheets are loaded. Inherited values never override declared values, so inheritance is not treated as an override.

## duplicate-media-query

**Duplicate media query.** The same media query appears in several blocks of one stylesheet.

- Analyzer: `media-queries`
- Default severity: `low`

Repeated @media blocks with identical conditions in one file can usually be merged. Merging changes source order, so check for rules in between that set the same properties.

## inconsistent-breakpoint

**Inconsistent breakpoints.** Breakpoint values that are close to each other but not identical are used across the project.

- Analyzer: `media-queries`
- Default severity: `low`
- Options (defaults):
  - `tolerancePx`: `16`

Values such as 760px, 768px and 770px usually describe the same breakpoint. A min-width/max-width pair one pixel apart (768px and 767px) is treated as consistent. Values in em/rem are converted at 16px.

## redundant-media-declaration

**Redundant responsive declaration.** A declaration inside a media query repeats the value that already applies outside it.

- Analyzer: `media-queries`
- Default severity: `low`

The selector already has the same value from a rule that applies in a broader context, and nothing in between sets a different value, so the responsive declaration has no effect.

## repeated-across-breakpoints

**Declaration repeated across breakpoints.** The same selector declares an identical value in several different media queries.

- Analyzer: `media-queries`
- Default severity: `info`
- Options (defaults):
  - `minBreakpoints`: `2`

Identical declarations under several breakpoints can often be expressed once with a single min-width query or moved to the base rule.

## repeated-value

**Repeated value (design token candidate).** A literal value is repeated often enough that it could become a shared CSS custom property.

- Analyzer: `design-tokens`
- Default severity: `info`
- Options (defaults):
  - `minOccurrences`: `3`
  - `categories`: `["color","spacing","typography","radius","shadow","breakpoint"]`
  - `ignore`: `["1px","100%","50%","#ffffff","#000000","white","black","inherit"]`

Counts literal values per category across all declarations (var() references are excluded). CSS Archaeology never introduces or replaces variables; it only shows where a shared token could help.

## hardcoded-token-value

**Hard-coded token value.** A literal value is used even though a custom property with exactly that value is defined.

- Analyzer: `design-tokens`
- Default severity: `low`

When --brand: #0047ab exists, writing #0047ab directly means the two can drift apart. Matching is exact on the normalised value; the variable may still be intentionally separate.

## near-duplicate-color

**Near-duplicate colours.** Two colours are almost, but not exactly, the same.

- Analyzer: `design-tokens`
- Default severity: `low`
- Options (defaults):
  - `maxDistance`: `8`

Colours within a small RGB distance (default 8) are rarely intentional and usually indicate drifting design tokens.

## oversized-stylesheet

**Oversized stylesheet.** A stylesheet exceeds the configured size, line or rule limits.

- Analyzer: `complexity`
- Default severity: `medium`
- Options (defaults):
  - `maxBytes`: `150000`
  - `maxLines`: `4000`
  - `maxRules`: `1500`

Very large stylesheets are hard to navigate and usually mix unrelated concerns. Limits default to 150 KB, 4,000 lines or 1,500 rules and are measured from the source files.

## deep-nesting

**Deeply nested rule.** A nested rule is deeper than the configured maximum.

- Analyzer: `complexity`
- Default severity: `low`
- Options (defaults):
  - `maxDepth`: `3`

Deep nesting (CSS nesting or SCSS) produces long, highly specific selectors and couples styles to markup structure.

## parse-error

**Invalid CSS.** A stylesheet contains syntax the CSS parser could not read without recovery.

- Analyzer: `parser`
- Default severity: `medium`
