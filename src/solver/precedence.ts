/**
 * 可选“先于”关系（姿态优先级约束）。
 *
 * 现场标定时，某些姿态必须先于另一些姿态完成（例如基准姿态必须先于依赖它的姿态测量）。
 * 关系 a before b 表示：在任何可执行路线中，姿态 a 必须出现在姿态 b 之前。
 *
 * 约定：
 * - 关系只在姿态 1..N 之间，停放位 0 不参与；
 * - 不可自指（a === a）；
 * - 依赖图必须无环（有向无环图 ⇔ 至少存在一条拓扑序，即至少一条可执行路线）；
 * - 重复关系去重后视为同一条。
 *
 * 校验失败（姿态不存在、自指、有环、类型/形状错误）时整批拒绝，调用方保留旧计划——
 * 非法依赖与不可行路线绝不污染上次有效计划。
 */

/** 一条“先于”关系：[前置姿态, 后置姿态]，pair[0] 必须先于 pair[1]。 */
export type Precedence = readonly [number, number];

export interface PrecedenceValidation {
  ok: boolean;
  /** 校验通过后规范化（去重、按 (a,b) 升序）的关系列表 */
  pairs?: Array<[number, number]>;
  /** 失败时的就地错误信息（至少一条） */
  errors: string[];
}

/**
 * 校验并规范化“先于”关系。
 * @param raw 原始 JSON 值（期望为 [a, b] 二元数组的数组；缺省视为空）
 * @param n   当前计划的姿态数（只接受 1..n）
 */
export function validatePrecedences(raw: unknown, n: number): PrecedenceValidation {
  if (raw === undefined) return { ok: true, pairs: [], errors: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, errors: ['precedences（先于关系）必须是 [前置姿态, 后置姿态] 二元数组的数组'] };
  }

  const seen = new Set<number>();
  const pairs: Array<[number, number]> = [];
  const errors: string[] = [];

  raw.forEach((entry, idx) => {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== 'number' ||
      typeof entry[1] !== 'number'
    ) {
      errors.push(
        `precedences[${idx}] 必须是 [前置姿态, 后置姿态] 二元数组，收到：${formatEntry(entry)}`,
      );
      return;
    }
    const [a, b] = entry as [number, number];
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || a > n || b < 1 || b > n) {
      errors.push(
        `precedences[${idx}] = [${String(a)}, ${String(b)}]：姿态必须是 1—${n} 的整数`,
      );
      return;
    }
    if (a === b) {
      errors.push(`precedences[${idx}] = [${a}, ${a}]：不可自指，姿态不能先于自身`);
      return;
    }
    const key = a * (n + 1) + b;
    if (seen.has(key)) {
      return; // 重复关系：去重，不算错误（同一约束写两遍不应整批拒绝）
    }
    seen.add(key);
    pairs.push([a, b]);
  });

  if (errors.length > 0) return { ok: false, errors: dedupe(errors) };

  const cycle = findCycle(pairs, n);
  if (cycle) {
    return {
      ok: false,
      errors: [`先于关系存在依赖环（相互约束不可行）：${cycle.join(' → ')}，请先解除环再应用`],
    };
  }

  pairs.sort((x, y) => (x[0] === y[0] ? x[1] - y[1] : x[0] - y[0]));
  return { ok: true, pairs, errors: [] };
}

/**
 * 依赖图环检测（三色 DFS）。无环返回 null；有环返回环上姿态（首尾相同），
 * 如 [1, 3, 2, 1]，用于就地展示。
 */
export function findCycle(pairs: ArrayLike<Precedence>, n: number): number[] | null {
  const adj: number[][] = Array.from({ length: n + 1 }, () => []);
  for (let i = 0; i < pairs.length; i++) {
    const [a, b] = pairs[i]!;
    adj[a]!.push(b);
  }
  for (let i = 1; i <= n; i++) adj[i]!.sort((x, y) => x - y);

  // 0=未访问，1=在当前递归栈中，2=已完成
  const color = new Int8Array(n + 1);
  const stack: number[] = [];

  const dfs = (u: number): number[] | null => {
    color[u] = 1;
    stack.push(u);
    for (const v of adj[u]!) {
      if (color[v] === 0) {
        const found = dfs(v);
        if (found) return found;
      } else if (color[v] === 1) {
        const start = stack.indexOf(v);
        return [...stack.slice(start), v];
      }
    }
    stack.pop();
    color[u] = 2;
    return null;
  };

  for (let p = 1; p <= n; p++) {
    if (color[p] === 0) {
      const found = dfs(p);
      if (found) return found;
    }
  }
  return null;
}

/**
 * 构造各姿态的前置位掩码（姿态编号即位号，姿态 ≤18，32 位足够）：
 * bit q 置位 ⇔ q 必须先于 pose。求解器再按当前目标子集投影成局部掩码。
 */
export function buildPrereqMasks(pairs: ArrayLike<Precedence>, n: number): Uint32Array {
  const masks = new Uint32Array(n + 1);
  for (let i = 0; i < pairs.length; i++) {
    const [a, b] = pairs[i]!;
    masks[b]! |= 1 << a;
  }
  return masks;
}

/**
 * 把“先于”关系投影到当前目标子集：返回局部前置位掩码（位号为 sorted 中的下标）。
 *
 * 执行中途重排时，已完成姿态（不在剩余目标里）的前置视为已满足，
 * 故子集中某姿态 j 的局部前置只保留“也在子集内、且必须先于 j”的姿态。
 */
export function localPrereqMasks(
  sortedTargets: ArrayLike<number>,
  prereqByPose: ArrayLike<number> | undefined,
): Uint32Array {
  const m = sortedTargets.length;
  const local = new Uint32Array(m);
  if (!prereqByPose) return local;

  // 姿态编号 -> 局部位 的映射（只查子集内的，位 1..N 直接用一个小数组最快）
  const poseBit = new Int8Array(32).fill(-1);
  for (let j = 0; j < m; j++) poseBit[sortedTargets[j]!] = j;

  for (let j = 0; j < m; j++) {
    const global = prereqByPose[sortedTargets[j]!] ?? 0;
    let mask = 0;
    let bits = global;
    while (bits !== 0) {
      const lsb = bits & -bits;
      const pose = 31 - Math.clz32(lsb);
      const localBit = poseBit[pose]!;
      if (localBit >= 0) mask |= 1 << localBit;
      bits &= bits - 1;
    }
    local[j] = mask;
  }
  return local;
}

/**
 * 判断一条已确定的序列是否满足全部“先于”关系（测试与逐边核对时用）。
 */
export function sequenceSatisfies(sequence: ArrayLike<number>, pairs: ArrayLike<Precedence>): boolean {
  const pos = new Map<number, number>();
  for (let i = 0; i < sequence.length; i++) pos.set(sequence[i]!, i);
  for (let i = 0; i < pairs.length; i++) {
    const [a, b] = pairs[i]!;
    const pa = pos.get(a);
    const pb = pos.get(b);
    // 关系涉及不在序列中的姿态（如执行剩余子集）时，只在双方都在时才约束
    if (pa !== undefined && pb !== undefined && pa >= pb) return false;
  }
  return true;
}

/**
 * 解析编辑台文本框中的“先于”关系草稿。
 * 每行一条，形如 `1, 3` / `1 -> 3` / `1 先于 3`（逗号、空白、->、先于 均可作分隔）；
 * 空行与以 # 开头的注释行忽略。返回规范化对与逐行错误，供“校验并应用”整批裁决。
 */
export interface PrecedenceDraft {
  pairs: Array<[number, number]>;
  /** 与输入行号（1 起）对齐的错误；空数组表示可提交 */
  errors: string[];
}

export function parsePrecedenceText(text: string): PrecedenceDraft {
  const pairs: Array<[number, number]> = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) return;
    const parts = line
      .split(/(?:,|，|->|→|先于|\s+)/)
      .map((s) => s.trim())
      .filter((s) => s !== '');
    if (parts.length !== 2 || parts.some((p) => !/^\d+$/.test(p))) {
      errors.push(`第 ${lineNo} 行无法解析为“前置, 后置”：${rawLine.trim()}`);
      return;
    }
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    pairs.push([a, b]);
  });
  return { pairs, errors: dedupe(errors) };
}

/** 已规范化关系列表序列化为编辑台文本。 */
export function formatPrecedenceText(pairs: ArrayLike<Precedence>): string {
  const lines: string[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const [a, b] = pairs[i]!;
    lines.push(`${a}, ${b}`);
  }
  return lines.join('\n');
}

function formatEntry(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items));
}
