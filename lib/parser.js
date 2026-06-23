/**
 * Totley parsers
 */

/**
 * router.tot syntax:
 *   "/path" pageName
 */
function parseRouter(source) {
  const routes = [];
  const lines = source.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^"(.+?)"\s+(\S+)$/);
    if (m) {
      routes.push({ path: m[1], page: m[2] });
    }
  }
  return routes;
}

/**
 * Page front-matter: an optional leading HTML comment block of key: value lines.
 *
 *   <!--totley
 *   title: Contact Us — Yonosphere
 *   description: Get in touch with us.
 *   -->
 *   <div>...page content...</div>
 *
 * Returns { meta, content } with the front-matter stripped from content.
 */
function parsePage(source) {
  const meta = {};
  let content = source;

  const m = source.match(/^﻿?\s*<!--\s*totley\b([\s\S]*?)-->/i);
  if (m) {
    const lines = m[1].split('\n');
    for (const line of lines) {
      const kv = line.match(/^\s*([\w-]+)\s*:\s*(.*)$/);
      if (kv) meta[kv[1].trim()] = kv[2].trim();
    }
    content = source.slice(m[0].length);
  }

  return { meta, content: content.trim() };
}

module.exports = { parseRouter, parsePage };
