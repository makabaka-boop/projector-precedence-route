/**
 * 计划数据模型与严格校验。
 *
 * 约定：
 * - 姿态编号 1..N（N 取 8—18），0 为停放位。
 * - 费用矩阵为 (N+1)×(N+1) 的方阵，行优先二维数组。
 * - 主对角线必须为 0；其余项必须是 1..9999 的整数（费用有方向性，矩阵不必对称）。
 * - 任一缺项、越界或形状不符，整批拒绝（调用方保留旧计划）。
 */

export const N_MIN = 8;
export const N_MAX = 18;
export const COST_MIN = 1;
export const COST_MAX = 9999;

export interface CalibrationPlan {
  /** 姿态数量（姿态编号 1..n） */
  n: number;
  /** (n+1)² 个费用，行优先；matrix[i][j] = matrixFlat[i*(n+1)+j] */
  matrixFlat: number[];
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
 */
export function validatePlan(input: unknown): ValidationResult {
  const errors: string[] = [];

  let matrix: unknown;
  let nCandidate: unknown;

  if (Array.isArray(input)) {
    matrix = input;
  } else if (isPlainObject(input)) {
    nCandidate = (input as Record<string, unknown>).n;
    matrix =
      (input as Record<string, unknown>).matrix ??
      (input as Record<string, unknown>).costs;
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

  return { ok: true, plan: { n, matrixFlat: flat }, errors: [] };
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
