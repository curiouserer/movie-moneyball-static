/**
 * spa-404.js — the first half of the GitHub Pages deep-link dance.
 *
 * Pages has no server-side rewrite, so a request for `/director/525` is served
 * `404.html`. This script records the attempted path in the redirect URL and bounces to
 * the root, where `spa-redirect.js` restores it with `history.replaceState` before the
 * router mounts.
 *
 * **One channel, always the query string.** This used to prefer `sessionStorage` and
 * fall back to `?__p=` only when the write was refused, which bought a marginally
 * cleaner URL for the few hundred milliseconds before `replaceState` fires — after
 * which both channels produce an identical address bar. The cost was a second code
 * path, a priority rule between the two, and a second value to validate, in a file that
 * runs before any error boundary exists. One always-validated channel is the simpler
 * thing to defend (security review of #296).
 *
 * It is an external file rather than an inline block so `404.html` can carry the same
 * `script-src 'self'` CSP as `index.html`, with no `'unsafe-inline'` and no hash to keep
 * in step with the source.
 *
 * `'/?__p=' + encodeURIComponent(path)` cannot produce an absolute URL — the literal
 * prefix prevents it — and `encodeURIComponent` escapes `/ ? # & +`, so a path cannot
 * split itself into extra parameters.
 */
(function () {
  var location = window.location;
  var path = (location.pathname || '/') + location.search + location.hash;
  location.replace('/?__p=' + encodeURIComponent(path));
})();
