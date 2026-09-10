/* アプリ本体（状態管理と画面の取りまとめ） */
(function () {
  'use strict';

  var T = window.DiaTime, Line = window.DiaLine, Sch = window.DiaSchedule,
      Op = window.DiaOperation, Val = window.DiaValidate, Ex = window.DiaExport,
      Dis = window.DiaDisrupt, Crew = window.DiaCrew, Mon = window.DiaMonitor,
      Views = window.DiaViews, Editors = window.DiaEditors;
  var h = Views.h;
  var STORAGE = 'dia-editor-state-v1';

  var state = load() || fresh();
  var derived = { trains: [], duties: [], dutyOf: new Map(), crew: [], crewOf: new Map(),
                  crewParams: null, issues: [], notes: [] };
  var view = { pxPerMin: 4, pxPerKm: 26, yMode: 'km', hidden: {}, t0: null, t1: null, glow: true };
  var ui = { tab: 'diagram', ttDir: 'down', ttHour: null, ttArr: false, boardSt: 0, boardDir: 'down',
             checkLevel: { error: true, warn: true, info: true }, selected: null, crewSel: null };

  var dg = window.DiaDiagram.create(document.getElementById('dg'));
  var mon = Mon.create(document.getElementById('mon'));
  var play = { on: false, t: null, speed: 60, raf: null, last: 0, built: false };
  dg.onSelect = function (train) { selectTrain(train.no); };

  function fresh() {
    var line = Line.defaultLine();
    return { line: line, types: Line.defaultTypes(), patterns: Line.defaultPatterns(line), params: Line.defaultParams() };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.line) return null;
      var d = Line.defaultParams();
      for (var k in d) if (o.params[k] === undefined) o.params[k] = d[k];
      var recolor = { '#2563eb': '#49a8ff', '#dc2626': '#ff6b5e' };
      (o.types || []).forEach(function (t) { if (recolor[t.color]) t.color = recolor[t.color]; });
      return o;
    } catch (e) { return null; }
  }
  function save() {
    try { localStorage.setItem(STORAGE, JSON.stringify(state)); } catch (e) {}
  }

  /* ---------- 生成 ---------- */
  function build() {
    Line.normalize(state.line);
    var r = Sch.buildTimetable(state);
    derived.trains = r.trains;
    derived.notes = r.notes;
    var a = Op.assignDuties(state.line, derived.trains, state.params);
    derived.duties = a.duties;
    derived.dutyOf = a.dutyOf;
    var c = Crew.buildCrewDuties(state.line, derived.trains, derived.duties, state.params);
    derived.crew = c.duties;
    derived.crewOf = c.crewOf;
    derived.crewParams = c.params;
    derived.issues = Val.validate(state.line, derived.trains, derived.duties, state.params, derived.crew);
    view.overlay = null;
    view.sweep = true;
    play.built = false;
    save();
    renderChips();
    renderAll();
  }

  function renderChips() {
    var s = Sch.stats(state.line, derived.trains, derived.duties);
    var sum = Val.summarize(derived.issues);
    var box = document.getElementById('chips');
    box.innerHTML = '';
    var items = [
      ['列車', s.total + ' 本', ''],
      ['下り/上り', s.down + ' / ' + s.up, ''],
      ['必要編成', (s.sets != null ? s.sets : '-') + ' 本', ''],
      ['仕業', derived.crew.length + ' 行路', ''],
      ['営業キロ', s.km.toFixed(1) + ' km', ''],
      ['最速/最遅', T.fmtDuration(s.minRide) + ' / ' + T.fmtDuration(s.maxRide), ''],
      ['表定速度', s.bestSpeed + ' km/h', ''],
      ['始発/終着', (s.firstDep != null ? T.fmtTime(s.firstDep) : '-') + ' / ' + (s.lastArr != null ? T.fmtTime(s.lastArr) : '-'), ''],
      ['支障', sum.error + ' 件', 'live' + (sum.error ? ' bad err' : ' ok')]
    ];
    items.forEach(function (it) {
      box.appendChild(h('span', { class: 'chip ' + it[2] }, [
        document.createTextNode(it[0] + ' '), h('b', { text: String(it[1]) })
      ]));
    });
    document.getElementById('ttl-line').textContent = state.line.name;
    document.getElementById('ttl-company').textContent = state.line.company;
  }

  /* ---------- 各ビュー ---------- */
  function renderAll() {
    if (ui.tab === 'diagram') renderDiagram();
    if (ui.tab === 'timetable') renderTimetable();
    if (ui.tab === 'monitor') renderMonitor();
    if (ui.tab === 'duty') renderDuty();
    if (ui.tab === 'crew') renderCrew();
    if (ui.tab === 'check') renderCheck();
    if (ui.tab === 'disrupt') renderDisrupt();
    if (ui.tab === 'line') mount('ed-line', Editors.lineEditor(state, onEdit));
    if (ui.tab === 'dia') {
      mount('ed-type', Editors.typeEditor(state, onEdit));
      mount('ed-pattern', Editors.patternEditor(state, onEdit));
      mount('ed-param', Editors.paramEditor(state, onEdit));
    }
    if (ui.tab === 'export') mount('ex-list', trainListTable());
  }

  function onEdit(structural) {
    build();
    if (structural) renderAll();
  }

  function mount(id, node) {
    var host = document.getElementById(id);
    host.innerHTML = '';
    host.appendChild(node);
  }

  function renderDiagram() {
    dg.render({ line: state.line, trains: derived.trains, types: state.types }, view);
    view.sweep = false;
    if (play.t != null) dg.showNow(play.t, liveTrains(), lateMap());
    var lg = document.getElementById('legend');
    lg.innerHTML = '';
    state.types.forEach(function (ty) {
      lg.appendChild(h('span', {}, [
        h('i', { style: 'border-color:' + ty.color }), document.createTextNode(ty.name)
      ]));
    });
    lg.appendChild(h('span', { text: '● 待避・抑止', style: 'color:var(--warn)' }));
    lg.appendChild(h('span', { text: '太字の駅名＝折返し可　橙点＝待避可　橙帯＝単線区間' }));
    if (derived.notes.length) lg.appendChild(h('span', { class: 'notes', text: derived.notes.join(' / ') }));
    if (ui.selected) selectTrain(ui.selected, true);
  }

  function renderTimetable() {
    // 時間帯セレクタ
    var hourSel = document.getElementById('tt-hour');
    if (!hourSel.options.length || hourSel.dataset.n !== String(derived.trains.length)) {
      var hours = {};
      derived.trains.forEach(function (t) {
        for (var x = Math.floor(t.depTime / 3600); x <= Math.floor(t.arrTime / 3600); x++) hours[x] = true;
      });
      hourSel.innerHTML = '';
      hourSel.appendChild(h('option', { value: '', text: '終日' }));
      Object.keys(hours).map(Number).sort(function (a, b) { return a - b; }).forEach(function (x) {
        hourSel.appendChild(h('option', { value: String(x), text: (x % 24) + '時台' + (x >= 24 ? '(翌)' : '') }));
      });
      hourSel.dataset.n = String(derived.trains.length);
      hourSel.value = ui.ttHour == null ? '' : String(ui.ttHour);
    }
    mount('tt-grid', Views.stationGrid(
      { line: state.line, trains: derived.trains, types: state.types },
      { dir: ui.ttDir, hidden: view.hidden, hour: ui.ttHour, showArr: ui.ttArr },
      function (no) { selectTrain(no); showSheet(no); }
    ));

    var stSel = document.getElementById('board-st');
    if (stSel.options.length !== state.line.stations.length) {
      stSel.innerHTML = '';
      state.line.stations.forEach(function (s, i) { stSel.appendChild(h('option', { value: String(i), text: s.name })); });
      stSel.value = String(Math.min(ui.boardSt, state.line.stations.length - 1));
    }
    if (!ui.selected) document.getElementById('tt-sheet').style.display = 'none';
    document.getElementById('board-out').textContent =
      Ex.departureBoardText(state.line, derived.trains, state.types, ui.boardSt, ui.boardDir);
    if (ui.selected) showSheet(ui.selected);
  }

  function showSheet(no) {
    var tr = findTrain(no);
    var host = document.getElementById('tt-sheet');
    if (!tr) { host.style.display = 'none'; return; }
    host.style.display = '';
    mount('tt-sheet', Views.trainSheet(state, tr, derived.dutyOf.get(tr), derived.crewOf.get(tr)));
  }

  function renderDuty() {
    var needs = Op.depotNeeds(state.line, derived.duties);
    var prof = Op.occupancyProfile(derived.trains, 900);
    var peak = prof.length ? Math.max.apply(null, prof.map(function (p) { return p.n; })) : 0;
    var sum = document.getElementById('duty-sum');
    sum.innerHTML = '';
    [['運用数（必要編成数）', derived.duties.length + ' 本'],
     ['在線本数のピーク', peak + ' 本'],
     ['回送を要する出入庫', needs.length + ' 件'],
     ['1運用あたり平均列車数', derived.duties.length ? (derived.trains.length / derived.duties.length).toFixed(1) + ' 本' : '-']
    ].forEach(function (it) {
      sum.appendChild(h('span', { class: 'chip' }, [document.createTextNode(it[0] + ' '), h('b', { text: it[1] })]));
    });
    mount('duty-gantt', Views.dutyGantt({ line: state.line, types: state.types }, derived.duties, function (no) {
      selectTrain(no); switchTab('diagram');
    }));
    mount('duty-table', Views.dutyTable(state, derived.duties));
  }

  /* ---------- 運行モニタ ---------- */
  function timeSpan() {
    if (!derived.trains.length) return [18000, 90000];
    var a = derived.trains[0].depTime;
    var b = Math.max.apply(null, derived.trains.map(function (t) { return t.arrTime; }));
    return [a - 300, b + 300];
  }

  function liveTrains() {
    return derived.sim ? derived.sim.trains : derived.trains;
  }

  function lateMap() {
    var m = {};
    if (derived.sim) derived.sim.delays.forEach(function (d) { m[d.no] = d.delay; });
    return m;
  }

  function renderMonitor() {
    if (!play.built) {
      mon.build(state);
      play.built = true;
      var sp = timeSpan();
      var sl = document.getElementById('pl-time');
      sl.min = sp[0]; sl.max = sp[1];
      if (play.t == null) play.t = sp[0];
      sl.value = play.t;
    }
    paintClock();
    var n = mon.update(play.t, liveTrains(), lateMap());
    document.getElementById('pl-online').textContent = n || 0;
    document.getElementById('pl-late').textContent = Object.keys(lateMap()).length;
    renderBoards();
  }

  function paintClock() {
    var c = document.getElementById('clock');
    var parts = T.fmtTime(play.t, true).split(':');
    c.innerHTML = '';
    c.appendChild(document.createTextNode(parts[0] + ':' + parts[1]));
    c.appendChild(h('small', { text: ':' + parts[2] }));
    var tag = document.getElementById('clock-tag');
    tag.textContent = play.on ? '運転中 ×' + play.speed : '停止中';
    tag.classList.toggle('on', play.on);
    document.getElementById('pl-play').textContent = play.on ? '❚❚ 一時停止' : '▶ 運転開始';
    var hc = document.getElementById('hdr-clock');
    hc.hidden = !play.on;
    document.getElementById('hdr-time').textContent = T.fmtTime(play.t);
  }

  function renderBoards() {
    var host = document.getElementById('mon-next');
    var picks = [];
    state.line.stations.forEach(function (st, i) {
      if (st.depot || st.canTurn || st.crewBase) picks.push(i);
    });
    picks = picks.slice(0, 4);
    host.innerHTML = '';
    picks.forEach(function (idx) {
      ['down', 'up'].forEach(function (dir) {
        var list = Sch.nextDepartures(state.line, liveTrains(), idx, dir, play.t, 3);
        if (!list.length) return;
        var box = h('div', { class: 'board' }, [
          h('h3', { text: state.line.stations[idx].name + '　' + (dir === 'down' ? '下り' : '上り') })
        ]);
        list.forEach(function (e) {
          var ty = Views.typeOf(state.types, e.train.typeId);
          var wait = e.dep - play.t;
          box.appendChild(h('div', { class: 'brow' }, [
            h('b', { text: T.fmtTime(e.dep) }),
            h('span', { class: 'pill', style: 'background:' + ty.color, text: ty.short || ty.name }),
            h('span', { text: state.line.stations[e.train.toIdx].name }),
            h('span', { class: 't' + (wait < 120 ? ' soon' : ''),
              text: wait < 60 ? 'まもなく' : 'あと ' + Math.round(wait / 60) + '分' })
          ]));
        });
        host.appendChild(box);
      });
    });
  }

  function tick(ts) {
    if (!play.on) return;
    var dt = play.last ? (ts - play.last) / 1000 : 0;
    play.last = ts;
    var sp = timeSpan();
    play.t += dt * play.speed;
    if (play.t > sp[1]) { play.t = sp[0]; }
    document.getElementById('pl-time').value = play.t;
    if (ui.tab === 'monitor') renderMonitor();
    else document.getElementById('hdr-time').textContent = T.fmtTime(play.t);
    if (ui.tab === 'diagram') {
      dg.showNow(play.t, liveTrains(), lateMap());
      dg.followTime(play.t);
    }
    play.raf = requestAnimationFrame(tick);
  }

  function setPlaying(on) {
    play.on = on;
    play.last = 0;
    if (on) {
      if (play.t == null) play.t = timeSpan()[0];
      play.raf = requestAnimationFrame(tick);
    } else if (play.raf) {
      cancelAnimationFrame(play.raf);
      play.raf = null;
    }
    paintClock();
  }

  function renderCrew() {
    var st = Crew.crewStats(derived.crew, derived.crewParams);
    var sum = document.getElementById('crew-sum');
    sum.innerHTML = '';
    var kinds = Object.keys(st.byKind || {}).map(function (k) { return k + ' ' + st.byKind[k]; }).join('・');
    [['仕業数', st.count + ' 行路'],
     ['区分', kinds || '-'],
     ['平均拘束', T.fmtHM(st.avgSpread || 0)],
     ['平均実乗務', T.fmtHM(st.avgDrive || 0)],
     ['最長拘束', T.fmtHM(st.maxSpread || 0)],
     ['乗務効率', (st.efficiency || 0) + ' %'],
     ['休憩のある仕業', (st.withBreak || 0) + ' / ' + st.count]
    ].forEach(function (it) {
      sum.appendChild(h('span', { class: 'chip' }, [document.createTextNode(it[0] + ' '), h('b', { text: String(it[1]) })]));
    });
    if (st.warned) {
      sum.appendChild(h('span', { class: 'chip err' }, [document.createTextNode('要注意 '), h('b', { text: st.warned + ' 行路' })]));
    }
    mount('crew-params', Editors.crewParamEditor(state, onEdit));
    mount('crew-gantt', Views.crewGantt(state, derived.crew, showCrew));
    mount('crew-table', Views.crewTable(state, derived.crew, showCrew));
    if (ui.crewSel != null) showCrew(ui.crewSel); else document.getElementById('crew-sheet').style.display = 'none';
  }

  function findCrew(no) {
    for (var i = 0; i < derived.crew.length; i++) if (derived.crew[i].no === no) return derived.crew[i];
    return null;
  }

  function showCrew(no) {
    var d = findCrew(no);
    var host = document.getElementById('crew-sheet');
    if (!d) { host.style.display = 'none'; ui.crewSel = null; return; }
    ui.crewSel = no;
    host.style.display = '';
    mount('crew-sheet', Views.crewSheet(state, d));
  }

  function renderCheck() {
    var sum = Val.summarize(derived.issues);
    var f = document.getElementById('check-filter');
    f.innerHTML = '';
    [['error', '支障', sum.error], ['warn', '注意', sum.warn], ['info', '情報', sum.info]].forEach(function (it) {
      var b = h('button', { text: it[1] + ' ' + it[2] + ' 件', onclick: function () {
        ui.checkLevel[it[0]] = !ui.checkLevel[it[0]]; renderCheck();
      } });
      b.style.opacity = ui.checkLevel[it[0]] ? '1' : '.45';
      f.appendChild(b);
    });
    if (derived.notes.length) f.appendChild(h('span', { class: 'notes', text: derived.notes.join(' / ') }));
    var list = derived.issues.filter(function (i) { return ui.checkLevel[i.level]; });
    mount('check-list', Views.issueList(list, function (is) {
      switchTab('diagram');
      setTimeout(function () {
        dg.scrollToTime(is.time);
        if (is.trains && is.trains.length) { ui.selected = is.trains[0]; dg.setSelection(is.trains); }
      }, 30);
    }));
    var total = derived.issues.length;
    if (!list.length && total) mount('check-list', h('div', { class: 'hint', text: 'フィルタで隠れているよ（全 ' + total + ' 件）' }));
  }

  function renderDisrupt() {
    var sel = document.getElementById('ds-train');
    if (sel.dataset.n !== String(derived.trains.length)) {
      var keep = sel.value;
      sel.innerHTML = '';
      derived.trains.slice().sort(function (a, b) { return a.depTime - b.depTime; }).forEach(function (t) {
        var ty = Views.typeOf(state.types, t.typeId);
        sel.appendChild(h('option', { value: String(t.no),
          text: t.no + '列車 ' + (ty.short || ty.name) + ' ' + T.fmtTime(t.depTime) + ' ' +
                state.line.stations[t.fromIdx].name + '→' + state.line.stations[t.toIdx].name }));
      });
      sel.dataset.n = String(derived.trains.length);
      if (keep) sel.value = keep;
    }
    var res = derived.sim;
    var sum = document.getElementById('ds-sum');
    sum.innerHTML = '';
    if (!res) {
      mount('ds-list', h('div', { class: 'hint', text: '対象列車と遅延分を決めて「波及を計算」を押してね' }));
      return;
    }
    [['与えた遅延', T.fmtDuration(res.stats.given)],
     ['波及した列車', res.stats.affected + ' 本'],
     ['最大遅延', T.fmtDuration(res.stats.maxDelay)],
     ['遅延の総和', res.stats.totalDelayMin + ' 分'],
     ['影響の終わり', T.fmtTime(res.stats.lastAffectedArr)]
    ].forEach(function (it) {
      sum.appendChild(h('span', { class: 'chip' }, [document.createTextNode(it[0] + ' '), h('b', { text: it[1] })]));
    });

    mount('ds-list', h('div', { class: 'tbl-wrap', style: 'max-height:56vh' }, [
      h('table', {}, [
        h('thead', {}, [h('tr', {}, ['列車', '種別', '方向', '計画発', '遅延', '終着の遅れ', '運用'].map(function (t) {
          return h('th', { text: t });
        }))]),
        h('tbody', {}, res.delays.map(function (d) {
          var base = findTrain(d.no), ty = Views.typeOf(state.types, base.typeId);
          var du = derived.dutyOf.get(base);
          return h('tr', { onclick: function () { selectTrain(d.no); switchTab('diagram'); } }, [
            h('td', { class: 'num', style: 'color:' + ty.color + ';font-weight:700', text: String(d.no) }),
            h('td', { text: ty.short || ty.name }),
            h('td', { text: base.dir === 'down' ? '下り' : '上り' }),
            h('td', { class: 'num', text: T.fmtTime(base.depTime) }),
            h('td', { class: 'num', style: 'color:var(--warn);font-weight:700', text: T.fmtDuration(d.delay) }),
            h('td', { class: 'num', text: T.fmtDuration(d.arrDelay) }),
            h('td', { class: 'num', text: du ? String(du.no) : '' })
          ]);
        }))
      ])
    ]));
  }

  function trainListTable() {
    var rows = derived.trains.slice().sort(function (a, b) { return a.depTime - b.depTime; }).map(function (t) {
      var ty = Views.typeOf(state.types, t.typeId), d = derived.dutyOf.get(t);
      return h('tr', { onclick: function () { selectTrain(t.no); switchTab('diagram'); } }, [
        h('td', { class: 'num', style: 'color:' + ty.color + ';font-weight:700', text: String(t.no) }),
        h('td', { text: ty.short || ty.name }),
        h('td', { text: t.dir === 'down' ? '下り' : '上り' }),
        h('td', { text: state.line.stations[t.fromIdx].name }),
        h('td', { class: 'num', text: T.fmtTime(t.depTime) }),
        h('td', { text: state.line.stations[t.toIdx].name }),
        h('td', { class: 'num', text: T.fmtTime(t.arrTime) }),
        h('td', { class: 'num', text: T.fmtDuration(t.arrTime - t.depTime) }),
        h('td', { class: 'num', text: d ? String(d.no) : '' }),
        h('td', { class: 'num', text: derived.crewOf.get(t) ? String(derived.crewOf.get(t).no) : '' })
      ]);
    });
    return h('div', { class: 'tbl-wrap', style: 'max-height:60vh' }, [
      h('table', {}, [
        h('thead', {}, [h('tr', {}, ['列車', '種別', '方向', '始発', '発', '終着', '着', '所要', '運用', '仕業'].map(function (t) {
          return h('th', { text: t });
        }))]),
        h('tbody', {}, rows)
      ])
    ]);
  }

  /* ---------- 選択 ---------- */
  function findTrain(no) {
    for (var i = 0; i < derived.trains.length; i++) if (derived.trains[i].no === no) return derived.trains[i];
    return null;
  }

  function selectTrain(no, quiet) {
    ui.selected = no;
    var tr = findTrain(no);
    if (!tr) return;
    var duty = derived.dutyOf.get(tr);
    var crew = derived.crewOf.get(tr);
    var nos = duty ? duty.trains.map(function (t) { return t.no; }) : [no];
    dg.setSelection(nos);

    var box = document.getElementById('dg-detail');
    box.innerHTML = '';
    box.appendChild(h('div', { class: 'row', style: 'margin-bottom:8px' }, [
      h('span', { class: 'hint', text: duty
        ? '運用 ' + duty.no + ' の ' + duty.trains.length + ' 本を強調表示中（' +
          state.line.stations[duty.startIdx].name + ' ' + T.fmtTime(duty.startTime) + ' 出庫 → ' +
          state.line.stations[duty.endIdx].name + ' ' + T.fmtTime(duty.endTime) + ' 入庫）'
        : '' }),
      crew ? h('button', { class: 'ghost', text: '仕業 ' + crew.no + ' を見る', onclick: function () {
        showCrew(crew.no); switchTab('crew');
      } }) : null,
      crew ? h('button', { class: 'ghost', text: '仕業のスジを強調', onclick: function () {
        dg.setSelection(crew.trains.map(function (t) { return t.no; }));
      } }) : null,
      h('button', { class: 'ghost', text: '選択解除', onclick: function () {
        ui.selected = null; dg.setSelection([]);
        box.innerHTML = '<span class="hint">スジをクリックすると列車の詳細と、その運用が強調表示されるよ</span>';
      } })
    ]));
    box.appendChild(Views.trainSheet(state, tr, duty, crew));
    if (!quiet) dg.scrollToTime(tr.depTime + (tr.arrTime - tr.depTime) / 2);
  }

  /* ---------- タブ ---------- */
  function switchTab(name) {
    ui.tab = name;
    var btns = document.querySelectorAll('#tabs button');
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-selected', String(btns[i].dataset.view === name));
    var vs = document.querySelectorAll('.view');
    for (var j = 0; j < vs.length; j++) vs[j].classList.toggle('active', vs[j].id === 'v-' + name);
    renderAll();
  }

  /* ---------- 入出力 ---------- */
  // 公開ページ（Artifact）ではブラウザのダウンロードが使えないため、
  // 保存用の機能が使えるならそちらへ、なければ通常のダウンロードへ渡す。
  var saver = { tried: false, cap: null };
  function withSaver() {
    if (saver.tried) return Promise.resolve(saver.cap);
    saver.tried = true;
    if (!window.claude || typeof window.claude.use !== 'function') return Promise.resolve(null);
    return window.claude.use('downloads').then(function (c) { saver.cap = c; return c; },
      function () { return null; });
  }

  function download(name, text, mime) {
    withSaver().then(function (cap) {
      if (!cap) return blobDownload(name, text, mime);
      cap.save({ filename: name, data: text }).catch(function (err) {
        if (err && err.code === 'declined') return;
        alert('保存できなかったよ: ' + ((err && err.message) || (err && err.code) || err));
      });
    });
  }

  function blobDownload(name, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  function csvDownload(name, text) { download(name, '﻿' + text, 'text/csv'); }

  /* ---------- イベント ---------- */
  document.getElementById('tabs').addEventListener('click', function (e) {
    if (e.target.dataset.view) switchTab(e.target.dataset.view);
  });
  document.getElementById('btn-build').addEventListener('click', build);
  document.getElementById('btn-save').addEventListener('click', function () {
    download((state.line.name || 'dia') + '.json', Ex.toJSON(state), 'application/json');
  });
  document.getElementById('btn-load').addEventListener('click', function () {
    document.getElementById('file-in').click();
  });
  document.getElementById('file-in').addEventListener('change', function (e) {
    var f = e.target.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var o = Ex.fromJSON(String(rd.result));
        state.line = o.line; state.types = o.types; state.patterns = o.patterns;
        state.params = Object.assign(Line.defaultParams(), o.params);
        ui.selected = null;
        build(); renderAll();
      } catch (err) { alert('読み込めなかったよ: ' + err.message); }
    };
    rd.readAsText(f);
    e.target.value = '';
  });
  document.getElementById('btn-reset').addEventListener('click', function () {
    if (!confirm('サンプルの線区設定に戻すよ。いい？')) return;
    var f = fresh();
    state.line = f.line; state.types = f.types; state.patterns = f.patterns; state.params = f.params;
    ui.selected = null;
    build(); renderAll();
  });
  document.getElementById('btn-theme').addEventListener('click', function () {
    var next = document.documentElement.getAttribute('data-theme') === 'light' ? '' : 'light';
    if (next) document.documentElement.setAttribute('data-theme', next);
    else document.documentElement.removeAttribute('data-theme');
    this.title = next === 'light' ? '暗い表示に戻す' : '明るい表示にする';
    try { localStorage.setItem('dia-theme', next); } catch (e) {}
  });

  // ダイヤグラム操作
  document.getElementById('zoom-x').addEventListener('input', function (e) {
    view.pxPerMin = parseFloat(e.target.value);
    document.getElementById('zoom-x-v').textContent = view.pxPerMin + ' px/分';
    renderDiagram();
  });
  document.getElementById('zoom-y').addEventListener('input', function (e) {
    view.pxPerKm = parseFloat(e.target.value);
    document.getElementById('zoom-y-v').textContent = view.pxPerKm + ' px/km';
    renderDiagram();
  });
  document.getElementById('ymode').addEventListener('change', function (e) {
    view.yMode = e.target.value; renderDiagram();
  });
  document.getElementById('glow').addEventListener('change', function (e) {
    view.glow = e.target.checked; renderDiagram();
  });
  document.getElementById('range-from').addEventListener('change', applyRange);
  document.getElementById('range-to').addEventListener('change', applyRange);
  document.getElementById('range-all').addEventListener('click', function () {
    view.t0 = view.t1 = null;
    document.getElementById('range-from').value = '';
    document.getElementById('range-to').value = '';
    renderDiagram();
  });
  function applyRange() {
    var a = T.parseTime(document.getElementById('range-from').value);
    var b = T.parseTime(document.getElementById('range-to').value);
    if (a != null && b != null && b > a) { view.t0 = a; view.t1 = b; } else { view.t0 = view.t1 = null; }
    renderDiagram();
  }

  function renderTypeFilter() {
    var box = document.getElementById('type-filter');
    box.innerHTML = '';
    state.types.forEach(function (ty) {
      var lb = h('label', { class: 'f', style: 'color:' + ty.color }, []);
      var c = h('input', { type: 'checkbox', onchange: function (e) {
        view.hidden[ty.id] = !e.target.checked; renderDiagram();
      } });
      c.checked = !view.hidden[ty.id];
      lb.appendChild(c); lb.appendChild(document.createTextNode(ty.short || ty.name));
      box.appendChild(lb);
    });
  }

  // 時刻表操作
  document.getElementById('tt-dir').addEventListener('change', function (e) { ui.ttDir = e.target.value; renderTimetable(); });
  document.getElementById('tt-hour').addEventListener('change', function (e) {
    ui.ttHour = e.target.value === '' ? null : parseInt(e.target.value, 10); renderTimetable();
  });
  document.getElementById('tt-arr').addEventListener('change', function (e) { ui.ttArr = e.target.checked; renderTimetable(); });
  document.getElementById('board-st').addEventListener('change', function (e) { ui.boardSt = parseInt(e.target.value, 10); renderTimetable(); });
  document.getElementById('board-dir').addEventListener('change', function (e) { ui.boardDir = e.target.value; renderTimetable(); });

  // 運行モニタ
  document.getElementById('pl-play').addEventListener('click', function () { setPlaying(!play.on); });
  document.getElementById('pl-reset').addEventListener('click', function () {
    play.t = timeSpan()[0];
    document.getElementById('pl-time').value = play.t;
    renderMonitor();
    if (ui.tab === 'diagram') { dg.showNow(play.t, liveTrains(), lateMap()); dg.followTime(play.t); }
  });
  document.getElementById('pl-speed').addEventListener('change', function (e) {
    play.speed = parseInt(e.target.value, 10) || 60; paintClock();
  });
  document.getElementById('pl-time').addEventListener('input', function (e) {
    play.t = parseFloat(e.target.value);
    if (ui.tab === 'monitor') renderMonitor();
    if (ui.tab === 'diagram') { dg.showNow(play.t, liveTrains(), lateMap()); dg.followTime(play.t); }
  });

  // 在線中の列車に遅延を与えて波及を見せる
  document.getElementById('pl-delay').addEventListener('click', function () {
    var online = Sch.onlineAt(state.line, derived.trains, play.t);
    if (!online.length) { alert('いま在線している列車がないよ'); return; }
    var pick = online[Math.floor(online.length / 2)];
    derived.sim = Dis.simulate(state.line, derived.trains, derived.duties, state.params,
      pick.train.no, 300, pick.pos.next);
    view.overlay = derived.sim ? { trains: derived.sim.trains, delays: derived.sim.delays } : null;
    document.getElementById('pl-clear').hidden = false;
    renderMonitor();
    if (ui.tab === 'diagram') renderDiagram();
  });
  document.getElementById('pl-clear').addEventListener('click', function () {
    derived.sim = null; view.overlay = null;
    this.hidden = true;
    renderMonitor();
    if (ui.tab === 'diagram') renderDiagram();
  });

  // 運転整理
  document.getElementById('ds-run').addEventListener('click', function () {
    var no = parseInt(document.getElementById('ds-train').value, 10);
    var min = parseFloat(document.getElementById('ds-delay').value) || 1;
    if (!no) return;
    derived.sim = Dis.simulate(state.line, derived.trains, derived.duties, state.params, no, Math.round(min * 60));
    view.overlay = derived.sim ? { trains: derived.sim.trains, delays: derived.sim.delays } : null;
    document.getElementById('pl-clear').hidden = false;
    renderDisrupt();
  });
  document.getElementById('ds-clear').addEventListener('click', function () {
    derived.sim = null; view.overlay = null;
    document.getElementById('pl-clear').hidden = true;
    renderDisrupt();
  });

  // 出力
  document.querySelectorAll('[data-ex]').forEach(function (b) {
    b.addEventListener('click', function () {
      var base = state.line.name || 'dia';
      switch (b.dataset.ex) {
        case 'json': download(base + '.json', Ex.toJSON(state), 'application/json'); break;
        case 'grid-down': csvDownload(base + '_時刻表_下り.csv', Ex.stationGridCSV(state.line, derived.trains, state.types, 'down')); break;
        case 'grid-up': csvDownload(base + '_時刻表_上り.csv', Ex.stationGridCSV(state.line, derived.trains, state.types, 'up')); break;
        case 'trains': csvDownload(base + '_列車一覧.csv', Ex.trainListCSV(state.line, derived.trains, state.types, derived.dutyOf)); break;
        case 'duties': csvDownload(base + '_運用.csv', Ex.dutyCSV(state.line, derived.duties)); break;
        case 'crew': csvDownload(base + '_仕業.csv', Ex.crewCSV(state.line, derived.crew)); break;
        case 'crew-sheet': {
          var cd = ui.crewSel != null ? findCrew(ui.crewSel) : derived.crew[0];
          if (!cd) { alert('先に仕業を選んでね'); return; }
          download(base + '_仕業' + cd.no + '_行路表.txt', Ex.crewSheetText(state.line, cd, state.types));
          break;
        }
        case 'svg': {
          if (!dg.svg) { alert('先にダイヤグラムを表示してね'); return; }
          var clone = dg.svg.cloneNode(true);
          clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
          var css = '.train-line{fill:none;stroke-width:1.3}.st-line{stroke:#ccc}.tick{stroke:#eee}' +
                    '.tick.hour{stroke:#bbb}.axis-text{font-size:10px;fill:#666}.train-hit{display:none}' +
                    '.single-band{fill:#fde68a}.hold-dot{fill:#b45309}';
          var st = document.createElementNS('http://www.w3.org/2000/svg', 'style');
          st.textContent = css;
          clone.insertBefore(st, clone.firstChild);
          download(base + '_ダイヤグラム.svg', new XMLSerializer().serializeToString(clone), 'image/svg+xml');
          break;
        }
      }
    });
  });

  // 起動演出
  (function boot() {
    var box = document.getElementById('boot');
    if (!box) return;
    var log = document.getElementById('boot-log');
    var msgs = ['線区諸元を読み込み中…', 'パターンダイヤを生成中…', '待避・折返しを検査中…', '車両運用・仕業を組成中…', 'SYSTEM ONLINE'];
    var i = 0;
    var iv = setInterval(function () {
      i++;
      if (log && msgs[i]) log.textContent = msgs[i];
      if (i >= msgs.length - 1) clearInterval(iv);
    }, 280);
    var close = function () { clearInterval(iv); box.classList.add('done'); };
    setTimeout(close, 1650);
    box.addEventListener('click', close);
  })();

  // 起動
  try {
    var th = localStorage.getItem('dia-theme');
    if (th) document.documentElement.setAttribute('data-theme', th);
  } catch (e) {}
  renderTypeFilter();
  build();
  switchTab('diagram');
})();
