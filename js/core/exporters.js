/* 出力（CSV／JSON／発車時刻表テキスト） */
(function (root) {
  'use strict';

  var T = root.DiaTime || (typeof require !== 'undefined' ? require('./time.js') : null);
  var Sch = root.DiaSchedule || (typeof require !== 'undefined' ? require('./schedule.js') : null);

  function typeName(types, id) {
    for (var i = 0; i < types.length; i++) if (types[i].id === id) return types[i].short || types[i].name;
    return id;
  }

  /** 設定一式の JSON（アプリの保存形式） */
  function toJSON(state) {
    return JSON.stringify({
      format: 'dia-editor/1',
      savedAt: new Date().toISOString(),
      line: state.line, types: state.types, patterns: state.patterns, params: state.params
    }, null, 2);
  }

  function fromJSON(text) {
    var o = JSON.parse(text);
    if (!o || !o.line || !o.line.stations) throw new Error('ダイヤファイルとして読めない形式だよ');
    return { line: o.line, types: o.types, patterns: o.patterns, params: o.params };
  }

  /** 行 = 駅、列 = 列車の時刻表 CSV */
  function stationGridCSV(line, trains, types, dir) {
    var list = trains.filter(function (t) { return t.dir === dir; })
      .sort(function (a, b) { return a.depTime - b.depTime; });
    var rows = [];
    rows.push(['駅名'].concat(list.map(function (t) { return t.no; })));
    rows.push(['種別'].concat(list.map(function (t) { return typeName(types, t.typeId); })));
    var order = line.stations.map(function (_, i) { return i; });
    if (dir === 'up') order.reverse();
    order.forEach(function (idx) {
      var row = [line.stations[idx].name];
      list.forEach(function (t) {
        var s = Sch.stopAt(t, idx);
        if (!s) row.push('');
        else if (!s.stop) row.push('レ');
        else if (s.dep == null) row.push(T.fmtTime(s.arr) + '着');
        else row.push(T.fmtTime(s.dep));
      });
      rows.push(row);
    });
    return csv(rows);
  }

  /** 列車一覧 CSV */
  function trainListCSV(line, trains, types, dutyOf) {
    var rows = [['列車番号', '種別', '方向', '始発駅', '発', '終着駅', '着', '所要', '停車数', '運用']];
    trains.slice().sort(function (a, b) { return a.depTime - b.depTime; }).forEach(function (t) {
      var d = dutyOf ? dutyOf.get(t) : null;
      rows.push([
        t.no, typeName(types, t.typeId), t.dir === 'down' ? '下り' : '上り',
        line.stations[t.fromIdx].name, T.fmtTime(t.depTime),
        line.stations[t.toIdx].name, T.fmtTime(t.arrTime),
        T.fmtDuration(t.arrTime - t.depTime),
        t.stops.filter(function (s) { return s.stop; }).length,
        d ? d.no : ''
      ]);
    });
    return csv(rows);
  }

  /** 運用（編成運用）CSV */
  function dutyCSV(line, duties) {
    var rows = [['運用', '出庫駅', '出庫時刻', '入庫駅', '入庫時刻', '列車数', '行路']];
    duties.forEach(function (d) {
      rows.push([
        d.no, line.stations[d.startIdx].name, T.fmtTime(d.startTime),
        line.stations[d.endIdx].name, T.fmtTime(d.endTime),
        d.trains.length,
        d.trains.map(function (t) { return t.no; }).join(' → ')
      ]);
    });
    return csv(rows);
  }

  /** 仕業（乗務員行路）CSV */
  function crewCSV(line, duties) {
    var rows = [['仕業', '区分', '出勤', '出勤基地', '退勤', '退勤基地', '拘束', '実乗務', '休憩', '乗務列車数', '行路']];
    duties.forEach(function (d) {
      rows.push([
        d.no, d.kind, T.fmtTime(d.signOn), line.stations[d.startIdx].name,
        T.fmtTime(d.signOff), line.stations[d.endIdx].name,
        T.fmtHM(d.spreadSec), T.fmtHM(d.driveSec), T.fmtHM(d.breakSec),
        d.trains.length,
        d.legs.filter(function (l) { return l.kind === 'train' || l.kind === 'break'; })
          .map(function (l) {
            return l.kind === 'train' ? l.no : '休憩' + T.fmtDuration(l.to - l.from);
          }).join(' → ')
      ]);
    });
    return csv(rows);
  }

  /** 1 仕業の行路表（点呼で読み上げる体裁のプレーンテキスト） */
  function crewSheetText(line, duty, types) {
    var out = [line.name + '　仕業 ' + duty.no + '（' + duty.kind + '）', ''];
    out.push('出勤 ' + T.fmtTime(duty.signOn) + '　' + line.stations[duty.startIdx].name);
    duty.legs.forEach(function (l) {
      if (l.kind === 'train') {
        out.push('  ' + pad(l.no + '列車', 8) + pad(typeName(types, l.typeId), 5) +
          line.stations[l.fromIdx].name + ' ' + T.fmtTime(l.dep) + ' → ' +
          line.stations[l.toIdx].name + ' ' + T.fmtTime(l.arr));
      } else if (l.kind === 'break') {
        out.push('  《休憩 ' + T.fmtDuration(l.to - l.from) + '》 ' + line.stations[l.atIdx].name +
          ' ' + T.fmtTime(l.from) + '〜' + T.fmtTime(l.to));
      } else if (l.kind === 'wait') {
        out.push('  （待機 ' + T.fmtDuration(l.to - l.from) + '） ' + line.stations[l.atIdx].name);
      }
    });
    out.push('退勤 ' + T.fmtTime(duty.signOff) + '　' + line.stations[duty.endIdx].name);
    out.push('', '拘束 ' + T.fmtHM(duty.spreadSec) + '　実乗務 ' + T.fmtHM(duty.driveSec) +
      '　休憩 ' + T.fmtHM(duty.breakSec) + '　待機 ' + T.fmtHM(duty.waitSec));
    duty.warns.forEach(function (w) { out.push('※ ' + w); });
    return out.join('\n');
  }

  function pad(s, n) { while (s.length < n) s += ' '; return s; }

  /** 駅の発車時刻表（時刻表冊子の体裁のプレーンテキスト） */
  function departureBoardText(line, trains, types, idx, dir) {
    var st = line.stations[idx];
    var list = [];
    trains.forEach(function (t) {
      if (t.dir !== dir) return;
      var s = Sch.stopAt(t, idx);
      if (!s || !s.stop || s.dep == null) return;
      list.push({ t: s.dep, no: t.no, type: t.typeId, dest: line.stations[t.toIdx].name });
    });
    list.sort(function (a, b) { return a.t - b.t; });

    var byHour = {};
    list.forEach(function (e) {
      var h = Math.floor(e.t / 3600);
      (byHour[h] = byHour[h] || []).push(e);
    });

    var out = [line.name + ' ' + st.name + '駅　' + (dir === 'down' ? '下り' : '上り') + '　発車時刻表', ''];
    Object.keys(byHour).map(Number).sort(function (a, b) { return a - b; }).forEach(function (h) {
      var cells = byHour[h].map(function (e) {
        var mm = pad2(Math.floor((e.t % 3600) / 60));
        var mark = e.type === 'local' ? '' : '(' + typeName(types, e.type) + ')';
        return mm + mark;
      });
      out.push(pad2(h % 24) + ' | ' + cells.join('  '));
    });
    out.push('', '※ ( ) 内は種別。無印は各駅停車');
    return out.join('\n');
  }

  function csv(rows) {
    return rows.map(function (r) {
      return r.map(function (c) {
        var s = c == null ? '' : String(c);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\r\n');
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  var api = {
    toJSON: toJSON, fromJSON: fromJSON,
    stationGridCSV: stationGridCSV, trainListCSV: trainListCSV, dutyCSV: dutyCSV,
    crewCSV: crewCSV, crewSheetText: crewSheetText,
    departureBoardText: departureBoardText
  };
  root.DiaExport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
