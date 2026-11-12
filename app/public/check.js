(function () {
  'use strict';
  var I18N = {
    en: { tagline:'Check before you call', navCheck:'Check an invoice', navConsole:'Platform console',
      h1:"Got a PayPal invoice you don't recognise?",
      lead:'Before you call any number in it, paste the invoice link here. HangUp reads the note and tells you if it looks like a callback scam.',
      urlLabel:'Paste the PayPal invoice link', txtLabel:'Paste the text from the email', invLabel:'Who is the invoice from? (optional)',
      histLabel:'Have you paid this seller before? (optional)', histUnknown:"I don't know", histNever:'No, never', histYes:'Yes',
      toggleText:'Or paste the text from the email', toggleLink:'Or paste the invoice link instead', go:'Check this invoice', checking:'Checking…',
      howT:'How HangUp decides', how:'An AI reads the invoice text and fills in a short form (does it demand a callback? does it mention a charge you didn\'t make? does the brand match the sender?). Then plain code, not the AI, makes the call from that form. HangUp never moves money and never logs in to your PayPal.',
      foot:'HangUp is an independent tool. It is not made by or affiliated with PayPal. It cannot vouch for an invoice; it only looks for one scam pattern.',
      scam:"Don't call the number in this invoice", sus:'Be careful', none:"No callback-scam pattern found in this invoice's text",
      evidence:'What the note says', advice:'What to do', reasons:'Why', copy:'Copy a report for PayPal', copied:'Copied. Paste it into an email to phishing@paypal.com',
      copyfail:'Could not copy automatically. Select the text below and copy it.',
      provPage:'Read from the PayPal invoice page at {t}', provPaste:"You pasted this text; HangUp can't confirm PayPal sent it", provExt:'Read from the PayPal page you had open',
      invoicer:'From', amount:'Amount', noteLabel:'Note', needInput:'Please paste an invoice link or the text first.',
      errLLM:'HangUp could not read this invoice because its AI service is not available right now. That does not mean the invoice is fine. Please try again later, and do not call any number in it until you have checked another way.',
      errPP:'HangUp could not reach the PayPal invoice page. That does not mean the invoice is fine. Try pasting the text from the email instead.',
      errHost:'That does not look like a PayPal invoice link. HangUp only opens links on paypal.com.',
      errGen:'Something went wrong, so there is no result. Please try again.', errNet:'Could not reach the HangUp server.',
      noticed:'What we noticed', why:'Why?', hideWhy:'Hide details', alsoIn:'Also found in', f_terms:'the terms', f_item_name:'an item name', f_item_description:'an item description', f_invoicer:'the sender name',
      noReasons:'Nothing in the note matched a known callback-scam trick.',
      cgT:'Set it up for someone else', cgIntro:'Helping a parent or friend? The HangUp browser extension shows this warning right on the PayPal invoice page.',
      cg1:'Unzip the download. You get a folder called hangup-extension.',
      cg2:'In Chrome go to chrome://extensions, turn on Developer mode, click Load unpacked, and choose that folder.',
      cg3:'Click the puzzle-piece icon in Chrome\'s toolbar and pin HangUp. It already points at the hosted HangUp server, so there is nothing to configure.',
      cgDownload:'Download the extension (.zip)',
      cgNote:'Be aware: the extension is not in the Chrome Web Store yet, so it has to be loaded by hand like this. It only runs on PayPal invoice pages, so the practice page will not show the banner: copy its note into the box above to see a result. The first check after the server has been idle can take up to a minute.',
      pWake:'Waking the HangUp server (first check can take up to a minute)…',
      pOpen:'Opening the PayPal invoice page…',
      pRead:'Reading the seller\'s note…',
      pCheck:'Checking for a callback scam…',
      hWake:'server waking…',
      cgPractice:'Open the practice invoice (clearly marked as not from PayPal)',
      hOk:'server ok', hBad:'server unreachable', hDeg:'server degraded', hLLM:'AI', hPP:'PayPal' },
    es: { tagline:'Compruebe antes de llamar', navCheck:'Revisar una factura', navConsole:'Consola de plataforma',
      h1:'¿Recibió una factura de PayPal que no reconoce?',
      lead:'Antes de llamar a cualquier número que aparezca, pegue aquí el enlace de la factura. HangUp lee la nota y le dice si parece una estafa de devolución de llamada.',
      urlLabel:'Pegue el enlace de la factura de PayPal', txtLabel:'Pegue el texto del correo', invLabel:'¿De quién es la factura? (opcional)',
      histLabel:'¿Le ha pagado antes a este vendedor? (opcional)', histUnknown:'No lo sé', histNever:'No, nunca', histYes:'Sí',
      toggleText:'O pegue el texto del correo', toggleLink:'O pegue el enlace de la factura', go:'Revisar esta factura', checking:'Revisando…',
      howT:'Cómo decide HangUp', how:'Una IA lee el texto de la factura y rellena un formulario corto (¿exige que llame? ¿menciona un cargo que usted no hizo? ¿la marca coincide con quien envía?). Luego un código simple, no la IA, toma la decisión. HangUp nunca mueve dinero ni entra en su cuenta de PayPal.',
      foot:'HangUp es una herramienta independiente, no hecha por PayPal ni afiliada a PayPal. No puede decirle que una factura sea segura; solo busca un patrón de estafa.',
      scam:'No llame al número de esta factura', sus:'Tenga cuidado', none:'No se encontró un patrón de estafa de devolución de llamada en el texto de esta factura',
      evidence:'Lo que dice la nota', advice:'Qué hacer', reasons:'Por qué', copy:'Copiar un informe para PayPal', copied:'Copiado. Péguelo en un correo a phishing@paypal.com',
      copyfail:'No se pudo copiar automáticamente. Seleccione el texto de abajo y cópielo.',
      provPage:'Leído de la página de la factura de PayPal a las {t}', provPaste:'Usted pegó este texto; HangUp no puede confirmar que PayPal lo enviara', provExt:'Leído de la página de PayPal que tenía abierta',
      invoicer:'De', amount:'Importe', noteLabel:'Nota', needInput:'Primero pegue un enlace o el texto.',
      errLLM:'HangUp no pudo leer esta factura porque su servicio de IA no está disponible ahora. Eso no significa que la factura esté bien. Inténtelo más tarde y no llame a ningún número de ella sin comprobarlo de otra manera.',
      errPP:'HangUp no pudo acceder a la página de la factura de PayPal. Eso no significa que la factura esté bien. Pruebe a pegar el texto del correo.',
      errHost:'Eso no parece un enlace de factura de PayPal. HangUp solo abre enlaces de paypal.com.',
      errGen:'Algo salió mal y no hay resultado. Inténtelo de nuevo.', errNet:'No se pudo contactar con el servidor de HangUp.',
      noticed:'Lo que notamos', why:'¿Por qué?', hideWhy:'Ocultar detalles', alsoIn:'También aparece en', f_terms:'las condiciones', f_item_name:'el nombre de un artículo', f_item_description:'la descripción de un artículo', f_invoicer:'el nombre del remitente',
      noReasons:'Nada en la nota coincide con un truco conocido de estafa de devolución de llamada.',
      cgT:'Configurarlo para otra persona', cgIntro:'¿Ayuda a un familiar o amigo? La extensión de HangUp muestra este aviso directamente en la página de la factura de PayPal.',
      cg1:'Descomprima la descarga. Obtendrá una carpeta llamada hangup-extension.',
      cg2:'En Chrome vaya a chrome://extensions, active el modo de desarrollador, pulse Cargar descomprimida y elija esa carpeta.',
      cg3:'Pulse el icono de la pieza de puzle en la barra de Chrome y fije HangUp. Ya apunta al servidor alojado de HangUp, así que no hay nada que configurar.',
      cgDownload:'Descargar la extensión (.zip)',
      cgNote:'Tenga en cuenta: la extensión todavía no está en la Chrome Web Store, así que hay que cargarla a mano. Solo funciona en páginas de facturas de PayPal, por lo que la página de práctica no mostrará el aviso: copie su nota en el cuadro de arriba para ver un resultado. La primera revisión tras un tiempo de inactividad puede tardar hasta un minuto.',
      pWake:'Despertando el servidor de HangUp (la primera revisión puede tardar hasta un minuto)…',
      pOpen:'Abriendo la página de la factura de PayPal…',
      pRead:'Leyendo la nota del vendedor…',
      pCheck:'Buscando una estafa de devolución de llamada…',
      hWake:'servidor despertando…',
      cgPractice:'Abrir la factura de práctica (claramente marcada como no de PayPal)',
      hOk:'servidor ok', hBad:'servidor no disponible', hDeg:'servidor degradado', hLLM:'IA', hPP:'PayPal' },
    fr: { tagline:'Vérifiez avant d\'appeler', navCheck:'Vérifier une facture', navConsole:'Console plateforme',
      h1:'Une facture PayPal que vous ne reconnaissez pas ?',
      lead:'Avant d\'appeler un numéro figurant dedans, collez ici le lien de la facture. HangUp lit la note et vous dit si elle ressemble à une arnaque au rappel.',
      urlLabel:'Collez le lien de la facture PayPal', txtLabel:'Collez le texte de l\'e-mail', invLabel:'De qui vient la facture ? (facultatif)',
      histLabel:'Avez-vous déjà payé ce vendeur ? (facultatif)', histUnknown:'Je ne sais pas', histNever:'Non, jamais', histYes:'Oui',
      toggleText:'Ou collez le texte de l\'e-mail', toggleLink:'Ou collez plutôt le lien de la facture', go:'Vérifier cette facture', checking:'Vérification…',
      howT:'Comment HangUp décide', how:'Une IA lit le texte de la facture et remplit un court formulaire (exige-t-elle un rappel ? mentionne-t-elle un débit que vous n\'avez pas fait ? la marque correspond-elle à l\'expéditeur ?). Ensuite un code simple, pas l\'IA, tranche. HangUp ne déplace jamais d\'argent et ne se connecte jamais à votre compte PayPal.',
      foot:'HangUp est un outil indépendant, non édité par PayPal ni affilié à PayPal. Il ne peut pas dire qu\'une facture est sûre ; il cherche seulement un type d\'arnaque.',
      scam:'N\'appelez pas le numéro de cette facture', sus:'Soyez prudent', none:'Aucun schéma d\'arnaque au rappel trouvé dans le texte de cette facture',
      evidence:'Ce que dit la note', advice:'Que faire', reasons:'Pourquoi', copy:'Copier un signalement pour PayPal', copied:'Copié. Collez-le dans un e-mail à phishing@paypal.com',
      copyfail:'Copie automatique impossible. Sélectionnez le texte ci-dessous et copiez-le.',
      provPage:'Lu sur la page de facture PayPal à {t}', provPaste:'Vous avez collé ce texte ; HangUp ne peut pas confirmer que PayPal l\'a envoyé', provExt:'Lu sur la page PayPal que vous aviez ouverte',
      invoicer:'De', amount:'Montant', noteLabel:'Note', needInput:'Collez d\'abord un lien ou le texte.',
      errLLM:'HangUp n\'a pas pu lire cette facture car son service d\'IA est indisponible. Cela ne veut pas dire que la facture est correcte. Réessayez plus tard et n\'appelez aucun numéro qui s\'y trouve sans vérifier autrement.',
      errPP:'HangUp n\'a pas pu joindre la page de facture PayPal. Cela ne veut pas dire que la facture est correcte. Essayez de coller le texte de l\'e-mail.',
      errHost:'Ceci ne ressemble pas à un lien de facture PayPal. HangUp n\'ouvre que des liens paypal.com.',
      errGen:'Une erreur est survenue, il n\'y a pas de résultat. Réessayez.', errNet:'Impossible de joindre le serveur HangUp.',
      noticed:'Ce que nous avons remarqué', why:'Pourquoi ?', hideWhy:'Masquer les détails', alsoIn:'Aussi trouvé dans', f_terms:'les conditions', f_item_name:'le nom d\'un article', f_item_description:'la description d\'un article', f_invoicer:'le nom de l\'expéditeur',
      noReasons:'Rien dans la note ne correspond à une astuce connue d\'arnaque au rappel.',
      cgT:'Le configurer pour quelqu\'un d\'autre', cgIntro:'Vous aidez un parent ou un ami ? L\'extension HangUp affiche cet avertissement directement sur la page de facture PayPal.',
      cg1:'Décompressez le téléchargement. Vous obtenez un dossier nommé hangup-extension.',
      cg2:'Dans Chrome, ouvrez chrome://extensions, activez le mode développeur, cliquez sur Charger l\'extension non empaquetée et choisissez ce dossier.',
      cg3:'Cliquez sur l\'icône en forme de pièce de puzzle dans la barre de Chrome et épinglez HangUp. Elle pointe déjà vers le serveur HangUp hébergé, il n\'y a rien à configurer.',
      cgDownload:'Télécharger l\'extension (.zip)',
      cgNote:'Attention : l\'extension n\'est pas encore dans le Chrome Web Store, il faut donc la charger à la main. Elle ne fonctionne que sur les pages de factures PayPal, donc la page d\'exercice n\'affichera pas la bannière : copiez sa note dans la zone ci-dessus pour voir un résultat. La première vérification après une période d\'inactivité peut prendre jusqu\'à une minute.',
      pWake:'Réveil du serveur HangUp (la première vérification peut prendre jusqu\'à une minute)…',
      pOpen:'Ouverture de la page de facture PayPal…',
      pRead:'Lecture de la note du vendeur…',
      pCheck:'Recherche d\'une arnaque au rappel…',
      hWake:'serveur en cours de réveil…',
      cgPractice:'Ouvrir la facture d\'exercice (clairement indiquée comme ne venant pas de PayPal)',
      hOk:'serveur ok', hBad:'serveur injoignable', hDeg:'serveur dégradé', hLLM:'IA', hPP:'PayPal' }
  };
  // Plain-language reason labels (mirrors src/labels.js; a test keeps them in step).
  var REASONS = {
    en: {
      PHONE_IN_TEXT: 'It contains a phone number',
      CALLBACK_DEMANDED: 'It tells you to phone them',
      UNRECOGNISED_CHARGE: 'It talks about a charge you may not have made',
      BRAND_MISMATCH: "It names a company that isn't the sender",
      REMOTE_ACCESS_OR_REFUND: 'It mentions remote access or a refund',
      URGENCY: 'It pushes you to act fast',
      PAYMENT_OUTSIDE_PAYPAL: 'It asks for payment outside PayPal',
      INJECTION_ATTEMPT: 'It contains hidden instructions aimed at checkers',
      UNFAMILIAR_SELLER: 'You have not paid this seller before, and the invoice says almost nothing except a number',
    },
    es: {
      PHONE_IN_TEXT: 'Contiene un número de teléfono',
      CALLBACK_DEMANDED: 'Le dice que los llame por teléfono',
      UNRECOGNISED_CHARGE: 'Habla de un cargo que quizá usted no hizo',
      BRAND_MISMATCH: 'Nombra a una empresa que no es quien lo envía',
      REMOTE_ACCESS_OR_REFUND: 'Menciona acceso remoto o un reembolso',
      URGENCY: 'Le presiona para que actúe rápido',
      PAYMENT_OUTSIDE_PAYPAL: 'Le pide pagar fuera de PayPal',
      INJECTION_ATTEMPT: 'Contiene instrucciones ocultas dirigidas a los verificadores',
      UNFAMILIAR_SELLER: 'Usted no le ha pagado antes a este vendedor, y la factura casi no dice nada salvo un número',
    },
    fr: {
      PHONE_IN_TEXT: 'Il contient un numéro de téléphone',
      CALLBACK_DEMANDED: 'Il vous demande de les appeler',
      UNRECOGNISED_CHARGE: 'Il parle d\'un débit que vous n\'avez peut-être pas fait',
      BRAND_MISMATCH: 'Il cite une entreprise qui n\'est pas l\'expéditeur',
      REMOTE_ACCESS_OR_REFUND: 'Il mentionne un accès à distance ou un remboursement',
      URGENCY: 'Il vous pousse à agir vite',
      PAYMENT_OUTSIDE_PAYPAL: 'Il demande un paiement en dehors de PayPal',
      INJECTION_ATTEMPT: 'Il contient des instructions cachées visant les outils de vérification',
      UNFAMILIAR_SELLER: 'Vous n\'avez jamais payé ce vendeur, et la facture ne dit presque rien à part un numéro',
    },
  };
  function reasonText(c) { return (REASONS[lang] && REASONS[lang][c]) || REASONS.en[c] || c; }
  var $ = function (id) { return document.getElementById(id); };
  var lang = 'en';
  try { lang = localStorage.getItem('hangup.lang') || (navigator.language || 'en').slice(0, 2); } catch (e) {}
  if (!I18N[lang]) lang = 'en';
  var t = function (k) { return I18N[lang][k] || I18N.en[k] || k; };
  var textMode = false, last = null, lastHealth = undefined, healthAnswered = false, progTimers = [];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function applyLang() {
    document.documentElement.lang = lang;
    $('lang').value = lang;
    document.querySelectorAll('[data-i]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i')); });
    $('toggle').textContent = textMode ? t('toggleLink') : t('toggleText');
    renderHealth();
    if (last) render(last);
  }

  // Highlight evidence quotes inside text; returns safe HTML.
  function highlight(text, quotes) {
    text = String(text || '');
    var ranges = [], low = text.toLowerCase();
    (quotes || []).forEach(function (q) {
      q = String(q || '').trim(); if (q.length < 3) return;
      var i = low.indexOf(q.toLowerCase());
      if (i < 0) { // tolerate whitespace differences
        var re; try { re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'i'); } catch (e) { return; }
        var m = re.exec(text); if (!m) return; i = m.index; q = m[0];
      }
      ranges.push([i, i + q.length]);
    });
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [];
    ranges.forEach(function (r) { var l = merged[merged.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else merged.push(r.slice()); });
    var out = '', pos = 0;
    merged.forEach(function (r) { out += esc(text.slice(pos, r[0])) + '<mark>' + esc(text.slice(r[0], r[1])) + '</mark>'; pos = r[1]; });
    return out + esc(text.slice(pos));
  }

  function provLine(p) {
    p = p || {};
    var src = String(p.source || '');
    if (p.fetched_at && /paypal|payer|url|fetch|render|page/i.test(src) && !/paste|text/i.test(src)) {
      var d = new Date(p.fetched_at), tm = isNaN(d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return tm ? t('provPage').replace('{t}', tm) : t('provPage').replace(' {t}', '').replace('{t}', '');
    }
    if (/extension/i.test(src)) return t('provExt');
    return t('provPaste');
  }

  function reportText(d) {
    var x = d.extracted || {}, r = d.result || {}, p = d.provenance || {};
    var lines = ['I received a PayPal invoice that looks like a callback scam. Reported via HangUp (independent tool).', ''];
    if (p.url || last && last.url) lines.push('Invoice link: ' + (p.url || last.url));
    lines.push('Invoicer: ' + (x.invoicer || 'unknown'));
    lines.push('Amount: ' + (x.amount != null ? x.amount : 'unknown') + (x.currency ? ' ' + x.currency : ''));
    var ph = r.features && r.features.phones; if (ph && ph.length) lines.push('Phone number(s) in the invoice: ' + ph.join(', '));
    lines.push('HangUp verdict: ' + r.verdict, '', 'Note from the sender (quoted):', '"' + (x.note || '') + '"');
    if (r.evidence && r.evidence.length) { lines.push('', 'Key phrases:'); r.evidence.forEach(function (q) { lines.push('- ' + q); }); }
    lines.push('', 'Source: ' + provLine(p) + '.');
    return lines.join('\n');
  }

  // Build note HTML with server-supplied spans (offsets into the ORIGINAL note). Falls back to quote matching only when no spans were sent.
  function highlightSpans(text, spans) {
    text = String(text || '');
    var rs = (spans || []).filter(function (s) { return s.field === 'note' && s.end > s.start && s.end <= text.length; })
      .map(function (s) { return [s.start, s.end]; }).sort(function (a, b) { return a[0] - b[0]; });
    var out = '', pos = 0;
    rs.forEach(function (r) { if (r[0] < pos) return; out += esc(text.slice(pos, r[0])) + '<mark>' + esc(text.slice(r[0], r[1])) + '</mark>'; pos = r[1]; });
    return out + esc(text.slice(pos));
  }

  function render(d) {
    var out = $('out');
    if (d.error) {
      var key = { LLM_UNAVAILABLE: 'errLLM', PAYPAL_UNREACHABLE: 'errPP', NOT_PAYPAL_INVOICE_HOST: 'errHost', NETWORK: 'errNet' }[d.error] || 'errGen';
      out.innerHTML = '<div class="verdict err" role="alert"><div class="ic" aria-hidden="true">⚠️</div><div><h2>' + esc(t(key)) + '</h2>' +
        (d.message && key === 'errGen' ? '<p>' + esc(d.message) + '</p>' : '') + '<p class="prov">' + esc(d.error) + '</p></div></div>';
      return;
    }
    var r = d.result || {}, x = d.extracted || {}, f = r.form || {};
    var cls = r.verdict === 'LIKELY_CALLBACK_SCAM' ? 'scam' : r.verdict === 'SUSPICIOUS' ? 'sus' : 'none';
    var icon = { scam: '🛑', sus: '⚠️', none: 'ℹ️' }[cls];
    var open = cls !== 'none';
    var h = '<section class="card result" aria-labelledby="vh"><div class="verdict ' + cls + '"><div class="ic" aria-hidden="true">' + icon + '</div><div><h2 id="vh">' + esc(t(cls)) + '</h2>';
    if (f.explanation_plain) h += '<p class="plain">' + esc(f.explanation_plain) + '</p>';
    h += '<button type="button" class="btn secondary whyb" id="whyb" aria-expanded="' + open + '" aria-controls="whybox">' + esc(open ? t('hideWhy') : t('why')) + '</button></div></div>';
    h += '<div id="whybox"' + (open ? '' : ' hidden') + '>';
    h += '<h3>' + esc(t('noticed')) + '</h3>';
    h += r.reasons && r.reasons.length
      ? '<ul class="adv">' + r.reasons.map(function (c) { return '<li>' + esc(reasonText(c)) + '</li>'; }).join('') + '</ul>'
      : '<p>' + esc(t('noReasons')) + '</p>';
    if (x.note) {
      var spans = r.evidence_spans, hasSpans = Array.isArray(spans);
      h += '<h3>' + esc(t('evidence')) + '</h3><div class="note">' + (hasSpans ? highlightSpans(x.note, spans) : highlight(x.note, r.evidence)) + '</div>';
      var other = hasSpans ? spans.filter(function (s) { return s.field !== 'note'; }) : [];
      if (other.length) h += '<p class="prov">' + esc(t('alsoIn')) + ': ' + other.map(function (s) { return esc(t('f_' + s.field)) + ' <mark>' + esc(s.text) + '</mark>'; }).join('; ') + '</p>';
    }
    h += '</div>';
    if (r.advice && r.advice.length) h += '<h3>' + esc(t('advice')) + '</h3><ul class="adv">' + r.advice.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
    h += '<dl class="meta"><dt>' + esc(t('invoicer')) + '</dt><dd>' + esc(x.invoicer || '—') + '</dd><dt>' + esc(t('amount')) + '</dt><dd>' + esc(x.amount != null && x.amount !== '' ? x.amount + (x.currency ? ' ' + x.currency : '') : '—') + '</dd></dl>';
    h += '<p class="prov">' + esc(provLine(d.provenance)) + '</p>';
    if (d.provenance && d.provenance.message && d.provenance.message.replace(/\.$/, '') !== provLine(d.provenance)) h += '<p class="prov">' + esc(d.provenance.message) + '</p>';
    if (cls !== 'none') {
      h += '<p><button class="btn secondary" id="copy" type="button">' + esc(t('copy')) + '</button></p><p id="copymsg" class="prov" role="status"></p>';
      h += '<textarea id="reportbox" class="field hidden" readonly aria-label="Report"></textarea>';
    }
    h += '</section>';
    out.innerHTML = h;
    $('whyb').onclick = function () {
      var box = $('whybox'), nowOpen = box.hasAttribute('hidden');
      if (nowOpen) box.removeAttribute('hidden'); else box.setAttribute('hidden', '');
      this.setAttribute('aria-expanded', String(nowOpen)); this.textContent = t(nowOpen ? 'hideWhy' : 'why');
    };
    if ($('copy')) $('copy').onclick = function () {
      var txt = reportText(d), msg = $('copymsg');
      var fallback = function () { var b = $('reportbox'); b.value = txt; b.classList.remove('hidden'); b.focus(); b.select(); msg.textContent = t('copyfail'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { msg.textContent = t('copied'); }, fallback); else fallback();
    };
  }

  // Progress steps shown while a check is pending; advance on timers.
  var progKeys = [], progIdx = 0;
  function renderProgress() {
    $('out').innerHTML = '<div class="card progress"><ol class="prog">' + progKeys.map(function (k, i) {
      var st = i < progIdx ? 'done' : i === progIdx ? 'now' : 'todo';
      return '<li class="' + st + '"' + (st === 'now' ? ' aria-current="step"' : '') + '><span class="mk" aria-hidden="true">' + (st === 'done' ? '✓' : st === 'now' ? '…' : '·') + '</span> ' + esc(t(k)) + '</li>';
    }).join('') + '</ol></div>';
  }
  function stopProgress() { progTimers.forEach(clearTimeout); progTimers = []; }
  function startProgress(isUrl) {
    stopProgress();
    progKeys = isUrl ? (healthAnswered ? [] : ['pWake']).concat(['pOpen', 'pRead', 'pCheck']) : ['pCheck'];
    progIdx = 0; renderProgress();
    var gaps = isUrl ? (healthAnswered ? [3000, 5000] : [8000, 3000, 5000]) : [];
    var at = 0;
    gaps.forEach(function (g) { at += g; progTimers.push(setTimeout(function () { if (progIdx < progKeys.length - 1) { progIdx++; renderProgress(); } }, at)); });
  }

  function show(d) { stopProgress(); last = d; render(d); var h = $('vh'); if (h) { h.setAttribute('tabindex', '-1'); h.focus(); } }

  $('f').addEventListener('submit', function (e) {
    e.preventDefault();
    var body;
    if (textMode) {
      var txt = $('txt').value.trim(); if (!txt) { $('out').innerHTML = '<div class="banner" role="alert">' + esc(t('needInput')) + '</div>'; return; }
      body = { invoicer: $('inv').value.trim(), amount: null, currency: '', items: [], note: txt, terms: '' };
    } else {
      var u = $('url').value.trim(); if (!u) { $('out').innerHTML = '<div class="banner" role="alert">' + esc(t('needInput')) + '</div>'; return; }
      body = { url: u };
    }
    if ($('hist').value) body.unfamiliar_seller = $('hist').value; // 'true' = never paid, 'false' = has paid; unset = unknown
    var btn = $('go'); btn.disabled = true; btn.textContent = t('checking'); startProgress(!!body.url);
    fetch('/api/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return { error: 'HTTP_' + r.status }; }); })
      .then(function (d) { if (body.url && !d.error) d.url = body.url; show(d); })
      .catch(function () { show({ error: 'NETWORK' }); })
      .then(function () { btn.disabled = false; btn.textContent = t('go'); });
  });

  $('toggle').addEventListener('click', function () {
    textMode = !textMode;
    $('modeLink').classList.toggle('hidden', textMode);
    $('modeText').classList.toggle('hidden', !textMode);
    $('toggle').setAttribute('aria-expanded', String(textMode));
    $('toggle').textContent = textMode ? t('toggleLink') : t('toggleText');
    (textMode ? $('txt') : $('url')).focus();
  });
  $('lang').addEventListener('change', function () { lang = this.value; try { localStorage.setItem('hangup.lang', lang); } catch (e) {} applyLang(); });

  function renderHealth() {
    var el = $('health'), h = lastHealth;
    if (h === undefined) { el.className = 'pill warn'; el.lastChild.textContent = t('hWake'); return; }
    if (!h) { el.className = 'pill bad'; el.lastChild.textContent = t('hBad'); return; }
    var bad = h.paypal === 'unreachable' || h.llm === 'unreachable', un = h.paypal === 'unconfigured' || h.llm === 'unconfigured';
    el.className = 'pill ' + (bad ? 'warn' : un ? 'warn' : 'ok');
    el.lastChild.textContent = (bad || un ? t('hDeg') : t('hOk')) + ' · ' + t('hLLM') + ' ' + h.llm + ' · ' + t('hPP') + ' ' + h.paypal + (h.env ? ' · ' + h.env : '');
  }
  function poll() {
    fetch('/api/health').then(function (r) { return r.json(); }).then(function (h) { lastHealth = h; healthAnswered = true; renderHealth(); }).catch(function () { lastHealth = null; renderHealth(); });
  }
  applyLang(); poll(); setInterval(poll, 30000);
})();
