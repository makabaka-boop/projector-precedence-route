/**
 * 浏览器本地持久化。所有数据仅存于浏览器 localStorage，不向任何服务发送。
 * 加载时重新校验，损坏或被外部改坏的数据一律丢弃，回退到调用方给定默认值。
 *
 * “先于”关系随计划一起落盘：无关系时省略该字段，旧版本写入的载荷形状保持不变；
 * 读取时旧数据没有该字段即按无依赖处理，逐项保持旧行为。
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
  // 落盘前再校验一次（矩阵 + “先于”关系），拒绝写入任何不合法数据
  const payload: Record<string, unknown> = { n: plan.n, matrix: matrixToNested(plan) };
  if (plan.precedences && plan.precedences.length > 0) {
    payload.precedences = plan.precedences.map(([a, b]) => [a, b]);
  }
  const result = validatePlan(payload);
  if (!result.ok) {
    throw new Error('内部错误：拒绝把不合法计划写入本地存储');
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function clearStoredPlan(): void {
  localStorage.removeItem(STORAGE_KEY);
}
