/* 線区モデル
 *
 *  line = {
 *    name, company,
 *    stations: [{ id, name, kana, km, dwell, canTurn, canOvertake, depot }],
 *    sections: [{ runSec, single }]        // stations[i] → stations[i+1] の区間 (長さ = stations.length - 1)
 *  }
 *
 *  ・km は起点からのキロ程。区間長は km の差分から求める。
 *  ・runSec は「両端とも停車する列車」の基準運転時分（駅間の走行のみ、停車時分を含まない）。
 *  ・通過運転する列車は params.passSave 秒／片端 だけ運転時分を差し引く（加減速損失の戻り）。
 *  ・single = true の区間は単線。行き違いができないため検証で支障判定の対象になる。
 */
(function (root) {
  'use strict';

  /** 地方都市地下鉄を想定したサンプル線区（17駅・16.3km・全線複線） */
  function defaultLine() {
    var st = [
      // name,          kana,             km,   dwell, canTurn, canOvertake, depot
      ['西の丘',       'にしのおか',      0.0,  25, true,  false, true],
      ['桜台',         'さくらだい',      1.1,  20, false, false, false],
      ['泉が原',       'いずみがはら',    2.0,  20, false, false, false],
      ['中央病院前',   'ちゅうおうびょういんまえ', 2.9, 20, false, true, false],
      ['北大手',       'きたおおて',      4.0,  20, false, false, false],
      ['城址公園',     'じょうしこうえん', 4.9,  20, false, false, false],
      ['本町',         'ほんまち',        5.7,  25, false, false, false],
      ['中央',         'ちゅうおう',      6.6,  35, true,  true,  false],
      ['市役所前',     'しやくしょまえ',  7.5,  25, false, false, false],
      ['大和橋',       'やまとばし',      8.6,  20, false, false, false],
      ['東二番町',     'ひがしにばんちょう', 9.5, 20, false, false, false],
      ['みなと通',     'みなとどおり',   10.6,  20, false, false, false],
      ['港湾センター', 'こうわんセンター', 11.6, 20, false, false, false],
      ['潮見',         'しおみ',         12.8,  25, true,  true,  false],
      ['松風台',       'まつかぜだい',   14.0,  20, false, false, false],
      ['工大前',       'こうだいまえ',   15.1,  20, false, false, false],
      ['南浜',         'みなみはま',     16.3,  30, true,  false, true]
    ];
    var runSec = [115, 100, 100, 120, 100, 95, 100, 100, 120, 100, 120, 110, 125, 125, 120, 130];

    return {
      name: 'みどり線',
      company: '碧波市交通局',
      stations: st.map(function (r, i) {
        return {
          id: 'S' + pad2(i + 1),
          name: r[0], kana: r[1], km: r[2],
          dwell: r[3],
          canTurn: r[4], canOvertake: r[5], depot: r[6]
        };
      }),
      sections: runSec.map(function (s) { return { runSec: s, single: false }; })
    };
  }

  /** 種別の既定値（通過駅 skips は駅 id の配列） */
  function defaultTypes() {
    return [
      {
        id: 'local', name: '各駅停車', short: '各停', color: '#2563eb',
        numberBase: 0, skips: []
      },
      {
        id: 'rapid', name: '快速', short: '快速', color: '#dc2626',
        numberBase: 3000,
        skips: ['S02', 'S03', 'S06', 'S10', 'S11', 'S15', 'S16']
      }
    ];
  }

  /** 時間帯パターンの既定値。cycle は 1 巡分の列車構成 */
  function defaultPatterns(line) {
    var first = line.stations[0].id, last = line.stations[line.stations.length - 1].id;
    var all = { from: first, to: last };
    return [
      pat('早朝',   '05:00', '06:30', 12, [t('local', all)]),
      pat('朝ラッシュ', '06:30', '09:00', 5, [t('local', all), t('rapid', all), t('local', all)]),
      pat('昼間',   '09:00', '16:00', 10, [t('local', all), t('rapid', all)]),
      pat('夕ラッシュ', '16:00', '19:00', 6, [t('local', all), t('rapid', all), t('local', all)]),
      pat('夜間',   '19:00', '22:30', 10, [t('local', all)]),
      pat('深夜',   '22:30', '24:30', 15, [t('local', all)])
    ];
    function t(type, seg) { return { type: type, from: seg.from, to: seg.to }; }
    function pat(label, from, to, headwayMin, cycle) {
      return { id: 'P' + (label), label: label, from: from, to: to, headway: headwayMin * 60, cycle: cycle };
    }
  }

  /** ダイヤ計算パラメータの既定値 */
  function defaultParams() {
    return {
      passSave: 15,        // 通過による運転時分短縮（片端あたり・秒）
      minHeadway: 150,     // 同方向の最小運転時隔（秒）
      minTurn: 240,        // 最小折返し時分（秒）
      upOffset: 180,       // 上り初列車の下りに対するずらし（秒）
      roundTo: 5,          // 時刻の丸め単位（秒）。0 で丸めなし
      autoHold: true       // 待避・抑止の自動挿入
    };
  }

  /** 区間長 (km) */
  function sectionKm(line, i) {
    return round1(line.stations[i + 1].km - line.stations[i].km);
  }

  /** 全長 (km) */
  function totalKm(line) {
    return round1(line.stations[line.stations.length - 1].km - line.stations[0].km);
  }

  function stationIndex(line, id) {
    for (var i = 0; i < line.stations.length; i++) if (line.stations[i].id === id) return i;
    return -1;
  }

  /** 駅数の変更に合わせて sections の長さを整える */
  function normalize(line) {
    var need = Math.max(0, line.stations.length - 1);
    while (line.sections.length < need) line.sections.push({ runSec: 120, single: false });
    line.sections.length = need;
    return line;
  }

  function round1(v) { return Math.round(v * 10) / 10; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  var api = {
    defaultLine: defaultLine,
    defaultTypes: defaultTypes,
    defaultPatterns: defaultPatterns,
    defaultParams: defaultParams,
    sectionKm: sectionKm,
    totalKm: totalKm,
    stationIndex: stationIndex,
    normalize: normalize
  };

  root.DiaLine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
