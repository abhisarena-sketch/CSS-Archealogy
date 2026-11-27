import type { ProjectModel } from './project.js';
import type { SourceLocation, TokenCategory, TokenValueSummary } from './types.js';

export const NAMED_COLORS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood ' +
    'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray ' +
    'darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
    'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue ' +
    'firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew ' +
    'hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray ' +
    'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue ' +
    'mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred ' +
    'midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
    'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple ' +
    'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue ' +
    'slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white ' +
    'whitesmoke yellow yellowgreen'
  ).split(' '),
);

const COLOR_FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)/gi;
const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi;
const WORD = /(?<![-\w#])[a-z]+(?![-\w(])/gi;
const LENGTH = /(?<![-\w.#])-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|vh|vw|vmin|vmax|ch|ex|svh|lvh|dvh|%)(?![-\w])/gi;

const SPACING_PROPS = /^(margin|padding|gap|row-gap|column-gap|grid-gap|inset|top|right|bottom|left|scroll-margin|scroll-padding)(-|$)/;
const TYPOGRAPHY_PROPS = new Set(['font-size', 'line-height', 'font-weight', 'letter-spacing', 'font-family']);
const RADIUS_PROPS = /^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$/;
const SHADOW_PROPS = new Set(['box-shadow', 'text-shadow']);
const NON_COLOR_PROPS = /^(font-family|content|grid-template-areas|transition|animation|will-change|counter-|quotes)/;

export function normaliseHex(hex: string): string {
  let h = hex.toLowerCase().slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  return `#${h}`;
}

function stripVar(value: string): string {
  // Remove var(...) references (including nested fallbacks) so tokenised values are not re-counted.
  let out = value;
  for (let i = 0; i < 5 && /var\(/i.test(out); i++) out = out.replace(/var\([^()]*\)/gi, ' ');
  return out;
}

export function extractColors(value: string): string[] {
  const clean = stripVar(value).replace(/url\([^)]*\)/gi, ' ');
  const out: string[] = [];
  for (const m of clean.match(COLOR_FN) ?? []) out.push(m.toLowerCase().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', '));
  const withoutFns = clean.replace(COLOR_FN, ' ');
  for (const m of withoutFns.match(HEX) ?? []) out.push(normaliseHex(m));
  for (const m of withoutFns.replace(HEX, ' ').match(WORD) ?? []) {
    const w = m.toLowerCase();
    if (NAMED_COLORS.has(w)) out.push(w);
  }
  return out;
}

export function extractLengths(value: string): string[] {
  const clean = stripVar(value).replace(/calc\([^()]*\)/gi, (m) => m);
  return (clean.match(LENGTH) ?? []).map((v) => v.toLowerCase()).filter((v) => !/^-?0+(\.0+)?[a-z%]+$/.test(v));
}

export interface TokenOccurrence {
  category: TokenCategory;
  value: string;
  prop: string;
  location: SourceLocation;
  declarationIndex: number;
}

/** Convert a CSS length to pixels assuming a 16px root font size. */
export function toPx(value: string): number | null {
  const m = /^(-?\d*\.?\d+)(px|rem|em)$/.exec(value.trim().toLowerCase());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === 'px' ? n : n * 16;
}

const BREAKPOINT = /\(\s*(min|max)-width\s*:\s*(-?\d*\.?\d+(?:px|em|rem))\s*\)|\bwidth\s*(>=|<=|>|<)\s*(-?\d*\.?\d+(?:px|em|rem))|(-?\d*\.?\d+(?:px|em|rem))\s*(>=|<=|>|<)\s*width\b/gi;

export interface Breakpoint {
  value: string;
  px: number | null;
  /** `min` for lower bounds, `max` for upper bounds. */
  bound: 'min' | 'max';
}

export function extractBreakpoints(params: string): Breakpoint[] {
  const out: Breakpoint[] = [];
  for (const m of params.matchAll(BREAKPOINT)) {
    if (m[1] && m[2]) out.push({ value: m[2].toLowerCase(), px: toPx(m[2]), bound: m[1].toLowerCase() === 'min' ? 'min' : 'max' });
    else if (m[3] && m[4]) out.push({ value: m[4].toLowerCase(), px: toPx(m[4]), bound: m[3].startsWith('>') ? 'min' : 'max' });
    else if (m[5] && m[6]) out.push({ value: m[5].toLowerCase(), px: toPx(m[5]), bound: m[6].startsWith('<') ? 'min' : 'max' });
  }
  return out;
}

export function collectTokenOccurrences(project: ProjectModel): TokenOccurrence[] {
  const out: TokenOccurrence[] = [];
  for (const d of project.declarations) {
    if (d.custom) continue;
    const location = { file: d.file, line: d.line, column: d.column };
    const push = (category: TokenCategory, value: string) =>
      out.push({ category, value, prop: d.prop, location, declarationIndex: d.index });
    if (!NON_COLOR_PROPS.test(d.prop)) for (const c of extractColors(d.value)) push('color', c);
    if (SPACING_PROPS.test(d.prop)) for (const l of extractLengths(d.value)) push('spacing', l);
    if (TYPOGRAPHY_PROPS.has(d.prop) && !/var\(/i.test(d.value) && !/^(inherit|initial|unset|revert|normal)$/i.test(d.value)) {
      push('typography', d.prop === 'font-family' ? d.value.replace(/\s*,\s*/g, ', ') : d.value.toLowerCase());
    }
    if (RADIUS_PROPS.test(d.prop) && !/var\(/i.test(d.value) && !/^0(px)?$/.test(d.value)) push('radius', d.value.toLowerCase());
    if (SHADOW_PROPS.has(d.prop) && !/var\(/i.test(d.value) && d.value.toLowerCase() !== 'none') push('shadow', d.value.toLowerCase());
  }
  for (const at of project.atRules) {
    if (at.name !== 'media') continue;
    for (const bp of extractBreakpoints(at.params)) {
      out.push({
        category: 'breakpoint',
        value: bp.value,
        prop: `@media ${bp.bound}-width`,
        location: { file: at.file, line: at.line, column: at.column },
        declarationIndex: -1,
      });
    }
  }
  return out;
}

/** Custom property definitions keyed by normalised value. */
export function customPropertyValues(project: ProjectModel): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const d of project.declarations) {
    if (!d.custom) continue;
    let value = d.value.replace(/\s+/g, ' ').trim();
    if (/^#[0-9a-f]{3,8}$/i.test(value)) value = normaliseHex(value);
    else value = value.toLowerCase();
    const set = map.get(value) ?? new Set<string>();
    set.add(d.prop);
    map.set(value, set);
  }
  return map;
}

export function summariseTokens(project: ProjectModel, maxLocations = 50): TokenValueSummary[] {
  const groups = new Map<string, TokenValueSummary>();
  const defined = customPropertyValues(project);
  for (const occ of collectTokenOccurrences(project)) {
    const key = `${occ.category}\u0000${occ.value}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        category: occ.category,
        value: occ.value,
        count: 0,
        properties: [],
        definedAs: [...(defined.get(occ.value.toLowerCase()) ?? [])],
        locations: [],
      };
      groups.set(key, g);
    }
    g.count++;
    if (!g.properties.includes(occ.prop)) g.properties.push(occ.prop);
    if (g.locations.length < maxLocations) g.locations.push(occ.location);
  }
  return [...groups.values()].sort((a, b) => a.category.localeCompare(b.category) || b.count - a.count || a.value.localeCompare(b.value));
}
