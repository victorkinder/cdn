/**
 * Presell parameter propagation script.
 *
 * Requirements:
 * - Must run quickly before user interactions.
 * - Only log failures; never interrupt navigation.
 * - Prioritize keeping outbound URLs aligned with the captured params.
 * - Focus on marketing identifiers: gclid, msclkid, fbclid, tid.
 * - Apply updates when the page or target URL includes the flag mxcode=1.
 */

(function presellParamBootstrap() {
  const CLICK_ID_KEYS = ['gclid', 'msclkid', 'fbclid'];
  const TRACK_KEYS = [...CLICK_ID_KEYS, 'tid'];
  const STORAGE_KEY = 'presell_params';
  const STORAGE_EXPIRY_KEY = 'presell_params_expiry';
  const STORAGE_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  const CRAWLER_PATTERNS = [
    /googlebot\//i,
    /bingbot/i,
    /facebookexternalhit\//i,
    /pageburst/i,
  ];
  const DESTINATION_KEY_MAP =
    (typeof window !== 'undefined' && window.__PRESSELL_KEY_MAP__) || {};
  let activeSessionParams = {};

  const logger = createLogger('presell-param-script');

  /**
   * Main init.
   */
  function start() {
    logger.debug('Bootstrap starting.');

    if (isCrawler(window.navigator && window.navigator.userAgent)) {
      logger.debug('Detected crawler; script skipped.');
      return;
    }

    const mxcodeFlagged = hasMxcode(window.location && window.location.search);
    const hasURLSupport =
      typeof URL === 'function' && typeof URLSearchParams === 'function';

    const urlParams = captureParamsFromLocation(
      window.location && window.location.search,
    );
    logger.debug('Captured URL params:', urlParams);

    let sessionParams = Object.keys(urlParams).length
      ? urlParams
      : readStoredParams();

    if (!sessionParams || !Object.keys(sessionParams).length) {
      logger.debug('No tracked parameters found; nothing to propagate.');
      return;
    }

    if (Object.keys(urlParams).length) {
      storeParams(urlParams);
      sessionParams = urlParams;
    }

    activeSessionParams = sessionParams;
    logger.debug('Session params ready:', activeSessionParams);

    const propagate = () => {
      logger.debug('Propagation cycle started.');
      const anchorsUpdated = propagateAnchors(
        sessionParams,
        mxcodeFlagged,
        hasURLSupport,
      );
      const buttonsUpdated = propagateButtons(
        sessionParams,
        mxcodeFlagged,
        hasURLSupport,
      );
      const formsUpdated = propagateForms(sessionParams, mxcodeFlagged);
      logger.debug(
        'Parameter propagation completed.',
        `anchors=${anchorsUpdated}`,
        `buttons=${buttonsUpdated}`,
        `forms=${formsUpdated}`,
      );
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', propagate, { once: true });
    } else {
      propagate();
    }
  }

  /**
   * Utilities
   */
  function createLogger(scope) {
    const safeConsole = (window && window.console) || {};
    return {
      debug: (...args) => {
        if (typeof safeConsole.debug === 'function') {
          safeConsole.debug(`[${scope}]`, ...args);
        } else if (typeof safeConsole.log === 'function') {
          safeConsole.log(`[${scope}]`, ...args);
        }
      },
      warn: (...args) => {
        if (typeof safeConsole.warn === 'function') {
          safeConsole.warn(`[${scope}]`, ...args);
        } else if (typeof safeConsole.error === 'function') {
          safeConsole.error(`[${scope}]`, ...args);
        }
      },
    };
  }

  function isCrawler(userAgent) {
    if (!userAgent || typeof userAgent !== 'string') return false;
    const ua = userAgent.toLowerCase();
    return CRAWLER_PATTERNS.some((pattern) => pattern.test(ua));
  }

  function hasMxcode(search) {
    if (!search) return false;
    return search.indexOf('mxcode=1') !== -1;
  }

  function captureParamsFromLocation(search) {
    if (!search) return {};
    const params = {};
    let parser;

    try {
      parser = new URLSearchParams(search);
    } catch (err) {
      logger.warn(
        'URLSearchParams unavailable; falling back to manual parsing.',
        err,
      );
      return manualParse(search);
    }

    TRACK_KEYS.forEach((key) => {
      const value = parser.get(key);
      if (value !== null) {
        params[key] = safeDecode(value);
      }
    });

    return params;
  }

  function manualParse(search) {
    const params = {};
    const query = search.charAt(0) === '?' ? search.slice(1) : search;
    query.split('&').forEach((pair) => {
      if (!pair) return;
      const [rawKey, rawValue = ''] = pair.split('=');
      const key = safeDecode(rawKey);
      if (TRACK_KEYS.indexOf(key) === -1) return;
      params[key] = safeDecode(rawValue);
    });
    return params;
  }

  function safeDecode(value) {
    try {
      return decodeURIComponent(value.replace(/\+/g, ' '));
    } catch (_err) {
      return value;
    }
  }

  function encodeTidValue(value) {
    return String(value)
      .replace(/ /g, '_s_')
      .replace(/-/g, '_d_')
      .replace(/\//g, '');
  }

  function normalizeParamValue(key, value) {
    if (key === 'tid') {
      return encodeTidValue(value);
    }
    return String(value);
  }

  function resolveDestinationKey(key) {
    if (!key) return '';
    const mapped = DESTINATION_KEY_MAP[key];
    return mapped ? String(mapped) : key;
  }

  function determinePrimaryKey(params) {
    for (let i = 0; i < CLICK_ID_KEYS.length; i += 1) {
      const key = CLICK_ID_KEYS[i];
      const value = params[key];
      if (value !== undefined && value !== null && value !== '') {
        return key;
      }
    }
    return null;
  }

  function prepareParamEntries(params) {
    const entries = [];
    TRACK_KEYS.forEach((key) => {
      const rawValue = params[key];
      if (rawValue === undefined || rawValue === null || rawValue === '') {
        return;
      }
      entries.push({
        key,
        mappedKey: resolveDestinationKey(key),
        normalizedValue: normalizeParamValue(key, rawValue),
      });
    });
    return entries;
  }

  function buildReplacementQuery(primaryKey, otherParams) {
    const segments = [];
    const addedKeys = new Set();

    const appendSegment = (key, value) => {
      if (value === undefined || value === null || value === '') return;
      const destinationKey = resolveDestinationKey(key);
      if (!destinationKey || addedKeys.has(destinationKey)) return;
      const normalizedValue = normalizeParamValue(key, value);
      segments.push(
        `${encodeURIComponent(destinationKey)}=${encodeURIComponent(
          normalizedValue,
        )}`,
      );
      addedKeys.add(destinationKey);
    };

    if (primaryKey) {
      const primaryValue = activeSessionParams[primaryKey];
      appendSegment(primaryKey, primaryValue);
    }

    const normalizedParams = Array.isArray(otherParams) ? otherParams : [];
    normalizedParams.forEach((entry) => {
      if (!entry) return;
      let key;
      let value;

      if (Array.isArray(entry)) {
        [key, value] = entry;
      } else if (typeof entry === 'object') {
        key = entry.key || entry.name;
        value =
          entry.value !== undefined ? entry.value : activeSessionParams[key];
      }

      if (!key) return;
      appendSegment(key, value);
    });

    if (!segments.length) {
      return 'mxcode=1';
    }

    return segments.join('&');
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function readStoredParams() {
    try {
      const expiryRaw = window.localStorage.getItem(STORAGE_EXPIRY_KEY);
      const dataRaw = window.localStorage.getItem(STORAGE_KEY);
      if (!expiryRaw || !dataRaw) return {};
      const expiry = parseInt(expiryRaw, 10);
      if (Number.isNaN(expiry) || Date.now() > expiry) {
        window.localStorage.removeItem(STORAGE_KEY);
        window.localStorage.removeItem(STORAGE_EXPIRY_KEY);
        return {};
      }
      const parsed = JSON.parse(dataRaw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      logger.warn('Failed reading stored parameters.', err);
      return {};
    }
  }

  function storeParams(params) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
      window.localStorage.setItem(
        STORAGE_EXPIRY_KEY,
        String(Date.now() + STORAGE_DURATION_MS),
      );
    } catch (err) {
      logger.warn('Failed persisting parameters.', err);
    }
  }

  function shouldProcessTarget(targetUrl, pageMxcode, hasURLSupport) {
    if (!targetUrl) return false;
    if (!pageMxcode && !hasMxcode(targetUrl)) return false;
    if (!hasURLSupport) return true;

    try {
      const urlObj = new URL(
        targetUrl,
        window.location && window.location.href,
      );
      const pageOrigin = window.location && window.location.origin;
      return !pageOrigin || urlObj.origin === pageOrigin;
    } catch (err) {
      logger.warn('Failed to parse target URL; skipping.', err);
      return false;
    }
  }

  function appendParams(url, params, hasURLSupport) {
    const paramEntries = prepareParamEntries(params);
    const primaryKey = determinePrimaryKey(params);
    const otherParamsPayload = paramEntries
      .filter((entry) => entry.key !== primaryKey)
      .map((entry) => ({ key: entry.key, value: params[entry.key] }));

    if (typeof url === 'string' && url.indexOf('mxcode=1') !== -1) {
      const replacement = buildReplacementQuery(primaryKey, otherParamsPayload);
      if (replacement) {
        return url.replace('mxcode=1', replacement);
      }
    }

    if (!hasURLSupport) {
      return appendParamsManually(url, paramEntries);
    }

    try {
      const urlObj = new URL(url, window.location && window.location.href);
      paramEntries.forEach((entry) => {
        const { mappedKey, normalizedValue } = entry;
        if (!mappedKey) return;
        if (!urlObj.searchParams.has(mappedKey)) {
          urlObj.searchParams.set(mappedKey, normalizedValue);
        }
      });
      return urlObj.toString();
    } catch (err) {
      logger.warn('URL API append failed; falling back.', err);
      return appendParamsManually(url, paramEntries);
    }
  }

  function appendParamsManually(url, paramEntries) {
    const [base, hash = ''] = url.split('#');
    const hashPart = hash ? `#${hash}` : '';
    const hasQuery = base.indexOf('?') !== -1;
    const additions = [];
    const addedKeys = new Set();

    paramEntries.forEach((entry) => {
      const { mappedKey, normalizedValue } = entry;
      if (!mappedKey || normalizedValue === '') return;
      if (addedKeys.has(mappedKey)) return;
      if (hasExistingParam(base, mappedKey)) return;
      const encodedValue = encodeURIComponent(normalizedValue);
      additions.push(`${encodeURIComponent(mappedKey)}=${encodedValue}`);
      addedKeys.add(mappedKey);
    });

    if (!additions.length) return url;
    const delimiter = hasQuery ? '&' : '?';
    return `${base}${delimiter}${additions.join('&')}${hashPart}`;
  }

  function hasExistingParam(url, key) {
    if (!key) return false;
    const regex = new RegExp(`[?&]${escapeRegExp(key)}(=|&|$)`, 'i');
    return regex.test(url);
  }

  function rebuildHandler(
    handlerString,
    originalHandler,
    searchValue,
    replacementValue,
  ) {
    const match = handlerString.match(
      /^function\s*[^(]*\(([^)]*)\)\s*{([\s\S]*)}$/,
    );
    if (!match) {
      logger.warn('Unable to parse button handler; keeping original.');
      return null;
    }
    const argsString = match[1].trim();
    const body = match[2].replace(searchValue, replacementValue);
    const argList = argsString
      ? argsString
          .split(',')
          .map((arg) => arg.trim())
          .filter(Boolean)
      : [];
    try {
      // eslint-disable-next-line no-new-func
      return Function.apply(null, [...argList, body]);
    } catch (err) {
      logger.warn('Failed to rebuild button handler; keeping original.', err);
      return originalHandler;
    }
  }

  function propagateAnchors(params, pageMxcode, hasURLSupport) {
    const anchors = document.getElementsByTagName('a');
    let inspected = 0;
    let updatedCount = 0;
    for (let i = 0; i < anchors.length; i += 1) {
      const anchor = anchors[i];
      inspected += 1;
      const href = anchor && anchor.getAttribute && anchor.getAttribute('href');
      if (
        !href ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:') ||
        href.startsWith('javascript:')
      ) {
        continue;
      }
      if (!shouldProcessTarget(href, pageMxcode, hasURLSupport)) continue;

      try {
        const originalHash = anchor.hash || '';
        const updatedUrl = appendParams(href, params, hasURLSupport);
        if (updatedUrl) {
          anchor.href = updatedUrl;
          if (originalHash && anchor.hash !== originalHash) {
            anchor.hash = originalHash;
          }
          updatedCount += 1;
        }
      } catch (err) {
        logger.warn('Failed updating anchor URL.', err);
      }
    }
    logger.debug(`Anchors inspected=${inspected} updated=${updatedCount}`);
    return updatedCount;
  }

  function propagateButtons(params, pageMxcode, hasURLSupport) {
    const buttons = document.getElementsByTagName('button');
    let inspected = 0;
    let updatedCount = 0;
    for (let i = 0; i < buttons.length; i += 1) {
      const button = buttons[i];
      const handler = button && button.onclick;
      if (typeof handler !== 'function') continue;

      try {
        inspected += 1;
        const handlerString = handler.toString();
        const locationMatch = handlerString.match(
          /location\.href\s*=\s*['"`]([^'"`]+)['"`]/,
        );
        const openMatch = handlerString.match(
          /window\.open\s*\(\s*['"`]([^'"`]+)['"`]/,
        );
        const targetUrl =
          (locationMatch && locationMatch[1]) || (openMatch && openMatch[1]);
        if (
          !targetUrl ||
          !shouldProcessTarget(targetUrl, pageMxcode, hasURLSupport)
        )
          continue;

        const updatedUrl = appendParams(targetUrl, params, hasURLSupport);
        if (!updatedUrl) continue;

        const rewritten =
          (locationMatch &&
            rebuildHandler(
              handlerString,
              handler,
              locationMatch[1],
              updatedUrl,
            )) ||
          (openMatch &&
            rebuildHandler(handlerString, handler, openMatch[1], updatedUrl));

        if (rewritten) {
          button.onclick = rewritten;
          updatedCount += 1;
        }
      } catch (err) {
        logger.warn('Failed inspecting button handler.', err);
      }
    }
    logger.debug(`Buttons inspected=${inspected} updated=${updatedCount}`);
    return updatedCount;
  }

  function propagateForms(params, pageMxcode) {
    const forms = document.getElementsByTagName('form');
    let inspected = 0;
    let inputsAdded = 0;
    for (let i = 0; i < forms.length; i += 1) {
      const form = forms[i];
      const shouldProcess =
        pageMxcode || hasMxcode(form.getAttribute('action') || '');
      if (!shouldProcess) continue;
      inspected += 1;
      TRACK_KEYS.forEach((key) => {
        const value = params[key];
        if (value === undefined || value === null || value === '') return;
        const mappedName = resolveDestinationKey(key);
        if (!mappedName) return;
        if (form.querySelector(`input[name="${mappedName}"]`)) return;
        try {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = mappedName;
          input.value = normalizeParamValue(key, value);
          form.appendChild(input);
          inputsAdded += 1;
        } catch (err) {
          logger.warn('Failed appending hidden form input.', err);
        }
      });
    }
    logger.debug(`Forms inspected=${inspected} inputsAdded=${inputsAdded}`);
    return inputsAdded;
  }

  try {
    start();
  } catch (err) {
    logger.warn('Unexpected error during script start.', err);
  }
})();
