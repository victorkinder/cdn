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
  const STORAGE_KEY_PREFIX = 'presell_params';
  const STORAGE_EXPIRY_KEY_PREFIX = 'presell_params_expiry';
  const LEGACY_STORAGE_KEY = STORAGE_KEY_PREFIX;
  const LEGACY_STORAGE_EXPIRY_KEY = STORAGE_EXPIRY_KEY_PREFIX;
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
  const LOG_PREFIX = '[presell-param-script]';

  /**
   * Main init.
   */
  function start() {
    console.log(LOG_PREFIX, 'Iniciando propagação de parâmetros.');
    const currentPathNamespace = getCurrentPathNamespace();

    if (isCrawler(window.navigator && window.navigator.userAgent)) {
      console.log(
        LOG_PREFIX,
        'Agente identificado como crawler. Execução interrompida.',
      );
      return;
    }

    const hasURLSupport =
      typeof URL === 'function' && typeof URLSearchParams === 'function';

    const urlParams = captureParamsFromLocation(
      window.location && window.location.search,
    );
    console.log(LOG_PREFIX, 'Parâmetros detectados na URL atual:', urlParams);

    let sessionParams = Object.keys(urlParams).length
      ? urlParams
      : readStoredParams(currentPathNamespace);

    if (!sessionParams || !Object.keys(sessionParams).length) {
      console.log(
        LOG_PREFIX,
        'Nenhum parâmetro rastreado encontrado. Propagação não necessária.',
      );
      return;
    }

    if (Object.keys(urlParams).length) {
      storeParams(currentPathNamespace, urlParams);
      sessionParams = urlParams;
    }

    activeSessionParams = sessionParams;
    console.log(
      LOG_PREFIX,
      'Parâmetros ativos em sessão:',
      activeSessionParams,
    );

    const propagate = () => {
      console.log(
        LOG_PREFIX,
        'Iniciando ciclo de propagação para links, botões e forms.',
      );
      const anchorsUpdated = propagateAnchors(sessionParams, hasURLSupport);
      const buttonsUpdated = propagateButtons(sessionParams, hasURLSupport);
      const formsUpdated = propagateForms(sessionParams);
      console.log(
        LOG_PREFIX,
        'Propagação finalizada.',
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

  function isCrawler(userAgent) {
    if (!userAgent || typeof userAgent !== 'string') return false;
    const ua = userAgent.toLowerCase();
    return CRAWLER_PATTERNS.some((pattern) => pattern.test(ua));
  }

  function attributeIndicatesMxhref(value) {
    if (value === null || value === undefined) return false;
    const normalized = String(value).trim().toLowerCase();
    if (!normalized) {
      return true;
    }
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  function elementHasMxhrefFlag(element) {
    if (element && typeof element.dataset === 'object' && element.dataset) {
      if (typeof element.dataset.mxhref !== 'undefined') {
        if (attributeIndicatesMxhref(element.dataset.mxhref)) {
          return true;
        }
      }
    }

    if (element && typeof element.getAttribute === 'function') {
      const dataAttr = element.getAttribute('data-mxhref');
      if (attributeIndicatesMxhref(dataAttr)) {
        return true;
      }
      const directAttr = element.getAttribute('mxhref');
      if (attributeIndicatesMxhref(directAttr)) {
        return true;
      }
    }

    return false;
  }

  function captureParamsFromLocation(search) {
    if (!search) return {};
    const params = {};
    let parser;

    try {
      parser = new URLSearchParams(search);
    } catch (err) {
      console.warn(
        LOG_PREFIX,
        'URLSearchParams indisponível. Realizando parse manual.',
        err,
      );
      return manualParse(search);
    }

    parser.forEach((value, key) => {
      if (value !== null && key) {
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
      if (!key) return;
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
    if (!params || typeof params !== 'object') {
      return [];
    }

    const normalizedEntries = {};
    Object.keys(params).forEach((key) => {
      if (!key) return;
      const rawValue = params[key];
      if (rawValue === undefined || rawValue === null || rawValue === '') {
        return;
      }
      normalizedEntries[key] = normalizeParamValue(key, rawValue);
    });

    const entryKeys = Object.keys(normalizedEntries);
    if (!entryKeys.length) {
      return [];
    }

    const primaryKey = determinePrimaryKey(normalizedEntries);
    const builder =
      typeof window !== 'undefined' &&
      typeof window.__PRESSELL_BUILD_QUERY__ === 'function'
        ? window.__PRESSELL_BUILD_QUERY__
        : null;

    if (builder) {
      try {
        const built = builder(primaryKey, normalizedEntries);
        if (Array.isArray(built)) {
          const seen = new Set();
          return built
            .map((entry) => {
              if (!entry || typeof entry !== 'object') {
                return null;
              }
              const destKey =
                entry.key && String(entry.key).trim()
                  ? String(entry.key).trim()
                  : null;
              const destValue =
                entry.value !== undefined && entry.value !== null
                  ? String(entry.value)
                  : '';
              if (!destKey || destValue === '') {
                return null;
              }
              if (seen.has(destKey)) {
                return null;
              }
              seen.add(destKey);
              return { key: destKey, value: destValue };
            })
            .filter(Boolean);
        }
      } catch (err) {
        console.warn(
          LOG_PREFIX,
          'Falha ao executar builder de sequência customizado.',
          err,
        );
      }
    }

    const fallbackEntries = [];
    const addedDestKeys = new Set();

    const addEntry = (destKey, value) => {
      if (!destKey || value === '' || addedDestKeys.has(destKey)) {
        return;
      }
      fallbackEntries.push({ key: destKey, value: String(value) });
      addedDestKeys.add(destKey);
    };

    if (primaryKey) {
      const destKey =
        resolveDestinationKey(primaryKey) || String(primaryKey).trim();
      addEntry(destKey, normalizedEntries[primaryKey]);
    }

    entryKeys.forEach((key) => {
      if (key === primaryKey) return;
      const destKey = resolveDestinationKey(key) || String(key).trim();
      addEntry(destKey, normalizedEntries[key]);
    });

    return fallbackEntries;
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function normalizePathname(pathname) {
    if (typeof pathname !== 'string' || !pathname.trim()) {
      return '/';
    }
    let normalized = pathname.trim();
    if (!normalized.startsWith('/')) {
      normalized = `/${normalized}`;
    }
    normalized = normalized.replace(/\/+$/, '');
    if (!normalized) {
      return '/';
    }
    return normalized;
  }

  function buildStorageKey(base, namespace) {
    if (!namespace) {
      return base;
    }
    return `${base}::${namespace}`;
  }

  function getCurrentPathNamespace() {
    if (typeof window === 'undefined' || !window.location) {
      return 'root';
    }
    const { pathname } = window.location;
    const normalizedPath = normalizePathname(pathname);
    return encodeURIComponent(normalizedPath);
  }

  function readStoredParams(pathNamespace) {
    const candidates = [];
    if (pathNamespace) {
      candidates.push({
        dataKey: buildStorageKey(STORAGE_KEY_PREFIX, pathNamespace),
        expiryKey: buildStorageKey(STORAGE_EXPIRY_KEY_PREFIX, pathNamespace),
        migrateToNamespace: false,
      });
    }
    candidates.push({
      dataKey: LEGACY_STORAGE_KEY,
      expiryKey: LEGACY_STORAGE_EXPIRY_KEY,
      migrateToNamespace: pathNamespace,
    });

    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      try {
        const expiryRaw = window.localStorage.getItem(candidate.expiryKey);
        const dataRaw = window.localStorage.getItem(candidate.dataKey);
        if (!expiryRaw || !dataRaw) {
          continue;
        }
        const expiry = parseInt(expiryRaw, 10);
        if (Number.isNaN(expiry) || Date.now() > expiry) {
          window.localStorage.removeItem(candidate.dataKey);
          window.localStorage.removeItem(candidate.expiryKey);
          continue;
        }
        const parsed = JSON.parse(dataRaw);
        if (parsed && typeof parsed === 'object') {
          if (
            candidate.migrateToNamespace &&
            pathNamespace &&
            candidate.dataKey === LEGACY_STORAGE_KEY
          ) {
            storeParams(pathNamespace, parsed);
            window.localStorage.removeItem(LEGACY_STORAGE_KEY);
            window.localStorage.removeItem(LEGACY_STORAGE_EXPIRY_KEY);
          }
          return parsed;
        }
      } catch (err) {
        console.warn(
          LOG_PREFIX,
          'Não foi possível ler parâmetros armazenados.',
          err,
        );
      }
    }
    return {};
  }

  function storeParams(pathNamespace, params) {
    if (!pathNamespace) {
      console.warn(
        LOG_PREFIX,
        'Namespace de caminho inválido para salvar parâmetros.',
      );
      return;
    }
    try {
      const dataKey = buildStorageKey(STORAGE_KEY_PREFIX, pathNamespace);
      const expiryKey = buildStorageKey(
        STORAGE_EXPIRY_KEY_PREFIX,
        pathNamespace,
      );
      window.localStorage.setItem(dataKey, JSON.stringify(params));
      window.localStorage.setItem(
        expiryKey,
        String(Date.now() + STORAGE_DURATION_MS),
      );
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      window.localStorage.removeItem(LEGACY_STORAGE_EXPIRY_KEY);
    } catch (err) {
      console.warn(
        LOG_PREFIX,
        'Falha ao salvar parâmetros no localStorage.',
        err,
      );
    }
  }

  function shouldProcessTarget(targetUrl, targetMxhrefFlagged, hasURLSupport) {
    if (!targetMxhrefFlagged) return false;
    if (!targetUrl) return false;
    if (!hasURLSupport) return true;

    try {
      // Apenas valida a URL; domínios diferentes também devem ser processados.
      // eslint-disable-next-line no-new
      new URL(targetUrl, window.location && window.location.href);
      return true;
    } catch (err) {
      console.warn(
        LOG_PREFIX,
        'Não foi possível analisar a URL alvo. Ignorando item.',
        err,
      );
      return false;
    }
  }

  function appendParams(url, params, hasURLSupport, precomputedEntries = null) {
    const paramEntries = Array.isArray(precomputedEntries)
      ? precomputedEntries
      : prepareParamEntries(params);

    if (!paramEntries.length) {
      return url;
    }

    if (!hasURLSupport) {
      return appendParamsManually(url, paramEntries);
    }

    try {
      const urlObj = new URL(url, window.location && window.location.href);
      paramEntries.forEach((entry) => {
        if (!entry || !entry.key) return;
        if (!urlObj.searchParams.has(entry.key)) {
          urlObj.searchParams.set(entry.key, entry.value);
        }
      });
      return urlObj.toString();
    } catch (err) {
      console.warn(
        LOG_PREFIX,
        'Falha ao anexar parâmetros via URL API. Usando fallback.',
        err,
      );
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
      if (!entry || !entry.key || entry.value === '') return;
      if (addedKeys.has(entry.key)) return;
      if (hasExistingParam(base, entry.key)) return;
      const encodedValue = encodeURIComponent(entry.value);
      additions.push(`${encodeURIComponent(entry.key)}=${encodedValue}`);
      addedKeys.add(entry.key);
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
      console.warn(
        LOG_PREFIX,
        'Não foi possível interpretar o handler do botão.',
      );
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
      console.warn(LOG_PREFIX, 'Erro ao reconstruir o handler do botão.', err);
      return originalHandler;
    }
  }

  function propagateAnchors(params, hasURLSupport) {
    const anchors = document.getElementsByTagName('a');
    const paramEntries = prepareParamEntries(params);
    if (!paramEntries.length) {
      console.log(
        LOG_PREFIX,
        'Nenhum parâmetro disponível para anexar aos links.',
      );
      return 0;
    }
    let inspected = 0;
    let updatedCount = 0;
    for (let i = 0; i < anchors.length; i += 1) {
      const anchor = anchors[i];
      inspected += 1;
      const href =
        anchor && typeof anchor.getAttribute === 'function'
          ? anchor.getAttribute('href')
          : null;
      if (
        !href ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:') ||
        href.startsWith('javascript:')
      ) {
        continue;
      }
      const anchorHasFlag = elementHasMxhrefFlag(anchor);
      if (!shouldProcessTarget(href, anchorHasFlag, hasURLSupport)) continue;

      try {
        const originalHash = anchor.hash || '';
        const updatedUrl = appendParams(
          href,
          params,
          hasURLSupport,
          paramEntries,
        );
        if (updatedUrl) {
          anchor.href = updatedUrl;
          if (originalHash && anchor.hash !== originalHash) {
            anchor.hash = originalHash;
          }
          updatedCount += 1;
        }
      } catch (err) {
        console.warn(LOG_PREFIX, 'Falha ao atualizar URL do link.', err);
      }
    }
    console.log(
      LOG_PREFIX,
      `Links analisados=${inspected} atualizados=${updatedCount}`,
    );
    return updatedCount;
  }

  function propagateButtons(params, hasURLSupport) {
    const buttons = document.getElementsByTagName('button');
    const paramEntries = prepareParamEntries(params);
    if (!paramEntries.length) {
      console.log(
        LOG_PREFIX,
        'Nenhum parâmetro disponível para anexar aos botões.',
      );
      return 0;
    }
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
        if (!targetUrl) continue;
        const buttonHasFlag = elementHasMxhrefFlag(button);
        if (!shouldProcessTarget(targetUrl, buttonHasFlag, hasURLSupport))
          continue;

        const updatedUrl = appendParams(
          targetUrl,
          params,
          hasURLSupport,
          paramEntries,
        );
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
        console.warn(
          LOG_PREFIX,
          'Falha ao inspecionar o handler do botão.',
          err,
        );
      }
    }
    console.log(
      LOG_PREFIX,
      `Botões analisados=${inspected} atualizados=${updatedCount}`,
    );
    return updatedCount;
  }

  function propagateForms(params) {
    const forms = document.getElementsByTagName('form');
    const paramEntries = prepareParamEntries(params);
    if (!paramEntries.length) {
      console.log(
        LOG_PREFIX,
        'Nenhum parâmetro disponível para anexar aos formulários.',
      );
      return 0;
    }
    let inspected = 0;
    let inputsAdded = 0;
    for (let i = 0; i < forms.length; i += 1) {
      const form = forms[i];
      const formHasFlag = elementHasMxhrefFlag(form);
      if (!formHasFlag) continue;
      inspected += 1;
      paramEntries.forEach((entry) => {
        if (!entry || !entry.key || entry.value === '') return;
        if (form.querySelector(`input[name="${entry.key}"]`)) return;
        try {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = entry.key;
          input.value = entry.value;
          form.appendChild(input);
          inputsAdded += 1;
        } catch (err) {
          console.warn(
            LOG_PREFIX,
            'Falha ao anexar input hidden ao formulário.',
            err,
          );
        }
      });
    }
    console.log(
      LOG_PREFIX,
      `Formulários analisados=${inspected} inputsIncluídos=${inputsAdded}`,
    );
    return inputsAdded;
  }

  try {
    start();
  } catch (err) {
    console.error(LOG_PREFIX, 'Erro inesperado durante a inicialização.', err);
  }
})();
