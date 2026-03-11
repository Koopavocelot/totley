/**
 * Totley router.tot parser
 *
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

module.exports = { parseRouter };
