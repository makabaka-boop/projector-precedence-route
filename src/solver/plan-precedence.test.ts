import { describe, expect, it } from 'vitest';
import { createDefaultPlan, matrixToNested, validatePlan } from './plan';

function validNested(n: number): number[][] {
  const dim = n + 1;
  return Array.from({ length: dim }, (_, i) =>
    Array.from({ length: dim }, (_, j) => (i === j ? 0 : 7)),
  );
}

describe('计划校验 × 可选“先于”关系（整批裁决，旧计划隔离）', () => {
  it('无 precedences 字段的旧输入：行为与以前逐项一致（plan 显式带空数组）', () => {
    const r = validatePlan({ n: 8, matrix: validNested(8) });
    expect(r.ok).toBe(true);
    expect(r.plan!.precedences).toEqual([]);
  });

  it('裸二维数组旧输入同样得到空关系', () => {
    const r = validatePlan(validNested(10));
    expect(r.ok).toBe(true);
    expect(r.plan!.precedences).toEqual([]);
  });

  it('合法关系随计划生效（before 别名等价）', () => {
    const r1 = validatePlan({ n: 8, matrix: validNested(8), precedences: [[1, 2], [2, 8]] });
    expect(r1.ok).toBe(true);
    expect(r1.plan!.precedences).toEqual([
      [1, 2],
      [2, 8],
    ]);
    const r2 = validatePlan({ n: 8, matrix: validNested(8), before: [[1, 2]] });
    expect(r2.ok).toBe(true);
    expect(r2.plan!.precedences).toEqual([[1, 2]]);
  });

  it('关系引用不存在的姿态：整批拒绝且不产出 plan', () => {
    const r = validatePlan({ n: 8, matrix: validNested(8), precedences: [[1, 9]] });
    expect(r.ok).toBe(false);
    expect(r.plan).toBeUndefined();
    expect(r.errors.join(' ')).toContain('姿态');
  });

  it('引用停放位 0、自指、有环：整批拒绝', () => {
    expect(validatePlan({ n: 8, matrix: validNested(8), precedences: [[0, 1]] }).ok).toBe(
      false,
    );
    const self = validatePlan({ n: 8, matrix: validNested(8), precedences: [[4, 4]] });
    expect(self.ok).toBe(false);
    expect(self.errors.join(' ')).toContain('不可自指');

    const cycle = validatePlan({
      n: 8,
      matrix: validNested(8),
      precedences: [
        [1, 2],
        [2, 3],
        [3, 1],
      ],
    });
    expect(cycle.ok).toBe(false);
    expect(cycle.errors.join(' ')).toMatch(/环|相互约束/);
    expect(cycle.plan).toBeUndefined();
  });

  it('矩阵非法 + 关系非法同时出现：仍是整批拒绝（两类错误都不应落盘）', () => {
    const m = validNested(8) as unknown[][];
    m[1]![2] = 0; // 非对角为 0
    const r = validatePlan({ n: 8, matrix: m, precedences: [[9, 10]] });
    expect(r.ok).toBe(false);
    expect(r.plan).toBeUndefined();
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('默认计划无关系；往返序列化（无关系不带字段，旧载荷形状不变）', () => {
    const p = createDefaultPlan(12);
    expect(p.precedences).toEqual([]);
    expect(matrixToNested(p)).toHaveLength(13);
  });
});
