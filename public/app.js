(function () {
  'use strict';

  var board = null;
  var showDq = false;
  var showUnreg = true;
  var showDetails = true;
  var pollTimer = null;
  var tickTimer = null;
  var nextRefreshAt = 0;
  var serverOffset = 0;
  var adminPassword = sessionStorage.getItem('admin-password') || '';

  var $ = function (s) { return document.querySelector(s); };
  var boardHead = $('#board-head');
  var boardBody = $('#board-body');

  // ---- theme ----
  var theme = localStorage.getItem('chl-theme') || 'dark';
  applyTheme(theme);

  function applyTheme(t) {
    theme = t;
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('chl-theme', t);
    var sun = $('#icon-sun');
    var moon = $('#icon-moon');
    if (sun && moon) {
      sun.style.display = t === 'light' ? 'block' : 'none';
      moon.style.display = t === 'dark' ? 'block' : 'none';
    }
  }

  // ---- api ----
  function api(path, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    if (adminPassword) {
      opts.headers['x-admin-password'] = adminPassword;
    }
    return fetch(path, opts).then(function (r) {
      if (r.status === 401) {
        throw new Error('Unauthorized');
      }
      return r.json();
    });
  }

  function fetchBoard() {
    $('#refresh-dot').className = 'dot fetching';
    $('#refresh-text').textContent = 'updating…';
    api('/api/scoreboard')
      .then(function (data) {
        board = data;
        if (data.serverTime) serverOffset = data.serverTime - Date.now();
        if (data.nextRefreshTime) nextRefreshAt = data.nextRefreshTime;
        renderBoard();
        $('#refresh-dot').className = 'dot live';
        tick();
      })
      .catch(function () {
        $('#refresh-dot').className = 'dot';
        $('#refresh-text').textContent = 'error';
      });
  }

  function tick() {
    var serverNow = Date.now() + serverOffset;
    var rem = Math.max(0, Math.ceil((nextRefreshAt - serverNow) / 1000));
    if (rem <= 0) { $('#refresh-text').textContent = 'updating…'; return; }
    var m = Math.floor(rem / 60);
    var s = rem % 60;
    $('#refresh-text').textContent = m + ':' + (s < 10 ? '0' : '') + s;
  }

  function startTimers() {
    if (pollTimer) clearInterval(pollTimer);
    if (tickTimer) clearInterval(tickTimer);
    pollTimer = setInterval(fetchBoard, 30000);
    tickTimer = setInterval(tick, 1000);
  }

  // ---- helpers ----
  function probLetter(i) {
    var s = '';
    i++;
    while (i > 0) { i--; s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26); }
    return s;
  }

  function fmtTime(min) {
    if (min < 0) return '';
    var h = Math.floor(min / 60);
    var m = min % 60;
    return h > 0 ? h + ':' + (m < 10 ? '0' : '') + m : m + 'm';
  }

  function getDisplayName(username) {
    if (!board || !board.registrations) return null;
    var reg = board.registrations[username.toLowerCase()];
    return reg ? reg.displayName : null;
  }

  function isRegistered(username) {
    if (!board || !board.registrations) return true; // if no reg data, treat all as registered
    return !!board.registrations[username.toLowerCase()];
  }

  function getRegInfo(username) {
    if (!board || !board.registrations) return null;
    return board.registrations[username.toLowerCase()] || null;
  }

  function firstSolvers(standings, problems) {
    var fb = {};
    for (var pi = 0; pi < problems.length; pi++) {
      var slug = problems[pi].slug;
      var best = Infinity, who = null;
      for (var si = 0; si < standings.length; si++) {
        if (standings[si].disqualified) continue;
        var pr = standings[si].problems[pi];
        if (pr && pr.solved && pr.firstAcTime > 0 && pr.firstAcTime < best) {
          best = pr.firstAcTime; who = standings[si].username;
        }
      }
      if (who) fb[slug] = who;
    }
    return fb;
  }

  // ---- render ----
  function renderBoard() {
    if (!board || !board.standings || !board.standings.length) {
      $('#leaderboard').classList.add('hidden');
      $('#empty-state').classList.remove('hidden');
      return;
    }
    $('#leaderboard').classList.remove('hidden');
    $('#empty-state').classList.add('hidden');

    var slug = board.contestSlug || '';
    $('#contest-title').textContent = slug.split('-').map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');

    var totalSubs = 0;
    board.standings.forEach(function (s) {
      s.problems.forEach(function (p) { totalSubs += p.attempts; });
    });
    $('#sub-count').textContent = totalSubs + ' submissions';

    // show scoring mode badge
    var modeBadge = $('#scoring-mode-badge');
    if (modeBadge && board.config) {
      var mode = board.config.scoringMode;
      modeBadge.textContent = mode === 'icpc' ? 'ICPC Tiebreak' : 'Last-AC Tiebreak';
    }

    var probs = board.problems;
    var fb = firstSolvers(board.standings, probs);

    // Penalty column label: show "Penalty" when penalty minutes > 0, else "Time" since
    // only solve-time component contributes when wrong-attempt penalty is 0
    var penMinutes = board.config ? board.config.penaltyMinutes : 20;
    var penaltyLabel = penMinutes > 0 ? 'Penalty' : 'Time';

    var h = '<tr>'
      + '<th class="c-rank">#</th>'
      + '<th class="c-user">Participant</th>'
      + '<th class="c-num">Score</th>'
      + '<th class="c-num">Solved</th>'
      + '<th class="c-num">' + penaltyLabel + '</th>';
    for (var p = 0; p < probs.length; p++) {
      h += '<th class="c-prob" title="' + probs[p].name + ' (' + probs[p].maxScore + ' pts)">'
        + probLetter(p)
        + '<span class="prob-pts">' + probs[p].maxScore + '</span></th>';
    }
    h += '</tr>';
    boardHead.innerHTML = h;

    var b = '';
    for (var i = 0; i < board.standings.length; i++) {
      var row = board.standings[i];

      // DQ filter
      if (row.disqualified && !showDq) continue;

      // Unregistered filter
      if (!isRegistered(row.username) && !showUnreg) continue;

      var dispName = getDisplayName(row.username);
      var regFlag = isRegistered(row.username);

      var rowCls = '';
      if (row.disqualified) rowCls = ' class="row-dq"';
      else if (!regFlag) rowCls = ' class="row-unreg"';
      b += '<tr' + rowCls + '>';

      var rc = 'cell-rank';
      if (row.rank === 1) rc += ' r1';
      else if (row.rank === 2) rc += ' r2';
      else if (row.rank === 3) rc += ' r3';
      b += '<td class="' + rc + '">' + (row.rank > 0 ? row.rank : '—') + '</td>';

      // Participant cell: show display name (with handle as subtitle) or handle with unreg tag
      b += '<td class="cell-user" data-click-user="' + row.username + '">';
      if (dispName) {
        b += '<span class="user-name">' + dispName + '</span>';
        b += '<span class="user-handle">@' + row.username + '</span>';
      } else {
        b += '<span class="user-name">' + row.username + '</span>';
        b += '<span class="unreg-tag">UNREG</span>';
      }
      if (row.disqualified) {
        b += '<span class="dq-tag">DQ</span>';
      }
      b += '</td>';

      b += '<td class="cell-score">' + row.totalScore + '</td>';
      b += '<td class="cell-solved">' + row.solved + '</td>';
      b += '<td class="cell-penalty">' + row.penalty + '</td>';

      for (var pi = 0; pi < probs.length; pi++) {
        var pr = row.problems[pi];
        b += '<td class="cell-prob">';
        if (!pr || pr.attempts === 0) {
          b += '<div class="pc"></div>';
        } else if (pr.solved) {
          var cls = 'pc ac' + (fb[pr.slug] === row.username ? ' fb' : '');
          b += '<div class="' + cls + '">'
            + '<span class="v">+' + (pr.wrongAttempts > 0 ? pr.wrongAttempts : '') + '</span>';
          if (showDetails) b += '<span class="t">' + fmtTime(pr.solveTimeMinutes) + '</span>';
          b += '</div>';
        } else {
          b += '<div class="pc wa"><span class="v">-' + pr.attempts + '</span>';
          if (showDetails) b += '<span class="t">' + pr.bestScore + '</span>';
          b += '</div>';
        }
        b += '</td>';
      }
      b += '</tr>';
    }
    boardBody.innerHTML = b;
  }

  // ---- user detail ----
  function showUser(username) {
    if (!board) return;
    var s = null;
    for (var i = 0; i < board.standings.length; i++) {
      if (board.standings[i].username === username) { s = board.standings[i]; break; }
    }
    if (!s) return;

    var reg = getRegInfo(username);
    var dispName = reg ? reg.displayName : s.username;

    $('#user-detail-title').textContent = dispName;

    // Info rows for registered users
    var infoHtml = '';
    if (reg) {
      infoHtml = '<div class="user-meta">'
        + '<span class="meta-chip">@' + s.username + '</span>'
        + '<span class="meta-chip">' + reg.enrollmentNo + '</span>'
        + '<span class="meta-chip">' + reg.branch + ' ' + reg.batch + '</span>'
        + '</div>';
    } else {
      infoHtml = '<div class="user-meta"><span class="meta-chip unreg">@' + s.username + ' — Unregistered</span></div>';
    }

    var h = infoHtml;
    h += '<div class="user-stats">'
      + '<div class="stat-card"><div class="stat-value">' + (s.rank > 0 ? '#' + s.rank : 'DQ') + '</div><div class="stat-label">Rank</div></div>'
      + '<div class="stat-card"><div class="stat-value">' + s.totalScore + '</div><div class="stat-label">Score</div></div>'
      + '<div class="stat-card"><div class="stat-value">' + s.solved + '/' + s.problems.length + '</div><div class="stat-label">Solved</div></div>'
      + '<div class="stat-card"><div class="stat-value">' + s.penalty + '</div><div class="stat-label">Penalty</div></div>'
      + '</div>';

    h += '<table class="user-problems"><thead><tr><th></th><th>Problem</th><th>Pts</th><th>Verdict</th><th>Tries</th><th>Time</th><th>Score</th></tr></thead><tbody>';
    for (var p = 0; p < s.problems.length; p++) {
      var pr = s.problems[p];
      h += '<tr><td style="font-weight:700;color:var(--text-3)">' + probLetter(p) + '</td>';
      h += '<td>' + pr.name + '</td>';
      h += '<td style="font-family:var(--mono,monospace);font-size:.8rem;color:var(--text-3)">' + pr.maxScore + '</td>';
      if (pr.solved) h += '<td class="v-ac">AC</td>';
      else if (pr.attempts > 0) h += '<td class="v-wa">-' + pr.attempts + '</td>';
      else h += '<td style="color:var(--text-4)">—</td>';
      h += '<td>' + pr.attempts + '</td>';
      h += '<td>' + (pr.solveTimeMinutes >= 0 ? fmtTime(pr.solveTimeMinutes) : '—') + '</td>';
      h += '<td>' + pr.bestScore + '</td></tr>';
    }
    h += '</tbody></table>';

    if (adminPassword) {
      h += '<div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end">';
      if (s.disqualified) {
        h += '<button class="btn btn-primary" onclick="window._reinstate(\'' + s.username + '\')">Reinstate</button>';
      } else {
        h += '<button class="btn btn-danger" onclick="window._dq(\'' + s.username + '\')">Disqualify</button>';
      }
      h += '</div>';
    }

    $('#user-detail-body').innerHTML = h;
    $('#user-overlay').classList.remove('hidden');
  }

  window._dq = function (u) {
    api('/api/disqualify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u }) })
      .then(function () { $('#user-overlay').classList.add('hidden'); fetchBoard(); });
  };
  window._reinstate = function (u) {
    api('/api/reinstate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u }) })
      .then(function () { $('#user-overlay').classList.add('hidden'); fetchBoard(); });
  };

  // ---- events ----
  $('#btn-theme').addEventListener('click', function () {
    applyTheme(theme === 'light' ? 'dark' : 'light');
  });

  // Settings button → open admin in new tab
  $('#btn-settings').addEventListener('click', function () {
    window.open('/admin', '_blank');
  });

  $('#btn-close-user').addEventListener('click', function () { $('#user-overlay').classList.add('hidden'); });
  $('#user-overlay').addEventListener('click', function (e) { if (e.target === this) this.classList.add('hidden'); });

  boardBody.addEventListener('click', function (e) {
    var t = e.target.closest('[data-click-user]');
    if (t) showUser(t.getAttribute('data-click-user'));
  });

  // View toggles
  $('#toggle-details').addEventListener('change', function () {
    showDetails = this.checked;
    renderBoard();
  });

  $('#toggle-dq-visible').addEventListener('change', function () {
    showDq = this.checked;
    renderBoard();
  });

  var unregToggle = $('#toggle-unreg-visible');
  if (unregToggle) {
    unregToggle.addEventListener('change', function () {
      showUnreg = this.checked;
      renderBoard();
    });
  }

  // Refresh button: admin triggers server re-fetch, non-admin just re-reads cached board
  $('#btn-refresh').addEventListener('click', function () {
    if (adminPassword) {
      api('/api/refresh', { method: 'POST' });
      $('#refresh-dot').className = 'dot fetching';
      $('#refresh-text').textContent = 'syncing…';
      setTimeout(fetchBoard, 8000);
    } else {
      // Non-admin: just re-fetch cached board from server immediately
      fetchBoard();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      $('#user-overlay').classList.add('hidden');
    }
  });

  fetchBoard();
  startTimers();
})();
