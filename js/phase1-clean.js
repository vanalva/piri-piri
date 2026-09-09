/**
 * Phase 1: Remove Webflow internal CSS rules from standalone HTML
 * - Removes .w-* CSS rules (Webflow components)
 * - Removes :where(.w-variant-*) rules
 * - Removes .w--* state rules
 * - Keeps .w-* classes on HTML elements
 * - Keeps non-.w- rules that reference .w- in :has()/:not() context
 */

const fs = require('fs');
const path = require('path');

const inputFile = path.join(__dirname, 'index-standalone.html');
const outputFile = path.join(__dirname, 'index-phase1.html');

const html = fs.readFileSync(inputFile, 'utf-8');

// Stats
let removedRules = 0;
let removedMediaBlocks = 0;
let removedProperties = 0;
let keptRules = 0;

/**
 * Check if a selector is a Webflow internal selector that should be removed
 */
function isWebflowSelector(selector) {
  const s = selector.trim();

  // Pure .w-* selectors (not .w-- state selectors handled separately)
  // e.g. .w-form, .w-embed, .w-nav, .w-slider, .w-richtext
  if (/^\.w-[a-z]/.test(s)) return true;

  // .w--current, .w--open etc (state selectors)
  if (/\.w--/.test(s)) return true;

  // :where(.w-variant-*) selectors
  if (/\.w-variant-/.test(s)) return true;

  // [class*="w-"] attribute selectors
  if (/\[class\*=["']w-/.test(s)) return true;

  // Compound selectors that include .w-* as primary target
  // e.g. ".w-nav[data-collapse='medium']", ".w-slider-mask"
  if (/\.w-[a-z][a-z0-9_-]*/.test(s)) {
    // But NOT if .w- only appears inside :has() or :not() of a non-.w- selector
    // e.g. "[data-trigger~='hover-if-clickable']:has(.clickable_wrap:not(.w-condition-invisible)):hover"
    // In this case the primary selector is [data-trigger...], not .w-*
    const withoutFunctional = s.replace(/:(?:has|not|is|where)\([^)]*\)/g, '');
    if (!/\.w-/.test(withoutFunctional)) {
      return false; // .w- only appears inside :has/:not, keep this rule
    }
    return true;
  }

  return false;
}

/**
 * Check if ALL selectors in a comma-separated selector list are Webflow selectors
 */
function shouldRemoveRule(selectorList) {
  const selectors = selectorList.split(',').map(s => s.trim());
  return selectors.every(s => isWebflowSelector(s));
}

/**
 * Count properties in a CSS declaration block
 */
function countProperties(block) {
  const matches = block.match(/[^{}]+(?=\s*[;}])/g);
  return matches ? matches.filter(m => m.includes(':')).length : 0;
}

/**
 * Process a CSS string to remove Webflow rules
 */
function processCSS(css) {
  let result = '';
  let i = 0;

  while (i < css.length) {
    // Skip whitespace
    if (/\s/.test(css[i])) {
      result += css[i];
      i++;
      continue;
    }

    // CSS comment
    if (css[i] === '/' && css[i + 1] === '*') {
      const endComment = css.indexOf('*/', i + 2);
      if (endComment === -1) {
        result += css.slice(i);
        break;
      }
      result += css.slice(i, endComment + 2);
      i = endComment + 2;
      continue;
    }

    // @media or other @-rules
    if (css[i] === '@') {
      const atRuleMatch = css.slice(i).match(/^@[^{]+/);
      if (!atRuleMatch) {
        result += css[i];
        i++;
        continue;
      }

      const atRule = atRuleMatch[0];
      const blockStart = i + atRule.length;

      if (css[blockStart] === '{') {
        // Find matching closing brace
        let depth = 1;
        let j = blockStart + 1;
        while (j < css.length && depth > 0) {
          if (css[j] === '{') depth++;
          if (css[j] === '}') depth--;
          j++;
        }

        const innerCSS = css.slice(blockStart + 1, j - 1);
        const processedInner = processCSS(innerCSS);

        // Check if the @media block is now empty after processing
        const trimmedInner = processedInner.trim();
        if (trimmedInner.length === 0) {
          removedMediaBlocks++;
          i = j;
          continue;
        }

        result += atRule + '{' + processedInner + '}';
        i = j;
      } else {
        // @-rule without block (e.g. @import)
        const semicolonIdx = css.indexOf(';', i);
        if (semicolonIdx === -1) {
          result += css.slice(i);
          break;
        }
        result += css.slice(i, semicolonIdx + 1);
        i = semicolonIdx + 1;
      }
      continue;
    }

    // Regular rule: selector { declarations }
    const braceIdx = css.indexOf('{', i);
    if (braceIdx === -1) {
      result += css.slice(i);
      break;
    }

    const selectorPart = css.slice(i, braceIdx).trim();

    // Find matching closing brace (handle nested blocks for potential future CSS nesting)
    let depth = 1;
    let j = braceIdx + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      if (css[j] === '}') depth--;
      j++;
    }

    const declarationBlock = css.slice(braceIdx + 1, j - 1);

    if (selectorPart && shouldRemoveRule(selectorPart)) {
      // Remove this rule entirely
      removedRules++;
      removedProperties += countProperties(declarationBlock);
      i = j;
      // Skip trailing whitespace/newlines
      while (i < css.length && /[\s\n\r]/.test(css[i])) i++;
      continue;
    }

    // Check for mixed selector lists: some .w-* and some non-.w-*
    // Filter out .w-* selectors, keep the rest
    if (selectorPart) {
      const selectors = selectorPart.split(',').map(s => s.trim());
      const wSelectors = selectors.filter(s => isWebflowSelector(s));
      const keptSelectors = selectors.filter(s => !isWebflowSelector(s));

      if (wSelectors.length > 0 && keptSelectors.length > 0) {
        // Mixed list: keep only non-w selectors
        removedRules += wSelectors.length;
        keptRules++;
        const newSelector = keptSelectors.join(',\n');
        result += newSelector + ' {' + declarationBlock + '}';
        i = j;
        continue;
      }
    }

    // Keep this rule
    keptRules++;
    result += css.slice(i, j);
    i = j;
  }

  return result;
}

/**
 * Process the HTML file
 */
function processHTML(html) {
  // Find all <style> blocks and process them
  let result = html;

  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/g;
  let match;
  const replacements = [];

  while ((match = styleRegex.exec(html)) !== null) {
    const fullMatch = match[0];
    const cssContent = match[1];
    const startTag = fullMatch.slice(0, fullMatch.indexOf('>') + 1);

    const processedCSS = processCSS(cssContent);
    replacements.push({
      original: fullMatch,
      replacement: startTag + processedCSS + '</style>'
    });
  }

  // Apply replacements in reverse order to preserve indices
  for (let i = replacements.length - 1; i >= 0; i--) {
    result = result.replace(replacements[i].original, replacements[i].replacement);
  }

  return result;
}

console.log('Phase 1: Removing Webflow internal CSS rules...');
console.log('Input:', inputFile);
console.log('');

const output = processHTML(html);

// Add phase comment at the top
const phaseComment = '<!-- PHASE 1: Removed Webflow internal CSS rules (.w-*, :where(.w-variant-*), .w--*) -->\n';
const finalOutput = output.replace('<!DOCTYPE html>', phaseComment + '<!DOCTYPE html>');

fs.writeFileSync(outputFile, finalOutput, 'utf-8');

const inputSize = Buffer.byteLength(html, 'utf-8');
const outputSize = Buffer.byteLength(finalOutput, 'utf-8');
const savedKB = ((inputSize - outputSize) / 1024).toFixed(1);

console.log('=== Phase 1 Results ===');
console.log(`Rules removed: ${removedRules}`);
console.log(`Properties removed: ~${removedProperties}`);
console.log(`Empty @media blocks removed: ${removedMediaBlocks}`);
console.log(`Rules kept: ${keptRules}`);
console.log(`File size: ${(inputSize/1024).toFixed(1)}KB → ${(outputSize/1024).toFixed(1)}KB (saved ${savedKB}KB)`);
console.log(`Output: ${outputFile}`);
