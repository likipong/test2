/* 乗務員仕業（行路）の組成
 *
 * 「運用」が編成の一日の動きを指すのに対し、「仕業」は乗務員ひとりの一日の勤務を指す。
 * 出勤・点呼から始まり、列車への乗務と交代・休憩をはさんで、退勤で終わる。
 *
 *   duty = {
 *     no, kind,                    kind: '早番'|'日勤'|'遅番'|'深夜'
 *     signOn, signOff,             出勤・退勤時刻
 *     startIdx, endIdx,            出勤・退勤する乗務員基地
 *     legs: [...],                 行路の内訳（出勤／乗務／待機／休憩／退勤）
 *     driveSec, spreadSec, breakSec, waitSec, trains: [train]
 *     warns: [文言]
 *   }
 *
 * 乗務員が交代できるのは乗務員基地（crewBase）のある駅だけ。列車の途中駅での交代は
 * 扱わないため、乗務の単位は 1 列車まるごとになる。
 */
(function (root) {
  'use strict';

  var T = root.DiaTime || (typeof require !== 'undefined' ? require('./time.js') : null);

  function defaultCrewParams() {
    return {
      prep: 1500,           // 出勤から初列車の発車まで（点呼・準備）
      wrap: 900,            // 最終列車の到着から退勤まで（後処理）
      minRelief: 480,       // 別の編成へ移るときの交代時分
      maxContinuous: 14400, // 休憩をはさまずに乗務できる上限
      minBreak: 2400,       // 休憩として認める最小の時分
      maxBreak: 7200,       // 休憩として認める最大の時分（これを超える待ちは組まない）
      maxSpread: 32400,     // 1 仕業の拘束時間の上限
      maxDrive: 21600       // 1 仕業の実乗務時間の上限
    };
  }

  /**
   * @param sets 編成運用（同一編成に続けて乗るときは折返し時分で足りる）
   */
  function buildCrewDuties(line, trains, sets, params) {
    var p = Object.assign(defaultCrewParams(), params.crew || {});
    var bases = {};
    line.stations.forEach(function (s, i) { if (s.crewBase) bases[i] = true; });
    var hasBase = Object.keys(bases).length > 0;

    // 同一編成の続きの列車
    var sameSetNext = {};
    (sets || []).forEach(function (d) {
      for (var i = 0; i < d.trains.length - 1; i++) sameSetNext[d.trains[i].no] = d.trains[i + 1].no;
    });

    var pool = trains.slice().sort(function (a, b) { return a.depTime - b.depTime || a.no - b.no; });
    var byOrigin = {};
    pool.forEach(function (t) { (byOrigin[t.fromIdx] = byOrigin[t.fromIdx] || []).push(t); });
    var used = new Set();

    var duties = [];
    pool.forEach(function (first) {
      if (used.has(first)) return;
      var duty = openDuty(first, p, line, bases);
      used.add(first);
      var cur = first;
      var contDrive = ride(first);

      for (;;) {
        var atIdx = cur.toIdx;
        var isBase = !!bases[atIdx];
        var next = pickNext(cur, byOrigin, used, sameSetNext, p, 0);
        if (!next) break;

        if (contDrive + ride(next) > p.maxContinuous) {
          // 続けては乗れない。基地なら休憩をはさんで乗り継げるか探す
          if (!isBase) break;
          next = pickNext(cur, byOrigin, used, sameSetNext, p, p.minBreak, p.maxBreak);
          if (!next) break;
        }

        var gap = next.depTime - cur.arrTime;
        if (gap > p.maxBreak) break;   // これ以上待たせるなら仕業を切る
        var isBreak = isBase && gap >= p.minBreak;

        if (next.arrTime + p.wrap - duty.signOn > p.maxSpread) break;
        if (duty.driveSec + ride(next) > p.maxDrive) break;
        if (!isBreak && contDrive + ride(next) > p.maxContinuous) break;

        if (gap > 0) {
          duty.legs.push({
            kind: isBreak ? 'break' : 'wait',
            atIdx: atIdx, from: cur.arrTime, to: next.depTime
          });
          if (isBreak) { duty.breakSec += gap; contDrive = 0; }
          else duty.waitSec += gap;
        }
        pushTrain(duty, next, line);
        used.add(next);
        contDrive += ride(next);
        cur = next;
      }

      // 基地でない駅で終わるなら、基地へ戻る列車に乗って帰所する
      if (hasBase && !bases[cur.toIdx]) {
        var back = pickReturn(cur, byOrigin, used, bases, sameSetNext, p);
        if (back && back.depTime - cur.arrTime > p.maxBreak) back = null;
        if (back) {
          if (back.depTime > cur.arrTime) {
            duty.legs.push({ kind: 'wait', atIdx: cur.toIdx, from: cur.arrTime, to: back.depTime });
            duty.waitSec += back.depTime - cur.arrTime;
          }
          pushTrain(duty, back, line);
          used.add(back);
          cur = back;
        }
      }

      closeDuty(duty, cur, p, line, bases);
      duties.push(duty);
    });

    duties.sort(function (a, b) { return a.signOn - b.signOn; });
    duties.forEach(function (d, i) { d.no = 101 + i; });

    var crewOf = new Map();
    duties.forEach(function (d) { d.trains.forEach(function (t) { crewOf.set(t, d); }); });

    return { duties: duties, crewOf: crewOf, params: p };
  }

  function ride(t) { return t.arrTime - t.depTime; }

  function openDuty(first, p, line, bases) {
    var duty = {
      no: 0, signOn: first.depTime - p.prep, signOff: 0,
      startIdx: first.fromIdx, endIdx: first.toIdx,
      legs: [{ kind: 'signon', atIdx: first.fromIdx, time: first.depTime - p.prep }],
      driveSec: 0, spreadSec: 0, breakSec: 0, waitSec: 0, trains: [], warns: []
    };
    pushTrain(duty, first, line);
    if (Object.keys(bases).length && !bases[first.fromIdx]) {
      duty.warns.push(line.stations[first.fromIdx].name + ' は乗務員基地ではないため、添乗で出向く必要があるよ');
    }
    return duty;
  }

  function pushTrain(duty, t, line) {
    duty.legs.push({
      kind: 'train', no: t.no, typeId: t.typeId, dir: t.dir,
      fromIdx: t.fromIdx, toIdx: t.toIdx, dep: t.depTime, arr: t.arrTime
    });
    duty.trains.push(t);
    duty.driveSec += ride(t);
  }

  function closeDuty(duty, cur, p, line, bases) {
    duty.endIdx = cur.toIdx;
    duty.signOff = cur.arrTime + p.wrap;
    duty.spreadSec = duty.signOff - duty.signOn;
    duty.legs.push({ kind: 'signoff', atIdx: cur.toIdx, time: duty.signOff });
    duty.kind = classify(duty.signOn, duty.signOff);
    if (Object.keys(bases).length && !bases[cur.toIdx]) {
      duty.warns.push(line.stations[cur.toIdx].name + ' は乗務員基地ではないため、添乗で帰所する必要があるよ');
    }
    if (duty.driveSec > p.maxContinuous && duty.breakSec < p.minBreak) {
      duty.warns.push('実乗務 ' + T.fmtHM(duty.driveSec) + ' に対して休憩が確保できていないよ');
    }
  }

  function classify(signOn, signOff) {
    var h = signOn / 3600;
    if (signOff >= 24 * 3600) return '深夜';
    if (h < 7) return '早番';
    if (h >= 15) return '遅番';
    return '日勤';
  }

  /** 次に乗る列車：同じ駅から、交代（または折返し）に必要な時分をあけて発車する最早の列車。
   *  minGap を渡すと休憩ぶんの待ちを、maxGap を渡すと待ちすぎの除外を加える。 */
  function pickNext(cur, byOrigin, used, sameSetNext, p, minGap, maxGap) {
    var cands = byOrigin[cur.toIdx] || [];
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (used.has(c)) continue;
      var need = Math.max(gapNeeded(cur, c, sameSetNext, p), minGap || 0);
      if (c.depTime < cur.arrTime + need) continue;
      if (maxGap && c.depTime > cur.arrTime + maxGap) return null;
      return c;
    }
    return null;
  }

  /** 同じ編成に乗り続けるなら折返し時分でよく、別の編成へ移るなら交代時分が要る */
  function gapNeeded(cur, next, sameSetNext, p) {
    return sameSetNext[cur.no] === next.no ? 0 : p.minRelief;
  }

  /** 帰所用：基地に着く列車のうち最早のもの */
  function pickReturn(cur, byOrigin, used, bases, sameSetNext, p) {
    var cands = byOrigin[cur.toIdx] || [];
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (used.has(c)) continue;
      if (!bases[c.toIdx]) continue;
      if (c.depTime < cur.arrTime + gapNeeded(cur, c, sameSetNext, p)) continue;
      return c;
    }
    return null;
  }

  /** 仕業全体の統計 */
  function crewStats(duties, p) {
    if (!duties.length) return { count: 0 };
    var drive = duties.reduce(function (a, d) { return a + d.driveSec; }, 0);
    var spread = duties.reduce(function (a, d) { return a + d.spreadSec; }, 0);
    var byKind = {};
    duties.forEach(function (d) { byKind[d.kind] = (byKind[d.kind] || 0) + 1; });
    return {
      count: duties.length,
      driveSec: drive,
      spreadSec: spread,
      avgDrive: Math.round(drive / duties.length),
      avgSpread: Math.round(spread / duties.length),
      maxSpread: Math.max.apply(null, duties.map(function (d) { return d.spreadSec; })),
      efficiency: spread ? Math.round(drive / spread * 1000) / 10 : 0,
      withBreak: duties.filter(function (d) { return d.breakSec >= (p ? p.minBreak : 0); }).length,
      byKind: byKind,
      warned: duties.filter(function (d) { return d.warns.length; }).length
    };
  }

  /** 仕業の検証（validate.js から呼ぶ） */
  function checkCrew(line, duties, p) {
    var issues = [];
    duties.forEach(function (d) {
      if (d.spreadSec > p.maxSpread) {
        issues.push({ level: 'error', kind: '拘束時間', time: d.signOn, trains: [],
          msg: '仕業' + d.no + ' の拘束時間が ' + T.fmtHM(d.spreadSec) +
            '（上限 ' + T.fmtHM(p.maxSpread) + '）' });
      }
      if (d.driveSec > p.maxDrive) {
        issues.push({ level: 'error', kind: '乗務時間', time: d.signOn, trains: [],
          msg: '仕業' + d.no + ' の実乗務が ' + T.fmtHM(d.driveSec) +
            '（上限 ' + T.fmtHM(p.maxDrive) + '）' });
      }
      // 休憩をはさまない連続乗務
      var cont = 0, over = 0;
      d.legs.forEach(function (l) {
        if (l.kind === 'train') { cont += l.arr - l.dep; over = Math.max(over, cont); }
        else if (l.kind === 'break') cont = 0;
      });
      if (over > p.maxContinuous) {
        issues.push({ level: 'error', kind: '連続乗務', time: d.signOn, trains: [],
          msg: '仕業' + d.no + ' の連続乗務が ' + T.fmtHM(over) +
            '（上限 ' + T.fmtHM(p.maxContinuous) + '）' });
      }
      d.warns.forEach(function (w) {
        issues.push({ level: 'warn', kind: '仕業', time: d.signOn, trains: [], msg: '仕業' + d.no + '：' + w });
      });
    });
    return issues;
  }

  var api = {
    defaultCrewParams: defaultCrewParams,
    buildCrewDuties: buildCrewDuties,
    crewStats: crewStats,
    checkCrew: checkCrew
  };
  root.DiaCrew = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
