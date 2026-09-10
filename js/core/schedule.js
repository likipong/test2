/* ダイヤ生成
 *
 * 時間帯パターン（運転間隔と 1 巡分の列車構成）から列車群を発生させ、
 * 線区諸元にもとづいて各駅の着発時刻を積み上げ計算する。
 *
 *  train = {
 *    no,                 列車番号（下り奇数／上り偶数）
 *    typeId, dir,        dir: 'down' = 起点→終点（キロ程の増える向き）
 *    patternId,
 *    fromIdx, toIdx,     運転区間（走行順。上りは fromIdx > toIdx）
 *    depTime, arrTime,   始発駅発／終着駅着
 *    stops: [{ idx, arr, dep, stop }]   走行順に並ぶ。stop=false は通過（arr=dep=通過時刻）
 *  }
 */
(function (root) {
  'use strict';

  var Line = root.DiaLine || (typeof require !== 'undefined' ? require('./line.js') : null);
  var T = root.DiaTime || (typeof require !== 'undefined' ? require('./time.js') : null);

  var MIN_RUN = 30; // 通過補正で運転時分が非現実的に短くならないための下限（秒）

  function buildTimetable(state) {
    var line = state.line, types = state.types, patterns = state.patterns, params = state.params;
    var typeMap = {};
    types.forEach(function (t) { typeMap[t.id] = t; });

    var trains = [];
    var notes = [];

    patterns.forEach(function (p) {
      var from = T.parseTime(p.from), to = T.parseTime(p.to);
      if (from == null || to == null || to <= from) {
        notes.push('パターン「' + p.label + '」の時間帯が不正なため生成をとばしたよ');
        return;
      }
      if (!p.headway || p.headway < 30) {
        notes.push('パターン「' + p.label + '」の運転間隔が不正だよ');
        return;
      }
      var cycle = (p.cycle || []).filter(function (c) { return typeMap[c.type]; });
      if (!cycle.length) return;

      ['down', 'up'].forEach(function (dir) {
        var t = from + (dir === 'up' ? (params.upOffset || 0) : 0);
        var k = 0;
        while (t < to) {
          var c = cycle[k % cycle.length];
          var tr = buildTrain(line, typeMap[c.type], params, dir, c.from, c.to, t, p.id);
          if (tr) trains.push(tr);
          k++;
          t += p.headway;
        }
      });
    });

    trains.sort(function (a, b) { return a.depTime - b.depTime; });
    numberTrains(trains, typeMap);

    var holdResult = { holds: 0, unresolved: [] };
    if (params.autoHold) {
      holdResult = applyHolds(line, trains, params);
      if (holdResult.holds) notes.push('待避・抑止を ' + holdResult.holds + ' 箇所に自動挿入したよ');
      holdResult.unresolved.forEach(function (u) { notes.push(u); });
    }

    return { trains: trains, notes: notes, holds: holdResult };
  }

  /** 1 列車を生成。segFrom/segTo は運転区間の駅 id（向きは問わない） */
  function buildTrain(line, type, params, dir, segFrom, segTo, depTime, patternId) {
    var a = Line.stationIndex(line, segFrom), b = Line.stationIndex(line, segTo);
    if (a < 0) a = 0;
    if (b < 0) b = line.stations.length - 1;
    var lo = Math.min(a, b), hi = Math.max(a, b);
    if (hi - lo < 1) return null;

    var fromIdx = dir === 'down' ? lo : hi;
    var toIdx = dir === 'down' ? hi : lo;
    var step = dir === 'down' ? 1 : -1;

    var skips = {};
    (type.skips || []).forEach(function (id) { skips[id] = true; });

    var stopsAt = function (idx) {
      if (idx === fromIdx || idx === toIdx) return true;   // 始発・終着は必ず停車
      return !skips[line.stations[idx].id];
    };

    var round = params.roundTo > 0 ? params.roundTo : 1;
    var stops = [];
    var t = roundTo(depTime, round);

    // 始発駅
    stops.push({ idx: fromIdx, arr: null, dep: t, stop: true });

    for (var i = fromIdx; i !== toIdx; i += step) {
      var next = i + step;
      var secIdx = Math.min(i, next);      // stations[secIdx] ↔ stations[secIdx+1]
      var run = line.sections[secIdx].runSec;
      if (!stopsAt(i)) run -= (params.passSave || 0);
      if (!stopsAt(next)) run -= (params.passSave || 0);
      run = Math.max(MIN_RUN, run);

      var arr = roundTo(t + run, round);
      if (next === toIdx) {
        stops.push({ idx: next, arr: arr, dep: null, stop: true });
        t = arr;
      } else if (stopsAt(next)) {
        var dep = roundTo(arr + (line.stations[next].dwell || 0), round);
        stops.push({ idx: next, arr: arr, dep: dep, stop: true });
        t = dep;
      } else {
        stops.push({ idx: next, arr: arr, dep: arr, stop: false });
        t = arr;
      }
    }

    return {
      no: 0,
      typeId: type.id,
      dir: dir,
      patternId: patternId,
      fromIdx: fromIdx,
      toIdx: toIdx,
      depTime: stops[0].dep,
      arrTime: stops[stops.length - 1].arr,
      stops: stops
    };
  }

  /** 列車番号を採番：種別ごとの号数帯 + 下り奇数／上り偶数 */
  function numberTrains(trains, typeMap) {
    var counters = {};
    trains.forEach(function (tr) {
      var key = tr.typeId + ':' + tr.dir;
      counters[key] = (counters[key] || 0) + 1;
      var base = (typeMap[tr.typeId] && typeMap[tr.typeId].numberBase) || 0;
      tr.no = base + (counters[key] - 1) * 2 + (tr.dir === 'down' ? 1 : 2);
    });
  }


  /* ---- 待避・抑止の自動挿入 ------------------------------------------------
   * 後続の速達列車が先行列車に最小運転時隔まで詰めてしまう箇所を探し、
   * その手前の待避可能駅で先行列車を抑止する。抑止すると先行列車の後ろへ
   * 影響が伝播するため、収束するまで数回まわす。
   */
  var HOLD_ITER = 8;          // 反復回数の上限
  var HOLD_WINDOW = 3600;     // 比較する列車ペアの発時刻差の上限（秒）
  var HOLD_MAX = 900;         // 1 箇所あたりの抑止時分の上限（秒）

  function applyHolds(line, trains, params) {
    var min = params.minHeadway || 0;
    var holds = 0;
    var unresolved = {};

    for (var iter = 0; iter < HOLD_ITER; iter++) {
      var changed = false;

      ['down', 'up'].forEach(function (dir) {
        var list = trains.filter(function (t) { return t.dir === dir; })
          .sort(function (a, b) { return a.depTime - b.depTime; });

        for (var i = 0; i < list.length; i++) {
          for (var j = i + 1; j < list.length; j++) {
            var a = list[i], b = list[j];
            if (b.depTime - a.depTime > HOLD_WINDOW) break;

            var common = commonRange(a, b);
            if (common.length < 2) continue;
            if (timeAt(b, common[0]) <= timeAt(a, common[0])) continue;  // b が先行しているなら対象外

            // b が a に詰める最初の駅
            var hit = -1;
            for (var k = 0; k < common.length; k++) {
              if (timeAt(b, common[k]) - timeAt(a, common[k]) < min) { hit = k; break; }
            }
            if (hit < 0) continue;

            // 速達側でなければ待避させても解決しない（純粋な時隔不足）
            if (!isFaster(a, b, common, hit)) {
              unresolved['h' + a.no + '-' + b.no] =
                a.no + '列車と' + b.no + '列車の時隔が確保できないよ（運転間隔か運転時分の見直しが要る）';
              continue;
            }

            // 支障地点の手前で、a が停車する待避可能駅を探す
            var zPos = -1;
            for (var m = hit; m >= 0; m--) {
              var idx = common[m];
              var sa = stopAt(a, idx);
              if (!sa || !sa.stop || sa.dep == null) continue;
              if (!line.stations[idx].canOvertake) continue;
              var tb = timeAt(b, idx);
              if (sa.arr != null && sa.arr > tb - min) continue;  // すでに b が先着している駅は使えない
              zPos = idx;
              break;
            }
            if (zPos < 0) {
              unresolved['o' + a.no + '-' + b.no] =
                b.no + '列車が' + a.no + '列車に追いつくけれど、手前に使える待避駅がないよ';
              continue;
            }

            var need = timeAt(b, zPos) + min;
            var sz = stopAt(a, zPos);
            if (sz.dep >= need) continue;
            if (need - sz.dep > HOLD_MAX) {
              unresolved['l' + a.no + '-' + b.no] =
                a.no + '列車の' + line.stations[zPos].name + 'での待避が ' +
                T.fmtDuration(need - sz.dep) + ' 必要で現実的でないよ';
              continue;
            }

            var pos = posOf(a, zPos);
            var extra = need - sz.dep;
            recomputeFrom(line, a, params, pos, need);
            (a.holds = a.holds || []).push({ idx: zPos, extra: extra, forNo: b.no });
            holds++;
            changed = true;
          }
        }
      });

      if (!changed) break;
    }

    return { holds: holds, unresolved: Object.keys(unresolved).map(function (k) { return unresolved[k]; }) };
  }

  /** 支障地点から終点までの残り所要時分を比べ、b の方が速いか */
  function isFaster(a, b, common, hit) {
    var last = common[common.length - 1];
    var ra = timeAt(a, last) - timeAt(a, common[hit]);
    var rb = timeAt(b, last) - timeAt(b, common[hit]);
    return rb < ra - 30;
  }

  /** 指定位置以降の時刻を積み上げ直す（k は stops のインデックス） */
  function recomputeFrom(line, tr, params, k, newDep) {
    var round = params.roundTo > 0 ? params.roundTo : 1;
    tr.stops[k].dep = roundTo(newDep, round);
    var t = tr.stops[k].dep;
    for (var m = k; m < tr.stops.length - 1; m++) {
      var i = tr.stops[m].idx, next = tr.stops[m + 1].idx;
      var run = line.sections[Math.min(i, next)].runSec;
      if (!tr.stops[m].stop) run -= (params.passSave || 0);
      if (!tr.stops[m + 1].stop) run -= (params.passSave || 0);
      run = Math.max(MIN_RUN, run);
      var arr = roundTo(t + run, round);
      tr.stops[m + 1].arr = arr;
      if (m + 1 === tr.stops.length - 1) { tr.stops[m + 1].dep = null; t = arr; }
      else if (tr.stops[m + 1].stop) { t = roundTo(arr + (line.stations[next].dwell || 0), round); tr.stops[m + 1].dep = t; }
      else { tr.stops[m + 1].dep = arr; t = arr; }
    }
    tr.depTime = tr.stops[0].dep;
    tr.arrTime = tr.stops[tr.stops.length - 1].arr;
  }

  /** 2 列車が共に通る駅を走行順に並べたもの */
  function commonRange(a, b) {
    var lo = Math.max(Math.min(a.fromIdx, a.toIdx), Math.min(b.fromIdx, b.toIdx));
    var hi = Math.min(Math.max(a.fromIdx, a.toIdx), Math.max(b.fromIdx, b.toIdx));
    var out = [];
    if (a.dir === 'down') { for (var i = lo; i <= hi; i++) out.push(i); }
    else { for (var j = hi; j >= lo; j--) out.push(j); }
    return out;
  }

  function posOf(train, idx) {
    for (var i = 0; i < train.stops.length; i++) if (train.stops[i].idx === idx) return i;
    return -1;
  }

  function roundTo(sec, unit) {
    return unit > 1 ? Math.round(sec / unit) * unit : Math.round(sec);
  }

  /** 列車の指定駅の時刻レコードを返す（通らない駅は null） */
  function stopAt(train, idx) {
    for (var i = 0; i < train.stops.length; i++) if (train.stops[i].idx === idx) return train.stops[i];
    return null;
  }

  /** 駅の「その駅を発車／通過する時刻」。終着駅は着時刻 */
  function timeAt(train, idx) {
    var s = stopAt(train, idx);
    if (!s) return null;
    return s.dep != null ? s.dep : s.arr;
  }

  /** ダイヤ全体の統計 */
  function stats(line, trains, duties) {
    var down = trains.filter(function (t) { return t.dir === 'down'; });
    var up = trains.filter(function (t) { return t.dir === 'up'; });
    var full = trains.filter(function (t) { return Math.abs(t.toIdx - t.fromIdx) === line.stations.length - 1; });
    var ride = full.map(function (t) { return t.arrTime - t.depTime; });
    var km = Line.totalKm(line);
    var minRide = ride.length ? Math.min.apply(null, ride) : 0;
    var maxRide = ride.length ? Math.max.apply(null, ride) : 0;
    return {
      total: trains.length,
      down: down.length,
      up: up.length,
      km: km,
      minRide: minRide,
      maxRide: maxRide,
      bestSpeed: minRide ? Math.round(km / (minRide / 3600) * 10) / 10 : 0,
      slowSpeed: maxRide ? Math.round(km / (maxRide / 3600) * 10) / 10 : 0,
      sets: duties ? duties.length : null,
      firstDep: trains.length ? trains[0].depTime : null,
      lastArr: trains.length ? Math.max.apply(null, trains.map(function (t) { return t.arrTime; })) : null
    };
  }

  var api = {
    buildTimetable: buildTimetable,
    buildTrain: buildTrain,
    applyHolds: applyHolds,
    recomputeFrom: recomputeFrom,
    stopAt: stopAt,
    timeAt: timeAt,
    stats: stats
  };

  root.DiaSchedule = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
