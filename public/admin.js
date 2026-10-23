(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var adminPassword = sessionStorage.getItem('admin-password') || '';

  // ---- API helper ----
  function api(path, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    if (adminPassword) {
      opts.headers['x-admin-password'] = adminPassword;
    }
    return fetch(path, opts).then(function (r) {
      if (r.status === 401) throw new Error('Unauthorized');
      return r.json();
    });
  }

  function toast(msg) {
    var el = $('#footer-toast');
    el.textContent = msg;
    el.style.opacity = '1';
    setTimeout(function () { el.style.opacity = '0'; }, 3000);
  }

  // ---- LOGIN ----
  function tryLogin() {
    var pass = $('#login-password').value;
    if (!pass) return;
    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass })
    })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
    .then(function (res) {
      if (res.ok && res.data.ok) {
        adminPassword = pass;
        sessionStorage.setItem('admin-password', pass);
        showAdmin();
      } else {
        $('#login-error').textContent = 'Incorrect password';
      }
    })
    .catch(function () {
      $('#login-error').textContent = 'Connection failed';
    });
  }

  $('#btn-login').addEventListener('click', tryLogin);
  $('#login-password').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') tryLogin();
  });

  // ---- SHOW ADMIN ----
  function showAdmin() {
    $('#login-screen').classList.add('hidden');
    $('#admin-panel').classList.remove('hidden');
    loadConfig();
    loadStatus();
  }

  // ---- LOAD CONFIG ----
  function loadConfig() {
    api('/api/config').then(function (cfg) {
      $('#scoring-mode').value = cfg.scoringMode || 'score';
      updateModeHint();
      $('#penalty-minutes').value = cfg.penaltyMinutes ?? 20;
      $('#contest-duration').value = cfg.contestDurationMinutes ?? 0;
      $('#toggle-partial-marking').checked = cfg.partialMarking !== false;
      $('#contest-slug').value = cfg.contestSlug || '';
      $('#hr-cookie').value = cfg.cookie || '';

      // render DQ list
      renderDqList(cfg.disqualified || []);
    }).catch(function (err) {
      if (err.message === 'Unauthorized') {
        sessionStorage.removeItem('admin-password');
        adminPassword = '';
        $('#admin-panel').classList.add('hidden');
        $('#login-screen').classList.remove('hidden');
        $('#login-error').textContent = 'Session expired — please login again';
      }
    });
  }

  function renderDqList(list) {
    var html = '';
    list.forEach(function (u) {
      html += '<span class="chip">'
        + u
        + ' <button data-reinstate="' + u + '">&times;</button>'
        + '</span>';
    });
    $('#dq-list').innerHTML = html;
    $('#dq-empty').style.display = list.length ? 'none' : 'block';
  }

  // ---- LOAD STATUS ----
  function loadStatus() {
    api('/api/status').then(function (s) {
      $('#stat-subs').textContent = s.submissionCount || '0';
      if (s.lastFetchTime) {
        var d = new Date(s.lastFetchTime);
        $('#stat-last-fetch').textContent = d.toLocaleTimeString();
      } else {
        $('#stat-last-fetch').textContent = 'Never';
      }
      $('#stat-fetch-status').textContent = s.fetchInProgress ? 'Fetching…' : 'Idle';
      var interval = Math.round((s.refreshInterval || 300000) / 60000);
      $('#stat-interval').textContent = interval + ' min';
    });
  }

  // ---- SCORING MODE HINT ----
  function updateModeHint() {
    var mode = $('#scoring-mode').value;
    var hint = $('#mode-hint');
    if (mode === 'score') {
      hint.textContent = 'Higher score wins. Ties broken by last AC time + wrong penalties.';
    } else {
      hint.textContent = 'Higher score wins. Ties broken by sum of all solve times + wrong penalties (ICPC-style).';
    }
  }
  $('#scoring-mode').addEventListener('change', updateModeHint);

  // ---- TEST CONNECTION ----
  $('#btn-test-conn').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true;
    btn.classList.add('loading');
    $('#conn-badge').className = 'status-badge status-unknown';
    $('#conn-badge-text').textContent = 'Testing…';
    $('#conn-message').textContent = 'Checking cookie validity…';

    api('/api/connectivity')
      .then(function (r) {
        if (r.status === 'connected') {
          $('#conn-badge').className = 'status-badge status-connected';
          $('#conn-badge-text').textContent = 'Connected';
          $('#conn-message').textContent = '✓ Cookie is valid — ' + r.total + ' submissions available.';
        } else if (r.status === 'no_cookie') {
          $('#conn-badge').className = 'status-badge status-warning';
          $('#conn-badge-text').textContent = 'No Cookie';
          $('#conn-message').textContent = 'No cookie configured. Paste one below.';
        } else if (r.status === 'no_slug') {
          $('#conn-badge').className = 'status-badge status-warning';
          $('#conn-badge-text').textContent = 'No Slug';
          $('#conn-message').textContent = 'No contest slug configured. Enter one below.';
        } else {
          $('#conn-badge').className = 'status-badge status-error';
          $('#conn-badge-text').textContent = 'Error';
          $('#conn-message').textContent = '✗ ' + (r.message || 'Connection failed');
        }
      })
      .catch(function () {
        $('#conn-badge').className = 'status-badge status-error';
        $('#conn-badge-text').textContent = 'Error';
        $('#conn-message').textContent = '✗ Could not reach server';
      })
      .finally(function () {
        btn.disabled = false;
        btn.classList.remove('loading');
      });
  });

  // ---- SAVE CONNECTION ----
  $('#btn-save-conn').addEventListener('click', function () {
    var slug = $('#contest-slug').value.trim();
    var cookie = $('#hr-cookie').value.trim();

    api('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contestSlug: slug,
        cookie: cookie
      })
    }).then(function () {
      toast('Connection settings saved');
      loadStatus();
    }).catch(function () {
      toast('Failed to save');
    });
  });

  // ---- SAVE SCORING ----
  $('#btn-save-scoring').addEventListener('click', function () {
    api('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scoringMode: $('#scoring-mode').value,
        penaltyMinutes: parseInt($('#penalty-minutes').value, 10) || 0,
        contestDurationMinutes: parseInt($('#contest-duration').value, 10) || 0,
        partialMarking: $('#toggle-partial-marking').checked
      })
    }).then(function () {
      toast('Scoring settings applied');
    }).catch(function () {
      toast('Failed to apply');
    });
  });

  // ---- DISQUALIFY ----
  $('#btn-dq').addEventListener('click', function () {
    var inp = $('#dq-input');
    var u = inp.value.trim();
    if (!u) return;

    api('/api/disqualify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u })
    }).then(function (r) {
      inp.value = '';
      renderDqList(r.disqualified || []);
      toast(u + ' disqualified');
    });
  });

  $('#dq-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') $('#btn-dq').click();
  });

  // reinstate via chip
  $('#dq-list').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-reinstate]');
    if (!btn) return;
    var u = btn.getAttribute('data-reinstate');
    api('/api/reinstate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u })
    }).then(function (r) {
      renderDqList(r.disqualified || []);
      toast(u + ' reinstated');
    });
  });

  // ---- FORCE REFRESH ----
  $('#btn-force-refresh').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true;
    btn.classList.add('loading');

    api('/api/refresh', { method: 'POST' })
      .then(function () {
        toast('Refresh started — data will update shortly');
        setTimeout(function () {
          loadStatus();
          btn.disabled = false;
          btn.classList.remove('loading');
        }, 5000);
      })
      .catch(function () {
        toast('Refresh failed');
        btn.disabled = false;
        btn.classList.remove('loading');
      });
  });

  // ---- EXPORT ----
  function downloadFile(url, fallbackName) {
    var a = document.createElement('a');
    a.href = url;
    a.download = fallbackName;
    // Need admin auth header, so use fetch + blob
    fetch(url, { headers: { 'x-admin-password': adminPassword } })
      .then(function (r) {
        if (!r.ok) throw new Error('Download failed');
        var disp = r.headers.get('content-disposition') || '';
        var match = disp.match(/filename="?([^"]+)"?/);
        if (match) a.download = match[1];
        return r.blob();
      })
      .then(function (blob) {
        a.href = URL.createObjectURL(blob);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
        toast('Downloaded ' + a.download);
      })
      .catch(function () {
        toast('Download failed');
      });
  }

  $('#btn-export-json').addEventListener('click', function () {
    downloadFile('/api/export/json', 'standings.json');
  });

  $('#btn-export-csv').addEventListener('click', function () {
    downloadFile('/api/export/csv', 'standings.csv');
  });

  // ---- UPLOAD REGISTRATIONS ----
  var regFileInput = $('#reg-file-input');
  var regFileName = $('#reg-file-name');
  var btnUpload = $('#btn-upload-reg');

  regFileInput.addEventListener('change', function () {
    var file = regFileInput.files[0];
    if (file) {
      regFileName.textContent = file.name;
      btnUpload.disabled = false;
    } else {
      regFileName.textContent = 'No file selected';
      btnUpload.disabled = true;
    }
  });

  btnUpload.addEventListener('click', function () {
    var file = regFileInput.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function (e) {
      var csv = e.target.result;
      btnUpload.disabled = true;
      btnUpload.textContent = 'Uploading…';

      fetch('/api/upload-registrations', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/csv',
          'x-admin-password': adminPassword
        },
        body: csv
      })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) {
          $('#reg-count').textContent = d.count + ' registrations loaded';
          toast('Registrations uploaded: ' + d.count + ' entries');
          regFileInput.value = '';
          regFileName.textContent = 'No file selected';
        } else {
          toast('Upload failed: ' + (d.error || 'unknown error'));
        }
      })
      .catch(function () {
        toast('Upload failed — check file format');
      })
      .finally(function () {
        btnUpload.disabled = false;
        btnUpload.textContent = 'Upload';
      });
    };
    reader.readAsText(file);
  });

  // ---- INIT ----
  // Auto-refresh status every 30s
  setInterval(loadStatus, 30000);

  // If already logged in, skip login screen
  if (adminPassword) {
    // Verify the password is still valid
    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword })
    })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.ok) {
        showAdmin();
      } else {
        sessionStorage.removeItem('admin-password');
        adminPassword = '';
      }
    })
    .catch(function () {
      // Show login if verification fails
    });
  }
})();
