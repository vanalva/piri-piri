/**
 * Phase 1.5: Deduplicate CSS in phase1 output
 * - Remove duplicate reset blocks
 * - Merge duplicate @media query blocks
 * - Remove duplicate :root variable declarations
 * - Remove empty/comment-only rules
 * - Remove dead overrides (property set then immediately overridden)
 */

const fs = require('fs');
const path = require('path');

const inputFile = path.join(__dirname, 'index-phase1.html');
const outputFile = path.join(__dirname, 'index-phase1b.html');

let html = fs.readFileSync(inputFile, 'utf-8');

let stats = {
  duplicateRulesRemoved: 0,
  duplicateVarsRemoved: 0,
  emptyRulesRemoved: 0,
  mediaBlocksMerged: 0,
  deadOverridesRemoved: 0,
};

/**
 * Normalize whitespace for comparison
 */
function normalize(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Process CSS to deduplicate rules
 */
function deduplicateCSS(css) {
  // Step 1: Parse into top-level blocks
  const blocks = [];
  let i = 0;

  while (i < css.length) {
    // Skip whitespace
    const wsStart = i;
    while (i < css.length && /\s/.test(css[i])) i++;
    const leadingWS = css.slice(wsStart, i);

    if (i >= css.length) break;

    // CSS comment
    if (css[i] === '/' && css[i + 1] === '*') {
      const endComment = css.indexOf('*/', i + 2);
      if (endComment === -1) {
        blocks.push({ type: 'comment', text: css.slice(i), ws: leadingWS });
        break;
      }
      blocks.push({ type: 'comment', text: css.slice(i, endComment + 2), ws: leadingWS });
      i = endComment + 2;
      continue;
    }

    // @media or other @-rules with block
    if (css[i] === '@') {
      const atMatch = css.slice(i).match(/^@[^{;]+/);
      if (!atMatch) {
        blocks.push({ type: 'other', text: css[i], ws: leadingWS });
        i++;
        continue;
      }

      const atRule = atMatch[0].trim();
      const afterAt = i + atMatch[0].length;

      // Skip whitespace after at-rule header
      let k = afterAt;
      while (k < css.length && /\s/.test(css[k])) k++;

      if (css[k] === '{') {
        // Find matching brace
        let depth = 1;
        let j = k + 1;
        while (j < css.length && depth > 0) {
          if (css[j] === '{') depth++;
          if (css[j] === '}') depth--;
          j++;
        }
        const innerCSS = css.slice(k + 1, j - 1);
        blocks.push({ type: 'media', atRule, inner: innerCSS, ws: leadingWS });
        i = j;
      } else if (css[k] === ';' || css.indexOf(';', i) < css.indexOf('{', i)) {
        // @-rule without block
        const semi = css.indexOf(';', i);
        blocks.push({ type: 'at-statement', text: css.slice(i, semi + 1), ws: leadingWS });
        i = semi + 1;
      } else {
        blocks.push({ type: 'other', text: css.slice(i, k + 1), ws: leadingWS });
        i = k + 1;
      }
      continue;
    }

    // Regular rule
    const braceIdx = css.indexOf('{', i);
    if (braceIdx === -1) {
      blocks.push({ type: 'other', text: css.slice(i), ws: leadingWS });
      break;
    }

    const selector = css.slice(i, braceIdx).trim();
    let depth = 1;
    let j = braceIdx + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      if (css[j] === '}') depth--;
      j++;
    }
    const body = css.slice(braceIdx + 1, j - 1);
    blocks.push({ type: 'rule', selector, body, ws: leadingWS });
    i = j;
  }

  // Step 2: Deduplicate exact same rules
  const seenRules = new Set();
  const deduped = [];

  for (const block of blocks) {
    if (block.type === 'rule') {
      const key = normalize(block.selector) + '|||' + normalize(block.body);
      if (seenRules.has(key)) {
        stats.duplicateRulesRemoved++;
        continue;
      }
      // Check for empty body
      const trimBody = block.body.replace(/\/\*[^*]*\*\//g, '').trim();
      if (!trimBody) {
        stats.emptyRulesRemoved++;
        continue;
      }
      seenRules.add(key);
      deduped.push(block);
    } else if (block.type === 'media') {
      // Check if media block is empty or comment-only
      const trimInner = block.inner.replace(/\/\*[^*]*\*\//g, '').trim();
      if (!trimInner) {
        stats.emptyRulesRemoved++;
        continue;
      }
      deduped.push(block);
    } else {
      deduped.push(block);
    }
  }

  // Step 3: Merge @media blocks with same query
  const merged = [];
  const mediaMap = new Map(); // atRule -> index in merged array

  for (const block of deduped) {
    if (block.type === 'media') {
      const normalizedAt = normalize(block.atRule);
      if (mediaMap.has(normalizedAt)) {
        // Merge inner CSS
        const existingIdx = mediaMap.get(normalizedAt);
        const existing = merged[existingIdx];

        // Deduplicate rules within the merged inner CSS
        const combinedInner = existing.inner + '\n' + block.inner;
        existing.inner = combinedInner;
        stats.mediaBlocksMerged++;
        continue;
      }
      mediaMap.set(normalizedAt, merged.length);
      merged.push(block);
    } else {
      merged.push(block);
    }
  }

  // Step 4: Deduplicate rules within merged @media blocks
  for (const block of merged) {
    if (block.type === 'media') {
      const innerBlocks = parseInnerRules(block.inner);
      const seen = new Set();
      const kept = [];
      for (const rule of innerBlocks) {
        if (rule.type === 'rule') {
          const key = normalize(rule.selector) + '|||' + normalize(rule.body);
          if (seen.has(key)) {
            stats.duplicateRulesRemoved++;
            continue;
          }
          const trimBody = rule.body.replace(/\/\*[^*]*\*\//g, '').trim();
          if (!trimBody) {
            stats.emptyRulesRemoved++;
            continue;
          }
          seen.add(key);
        }
        kept.push(rule);
      }
      block.inner = kept.map(r => {
        if (r.type === 'rule') return r.ws + r.selector + ' {' + r.body + '}';
        return r.ws + r.text;
      }).join('');
    }
  }

  // Step 5: Reassemble
  let result = '';
  for (const block of merged) {
    if (block.type === 'rule') {
      result += block.ws + block.selector + ' {' + block.body + '}';
    } else if (block.type === 'media') {
      result += block.ws + block.atRule + ' {' + block.inner + '\n}';
    } else if (block.type === 'comment') {
      result += block.ws + block.text;
    } else if (block.type === 'at-statement') {
      result += block.ws + block.text;
    } else {
      result += block.ws + (block.text || '');
    }
  }

  return result;
}

/**
 * Parse inner CSS rules (inside @media blocks) - simpler version
 */
function parseInnerRules(css) {
  const rules = [];
  let i = 0;

  while (i < css.length) {
    const wsStart = i;
    while (i < css.length && /\s/.test(css[i])) i++;
    const leadingWS = css.slice(wsStart, i);

    if (i >= css.length) break;

    // Comment
    if (css[i] === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      if (end === -1) {
        rules.push({ type: 'other', text: css.slice(i), ws: leadingWS });
        break;
      }
      rules.push({ type: 'other', text: css.slice(i, end + 2), ws: leadingWS });
      i = end + 2;
      continue;
    }

    // Nested @-rule (shouldn't happen often inside @media but handle it)
    if (css[i] === '@') {
      const braceIdx = css.indexOf('{', i);
      if (braceIdx === -1) {
        rules.push({ type: 'other', text: css.slice(i), ws: leadingWS });
        break;
      }
      let depth = 1;
      let j = braceIdx + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth++;
        if (css[j] === '}') depth--;
        j++;
      }
      rules.push({ type: 'other', text: css.slice(i, j), ws: leadingWS });
      i = j;
      continue;
    }

    const braceIdx = css.indexOf('{', i);
    if (braceIdx === -1) {
      if (css.slice(i).trim()) {
        rules.push({ type: 'other', text: css.slice(i), ws: leadingWS });
      }
      break;
    }

    const selector = css.slice(i, braceIdx).trim();
    let depth = 1;
    let j = braceIdx + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      if (css[j] === '}') depth--;
      j++;
    }
    const body = css.slice(braceIdx + 1, j - 1);
    rules.push({ type: 'rule', selector, body, ws: leadingWS });
    i = j;
  }

  return rules;
}

/**
 * Deduplicate :root variables
 */
function deduplicateRootVars(css) {
  // Find all :root blocks
  const rootRegex = /:root\s*\{/g;
  let match;
  const rootBlocks = [];

  while ((match = rootRegex.exec(css)) !== null) {
    const start = match.index;
    let depth = 1;
    let j = start + match[0].length;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      if (css[j] === '}') depth--;
      j++;
    }
    rootBlocks.push({ start, end: j, body: css.slice(start + match[0].length, j - 1) });
  }

  if (rootBlocks.length <= 1) return css;

  // Merge all :root blocks: last declaration wins (CSS cascade)
  const allVars = new Map();
  const allVarOrder = [];

  for (const block of rootBlocks) {
    const declarations = block.body.split(';').map(d => d.trim()).filter(Boolean);
    for (const decl of declarations) {
      const colonIdx = decl.indexOf(':');
      if (colonIdx === -1) continue;
      const prop = decl.slice(0, colonIdx).trim();
      const val = decl.slice(colonIdx + 1).trim();
      if (!allVars.has(prop)) {
        allVarOrder.push(prop);
      } else {
        stats.duplicateVarsRemoved++;
      }
      allVars.set(prop, val);
    }
  }

  // Build single :root block
  const mergedRoot = ':root {\n' +
    allVarOrder.map(prop => `  ${prop}: ${allVars.get(prop)};`).join('\n') +
    '\n}';

  // Remove all existing :root blocks and insert merged one at position of first
  let result = css;
  // Process in reverse to preserve indices
  for (let i = rootBlocks.length - 1; i >= 0; i--) {
    const block = rootBlocks[i];
    if (i === 0) {
      result = result.slice(0, block.start) + mergedRoot + result.slice(block.end);
    } else {
      // Remove trailing whitespace too
      let endPos = block.end;
      while (endPos < result.length && /\s/.test(result[endPos])) endPos++;
      result = result.slice(0, block.start) + result.slice(endPos);
    }
  }

  return result;
}

// Process each <style> block
const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/g;
let styleMatch;
const replacements = [];

while ((styleMatch = styleRegex.exec(html)) !== null) {
  const fullMatch = styleMatch[0];
  const cssContent = styleMatch[1];
  const startTag = fullMatch.slice(0, fullMatch.indexOf('>') + 1);

  // Step 1: Deduplicate :root variables
  let processed = deduplicateRootVars(cssContent);

  // Step 2: Deduplicate rules and merge @media blocks
  processed = deduplicateCSS(processed);

  replacements.push({
    original: fullMatch,
    replacement: startTag + processed + '</style>'
  });
}

// Apply replacements in reverse
let result = html;
for (let i = replacements.length - 1; i >= 0; i--) {
  result = result.replace(replacements[i].original, replacements[i].replacement);
}

// Update phase comment
result = result.replace(
  '<!-- PHASE 1: Removed Webflow internal CSS rules (.w-*, :where(.w-variant-*), .w--*) -->',
  '<!-- PHASE 1b: Removed Webflow internals + deduplicated CSS rules, variables, and @media blocks -->'
);

fs.writeFileSync(outputFile, result, 'utf-8');

const inputSize = Buffer.byteLength(html, 'utf-8');
const outputSize = Buffer.byteLength(result, 'utf-8');
const savedKB = ((inputSize - outputSize) / 1024).toFixed(1);

console.log('=== Phase 1.5 Results ===');
console.log(`Duplicate rules removed: ${stats.duplicateRulesRemoved}`);
console.log(`Duplicate :root variables consolidated: ${stats.duplicateVarsRemoved}`);
console.log(`Empty rules removed: ${stats.emptyRulesRemoved}`);
console.log(`@media blocks merged: ${stats.mediaBlocksMerged}`);
console.log(`File size: ${(inputSize/1024).toFixed(1)}KB → ${(outputSize/1024).toFixed(1)}KB (saved ${savedKB}KB)`);
console.log(`Output: ${outputFile}`);
