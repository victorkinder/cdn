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
  const LOG_PREFIX = '[presell-param-script]';

  /**
   * Main init.
   */
  function start() {
    console.log(LOG_PREFIX, 'Iniciando propagação de parâmetros.');

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
      : readStoredParams();

    if (!sessionParams || !Object.keys(sessionParams).length) {
      console.log(
        LOG_PREFIX,
        'Nenhum parâmetro rastreado encontrado. Propagação não necessária.',
      );
      return;
    }

    if (Object.keys(urlParams).length) {
      storeParams(urlParams);
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
      console.warn(
        LOG_PREFIX,
        'Não foi possível ler parâmetros armazenados.',
        err,
      );
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

  function appendParams(url, params, hasURLSupport) {
    const paramEntries = prepareParamEntries(params);

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
        const updatedUrl = appendParams(href, params, hasURLSupport);
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
    let inspected = 0;
    let inputsAdded = 0;
    for (let i = 0; i < forms.length; i += 1) {
      const form = forms[i];
      const formHasFlag = elementHasMxhrefFlag(form);
      if (!formHasFlag) continue;
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
