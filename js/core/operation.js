/* 車両運用（編成運用）の組成
 *
 * 到着した列車を、同一駅から最小折返し時分以降に発車する未割当列車へ順に接続していく
 * （最早発車優先の貪欲法）。組成されたチェーンの数がそのまま必要編成数になる。
 *
 *  duty = {
 *    no, trains: [train], startIdx, endIdx, startTime, endTime,
 *    links: [{ atIdx, arr, dep, turn }]   折返しの内訳
 *  }
 */
(function (root) {
  'use strict';

  function assignDuties(line, trains, params) {
    var minTurn = params.minTurn || 0;
    var pool = trains.slice().sort(function (a, b) { return a.depTime - b.depTime || a.no - b.no; });
    var used = new Set();

    // 「駅 → その駅を始発とする列車（発時刻順）」の索引
    var byOrigin = {};
    pool.forEach(function (t) {
      (byOrigin[t.fromIdx] = byOrigin[t.fromIdx] || []).push(t);
    });

    var duties = [];
    pool.forEach(function (first) {
      if (used.has(first)) return;
      used.add(first);

      var duty = { no: duties.length + 1, trains: [first], links: [] };
      var cur = first;
      for (;;) {
        var cands = byOrigin[cur.toIdx] || [];
        var next = null;
        for (var i = 0; i < cands.length; i++) {
          var c = cands[i];
          if (used.has(c)) continue;
          if (c.depTime < cur.arrTime + minTurn) continue;
          next = c;
          break; // 発時刻順に並んでいるため最初に見つかったものが最早
        }
        if (!next) break;
        used.add(next);
        duty.links.push({ atIdx: cur.toIdx, arr: cur.arrTime, dep: next.depTime, turn: next.depTime - cur.arrTime });
        duty.trains.push(next);
        cur = next;
      }

      duty.startIdx = first.fromIdx;
      duty.endIdx = cur.toIdx;
      duty.startTime = first.depTime;
      duty.endTime = cur.arrTime;
      duties.push(duty);
    });

    duties.sort(function (a, b) { return a.startTime - b.startTime; });
    duties.forEach(function (d, i) { d.no = i + 1; });

    // 列車から運用を引けるようにする
    var dutyOf = new Map();
    duties.forEach(function (d) { d.trains.forEach(function (t) { dutyOf.set(t, d); }); });

    return { duties: duties, dutyOf: dutyOf };
  }

  /** 時間帯ごとの在線本数（必要編成数の裏取り用） */
  function occupancyProfile(trains, stepSec) {
    var step = stepSec || 900;
    if (!trains.length) return [];
    var t0 = Math.min.apply(null, trains.map(function (t) { return t.depTime; }));
    var t1 = Math.max.apply(null, trains.map(function (t) { return t.arrTime; }));
    var out = [];
    for (var t = Math.floor(t0 / step) * step; t <= t1; t += step) {
      var n = 0;
      for (var i = 0; i < trains.length; i++) {
        if (trains[i].depTime <= t && t < trains[i].arrTime) n++;
      }
      out.push({ t: t, n: n });
    }
    return out;
  }

  /** 出入庫の要否（運用の始終端が車庫でなければ回送が要る） */
  function depotNeeds(line, duties) {
    var out = [];
    duties.forEach(function (d) {
      var s = line.stations[d.startIdx], e = line.stations[d.endIdx];
      if (!s.depot) out.push({ dutyNo: d.no, kind: '出庫', station: s.name, time: d.startTime });
      if (!e.depot) out.push({ dutyNo: d.no, kind: '入庫', station: e.name, time: d.endTime });
    });
    return out;
  }

  var api = { assignDuties: assignDuties, occupancyProfile: occupancyProfile, depotNeeds: depotNeeds };
  root.DiaOperation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
