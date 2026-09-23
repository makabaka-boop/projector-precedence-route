/**
 * 测试专用：全排列枚举基准。
 * 仅用于 Vitest 穷举小样本核对，产品代码禁止使用它。
 */

export interface BruteResult {
  sequence: number[];
  cost: number;
}

/**
 * 枚举 targets 的全部排列（字典序生成），计算
 * origin -> 排列 -> home 的费用，返回最小费用；并列取序列字典序最小。
 */
export function bruteForceOptimal(
  flat: ArrayLike<number>,
  dim: number,
  targetsIn: ArrayLike<number>,
  origin: number,
  home: number,
): BruteResult {
  const top = bruteForceTopK(flat, dim, targetsIn, origin, home, 1);
  return { sequence: top[0]!.sequence, cost: top[0]!.cost };
}

export interface BruteCandidate {
  sequence: number[];
  cost: number;
}

/**
 * 枚举 targets 的全部互异排列（回溯按编号升序，即字典序），逐边复算
 * origin -> 排列 -> home 的费用，返回按 （费用升序，同费按完整序列字典序升序）
 * 排列的前 k 名；互异排列总数不足 k 时只返回实际数量。
 *
 * 每一次访问末端都拿完整费用与当前榜做有序插入；同一排列只出现一次，天然互异。
 */
export function bruteForceTopK(
  flat: ArrayLike<number>,
  dim: number,
  targetsIn: ArrayLike<number>,
  origin: number,
  home: number,
  k: number,
): BruteCandidate[] {
  const targets = Array.from(targetsIn).sort((a, b) => a - b);
  const edge = (a: number, b: number) => flat[a * dim + b]!;

  if (targets.length === 0) {
    return [{ sequence: [], cost: edge(origin, home) }];
  }

  const top: BruteCandidate[] = [];

  // 字典序枚举到的序列，在“同费”这一并列组内必然按字典序到达；
  // 同费用下只对首个出现的较小序列严格让位，整榜最终即 (费用, 字典序) 有序。
  const offer = (seq: number[], total: number) => {
    for (let t = 0; t < top.length; t++) {
      const cur = top[t]!;
      if (total < cur.cost || (total === cur.cost && lexLess(seq, cur.sequence))) {
        top.splice(t, 0, { sequence: seq.slice(), cost: total });
        if (top.length > k) top.pop();
        return;
      }
    }
    if (top.length < k) top.push({ sequence: seq.slice(), cost: total });
  };

  const visit = (perm: number[], used: boolean[], cost: number, last: number) => {
    if (perm.length === targets.length) {
      offer(perm, cost + edge(last, home));
      return;
    }
    for (let i = 0; i < targets.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      perm.push(targets[i]!);
      visit(perm, used, cost + edge(last, targets[i]!), targets[i]!);
      perm.pop();
      used[i] = false;
    }
  };

  visit([], new Array(targets.length).fill(false), 0, origin);
  return top;
}

function lexLess(a: number[], b: number[]): boolean {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]!;
  }
  return a.length < b.length;
}

/** 可复现的简单伪随机数（mulberry32） */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 生成 dim×dim 随机非对称费用矩阵（对角 0） */
export function randomMatrix(dim: number, rng: () => number): number[] {
  const flat = new Array<number>(dim * dim).fill(0);
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) {
      if (i !== j) flat[i * dim + j] = 1 + Math.floor(rng() * 9999);
    }
  }
  return flat;
}
