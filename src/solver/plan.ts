/**
 * 计划数据模型与严格校验。
 *
 * 约定：
 * - 姿态编号 1..N（N 取 8—18），0 为停放位。
 * - 费用矩阵为 (N+1)×(N+1) 的方阵，行优先二维数组。
 * - 主对角线必须为 0；其余项必须是 1..9999 的整数（费用有方向性，矩阵不必对称）。
 * - 可选“先于”关系 prerequisites：[a, b] 表示姿态 a 必须先于姿态 b 被确认；
 *   提交前校验姿态存在、不可自指、依赖图无环；重复边去重。缺省即无约束，
 *   旧输入行为逐项不变。
 * - 任一缺项、越界、形状不符或非法依赖，整批拒绝（调用方保留旧计划）。
 */

export const N_MIN = 8;
export const N_MAX = 18;
export const COST_MIN = 1;
export const COST_MAX = 9999;

/** “先于”关系：[a, b] 表示姿态 a 必须先于姿态 b（a 是 b 的前置/基准姿态）。 */
export type Precedence = [number, number];

export interface CalibrationPlan {
  /** 姿态数量（姿态编号 1..n） */
  n: number;
  /** (n+1)² 个费用，行优先；matrix[i][j] = matrixFlat[i*(n+1)+j] */
  matrixFlat: number[];
  /**
   * 可选“先于”关系（已校验：姿态存在、不自指、无环，并按 (a,b) 升序去重）。
   * 缺省或空数组 = 无任何前置约束，求解/执行/展示与旧版完全一致。
   */
  prerequisites?: Precedence[];
}

export interface ValidationResult {
  ok: boolean;
  /** 校验通过的计划；失败时为 undefined */
  plan?: CalibrationPlan;
  /** 就地展示给工程师的错误信息（失败时至少一条） */
  errors: string[];
}

/**
 * 校验工程师编辑或导入的 JSON。
 * 接受形如 { "n": 10, "matrix": [[0, ...], ...] } 或 { "n": 10, "costs": [[...]] } 的对象，
 * 也接受裸二维数组（此时 n = 边长 - 1）。
 * 可选字段 "prerequisites"（也接受别名 "dependencies"）：形如 [[1, 3], [2, 3]]，
 * 每条 [a, b] 表示姿态 a 必须先于姿态 b；逐条校验姿态存在、不可自指，整批校验无环。
 */
export function validatePlan(input: unknown): ValidationResult {
  const errors: string[] = [];

  let matrix: unknown;
  let nCandidate: unknown;
  let prereqRaw: unknown;

  if (Array.isArray(input)) {
    matrix = input;
  } else if (isPlainObject(input)) {
    nCandidate = (input as Record<string, unknown>).n;
    matrix =
      (input as Record<string, unknown>).matrix ??
      (input as Record<string, unknown>).costs;
    prereqRaw = (input as Record<string, unknown>).prerequisites;
    if (prereqRaw === undefined) {
      prereqRaw = (input as Record<string, unknown>).dependencies;
    }
  } else {
    return { ok: false, errors: ['JSON 顶层必须是对象（含 n 与 matrix）或二维数组'] };
  }

  let n: number;
  if (typeof nCandidate === 'number') {
    n = nCandidate;
    if (!Number.isInteger(n) || n < N_MIN || n > N_MAX) {
      errors.push(`n 必须是 ${N_MIN}—${N_MAX} 的整数，收到：${formatValue(nCandidate)}`);
    }
  } else if (nCandidate === undefined) {
    // 无 n 字段时从矩阵边长推断，稍后再校验范围
    n = Array.isArray(matrix) ? matrix.length - 1 : NaN;
  } else {
    errors.push(`n 必须是数字，收到：${formatValue(nCandidate)}`);
    n = NaN;
  }

  if (!Array.isArray(matrix)) {
    errors.push('matrix（费用矩阵）必须是数组，行优先的 (N+1)×(N+1) 二维数组');
    return { ok: false, errors };
  }

  const dim = n + 1;

  let rowCountValid = true;
  if (Number.isInteger(n) && n >= N_MIN && n <= N_MAX) {
    if (matrix.length !== dim) {
      errors.push(
        `矩阵行数必须为 ${dim}（N+1，N=${n}），实际 ${matrix.length} 行；任一缺项即整批拒绝`,
      );
      rowCountValid = false;
    }
  } else {
    // n 本身非法时，检查矩阵是否为方形以给出更明确的推断错误
    const square =
      matrix.length > 0 &&
      matrix.every((row) => Array.isArray(row) && row.length === matrix.length);
    if (!square) {
      errors.push('无法从矩阵推断 N：矩阵必须是 (N+1)×(N+1) 的方形二维数组');
    } else {
      errors.push(`推断的 N=${matrix.length - 1} 不在 ${N_MIN}—${N_MAX} 范围内`);
    }
  }

  // 行形状检查
  let shapeValid = true;
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i];
    if (!Array.isArray(row)) {
      errors.push(`第 ${i} 行不是数组`);
      shapeValid = false;
      continue;
    }
    if (Number.isInteger(n) && n >= N_MIN && n <= N_MAX && row.length !== dim) {
      errors.push(`第 ${i} 行有 ${row.length} 项，必须为 ${dim} 项；任一缺项即整批拒绝`);
      shapeValid = false;
    }
  }

  if (!rowCountValid || !shapeValid || !Number.isInteger(n) || n < N_MIN || n > N_MAX) {
    return { ok: false, errors: dedupe(errors) };
  }

  // “先于”关系校验（N 与矩阵形状已确认，姿态存在性即可逐对检查）。
  let prerequisites: Precedence[] | undefined;
  if (prereqRaw !== undefined) {
    const prereqResult = validatePrecedences(prereqRaw, n);
    if (prereqResult.errors.length > 0) {
      errors.push(...prereqResult.errors);
    } else {
      prerequisites = prereqResult.edges;
    }
  }

  // 逐项检查（形状已确认：恰好 dim 行 × dim 列）
  const flat: number[] = [];
  for (let i = 0; i < dim; i++) {
    const row = matrix[i] as unknown[];
    for (let j = 0; j < dim; j++) {
      const cell = row[j];
      if (i === j) {
        if (cell !== 0) {
          errors.push(`主对角线必须为 0：matrix[${i}][${i}] 收到 ${formatValue(cell)}`);
        }
        flat.push(0);
      } else if (
        typeof cell === 'number' &&
        Number.isInteger(cell) &&
        cell >= COST_MIN &&
        cell <= COST_MAX
      ) {
        flat.push(cell);
      } else {
        errors.push(
          `matrix[${i}][${j}] 必须是 ${COST_MIN}—${COST_MAX} 的整数（不能缺项、小数或越界），收到：${formatValue(cell)}`,
        );
        flat.push(0); // 占位，最终仍会整体拒绝
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors: dedupe(errors) };
  }

  const plan: CalibrationPlan = { n, matrixFlat: flat };
  if (prerequisites && prerequisites.length > 0) plan.prerequisites = prerequisites;
  return { ok: true, plan, errors: [] };
}

interface PrecedenceResult {
  /** 校验通过后按 (a, b) 升序去重的“先于”边 */
  edges: Precedence[];
  errors: string[];
}

/**
 * 校验“先于”关系：必须是 [a, b] 二元整数数组；a、b 必须是 1..n 的现有姿态；
 * 不可自指；重复边去重；整图必须无环（环上的姿态永远无法满足前置）。
 */
export function validatePrecedences(raw: unknown, n: number): PrecedenceResult {
  const errors: string[] = [];
  if (!Array.isArray(raw)) {
    return {
      edges: [],
      errors: [`prerequisites 必须是形如 [[a, b], ...] 的数组（a 先于 b），收到：${formatValue(raw)}`],
    };
  }

  const seen = new Set<number>();
  const edges: Precedence[] = [];
  const adjacency: number[][] = Array.from({ length: n + 1 }, () => []);

  raw.forEach((entry, idx) => {
    const badEntry = (msg: string): void => {
      errors.push(`prerequisites[${idx}] ${msg}`);
    };
    if (!Array.isArray(entry) || entry.length !== 2) {
      badEntry(`必须是恰好两个姿态编号的数组 [a, b]（a 先于 b），收到：${formatValue(entry)}`);
      return;
    }
    const [a, b] = entry as unknown[];
    const validA = typeof a === 'number' && Number.isInteger(a) && a >= 1 && a <= n;
    const validB = typeof b === 'number' && Number.isInteger(b) && b >= 1 && b <= n;
    if (!validA) {
      badEntry(`的前置姿态 a 必须是 1—${n} 的现有姿态编号，收到：${formatValue(a)}`);
    }
    if (!validB) {
      badEntry(`的后置姿态 b 必须是 1—${n} 的现有姿态编号，收到：${formatValue(b)}`);
    }
    if (!validA || !validB) return;
    const av = a as number;
    const bv = b as number;
    if (av === bv) {
      badEntry(`不可自指：姿态 ${av} 不能先于自己`);
      return;
    }
    const key = av * (n + 1) + bv;
    if (seen.has(key)) {
      return; // 重复边静默去重（不报错）
    }
    seen.add(key);
    edges.push([av, bv]);
    adjacency[av]!.push(bv);
  });

  if (edges.length > 0) {
    const cycle = findCycle(adjacency, n);
    if (cycle) {
      errors.push(
        `“先于”依赖图存在环：${cycle.join(' → ')}（环上姿态的前置条件互相依赖，永远无法全部满足）`,
      );
    }
  }

  if (errors.length > 0) return { edges: [], errors: dedupe(errors) };
  edges.sort((p, q) => p[0]! - q[0]! || p[1]! - q[1]!);
  return { edges, errors: [] };
}

/**
 * 有向图找环（DFS 三色法）：边 a→b 表示“a 必须先于 b”。
 * 返回环上姿态（首尾相接展示），无环返回 null。n ≤ 18，递归深度安全。
 */
function findCycle(adjacency: number[][], n: number): number[] | null {
  // 0 = 未访问，1 = 在当前递归栈中，2 = 已结束
  const color = new Uint8Array(n + 1);
  const stack: number[] = [];

  const dfs = (u: number): number[] | null => {
    color[u] = 1;
    stack.push(u);
    for (const v of adjacency[u]!) {
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

  for (let u = 1; u <= n; u++) {
    if (color[u] === 0) {
      const found = dfs(u);
      if (found) return found;
    }
  }
  return null;
}

/**
 * 把“先于”边转成求解器/执行机使用的前置位掩码：
 * 返回数组按下标 = 姿态编号（0 号位闲置），preByPose[b] 的第 a 位为 1
 * 表示姿态 a 必须先于姿态 b。
 */
export function prerequisiteMasks(prerequisites: ReadonlyArray<Precedence> | undefined): Uint32Array {
  // 长度取 19：姿态编号 1..18，0 号位闲置；调用方按下标取位，无需知道 n。
  const masks = new Uint32Array(N_MAX + 1);
  if (prerequisites) {
    for (const [a, b] of prerequisites) {
      masks[b]! |= 1 << a;
    }
  }
  return masks;
}

/** 生成默认合法计划：对角线 0，非对角默认 1（工程师可改出方向性）。 */
export function createDefaultPlan(n: number): CalibrationPlan {
  const dim = n + 1;
  const matrixFlat = new Array<number>(dim * dim);
  for (let i = 0; i < dim; i++) {
    for (let j = 0; j < dim; j++) {
      matrixFlat[i * dim + j] = i === j ? 0 : 1;
    }
  }
  return { n, matrixFlat };
}

export function matrixToNested(plan: CalibrationPlan): number[][] {
  const dim = plan.n + 1;
  const rows: number[][] = [];
  for (let i = 0; i < dim; i++) {
    rows.push(plan.matrixFlat.slice(i * dim, (i + 1) * dim));
  }
  return rows;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v);
  if (v === undefined) return 'undefined（缺项）';
  return String(v);
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items));
}
