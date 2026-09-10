/* 運行モニタ（在線表示盤）
 *
 * 指令所の表示盤に見立てて、路線を 1 本の帯に伸ばし、模擬時刻の在線列車を光点で示す。
 * 上段が下り、下段が上り。静的な部分は build() で一度だけ作り、以降は update() で
 * 列車の位置だけを動かす。
 */
(function (root) {
  'use strict';

  var T = root.DiaTime, Sch = root.DiaSchedule, Line = root.DiaLine;
  var NS = 'http://www.w3.org/2000/svg';

  function el(name, attrs, text) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  function Monitor(host) {
    this.host = host;
    this.marks = {};
  }

  Monitor.prototype.build = function (state) {
    var line = state.line;
    this.state = state;
    this.marks = {};
    this.host.innerHTML = '';

    var W = Math.max(760, this.host.clientWidth || 960);
    var H = 196, padX = 34, top = 78, gap = 54;
    var km = Line.totalKm(line) || 1;
    var km0 = line.stations[0].km;
    var self = this;
    this.x = function (k) { return padX + (k - km0) / km * (W - padX * 2); };
    this.yDown = top;
    this.yUp = top + gap;

    var svg = el('svg', { width: '100%', height: H, viewBox: '0 0 ' + W + ' ' + H, class: 'mon-svg' });

    // ネオン用のぼかし
    var defs = el('defs');
    var f = el('filter', { id: 'mon-neon', x: '-60%', y: '-60%', width: '220%', height: '220%' });
    f.appendChild(el('feGaussianBlur', { stdDeviation: 3.2, result: 'b' }));
    var merge = el('feMerge');
    merge.appendChild(el('feMergeNode', { in: 'b' }));
    merge.appendChild(el('feMergeNode', { in: 'SourceGraphic' }));
    f.appendChild(merge);
    defs.appendChild(f);
    svg.appendChild(defs);

    // 単線区間の帯
    line.sections.forEach(function (sec, i) {
      if (!sec.single) return;
      svg.appendChild(el('rect', {
        x: self.x(line.stations[i].km), y: top - 16,
        width: self.x(line.stations[i + 1].km) - self.x(line.stations[i].km),
        height: gap + 32, class: 'single-band'
      }));
    });

    // 軌道
    [this.yDown, this.yUp].forEach(function (y, i) {
      svg.appendChild(el('line', { x1: padX, y1: y, x2: W - padX, y2: y, class: 'mon-track' }));
      svg.appendChild(el('text', { x: 6, y: y + 4, class: 'mon-label' }, i ? '上り' : '下り'));
    });

    // 駅
    line.stations.forEach(function (st, i) {
      var x = self.x(st.km);
      svg.appendChild(el('line', { x1: x, y1: top - 12, x2: x, y2: top + gap + 12, class: 'mon-stline' }));
      [self.yDown, self.yUp].forEach(function (y) {
        svg.appendChild(el('circle', {
          cx: x, cy: y, r: st.canTurn ? 4 : 2.6,
          class: 'mon-st' + (st.depot ? ' depot' : '') + (st.canOvertake ? ' pass' : '')
        }));
      });
      var g = el('g', { transform: 'translate(' + x + ',' + (top - 20) + ') rotate(-52)' });
      g.appendChild(el('text', { x: 0, y: 0, class: 'mon-stname' + (st.crewBase ? ' base' : '') }, st.name));
      svg.appendChild(g);
    });

    // 列車の光点（あらかじめ全列車ぶん作っておき、表示だけ切り替える）
    var layer = el('g', { filter: 'url(#mon-neon)' });
    svg.appendChild(layer);
    this.layer = layer;
    this.svg = svg;
    this.W = W;
    this.host.appendChild(svg);
  };

  /** 模擬時刻 t の在線を反映 */
  Monitor.prototype.update = function (t, trains, delays) {
    if (!this.svg) return;
    var line = this.state.line, self = this;
    var typeMap = {};
    this.state.types.forEach(function (ty) { typeMap[ty.id] = ty; });
    var live = {};

    Sch.onlineAt(line, trains, t).forEach(function (o) {
      var tr = o.train, p = o.pos;
      live[tr.no] = true;
      var m = self.marks[tr.no];
      if (!m) {
        var g = el('g', { class: 'mon-train' });
        var color = (typeMap[tr.typeId] || {}).color || '#8ab';
        g.appendChild(el('path', { d: 'M -7 -5 L 7 0 L -7 5 Z', fill: color, class: 'mon-arrow' }));
        g.appendChild(el('text', { x: 0, y: -10, 'text-anchor': 'middle', class: 'mon-no', fill: color }, tr.no));
        self.layer.appendChild(g);
        m = self.marks[tr.no] = { g: g };
      }
      var y = tr.dir === 'down' ? self.yDown : self.yUp;
      var flip = tr.dir === 'up' ? ' scale(-1,1)' : '';
      m.g.setAttribute('transform', 'translate(' + self.x(p.km).toFixed(1) + ',' + y + ')');
      m.g.firstChild.setAttribute('transform', flip);
      m.g.style.display = '';
      m.g.classList.toggle('stopped', !!p.stopped);
      m.g.classList.toggle('late', !!(delays && delays[tr.no]));
    });

    Object.keys(this.marks).forEach(function (no) {
      if (!live[no]) self.marks[no].g.style.display = 'none';
    });
    return Object.keys(live).length;
  };

  root.DiaMonitor = { create: function (host) { return new Monitor(host); } };
})(window);
