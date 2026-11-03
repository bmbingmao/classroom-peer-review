/**
 * 去极值平均分（trimmed mean）—— 需求规格书 v2 §7.3
 *
 * 自动规则：
 *  - n < 5        → 不去极值，直接算术平均
 *  - n >= 5       → k = max(1, ceil(n*0.05))，并保证剩余个数 >= 3
 *  - 排序键 (score ASC, studentId ASC) 必须稳定，否则同分剔除对象会漂移
 *  - 剩余分数算术平均
 *
 * 教师手动覆盖（low/high 可不等，比如"低值剔 2 个、高值剔 0 个"）：
 *  - 传了 trim 就按它来，但两端合计最多剔到只剩 1 个分数
 */

export type Entry = { studentId: number; score: number };

export function trimCount(n: number): number {
  if (!Number.isFinite(n) || n < 5) return 0;
  let k = Math.max(1, Math.ceil(n * 0.05));
  while (k > 0 && n - 2 * k < 3) k -= 1;
  return k;
}

/** 两端剔除个数（自动规则下两端相同） */
export type TrimSpec = { low: number; high: number };

export function autoTrim(n: number): TrimSpec {
  const k = trimCount(n);
  return { low: k, high: k };
}

/** 手动剔除数收敛：非负整数，且至少留下 1 个分数 */
export function clampTrim(n: number, spec: TrimSpec): TrimSpec {
  let low = Math.max(0, Math.trunc(Number(spec.low) || 0));
  let high = Math.max(0, Math.trunc(Number(spec.high) || 0));
  while (low + high > n - 1 && (low > 0 || high > 0)) {
    if (high > 0) high -= 1;
    else low -= 1;
  }
  return { low, high };
}

export type TrimResult = {
  n: number; // 有效分数个数
  k: number; // 低端剔除个数（兼容旧调用）
  low: number; // 低端剔除个数
  high: number; // 高端剔除个数
  auto: boolean; // 是否用的是自动规则
  mean: number | null; // 去极值平均
  rawMean: number | null; // 原始算术平均
  removedLow: Entry[];
  removedHigh: Entry[];
  kept: Entry[];
};

export function trimmedMean(entries: Entry[], trim?: TrimSpec | null): TrimResult {
  const sorted = [...entries].sort((a, b) =>
    a.score !== b.score ? a.score - b.score : a.studentId - b.studentId,
  );
  const n = sorted.length;
  if (n === 0) {
    return {
      n: 0,
      k: 0,
      low: 0,
      high: 0,
      auto: !trim,
      mean: null,
      rawMean: null,
      removedLow: [],
      removedHigh: [],
      kept: [],
    };
  }
  const rawMean = sorted.reduce((s, e) => s + e.score, 0) / n;
  const auto = !trim;
  const { low, high } = trim ? clampTrim(n, trim) : autoTrim(n);
  const removedLow = low > 0 ? sorted.slice(0, low) : [];
  const removedHigh = high > 0 ? sorted.slice(n - high) : [];
  const kept = sorted.slice(low, n - high);
  const mean = kept.reduce((s, e) => s + e.score, 0) / kept.length;
  return { n, k: low, low, high, auto, mean, rawMean, removedLow, removedHigh, kept };
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

/**
 * 学生均分 × (1-w) + 教师分 × w
 * 一边缺失时就取另一边（老师没打分 = 纯学生互评；没学生分 = 纯教师分）。
 */
export function blend(teacherScore: number | null, studentMean: number | null, teacherPercent: number): number | null {
  if (teacherScore === null && studentMean === null) return null;
  if (teacherScore === null) return studentMean;
  if (studentMean === null) return teacherScore;
  const w = Math.min(100, Math.max(0, teacherPercent)) / 100;
  return round2(studentMean * (1 - w) + teacherScore * w);
}

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
