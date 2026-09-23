/**
 * 测试专用：全排列枚举基准。
 * 仅用于 Vitest 穷举小样本核对，产品代码禁止使用它。
 */

import { localPrereqMasks } from './precedence';

export interface BruteResult {
  sequence: number[];
  cost: number;
}

/**
 * 枚举 targets 的全部排列（字典序生成），计算
 * origin -> 排列 -> home 的费用，返回最小费用；并列取序列字典序最小。
 * 可选 prereqByPose 给出“先于”前置位掩码时，只枚举满足约束的排列。
 */
export function bruteForceOptimal(
  flat: ArrayLike<number>,
  dim: number,
  targetsIn: ArrayLike<number>,
  origin: number,
  home: number,
  prereqByPose?: ArrayLike<number>,
): BruteResult {
  const top = bruteForceTopK(flat, dim, targetsIn, origin, home, 1, prereqByPose);
  return { sequence: top[0]!.sequence, cost: top[0]!.cost };
}

export interface BruteCandidate {
  sequence: number[];
  cost: number;
}

/**
 * 枚举 targets 的全部互异排列（回溯按编号升序，即字典序），逐边复算
 * origin -> 排列 -> home 的费用，返回按 （费用升序，同费按完整序列字典序升序）
 * 排列的前 k 名；互异排列总数不足 k 时只返回实际数量；约束下一条可行排列都没有时
 * 返回空数组。
 *
 * 可选 prereqByPose（姿态 -> 全局前置位掩码）：扩展下一分支前要求该姿态在当前剩余
 * 集合中的全部局部前置都已被使用，枚举树即精确覆盖所有满足“先于”关系的排列。
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
  prereqByPose?: ArrayLike<number>,
): BruteCandidate[] {
  const targets = Array.from(targetsIn).sort((a, b) => a - b);
  const edge = (a: number, b: number) => flat[a * dim + b]!;
  const preMask = localPrereqMasks(targets, prereqByPose);

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

  const visit = (
    perm: number[],
    used: boolean[],
    usedMask: number,
    cost: number,
    last: number,
  ) => {
    if (perm.length === targets.length) {
      offer(perm, cost + edge(last, home));
      return;
    }
    for (let i = 0; i < targets.length; i++) {
      if (used[i]) continue;
      // “先于”门控：i 在子集中的局部前置必须都已使用
      // （前置姿态不在子集中时该位不存在；执行剩余子集下已完成姿态即此情形）。
      if (preMask[i]! & ~usedMask) continue;
      used[i] = true;
      perm.push(targets[i]!);
      visit(perm, used, usedMask | (1 << i), cost + edge(last, targets[i]!), targets[i]!);
      perm.pop();
      used[i] = false;
    }
  };

  visit([], new Array(targets.length).fill(false), 0, 0, origin);
  return top;
}

/**
 * 构造随机“先于”关系（测试用）：以给定概率为每对 i < j 加入 i 先于 j 的关系。
 * 只从小编号指向大编号 ⇒ 必然无环，且天然覆盖传递/冗余约束（如 1→2、2→3、1→3）。
 */
export function randomPrecedences(
  n: number,
  rng: () => number,
  probability: number,
): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let a = 1; a <= n; a++) {
    for (let b = a + 1; b <= n; b++) {
      if (rng() < probability) pairs.push([a, b]);
    }
  }
  return pairs;
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
