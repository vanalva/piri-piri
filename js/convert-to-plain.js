/**
 * Convert LUMOS-based HTML into plain HTML with resolved CSS.
 *
 * Strategy:
 * 1. Parse all <style> blocks with PostCSS
 * 2. Resolve CSS variable chains to terminal values
 * 3. Match CSS rules to HTML elements
 * 4. Apply simple (non-responsive, non-pseudo) styles as inline styles
 * 5. Keep responsive (@media) and pseudo (:hover, ::before, etc.) rules
 *    in a minimal <style> block using element IDs or data-attrs
 * 6. Strip all utility class names, keep only semantic/component classes
 */

const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const safeParser = require('postcss-safe-parser');
const cheerio = require('cheerio');

const inputFile = path.join(__dirname, 'index-phase1b.html');
const outputFile = path.join(__dirname, 'index-normalized.html');

const html = fs.readFileSync(inputFile, 'utf-8');

// ============================================================
// STEP 1: Extract <style> blocks and HTML body
// ============================================================

// Split into style content and HTML structure
const styleContents = [];
const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/g;
let m;
while ((m = styleRegex.exec(html)) !== null) {
  styleContents.push(m[1]);
}

const allCSS = styleContents.join('\n');

// ============================================================
// STEP 2: Parse CSS and resolve variables
// ============================================================

/**
 * Parse CSS variables from :root, theme selectors, and component classes
 */
function extractVariables(styleBlocks) {
  const vars = {};    // base :root variables
  const themeVars = {}; // theme-specific variables: { '.u-theme-dark': { ... }, ... }
  const classVars = {}; // class-specific variables: { 'classname': { ... }, ... }

  for (const cssText of styleBlocks) {
    const root = safeParser(cssText);

    root.walkRules((rule) => {
      const sel = rule.selector.trim();

      // :root variables
      if (sel === ':root') {
        rule.walkDecls((decl) => {
          if (decl.prop.startsWith('--')) {
            vars[decl.prop] = decl.value;
          }
        });
      }

      // Theme variables (e.g., .u-theme-dark, .u-theme-light, .u-theme-brand)
      const themeMatch = sel.match(/^\.(u-theme-[\w-]+)$/);
      if (themeMatch) {
        const themeName = '.' + themeMatch[1];
        if (!themeVars[themeName]) themeVars[themeName] = {};
        rule.walkDecls((decl) => {
          if (decl.prop.startsWith('--')) {
            themeVars[themeName][decl.prop] = decl.value;
          }
        });
      }

      // Any class that sets custom properties
      const classMatch = sel.match(/^\.([a-zA-Z_-][\w-]*)$/);
      if (classMatch && !themeMatch) {
        rule.walkDecls((decl) => {
          if (decl.prop.startsWith('--')) {
            if (!classVars[classMatch[1]]) classVars[classMatch[1]] = {};
            classVars[classMatch[1]][decl.prop] = decl.value;
          }
        });
      }
    });
  }

  return { vars, themeVars, classVars };
}

/**
 * Resolve a single var() reference given a variable context
 */
function resolveVar(value, context, depth = 0) {
  if (depth > 20) return value; // prevent infinite loops

  if (!value || typeof value !== 'string') return value;

  // Replace var(--name) and var(--name, fallback)
  return value.replace(/var\(([^)]+)\)/g, (match, inner) => {
    // Parse var(--name) or var(--name, fallback)
    const commaIdx = findTopLevelComma(inner);
    let varName, fallback;

    if (commaIdx !== -1) {
      varName = inner.slice(0, commaIdx).trim();
      fallback = inner.slice(commaIdx + 1).trim();
    } else {
      varName = inner.trim();
      fallback = null;
    }

    let resolved = context[varName];
    if (resolved !== undefined) {
      // Recursively resolve
      return resolveVar(resolved, context, depth + 1);
    }

    if (fallback !== null) {
      return resolveVar(fallback, context, depth + 1);
    }

    return match; // can't resolve, keep as-is
  });
}

/**
 * Find the first top-level comma in a var() argument (not inside nested parens)
 */
function findTopLevelComma(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ',' && depth === 0) return i;
  }
  return -1;
}

/**
 * Build a full variable context for an element based on its theme ancestry
 */
function buildVarContext(themes, baseVars, themeVars, elementClasses, classVars) {
  const context = { ...baseVars };

  // Apply theme variables in order (outermost first)
  for (const theme of themes) {
    const tv = themeVars['.' + theme];
    if (tv) {
      Object.assign(context, tv);
    }
  }

  // Apply class-level custom properties from element's own classes and ancestors
  if (elementClasses && classVars) {
    for (const cls of elementClasses) {
      const cv = classVars[cls];
      if (cv) {
        Object.assign(context, cv);
      }
    }
  }

  // Now resolve all variable values (they may reference each other)
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 10) {
    changed = false;
    iterations++;
    for (const [key, val] of Object.entries(context)) {
      if (val && val.includes('var(')) {
        const resolved = resolveVar(val, context);
        if (resolved !== val) {
          context[key] = resolved;
          changed = true;
        }
      }
    }
  }

  return context;
}

// ============================================================
// STEP 3: Build selector → declarations map
// ============================================================

/**
 * Parse all CSS rules into a structured format.
 * Processes each <style> block separately for accuracy.
 */
function parseRules(styleBlocks) {
  const rules = [];
  const mediaRules = [];
  const pseudoRules = [];
  const keyframes = [];
  const otherAtRules = [];

  for (const cssText of styleBlocks) {
    const root = safeParser(cssText);

    // Use each() for top-level nodes to avoid walk's child-skipping issues
    root.each((node) => {
      if (node.type === 'atrule') {
        if (node.name === 'keyframes' || node.name === '-webkit-keyframes') {
          keyframes.push(node.toString());
          return;
        }
        if (node.name === 'font-face') {
          otherAtRules.push(node.toString());
          return;
        }
        if (node.name === 'media') {
          const mediaQuery = `@media ${node.params}`;
          node.walkRules((rule) => {
            const sel = rule.selector.trim();
            const decls = {};
            rule.walkDecls((d) => { decls[d.prop] = d.value; });
            if (Object.keys(decls).length > 0) {
              if (hasPseudo(sel)) {
                pseudoRules.push({ selector: sel, decls, media: mediaQuery });
              } else {
                mediaRules.push({ selector: sel, decls, media: mediaQuery });
              }
            }
          });
          return;
        }
        // Other @-rules (supports, etc.)
        if (node.nodes) {
          node.walkRules((rule) => {
            const sel = rule.selector.trim();
            const decls = {};
            rule.walkDecls((d) => { decls[d.prop] = d.value; });
            if (Object.keys(decls).length > 0) {
              mediaRules.push({ selector: sel, decls, media: `@${node.name} ${node.params}` });
            }
          });
        }
        return;
      }

      if (node.type === 'rule') {
        const sel = node.selector.trim();
        const decls = {};
        node.walkDecls((d) => { decls[d.prop] = d.value; });

        if (Object.keys(decls).length === 0) return;

        if (hasPseudo(sel)) {
          pseudoRules.push({ selector: sel, decls });
        } else {
          rules.push({ selector: sel, decls });
        }
      }
    });
  }

  return { rules, mediaRules, pseudoRules, keyframes, otherAtRules };
}

function hasPseudo(sel) {
  // Check for pseudo-classes/elements but not :root, :where, :is, :not, :has
  // (those are selector modifiers, not state pseudo-classes)
  const withoutFunctional = sel
    .replace(/:(?:where|is|not|has|root)\([^)]*\)/g, '')
    .replace(/:root/g, '');
  return /::?\w/.test(withoutFunctional) &&
    (withoutFunctional.includes(':hover') ||
     withoutFunctional.includes(':focus') ||
     withoutFunctional.includes(':active') ||
     withoutFunctional.includes(':visited') ||
     withoutFunctional.includes(':checked') ||
     withoutFunctional.includes(':disabled') ||
     withoutFunctional.includes(':first-child') ||
     withoutFunctional.includes(':last-child') ||
     withoutFunctional.includes(':nth-') ||
     withoutFunctional.includes(':focus-visible') ||
     withoutFunctional.includes(':focus-within') ||
     withoutFunctional.includes('::before') ||
     withoutFunctional.includes('::after') ||
     withoutFunctional.includes('::placeholder') ||
     withoutFunctional.includes('::-'));
}

/**
 * Check if a selector is a simple class selector that can match an element
 * Returns the class name(s) if simple, null otherwise
 */
function getSimpleClasses(sel) {
  // Handle comma-separated selectors
  const parts = sel.split(',').map(s => s.trim());
  const allClasses = [];

  for (const part of parts) {
    // Simple: .class-name
    const simpleMatch = part.match(/^\.([a-zA-Z_-][\w-]*)$/);
    if (simpleMatch) {
      allClasses.push({ classes: [simpleMatch[1]], selector: part });
      continue;
    }
    // Compound: .class1.class2
    const compoundMatch = part.match(/^(\.[a-zA-Z_-][\w-]*)+$/);
    if (compoundMatch) {
      const classes = part.match(/\.([a-zA-Z_-][\w-]*)/g).map(c => c.slice(1));
      allClasses.push({ classes, selector: part });
      continue;
    }
    // Not simple enough - return null to keep in stylesheet
    return null;
  }

  return allClasses;
}

// ============================================================
// STEP 4: Process HTML with Cheerio
// ============================================================

console.log('Parsing CSS...');
const { vars: baseVars, themeVars, classVars } = extractVariables(styleContents);

// Add manually-known variable mappings for vars not defined in CSS
// --_font---font--heading is used in inline styles but never declared in CSS
baseVars['--_font---font--heading'] = baseVars['--_font---font--heading'] || baseVars['--_typography---font--primary-family'] || '"Neulis Neue", sans-serif';

console.log(`  Found ${Object.keys(baseVars).length} :root variables`);
console.log(`  Found ${Object.keys(themeVars).length} theme variants`);
console.log(`  Found ${Object.keys(classVars).length} classes with custom properties`);

console.log('Parsing CSS rules...');
const { rules, mediaRules, pseudoRules, keyframes, otherAtRules } = parseRules(styleContents);
console.log(`  ${rules.length} base rules`);
console.log(`  ${mediaRules.length} responsive rules`);
console.log(`  ${pseudoRules.length} pseudo rules`);
console.log(`  ${keyframes.length} keyframe blocks`);

// Build class→declarations map for simple class selectors
const classMap = new Map(); // className → [{ decls, specificity }]

for (const rule of rules) {
  const simpleInfo = getSimpleClasses(rule.selector);
  if (!simpleInfo) continue;

  for (const { classes } of simpleInfo) {
    if (classes.length === 1) {
      const cls = classes[0];
      if (!classMap.has(cls)) classMap.set(cls, []);
      classMap.get(cls).push(rule.decls);
    }
  }
}

console.log(`  ${classMap.size} simple class mappings built`);

// ============================================================
// STEP 5: Load HTML and process elements
// ============================================================

console.log('Processing HTML...');

// Remove all <style> blocks from the HTML first
let cleanHTML = html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');

// Remove the phase comment
cleanHTML = cleanHTML.replace(/<!-- PHASE 1b:.*?-->\n?/, '');

const $ = cheerio.load(cleanHTML, { decodeEntities: false });

let elementsProcessed = 0;
let stylesApplied = 0;
let classesRemoved = 0;

// Track which classes are actually used for non-inlinable rules
const usedInPseudo = new Set();
const usedInMedia = new Set();
const usedInComplex = new Set();

// Collect classes used in pseudo and media rules
for (const rule of pseudoRules) {
  const matches = rule.selector.match(/\.([a-zA-Z_-][\w-]*)/g);
  if (matches) matches.forEach(m => usedInPseudo.add(m.slice(1)));
}
for (const rule of mediaRules) {
  const matches = rule.selector.match(/\.([a-zA-Z_-][\w-]*)/g);
  if (matches) matches.forEach(m => usedInMedia.add(m.slice(1)));
}
// Complex selectors (combinators, attribute selectors, etc.)
for (const rule of rules) {
  const simpleInfo = getSimpleClasses(rule.selector);
  if (!simpleInfo) {
    const matches = rule.selector.match(/\.([a-zA-Z_-][\w-]*)/g);
    if (matches) matches.forEach(m => usedInComplex.add(m.slice(1)));
  }
}

// Identify theme classes that should be kept for cascading
const themeClasses = new Set(Object.keys(themeVars).map(s => s.slice(1)));

// Process each element
$('*').each(function () {
  const el = $(this);
  const classAttr = el.attr('class') || '';
  const classes = classAttr.split(/\s+/).filter(Boolean);

  const existingStyle = el.attr('style') || '';

  // Skip elements with no classes AND no inline styles to resolve
  if (classes.length === 0 && !existingStyle.includes('var(')) return;

  // Determine theme context for this element
  const themes = [];
  const ancestors = el.parents().toArray().reverse();
  for (const anc of ancestors) {
    const ancClasses = ($(anc).attr('class') || '').split(/\s+/);
    for (const c of ancClasses) {
      if (themeClasses.has(c)) themes.push(c);
    }
  }
  // Add own theme classes
  for (const c of classes) {
    if (themeClasses.has(c)) themes.push(c);
  }

  // Collect all classes from ancestors too for class-level vars
  const allAncestorClasses = [];
  for (const anc of ancestors) {
    const ancClasses = ($(anc).attr('class') || '').split(/\s+/);
    allAncestorClasses.push(...ancClasses);
  }
  const fullClassList = [...allAncestorClasses, ...classes];
  const varContext = buildVarContext(themes, baseVars, themeVars, fullClassList, classVars);

  // Compute inline styles from class declarations
  const computedStyles = {};
  const keepClasses = [];

  for (const cls of classes) {
    // Always keep theme classes (they cascade to children)
    if (themeClasses.has(cls)) {
      keepClasses.push(cls);
      continue;
    }

    // Keep classes used in pseudo/media/complex rules
    if (usedInPseudo.has(cls) || usedInMedia.has(cls) || usedInComplex.has(cls)) {
      keepClasses.push(cls);
    }

    // Get declarations for this class
    const declsList = classMap.get(cls);
    if (declsList) {
      for (const decls of declsList) {
        for (const [prop, val] of Object.entries(decls)) {
          if (prop.startsWith('--')) {
            // CSS custom property - set in var context and also as inline custom prop
            computedStyles[prop] = resolveVar(val, varContext);
          } else {
            computedStyles[prop] = resolveVar(val, varContext);
          }
        }
      }
      classesRemoved++;
    } else {
      // Class not in our simple map - keep it (might be used by JS, or complex selectors)
      keepClasses.push(cls);
    }
  }

  // Merge with existing inline styles
  const existingDecls = {};
  if (existingStyle) {
    existingStyle.split(';').forEach(decl => {
      const colonIdx = decl.indexOf(':');
      if (colonIdx !== -1) {
        const prop = decl.slice(0, colonIdx).trim();
        const val = decl.slice(colonIdx + 1).trim();
        if (prop) existingDecls[prop] = val;
      }
    });
  }

  // Existing inline styles take precedence (they're more specific)
  const finalStyles = { ...computedStyles, ...existingDecls };

  // Resolve any remaining var() references in final styles
  for (const [prop, val] of Object.entries(finalStyles)) {
    if (val && val.includes('var(')) {
      finalStyles[prop] = resolveVar(val, varContext);
    }
  }

  // Build style string
  const styleStr = Object.entries(finalStyles)
    .map(([prop, val]) => `${prop}: ${val}`)
    .join('; ');

  if (styleStr) {
    el.attr('style', styleStr);
    stylesApplied += Object.keys(finalStyles).length;
  }

  // Update classes
  if (keepClasses.length > 0) {
    el.attr('class', keepClasses.join(' '));
  } else {
    el.removeAttr('class');
  }

  elementsProcessed++;
});

// ============================================================
// STEP 6: Build minimal stylesheet for non-inlinable rules
// ============================================================

console.log('Building minimal stylesheet...');

let minimalCSS = '';

// Keep keyframes
if (keyframes.length > 0) {
  minimalCSS += '/* Keyframes */\n';
  minimalCSS += keyframes.join('\n\n') + '\n\n';
}

// Keep other @-rules (font-face, etc.)
if (otherAtRules.length > 0) {
  minimalCSS += '/* Font faces & other @-rules */\n';
  minimalCSS += otherAtRules.join('\n\n') + '\n\n';
}

// Resolve variables in pseudo rules and keep them
if (pseudoRules.length > 0) {
  minimalCSS += '/* Pseudo-class & pseudo-element rules */\n';
  const defaultContext = buildVarContext(['u-theme-dark'], baseVars, themeVars, [], classVars);

  for (const rule of pseudoRules) {
    const resolvedDecls = Object.entries(rule.decls)
      .map(([prop, val]) => `  ${prop}: ${resolveVar(val, defaultContext)};`)
      .join('\n');
    if (resolvedDecls.trim()) {
      minimalCSS += `${rule.selector} {\n${resolvedDecls}\n}\n`;
    }
  }
  minimalCSS += '\n';
}

// Resolve variables in media rules and keep them
if (mediaRules.length > 0) {
  minimalCSS += '/* Responsive rules */\n';
  const defaultContext = buildVarContext(['u-theme-dark'], baseVars, themeVars, [], classVars);

  // Group by media query
  const mediaGroups = new Map();
  for (const rule of mediaRules) {
    if (!mediaGroups.has(rule.media)) mediaGroups.set(rule.media, []);
    mediaGroups.get(rule.media).push(rule);
  }

  for (const [media, groupRules] of mediaGroups) {
    minimalCSS += `${media} {\n`;
    for (const rule of groupRules) {
      const resolvedDecls = Object.entries(rule.decls)
        .map(([prop, val]) => `    ${prop}: ${resolveVar(val, defaultContext)};`)
        .join('\n');
      if (resolvedDecls.trim()) {
        minimalCSS += `  ${rule.selector} {\n${resolvedDecls}\n  }\n`;
      }
    }
    minimalCSS += '}\n\n';
  }
}

// Keep complex selector rules (combinators, attribute selectors, etc.)
const complexRules = rules.filter(r => !getSimpleClasses(r.selector));
if (complexRules.length > 0) {
  minimalCSS += '/* Complex selector rules */\n';
  const defaultContext = buildVarContext(['u-theme-dark'], baseVars, themeVars, [], classVars);

  for (const rule of complexRules) {
    // Skip :root (already resolved)
    if (rule.selector.trim() === ':root') continue;
    // Skip theme definitions (already resolved)
    if (/^\.(u-theme-\w+)$/.test(rule.selector.trim())) continue;

    const resolvedDecls = Object.entries(rule.decls)
      .map(([prop, val]) => `  ${prop}: ${resolveVar(val, defaultContext)};`)
      .join('\n');
    if (resolvedDecls.trim()) {
      minimalCSS += `${rule.selector} {\n${resolvedDecls}\n}\n`;
    }
  }
}

// ============================================================
// STEP 7: Reassemble final HTML
// ============================================================

console.log('Assembling output...');

// Get the processed HTML
let outputHTML = $.html();

// Insert the minimal stylesheet in <head>
const headClose = outputHTML.indexOf('</head>');
if (headClose !== -1) {
  const styleBlock = `\n<style>\n/* Normalized CSS - LUMOS resolved to plain CSS */\n${minimalCSS}\n</style>\n`;
  outputHTML = outputHTML.slice(0, headClose) + styleBlock + outputHTML.slice(headClose);
}

// Add comment at top
outputHTML = '<!-- NORMALIZED: LUMOS framework resolved to plain HTML+CSS -->\n' + outputHTML;

// Fix cheerio's HTML entity encoding issues
outputHTML = outputHTML.replace(/&apos;/g, "'");

fs.writeFileSync(outputFile, outputHTML, 'utf-8');

const inputSize = Buffer.byteLength(html, 'utf-8');
const outputSize = Buffer.byteLength(outputHTML, 'utf-8');

console.log('\n=== Conversion Results ===');
console.log(`Elements processed: ${elementsProcessed}`);
console.log(`Inline styles applied: ${stylesApplied} properties`);
console.log(`Utility classes resolved: ${classesRemoved}`);
console.log(`Pseudo rules kept: ${pseudoRules.length}`);
console.log(`Responsive rules kept: ${mediaRules.length}`);
console.log(`Complex selector rules kept: ${complexRules.length}`);
console.log(`Keyframe blocks kept: ${keyframes.length}`);
console.log(`File size: ${(inputSize/1024).toFixed(1)}KB → ${(outputSize/1024).toFixed(1)}KB`);
console.log(`Output: ${outputFile}`);
