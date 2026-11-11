/* components/notes-tool.js
 * Inline annotation tool for portfolio pages.
 * Notes persist in localStorage per page.
 * Renders as numbered badges on elements + margin rail on the right.
 */
(function () {
  'use strict';

  // ── Page key ───────────────────────────────────────────────────────────────
  var PAGE_KEY = (function () {
    var path = window.location.pathname.split('/').pop();
    return 'portfolio-notes-' + (path.replace('.html', '') || 'index');
  })();

  // ── Storage ────────────────────────────────────────────────────────────────
  function loadNotes() {
    try { return JSON.parse(localStorage.getItem(PAGE_KEY) || '[]'); }
    catch (e) { return []; }
  }

  function saveNotes() {
    localStorage.setItem(PAGE_KEY, JSON.stringify(notes));
  }

  // ── Visibility state ───────────────────────────────────────────────────────
  function loadHidden() {
    try { return localStorage.getItem(PAGE_KEY + '-hidden') === '1'; }
    catch (e) { return false; }
  }

  function saveHidden() {
    localStorage.setItem(PAGE_KEY + '-hidden', isHidden ? '1' : '0');
  }

  // ── Element fingerprinting ─────────────────────────────────────────────────
  // Identifies elements stably across reloads without modifying the DOM.
  // Uses the nearest screen/section label + element tag + first 80 chars of text.
  function fingerprint(el) {
    var screen = el.closest('[data-screen-label]') ||
                 el.closest('section[id]') ||
                 el.closest('.cs-subsection-block[id]');
    var screenId = (screen && (screen.dataset.screenLabel || screen.id)) || '';
    var text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    var tag = el.tagName.toLowerCase();
    return { screenId: screenId, text: text, tag: tag };
  }

  function findByFingerprint(fp) {
    var container = document;
    if (fp.screenId) {
      container = document.querySelector('[data-screen-label="' + fp.screenId + '"]') ||
                  document.getElementById(fp.screenId) ||
                  document;
    }
    var search = fp.text.trim().slice(0, 50);
    if (!search) return null;
    var candidates = (container === document ? document.body : container).querySelectorAll(fp.tag);
    return Array.from(candidates).find(function (el) {
      if (el.closest('[data-note-tool]')) return false;
      return (el.textContent || '').replace(/\s+/g, ' ').trim().startsWith(search);
    }) || null;
  }

  // ── State ──────────────────────────────────────────────────────────────────
  var notes = loadNotes();
  var isSelectMode = false;
  var isHidden = loadHidden();
  var hovered = null;
  var positionTimer = null;

  // ── Init ───────────────────────────────────────────────────────────────────
  // Dormant until the first press of N: visitors never see the tool.
  var isActive = false;

  function init() {
    document.addEventListener('keydown', onGlobalKey);
  }

  function activate() {
    isActive = true;
    isHidden = false;
    saveHidden();
    injectStylesheet();
    renderToolbar();
    rerenderAll();

    document.addEventListener('scroll', schedulePositionUpdate, { passive: true, capture: true });
    window.addEventListener('resize', schedulePositionUpdate);
  }

  function schedulePositionUpdate() {
    if (positionTimer) cancelAnimationFrame(positionTimer);
    positionTimer = requestAnimationFrame(updatePositions);
  }

  // ── Stylesheet ─────────────────────────────────────────────────────────────
  function injectStylesheet() {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    // Resolve path relative to the script's own location
    var scripts = document.querySelectorAll('script[src]');
    var base = '';
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].src.indexOf('notes-tool.js') !== -1) {
        base = scripts[i].src.replace('components/notes-tool.js', '');
        break;
      }
    }
    link.href = base + 'styles/notes-tool.css';
    document.head.appendChild(link);
  }

  // ── Toolbar ────────────────────────────────────────────────────────────────
  function renderToolbar() {
    var existing = document.getElementById('nt-toolbar');
    if (existing) existing.remove();

    var tb = el('div', 'nt-toolbar');
    tb.id = 'nt-toolbar';
    tb.setAttribute('data-note-tool', '');
    document.body.appendChild(tb);
    refreshToolbar();
  }

  function refreshToolbar() {
    var tb = document.getElementById('nt-toolbar');
    if (!tb) return;

    if (isHidden) {
      tb.innerHTML = '<button class="nt-show-btn" id="nt-show-btn">◉ Notes (' + notes.length + ')</button>';
      document.getElementById('nt-show-btn').addEventListener('click', toggleHide);
      return;
    }

    tb.innerHTML =
      '<span class="nt-count" id="nt-count">' + notes.length + '</span>' +
      '<span class="nt-label">Notes</span>' +
      '<button class="nt-btn' + (isSelectMode ? ' nt-active' : '') + '" id="nt-add-btn">' +
        (isSelectMode ? 'Cancel' : '+ Add') +
      '</button>' +
      (notes.length > 0 ? '<button class="nt-btn nt-secondary" id="nt-copy-btn">Copy</button>' : '') +
      (notes.length > 0 ? '<button class="nt-btn nt-danger" id="nt-clear-btn">Clear</button>' : '') +
      '<button class="nt-btn nt-secondary" id="nt-hide-btn">Hide</button>';

    document.getElementById('nt-add-btn').addEventListener('click', toggleSelectMode);
    var copyBtn = document.getElementById('nt-copy-btn');
    if (copyBtn) copyBtn.addEventListener('click', copyNotes);
    var clearBtn = document.getElementById('nt-clear-btn');
    if (clearBtn) clearBtn.addEventListener('click', clearNotes);
    document.getElementById('nt-hide-btn').addEventListener('click', toggleHide);
  }

  // ── Global keyboard shortcuts ──────────────────────────────────────────────
  function onGlobalKey(e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key !== 'n') return;
    e.preventDefault();
    if (!isActive) { activate(); return; }
    toggleSelectMode(); refreshToolbar();
  }

  // ── Select mode ────────────────────────────────────────────────────────────
  function toggleSelectMode() {
    isSelectMode = !isSelectMode;
    document.body.classList.toggle('nt-select-mode', isSelectMode);

    if (isSelectMode) {
      document.addEventListener('mouseover', onHover);
      document.addEventListener('mouseout', onOut);
      document.addEventListener('click', onSelect, true);
      document.addEventListener('keydown', onEsc);
    } else {
      exitSelectMode();
    }
    refreshToolbar();
  }

  function exitSelectMode() {
    isSelectMode = false;
    document.body.classList.remove('nt-select-mode');
    document.removeEventListener('mouseover', onHover);
    document.removeEventListener('mouseout', onOut);
    document.removeEventListener('click', onSelect, true);
    document.removeEventListener('keydown', onEsc);
    if (hovered) { hovered.classList.remove('nt-hovered'); hovered = null; }
  }

  function onHover(e) {
    var target = e.target;
    if (!isSelectable(target)) return;
    if (hovered) hovered.classList.remove('nt-hovered');
    hovered = target;
    hovered.classList.add('nt-hovered');
  }

  function onOut(e) {
    if (hovered) { hovered.classList.remove('nt-hovered'); hovered = null; }
  }

  function onEsc(e) {
    if (e.key === 'Escape') { exitSelectMode(); closePopover(); refreshToolbar(); }
  }

  function onSelect(e) {
    var target = e.target;
    if (!isSelectable(target)) return;
    e.preventDefault();
    e.stopPropagation();
    exitSelectMode();
    refreshToolbar();
    openAddPopover(target, e.clientX, e.clientY);
  }

  function isSelectable(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (el.closest('[data-note-tool]')) return false;
    var tag = el.tagName.toLowerCase();
    var skip = ['html', 'body', 'script', 'style', 'head', 'nav', 'svg', 'path', 'ul', 'ol'];
    if (skip.indexOf(tag) !== -1) return false;
    return (el.textContent || '').trim().length > 3;
  }

  // ── Add popover ────────────────────────────────────────────────────────────
  function openAddPopover(targetEl, x, y) {
    closePopover();

    var pop = el('div', 'nt-popover');
    pop.setAttribute('data-note-tool', '');
    pop.style.left = Math.min(x, window.innerWidth - 320) + 'px';
    pop.style.top = Math.min(y + 12, window.innerHeight - 130) + 'px';

    var ta = el('textarea', 'nt-popover-input');
    ta.rows = 3;
    ta.placeholder = 'Note… (⌘↵ save · esc cancel)';

    var actions = el('div', 'nt-popover-actions');
    var saveBtn = el('button', 'nt-btn');
    saveBtn.textContent = 'Save';
    var cancelBtn = el('button', 'nt-btn nt-secondary');
    cancelBtn.textContent = 'Cancel';
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    pop.appendChild(ta);
    pop.appendChild(actions);
    document.body.appendChild(pop);
    ta.focus();

    function doSave() {
      var text = ta.value.trim();
      if (text) {
        var fp = fingerprint(targetEl);
        notes.push({ id: uid(), fp: fp, text: text });
        saveNotes();
        rerenderAll();
      }
      closePopover();
    }

    saveBtn.addEventListener('click', doSave);
    cancelBtn.addEventListener('click', closePopover);

    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) doSave();
      if (e.key === 'Escape') closePopover();
    });

    // Close when clicking outside the popover
    setTimeout(function () {
      document.addEventListener('click', function outsideClick(e) {
        if (!pop.contains(e.target)) {
          closePopover();
          document.removeEventListener('click', outsideClick);
        }
      });
    }, 0);
  }

  function closePopover() {
    document.querySelectorAll('.nt-popover').forEach(function (p) { p.remove(); });
  }

  // ── Rail ───────────────────────────────────────────────────────────────────
  function renderRail() {
    var existing = document.getElementById('nt-rail');
    if (existing) existing.remove();
    if (isHidden || notes.length === 0) return;

    var rail = el('div', 'nt-rail');
    rail.id = 'nt-rail';
    rail.setAttribute('data-note-tool', '');
    document.body.appendChild(rail);

    notes.forEach(function (note, i) {
      var card = el('div', 'nt-card');
      card.dataset.noteId = note.id;

      var badge = el('span', 'nt-badge');
      badge.textContent = i + 1;

      var body = el('div', 'nt-card-body');

      var textEl = el('span', 'nt-card-text');
      textEl.textContent = note.text;

      var delBtn = el('button', 'nt-delete');
      delBtn.innerHTML = '&times;';
      delBtn.title = 'Delete note';
      delBtn.setAttribute('data-note-tool', '');

      body.appendChild(textEl);
      body.appendChild(delBtn);
      card.appendChild(badge);
      card.appendChild(body);
      rail.appendChild(card);

      delBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteNote(note.id);
      });

      textEl.addEventListener('dblclick', function (e) {
        e.stopPropagation();
        startEdit(note, textEl);
      });

      card.addEventListener('click', function (e) {
        if (e.target.closest('[data-note-tool]')) return;
        var target = findByFingerprint(note.fp);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
  }

  function startEdit(note, textEl) {
    var ta = el('textarea', 'nt-edit-input');
    ta.value = note.text;
    ta.rows = 2;
    textEl.replaceWith(ta);
    ta.focus();
    ta.select();

    function commit() {
      var val = ta.value.trim();
      if (val) { note.text = val; saveNotes(); }
      rerenderAll();
    }

    ta.addEventListener('blur', commit);
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { ta.blur(); }
      if (e.key === 'Escape') rerenderAll();
    });
  }

  // ── Badges ─────────────────────────────────────────────────────────────────
  function renderBadges() {
    document.querySelectorAll('.nt-marker').forEach(function (m) { m.remove(); });
    if (isHidden) return;

    notes.forEach(function (note, i) {
      var target = findByFingerprint(note.fp);
      if (!target) return;

      var marker = el('span', 'nt-marker');
      marker.setAttribute('data-note-tool', '');
      marker.dataset.noteId = note.id;
      marker.textContent = i + 1;
      marker.title = note.text;
      document.body.appendChild(marker);
    });
  }

  // ── Position update ────────────────────────────────────────────────────────
  function updatePositions() {
    var rail = document.getElementById('nt-rail');

    notes.forEach(function (note) {
      var target = findByFingerprint(note.fp);
      if (!target) return;

      var rect = target.getBoundingClientRect();
      var midY = rect.top + rect.height / 2;
      var inView = rect.top > -80 && rect.bottom < window.innerHeight + 80;

      var marker = document.querySelector('.nt-marker[data-note-id="' + note.id + '"]');
      if (marker) {
        if (inView) {
          marker.style.top = (midY - 9) + 'px';
          marker.style.left = Math.min(rect.right + 6, window.innerWidth - 230) + 'px';
          marker.style.display = '';
        } else {
          marker.style.display = 'none';
        }
      }

      if (rail) {
        var card = rail.querySelector('.nt-card[data-note-id="' + note.id + '"]');
        if (card) {
          if (inView) {
            var clampedY = Math.max(8, Math.min(midY - 16, window.innerHeight - 80));
            card.style.top = clampedY + 'px';
            card.style.opacity = '1';
            card.style.pointerEvents = 'all';
          } else {
            card.style.opacity = '0';
            card.style.pointerEvents = 'none';
          }
        }
      }
    });
  }

  // ── Hide / Show ────────────────────────────────────────────────────────────
  function toggleHide() {
    isHidden = !isHidden;
    saveHidden();
    rerenderAll();
  }

  // ── Copy all notes to clipboard ────────────────────────────────────────────
  function copyNotes() {
    var page = PAGE_KEY.replace('portfolio-notes-', '');
    var lines = ['Notes: ' + page + '\n'];
    notes.forEach(function (note, i) {
      var screen = note.fp.screenId ? '[' + note.fp.screenId + '] ' : '';
      lines.push((i + 1) + '. ' + screen + note.text);
    });
    var text = lines.join('\n');
    navigator.clipboard.writeText(text).then(function () {
      var btn = document.getElementById('nt-copy-btn');
      if (btn) {
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = 'Copy'; }, 1800);
      }
    }).catch(function () {
      // Fallback for older browsers
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    });
  }

  // ── Clear all ──────────────────────────────────────────────────────────────
  function clearNotes() {
    if (!window.confirm('Clear all ' + notes.length + ' note' + (notes.length === 1 ? '' : 's') + ' on this page? This cannot be undone.')) return;
    notes = [];
    saveNotes();
    rerenderAll();
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  function deleteNote(id) {
    notes = notes.filter(function (n) { return n.id !== id; });
    saveNotes();
    rerenderAll();
  }

  // ── Full re-render ─────────────────────────────────────────────────────────
  function rerenderAll() {
    renderRail();
    renderBadges();
    refreshToolbar();
    schedulePositionUpdate();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
