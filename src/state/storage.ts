/**
 * 浏览器本地持久化。所有数据仅存于浏览器 localStorage，不向任何服务发送。
 * 加载时重新校验，损坏或被外部改坏的数据一律丢弃，回退到调用方给定默认值。
 */
import { type CalibrationPlan, validatePlan } from '../solver/plan';
import { matrixToNested } from '../solver/plan';

const STORAGE_KEY = 'dome-calibration-plan-v1';

export function loadPlan(fallback: CalibrationPlan): CalibrationPlan {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    const result = validatePlan(parsed);
    if (result.ok && result.plan) return result.plan;
    return fallback;
  } catch {
    return fallback;
  }
}

export function savePlan(plan: CalibrationPlan): void {
  // 落盘前再校验一次，拒绝写入任何不合法数据
  const result = validatePlan({ n: plan.n, matrix: matrixToNested(plan) });
  if (!result.ok) {
    throw new Error('内部错误：拒绝把不合法计划写入本地存储');
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ n: plan.n, matrix: matrixToNested(plan) }));
}

export function clearStoredPlan(): void {
  localStorage.removeItem(STORAGE_KEY);
}
