// Token Radar's dashboard, radar-2. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail drawer with the model's
// own inputs and the protocol's farm plan, and the live-token view. No network: every byte it
// shows is in data.js. Selecting a row never leaves the page.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  var rows = DATA.rows || [];
  var live = DATA.live || [];
  var model = DATA.model || {};
  var state = { q: '', category: 'all', chain: 'all', sort: 'implied', watchOnly: false, tab: 'board', selected: null };

  function $(id) { return document.getElementById(id); }

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  function impliedOf(row) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var breadth = 1 + model.breadth_per_chain * Math.min(row.chains.length, model.breadth_max_chains);
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * breadth * row.category_multiplier));
  }

  function fillSelect(select, values) {
    values.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    });
  }

  function init() {
    var cats = [];
    var chains = [];
    rows.forEach(function (r) {
      if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
      r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
    });
    cats.sort();
    chains.sort();
    fillSelect($('category'), cats);
    fillSelect($('chain'), chains);

    var stats = $('stats');
    var chips = [
      ['Snapshot', DATA.as_of],
      ['Board rows', String(rows.length)],
      ['Watchlist', DATA.watchlist_size + ' covered'],
      ['Early finds', String(DATA.early_size)],
      ['Live set aside', String(DATA.live_size)],
      ['Model', DATA.model_version],
    ];
    chips.forEach(function (c) {
      var wrap = document.createElement('div');
      var dt = document.createElement('dt');
      dt.textContent = c[0];
      var dd = document.createElement('dd');
      dd.textContent = c[1];
      wrap.appendChild(dt);
      wrap.appendChild(dd);
      stats.appendChild(wrap);
    });

    var notes = $('model-notes');
    [
      ['Base', 'TVL x 0.25. Locked value is the closest thing to a balance sheet a pre-token protocol has.'],
      ['Growth', 'Seven-day TVL change, clamped to -60%..+120%, weighted 0.8. Momentum is rewarded, shrinkage punished.'],
      ['Maturity', '0.5 to 1.0 over four years of running with no token. Survival earns a higher multiple.'],
      ['Breadth', '1.00 to 1.25 for one to five chains. Multi-chain reach means wider distribution.'],
      ['Category', '0.90 to 1.10 from the snapshot itself: each category\u2019s share of total TVL. No category is favoured by hand.'],
    ].forEach(function (n) {
      var wrap = document.createElement('div');
      var dt = document.createElement('dt');
      dt.textContent = n[0];
      var dd = document.createElement('dd');
      dd.textContent = n[1];
      wrap.appendChild(dt);
      wrap.appendChild(dd);
      notes.appendChild(wrap);
    });

    $('q').addEventListener('input', function (e) { state.q = e.target.value.trim().toLowerCase(); renderBoard(); });
    $('category').addEventListener('change', function (e) { state.category = e.target.value; renderBoard(); });
    $('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
    $('sort').addEventListener('change', function (e) { state.sort = e.target.value; renderBoard(); });
    $('watchonly').addEventListener('change', function (e) { state.watchOnly = e.target.checked; renderBoard(); });
    $('tab-board').addEventListener('click', function () { setTab('board'); });
    $('tab-live').addEventListener('click', function () { setTab('live'); });
    $('tab-model').addEventListener('click', function () { setTab('model'); });
    $('detail-close').addEventListener('click', closeDetail);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });

    renderBoard();
    renderLive();
  }

  function setTab(tab) {
    state.tab = tab;
    $('tab-board').classList.toggle('active', tab === 'board');
    $('tab-live').classList.toggle('active', tab === 'live');
    $('tab-model').classList.toggle('active', tab === 'model');
    $('view-board').hidden = tab !== 'board';
    $('view-live').hidden = tab !== 'live';
    $('view-model').hidden = tab !== 'model';
  }

  function filteredRows() {
    var out = rows.filter(function (r) {
      if (state.watchOnly && !r.is_watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.q && (r.name.toLowerCase().indexOf(state.q) < 0 && r.slug.toLowerCase().indexOf(state.q) < 0)) return false;
      return true;
    });
    var dir = -1;
    var key = state.sort;
    out.sort(function (a, b) {
      var av, bv;
      if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; dir = 1; }
      else if (key === 'rank') { av = a.rank; bv = b.rank; dir = 1; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av !== bv) return (av < bv ? -1 : 1) * dir;
      return a.slug < b.slug ? -1 : 1;
    });
    return out;
  }

  function renderBoard() {
    var list = filteredRows();
    var tbody = $('rows');
    tbody.innerHTML = '';
    var maxImplied = rows.length ? rows[0].implied_value_usd : 1;
    list.forEach(function (r) {
      var tr = document.createElement('tr');
      if (state.selected === r.slug) tr.className = 'selected';
      tr.addEventListener('click', function () { openDetail(r.slug); });

      var rank = document.createElement('td');
      rank.className = 'num rank';
      rank.textContent = '#' + r.rank;
      tr.appendChild(rank);

      var name = document.createElement('td');
      var b = document.createElement('span');
      b.className = 'name';
      b.textContent = r.name;
      name.appendChild(b);
      if (r.is_watchlist) {
        var badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = 'Watchlist';
        name.appendChild(badge);
      }
      var slug = document.createElement('div');
      slug.className = 'slug';
      slug.textContent = r.slug;
      name.appendChild(slug);
      tr.appendChild(name);

      var cat = document.createElement('td');
      cat.textContent = r.category || 'Uncategorized';
      tr.appendChild(cat);

      var ch = document.createElement('td');
      ch.textContent = r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '');
      tr.appendChild(ch);

      var tvl = document.createElement('td');
      tvl.className = 'num';
      tvl.textContent = fmtUsd(r.tvl_usd);
      tr.appendChild(tvl);

      var chg = document.createElement('td');
      chg.className = 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg');
      chg.textContent = fmtPct(r.change_7d);
      tr.appendChild(chg);

      var age = document.createElement('td');
      age.className = 'num';
      age.textContent = fmtAge(r.age_days);
      tr.appendChild(age);

      var imp = document.createElement('td');
      imp.className = 'num';
      imp.textContent = fmtUsd(r.implied_value_usd);
      var bar = document.createElement('span');
      bar.className = 'bar';
      bar.style.width = Math.max(4, Math.round((r.implied_value_usd / maxImplied) * 100)) + '%';
      imp.appendChild(bar);
      tr.appendChild(imp);

      var farm = document.createElement('td');
      farm.className = 'farm-preview';
      var first = document.createElement('b');
      first.textContent = r.farm_steps.length + ' steps: ';
      farm.appendChild(first);
      farm.appendChild(document.createTextNode(r.farm_steps[0].split('.')[0] + '.'));
      tr.appendChild(farm);

      tbody.appendChild(tr);
    });
    $('count').textContent = list.length + ' of ' + rows.length + ' protocols shown' +
      (list.length === 0 ? ' — no protocol matches this filter.' : '.');
  }

  function renderLive() {
    var tbody = $('live-rows');
    tbody.innerHTML = '';
    live.forEach(function (r) {
      var tr = document.createElement('tr');
      var name = document.createElement('td');
      name.innerHTML = '<span class="name">' + esc(r.name) + '</span>';
      tr.appendChild(name);
      var cat = document.createElement('td');
      cat.textContent = r.category || 'Uncategorized';
      tr.appendChild(cat);
      var ch = document.createElement('td');
      ch.textContent = r.chains.slice(0, 3).join(', ');
      tr.appendChild(ch);
      var tvl = document.createElement('td');
      tvl.className = 'num';
      tvl.textContent = fmtUsd(r.tvl_usd);
      tr.appendChild(tvl);
      var mc = document.createElement('td');
      mc.className = 'num';
      mc.textContent = fmtUsd(r.mcap_usd);
      tr.appendChild(mc);
      var chg = document.createElement('td');
      chg.className = 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg');
      chg.textContent = fmtPct(r.change_7d);
      tr.appendChild(chg);
      tbody.appendChild(tr);
    });
  }

  function openDetail(slug) {
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    state.selected = slug;
    renderBoard();
    var body = $('detail-body');
    body.innerHTML = '';
    var h2 = document.createElement('h2');
    h2.textContent = r.name;
    body.appendChild(h2);
    var sub = document.createElement('p');
    sub.className = 'slug';
    sub.textContent = r.slug + (r.is_watchlist ? '  ·  on the watchlist' : '  ·  early find');
    body.appendChild(sub);

    var kv = document.createElement('dl');
    kv.className = 'kv';
    [
      ['Rank', '#' + r.rank + ' of ' + rows.length],
      ['Implied value', fmtUsd(r.implied_value_usd)],
      ['TVL', fmtUsd(r.tvl_usd)],
      ['7-day change', fmtPct(r.change_7d)],
      ['Age', fmtAge(r.age_days)],
      ['Category', r.category || 'Uncategorized'],
      ['Chains', r.chains.join(', ') || 'n/a'],
      ['Token', 'none recorded'],
    ].forEach(function (pair) {
      var dt = document.createElement('dt');
      dt.textContent = pair[0];
      var dd = document.createElement('dd');
      dd.textContent = pair[1];
      kv.appendChild(dt);
      kv.appendChild(dd);
    });
    body.appendChild(kv);

    var mh = document.createElement('h3');
    mh.textContent = 'How the value is built';
    body.appendChild(mh);
    var mkv = document.createElement('dl');
    mkv.className = 'kv';
    [
      ['Base (TVL x 0.25)', fmtUsd(r.tvl_usd * model.base_multiple)],
      ['Growth x' + r.growth_multiplier.toFixed(4), fmtPct(r.change_7d)],
      ['Maturity x' + r.maturity_multiplier.toFixed(4), fmtAge(r.age_days)],
      ['Breadth x' + r.breadth_multiplier.toFixed(4), r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's')],
      ['Category x' + r.category_multiplier.toFixed(4), r.category || 'Uncategorized'],
    ].forEach(function (pair) {
      var dt = document.createElement('dt');
      dt.textContent = pair[0];
      var dd = document.createElement('dd');
      dd.textContent = pair[1];
      mkv.appendChild(dt);
      mkv.appendChild(dd);
    });
    body.appendChild(mkv);
    var recomputed = impliedOf(r);
    var diff = Math.abs(recomputed - r.implied_value_usd) / r.implied_value_usd;
    var check = document.createElement('p');
    check.className = 'check-line';
    check.textContent = diff <= 0.01
      ? 'Page check: recomputed ' + fmtUsd(recomputed) + ' — agrees with the board.'
      : 'Page check: recomputed ' + fmtUsd(recomputed) + ' — differs from the board by ' + (diff * 100).toFixed(1) + '%.';
    body.appendChild(check);

    var fh = document.createElement('h3');
    fh.textContent = 'Farm plan — six steps';
    body.appendChild(fh);
    var ol = document.createElement('ol');
    ol.className = 'steps';
    r.farm_steps.forEach(function (s) {
      var li = document.createElement('li');
      li.textContent = s;
      ol.appendChild(li);
    });
    body.appendChild(ol);

    $('detail').hidden = false;
  }

  function closeDetail() {
    state.selected = null;
    $('detail').hidden = true;
    renderBoard();
  }

  init();
})();
