/* 設定エディタ（線区諸元・種別・時間帯パターン・計算パラメータ） */
(function (root) {
  'use strict';

  var T = root.DiaTime, Line = root.DiaLine, V = root.DiaViews;
  var h = V.h;

  function num(value, on, opts) {
    return h('input', Object.assign({ type: 'number', value: value, oninput: on }, opts || {}));
  }
  function chk(value, on) {
    var e = h('input', { type: 'checkbox', onchange: on });
    e.checked = !!value;
    return e;
  }

  /* ---------- 線区諸元 ---------- */
  function lineEditor(state, changed) {
    var line = state.line;
    var rows = line.stations.map(function (st, i) {
      var sec = i < line.sections.length ? line.sections[i] : null;
      return h('tr', {}, [
        h('td', { class: 'num', text: String(i + 1) }),
        h('td', {}, [h('input', { type: 'text', value: st.name, style: 'min-width:96px',
          oninput: function (e) { st.name = e.target.value; changed(true); } })]),
        h('td', {}, [num(st.km, function (e) { st.km = parseFloat(e.target.value) || 0; changed(); }, { step: '0.1', style: 'width:64px' })]),
        h('td', {}, [num(st.dwell, function (e) { st.dwell = parseInt(e.target.value, 10) || 0; changed(); }, { step: 5, min: 0, style: 'width:60px' })]),
        h('td', { class: 'num' }, [chk(st.canTurn, function (e) { st.canTurn = e.target.checked; changed(); })]),
        h('td', { class: 'num' }, [chk(st.canOvertake, function (e) { st.canOvertake = e.target.checked; changed(); })]),
        h('td', { class: 'num' }, [chk(st.depot, function (e) { st.depot = e.target.checked; changed(); })]),
        h('td', {}, sec ? [num(sec.runSec, function (e) { sec.runSec = parseInt(e.target.value, 10) || 60; changed(); }, { step: 5, min: 30, style: 'width:64px' })] : []),
        h('td', { class: 'num' }, sec ? [chk(sec.single, function (e) { sec.single = e.target.checked; changed(); })] : []),
        h('td', { class: 'num', style: 'color:var(--ink-mute)',
          text: sec ? (Line.sectionKm(line, i).toFixed(1) + 'km') : '' }),
        h('td', {}, [
          h('button', { class: 'ghost', title: 'この下に駅を挿入', text: '＋', onclick: function () { insertStation(line, i); changed(true); } }),
          h('button', { class: 'ghost', title: 'この駅を削除', text: '×', onclick: function () {
            if (line.stations.length <= 3) { alert('駅は 3 以上必要だよ'); return; }
            line.stations.splice(i, 1); line.sections.splice(Math.min(i, line.sections.length - 1), 1);
            Line.normalize(line); changed(true);
          } })
        ])
      ]);
    });

    var head = ['#', '駅名', 'キロ程', '停車(秒)', '折返', '待避', '車庫', '次駅まで(秒)', '単線', '区間長', ''];
    return h('div', {}, [
      h('div', { class: 'row', style: 'margin-bottom:8px' }, [
        h('label', { class: 'f' }, [document.createTextNode('線名'),
          h('input', { type: 'text', value: line.name, oninput: function (e) { line.name = e.target.value; changed(true); } })]),
        h('label', { class: 'f' }, [document.createTextNode('事業者'),
          h('input', { type: 'text', value: line.company, oninput: function (e) { line.company = e.target.value; changed(true); } })]),
        h('span', { class: 'hint', text: line.stations.length + '駅 / ' + Line.totalKm(line).toFixed(1) + 'km' })
      ]),
      h('div', { class: 'tbl-wrap', style: 'max-height:60vh' }, [
        h('table', {}, [
          h('thead', {}, [h('tr', {}, head.map(function (t) { return h('th', { text: t }); }))]),
          h('tbody', {}, rows)
        ])
      ]),
      h('div', { class: 'hint', style: 'margin-top:6px',
        text: '「次駅まで(秒)」は両端とも停車する列車の基準運転時分。通過する列車は片端あたり ' +
              state.params.passSave + ' 秒短縮されるよ。' })
    ]);
  }

  function insertStation(line, i) {
    var a = line.stations[i], b = line.stations[i + 1];
    var km = b ? Math.round((a.km + b.km) / 2 * 10) / 10 : Math.round((a.km + 1) * 10) / 10;
    line.stations.splice(i + 1, 0, {
      id: 'S' + Date.now().toString(36).slice(-5),
      name: '新駅', kana: '', km: km, dwell: 20, canTurn: false, canOvertake: false, depot: false
    });
    line.sections.splice(i + 1, 0, { runSec: 100, single: false });
    Line.normalize(line);
  }

  /* ---------- 種別 ---------- */
  function typeEditor(state, changed) {
    var line = state.line;
    var head = ['種別', '略称', '色', '号数帯', '停車駅（チェック＝停車）'];
    var rows = state.types.map(function (ty, ti) {
      var skips = {}; (ty.skips || []).forEach(function (s) { skips[s] = true; });
      var stops = h('div', { class: 'row tight', style: 'flex-wrap:wrap' }, line.stations.map(function (st) {
        var box = h('label', { class: 'f', style: 'font-size:11px;color:var(--ink)' }, []);
        var c = h('input', { type: 'checkbox', onchange: function (e) {
          ty.skips = ty.skips || [];
          if (e.target.checked) ty.skips = ty.skips.filter(function (x) { return x !== st.id; });
          else if (ty.skips.indexOf(st.id) < 0) ty.skips.push(st.id);
          changed();
        } });
        c.checked = !skips[st.id];
        box.appendChild(c); box.appendChild(document.createTextNode(st.name));
        return box;
      }));
      return h('tr', {}, [
        h('td', {}, [h('input', { type: 'text', value: ty.name, style: 'width:88px',
          oninput: function (e) { ty.name = e.target.value; changed(true); } })]),
        h('td', {}, [h('input', { type: 'text', value: ty.short || '', style: 'width:52px',
          oninput: function (e) { ty.short = e.target.value; changed(true); } })]),
        h('td', {}, [h('input', { type: 'color', value: ty.color, style: 'width:40px;padding:0;height:24px',
          oninput: function (e) { ty.color = e.target.value; changed(true); } })]),
        h('td', {}, [num(ty.numberBase || 0, function (e) { ty.numberBase = parseInt(e.target.value, 10) || 0; changed(); }, { step: 100, style: 'width:72px' })]),
        h('td', { style: 'white-space:normal' }, [stops])
      ]);
    });
    return h('div', { class: 'tbl-wrap' }, [
      h('table', {}, [
        h('thead', {}, [h('tr', {}, head.map(function (t) { return h('th', { text: t }); }))]),
        h('tbody', {}, rows)
      ])
    ]);
  }

  /* ---------- 時間帯パターン ---------- */
  function patternEditor(state, changed) {
    var line = state.line;
    var rows = state.patterns.map(function (p, pi) {
      var cycle = h('div', { class: 'row tight', style: 'flex-wrap:wrap' },
        (p.cycle || []).map(function (c, ci) {
          return h('span', { class: 'row tight', style: 'gap:2px;border:1px solid var(--line);border-radius:5px;padding:2px 4px' }, [
            sel(state.types.map(function (t) { return [t.id, t.short || t.name]; }), c.type, function (v) { c.type = v; changed(); }),
            sel(line.stations.map(function (s) { return [s.id, s.name]; }), c.from, function (v) { c.from = v; changed(); }),
            h('span', { class: 'hint', text: '⇄' }),
            sel(line.stations.map(function (s) { return [s.id, s.name]; }), c.to, function (v) { c.to = v; changed(); }),
            h('button', { class: 'ghost', text: '×', onclick: function () { p.cycle.splice(ci, 1); changed(true); } })
          ]);
        }).concat([
          h('button', { class: 'ghost', text: '＋列車', onclick: function () {
            p.cycle.push({ type: state.types[0].id, from: line.stations[0].id, to: line.stations[line.stations.length - 1].id });
            changed(true);
          } })
        ]));

      return h('tr', {}, [
        h('td', {}, [h('input', { type: 'text', value: p.label, style: 'width:88px',
          oninput: function (e) { p.label = e.target.value; changed(true); } })]),
        h('td', {}, [h('input', { type: 'text', class: 'time', value: p.from,
          oninput: function (e) { p.from = e.target.value; changed(); } })]),
        h('td', {}, [h('input', { type: 'text', class: 'time', value: p.to,
          oninput: function (e) { p.to = e.target.value; changed(); } })]),
        h('td', {}, [num(Math.round(p.headway / 60 * 10) / 10, function (e) {
          p.headway = Math.round((parseFloat(e.target.value) || 10) * 60); changed();
        }, { step: 0.5, min: 0.5, style: 'width:60px' })]),
        h('td', { style: 'white-space:normal' }, [cycle]),
        h('td', {}, [h('button', { class: 'ghost', text: '×', onclick: function () { state.patterns.splice(pi, 1); changed(true); } })])
      ]);
    });

    return h('div', {}, [
      h('div', { class: 'tbl-wrap' }, [
        h('table', {}, [
          h('thead', {}, [h('tr', {}, ['時間帯名', '開始', '終了', '間隔(分)', '1巡の構成（種別・運転区間）', ''].map(function (t) {
            return h('th', { text: t });
          }))]),
          h('tbody', {}, rows)
        ])
      ]),
      h('div', { class: 'row', style: 'margin-top:8px' }, [
        h('button', { text: '＋ 時間帯を追加', onclick: function () {
          var last = state.patterns[state.patterns.length - 1];
          state.patterns.push({
            id: 'P' + Date.now().toString(36).slice(-4), label: '新しい時間帯',
            from: last ? last.to : '10:00', to: '12:00', headway: 600,
            cycle: [{ type: state.types[0].id, from: line.stations[0].id, to: line.stations[line.stations.length - 1].id }]
          });
          changed(true);
        } }),
        h('span', { class: 'hint', text: '各時間帯で「開始時刻から間隔ごとに、1巡の構成を順に繰り返して」列車を発生させるよ。上りは全体を ' +
          Math.round(state.params.upOffset / 60 * 10) / 10 + ' 分ずらして発生。' })
      ])
    ]);
  }

  function sel(options, value, on) {
    var s = h('select', { onchange: function (e) { on(e.target.value); } },
      options.map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
    s.value = value;
    return s;
  }

  /* ---------- 計算パラメータ ---------- */
  function paramEditor(state, changed) {
    var p = state.params;
    function f(labelText, key, opts, unit) {
      return h('label', { class: 'f' }, [
        document.createTextNode(labelText),
        num(opts.min100 ? p[key] : p[key], function (e) {
          p[key] = parseInt(e.target.value, 10) || 0; changed();
        }, opts),
        h('span', { class: 'hint', text: unit || '秒' })
      ]);
    }
    var auto = h('label', { class: 'f' }, []);
    var c = h('input', { type: 'checkbox', onchange: function (e) { p.autoHold = e.target.checked; changed(); } });
    c.checked = !!p.autoHold;
    auto.appendChild(c);
    auto.appendChild(document.createTextNode('待避・抑止を自動挿入する'));

    return h('div', { class: 'row', style: 'gap:16px' }, [
      f('通過による短縮（片端）', 'passSave', { step: 5, min: 0, max: 60 }),
      f('最小運転時隔', 'minHeadway', { step: 10, min: 30 }),
      f('最小折返し時分', 'minTurn', { step: 30, min: 60 }),
      f('上りのずらし', 'upOffset', { step: 30, min: 0 }),
      f('時刻の丸め', 'roundTo', { step: 5, min: 1, max: 60 }),
      auto
    ]);
  }

  root.DiaEditors = {
    lineEditor: lineEditor, typeEditor: typeEditor,
    patternEditor: patternEditor, paramEditor: paramEditor
  };
})(window);
