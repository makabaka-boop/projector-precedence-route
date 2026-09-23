import { describe, expect, it } from 'vitest';
import { solveOptimal, solveTopRoutes, TOP_K } from './tsp';
import {
  bruteForceOptimal,
  bruteForceTopK,
  makeRng,
  randomMatrix,
  randomPrecedences,
} from './brute';
import {
  buildPrereqMasks,
  sequenceSatisfies,
  validatePrecedences,
} from './precedence';

function recompute(flat: number[], dim: number, tour: number[]): number {
  let sum = 0;
  for (let i = 0; i + 1 < tour.length; i++) {
    sum += flat[tour[i]! * dim + tour[i + 1]!]!;
  }
  return sum;
}

function factorial(m: number): number {
  let v = 1;
  for (let i = 2; i <= m; i++) v *= i;
  return v;
}

function masks(pairs: Array<[number, number]>, n: number) {
  return buildPrereqMasks(pairs, n);
}

describe('“先于”关系：HK 前三名 vs 受约束全排列（独立枚举核对）', () => {
  const sizes = [1, 2, 3, 4, 5, 6, 7, 8];

  for (const m of sizes) {
    it(`m=${m}：多组随机无环“先于”关系下，前三名费用/序列逐组等于受约束全排列`, () => {
      for (let seed = 1; seed <= 30; seed++) {
        const dim = m + 1;
        const rng = makeRng(seed * 9001 + m * 17);
        const flat = randomMatrix(dim, makeRng(seed * 104729 + m * 31));
        // 密度随规模降一点，保证 m 大时可行排列仍多于 3 条的概率高
        const probability = 0.12 + rng() * 0.25;
        const pairs = randomPrecedences(m, rng, probability);
        const prereq = masks(pairs, m);
        const targets = Array.from({ length: m }, (_, k) => k + 1);

        const set = solveTopRoutes(flat, dim, targets, 0, 0, prereq);
        const brute = bruteForceTopK(flat, dim, targets, 0, 0, TOP_K, prereq);

        expect(set.candidates).toHaveLength(brute.length);
        for (let r = 0; r < brute.length; r++) {
          const c = set.candidates[r]!;
          const b = brute[r]!;
          expect(c.cost).toBe(b.cost);
          expect(c.sequence).toEqual(b.sequence);
          // 每条候选都满足全部关系
          expect(sequenceSatisfies(c.sequence, pairs)).toBe(true);
          expect(recompute(flat, dim, c.tour)).toBe(c.cost);
        }

        // 候选两两互异、排名连续、按 (费用, 字典序) 非降
        const seqs = set.candidates.map((c) => c.sequence.join(','));
        expect(new Set(seqs).size).toBe(seqs.length);
        set.candidates.forEach((c, idx) => expect(c.rank).toBe(idx + 1));
        for (let r = 1; r < set.candidates.length; r++) {
          expect(set.candidates[r]!.cost).toBeGreaterThanOrEqual(set.candidates[r - 1]!.cost);
        }

        // 单最优快路径恒等于候选首名（带约束）
        if (brute.length > 0) {
          const one = solveOptimal(flat, dim, targets, 0, 0, prereq);
          expect(one.cost).toBe(set.candidates[0]!.cost);
          expect(one.sequence).toEqual(set.candidates[0]!.sequence);
        }
      }
    });
  }

  it('强约束链 1→2→…→m：唯一可行路线即 1,2,…,m，候选只有一条', () => {
    for (const m of [2, 3, 5, 8]) {
      const dim = m + 1;
      const flat = randomMatrix(dim, makeRng(m * 77 + 1));
      const chain: Array<[number, number]> = [];
      for (let a = 1; a < m; a++) chain.push([a, a + 1]);
      const prereq = masks(chain, m);
      const targets = Array.from({ length: m }, (_, k) => k + 1);

      const set = solveTopRoutes(flat, dim, targets, 0, 0, prereq);
      const brute = bruteForceTopK(flat, dim, targets, 0, 0, TOP_K, prereq);
      expect(set.candidates).toHaveLength(1);
      expect(set.candidates[0]!.sequence).toEqual(targets);
      expect(brute).toHaveLength(1);
      expect(brute[0]!.sequence).toEqual(targets);
      expect(set.candidates[0]!.cost).toBe(brute[0]!.cost);

      const one = solveOptimal(flat, dim, targets, 0, 0, prereq);
      expect(one.sequence).toEqual(targets);
    }
  });

  it('强制关系改变最优解：把穷举最优首姿态设为“必须最后”，新最优等于受约束穷举', () => {
    const m = 6;
    const dim = m + 1;
    const flat = randomMatrix(dim, makeRng(424242));
    const targets = Array.from({ length: m }, (_, k) => k + 1);
    const unconstrained = bruteForceOptimal(flat, dim, targets, 0, 0);
    const last = unconstrained.sequence[0]!;
    // 其余每个姿态都必须先于 last ⇒ last 被迫最后
    const pairs: Array<[number, number]> = targets
      .filter((p) => p !== last)
      .map((p) => [p, last]);
    const prereq = masks(pairs, m);

    const set = solveTopRoutes(flat, dim, targets, 0, 0, prereq);
    const brute = bruteForceTopK(flat, dim, targets, 0, 0, TOP_K, prereq);
    expect(set.candidates).toHaveLength(brute.length);
    for (let r = 0; r < brute.length; r++) {
      expect(set.candidates[r]!.cost).toBe(brute[r]!.cost);
      expect(set.candidates[r]!.sequence).toEqual(brute[r]!.sequence);
      expect(set.candidates[r]!.sequence[m - 1]).toBe(last);
    }
    expect(set.candidates[0]!.cost).toBeGreaterThanOrEqual(unconstrained.cost);
  });

  it('可行路线恰好两条时只返回两条（无占位无重复）', () => {
    // 关系 1→3,1→4,2→3,2→4 把 1、2 与 3、4 锁成两段，段内自由 ⇒ 2!×2!=4 条；
    // 再加 3→4 后 3、4 段固定，只剩 1、2 互换 ⇒ 恰好 2 条。
    const m = 4;
    const dim = m + 1;
    const flat = randomMatrix(dim, makeRng(9));
    const pairs: Array<[number, number]> = [
      [1, 3],
      [1, 4],
      [2, 3],
      [2, 4],
      [3, 4],
    ];
    const prereq = masks(pairs, m);
    const targets = [1, 2, 3, 4];
    const set = solveTopRoutes(flat, dim, targets, 0, 0, prereq);
    const brute = bruteForceTopK(flat, dim, targets, 0, 0, 3, prereq);
    expect(brute).toHaveLength(2);
    expect(set.candidates).toHaveLength(2);
    expect(set.candidates.map((c) => c.sequence)).toEqual(brute.map((b) => b.sequence));
    expect(set.candidates[0]!.sequence.slice(2)).toEqual([3, 4]);
    expect([set.candidates[0]!.sequence[0], set.candidates[1]!.sequence[0]].sort()).toEqual([
      1, 2,
    ]);
  });

  it('传递/冗余约束（1→2、2→3、1→3）与只写传递闭包等价', () => {
    const m = 5;
    const dim = m + 1;
    const flat = randomMatrix(dim, makeRng(123123));
    const targets = [1, 2, 3, 4, 5];
    const withRedundant = masks(
      [
        [1, 2],
        [2, 3],
        [1, 3],
      ],
      m,
    );
    const minimal = masks(
      [
        [1, 2],
        [2, 3],
      ],
      m,
    );
    const a = solveTopRoutes(flat, dim, targets, 0, 0, withRedundant);
    const b = solveTopRoutes(flat, dim, targets, 0, 0, minimal);
    expect(a.candidates.map((c) => [c.cost, c.sequence])).toEqual(
      b.candidates.map((c) => [c.cost, c.sequence]),
    );
  });

  it('任意起点与任意剩余子集（执行中途重排）：前置已完成姿态视为满足，与受约束穷举一致', () => {
    // 场景：关系 1→3、3→5；已完成 1（不在剩余子集），从姿态 2 重排剩余 [3,4,5,6]
    const dim = 7;
    const flat = randomMatrix(dim, makeRng(7777));
    const pairs: Array<[number, number]> = [
      [1, 3],
      [3, 5],
    ];
    const prereq = masks(pairs, 6);
    const cases: Array<{ origin: number; targets: number[] }> = [
      { origin: 2, targets: [3, 4, 5, 6] }, // 1 已完成：对 3 的前置已满足；3 仍须先于 5
      { origin: 4, targets: [1, 2, 5, 6] }, // 3 已完成：5 的前置已满足，应自由
      { origin: 6, targets: [3, 5] }, // 1 已完成，但 3 必须先于 5 ⇒ 唯一可行 [3,5]
    ];
    for (const cse of cases) {
      const set = solveTopRoutes(flat, dim, cse.targets, cse.origin, 0, prereq);
      const brute = bruteForceTopK(flat, dim, cse.targets, cse.origin, 0, TOP_K, prereq);
      expect(set.candidates).toHaveLength(brute.length);
      for (let r = 0; r < brute.length; r++) {
        expect(set.candidates[r]!.cost).toBe(brute[r]!.cost);
        expect(set.candidates[r]!.sequence).toEqual(brute[r]!.sequence);
        expect(sequenceSatisfies(set.candidates[r]!.sequence, pairs)).toBe(true);
      }
    }

    // 精确核对最后一个小情形：只剩 {3,5}，3→5 强制
    const only = solveOptimal(flat, dim, [3, 5], 6, 0, prereq);
    expect(only.sequence).toEqual([3, 5]);
  });

  it('全等费用 + 单一关系 2 先于 1：前三名与受约束全排列一致，字典序在约束内裁决', () => {
    const m = 4;
    const dim = m + 1;
    const flat = new Array<number>(dim * dim).fill(1);
    for (let i = 0; i < dim; i++) flat[i * dim + i] = 0;
    const targets = [1, 2, 3, 4];
    const pairs: Array<[number, number]> = [[2, 1]];
    const prereq = masks(pairs, m);

    const set = solveTopRoutes(flat, dim, targets, 0, 0, prereq);
    const brute = bruteForceTopK(flat, dim, targets, 0, 0, TOP_K, prereq);
    expect(set.candidates.map((c) => c.sequence)).toEqual(brute.map((b) => b.sequence));
    // 无约束第一序列 1,2,3,4 违规（1 在 2 前）；约束下字典序最小为 2,1,3,4
    expect(set.candidates[0]!.sequence).toEqual([2, 1, 3, 4]);
    for (const c of set.candidates) expect(sequenceSatisfies(c.sequence, pairs)).toBe(true);
  });

  it('无依赖（空掩码）时结果数量与无约束一致，m! 不足 3 只返回实际数量', () => {
    const m = 2;
    const dim = m + 1;
    const flat = randomMatrix(dim, makeRng(55));
    const targets = [1, 2];
    const set = solveTopRoutes(flat, dim, targets, 0, 0, masks([], m));
    expect(set.candidates).toHaveLength(Math.min(TOP_K, factorial(m)));
    const brute = bruteForceTopK(flat, dim, targets, 0, 0, TOP_K, masks([], m));
    expect(set.candidates.map((c) => c.sequence)).toEqual(brute.map((b) => b.sequence));
  });

  it('防御：手工构造不可行掩码（形成环）时候选集为空，solveOptimal 抛错', () => {
    // 正常链路（validatePrecedences + buildPrereqMasks）不可能产生环，这里手工构造：
    // 1 与 2 互相先于（位掩码 1<<2 与 1<<1）。
    const m = 2;
    const dim = m + 1;
    const flat = randomMatrix(dim, makeRng(56));
    const cyclic = new Uint32Array(m + 1);
    cyclic[1] = 1 << 2; // 姿态 1 要求 2 先于它
    cyclic[2] = 1 << 1; // 姿态 2 要求 1 先于它
    const set = solveTopRoutes(flat, dim, [1, 2], 0, 0, cyclic);
    expect(set.candidates).toEqual([]);
    expect(() => solveOptimal(flat, dim, [1, 2], 0, 0, cyclic)).toThrow(/不存在可行路线/);
  });
});

describe('“先于”关系提交前校验：姿态存在 / 不可自指 / 无环 / 相互约束', () => {
  it('接受合法无环关系（含传递冗余与重复），输出去重排序后的列表', () => {
    const r = validatePrecedences(
      [
        [3, 5],
        [1, 2],
        [1, 3],
        [1, 3], // 重复
      ],
      6,
    );
    expect(r.ok).toBe(true);
    expect(r.pairs).toEqual([
      [1, 2],
      [1, 3],
      [3, 5],
    ]);
  });

  it('缺省（undefined）视为空关系；空数组合法', () => {
    expect(validatePrecedences(undefined, 8).pairs).toEqual([]);
    expect(validatePrecedences([], 8).pairs).toEqual([]);
  });

  it('姿态不存在（0、越界、小数、非整数、非数字）逐条拒绝', () => {
    const bad: unknown[] = [
      [[0, 1]],
      [[1, 9]],
      [[9, 1]],
      [[1.5, 2]],
      [['1', 2]],
      [[1, null]],
      [1, 2],
      [[1]],
      [[1, 2, 3]],
      [{ a: 1, b: 2 }],
    ];
    for (const raw of bad) {
      const r = validatePrecedences(raw, 8);
      expect(r.ok, JSON.stringify(raw)).toBe(false);
      expect(r.errors.length, JSON.stringify(raw)).toBeGreaterThan(0);
      expect(r.pairs, JSON.stringify(raw)).toBeUndefined();
    }
  });

  it('不可自指', () => {
    const r = validatePrecedences([[3, 3]], 8);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('不可自指');
  });

  it('二元环（相互约束）检出并报出环上姿态', () => {
    const r = validatePrecedences(
      [
        [1, 3],
        [3, 1],
      ],
      8,
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/依赖环|相互约束/);
    expect(r.errors.join(' ')).toContain('1');
    expect(r.errors.join(' ')).toContain('3');
  });

  it('三元环（1→3→5→1）检出', () => {
    const r = validatePrecedences(
      [
        [1, 3],
        [3, 5],
        [5, 1],
        [2, 4],
      ],
      8,
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/依赖环|相互约束/);
    // 环经过 1、3、5
    const msg = r.errors.join(' ');
    for (const p of [1, 3, 5]) expect(msg).toContain(String(p));
  });

  it('非法关系与费用错误一样整批拒绝：错误信息不污染合法部分', () => {
    const r = validatePrecedences([[1, 2], [2, 2]], 8);
    expect(r.ok).toBe(false);
    expect(r.pairs).toBeUndefined();
  });
});
