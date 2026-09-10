/* 運転整理（遅延波及）シミュレーション
 *
 * ある列車に遅延を与えたとき、最小運転時隔と最小折返し時分の制約を通じて
 * 後続列車・同一運用の次列車へどう波及するかを求める。
 * 計画ダイヤの列車順序は保たれる（待避なしで追い抜きは起きない）前提。
 *
 * 回復運転は見込まない（運転時分・停車時分に余裕を持たせていないため）。
 */
(function (root) {
  'use strict';

  var Sch = root.DiaSchedule || (typeof require !== 'undefined' ? require('./schedule.js') : null);

  var MAX_ITER = 60;

  function simulate(line, trains, duties, params, targetNo, delaySec) {
    var base = {};
    trains.forEach(function (t) { base[t.no] = t; });

    var clones = trains.map(function (t) { return JSON.parse(JSON.stringify(t)); });
    var byNo = {};
    clones.forEach(function (t) { byNo[t.no] = t; });

    var nextOf = {};
    (duties || []).forEach(function (d) {
      for (var i = 0; i < d.trains.length - 1; i++) nextOf[d.trains[i].no] = d.trains[i + 1].no;
    });

    var target = byNo[targetNo];
    if (!target) return null;
    shiftFrom(target, 0, delaySec);

    // 計画ダイヤ上の列車順序（駅ごと・方向ごと）
    var seq = plannedOrder(line, trains);

    var min = params.minHeadway || 0, turn = params.minTurn || 0;
    for (var it = 0; it < MAX_ITER; it++) {
      var changed = false;

      // 続行時隔
      seq.forEach(function (row) {
        for (var i = 1; i < row.list.length; i++) {
          var a = byNo[row.list[i - 1]], b = byNo[row.list[i]];
          if (!a || !b) continue;
          var ta = Sch.timeAt(a, row.idx), tb = Sch.timeAt(b, row.idx);
          if (ta == null || tb == null) continue;
          if (tb < ta + min) {
            shiftFrom(b, posOf(b, row.idx), ta + min - tb);
            changed = true;
          }
        }
      });

      // 折返し
      clones.forEach(function (t) {
        var n = nextOf[t.no] != null ? byNo[nextOf[t.no]] : null;
        if (!n) return;
        var need = t.arrTime + turn;
        if (n.depTime < need) { shiftFrom(n, 0, need - n.depTime); changed = true; }
      });

      if (!changed) break;
    }

    // 遅延量の集計
    var delays = [];
    clones.forEach(function (c) {
      var o = base[c.no];
      var d = 0;
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

  /** 駅・方向ごとの計画ダイヤ上の通過順 */
  function plannedOrder(line, trains) {
    var rows = [];
    line.stations.forEach(function (st, idx) {
      ['down', 'up'].forEach(function (dir) {
        var list = [];
        trains.forEach(function (t) {
          if (t.dir !== dir) return;
          var v = Sch.timeAt(t, idx);
          if (v != null) list.push({ no: t.no, t: v });
        });
        list.sort(function (a, b) { return a.t - b.t; });
        if (list.length > 1) rows.push({ idx: idx, dir: dir, list: list.map(function (x) { return x.no; }) });
      });
    });
    return rows;
  }

  /** stops の pos 番目以降を delta 秒ずらす
   *  起点が停車駅なら「その駅で抑止された」とみなして着時刻は動かさない。
   *  通過駅・終着駅は抑止できないので、その駅の時刻ごとずらす（手前で徐行・抑止した扱い）。
   */
  function shiftFrom(train, pos, delta) {
    if (delta <= 0 || pos < 0) return;
    var head = train.stops[pos];
    var holdable = head.stop && head.arr != null && head.dep != null;
    for (var i = pos; i < train.stops.length; i++) {
      var s = train.stops[i];
      if (s.arr != null && (i > pos || !holdable)) s.arr += delta;
      if (s.dep != null) s.dep += delta;
      if (s.arr != null && s.dep != null && s.arr > s.dep) s.dep = s.arr;
    }
    train.depTime = train.stops[0].dep;
    train.arrTime = train.stops[train.stops.length - 1].arr;
  }

  function posOf(train, idx) {
    for (var i = 0; i < train.stops.length; i++) if (train.stops[i].idx === idx) return i;
    return -1;
  }

  var api = { simulate: simulate };
  root.DiaDisrupt = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
