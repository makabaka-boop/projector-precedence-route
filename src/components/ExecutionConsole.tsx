import { useState } from 'react';
import { type CalibrationPlan } from '../solver/plan';
import { type RouteCandidate } from '../solver/tsp';
import {
  type ExecutionState,
  confirmNext,
  deltaVsOriginal,
  finishReturn,
  projectedTotal,
  startExecution,
} from '../solver/execution';
import { RouteLine } from './RouteLine';

interface ExecutionConsoleProps {
  plan: CalibrationPlan;
  /** 工程师选定的校准路线候选；省略时默认候选首名（精确最优） */
  baseline?: RouteCandidate;
  /** 基线候选的全局名次（1 起），用于台账展示 */
  baselineRank?: number;
  /** 放弃当前执行（计划不变） */
  onAbort: () => void;
}

/** 执行台：所选候选为基线 + 现场改序后每拍精确重排最短后缀。 */
export function ExecutionConsole({
  plan,
  baseline,
  baselineRank,
  onAbort,
}: ExecutionConsoleProps) {
  const [state, setState] = useState<ExecutionState>(() => startExecution(plan, baseline));
  const [error, setError] = useState<string>('');

  // 注意：不能在 setState 的 updater 内调用会抛错的 confirmNext——React 可能在 render
  // 阶段重放 updater，其中抛出的错误会绕过这里的 try/catch 直接进入错误边界。
  // 先用当前渲染快照算出下一状态（事件处理器闭包里即最新状态），抛错则拒绝并保留进度。
  function confirm(pose: number) {
    try {
      const next = confirmNext(state, pose);
      setState(next);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function goHome() {
    try {
      const next = finishReturn(state);
      setState(next);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const delta = deltaVsOriginal(state);
  const projected = projectedTotal(state);
  const dim = plan.n + 1;
  const edgeAt = (a: number, b: number) => plan.matrixFlat[a * dim + b]!;
  const recommendedNext = state.suffix.sequence[0];
  const rank = baselineRank ?? state.baselineRank;

  // “先于”门控的界面镜像：未完成姿态中，前置仍在剩余集合（未确认）的姿态不可确认。
  // 与状态机 confirmNext 的检查同一真源（prereqByPose）；点击仍会被状态机拒绝并报错，
  // 已确认进度原样保留。
  const remainingMask = state.remaining.reduce((mask, p) => mask | (1 << p), 0);
  const isBlocked = (pose: number): boolean =>
    !state.visited.includes(pose) && (state.prereqByPose[pose]! & remainingMask) !== 0;
  const blockedPredecessors = (pose: number): number[] => {
    const bits = state.prereqByPose[pose]! & remainingMask;
    const out: number[] = [];
    let b = bits;
    while (b !== 0) {
      const lsb = b & -b;
      out.push(31 - Math.clz32(lsb));
      b &= b - 1;
    }
    return out.sort((a, b2) => a - b2);
  };

  return (
    <div>
      <div className="panel">
        <div className="row spread">
          <h2 style={{ margin: 0 }}>
            执行台（N={plan.n}）
            {!state.finished && state.visited.length === 0 && (
              <span className="badge warn">待开始：从停放位 0 出发</span>
            )}
            {!state.finished && state.visited.length > 0 && (
              <span className="badge good">
                执行中：已确认 {state.visited.length}/{plan.n}
              </span>
            )}
            {state.finished && <span className="badge good">已回到停放位 0，结案</span>}
          </h2>
          <button className="btn" onClick={onAbort}>
            放弃执行，返回编辑
          </button>
        </div>

        <div className="metric-grid">
          <div className="metric">
            <div className="label">所选候选基线总耗时（第 {rank} 名）</div>
            <div className="value">{state.original.cost}</div>
          </div>
          <div className="metric">
            <div className="label">已发生费用</div>
            <div className="value">{state.incurred}</div>
          </div>
          <div className="metric">
            <div className="label">预计完工（已发生+最短后缀）</div>
            <div className="value">{projected}</div>
          </div>
          <div className="metric">
            <div className="label">相对所选候选增量</div>
            <div
              className={`value ${delta > 0 ? 'bad' : delta < 0 ? 'good' : ''}`}
              data-testid="delta-vs-baseline"
            >
              {delta > 0 ? `+${delta}` : `${delta}`}
            </div>
          </div>
          <div className="metric">
            <div className="label">当前最短后缀耗时（含回 0）</div>
            <div className="value">{state.suffix.cost}</div>
          </div>
          <div className="metric">
            <div className="label">本拍求解耗时</div>
            <div className="value" style={{ fontSize: 15 }}>
              {state.suffix.solveMs.toFixed(1)} ms
            </div>
          </div>
        </div>

        {delta < 0 && !state.finished && (
          <div className="alert info" role="status">
            基线是第 {rank} 名次优候选：当前精确最短收尾比所选路线短 {-delta}
            ，故增量为负。现场一旦偏离最短后缀，增量仍可能转为正数。
          </div>
        )}

        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
      </div>

      <div className="panel">
        <h3>所选校准路线（候选第 {rank} 名；增量基线）</h3>
        <RouteLine tour={state.original.tour} edgeAt={edgeAt} visited={new Set()} />
      </div>

      <div className="panel">
        <h3>实际已走路线 + 当前最短收尾</h3>
        <RouteLine
          tour={[0, ...state.visited, ...state.suffix.sequence, 0]}
          edgeAt={edgeAt}
          visited={new Set(state.visited)}
        />
        {!state.finished && state.remaining.length > 0 && (
          <div className="hint">
            绿色姿态是当前精确后缀推荐的下一站；可确认任一未完成且前置姿态都已确认的姿态，
            系统会以此姿态为新起点，在剩余姿态上继续遵守“先于”关系精确重排（非贪心、非全排列）。
            🔒 姿态的先于姿态尚未全部完成，确认会被拒绝且已确认进度保留。
          </div>
        )}
      </div>

      {!state.finished && (
        <div className="panel">
          <div className="row spread">
            <h2 style={{ margin: 0 }}>
              确认实际下一站
              <span className="muted" style={{ fontWeight: 400, fontSize: 12, marginLeft: 10 }}>
                剩余 {state.remaining.length} 个姿态
              </span>
            </h2>
            {state.remaining.length === 0 && (
              <button className="btn good" onClick={goHome}>
                全部姿态已完成，返回停放位 0（边 {state.current}→0，费用 {edgeAt(state.current, 0)}）
              </button>
            )}
          </div>

          {state.remaining.length > 0 && (
            <div className="pose-grid">
              {Array.from({ length: plan.n }, (_, k) => k + 1).map((pose) => {
                const done = state.visited.includes(pose);
                const recommended = pose === recommendedNext;
                const blocked = !done && isBlocked(pose);
                const moveCost = edgeAt(state.current, pose);
                return (
                  <button
                    key={pose}
                    data-testid={`pose-blocked-${pose}`}
                    className={[
                      'pose-btn',
                      done ? 'done' : '',
                      recommended ? 'recommended' : '',
                      blocked ? 'blocked' : '',
                    ].join(' ')}
                    disabled={done}
                    onClick={() => confirm(pose)}
                    aria-disabled={blocked || done}
                    title={
                      done
                        ? `姿态 ${pose} 已完成，不得再次确认`
                        : blocked
                          ? `姿态 ${pose} 的先于姿态未完成，需先确认：${blockedPredecessors(pose).join('、')}；点击会被拒绝且进度保留`
                          : `确认姿态 ${pose} 为下一站，本步镜组转动费用 ${moveCost}`
                    }
                  >
                    <span className="pose-id">姿态 {pose}</span>
                    {done ? (
                      <span className="pose-meta">已完成 · 禁用</span>
                    ) : blocked ? (
                      <span className="pose-meta">
                        🔒 等待先于姿态：{blockedPredecessors(pose).join('、')}
                      </span>
                    ) : recommended ? (
                      <span className="pose-meta">
                        ★ 精确后缀推荐 · 本步费用 {moveCost}
                      </span>
                    ) : (
                      <span className="pose-meta">
                        本步费用 {moveCost} · 点击确认并精确重排
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {state.finished && (
        <div className="panel">
          <h3>最终台账</h3>
          <table className="ledger">
            <tbody>
              <tr>
                <th>实际完整路线</th>
                <td className="num">{[0, ...state.visited, 0].join(' → ')}</td>
              </tr>
              <tr>
                <th>实际总耗时</th>
                <td className="num">{state.incurred}</td>
              </tr>
              <tr>
                <th>所选候选基线总耗时（第 {rank} 名）</th>
                <td className="num">{state.original.cost}</td>
              </tr>
              <tr>
                <th>相对所选候选的增量</th>
                <td className="num">
                  {delta > 0
                    ? `+${delta}`
                    : delta < 0
                      ? `${delta}`
                      : rank === 1
                        ? '0（与原计划一致）'
                        : '0（与基线一致）'}
                </td>
              </tr>
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={onAbort}>
              返回编辑台
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
