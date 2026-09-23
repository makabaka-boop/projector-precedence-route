import { describe, expect, it } from 'vitest';
import { type CalibrationPlan } from './plan';
import { solveTopRoutes } from './tsp';
import {
  confirmNext,
  deltaVsOriginal,
  finishReturn,
  projectedTotal,
  startExecution,
} from './execution';
import {
  bruteForceOptimal,
  bruteForceTopK,
  makeRng,
  randomMatrix,
} from './brute';
import { buildPrereqMasks, sequenceSatisfies } from './precedence';

function planWith(n: number, flat: number[], pairs: Array<[number, number]> = []): CalibrationPlan {
  return { n, matrixFlat: flat, precedences: pairs };
}

describe('现场执行 × “先于”关系：确认前置检查、拒绝保进度、剩余子集重算', () => {
  it('初始候选/后缀都满足关系；沿受约束最优逐站确认，后缀每拍与受约束穷举一致', () => {
    const n = 6;
    const flat = randomMatrix(n + 1, makeRng(8801));
    const pairs: Array<[number, number]> = [
      [1, 4],
      [2, 5],
      [4, 6],
    ];
    const plan = planWith(n, flat, pairs);
    const state0 = startExecution(plan);

    expect(sequenceSatisfies(state0.original.sequence, pairs)).toBe(true);
    expect(sequenceSatisfies(state0.suffix.sequence, pairs)).toBe(true);

    let state = state0;
    for (const pose of state0.original.sequence) {
      state = confirmNext(state, pose);
      const brute = bruteForceOptimal(
        flat,
        n + 1,
        state.remaining,
        state.current,
        0,
        buildPrereqMasks(pairs, n),
      );
      expect(state.suffix.sequence).toEqual(brute.sequence);
      expect(state.suffix.cost).toBe(brute.cost);
      // 后缀内部也满足关系（关系双方都在剩余中时）
      expect(sequenceSatisfies(state.suffix.sequence, pairs)).toBe(true);
      expect(projectedTotal(state)).toBeGreaterThan(0);
    }
    state = finishReturn(state);
    expect(state.finished).toBe(true);
    expect(deltaVsOriginal(state)).toBe(0);
  });

  it('前置未满足的确认被拒绝：抛错且已确认进度逐项保留（状态不变）', () => {
    const n = 5;
    const flat = randomMatrix(n + 1, makeRng(8802));
    const pairs: Array<[number, number]> = [
      [1, 3],
      [2, 3],
    ];
    const plan = planWith(n, flat, pairs);
    let state = startExecution(plan);

    // 姿态 3 的前置 1、2 都没完成 ⇒ 拒绝
    expect(() => confirmNext(state, 3)).toThrow(/先于姿态尚未完成/);
    expect(state.visited).toEqual([]);
    expect(state.current).toBe(0);
    expect(state.incurred).toBe(0);

    // 完成 1 后，3 仍被 2 阻塞，错误信息列出 2
    state = confirmNext(state, 1);
    const snapshot = {
      visited: [...state.visited],
      current: state.current,
      incurred: state.incurred,
      remaining: [...state.remaining],
      suffixSeq: [...state.suffix.sequence],
    };
    expect(() => confirmNext(state, 3)).toThrow(/需先确认：2/);
    // 进度与后缀一字未改
    expect(state.visited).toEqual(snapshot.visited);
    expect(state.current).toBe(snapshot.current);
    expect(state.incurred).toBe(snapshot.incurred);
    expect(state.remaining).toEqual(snapshot.remaining);
    expect(state.suffix.sequence).toEqual(snapshot.suffixSeq);

    // 完成 2 后 3 解锁，可以确认
    state = confirmNext(state, 2);
    state = confirmNext(state, 3);
    expect(state.visited).toEqual([1, 2, 3]);

    // 其余姿态走完并回库
    state = confirmNext(state, 4);
    state = confirmNext(state, 5);
    state = finishReturn(state);
    expect(state.finished).toBe(true);
  });

  it('已完成姿态视为满足：前置不在剩余子集后，后置立即解锁且重算只约束剩余', () => {
    const n = 5;
    const flat = randomMatrix(n + 1, makeRng(8803));
    const pairs: Array<[number, number]> = [[1, 4]];
    const plan = planWith(n, flat, pairs);
    let state = startExecution(plan);

    // 先完成 1（通过偏离去完成它），再完成 2、3
    state = confirmNext(state, 1);
    state = confirmNext(state, 2);
    state = confirmNext(state, 3);
    // 此时剩余 [4,5]，1 已不在剩余 ⇒ 4 的前置视为满足，后缀自由排列 4/5
    const brute = bruteForceOptimal(
      flat,
      n + 1,
      [4, 5],
      state.current,
      0,
      buildPrereqMasks(pairs, n),
    );
    expect(state.suffix.sequence).toEqual(brute.sequence);
    // 4 与 5 都可确认（4 不再被阻塞）
    const after4 = confirmNext(state, 4);
    expect(after4.visited).toContain(4);
  });

  it('中途任意偏离：每一拍重算都在剩余姿态上继续遵守依赖，与受约束穷举一致', () => {
    const n = 6;
    const flat = randomMatrix(n + 1, makeRng(8804));
    const pairs: Array<[number, number]> = [
      [2, 1], // 1 必须在 2 之后
      [3, 6],
    ];
    const plan = planWith(n, flat, pairs);
    const prereq = buildPrereqMasks(pairs, n);
    let state = startExecution(plan);

    // 人为构造一条合法但偏离原推荐的顺序（满足 2 先于 1、3 先于 6）
    const order = [2, 1, 4, 3, 5, 6];
    for (const pose of order) {
      state = confirmNext(state, pose);
      const brute = bruteForceOptimal(flat, n + 1, state.remaining, state.current, 0, prereq);
      expect(state.suffix.cost).toBe(brute.cost);
      expect(state.suffix.sequence).toEqual(brute.sequence);
      expect(sequenceSatisfies([...state.visited, ...state.suffix.sequence], pairs)).toBe(true);
    }
    expect(() => finishReturn(state)).not.toThrow();
  });

  it('链式依赖 1→2→3：未按序确认全部拒绝，按序确认全部通过', () => {
    const n = 4;
    const flat = randomMatrix(n + 1, makeRng(8805));
    const pairs: Array<[number, number]> = [
      [1, 2],
      [2, 3],
    ];
    const plan = planWith(n, flat, pairs);
    let state = startExecution(plan);

    expect(() => confirmNext(state, 2)).toThrow(/需先确认：1/);
    // 3 的直接前置只有 2（1 是经由 2 的传递前置），未满足清单列直接前置
    expect(() => confirmNext(state, 3)).toThrow(/需先确认：2/);

    state = confirmNext(state, 1);
    expect(() => confirmNext(state, 3)).toThrow(/需先确认：2/);
    state = confirmNext(state, 2);
    state = confirmNext(state, 3);
    state = confirmNext(state, 4);
    state = finishReturn(state);
    expect(state.finished).toBe(true);
    expect(state.visited).toEqual([1, 2, 3, 4]);
  });

  it('无依赖的旧计划：任何未完成姿态都可确认（旧行为逐项保持）', () => {
    const n = 5;
    const flat = randomMatrix(n + 1, makeRng(8806));
    let state = startExecution({ n, matrixFlat: flat }); // 无 precedences 字段
    expect(state.prereqByPose.every((v) => v === 0)).toBe(true);
    for (const p of [5, 3, 1, 4, 2]) {
      state = confirmNext(state, p);
    }
    state = finishReturn(state);
    expect(state.finished).toBe(true);
  });

  it('受约束候选前三名与受约束穷举一致，并可被选为基线（基线负增量语义保持）', () => {
    const n = 6;
    const flat = randomMatrix(n + 1, makeRng(8807));
    const pairs: Array<[number, number]> = [[2, 5]];
    const plan = planWith(n, flat, pairs);
    const prereq = buildPrereqMasks(pairs, n);

    const top = solveTopRoutes(flat, n + 1, [1, 2, 3, 4, 5, 6], 0, 0, prereq);
    const brute = bruteForceTopK(flat, n + 1, [1, 2, 3, 4, 5, 6], 0, 0, 3, prereq);
    expect(top.candidates).toHaveLength(brute.length);
    for (let r = 0; r < brute.length; r++) {
      expect(top.candidates[r]!.cost).toBe(brute[r]!.cost);
      expect(top.candidates[r]!.sequence).toEqual(brute[r]!.sequence);
    }

    if (top.candidates.length === 3 && top.candidates[1]!.cost > top.candidates[0]!.cost) {
      const state = startExecution(plan, top.candidates[1]!);
      expect(deltaVsOriginal(state)).toBeLessThan(0);
      // 初始后缀本身也必须满足关系
      expect(sequenceSatisfies(state.suffix.sequence, pairs)).toBe(true);
    }
  });
});
