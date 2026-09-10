/* 運転整理（遅延波及）シミュレーション
 *
 * ある列車に遅延を与えたとき、最小運転時隔と最小折返し時分を通じて
 * 後続列車・同一運用の次列車へどう波及するかを求める。
 *
 * 計画ダイヤ上の順序（待避による追い抜きを含む）はそのまま保つ。
 * 各駅の着発を「計画時刻の早い順」に 1 度だけ確定させていくので、
 * 時刻は前へしか動かず、押し合いで発散することがない。
 *
 *   着 = max( 計画の着 + 与えた遅延, 前駅の発 + 計画の走行時分 )
 *   発 = max( 計画の発 + 与えた遅延, 着 + 計画の停車時分,
 *             同じ駅・同じ方向の直前列車 + 最小運転時隔,
 *             （始発なら）折返し元の着 + 最小折返し時分 )
 *
 * 回復運転は見込まない（運転時分・停車時分に余裕時分を設定していないため）。
 */
(function (root) {
  'use strict';

  function simulate(line, trains, duties, params, targetNo, delaySec, fromIdx) {
    var base = {};
    trains.forEach(function (t) { base[t.no] = t; });
    if (!base[targetNo]) return null;

    var clones = trains.map(function (t) { return JSON.parse(JSON.stringify(t)); });
    var byNo = {};
    clones.forEach(function (t) { byNo[t.no] = t; });

    // 運用の前列車（折返し元）
    var prevOf = {};
    (duties || []).forEach(function (d) {
      for (var i = 0; i < d.trains.length - 1; i++) prevOf[d.trains[i + 1].no] = d.trains[i].no;
    });

    // 与える遅延：対象列車の指定駅以降
    var target = byNo[targetNo];
    var startPos = fromIdx != null ? posOf(target, fromIdx) : 0;
    if (startPos < 0) startPos = 0;

    var min = params.minHeadway || 0, turn = params.minTurn || 0;

    // 計画ダイヤ上の時刻の早い順に、着発をひとつずつ確定させる
    var nodes = [];
    clones.forEach(function (tr) {
      tr.stops.forEach(function (s, i) {
        nodes.push({ tr: tr, i: i, key: s.dep != null ? s.dep : s.arr });
      });
    });
    nodes.sort(function (a, b) { return a.key - b.key || a.tr.no - b.tr.no || a.i - b.i; });

    var lastAt = {};   // 駅・方向ごとの直前列車の発（終着なら着）
    nodes.forEach(function (nd) {
      var tr = nd.tr, i = nd.i, s = tr.stops[i];
      var plan = base[tr.no].stops[i];
      var extra = (tr.no === targetNo && i >= startPos) ? delaySec : 0;

      if (s.arr != null) {
        var t = plan.arr + extra;
        if (i > 0) {
          var pj = tr.stops[i - 1], pp = base[tr.no].stops[i - 1];
          var run = plan.arr - (pp.dep != null ? pp.dep : pp.arr);
          t = Math.max(t, (pj.dep != null ? pj.dep : pj.arr) + run);
        }
        s.arr = t;
      }

      var key = s.idx + ':' + tr.dir;
      var basis;
      if (s.dep != null) {
        var d = plan.dep + extra;
        if (s.arr != null) d = Math.max(d, s.arr + (plan.dep - plan.arr));
        if (i === 0 && prevOf[tr.no] != null && byNo[prevOf[tr.no]]) {
          d = Math.max(d, byNo[prevOf[tr.no]].arrTime + turn);
        }
        if (lastAt[key] != null) d = Math.max(d, lastAt[key] + min);
        s.dep = d;
        basis = d;
      } else {
        var a = s.arr;
        if (lastAt[key] != null) a = Math.max(a, lastAt[key] + min);
        s.arr = a;
        basis = a;
      }
      lastAt[key] = basis;

      if (i === tr.stops.length - 1) tr.arrTime = s.arr;
      if (i === 0) tr.depTime = s.dep;
    });

    // 遅延量の集計
    var delays = [];
    clones.forEach(function (c) {
      var o = base[c.no], d = 0;
      c.stops.forEach(function (s, i) {
        var os = o.stops[i];
        if (s.dep != null && os.dep != null) d = Math.max(d, s.dep - os.dep);
        if (s.arr != null && os.arr != null) d = Math.max(d, s.arr - os.arr);
      });
      if (d > 0) delays.push({ no: c.no, delay: d, arrDelay: c.arrTime - o.arrTime, train: c });
    });
    delays.sort(function (a, b) { return b.delay - a.delay || a.no - b.no; });

    var affected = delays.filter(function (d) { return d.no !== targetNo; });
    var recovery = 0;
    delays.forEach(function (d) { recovery = Math.max(recovery, d.train.arrTime); });

    return {
      trains: clones,
      delays: delays,
      stats: {
        target: targetNo,
        given: delaySec,
        affected: affected.length,
        maxDelay: delays.length ? delays[0].delay : 0,
        totalDelayMin: Math.round(delays.reduce(function (a, d) { return a + d.delay; }, 0) / 60),
        lastAffectedArr: recovery
      }
    };
  }

  function posOf(train, idx) {
    for (var i = 0; i < train.stops.length; i++) if (train.stops[i].idx === idx) return i;
    return -1;
  }

  var api = { simulate: simulate };
  root.DiaDisrupt = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
