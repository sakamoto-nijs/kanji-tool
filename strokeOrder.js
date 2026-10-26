// strokeOrder.js — 書き順の判定ロジック（画面に依存しない関数だけ）。
// 通常の <script src="strokeOrder.js"> で読み込めば window.StrokeOrder に入る。
// Node.js では require("./strokeOrder.js") でも使える（テスト用）。
// 座標はすべて、書き順データと同じ 0〜109 の正方形の中の値。
(function (root) {
'use strict';

// SVGパス（M・m・L・l・H・h・V・v・C・c・S・s・Z に対応）を、点の列（折れ線）にする。1つの画＝1本の線。
function pathToPolyline(d, curveSteps = 12) {
  const tokens = String(d).match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  const pts = [];
  let i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0, lastC2 = null;
  const num = () => parseFloat(tokens[i++]);
  const isCmd = (tk) => /^[A-Za-z]$/.test(tk);
  const bez = (x0, y0, x1, y1, x2, y2, x3, y3) => {
    for (let s = 1; s <= curveSteps; s++) {
      const t = s / curveSteps, u = 1 - t;
      pts.push([
        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      ]);
    }
  };
  while (i < tokens.length) {
    if (isCmd(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === "M") {
      const nx = num(), ny = num();
      x = rel ? x + nx : nx; y = rel ? y + ny : ny; sx = x; sy = y;
      pts.push([x, y]); lastC2 = null;
      cmd = rel ? "l" : "L"; // M の後ろに続く座標は L として扱う
    } else if (C === "L") {
      const nx = num(), ny = num();
      x = rel ? x + nx : nx; y = rel ? y + ny : ny; pts.push([x, y]); lastC2 = null;
    } else if (C === "H") {
      const nx = num(); x = rel ? x + nx : nx; pts.push([x, y]); lastC2 = null;
    } else if (C === "V") {
      const ny = num(); y = rel ? y + ny : ny; pts.push([x, y]); lastC2 = null;
    } else if (C === "C") {
      const a = num(), b = num(), c = num(), dd = num(), e = num(), f = num();
      const x1 = rel ? x + a : a, y1 = rel ? y + b : b, x2 = rel ? x + c : c, y2 = rel ? y + dd : dd, x3 = rel ? x + e : e, y3 = rel ? y + f : f;
      bez(x, y, x1, y1, x2, y2, x3, y3);
      lastC2 = [x2, y2]; x = x3; y = y3;
    } else if (C === "S") {
      const c = num(), dd = num(), e = num(), f = num();
      const x1 = lastC2 ? 2 * x - lastC2[0] : x, y1 = lastC2 ? 2 * y - lastC2[1] : y;
      const x2 = rel ? x + c : c, y2 = rel ? y + dd : dd, x3 = rel ? x + e : e, y3 = rel ? y + f : f;
      bez(x, y, x1, y1, x2, y2, x3, y3);
      lastC2 = [x2, y2]; x = x3; y = y3;
    } else if (C === "Z") {
      x = sx; y = sy; pts.push([x, y]);
    } else {
      throw new Error("未対応のパスコマンド: " + cmd);
    }
  }
  return pts;
}

function polylineLength(pts) {
  let len = 0;
  for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
  return len;
}

// 線の長さに沿って、等間隔に n 個の点を取り直す
function resample(pts, n = 24) {
  if (!pts.length) return [];
  if (pts.length === 1) return Array.from({ length: n }, () => [pts[0][0], pts[0][1]]);
  const total = polylineLength(pts);
  if (total === 0) return Array.from({ length: n }, () => [pts[0][0], pts[0][1]]);
  const out = [[pts[0][0], pts[0][1]]];
  const step = total / (n - 1);
  let acc = 0, target = step;
  for (let k = 1; k < pts.length && out.length < n; k++) {
    const [ax, ay] = pts[k - 1], [bx, by] = pts[k];
    const seg = Math.hypot(bx - ax, by - ay);
    while (seg > 0 && acc + seg >= target - 1e-9 && out.length < n) {
      const r = (target - acc) / seg;
      out.push([ax + (bx - ax) * r, ay + (by - ay) * r]);
      target += step;
    }
    acc += seg;
  }
  while (out.length < n) out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
  return out;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const centroid = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
const meanDist = (a, b) => a.reduce((s, p, k) => s + dist(p, b[k]), 0) / a.length;

// 判定のゆるさ（実際に使ってみて調整する値）
const JUDGE = {
  dotLength: 18,        // これより短い画は「点」として、場所だけ見る
  dotCenter: 16,        // 点：中心のズレの許容
  dotMaxLen: 40,        // 点：書いた線の長さの上限
  minLenRatio: 0.45,    // 書いた線が、手本の線の何割より短いと不合格か
  maxLenRatio: 2.2,     // 書いた線が、手本の線の何倍より長いと不合格か
  meanDist: 14,         // 形：手本との平均のズレ（上限）
  meanDistRatio: 0.30,  // 形：手本の長さに対する平均のズレの許容（長さ×この値。上限は meanDist、下限は meanDistMin）
  meanDistMin: 8,       // 形：平均のズレの許容の下限（短い画でもこれ以下にはしない）
  startDist: 22,        // 書きはじめの位置のズレ
  endDist: 24,          // 書きおわりの位置のズレ
  betterRatio: 1.25,    // ほかの画のほうが「この倍率より」よく合うなら、書き順ちがいとみなす
  betterMargin: 1.5,    // 同じく、これ以上の差があるときだけ
};

// 書いた線 userPts が、手本の1画 targetPts にどれだけ近いか。合わなければ null、合えば「小さいほどよく合う」数値。
function strokeCost(userPts, targetPts, J = JUDGE) {
  if (!userPts || userPts.length === 0) return null;
  const lenT = polylineLength(targetPts);
  const lenU = polylineLength(userPts);
  if (lenT < J.dotLength) {
    const d = dist(centroid(userPts), centroid(targetPts));
    return d <= J.dotCenter && lenU <= J.dotMaxLen ? d : null;
  }
  if (lenU < lenT * J.minLenRatio || lenU > lenT * J.maxLenRatio) return null;
  const u = resample(userPts, 24), t = resample(targetPts, 24);
  const forward = meanDist(u, t);
  const backward = meanDist(u, t.slice().reverse());
  const tol = Math.max(J.meanDistMin, Math.min(J.meanDist, lenT * J.meanDistRatio));
  if (forward > tol || forward >= backward) return null; // ずれが大きい、または向きが逆
  const ds = dist(u[0], t[0]), de = dist(u[u.length - 1], t[t.length - 1]);
  if (ds > J.startDist || de > J.endDist) return null;
  return forward + 0.25 * (ds + de);
}

// 書いた1本の線が、手本の1画と合っているか（true / false）
function strokeMatches(userPts, targetPts, J = JUDGE) {
  return strokeCost(userPts, targetPts, J) !== null;
}

// 判定：次に書くはずの画 expectedIdx に対して、書いた線がどう見えるか
//   "ok"    … 合っている
//   "order" … ほかの（まだ書いていない）画のほうが合う＝書き順がちがう
//   "shape" … どの画にも合わない（形・向き・位置がちがう）
function judgeStroke(userPts, strokes, expectedIdx, J = JUDGE) {
  const ce = strokeCost(userPts, strokes[expectedIdx], J);
  let best = null, bestCost = Infinity;
  for (let k = expectedIdx + 1; k < strokes.length; k++) {
    const c = strokeCost(userPts, strokes[k], J);
    if (c !== null && c < bestCost) { bestCost = c; best = k; }
  }
  if (ce === null) return best === null ? "shape" : "order";
  if (best !== null && ce > bestCost * J.betterRatio + J.betterMargin) return "order";
  return "ok";
}

// 文字の画をまとめて折れ線にする（KANA_STROKES[文字] → [[点,点,…], …]）
function strokesToPolylines(pathList) {
  return (pathList || []).map((d) => pathToPolyline(d));
}

var api = { pathToPolyline: pathToPolyline, polylineLength: polylineLength, resample: resample,
  JUDGE: JUDGE, strokeCost: strokeCost, strokeMatches: strokeMatches, judgeStroke: judgeStroke, strokesToPolylines: strokesToPolylines };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.StrokeOrder = api;
})(typeof window !== 'undefined' ? window : globalThis);
