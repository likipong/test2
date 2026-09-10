/* ダイヤ支障の検証
 *
 * 運行管理の観点で成立しないダイヤを洗い出す。
 *   1. 続行時隔     同一方向の続行列車が最小運転時隔を割り込んでいないか
 *   2. 追い抜き支障 待避設備のない駅・本線上で追い抜きが発生していないか
 *   3. 単線支障     単線区間を 2 本以上の列車が同時に占有していないか
 *   4. 折返し支障   折返し設備のない駅での折返し／折返し時分の不足
 *   5. 出入庫       車庫のない駅での運用の開始・終了（回送の要否）
 *
 * 返り値は { level: 'error'|'warn'|'info', kind, msg, time, trains: [no...] } の配列。
 */
(function (root) {
  'use strict';

  var Sch = root.DiaSchedule || (typeof require !== 'undefined' ? require('./schedule.js') : null);
  var Crew = root.DiaCrew || (typeof require !== 'undefined' ? require('./crew.js') : null);
  var T = root.DiaTime || (typeof require !== 'undefined' ? require('./time.js') : null);

  var PAIR_WINDOW = 3600; // 追い抜き判定で比較する列車間の発時刻差の上限（秒）

  function validate(line, trains, duties, params, crewDuties) {
    var issues = [];
    checkHeadway(line, trains, params, issues);
    checkOvertake(line, trains, issues);
    checkSingleTrack(line, trains, issues);
    checkTurnBack(line, trains, duties, params, issues);
    if (crewDuties && crewDuties.length) {
      var cp = Object.assign(Crew.defaultCrewParams(), params.crew || {});
      Crew.checkCrew(line, crewDuties, cp).forEach(function (i) { issues.push(i); });
    }
    issues.sort(function (a, b) {
      var rank = { error: 0, warn: 1, info: 2 };
      return rank[a.level] - rank[b.level] || (a.time || 0) - (b.time || 0);
    });
    return issues;
  }

  /* 1. 続行時隔 */
  function checkHeadway(line, trains, params, issues) {
    var min = params.minHeadway || 0;
    if (!min) return;
    line.stations.forEach(function (st, idx) {
      ['down', 'up'].forEach(function (dir) {
        var list = [];
        trains.forEach(function (tr) {
          if (tr.dir !== dir) return;
          var t = Sch.timeAt(tr, idx);
          if (t != null) list.push({ tr: tr, t: t });
        });
        list.sort(function (a, b) { return a.t - b.t; });
        for (var i = 1; i < list.length; i++) {
          var gap = list[i].t - list[i - 1].t;
          if (gap < min) {
            issues.push({
              level: gap <= 0 ? 'error' : 'warn',
              kind: '続行時隔',
              time: list[i].t,
              trains: [list[i - 1].tr.no, list[i].tr.no],
              msg: st.name + '（' + dirName(dir) + '）で ' + list[i - 1].tr.no + '列車と' +
                list[i].tr.no + '列車の時隔が ' + T.fmtDuration(gap) + '（最小 ' + T.fmtDuration(min) + '）'
            });
          }
        }
      });
    });
  }

  /* 2. 追い抜き */
  function checkOvertake(line, trains, issues) {
    ['down', 'up'].forEach(function (dir) {
      var list = trains.filter(function (t) { return t.dir === dir; })
        .sort(function (a, b) { return a.depTime - b.depTime; });
      for (var i = 0; i < list.length; i++) {
        for (var j = i + 1; j < list.length; j++) {
          var a = list[i], b = list[j];
          if (b.depTime - a.depTime > PAIR_WINDOW) break;
          var common = commonStations(a, b);
          if (common.length < 2) continue;
          var prevSign = sign(Sch.timeAt(b, common[0]) - Sch.timeAt(a, common[0]));
          for (var k = 1; k < common.length; k++) {
            var idx = common[k];
            var s = sign(Sch.timeAt(b, idx) - Sch.timeAt(a, idx));
            if (prevSign > 0 && s <= 0) {
              var st = line.stations[idx];
              var sa = Sch.stopAt(a, idx), sb = Sch.stopAt(b, idx);
              var validPass = st.canOvertake && sa.stop &&
                sa.arr != null && sb.arr != null && sa.arr < sb.arr && sa.dep > sb.dep;
              issues.push({
                level: validPass ? 'info' : 'error',
                kind: validPass ? '待避' : '追い抜き支障',
                time: Sch.timeAt(b, idx),
                trains: [a.no, b.no],
                msg: validPass
                  ? st.name + 'で ' + a.no + '列車が ' + b.no + '列車を待避（停車 ' +
                    T.fmtDuration(sa.dep - sa.arr) + '）'
                  : st.name + '付近で ' + b.no + '列車が ' + a.no + '列車を追い抜くけれど、' +
                    (st.canOvertake ? '待避の停車時分が取れていない' : 'この駅には待避設備がない')
              });
            }
            prevSign = s;
          }
        }
      }
    });
  }

  /* 3. 単線区間の占有 */
  function checkSingleTrack(line, trains, issues) {
    line.sections.forEach(function (sec, si) {
      if (!sec.single) return;
      var occ = [];
      trains.forEach(function (tr) {
        var lo = Math.min(tr.fromIdx, tr.toIdx), hi = Math.max(tr.fromIdx, tr.toIdx);
        if (si < lo || si + 1 > hi) return;
        var t1 = Sch.timeAt(tr, si), t2 = Sch.timeAt(tr, si + 1);
        if (t1 == null || t2 == null) return;
        occ.push({ tr: tr, s: Math.min(t1, t2), e: Math.max(t1, t2) });
      });
      occ.sort(function (a, b) { return a.s - b.s; });
      for (var i = 1; i < occ.length; i++) {
        if (occ[i].s < occ[i - 1].e) {
          issues.push({
            level: 'error',
            kind: '単線支障',
            time: occ[i].s,
            trains: [occ[i - 1].tr.no, occ[i].tr.no],
            msg: line.stations[si].name + '〜' + line.stations[si + 1].name + '（単線）を ' +
              occ[i - 1].tr.no + '列車と' + occ[i].tr.no + '列車が同時に占有（' +
              (occ[i - 1].tr.dir === occ[i].tr.dir ? '続行' : '正面支障') + '）'
          });
        }
      }
    });
  }

  /* 4. 折返し・5. 出入庫 */
  function checkTurnBack(line, trains, duties, params, issues) {
    trains.forEach(function (tr) {
      [['fromIdx', '始発'], ['toIdx', '終着']].forEach(function (p) {
        var st = line.stations[tr[p[0]]];
        if (!st.canTurn && !st.depot) {
          issues.push({
            level: 'error', kind: '折返し設備',
            time: p[0] === 'fromIdx' ? tr.depTime : tr.arrTime,
            trains: [tr.no],
            msg: tr.no + '列車の' + p[1] + '駅「' + st.name + '」には折返し設備がない'
          });
        }
      });
    });

    (duties || []).forEach(function (d) {
      d.links.forEach(function (lk) {
        if (lk.turn < (params.minTurn || 0)) {
          issues.push({
            level: 'error', kind: '折返し時分', time: lk.arr, trains: [],
            msg: '運用' + d.no + '：' + line.stations[lk.atIdx].name + 'の折返しが ' +
              T.fmtDuration(lk.turn) + '（最小 ' + T.fmtDuration(params.minTurn) + '）'
          });
        }
      });
      var s = line.stations[d.startIdx], e = line.stations[d.endIdx];
      if (!s.depot) {
        issues.push({ level: 'info', kind: '出庫', time: d.startTime, trains: [],
          msg: '運用' + d.no + ' は ' + s.name + ' 始まり。' + T.fmtTime(d.startTime) + ' までの出庫回送が要る' });
      }
      if (!e.depot) {
        issues.push({ level: 'info', kind: '入庫', time: d.endTime, trains: [],
          msg: '運用' + d.no + ' は ' + e.name + ' 終わり。' + T.fmtTime(d.endTime) + ' からの入庫回送が要る' });
      }
    });
  }

  function commonStations(a, b) {
    var lo = Math.max(Math.min(a.fromIdx, a.toIdx), Math.min(b.fromIdx, b.toIdx));
    var hi = Math.min(Math.max(a.fromIdx, a.toIdx), Math.max(b.fromIdx, b.toIdx));
    var out = [];
    if (a.dir === 'down') { for (var i = lo; i <= hi; i++) out.push(i); }
    else { for (var j = hi; j >= lo; j--) out.push(j); }
    return out;
  }

  function sign(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }
  function dirName(d) { return d === 'down' ? '下り' : '上り'; }

  function summarize(issues) {
    var s = { error: 0, warn: 0, info: 0 };
    issues.forEach(function (i) { s[i.level]++; });
    return s;
  }

  var api = { validate: validate, summarize: summarize };
  root.DiaValidate = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
