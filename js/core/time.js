/* 時刻ユーティリティ
 * 内部表現は「その日の 00:00 を 0 とする秒数」。
 * 終電が翌日にまたがる場合は 24:00 を超える値（例 25:12 = 90720）をそのまま用いる。
 */
(function (root) {
  'use strict';

  var DAY = 86400;

  /** "5:30" / "05:30" / "25:12:30" → 秒。解釈できなければ null */
  function parseTime(str) {
    if (typeof str === 'number' && isFinite(str)) return Math.round(str);
    if (typeof str !== 'string') return null;
    var m = /^\s*(\d{1,2})\s*[:：]\s*(\d{1,2})(?:\s*[:：]\s*(\d{1,2}))?\s*$/.exec(str);
    if (!m) return null;
    var h = parseInt(m[1], 10), mi = parseInt(m[2], 10), s = m[3] ? parseInt(m[3], 10) : 0;
    if (mi > 59 || s > 59) return null;
    return h * 3600 + mi * 60 + s;
  }

  /** 秒 → "HH:MM"（withSec 指定時は "HH:MM:SS"）。24時以降も 25:12 のように表示 */
  function fmtTime(sec, withSec) {
    if (sec == null || !isFinite(sec)) return '';
    var t = Math.round(sec);
    var neg = t < 0;
    if (neg) t = -t;
    var h = Math.floor(t / 3600), mi = Math.floor((t % 3600) / 60), s = t % 60;
    var out = pad2(h) + ':' + pad2(mi) + (withSec ? ':' + pad2(s) : '');
    return (neg ? '-' : '') + out;
  }

  /** 拘束時間など長い時分の表記。1 時間以上なら "8時間18分"、未満なら "45分" */
  function fmtHM(sec) {
    var t = Math.round(sec || 0);
    var sign = t < 0 ? '-' : '';
    t = Math.abs(t);
    var h = Math.floor(t / 3600), m = Math.round((t % 3600) / 60);
    if (m === 60) { h++; m = 0; }
    return sign + (h ? h + '時間' + (m ? m + '分' : '') : m + '分');
  }

  /** 秒 → 時刻表用の「分」表記。秒が 0 でなければ小さく秒を添えるための分解 */
  function splitTime(sec) {
    var t = Math.round(sec);
    return { h: Math.floor(t / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 };
  }

  /** 所要時分 秒 → "35分20秒" / "35分" */
  function fmtDuration(sec) {
    var t = Math.round(sec);
    var sign = t < 0 ? '-' : '';
    t = Math.abs(t);
    var m = Math.floor(t / 60), s = t % 60;
    return sign + (s ? m + '分' + s + '秒' : m + '分');
  }

  /** "3分30秒" 形式ではなく分入力（"2.5" → 150秒）を許容するパーサ */
  function parseMinutes(str) {
    var v = parseFloat(str);
    if (!isFinite(v)) return null;
    return Math.round(v * 60);
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  var api = {
    DAY: DAY,
    parseTime: parseTime,
    fmtTime: fmtTime,
    splitTime: splitTime,
    fmtDuration: fmtDuration,
    fmtHM: fmtHM,
    parseMinutes: parseMinutes
  };

  root.DiaTime = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
