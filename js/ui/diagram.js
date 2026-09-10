/* ダイヤグラム（列車ダイヤ）の描画
 *
 * 横軸＝時刻、縦軸＝駅（キロ程按分／等間隔を切替）。
 * 「駅名（左固定）／時刻目盛（上固定）／作図面（両方向スクロール）」の 3 面をスクロール同期させる。
 */
(function (root) {
  'use strict';

  var T = root.DiaTime, Sch = root.DiaSchedule;
  var NS = 'http://www.w3.org/2000/svg';
  var PAD_TOP = 14, PAD_BOTTOM = 14, PAD_LEFT = 8;

  function el(name, attrs, text) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  function Diagram(host) {
    this.host = host;
    host.innerHTML =
      '<div class="dg-corner">時刻＼駅</div>' +
      '<div class="dg-time"></div>' +
      '<div class="dg-st"></div>' +
      '<div class="dg-plot"></div>' +
      '<div class="tip"></div>';
    this.elTime = host.querySelector('.dg-time');
    this.elSt = host.querySelector('.dg-st');
    this.elPlot = host.querySelector('.dg-plot');
    this.tip = host.querySelector('.tip');
    this.selected = null;
    this.onSelect = null;

    var self = this;
    this.elPlot.addEventListener('scroll', function () {
      self.elTime.scrollLeft = self.elPlot.scrollLeft;
      self.elSt.scrollTop = self.elPlot.scrollTop;
    });
  }

  Diagram.prototype.render = function (state, view) {
    var line = state.line, trains = state.trains, types = state.types;
    this.state = state; this.view = view;

    var typeMap = {}; types.forEach(function (t) { typeMap[t.id] = t; });
    var shown = trains.filter(function (t) {
      return !view.hidden || !view.hidden[t.typeId];
    });

    var t0 = view.t0, t1 = view.t1;
    if (t0 == null || t1 == null) {
      var all = trains.length ? trains : [{ depTime: 18000, arrTime: 86400 }];
      t0 = Math.min.apply(null, all.map(function (t) { return t.depTime; })) - 600;
      t1 = Math.max.apply(null, all.map(function (t) { return t.arrTime; })) + 600;
      t0 = Math.floor(t0 / 1800) * 1800; t1 = Math.ceil(t1 / 1800) * 1800;
    }
    this.t0 = t0; this.t1 = t1;

    var W = Math.max(600, Math.round((t1 - t0) / 60 * view.pxPerMin)) + PAD_LEFT * 2;
    var ys = layoutY(line, view);
    var H = ys.height;

    this.x = function (t) { return PAD_LEFT + (t - t0) / 60 * view.pxPerMin; };
    this.y = function (idx) { return ys.y[idx]; };
    this.yOfKm = function (km) {
      var sts = line.stations;
      for (var i = 0; i < sts.length - 1; i++) {
        if (km <= sts[i + 1].km || i === sts.length - 2) {
          var span = sts[i + 1].km - sts[i].km || 1;
          var r = Math.max(0, Math.min(1, (km - sts[i].km) / span));
          return ys.y[i] + (ys.y[i + 1] - ys.y[i]) * r;
        }
      }
      return ys.y[0];
    };

    // --- 作図面 ---
    var svg = el('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H });

    var defs = el('defs');
    var f = el('filter', { id: 'dg-neon', x: '-50%', y: '-50%', width: '200%', height: '200%' });
    f.appendChild(el('feGaussianBlur', { stdDeviation: 1.8, result: 'b' }));
    var mg = el('feMerge');
    mg.appendChild(el('feMergeNode', { in: 'b' }));
    mg.appendChild(el('feMergeNode', { in: 'SourceGraphic' }));
    f.appendChild(mg);
    defs.appendChild(f);
    var clip = el('clipPath', { id: 'dg-sweep' });
    var clipRect = el('rect', { x: 0, y: 0, width: W, height: H });
    clip.appendChild(clipRect);
    defs.appendChild(clip);
    svg.appendChild(defs);

    // 単線区間の帯
    line.sections.forEach(function (sec, i) {
      if (!sec.single) return;
      var y1 = ys.y[i], y2 = ys.y[i + 1];
      svg.appendChild(el('rect', { x: 0, y: Math.min(y1, y2), width: W, height: Math.abs(y2 - y1), class: 'single-band' }));
    });

    // 時刻グリッド
    var gridStep = view.pxPerMin >= 6 ? 120 : view.pxPerMin >= 3 ? 300 : 600;
    for (var t = Math.ceil(t0 / gridStep) * gridStep; t <= t1; t += gridStep) {
      var cls = t % 3600 === 0 ? 'tick hour' : (t % 600 === 0 ? 'tick ten' : 'tick');
      if (t % 600 !== 0 && view.pxPerMin < 6) continue;
      svg.appendChild(el('line', { x1: this.x(t), y1: PAD_TOP - 6, x2: this.x(t), y2: H - PAD_BOTTOM + 6, class: cls }));
    }

    // 駅線
    line.stations.forEach(function (st, i) {
      svg.appendChild(el('line', {
        x1: 0, y1: ys.y[i], x2: W, y2: ys.y[i],
        class: 'st-line' + (st.canTurn || st.canOvertake ? ' major' : '')
      }));
    });

    // 列車スジ：ハロー・本体・芯の 3 枚を 1 つの g にまとめる
    var g = el('g', {});
    var self = this;
    var glow = view.glow !== false;
    shown.forEach(function (tr) {
      var pts = points(tr, self.x, ys.y);
      if (pts.length < 2) return;
      var d = pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
      var color = (typeMap[tr.typeId] || {}).color || '#888';

      var tg = el('g', { class: 'train' });
      tg.dataset.no = tr.no;
      tg.appendChild(el('polyline', { points: d, class: 'train-hit' }));
      if (glow) tg.appendChild(el('polyline', { points: d, class: 'train-glow', stroke: color }));
      tg.appendChild(el('polyline', { points: d, class: 'train-line ' + tr.dir, stroke: color }));
      if (glow) tg.appendChild(el('polyline', { points: d, class: 'train-core' }));
      g.appendChild(tg);

      // 待避（抑止）を点で示す
      (tr.holds || []).forEach(function (h) {
        var s = Sch.stopAt(tr, h.idx);
        if (!s) return;
        var cx = self.x((s.arr + s.dep) / 2);
        var hd = el('circle', { cx: cx, cy: ys.y[h.idx], r: glow ? 2.6 : 2, class: 'hold-dot' });
        if (!glow) hd.style.filter = 'none';
        g.appendChild(hd);
      });
    });
    svg.appendChild(g);

    // 生成直後は左から掃引しながらスジを描く
    if (view.sweep && !prefersReducedMotion()) {
      g.setAttribute('clip-path', 'url(#dg-sweep)');
      var beam = el('line', { x1: 0, y1: 0, x2: 0, y2: H, class: 'sweep-beam' });
      svg.appendChild(beam);
      var sweepStart = null, dur = 900;   // ここで t0 を名乗ると時間軸の原点を壊すので別名にする
      var step = function (ts) {
        if (sweepStart == null) sweepStart = ts;
        var r = Math.min(1, (ts - sweepStart) / dur);
        var e = 1 - Math.pow(1 - r, 3);
        clipRect.setAttribute('width', (W * e).toFixed(1));
        beam.setAttribute('x1', (W * e).toFixed(1));
        beam.setAttribute('x2', (W * e).toFixed(1));
        beam.setAttribute('opacity', (1 - r * r).toFixed(3));
        if (r < 1) requestAnimationFrame(step);
        else { g.removeAttribute('clip-path'); beam.remove(); }
      };
      requestAnimationFrame(step);
    }

    // 遅延ダイヤの重ね描き（運転整理シミュレーション）
    if (view.overlay && view.overlay.trains && view.overlay.trains.length) {
      g.setAttribute('opacity', '0.28');
      var og = el('g', {});
      var delayed = {};
      (view.overlay.delays || []).forEach(function (d) { delayed[d.no] = d.delay; });
      view.overlay.trains.forEach(function (tr) {
        if (!delayed[tr.no]) return;
        var pts2 = points(tr, self.x, ys.y);
        if (pts2.length < 2) return;
        og.appendChild(el('polyline', {
          points: pts2.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' '),
          class: 'train-line', stroke: (typeMap[tr.typeId] || {}).color || '#888',
          'stroke-dasharray': '5 3', 'stroke-width': 1.8
        }));
      });
      svg.appendChild(og);
    }

    // 列車番号（拡大時のみ）
    if (view.pxPerMin >= 5) {
      var lab = el('g', {});
      shown.forEach(function (tr) {
        var s0 = tr.stops[0];
        var yy = ys.y[tr.fromIdx];
        var xx = self.x(s0.dep);
        var up = tr.dir === 'up';
        lab.appendChild(el('text', {
          x: xx + 3, y: yy + (up ? -4 : 11), class: 'axis-text',
          fill: (typeMap[tr.typeId] || {}).color, opacity: 0.9
        }, tr.no));
      });
      svg.appendChild(lab);
    }

    this.elPlot.innerHTML = '';
    this.elPlot.appendChild(svg);
    this.svg = svg;

    // --- 時刻目盛（上） ---
    var tsvg = el('svg', { width: W, height: 30 });
    for (var h = Math.ceil(t0 / 1800) * 1800; h <= t1; h += 1800) {
      var isHour = h % 3600 === 0;
      tsvg.appendChild(el('line', { x1: this.x(h), y1: isHour ? 12 : 20, x2: this.x(h), y2: 30, class: 'tick' + (isHour ? ' hour' : '') }));
      if (isHour || view.pxPerMin >= 6) {
        tsvg.appendChild(el('text', { x: this.x(h) + 3, y: 11, class: 'axis-text' }, T.fmtTime(h)));
      }
    }
    this.elTime.innerHTML = ''; this.elTime.appendChild(tsvg);

    // --- 駅名（左） ---
    // 文字幅を実測して列の幅を決める。切り詰めず、入らないときだけ字を小さくする。
    var ssvg = el('svg', { height: H });
    this.elSt.innerHTML = '';
    this.elSt.appendChild(ssvg);

    var MIN_GAP = 11;           // これより詰まった駅名は間引く
    var lastLabelY = -Infinity;
    var labels = [];
    line.stations.forEach(function (st, i) {
      ssvg.appendChild(el('line', { x1: 0, y1: ys.y[i], x2: 0, y2: ys.y[i], class: 'st-line major', 'data-tick': i }));
      var keep = st.canTurn || st.depot || st.canOvertake || i === 0 || i === line.stations.length - 1;
      var tight = ys.y[i] - lastLabelY < MIN_GAP;
      if (!keep && tight) return;
      if (keep && tight && labels.length && !labels[labels.length - 1].keep) {
        // 設備のある駅を優先し、直前のふつうの駅名は取り下げる
        var prev = labels.pop();
        prev.t.parentNode.removeChild(prev.t);
        lastLabelY = labels.length ? ys.y[labels[labels.length - 1].i] : -Infinity;
      }
      lastLabelY = ys.y[i];
      var t = el('text', {
        x: 0, y: ys.y[i] + 3.5, 'text-anchor': 'end',
        class: 'st-name' + (st.canTurn ? ' turn' : '')
      }, st.name);
      t.appendChild(el('title', {}, st.name + '（' + st.km.toFixed(1) + 'km）'));
      ssvg.appendChild(t);
      labels.push({ t: t, st: st, i: i, keep: keep });
    });

    var maxText = 0;
    labels.forEach(function (l) { maxText = Math.max(maxText, textWidth(l.t)); });
    var room = Math.min(220, Math.max(96, Math.floor((self.host.clientWidth || 900) * 0.4)));
    var GUTTER = 26;            // 目盛と待避マークのぶん
    var fs = 11;
    if (maxText + GUTTER > room) {
      fs = Math.max(8, Math.floor(11 * (room - GUTTER) / maxText));
      labels.forEach(function (l) { l.t.setAttribute('font-size', fs); });
      maxText = 0;
      labels.forEach(function (l) { maxText = Math.max(maxText, textWidth(l.t)); });
    }
    var WST = Math.round(Math.max(76, Math.min(room, maxText + GUTTER)));

    ssvg.setAttribute('width', WST);
    this.host.style.gridTemplateColumns = WST + 'px 1fr';
    labels.forEach(function (l) { l.t.setAttribute('x', WST - 16); });
    var ticks = ssvg.querySelectorAll('[data-tick]');
    for (var k = 0; k < ticks.length; k++) {
      ticks[k].setAttribute('x1', WST - 12);
      ticks[k].setAttribute('x2', WST);
    }
    line.stations.forEach(function (st, i) {
      if (!st.canOvertake) return;
      ssvg.appendChild(el('circle', { cx: WST - 8, cy: ys.y[i], r: 2.4, fill: 'var(--warn)' }));
    });

    this.bindPointer(typeMap);
    this.nowG = null; this.dotMap = {};
    if (this.selected) this.setSelection(this.selected);
  };

  /** 縦軸レイアウト（キロ程按分 or 等間隔） */
  function layoutY(line, view) {
    var n = line.stations.length;
    var y = [];
    if (view.yMode === 'even') {
      var gap = view.pxPerKm * 1.0;
      for (var i = 0; i < n; i++) y.push(PAD_TOP + i * gap);
    } else {
      var km0 = line.stations[0].km;
      for (var j = 0; j < n; j++) y.push(PAD_TOP + (line.stations[j].km - km0) * view.pxPerKm);
    }
    return { y: y, height: Math.round(y[n - 1] + PAD_BOTTOM) };
  }

  function points(tr, x, y) {
    var pts = [];
    tr.stops.forEach(function (s) {
      if (s.arr != null) pts.push([x(s.arr), y[s.idx]]);
      if (s.dep != null && s.dep !== s.arr) pts.push([x(s.dep), y[s.idx]]);
      if (s.arr == null && s.dep != null) { /* 始発 */ }
    });
    return pts;
  }

  Diagram.prototype.bindPointer = function (typeMap) {
    var self = this;
    var trainByNo = {};
    this.state.trains.forEach(function (t) { trainByNo[t.no] = t; });

    this.svg.addEventListener('mousemove', function (ev) {
      var g = ev.target.closest ? ev.target.closest('.train') : null;
      if (!g) { self.tip.style.display = 'none'; return; }
      var tr = trainByNo[g.dataset.no];
      if (!tr) return;
      var line = self.state.line;
      var ty = typeMap[tr.typeId] || {};
      self.tip.textContent =
        tr.no + '列車  ' + (ty.short || ty.name || '') + '  ' + (tr.dir === 'down' ? '下り' : '上り') + '\n' +
        line.stations[tr.fromIdx].name + ' ' + T.fmtTime(tr.depTime) + ' → ' +
        line.stations[tr.toIdx].name + ' ' + T.fmtTime(tr.arrTime) + '\n' +
        '所要 ' + T.fmtDuration(tr.arrTime - tr.depTime) +
        ((tr.holds || []).length ? '\n待避: ' + tr.holds.map(function (h) {
          return line.stations[h.idx].name + ' ' + T.fmtDuration(h.extra);
        }).join(', ') : '');
      var r = self.host.getBoundingClientRect();
      self.tip.style.display = 'block';
      var tx = ev.clientX - r.left + 12, ty2 = ev.clientY - r.top + 12;
      self.tip.style.left = Math.min(tx, r.width - self.tip.offsetWidth - 8) + 'px';
      self.tip.style.top = Math.min(ty2, r.height - self.tip.offsetHeight - 8) + 'px';
    });
    this.svg.addEventListener('mouseleave', function () { self.tip.style.display = 'none'; });
    this.svg.addEventListener('click', function (ev) {
      var g = ev.target.closest ? ev.target.closest('.train') : null;
      if (!g) return;
      if (self.onSelect) self.onSelect(trainByNo[g.dataset.no]);
    });
  };

  /** 指定した列車番号群を強調表示 */
  Diagram.prototype.setSelection = function (nos) {
    this.selected = nos;
    if (!this.svg) return;
    var set = {};
    (nos || []).forEach(function (n) { set[n] = true; });
    var groups = this.svg.querySelectorAll('.train');
    var any = nos && nos.length;
    for (var i = 0; i < groups.length; i++) {
      var on = !!set[groups[i].dataset.no];
      groups[i].classList.toggle('sel', on);
      if (on) groups[i].setAttribute('filter', 'url(#dg-neon)');
      else groups[i].removeAttribute('filter');
      groups[i].classList.toggle('dim', !!any && !on);
    }
  };

  /** 模擬時刻の現在位置（縦線と在線の光点）を描く */
  Diagram.prototype.showNow = function (t, trains, delays) {
    if (!this.svg || !this.x) return 0;
    var line = this.state.line, self = this;
    if (!this.nowG || this.nowG.ownerSVGElement !== this.svg) {
      this.nowG = el('g', { class: 'now-layer' });
      this.nowLine = el('line', { class: 'now-line', y1: 0, y2: this.svg.getAttribute('height') });
      this.nowG.appendChild(this.nowLine);
      this.nowDots = el('g', {});
      this.nowG.appendChild(this.nowDots);
      this.nowTag = el('text', { class: 'now-tag', y: 11 });
      this.nowG.appendChild(this.nowTag);
      this.svg.appendChild(this.nowG);
      this.dotMap = {};
    }
    this.nowG.style.display = '';
    var x = this.x(t);
    this.nowLine.setAttribute('x1', x);
    this.nowLine.setAttribute('x2', x);
    this.nowTag.setAttribute('x', x + 5);
    this.nowTag.textContent = T.fmtTime(t);

    var typeMap = {};
    this.state.types.forEach(function (ty) { typeMap[ty.id] = ty; });
    var live = {}, n = 0;
    var Schd = root.DiaSchedule;
    Schd.onlineAt(line, trains || this.state.trains, t).forEach(function (o) {
      var p = o.pos, tr = o.train;
      live[tr.no] = true; n++;
      var d = self.dotMap[tr.no];
      if (!d) {
        d = self.dotMap[tr.no] = el('circle', { r: 4, class: 'now-dot' });
        self.nowDots.appendChild(d);
      }
      var isLate = !!(delays && delays[tr.no]);
      var col = isLate ? 'var(--warn)' : ((typeMap[tr.typeId] || {}).color || '#fff');
      d.setAttribute('cx', x.toFixed(1));
      d.setAttribute('cy', self.yOfKm(p.km).toFixed(1));
      // 芯の明るさとにじみは CSS 側で作る。ここでは列車の色だけ渡す
      d.style.setProperty('--c', col);
      d.classList.toggle('late', isLate);
      d.style.display = '';
    });
    Object.keys(this.dotMap).forEach(function (no) {
      if (!live[no]) self.dotMap[no].style.display = 'none';
    });
    return n;
  };

  Diagram.prototype.hideNow = function () {
    if (this.nowG) this.nowG.style.display = 'none';
  };

  /** 再生中の追従スクロール（画面外に出そうなときだけ寄せる） */
  Diagram.prototype.followTime = function (sec) {
    if (!this.x) return;
    var x = this.x(sec), w = this.elPlot.clientWidth, left = this.elPlot.scrollLeft;
    if (x < left + w * 0.25 || x > left + w * 0.75) {
      this.elPlot.scrollLeft = Math.max(0, x - w * 0.35);
    }
  };

  /** 指定時刻が画面中央に来るようスクロール */
  Diagram.prototype.scrollToTime = function (sec) {
    if (!this.x) return;
    var target = this.x(sec) - this.elPlot.clientWidth / 2;
    this.elPlot.scrollLeft = Math.max(0, target);
  };

  /** SVG テキストの実描画幅 */
  function textWidth(t) {
    try { return t.getComputedTextLength(); } catch (e) { return (t.textContent || '').length * 11; }
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  root.DiaDiagram = { create: function (host) { return new Diagram(host); } };
})(window);
