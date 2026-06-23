const fs = require('fs');
const path = require('path');
const { parseRouter } = require('./parser');

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

  // Load components
  const components = loadComponents(path.join(appDir, 'components'));

  // Discover and compile pages
  const pagesDir = path.join(appDir, 'pages');
  const pagesOutDir = path.join(outDir, 'pages');
  fs.mkdirSync(pagesOutDir, { recursive: true });

  for (const route of routes) {
    const pageDir = path.join(pagesDir, route.page);
    const jsFile = path.join(pageDir, route.page + '.js');
    const htmlFile = path.join(pageDir, route.page + '.html');

    // Copy JS file to dist/pages/
    if (fs.existsSync(jsFile)) {
      fs.copyFileSync(jsFile, path.join(pagesOutDir, route.page + '.js'));
    } else {
      fs.writeFileSync(path.join(pagesOutDir, route.page + '.js'), '// no js file');
    }

    // Process HTML: expand components, then write
    let htmlContent = '';
    if (fs.existsSync(htmlFile)) {
      htmlContent = fs.readFileSync(htmlFile, 'utf-8');
      htmlContent = expandComponents(htmlContent, components);
    }
    fs.writeFileSync(path.join(pagesOutDir, route.page + '.html'), htmlContent);
  }

  // Copy static assets
  const imagesDir = path.join(appDir, 'images');
  if (fs.existsSync(imagesDir)) {
    const imagesOutDir = path.join(outDir, 'images');
    fs.mkdirSync(imagesOutDir, { recursive: true });
    for (const file of fs.readdirSync(imagesDir)) {
      fs.copyFileSync(path.join(imagesDir, file), path.join(imagesOutDir, file));
    }
  }

  // Copy root-level static files (css, etc.)
  const staticExts = ['.css', '.ico', '.svg'];
  for (const file of fs.readdirSync(appDir)) {
    if (staticExts.includes(path.extname(file))) {
      fs.copyFileSync(path.join(appDir, file), path.join(outDir, file));
    }
  }

  // Generate index.html
  const shellHtml = generateShell(appDir, routes);
  fs.writeFileSync(path.join(outDir, 'index.html'), shellHtml);

  console.log(`Built ${routes.length} page(s) to ${outDir}/`);
}

function generateShell(appDir, routes) {
  // Check for custom shell
  const shellPath = path.join(appDir, 'shell.html');
  let shellTemplate = null;
  if (fs.existsSync(shellPath)) {
    shellTemplate = fs.readFileSync(shellPath, 'utf-8');
  }

  // Build route map: path -> { html file, js file }
  const routeEntries = routes.map(r =>
    `    ${JSON.stringify(r.path)}: { html: ${JSON.stringify('pages/' + r.page + '.html')}, js: ${JSON.stringify('pages/' + r.page + '.js')} }`
  ).join(',\n');

  const routerScript = `<script>
  (function() {
    var routes = {
${routeEntries}
    };

    var app = document.getElementById('__totley_app');
    var currentScript = null;

    // In-memory caches so revisiting a page never re-fetches.
    var htmlCache = {};
    var jsCache = {};

    // Monotonic token: only the latest navigation is allowed to touch the DOM,
    // so a slow earlier fetch can't overwrite a newer page.
    var navToken = 0;

    function fetchText(url, cache) {
      if (Object.prototype.hasOwnProperty.call(cache, url)) {
        return Promise.resolve(cache[url]);
      }
      return fetch(url).then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
        return res.text();
      }).then(function(text) {
        cache[url] = text;
        return text;
      });
    }

    function render(route, token) {
      return fetchText(route.html, htmlCache).then(function(html) {
        if (token !== navToken) return;
        app.innerHTML = html;
        return fetchText(route.js, jsCache).then(function(js) {
          if (token !== navToken) return;
          // Remove old page script
          if (currentScript) { currentScript.remove(); currentScript = null; }
          // Execute cached page JS (re-runs on each visit, no re-download)
          var script = document.createElement('script');
          script.textContent = js;
          script.dataset.totleyPage = 'true';
          document.body.appendChild(script);
          currentScript = script;
        });
      }).catch(function(err) {
        if (token !== navToken) return;
        app.innerHTML = '<h1>Error</h1><p>Failed to load page.</p>';
        if (window.console) console.error('[totley] navigation failed:', err);
      });
    }

    function navigate(url) {
      var pathname = url.split('?')[0].split('#')[0];
      var route = routes[pathname];
      var token = ++navToken;

      // Update URL (skip if it already matches, e.g. popstate / initial load)
      if (window.location.pathname + window.location.search !== url) {
        history.pushState(null, '', url);
      }

      if (!route) {
        app.innerHTML = '<h1>404</h1><p>Page not found.</p>';
        return;
      }
      render(route, token);
    }

    // Warm the cache without rendering (used on link hover).
    function prefetch(pathname) {
      var route = routes[pathname];
      if (!route) return;
      fetchText(route.html, htmlCache).catch(function() {});
      fetchText(route.js, jsCache).catch(function() {});
    }

    // Public navigate function for tot files
    window.__totley_navigate = navigate;

    // Handle back/forward
    window.addEventListener('popstate', function() {
      navigate(window.location.pathname + window.location.search);
    });

    // Intercept link clicks for SPA navigation
    document.addEventListener('click', function(e) {
      // Let the browser handle modified clicks (open in new tab, etc.)
      if (e.defaultPrevented || e.button !== 0 ||
          e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      if (a.target && a.target !== '_self') return;
      if (a.hasAttribute('download')) return;
      var href = a.getAttribute('href');
      // Same-origin app paths only; skip protocol-relative ("//host").
      if (!href || href.charAt(0) !== '/' || href.charAt(1) === '/') return;
      e.preventDefault();
      navigate(href);
    });

    // Prefetch on hover so the page is usually cached before the click.
    document.addEventListener('mouseover', function(e) {
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) !== '/' || href.charAt(1) === '/') return;
      prefetch(href.split('?')[0].split('#')[0]);
    });

    // Initial load
    navigate(window.location.pathname + window.location.search);
  })();
  </script>`;

  // If custom shell exists, inject router into it
  if (shellTemplate) {
    return shellTemplate.replace('{{TOTLEY_ROUTER}}', routerScript);
  }

  // Fallback: generate a basic shell
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Totley App</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 20px; }
  </style>
</head>
<body>
  <div id="__totley_app"></div>
  ${routerScript}
</body>
</html>`;
}

function loadComponents(componentsDir) {
  const components = {};
  if (!fs.existsSync(componentsDir)) return components;

  const files = fs.readdirSync(componentsDir).filter(f => f.endsWith('.html'));
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
