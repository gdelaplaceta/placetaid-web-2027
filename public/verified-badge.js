/*!
 * PlacetaID · Sitio Verificado
 * Insignia autocontenida. Uso:
 *   <script src="https://placetaid-web-plan2027.vercel.app/verified-badge.js"
 *           data-placetaid-badge data-client-id="TU_CLIENT_ID" defer></script>
 * Atributos opcionales: data-api (origen de la API), data-position="bottom-left".
 * Solo se muestra si PlacetaID confirma que esta web es una URI registrada de la aplicación.
 */
(function () {
  'use strict';

  var SUPPORT_EMAIL = 'seguridaddigital@laplaceta.org';
  var ROLE_LABELS = { administrador: 'Administración', miembro: 'Miembros', entidad: 'Entidades', visitante: 'Visitantes' };
  var BASE_LABELS = {
    login_correct: 'Resultado de autenticación',
    over_16: 'Indicador: mayor de 16 años',
    over_18: 'Indicador: mayor de 18 años',
    name: 'Nombre',
    surname: 'Apellidos'
  };
  var OPTIONAL_LABELS = { dip: 'DIP', email: 'Correo electrónico', identityVerified: 'Identidad verificada' };
  var UNAVAILABLE_LABELS = { phone: 'Número de teléfono', photo: 'Fotografía de perfil' };

  var script = document.currentScript || (function () {
    var list = document.querySelectorAll('script[data-placetaid-badge]');
    return list[list.length - 1];
  })();
  if (!script) return;

  var clientId = (script.getAttribute('data-client-id') || '').trim();
  if (!clientId) {
    console.warn('[PlacetaID] La insignia necesita data-client-id.');
    return;
  }

  var apiBase = script.getAttribute('data-api');
  if (!apiBase) {
    try { apiBase = new URL(script.src).origin; } catch (error) { return; }
  }
  var leftSide = script.getAttribute('data-position') === 'bottom-left';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function ageText(minAge) {
    return minAge > 0 ? minAge + '+ años' : 'Todas las edades';
  }

  function rolesText(roles) {
    if (!roles || !roles.length) return 'Sin perfiles permitidos';
    return roles.map(function (role) { return ROLE_LABELS[role] || role; }).join(', ');
  }

  function safeImageSrc(value) {
    if (typeof value !== 'string') return '';
    if (/^data:image\/(png|jpeg|webp);base64,/i.test(value)) return value;
    try {
      var url = new URL(value);
      if (url.protocol === 'https:') return url.toString();
    } catch (error) { /* ignorado */ }
    return '';
  }

  function logoNode(app, size) {
    var wrap = el('span', 'logo logo-' + size);
    var src = safeImageSrc(app.logoUrl);
    if (src) {
      var img = el('img');
      img.src = src;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.loading = 'lazy';
      wrap.appendChild(img);
    } else {
      wrap.textContent = app.initials || (app.name || '?').slice(0, 2).toUpperCase();
      if (app.brandColor && /^#[0-9a-f]{6}$/i.test(app.brandColor)) wrap.style.background = app.brandColor;
    }
    return wrap;
  }

  var STYLE = [
    ':host { all: initial; }',
    '*, *::before, *::after { box-sizing: border-box; }',
    '.root { position: fixed; bottom: max(16px, env(safe-area-inset-bottom)); ' + (leftSide ? 'left' : 'right') + ': max(16px, env(safe-area-inset-' + (leftSide ? 'left' : 'right') + ')); z-index: 2147483000; font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1c0836; }',
    '.pill { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 6px 12px 6px 6px; border: 1px solid #d9cdef; border-radius: 999px; background: #fff; color: #1c0836; box-shadow: 0 6px 20px rgb(28 8 54 / 14%); cursor: pointer; font: inherit; font-weight: 700; font-size: 13px; }',
    '.pill:hover { border-color: #6d28d9; }',
    '.pill:focus-visible, .btn:focus-visible, .link:focus-visible, .close:focus-visible { outline: 2px solid #6d28d9; outline-offset: 2px; }',
    '.logo { display: inline-grid; place-items: center; width: 28px; height: 28px; flex: 0 0 28px; border-radius: 8px; background: #efe8ff; color: #4c1d95; font-weight: 800; font-size: 11px; overflow: hidden; }',
    '.logo img { width: 100%; height: 100%; object-fit: contain; }',
    '.logo-lg { width: 52px; height: 52px; flex-basis: 52px; border-radius: 14px; font-size: 16px; color: #fff; }',
    '.check { width: 16px; height: 16px; color: #2f6b3f; flex: 0 0 16px; }',
    '.overlay { position: fixed; inset: 0; z-index: 2147483001; display: grid; place-items: center; padding: 16px; background: rgb(28 8 54 / 55%); font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1c0836; }',
    '.dialog { width: min(440px, 100%); max-height: min(86vh, 720px); overflow: auto; padding: 22px; border: 1px solid #d9cdef; border-radius: 18px; background: #fff; box-shadow: 0 24px 70px rgb(28 8 54 / 35%); }',
    '.head { display: flex; align-items: center; gap: 14px; }',
    '.head-copy { flex: 1; min-width: 0; }',
    '.title { margin: 0; font-size: 18px; font-weight: 800; line-height: 1.2; overflow-wrap: anywhere; }',
    '.verified { display: inline-flex; align-items: center; gap: 6px; margin-top: 4px; color: #2f6b3f; font-size: 12px; font-weight: 700; }',
    '.domain { color: #5b4b70; font-weight: 500; overflow-wrap: anywhere; }',
    '.close { flex: 0 0 auto; width: 32px; height: 32px; display: grid; place-items: center; border: 0; border-radius: 8px; background: transparent; color: #5b4b70; cursor: pointer; font: inherit; font-size: 20px; line-height: 1; }',
    '.close:hover { background: #f3eefb; }',
    '.desc { margin: 14px 0 0; color: #3f2b57; font-size: 13px; line-height: 1.5; }',
    'h3 { margin: 18px 0 8px; font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: #4c3d63; }',
    '.box { border: 1px solid #e2d9f0; border-radius: 12px; background: #faf8fe; }',
    '.row { display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; border-bottom: 1px solid #ece5f6; font-size: 13px; }',
    '.row:last-child { border-bottom: 0; }',
    '.row span:first-child { color: #3f2b57; font-weight: 600; }',
    '.row span:last-child { color: #4f3f66; text-align: right; }',
    '.list { margin: 0; padding: 0; list-style: none; }',
    '.list li { display: flex; align-items: flex-start; gap: 8px; padding: 9px 12px; border-bottom: 1px solid #ece5f6; font-size: 13px; color: #2b1d40; }',
    '.list li:last-child { border-bottom: 0; }',
    '.tag { flex: 0 0 auto; padding: 2px 7px; border-radius: 999px; font-size: 11px; font-weight: 700; white-space: nowrap; }',
    '.tag-always { background: #e6f3e8; color: #2f6b3f; }',
    '.tag-optional { background: #fbf1dc; color: #7d4f12; }',
    '.tag-no { background: #f3eefb; color: #5b4b70; }',
    '.note { margin: 10px 0 0; font-size: 12px; color: #4f3f66; line-height: 1.5; }',
    '.footer { margin-top: 18px; padding-top: 14px; border-top: 1px solid #e2d9f0; font-size: 12px; color: #4f3f66; line-height: 1.5; }',
    '.link { color: #5b21b6; font-weight: 700; text-decoration: underline; text-underline-offset: 2px; overflow-wrap: anywhere; }',
    '.btn { margin-top: 14px; width: 100%; min-height: 42px; border: 0; border-radius: 10px; background: #6d28d9; color: #fff; font: inherit; font-weight: 700; cursor: pointer; }',
    '.btn:hover { background: #5b21b6; }',
    '@media (max-width: 520px) { .overlay { place-items: end center; padding: 0; } .dialog { width: 100%; max-height: 90vh; border-radius: 18px 18px 0 0; } }',
    '@media (prefers-reduced-motion: no-preference) { .dialog { animation: pl-up .18s ease-out; } @keyframes pl-up { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } } }'
  ].join('\n');

  var host = el('div');
  host.id = 'placetaid-verified-badge';
  var shadow = host.attachShadow({ mode: 'open' });
  var style = el('style');
  style.textContent = STYLE;
  shadow.appendChild(style);
  var root = el('div', 'root');
  shadow.appendChild(root);

  var lastFocus = null;
  var overlay = null;

  function closeDialog() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    document.removeEventListener('keydown', onKey, true);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function onKey(event) {
    if (!overlay) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== 'Tab') return;
    var focusables = overlay.querySelectorAll('button, a[href]');
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    var active = shadow.activeElement;
    if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  }

  function section(title) {
    var wrap = el('section');
    wrap.appendChild(el('h3', null, title));
    return wrap;
  }

  function buildDialog(data) {
    var app = data.app;
    var dialog = el('section', 'dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'pl-badge-title');

    var head = el('div', 'head');
    head.appendChild(logoNode(app, 'lg'));
    var copy = el('div', 'head-copy');
    var title = el('h2', 'title', app.name);
    title.id = 'pl-badge-title';
    copy.appendChild(title);
    var verified = el('div', 'verified');
    var check = svgCheck();
    verified.appendChild(check);
    verified.appendChild(document.createTextNode('Sitio Verificado · '));
    verified.appendChild(el('span', 'domain', data.domain));
    copy.appendChild(verified);
    head.appendChild(copy);
    var close = el('button', 'close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Cerrar');
    close.addEventListener('click', closeDialog);
    head.appendChild(close);
    dialog.appendChild(head);

    if (app.description) dialog.appendChild(el('p', 'desc', app.description));

    // Servicio y requisitos de acceso
    var serviceBox = section('Servicio al que accedes');
    var serviceList = el('div', 'box');
    (data.services || []).forEach(function (service) {
      var row = el('div', 'row');
      var left = el('span', null, service.name);
      var right = el('span', null, ageText(service.minAge) + ' · ' + rolesText(service.roles));
      row.appendChild(left);
      row.appendChild(right);
      serviceList.appendChild(row);
    });
    if (!serviceList.children.length) serviceList.appendChild(el('div', 'row', 'Sin servicios activos'));
    serviceBox.appendChild(serviceList);
    dialog.appendChild(serviceBox);

    var login = data.login || {};
    var reqs = section('Requisitos para iniciar sesión');
    var reqBox = el('div', 'box');
    [
      ['Edad mínima', ageText(login.minAge || 0)],
      ['Perfiles permitidos', rolesText(login.allowedRoles)],
      ['Cuenta activa', login.activeAccount ? 'Requerida' : 'No requerida'],
      ['Método de acceso vinculado', login.linkedMethod ? 'Requerido' : 'No requerido']
    ].forEach(function (pair) {
      var row = el('div', 'row');
      row.appendChild(el('span', null, pair[0]));
      row.appendChild(el('span', null, pair[1]));
      reqBox.appendChild(row);
    });
    reqs.appendChild(reqBox);
    dialog.appendChild(reqs);

    // Datos que recibe la aplicación
    var dataData = data.data || {};
    var receives = section('Datos que recibe la aplicación');
    var list = el('ul', 'list');
    (dataData.base || []).forEach(function (field) {
      list.appendChild(itemWith('Siempre', 'tag-always', BASE_LABELS[field] || field));
    });
    (dataData.optional || []).forEach(function (field) {
      list.appendChild(itemWith('Solo si lo autorizas', 'tag-optional', OPTIONAL_LABELS[field] || field));
    });
    (dataData.unavailable || []).forEach(function (field) {
      list.appendChild(itemWith('No se comparte', 'tag-no', UNAVAILABLE_LABELS[field] || field));
    });
    receives.appendChild(list);
    receives.appendChild(el('p', 'note', 'Las contraseñas, los códigos temporales y los tokens de dispositivo nunca se envían a la aplicación.'));
    dialog.appendChild(receives);

    var footer = el('div', 'footer');
    footer.appendChild(document.createTextNode('¿Tienes una queja o una sugerencia sobre este sistema? Escríbenos a '));
    var mail = el('a', 'link', SUPPORT_EMAIL);
    mail.href = 'mailto:' + SUPPORT_EMAIL + '?subject=' + encodeURIComponent('Queja o sugerencia · ' + data.domain);
    footer.appendChild(mail);
    footer.appendChild(document.createTextNode('.'));
    footer.appendChild(el('div', 'note', 'Verificado por PlacetaID · Grupo La Placeta · ' + formatDate(data.checkedAt)));
    dialog.appendChild(footer);

    var done = el('button', 'btn', 'Entendido');
    done.type = 'button';
    done.addEventListener('click', closeDialog);
    dialog.appendChild(done);

    return dialog;
  }

  function itemWith(tagText, tagClass, label) {
    var li = el('li');
    li.appendChild(el('span', 'tag ' + tagClass, tagText));
    li.appendChild(el('span', null, label));
    return li;
  }

  function svgCheck() {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'check');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return svg;
  }

  function formatDate(value) {
    var date = new Date(value);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function openDialog(data, trigger) {
    lastFocus = trigger || null;
    overlay = el('div', 'overlay');
    overlay.addEventListener('mousedown', function (event) {
      if (event.target === overlay) closeDialog();
    });
    overlay.appendChild(buildDialog(data));
    shadow.appendChild(overlay);
    document.addEventListener('keydown', onKey, true);
    var focusTarget = shadow.querySelector('.close');
    if (focusTarget) focusTarget.focus();
  }

  function renderBadge(data) {
    var pill = el('button', 'pill');
    pill.type = 'button';
    pill.setAttribute('aria-haspopup', 'dialog');
    pill.setAttribute('aria-label', 'Sitio Verificado por PlacetaID. Ver detalles de la aplicación');
    pill.appendChild(logoNode(data.app, 'sm'));
    pill.appendChild(svgCheck());
    pill.appendChild(document.createTextNode('Sitio Verificado'));
    pill.addEventListener('click', function () { openDialog(data, pill); });
    root.appendChild(pill);
  }

  function mount() {
    document.body.appendChild(host);
    var url = apiBase.replace(/\/$/, '') + '/api/public/badge?client_id=' + encodeURIComponent(clientId) +
      '&origin=' + encodeURIComponent(window.location.origin);
    fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (data && data.verified && data.app) {
          renderBadge(data);
        } else {
          host.remove();
        }
      })
      .catch(function () { host.remove(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
