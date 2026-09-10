/* 総合指令（ダッシュボード）
 *
 * 一枚で「いま何本走っていて、何が詰まっていて、資源はどれだけ要るか」を出す画面。
 * 在線本数のプロファイルを面で示し、現在時刻を重ねる。
 */
(function (root) {
  'use strict';

  var T = root.DiaTime, Sch = root.DiaSchedule, Op = root.DiaOperation, V = root.DiaViews;
  var NS = 'http://www.w3.org/2000/svg';
  var h = V.h;

  function el(name, attrs, text) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  /** 在線本数プロファイル（面グラフ） */
  function occupancyChart(host, opts) {
    var plan = opts.plan, actual = opts.actual, now = opts.now;
    if (!plan.length) { host.innerHTML = ''; return; }
    var W = Math.max(560, host.clientWidth || 900), H = 168;
    var padL = 34, padR = 14, padT = 16, padB = 22;
    var t0 = plan[0].t, t1 = plan[plan.length - 1].t;
    var max = Math.max.apply(null, plan.concat(actual || []).map(function (p) { return p.n; })) || 1;
    var top = Math.max(4, Math.ceil(max / 4) * 4);

    var x = function (t) { return padL + (t - t0) / (t1 - t0) * (W - padL - padR); };
    var y = function (n) { return H - padB - n / top * (H - padT - padB); };

    var svg = el('svg', { width: '100%', height: H, viewBox: '0 0 ' + W + ' ' + H, class: 'occ-svg' });

    // 目盛（控えめに）
    [0, top / 2, top].forEach(function (n) {
      svg.appendChild(el('line', { x1: padL, y1: y(n), x2: W - padR, y2: y(n), class: 'occ-grid' }));
      svg.appendChild(el('text', { x: padL - 6, y: y(n) + 3.5, 'text-anchor': 'end', class: 'occ-axis' }, String(n)));
    });
    for (var t = Math.ceil(t0 / 10800) * 10800; t <= t1; t += 10800) {
      svg.appendChild(el('text', { x: x(t), y: H - 6, 'text-anchor': 'middle', class: 'occ-axis' }, T.fmtTime(t)));
    }

    // 計画（遅延を入れているときだけ、比較として薄く重ねる）
    if (actual && actual.length) {
      svg.appendChild(el('path', { d: linePath(plan, x, y), class: 'occ-plan' }));
    }
    var series = actual && actual.length ? actual : plan;
    svg.appendChild(el('path', { d: areaPath(series, x, y, H - padB), class: 'occ-area' }));
    svg.appendChild(el('path', { d: linePath(series, x, y), class: 'occ-line' }));

    // ピークだけ直接ラベル
    var peak = series.reduce(function (a, p) { return p.n > a.n ? p : a; }, series[0]);
    svg.appendChild(el('circle', { cx: x(peak.t), cy: y(peak.n), r: 3.4, class: 'occ-peak' }));
    svg.appendChild(el('text', {
      x: Math.min(W - padR - 30, x(peak.t) + 7), y: y(peak.n) - 7, class: 'occ-tag'
    }, '最多 ' + Math.round(peak.n) + ' 本 / ' + T.fmtTime(peak.t)));

    // 現在時刻
    var nowG = el('g', { class: 'occ-now' });
    if (now != null && now >= t0 && now <= t1) {
      nowG.appendChild(el('line', { x1: x(now), y1: padT - 6, x2: x(now), y2: H - padB, class: 'occ-nowline' }));
      var cur = nearest(series, now);
      nowG.appendChild(el('circle', { cx: x(now), cy: y(cur), r: 4, class: 'occ-nowdot' }));
    }
    svg.appendChild(nowG);

    // ホバー（十字線と値）
    var hover = el('g', { class: 'occ-hover', opacity: 0 });
    var hl = el('line', { y1: padT - 6, y2: H - padB, class: 'occ-cross' });
    var hd = el('circle', { r: 3.6, class: 'occ-hoverdot' });
    var htBg = el('rect', { class: 'occ-tipbg', rx: 4, height: 17, width: 96 });
    var ht = el('text', { class: 'occ-tip' });
    hover.appendChild(hl); hover.appendChild(hd); hover.appendChild(htBg); hover.appendChild(ht);
    svg.appendChild(hover);

    var hit = el('rect', { x: padL, y: 0, width: W - padL - padR, height: H, fill: 'transparent' });
    svg.appendChild(hit);
    hit.addEventListener('mousemove', function (ev) {
      var r = svg.getBoundingClientRect();
      var px = (ev.clientX - r.left) / r.width * W;
      var tt = t0 + (px - padL) / (W - padL - padR) * (t1 - t0);
      var n = nearest(series, tt);
      hover.setAttribute('opacity', 1);
      hl.setAttribute('x1', px); hl.setAttribute('x2', px);
      hd.setAttribute('cx', px); hd.setAttribute('cy', y(n));
      var tx = Math.min(W - padR - 100, px + 8);
      htBg.setAttribute('x', tx); htBg.setAttribute('y', padT - 4);
      ht.setAttribute('x', tx + 7); ht.setAttribute('y', padT + 8.5);
      ht.textContent = T.fmtTime(Math.round(tt / 900) * 900) + '　' + n.toFixed(1) + ' 本在線';
    });
    hit.addEventListener('mouseleave', function () { hover.setAttribute('opacity', 0); });

    host.innerHTML = '';
    host.appendChild(svg);
  }

  function nearest(series, t) {
    var best = series[0], bd = Infinity;
    for (var i = 0; i < series.length; i++) {
      var d = Math.abs(series[i].t - t);
      if (d < bd) { bd = d; best = series[i]; }
    }
    return best.n;
  }
  function linePath(pts, x, y) {
    return pts.map(function (p, i) { return (i ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.n).toFixed(1); }).join(' ');
  }
  function areaPath(pts, x, y, base) {
    return linePath(pts, x, y) + ' L' + x(pts[pts.length - 1].t).toFixed(1) + ' ' + base +
      ' L' + x(pts[0].t).toFixed(1) + ' ' + base + ' Z';
  }

  /** スパークライン（KPI タイル用の小さな折れ線） */
  function spark(series, w, hh) {
    if (!series.length) return null;
    var max = Math.max.apply(null, series.map(function (p) { return p.n; })) || 1;
    var x = function (i) { return i / (series.length - 1) * w; };
    var y = function (n) { return hh - n / max * (hh - 2) - 1; };
    var svg = el('svg', { width: w, height: hh, viewBox: '0 0 ' + w + ' ' + hh, class: 'spark' });
    svg.appendChild(el('path', {
      d: series.map(function (p, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.n).toFixed(1); }).join(' '),
      class: 'spark-line'
    }));
    return svg;
  }

  /** 実運転で成立している最小の運転時隔 */
  function tightestHeadway(line, trains) {
    var best = Infinity, where = null;
    line.stations.forEach(function (st, idx) {
      ['down', 'up'].forEach(function (dir) {
        var list = [];
        trains.forEach(function (tr) {
          if (tr.dir !== dir) return;
          var v = Sch.timeAt(tr, idx);
          if (v != null) list.push(v);
        });
        list.sort(function (a, b) { return a - b; });
        for (var i = 1; i < list.length; i++) {
          if (list[i] - list[i - 1] < best) { best = list[i] - list[i - 1]; where = st.name; }
        }
      });
    });
    return { sec: best === Infinity ? 0 : best, at: where };
  }

  /** 次に発車する列車（駅を横断して直近のもの） */
  function upcoming(line, trains, t, n) {
    var out = [];
    trains.forEach(function (tr) {
      var s0 = tr.stops[0];                       // 始発駅を出る列車だけを並べる
      if (s0.dep == null || s0.dep < t || s0.dep > t + 5400) return;
      out.push({ tr: tr, idx: s0.idx, dep: s0.dep });
    });
    out.sort(function (a, b) { return a.dep - b.dep || a.tr.no - b.tr.no; });
    return out.slice(0, n || 8);
  }

  root.DiaDash = {
    occupancyChart: occupancyChart, spark: spark,
    tightestHeadway: tightestHeadway, upcoming: upcoming
  };
})(window);
