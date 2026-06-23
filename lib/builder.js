const fs = require('fs');
const path = require('path');
const { parseRouter, parsePage } = require('./parser');

function build(appDir, outDir) {
  // Clean output
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  // Parse router
  const routerPath = path.join(appDir, 'router.tot');
  if (!fs.existsSync(routerPath)) {
    console.error('Error: app/router.tot not found');
    process.exit(1);
  }
  const routes = parseRouter(fs.readFileSync(routerPath, 'utf-8'));

  // Load site config (SEO / canonical URL) and components + shell
  const site = loadSiteConfig(appDir);
  const components = loadComponents(path.join(appDir, 'components'));
  const shellTemplate = loadShell(appDir);

  // Compile pages: each route becomes a real standalone HTML file.
  const pagesDir = path.join(appDir, 'pages');
  const pagesOutDir = path.join(outDir, 'pages');
  fs.mkdirSync(pagesOutDir, { recursive: true });

  for (const route of routes) {
    const pageDir = path.join(pagesDir, route.page);
    const jsFile = path.join(pageDir, route.page + '.js');
    const htmlFile = path.join(pageDir, route.page + '.html');

    // Copy page JS to dist/pages/ (referenced by an absolute <script src>).
    let hasJs = false;
    if (fs.existsSync(jsFile)) {
      fs.copyFileSync(jsFile, path.join(pagesOutDir, route.page + '.js'));
      hasJs = true;
    }

    // Read + expand page HTML, splitting off front-matter metadata.
    let rawHtml = '';
    if (fs.existsSync(htmlFile)) {
      rawHtml = fs.readFileSync(htmlFile, 'utf-8');
    }
    const { meta, content } = parsePage(rawHtml);
    route.noindex = isNoindex(meta); // used to exclude from sitemap
    const expanded = expandComponents(content, components);

    const html = renderPage({
      shellTemplate,
      site,
      meta,
      routePath: route.path,
      content: expanded,
      scriptSrc: hasJs ? '/pages/' + route.page + '.js' : null,
    });

    const outFile = path.join(outDir, routeToFile(route.path));
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, html);
  }

  // Static assets
  copyDir(path.join(appDir, 'images'), path.join(outDir, 'images'));
  const staticExts = ['.css', '.ico', '.svg', '.txt', '.xml', '.webmanifest'];
  for (const file of fs.readdirSync(appDir)) {
    if (staticExts.includes(path.extname(file))) {
      fs.copyFileSync(path.join(appDir, file), path.join(outDir, file));
    }
  }

  // SEO + fallback files
  writeSitemap(outDir, routes, site);
  writeRobots(outDir, site);
  writeNotFound(outDir, shellTemplate, site);

  console.log(`Built ${routes.length} page(s) to ${outDir}/`);
}

// "/" -> "index.html", "/news" -> "news.html", "/a/b" -> "a/b.html"
function routeToFile(routePath) {
  const clean = routePath.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!clean) return 'index.html';
  return clean + '.html';
}

function loadSiteConfig(appDir) {
  const defaults = {
    url: '',
    name: 'Totley App',
    defaultTitle: '',
    defaultDescription: '',
    ogImage: '',
    locale: 'en',
  };
  const configPath = path.join(appDir, 'site.json');
  if (fs.existsSync(configPath)) {
    try {
      return Object.assign(defaults, JSON.parse(fs.readFileSync(configPath, 'utf-8')));
    } catch (err) {
      console.warn('Warning: could not parse app/site.json:', err.message);
    }
  }
  return defaults;
}

function loadShell(appDir) {
  const shellPath = path.join(appDir, 'shell.html');
  if (fs.existsSync(shellPath)) {
    return fs.readFileSync(shellPath, 'utf-8');
  }
  // Fallback shell with the placeholders the renderer expects.
  return `<!doctype html>
<html lang="{{TOTLEY_LOCALE}}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    {{TOTLEY_HEAD}}
  </head>
  <body>
    {{TOTLEY_CONTENT}}
    {{TOTLEY_SCRIPT}}
  </body>
</html>
`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function absUrl(site, routePath) {
  if (!site.url) return null;
  const base = site.url.replace(/\/+$/, '');
  if (routePath === '/' || routePath === '') return base + '/';
  return base + '/' + routePath.replace(/^\/+/, '');
}

// A page opts out of indexing via front-matter: `noindex: true` or
// `robots: noindex` (also honours `index: false`).
function isNoindex(meta) {
  const truthy = (v) => /^(true|yes|1)$/i.test(String(v || '').trim());
  if (truthy(meta.noindex)) return true;
  if (/^(false|no|0)$/i.test(String(meta.index || '').trim())) return true;
  if (/noindex/i.test(meta.robots || '')) return true;
  return false;
}

// Build the per-page <head> block: title, description, canonical, Open Graph.
function buildHead(meta, site, routePath) {
  const title = meta.title || site.defaultTitle || site.name;
  const description = meta.description || site.defaultDescription || '';
  const noindex = isNoindex(meta);
  // No canonical on noindex pages — pointing crawlers at a page we don't
  // want indexed is contradictory.
  const canonical = noindex ? null : absUrl(site, routePath);
  const ogImage = meta.image || site.ogImage;
  const ogImageAbs = ogImage && site.url && !/^https?:\/\//.test(ogImage)
    ? site.url.replace(/\/+$/, '') + '/' + ogImage.replace(/^\/+/, '')
    : ogImage;

  const tags = [];
  tags.push(`<title>${escapeHtml(title)}</title>`);
  if (description) tags.push(`<meta name="description" content="${escapeHtml(description)}" />`);
  if (noindex) tags.push(`<meta name="robots" content="noindex, nofollow" />`);
  if (canonical) tags.push(`<link rel="canonical" href="${escapeHtml(canonical)}" />`);

  // Open Graph / Twitter
  tags.push(`<meta property="og:type" content="website" />`);
  tags.push(`<meta property="og:title" content="${escapeHtml(title)}" />`);
  if (description) tags.push(`<meta property="og:description" content="${escapeHtml(description)}" />`);
  if (canonical) tags.push(`<meta property="og:url" content="${escapeHtml(canonical)}" />`);
  if (site.name) tags.push(`<meta property="og:site_name" content="${escapeHtml(site.name)}" />`);
  if (ogImageAbs) tags.push(`<meta property="og:image" content="${escapeHtml(ogImageAbs)}" />`);
  tags.push(`<meta name="twitter:card" content="${ogImageAbs ? 'summary_large_image' : 'summary'}" />`);

  return tags.join('\n    ');
}

function renderPage({ shellTemplate, site, meta, routePath, content, scriptSrc }) {
  const head = buildHead(meta, site, routePath);
  const script = scriptSrc ? `<script src="${scriptSrc}"></script>` : '';

  let html = shellTemplate;
  html = html.replace(/\{\{TOTLEY_HEAD\}\}/g, head);
  html = html.replace(/\{\{TOTLEY_CONTENT\}\}/g, content);
  html = html.replace(/\{\{TOTLEY_SCRIPT\}\}/g, script);
  html = html.replace(/\{\{TOTLEY_LOCALE\}\}/g, site.locale || 'en');
  return html;
}

function writeSitemap(outDir, routes, site) {
  if (!site.url) return; // need an absolute base to emit a useful sitemap
  const urls = routes
    .filter((r) => !r.noindex)
    .map((r) => `  <url><loc>${escapeHtml(absUrl(site, r.path))}</loc></url>`)
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
  fs.writeFileSync(path.join(outDir, 'sitemap.xml'), xml);
}

function writeRobots(outDir, site) {
  // Skip if the project already ships its own robots.txt.
  if (fs.existsSync(path.join(outDir, 'robots.txt'))) return;
  let txt = 'User-agent: *\nAllow: /\n';
  if (site.url) {
    txt += `\nSitemap: ${site.url.replace(/\/+$/, '')}/sitemap.xml\n`;
  }
  fs.writeFileSync(path.join(outDir, 'robots.txt'), txt);
}

function writeNotFound(outDir, shellTemplate, site) {
  const html = renderPage({
    shellTemplate,
    site,
    meta: { title: 'Page not found', description: '' },
    routePath: '/404',
    content: '<div style="padding:3rem;text-align:center"><h1>404</h1><p>Page not found.</p><p><a href="/">Go home</a></p></div>',
    scriptSrc: null,
  });
  fs.writeFileSync(path.join(outDir, '404.html'), html);
}

function copyDir(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of fs.readdirSync(srcDir)) {
    const src = path.join(srcDir, file);
    const dest = path.join(destDir, file);
    if (fs.statSync(src).isDirectory()) {
      copyDir(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

function loadComponents(componentsDir) {
  const components = {};
  if (!fs.existsSync(componentsDir)) return components;

  const files = fs.readdirSync(componentsDir).filter((f) => f.endsWith('.html'));
  for (const file of files) {
    const name = path.basename(file, '.html');
    components[name] = fs.readFileSync(path.join(componentsDir, file), 'utf-8');
  }
  return components;
}

function expandComponents(html, components) {
  // Match <component name="xxx" prop="val" prop2="val2"> or self-closing />
  return html.replace(/<component\s+((?:[^>"]*|"[^"]*")*)\s*\/?\s*>/g, function (match, attrsStr) {
    // Parse attributes
    const attrs = {};
    var re = /(\w+)="([^"]*)"/g;
    var m;
    while ((m = re.exec(attrsStr)) !== null) {
      attrs[m[1]] = m[2];
    }

    var name = attrs.name;
    if (!name || !components[name]) {
      console.warn('Warning: unknown component "' + name + '"');
      return match;
    }

    // Replace {@prop} placeholders with attribute values
    var result = components[name];
    result = result.replace(/\{@(\w+)\}/g, function (_, prop) {
      return attrs[prop] !== undefined ? attrs[prop] : '';
    });

    return result;
  });
}

module.exports = { build };
