/**
 * spa-redirect.js — the second half of the GitHub Pages deep-link dance.
 *
 * `404.html` (via `spa-404.js`) records the attempted path as `/?__p=<encoded path>` and
 * bounces to the root. This script, loaded by `index.html` *before* the bundle, puts the
 * URL back so the router boots on the right route. It is a separate file rather than an
 * inline block so the CSP needs no `script-src 'unsafe-inline'`.
 *
 * **One channel.** An earlier version preferred `sessionStorage` and used `?__p=` only
 * when storage refused the write — which bought a cleaner URL for the few hundred
 * milliseconds before `replaceState` fires, in exchange for a second code path, a
 * priority rule, and a second value to validate, in a file that runs before any error
 * boundary exists (#296). This file now touches no storage at all.
 *
 * `__p` is attacker-supplied: anyone can hand out a link carrying any value. So:
 *
 *  - **One door to `replaceState`.** Every value, including the
 *    nothing-to-restore fallback, goes through `normalizeAndValidate`. There is no
 *    second route to the sink to remember.
 *  - **The parameter always comes off the URL**, valid or not, because a reflected
 *    `?__p=//evil.com` would otherwise survive into any link copied out of the address
 *    bar. Stripping repeats until no `__p` remains, so a nested value cannot smuggle
 *    one back in.
 *
 * **`__r`, the referrer's origin (#415).** `spa-404.js` also passes the origin of the
 * page that linked to the deep link, because the bounce makes `404.html` the landing
 * document's referrer. It is published as `window.__spaReferrer` for analytics, and
 * only when all of these hold:
 *  - it is the one `__r` beside the one valid `__p`;
 *  - it is a bare `http(s)://host[:port]` origin (no path, no query, no credentials);
 *  - it is at most 255 characters.
 * It is always stripped from the URL, like `__p`. A forged value can only mislabel one
 * visit's referrer, which a forged `Referer` header could do anyway.
 * `window.__spaReferrer` is `''` when a bounce carried no usable referrer, and absent
 * when there was no bounce.
 *
 * The worst outcome of any failure here is landing on `/`, which renders.
 */
(function () {
  var PARAM = '__p';
  var REFERRER_PARAM = '__r';

  /**
   * Cap on the restored URL. Not a security boundary — a long path harms only the
   * person who clicked it — but it keeps a 200 KB value out of the address bar and out
   * of the page URL we hand to analytics. 2048 is the conventional practical URL limit.
   */
  var MAX_LENGTH = 2048;

  /**
   * Is `value` a path this origin can safely be rewritten to?
   *
   * Allowed: a single leading `/`, then anything printable. Rejected:
   *  - a non-string, or the empty string
   *  - `//host` — protocol-relative, a different origin
   *  - `/\host` and any other backslash — browsers normalise `\` to `/`, so `/\evil.com`
   *    navigates off-origin exactly like `//evil.com`
   *  - anything not starting with `/`, which covers every scheme: `javascript:`,
   *    `data:`, `https://evil.com`
   *  - control characters and whitespace, which can be used to smuggle the above past
   *    a naive prefix check
   *  - a `:` anywhere in the path portion. `/javascript:alert(1)` is a *legitimate*
   *    same-origin path and inert here — nothing in the app renders the URL — but no
   *    route in this app has a colon in it, so accepting one buys nothing and leaves a
   *    scheme-shaped string for some future consumer to mishandle. The query and hash
   *    are exempt: `?q=a:b` is ordinary.
   */
  function isSafePath(value) {
    if (typeof value !== 'string' || value.length === 0) return false;
    if (value.charAt(0) !== '/') return false;
    if (value.charAt(1) === '/') return false;
    if (value.indexOf('\\') !== -1) return false;
    if (/[\x00-\x20\x7f]/.test(value)) return false;
    if (parts(value).path.indexOf(':') !== -1) return false;
    return true;
  }

  /** Split a path-with-query-and-hash into its three parts, without parsing. */
  function parts(pathLike) {
    var hashAt = pathLike.indexOf('#');
    var hash = hashAt === -1 ? '' : pathLike.slice(hashAt);
    var rest = hashAt === -1 ? pathLike : pathLike.slice(0, hashAt);
    var queryAt = rest.indexOf('?');
    return {
      path: queryAt === -1 ? rest : rest.slice(0, queryAt),
      query: queryAt === -1 ? '' : rest.slice(queryAt + 1),
      hash: hash,
    };
  }

  /**
   * Remove every `__p` parameter, including a valueless bare `__p`, repeating until
   * none is left. Unrelated parameters keep their order and their raw encoding.
   *
   * "Every occurrence" means every occurrence *as a parameter*. A `__p` appearing inside
   * some other parameter's value is left alone — mangling `?q=what__pays` would be a
   * bug, and such a value is inert: it is never read, only displayed.
   */
  function stripParam(pathLike) {
    var current = pathLike;
    // Bounded rather than `while (true)`: stripping strictly shortens the query, so this
    // cannot spin, and a bound means it provably cannot spin.
    for (var round = 0; round < 32; round++) {
      var p = parts(current);
      var kept = [];
      var found = false;
      var pairs = p.query.split('&');
      for (var i = 0; i < pairs.length; i++) {
        if (pairs[i].length === 0) continue;
        var eq = pairs[i].indexOf('=');
        var key = eq === -1 ? pairs[i] : pairs[i].slice(0, eq);
        if (key === PARAM || key === REFERRER_PARAM) found = true;
        else kept.push(pairs[i]);
      }
      if (!found) return current;
      current = p.path + (kept.length ? '?' + kept.join('&') : '') + p.hash;
    }
    return '/';
  }

  /**
   * Validate, resolve the way the browser will, validate *again*, strip, and bound.
   * The single door to `replaceState`.
   *
   * The second validation pass is the one that matters: a prefix check alone accepts
   * `/javascript:alert(1)/..//evil.com`, which URL normalisation collapses to
   * `//evil.com` — protocol-relative, the exact shape the first check exists to refuse.
   * Asking the `URL` parser to do the collapsing, rather than hand-rolling segment
   * arithmetic, means this agrees with the browser by construction.
   */
  function normalizeAndValidate(value) {
    if (!isSafePath(value)) return null;
    if (value.length > MAX_LENGTH) return null;
    var resolved;
    try {
      resolved = new URL(value, window.location.origin);
    } catch (e) {
      return null;
    }
    if (resolved.origin !== window.location.origin) return null;
    var normalized = stripParam(resolved.pathname + resolved.search + resolved.hash);
    if (!isSafePath(normalized)) return null;
    if (normalized.length > MAX_LENGTH) return null;
    return normalized;
  }

  /**
   * One decode pass, then validate. Deliberately *not* decoded repeatedly: a
   * double-encoded `%252F%252Fevil.com` decodes once to `%2F%2Fevil.com`, which does not
   * start with `/` and is refused — whereas decoding to a fixed point would unwrap it
   * into the very thing we are rejecting.
   */
  function decodeAndValidate(raw) {
    // Bound before decoding, so a 200 KB value is refused rather than expanded. Three
    // times the cap because the worst case is every character escaped as `%XX`.
    if (typeof raw !== 'string' || raw.length > MAX_LENGTH * 3) return null;
    var decoded;
    try {
      decoded = decodeURIComponent(raw);
    } catch (e) {
      return null; // malformed percent-encoding
    }
    return normalizeAndValidate(decoded);
  }

  /** Every value of `name` in the query, in order. A bare `name` contributes `''`. */
  function paramValues(search, name) {
    var out = [];
    var pairs = String(search || '').replace(/^\?/, '').split('&');
    for (var i = 0; i < pairs.length; i++) {
      if (pairs[i].length === 0) continue;
      var eq = pairs[i].indexOf('=');
      var key = eq === -1 ? pairs[i] : pairs[i].slice(0, eq);
      if (key === name) out.push(eq === -1 ? '' : pairs[i].slice(eq + 1));
    }
    return out;
  }

  /** A bare `http(s)://host[:port]` origin, or null. One decode pass, as for `__p`. */
  function validOrigin(raw) {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 255 * 3) return null;
    var decoded;
    try {
      decoded = decodeURIComponent(raw);
    } catch (e) {
      return null;
    }
    if (decoded.length > 255) return null;
    if (!/^https?:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?$/.test(decoded)) return null;
    try {
      var origin = new URL(decoded).origin;
      return origin === 'null' ? null : origin;
    } catch (e) {
      return null;
    }
  }

  var location = window.location;
  var values = paramValues(location.search, PARAM);
  var referrers = paramValues(location.search, REFERRER_PARAM);
  // nothing to restore and nothing to clean up
  if (values.length === 0 && referrers.length === 0) return;

  // Exactly one `__p` is what `spa-404.js` emits. More than one means something
  // rewrote the URL, so none of them is trusted — that removes "which one wins" as a
  // question to answer, and the fallback below still cleans the URL.
  var target = values.length === 1 ? decodeAndValidate(values[0]) : null;

  // The referrer is believed only beside a restore that is itself believed.
  if (target !== null) {
    window.__spaReferrer = (referrers.length === 1 && validOrigin(referrers[0])) || '';
  }

  // No usable value, but `__p` is on the URL and has to come off. Same door as above:
  // `location.pathname` is browser-normalised, but the kept query pairs and the hash are
  // not, and this file should have no unvalidated route to the sink.
  if (target === null) {
    target = normalizeAndValidate(
      stripParam(location.pathname + location.search + (location.hash || ''))
    ) || '/';
  }

  try {
    window.history.replaceState(null, '', target);
  } catch (e) {
    // A rejected replaceState leaves us where we are, which renders.
  }
})();
