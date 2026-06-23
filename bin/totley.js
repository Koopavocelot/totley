#!/usr/bin/env node

const path = require('path');
const fs = require('fs');

const command = process.argv[2];

const appDir = path.resolve('app');
const outDir = path.resolve('dist');

switch (command) {
  case 'build':
    require('../lib/builder').build(appDir, outDir);
    break;

  case 'dev': {
    const http = require('http');
    const { build } = require('../lib/builder');

    // Build first
    build(appDir, outDir);

    // Watch for changes and rebuild
    let debounce = null;
    fs.watch(appDir, { recursive: true }, () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        console.log('Rebuilding...');
        build(appDir, outDir);
      }, 100);
    });

    // Serve static files
    const mimeTypes = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.webp': 'image/webp',
    };

    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);

      // Resolve like Firebase Hosting with cleanUrls: try the exact file,
      // then "<path>.html", then "<path>/index.html".
      const candidates = [];
      if (urlPath === '/') {
        candidates.push('index.html');
      } else {
        const rel = urlPath.replace(/^\/+/, '');
        candidates.push(rel);
        candidates.push(rel + '.html');
        candidates.push(path.join(rel, 'index.html'));
      }

      let filePath = null;
      for (const c of candidates) {
        const p = path.join(outDir, c);
        if (p.startsWith(outDir) && fs.existsSync(p) && fs.statSync(p).isFile()) {
          filePath = p;
          break;
        }
      }

      let status = 200;
      if (!filePath) {
        status = 404;
        const nf = path.join(outDir, '404.html');
        if (fs.existsSync(nf)) filePath = nf;
      }

      if (!filePath) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const ext = path.extname(filePath);
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(status, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });

    const port = process.env.PORT || 3000;
    server.listen(port, () => {
      console.log(`Totley dev server running at http://localhost:${port}`);
    });
    break;
  }

  case 'init': {
    const projectName = process.argv[3] || 'my-totley-app';
    const projectDir = path.resolve(projectName);

    if (fs.existsSync(projectDir)) {
      console.error(`Error: "${projectName}" already exists.`);
      process.exit(1);
    }

    // Scaffold project structure
    fs.mkdirSync(path.join(projectDir, 'app', 'pages', 'home'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'app', 'components'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'app', 'images'), { recursive: true });

    // router.tot
    fs.writeFileSync(path.join(projectDir, 'app', 'router.tot'),
      '"/" home\n');

    // shell.html
    fs.writeFileSync(path.join(projectDir, 'app', 'shell.html'),
`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="/stylesheet.css" />
    {{TOTLEY_HEAD}}
  </head>
  <body>
    <div id="__totley_app">{{TOTLEY_CONTENT}}</div>
    {{TOTLEY_SCRIPT}}
  </body>
</html>
`);

    // site.json — SEO / canonical config used to build <head>, sitemap, robots
    fs.writeFileSync(path.join(projectDir, 'app', 'site.json'),
      JSON.stringify({
        url: '',
        name: projectName,
        defaultTitle: projectName,
        defaultDescription: '',
        ogImage: '',
        locale: 'en',
      }, null, 2) + '\n');

    // stylesheet.css
    fs.writeFileSync(path.join(projectDir, 'app', 'stylesheet.css'),
`body {
  font-family: system-ui, sans-serif;
  margin: 0;
  padding: 0;
}
`);

    // home page
    fs.writeFileSync(path.join(projectDir, 'app', 'pages', 'home', 'home.html'),
`<!--totley
title: ${projectName}
description: Built with Totley
-->
<div style="padding: 2rem; text-align: center;">
  <h1>Welcome to ${projectName}</h1>
  <p id="message">Built with Totley</p>
</div>
`);

    fs.writeFileSync(path.join(projectDir, 'app', 'pages', 'home', 'home.js'),
`document.getElementById("message").textContent = "Hello from Totley!";
`);

    // package.json
    fs.writeFileSync(path.join(projectDir, 'package.json'),
      JSON.stringify({
        name: projectName,
        version: '0.1.0',
        private: true,
        scripts: {
          build: 'totley build',
          dev: 'totley dev',
        },
      }, null, 2) + '\n');

    console.log(`Created "${projectName}"/`);
    console.log('');
    console.log('  cd ' + projectName);
    console.log('  npx totley dev');
    console.log('');
    break;
  }

  default:
    console.log('');
    console.log('  totley <command>');
    console.log('');
    console.log('  Commands:');
    console.log('    init [name]  - Create a new Totley project');
    console.log('    build        - Compile app/ into dist/');
    console.log('    dev          - Build + watch + serve');
    console.log('');
}
