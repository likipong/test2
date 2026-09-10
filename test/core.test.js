'use strict';
const test = require('node:test');
const assert = require('node:assert');

const T = require('../js/core/time.js');
const Line = require('../js/core/line.js');
const Sch = require('../js/core/schedule.js');
const Op = require('../js/core/operation.js');
const Val = require('../js/core/validate.js');
const Dis = require('../js/core/disrupt.js');
const Crew = require('../js/core/crew.js');
const Ex = require('../js/core/exporters.js');

function baseState(over) {
  const line = Line.defaultLine();
  return Object.assign({
    line,
    types: Line.defaultTypes(),
    patterns: Line.defaultPatterns(line),
    params: Line.defaultParams()
  }, over || {});
}

test('時刻の解釈と表示', () => {
  assert.equal(T.parseTime('5:30'), 19800);
  assert.equal(T.parseTime('25:12'), 90720);          // 翌日にまたがる時刻
  assert.equal(T.parseTime('05:30:20'), 19820);
  assert.equal(T.parseTime('12:60'), null);
  assert.equal(T.fmtTime(90720), '25:12');
  assert.equal(T.fmtDuration(2110), '35分10秒');
  assert.equal(T.fmtDuration(2100), '35分');
});

test('サンプル線区の諸元', () => {
  const line = Line.defaultLine();
  assert.equal(line.stations.length, 17);
  assert.equal(line.sections.length, 16);
  assert.equal(Line.totalKm(line), 16.3);
  assert.ok(line.stations.some(s => s.depot), '車庫のある駅が要る');
  assert.ok(line.stations.filter(s => s.canOvertake).length >= 2, '待避可能駅が要る');
});

test('各停より快速のほうが速く、通過駅には時刻が立たない', () => {
  const st = baseState();
  st.params.autoHold = false;
  const { trains } = Sch.buildTimetable(st);
  const local = trains.find(t => t.typeId === 'local' && t.dir === 'down');
  const rapid = trains.find(t => t.typeId === 'rapid' && t.dir === 'down');
  const ride = t => t.arrTime - t.depTime;
  assert.ok(ride(rapid) < ride(local), '快速が各停より速いこと');
  // 通過駅は stop=false
  const skipped = Sch.stopAt(rapid, Line.stationIndex(st.line, 'S02'));
  assert.equal(skipped.stop, false);
  assert.equal(skipped.arr, skipped.dep);
  // 始発・終着は必ず停車
  assert.equal(rapid.stops[0].stop, true);
  assert.equal(rapid.stops[rapid.stops.length - 1].stop, true);
});

test('時刻は単調増加し、丸め単位に乗る', () => {
  const st = baseState();
  const { trains } = Sch.buildTimetable(st);
  for (const tr of trains) {
    let prev = -1;
    for (const s of tr.stops) {
      for (const v of [s.arr, s.dep]) {
        if (v == null) continue;
        assert.ok(v >= prev, `${tr.no}列車の時刻が逆行している`);
        assert.equal(v % st.params.roundTo, 0, '丸め単位に乗っていない');
        prev = v;
      }
    }
  }
});

test('列車番号は下り奇数・上り偶数', () => {
  const { trains } = Sch.buildTimetable(baseState());
  for (const t of trains) {
    assert.equal(t.no % 2, t.dir === 'down' ? 1 : 0, `${t.no}列車の番号が方向と合わない`);
  }
  assert.equal(new Set(trains.map(t => t.no)).size, trains.length, '列車番号が重複している');
});

test('待避の自動挿入で支障が解消される', () => {
  const off = baseState(); off.params.autoHold = false;
  const on = baseState();  on.params.autoHold = true;
  const errsOf = st => {
    const { trains } = Sch.buildTimetable(st);
    const { duties } = Op.assignDuties(st.line, trains, st.params);
    return Val.validate(st.line, trains, duties, st.params).filter(i => i.level === 'error').length;
  };
  const before = errsOf(off), after = errsOf(on);
  assert.ok(before > 0, '待避なしでは支障が出るはず');
  assert.equal(after, 0, `待避挿入後は支障ゼロのはず（${after}件残った）`);
});

test('待避は待避可能駅でのみ行われる', () => {
  const st = baseState();
  const { trains } = Sch.buildTimetable(st);
  for (const tr of trains) {
    for (const hold of (tr.holds || [])) {
      assert.ok(st.line.stations[hold.idx].canOvertake,
        `${st.line.stations[hold.idx].name}は待避可能駅ではない`);
    }
  }
});

test('運用は全列車を過不足なく含み、折返し時分を守る', () => {
  const st = baseState();
  const { trains } = Sch.buildTimetable(st);
  const { duties, dutyOf } = Op.assignDuties(st.line, trains, st.params);
  const used = duties.reduce((a, d) => a + d.trains.length, 0);
  assert.equal(used, trains.length, '全列車が運用に入ること');
  assert.equal(new Set(duties.flatMap(d => d.trains.map(t => t.no))).size, trains.length, '列車の重複割当がないこと');
  for (const d of duties) {
    for (let i = 0; i < d.trains.length - 1; i++) {
      const a = d.trains[i], b = d.trains[i + 1];
      assert.equal(a.toIdx, b.fromIdx, '折返し駅が連続していること');
      assert.ok(b.depTime - a.arrTime >= st.params.minTurn, '最小折返し時分を満たすこと');
    }
    assert.ok(dutyOf.get(d.trains[0]) === d);
  }
  assert.ok(duties.length >= 10 && duties.length <= 30, `必要編成数が現実的な範囲（${duties.length}）`);
});

test('単線にすると正面支障を検出する', () => {
  const st = baseState();
  st.line.sections[8].single = true;
  const { trains } = Sch.buildTimetable(st);
  const { duties } = Op.assignDuties(st.line, trains, st.params);
  const issues = Val.validate(st.line, trains, duties, st.params);
  const single = issues.filter(i => i.kind === '単線支障');
  assert.ok(single.length > 0, '単線区間の支障を検出すること');
  assert.ok(single.some(i => /正面支障/.test(i.msg)), '対向列車の支障を含むこと');
});

test('折返し設備のない駅を終端にすると支障になる', () => {
  const st = baseState();
  st.line.stations[16].canTurn = false;
  st.line.stations[16].depot = false;
  const { trains } = Sch.buildTimetable(st);
  const issues = Val.validate(st.line, trains, null, st.params);
  assert.ok(issues.some(i => i.kind === '折返し設備'), '折返し設備の支障を検出すること');
});

test('遅延は後続と折返しへ波及し、やがて収まる', () => {
  const st = baseState();
  const { trains } = Sch.buildTimetable(st);
  const { duties } = Op.assignDuties(st.line, trains, st.params);
  const target = trains.find(t => t.dir === 'down' && t.depTime >= 25200); // 朝ラッシュ
  const res = Dis.simulate(st.line, trains, duties, st.params, target.no, 300);

  assert.ok(res, 'シミュレーション結果が返ること');
  const self = res.delays.find(d => d.no === target.no);
  assert.equal(self.delay, 300, '対象列車には与えた遅延がそのまま乗ること');
  assert.ok(res.stats.affected > 0, '後続へ波及すること');
  assert.ok(res.stats.maxDelay <= 300 + 1, '波及先の遅延が与えた遅延を超えないこと');

  // 波及後も最小運転時隔は守られている
  for (const row of [0, 8, 16]) {
    const list = res.trains.filter(t => t.dir === 'down' && Sch.timeAt(t, row) != null)
      .map(t => Sch.timeAt(t, row)).sort((a, b) => a - b);
    for (let i = 1; i < list.length; i++) {
      assert.ok(list[i] - list[i - 1] >= st.params.minHeadway - 1,
        '波及後も最小運転時隔を満たすこと');
    }
  }
  // 遅延していない列車の時刻は動かない
  const untouched = res.trains.find(t => !res.delays.some(d => d.no === t.no));
  const orig = trains.find(t => t.no === untouched.no);
  assert.deepEqual(untouched.stops, orig.stops);
});

function withCrew(st) {
  const { trains } = Sch.buildTimetable(st);
  const { duties } = Op.assignDuties(st.line, trains, st.params);
  const crew = Crew.buildCrewDuties(st.line, trains, duties, st.params);
  return { trains, sets: duties, crew: crew.duties, cp: crew.params };
}

test('仕業は全列車を過不足なく受け持つ', () => {
  const st = baseState();
  const { trains, crew } = withCrew(st);
  const covered = crew.reduce((a, d) => a + d.trains.length, 0);
  assert.equal(covered, trains.length, '全列車に乗務員がつくこと');
  assert.equal(new Set(crew.flatMap(d => d.trains.map(t => t.no))).size, trains.length, '二重乗務がないこと');
  assert.ok(crew.length >= 20 && crew.length <= 60, `仕業数が現実的な範囲（${crew.length}）`);
});

test('仕業は拘束・乗務・連続乗務の上限を守る', () => {
  const st = baseState();
  const { crew, cp } = withCrew(st);
  for (const d of crew) {
    assert.ok(d.spreadSec <= cp.maxSpread, `仕業${d.no}の拘束 ${d.spreadSec} が上限超え`);
    assert.ok(d.driveSec <= cp.maxDrive, `仕業${d.no}の実乗務 ${d.driveSec} が上限超え`);
    assert.equal(d.signOff - d.signOn, d.spreadSec);

    let cont = 0, worst = 0;
    for (const l of d.legs) {
      if (l.kind === 'train') { cont += l.arr - l.dep; worst = Math.max(worst, cont); }
      else if (l.kind === 'break') cont = 0;
    }
    assert.ok(worst <= cp.maxContinuous, `仕業${d.no}の連続乗務 ${worst} が上限超え`);
  }
  assert.equal(Crew.checkCrew(st.line, crew, cp).filter(i => i.level === 'error').length, 0);
});

test('仕業は乗務員基地で始まり乗務員基地で終わる', () => {
  const st = baseState();
  const { crew } = withCrew(st);
  for (const d of crew) {
    assert.ok(st.line.stations[d.startIdx].crewBase, `仕業${d.no}の出勤駅が基地でない`);
    assert.ok(st.line.stations[d.endIdx].crewBase, `仕業${d.no}の退勤駅が基地でない`);
    assert.equal(d.warns.length, 0, `仕業${d.no}に警告が出ている: ${d.warns}`);
  }
});

test('行路は時系列に並び、乗務の間に交代時分がある', () => {
  const st = baseState();
  const { crew, sets, cp } = withCrew(st);
  const nextInSet = {};
  for (const s of sets) for (let i = 0; i < s.trains.length - 1; i++) nextInSet[s.trains[i].no] = s.trains[i + 1].no;

  for (const d of crew) {
    let prev = d.signOn;
    for (const l of d.legs) {
      const from = l.kind === 'train' ? l.dep : (l.time != null ? l.time : l.from);
      assert.ok(from >= prev, `仕業${d.no}の行路が逆行している`);
      prev = l.kind === 'train' ? l.arr : (l.time != null ? l.time : l.to);
    }
    for (let i = 0; i < d.trains.length - 1; i++) {
      const a = d.trains[i], b = d.trains[i + 1];
      assert.equal(a.toIdx, b.fromIdx, '乗り継ぐ駅が一致すること');
      const gap = b.depTime - a.arrTime;
      if (nextInSet[a.no] !== b.no) {
        assert.ok(gap >= cp.minRelief, `仕業${d.no}の交代時分 ${gap} が不足`);
      }
      assert.ok(gap >= 0);
    }
  }
});

test('拘束時間の上限を締めると仕業数が増える', () => {
  const loose = baseState();
  const tight = baseState();
  tight.params.crew = Object.assign({}, tight.params.crew, { maxSpread: 6 * 3600 });
  assert.ok(withCrew(tight).crew.length > withCrew(loose).crew.length,
    '条件を厳しくすれば必要な仕業は増えるはず');
});

test('乗務員基地のない駅で終わる仕業には警告が出る', () => {
  const st = baseState();
  st.line.stations.forEach(s => { s.crewBase = false; });
  st.line.stations[8].crewBase = true;   // 途中駅だけを基地にする
  const { crew } = withCrew(st);
  assert.ok(crew.some(d => d.warns.length > 0), '基地外で始終端になる仕業を警告すること');
});

test('仕業 CSV と行路表が生成できる', () => {
  const st = baseState();
  const { crew } = withCrew(st);
  const csv = Ex.crewCSV(st.line, crew);
  assert.equal(csv.split('\r\n').length, crew.length + 1);
  assert.ok(csv.startsWith('仕業,区分,出勤,'));
  const sheet = Ex.crewSheetText(st.line, crew[0], st.types);
  assert.ok(sheet.includes('出勤'));
  assert.ok(sheet.includes('退勤'));
  assert.ok(/列車/.test(sheet));
});

test('走行中の列車に遅延を与えても波及が発散しない', () => {
  const st = baseState();
  const { trains } = Sch.buildTimetable(st);
  const { duties } = Op.assignDuties(st.line, trains, st.params);

  // 待避のある朝ラッシュ帯を含む数点で、途中駅から遅延を与える
  for (const clock of ['07:30', '08:15', '17:00']) {
    const t = T.parseTime(clock);
    const online = Sch.onlineAt(st.line, trains, t);
    assert.ok(online.length, `${clock} に在線列車があること`);
    for (const o of [online[0], online[Math.floor(online.length / 2)], online[online.length - 1]]) {
      const res = Dis.simulate(st.line, trains, duties, st.params, o.train.no, 300, o.pos.next);
      assert.ok(res, 'シミュレーションが成立すること');
      assert.ok(res.stats.maxDelay <= 300 + 1,
        `${clock} ${o.train.no}列車: 波及先の遅延 ${res.stats.maxDelay} が与えた遅延を超えた`);
      assert.ok(res.stats.affected < trains.length / 2,
        `${clock} ${o.train.no}列車: ${res.stats.affected} 本に波及していて多すぎる`);
      for (const c of res.trains) {
        assert.ok(Number.isFinite(c.arrTime) && c.arrTime < 60 * 3600,
          `${c.no}列車の時刻が発散している`);
      }
    }
  }
});

test('遅延しても計画ダイヤ上の順序が入れ替わらない', () => {
  const st = baseState();
  const { trains } = Sch.buildTimetable(st);
  const { duties } = Op.assignDuties(st.line, trains, st.params);
  const target = trains.find(t => t.dir === 'down' && t.depTime >= 27000);
  const res = Dis.simulate(st.line, trains, duties, st.params, target.no, 240);
  const after = {};
  res.trains.forEach(t => { after[t.no] = t; });

  for (let idx = 0; idx < st.line.stations.length; idx++) {
    for (const dir of ['down', 'up']) {
      const planned = trains.filter(t => t.dir === dir && Sch.timeAt(t, idx) != null)
        .sort((a, b) => Sch.timeAt(a, idx) - Sch.timeAt(b, idx));
      for (let i = 1; i < planned.length; i++) {
        const a = Sch.timeAt(after[planned[i - 1].no], idx);
        const b = Sch.timeAt(after[planned[i].no], idx);
        assert.ok(b >= a + st.params.minHeadway - 1,
          `${st.line.stations[idx].name}で${planned[i - 1].no}と${planned[i].no}の順序・時隔が崩れた`);
      }
    }
  }
});

test('保存した JSON を読み戻すと同じダイヤになる', () => {
  const st = baseState();
  const restored = Ex.fromJSON(Ex.toJSON(st));
  const a = Sch.buildTimetable(st).trains;
  const b = Sch.buildTimetable(restored).trains;
  assert.equal(a.length, b.length);
  assert.deepEqual(a.map(t => [t.no, t.depTime, t.arrTime]), b.map(t => [t.no, t.depTime, t.arrTime]));
});

test('CSV と発車時刻表が生成できる', () => {
  const st = baseState();
  const { trains } = Sch.buildTimetable(st);
  const csv = Ex.stationGridCSV(st.line, trains, st.types, 'down');
  const lines = csv.split('\r\n');
  assert.equal(lines.length, st.line.stations.length + 2, '見出し2行＋駅数の行');
  assert.ok(lines[0].startsWith('駅名,'));
  assert.ok(csv.includes('レ'), '通過は「レ」で表すこと');

  const board = Ex.departureBoardText(st.line, trains, st.types, 0, 'down');
  assert.ok(board.includes('西の丘'));
  assert.ok(/^\d\d \| /m.test(board), '時間ごとの行があること');
});

test('駅を追加・削除しても区間の数が保たれる', () => {
  const line = Line.defaultLine();
  line.stations.splice(5, 1);
  Line.normalize(line);
  assert.equal(line.sections.length, line.stations.length - 1);
  const st = { line, types: Line.defaultTypes(), patterns: Line.defaultPatterns(line), params: Line.defaultParams() };
  assert.doesNotThrow(() => Sch.buildTimetable(st));
});
