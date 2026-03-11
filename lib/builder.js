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

    function navigate(pathname) {
      var route = routes[pathname];
      if (!route) {
        app.innerHTML = '<h1>404</h1><p>Page not found.</p>';
        return;
      }

      // Fetch the HTML partial
      fetch(route.html)
        .then(function(res) { return res.text(); })
        .then(function(html) {
          app.innerHTML = html;

          // Remove old page script
          if (currentScript) {
            currentScript.remove();
            currentScript = null;
          }

          // Load page JS
          var script = document.createElement('script');
          script.src = route.js;
          script.dataset.totleyPage = 'true';
          document.body.appendChild(script);
          currentScript = script;
        });

      // Update URL
      if (window.location.pathname !== pathname) {
        history.pushState(null, '', pathname);
      }
    }

    // Public navigate function for tot files
    window.__totley_navigate = navigate;

    // Handle back/forward
    window.addEventListener('popstate', function() {
      navigate(window.location.pathname);
    });

    // Intercept link clicks for SPA navigation
    document.addEventListener('click', function(e) {
      var a = e.target.closest('a[href]');
      if (a && a.getAttribute('href').startsWith('/')) {
        e.preventDefault();
        navigate(a.getAttribute('href'));
      }
    });

    // Initial load
    navigate(window.location.pathname);
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
