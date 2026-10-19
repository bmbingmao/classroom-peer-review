/**
 * 去极值平均分（trimmed mean）—— 需求规格书 v2 §7.3
 *
 * 规则：
 *  - n < 5        → 不去极值，直接算术平均
 *  - n >= 5       → k = max(1, ceil(n*0.05))，并保证剩余个数 >= 3
 *  - 排序键 (score ASC, studentId ASC) 必须稳定，否则同分剔除对象会漂移
 *  - 剩余分数算术平均
 */

export type Entry = { studentId: number; score: number };

export function trimCount(n: number): number {
  if (!Number.isFinite(n) || n < 5) return 0;
  let k = Math.max(1, Math.ceil(n * 0.05));
  while (k > 0 && n - 2 * k < 3) k -= 1;
  return k;
}

export type TrimResult = {
  n: number; // 有效分数个数
  k: number; // 每端剔除个数
  mean: number | null; // 去极值平均
  rawMean: number | null; // 原始算术平均
  removedLow: Entry[];
  removedHigh: Entry[];
  kept: Entry[];
};

export function trimmedMean(entries: Entry[]): TrimResult {
  const sorted = [...entries].sort((a, b) =>
    a.score !== b.score ? a.score - b.score : a.studentId - b.studentId,
  );
  const n = sorted.length;
  if (n === 0) {
    return { n: 0, k: 0, mean: null, rawMean: null, removedLow: [], removedHigh: [], kept: [] };
  }
  const rawMean = sorted.reduce((s, e) => s + e.score, 0) / n;
  const k = trimCount(n);
  const removedLow = k > 0 ? sorted.slice(0, k) : [];
  const removedHigh = k > 0 ? sorted.slice(n - k) : [];
  const kept = k > 0 ? sorted.slice(k, n - k) : sorted;
  const mean = kept.reduce((s, e) => s + e.score, 0) / kept.length;
  return { n, k, mean, rawMean, removedLow, removedHigh, kept };
}

export type ItemScore = { itemId: number; weight: number; mean: number | null };

/**
 * 总分平均分 = Σ(mean_i × w_i) / Σw_i
 * 权重全为 0 或都无有效分时按等权；权重 0 的项不参与总分。
 */
export function weightedTotal(items: ItemScore[]): number | null {
  const usable = items.filter((i) => i.mean !== null);
  if (usable.length === 0) return null;
  let sumW = usable.reduce((s, i) => s + i.weight, 0);
  if (sumW <= 0) {
    const avg = usable.reduce((s, i) => s + (i.mean as number), 0) / usable.length;
    return round2(avg);
  }
  const total = usable.reduce((s, i) => s + (i.mean as number) * i.weight, 0) / sumW;
  return round2(total);
}

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
