/* 一覧系ビュー（時刻表・列車一覧・運用・検証）の描画 */
(function (root) {
  'use strict';

  var T = root.DiaTime, Sch = root.DiaSchedule;
  var NS = 'http://www.w3.org/2000/svg';

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function svgEl(name, attrs, text) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function typeOf(types, id) {
    for (var i = 0; i < types.length; i++) if (types[i].id === id) return types[i];
    return { name: id, short: id, color: '#888' };
  }

  /* ---------- 時刻表（行＝駅／列＝列車） ---------- */
  function stationGrid(state, opts, onPickTrain) {
    var line = state.line, types = state.types;
    var list = state.trains.filter(function (t) {
      return t.dir === opts.dir && (!opts.hidden || !opts.hidden[t.typeId]);
    }).sort(function (a, b) { return a.depTime - b.depTime; });

    if (opts.hour != null) {
      list = list.filter(function (t) {
        return Math.floor(t.depTime / 3600) === opts.hour || Math.floor(t.arrTime / 3600) === opts.hour ||
          (t.depTime < opts.hour * 3600 && t.arrTime > (opts.hour + 1) * 3600);
      });
    }

    var order = line.stations.map(function (_, i) { return i; });
    if (opts.dir === 'up') order.reverse();

    var thead = h('thead', {}, [
      h('tr', {}, [h('th', { class: 'sticky-col', text: '列車番号' })].concat(list.map(function (t) {
        var ty = typeOf(types, t.typeId);
        return h('th', { class: 'num', style: 'color:' + ty.color, text: String(t.no) });
      }))),
      h('tr', {}, [h('th', { class: 'sticky-col', text: '種別' })].concat(list.map(function (t) {
        var ty = typeOf(types, t.typeId);
        return h('th', { class: 'num', text: ty.short || ty.name });
      }))),
      h('tr', {}, [h('th', { class: 'sticky-col', text: '行先' })].concat(list.map(function (t) {
        return h('th', { class: 'num', text: line.stations[t.toIdx].name });
      })))
    ]);

    var tbody = h('tbody', {}, order.map(function (idx) {
      var st = line.stations[idx];
      var cells = list.map(function (t) {
        var s = Sch.stopAt(t, idx);
        if (!s) return h('td', { class: 'num', text: '' });
        if (!s.stop) return h('td', { class: 'num', style: 'color:var(--ink-mute)', text: 'レ' });
        var held = (t.holds || []).some(function (x) { return x.idx === idx; });
        var txt, title = t.no + '列車 ' + st.name;
        if (s.dep == null) { txt = T.fmtTime(s.arr); title += ' 着 ' + T.fmtTime(s.arr, true); }
        else if (opts.showArr && s.arr != null) {
          txt = T.fmtTime(s.arr) + '/' + T.fmtTime(s.dep).slice(-2);
          title += ' 着 ' + T.fmtTime(s.arr, true) + ' 発 ' + T.fmtTime(s.dep, true);
        } else { txt = T.fmtTime(s.dep); title += ' 発 ' + T.fmtTime(s.dep, true); }
        return h('td', {
          class: 'num', title: title + (held ? '（待避）' : ''),
          style: held ? 'color:var(--warn);font-weight:700' : (s.dep == null ? 'color:var(--ink-mute)' : '')
        }, [document.createTextNode(txt)]);
      });
      return h('tr', {}, [h('td', {
        class: 'sticky-col', text: st.name,
        style: st.canOvertake ? 'font-weight:700' : ''
      })].concat(cells));
    }));

    var table = h('table', {}, [thead, tbody]);
    table.addEventListener('click', function (ev) {
      var td = ev.target.closest && ev.target.closest('td');
      if (!td || !td.title) return;
      var m = /^(\d+)列車/.exec(td.title);
      if (m && onPickTrain) onPickTrain(parseInt(m[1], 10));
    });
    return h('div', { class: 'tbl-wrap', style: 'max-height:68vh' }, [table]);
  }

  /* ---------- 1 列車のスタフ（行路表） ---------- */
  function trainSheet(state, train, duty, crew) {
    var line = state.line, ty = typeOf(state.types, train.typeId);
    var rows = train.stops.map(function (s) {
      var st = line.stations[s.idx];
      return h('tr', {}, [
        h('td', { text: st.name }),
        h('td', { class: 'num', text: s.arr != null ? T.fmtTime(s.arr, true) : '' }),
        h('td', { class: 'num', text: s.dep != null ? T.fmtTime(s.dep, true) : '' }),
        h('td', { class: 'num', text: s.stop && s.arr != null && s.dep != null ? T.fmtDuration(s.dep - s.arr) : (s.stop ? '' : '通過') }),
        h('td', { class: 'num', text: st.km.toFixed(1) })
      ]);
    });
    return h('div', {}, [
      h('div', { class: 'row', style: 'margin-bottom:8px' }, [
        h('span', { class: 'pill', style: 'background:' + ty.color, text: ty.short || ty.name }),
        h('b', { text: train.no + '列車' }),
        h('span', { class: 'hint', text: (train.dir === 'down' ? '下り' : '上り') + '　' +
          line.stations[train.fromIdx].name + ' ' + T.fmtTime(train.depTime) + ' → ' +
          line.stations[train.toIdx].name + ' ' + T.fmtTime(train.arrTime) +
          '　所要 ' + T.fmtDuration(train.arrTime - train.depTime) +
          (duty ? '　運用 ' + duty.no : '') })
      ]),
      h('div', { class: 'tbl-wrap', style: 'max-height:60vh' }, [
        h('table', {}, [
          h('thead', {}, [h('tr', {}, ['駅', '着', '発', '停車', 'キロ程'].map(function (t, i) {
            return h('th', { class: i ? 'num' : '', text: t });
          }))]),
          h('tbody', {}, rows)
        ])
      ])
    ]);
  }

  /* ---------- 運用ガント ---------- */
  function dutyGantt(state, duties, onPick) {
    var line = state.line, types = state.types;
    if (!duties.length) return h('div', { class: 'hint', text: 'ダイヤを作成すると運用が組まれるよ' });
    var t0 = Math.min.apply(null, duties.map(function (d) { return d.startTime; })) - 600;
    var t1 = Math.max.apply(null, duties.map(function (d) { return d.endTime; })) + 600;
    var pxMin = 2.2, rowH = 20, left = 46, top = 22;
    var W = left + (t1 - t0) / 60 * pxMin + 20;
    var H = top + duties.length * rowH + 10;
    var svg = svgEl('svg', { width: W, height: H });
    var x = function (t) { return left + (t - t0) / 60 * pxMin; };

    for (var t = Math.ceil(t0 / 3600) * 3600; t <= t1; t += 3600) {
      svg.appendChild(svgEl('line', { x1: x(t), y1: top - 6, x2: x(t), y2: H - 6, class: 'tick hour' }));
      svg.appendChild(svgEl('text', { x: x(t) + 2, y: 12, class: 'axis-text' }, T.fmtTime(t).slice(0, 2)));
    }
    duties.forEach(function (d, i) {
      var y = top + i * rowH;
      svg.appendChild(svgEl('text', { x: 4, y: y + 12, class: 'axis-text' }, '運用' + d.no));
      svg.appendChild(svgEl('line', { x1: left, y1: y + rowH - 2, x2: W - 10, y2: y + rowH - 2, class: 'st-line' }));
      d.trains.forEach(function (tr) {
        var ty = typeOf(types, tr.typeId);
        var r = svgEl('rect', {
          x: x(tr.depTime), y: y + 3, width: Math.max(2, x(tr.arrTime) - x(tr.depTime)), height: rowH - 8,
          rx: 2, fill: ty.color, opacity: tr.dir === 'down' ? 0.95 : 0.72, class: 'duty-bar'
        });
        r.dataset.no = tr.no;
        r.appendChild(svgEl('title', {}, tr.no + '列車 ' + (ty.short || ty.name) + ' ' +
          line.stations[tr.fromIdx].name + ' ' + T.fmtTime(tr.depTime) + ' → ' +
          line.stations[tr.toIdx].name + ' ' + T.fmtTime(tr.arrTime)));
        svg.appendChild(r);
      });
    });
    svg.addEventListener('click', function (ev) {
      var no = ev.target.dataset && ev.target.dataset.no;
      if (no && onPick) onPick(parseInt(no, 10));
    });
    return h('div', { class: 'gantt', style: 'max-height:62vh' }, [svg]);
  }

  function dutyTable(state, duties) {
    var line = state.line;
    return h('div', { class: 'tbl-wrap', style: 'max-height:50vh' }, [
      h('table', {}, [
        h('thead', {}, [h('tr', {}, ['運用', '出庫', '入庫', '列車数', '走行時間', '行路'].map(function (t) {
          return h('th', { text: t });
        }))]),
        h('tbody', {}, duties.map(function (d) {
          var run = d.trains.reduce(function (a, t) { return a + (t.arrTime - t.depTime); }, 0);
          return h('tr', {}, [
            h('td', { class: 'num', text: String(d.no) }),
            h('td', { text: line.stations[d.startIdx].name + ' ' + T.fmtTime(d.startTime) }),
            h('td', { text: line.stations[d.endIdx].name + ' ' + T.fmtTime(d.endTime) }),
            h('td', { class: 'num', text: String(d.trains.length) }),
            h('td', { class: 'num', text: T.fmtDuration(run) }),
            h('td', { style: 'white-space:normal;font-family:var(--mono);font-size:11px',
              text: d.trains.map(function (t) { return t.no; }).join(' → ') })
          ]);
        }))
      ])
    ]);
  }

  /* ---------- 仕業（乗務員行路） ---------- */
  function crewGantt(state, duties, onPick) {
    var line = state.line, types = state.types;
    if (!duties.length) return h('div', { class: 'hint', text: 'ダイヤを作成すると仕業が組まれるよ' });
    var t0 = Math.min.apply(null, duties.map(function (d) { return d.signOn; })) - 600;
    var t1 = Math.max.apply(null, duties.map(function (d) { return d.signOff; })) + 600;
    var pxMin = 2.2, rowH = 20, left = 54, top = 22;
    var W = left + (t1 - t0) / 60 * pxMin + 20;
    var H = top + duties.length * rowH + 10;
    var svg = svgEl('svg', { width: W, height: H });
    var x = function (t) { return left + (t - t0) / 60 * pxMin; };

    for (var t = Math.ceil(t0 / 3600) * 3600; t <= t1; t += 3600) {
      svg.appendChild(svgEl('line', { x1: x(t), y1: top - 6, x2: x(t), y2: H - 6, class: 'tick hour' }));
      svg.appendChild(svgEl('text', { x: x(t) + 2, y: 12, class: 'axis-text' }, T.fmtTime(t).slice(0, 2)));
    }

    duties.forEach(function (d, i) {
      var y = top + i * rowH;
      var g = svgEl('g', { class: 'duty-bar' });
      g.dataset.no = d.no;
      g.appendChild(svgEl('text', { x: 4, y: y + 12, class: 'axis-text' }, String(d.no)));
      // 拘束時間の下敷き
      g.appendChild(svgEl('rect', {
        x: x(d.signOn), y: y + 5, width: Math.max(2, x(d.signOff) - x(d.signOn)), height: rowH - 12,
        rx: 2, fill: 'var(--line)', opacity: 0.8
      }));
      d.legs.forEach(function (l) {
        if (l.kind === 'train') {
          var ty = typeOf(types, l.typeId);
          g.appendChild(svgEl('rect', {
            x: x(l.dep), y: y + 3, width: Math.max(2, x(l.arr) - x(l.dep)), height: rowH - 8,
            rx: 2, fill: ty.color, opacity: l.dir === 'down' ? 0.95 : 0.72
          }));
        } else if (l.kind === 'break') {
          g.appendChild(svgEl('rect', {
            x: x(l.from), y: y + 7, width: Math.max(2, x(l.to) - x(l.from)), height: rowH - 16,
            rx: 1.5, fill: 'var(--warn)', opacity: 0.85
          }));
        }
      });
      g.appendChild(svgEl('title', {}, '仕業' + d.no + '（' + d.kind + '）' +
        T.fmtTime(d.signOn) + ' ' + line.stations[d.startIdx].name + ' 出勤 → ' +
        T.fmtTime(d.signOff) + ' ' + line.stations[d.endIdx].name + ' 退勤 / 拘束 ' +
        T.fmtHM(d.spreadSec) + '・実乗務 ' + T.fmtHM(d.driveSec)));
      svg.appendChild(g);
    });
    svg.addEventListener('click', function (ev) {
      var g = ev.target.closest && ev.target.closest('.duty-bar');
      if (g && onPick) onPick(parseInt(g.dataset.no, 10));
    });
    return h('div', { class: 'gantt', style: 'max-height:52vh' }, [svg]);
  }

  function crewTable(state, duties, onPick) {
    var line = state.line;
    return h('div', { class: 'tbl-wrap', style: 'max-height:52vh' }, [
      h('table', {}, [
        h('thead', {}, [h('tr', {}, ['仕業', '区分', '出勤', '退勤', '拘束', '実乗務', '休憩', '待機', '列車', '乗務効率', ''].map(function (t) {
          return h('th', { text: t });
        }))]),
        h('tbody', {}, duties.map(function (d) {
          var eff = d.spreadSec ? Math.round(d.driveSec / d.spreadSec * 100) : 0;
          return h('tr', { onclick: function () { onPick(d.no); } }, [
            h('td', { class: 'num', style: 'font-weight:700', text: String(d.no) }),
            h('td', { text: d.kind }),
            h('td', { class: 'num', text: T.fmtTime(d.signOn) + ' ' + line.stations[d.startIdx].name }),
            h('td', { class: 'num', text: T.fmtTime(d.signOff) + ' ' + line.stations[d.endIdx].name }),
            h('td', { class: 'num', text: T.fmtHM(d.spreadSec) }),
            h('td', { class: 'num', text: T.fmtHM(d.driveSec) }),
            h('td', { class: 'num', style: d.breakSec ? 'color:var(--warn)' : 'color:var(--ink-mute)',
              text: d.breakSec ? T.fmtHM(d.breakSec) : 'なし' }),
            h('td', { class: 'num', text: T.fmtHM(d.waitSec) }),
            h('td', { class: 'num', text: String(d.trains.length) }),
            h('td', { class: 'num', text: eff + '%' }),
            h('td', { text: d.warns.length ? '⚠' : '', style: 'color:var(--warn)', title: d.warns.join(' / ') })
          ]);
        }))
      ])
    ]);
  }

  /** 1 仕業の行路表 */
  function crewSheet(state, duty) {
    var line = state.line;
    var rows = duty.legs.map(function (l) {
      if (l.kind === 'signon' || l.kind === 'signoff') {
        return h('tr', { style: 'background:color-mix(in srgb,var(--accent) 8%,transparent)' }, [
          h('td', { style: 'font-weight:700', text: l.kind === 'signon' ? '出勤・点呼' : '退勤' }),
          h('td', { text: line.stations[l.atIdx].name }),
          h('td', { class: 'num', text: T.fmtTime(l.time) }),
          h('td', { class: 'num', text: '' }), h('td', { text: '' })
        ]);
      }
      if (l.kind === 'train') {
        var ty = typeOf(state.types, l.typeId);
        return h('tr', {}, [
          h('td', {}, [h('span', { class: 'pill', style: 'background:' + ty.color, text: ty.short || ty.name }),
            document.createTextNode(' ' + l.no + '列車')]),
          h('td', { text: line.stations[l.fromIdx].name + ' → ' + line.stations[l.toIdx].name }),
          h('td', { class: 'num', text: T.fmtTime(l.dep) }),
          h('td', { class: 'num', text: T.fmtTime(l.arr) }),
          h('td', { class: 'num', text: T.fmtDuration(l.arr - l.dep) })
        ]);
      }
      return h('tr', { style: l.kind === 'break' ? 'color:var(--warn)' : 'color:var(--ink-mute)' }, [
        h('td', { text: l.kind === 'break' ? '休憩' : '待機' }),
        h('td', { text: line.stations[l.atIdx].name }),
        h('td', { class: 'num', text: T.fmtTime(l.from) }),
        h('td', { class: 'num', text: T.fmtTime(l.to) }),
        h('td', { class: 'num', text: T.fmtDuration(l.to - l.from) })
      ]);
    });
    return h('div', {}, [
      h('div', { class: 'row', style: 'margin-bottom:8px' }, [
        h('b', { text: '仕業 ' + duty.no }),
        h('span', { class: 'chip', text: duty.kind }),
        h('span', { class: 'hint', text:
          T.fmtTime(duty.signOn) + ' ' + line.stations[duty.startIdx].name + ' 出勤 → ' +
          T.fmtTime(duty.signOff) + ' ' + line.stations[duty.endIdx].name + ' 退勤　拘束 ' +
          T.fmtHM(duty.spreadSec) + '　実乗務 ' + T.fmtHM(duty.driveSec) +
          '　休憩 ' + T.fmtHM(duty.breakSec) + '　待機 ' + T.fmtHM(duty.waitSec) })
      ].concat(duty.warns.map(function (w) { return h('span', { class: 'notes', text: '⚠ ' + w }); }))),
      h('div', { class: 'tbl-wrap', style: 'max-height:56vh' }, [
        h('table', {}, [
          h('thead', {}, [h('tr', {}, ['行路', '駅', '発／開始', '着／終了', '時分'].map(function (t, i) {
            return h('th', { class: i >= 2 ? 'num' : '', text: t });
          }))]),
          h('tbody', {}, rows)
        ])
      ])
    ]);
  }

  /* ---------- 検証結果 ---------- */
  function issueList(issues, onJump) {
    if (!issues.length) return h('div', { class: 'hint', text: '支障は見つからなかったよ' });
    return h('div', {}, issues.slice(0, 400).map(function (is) {
      return h('div', { class: 'issue' }, [
        h('span', { class: 'badge ' + is.level, text: is.level === 'error' ? '支障' : is.level === 'warn' ? '注意' : '情報' }),
        h('time', { text: is.time != null ? T.fmtTime(is.time) : '　　　' }),
        h('span', { class: 'k', text: is.kind }),
        h('span', { style: 'flex:1', text: is.msg }),
        is.time != null ? h('button', { class: 'ghost', text: '⇥ ダイヤ', onclick: function () { onJump(is); } }) : null
      ]);
    }));
  }

  root.DiaViews = {
    h: h, svgEl: svgEl, typeOf: typeOf,
    stationGrid: stationGrid, trainSheet: trainSheet,
    dutyGantt: dutyGantt, dutyTable: dutyTable, issueList: issueList,
    crewGantt: crewGantt, crewTable: crewTable, crewSheet: crewSheet
  };
})(window);
