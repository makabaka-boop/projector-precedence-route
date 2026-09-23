import { type CalibrationPlan } from '../solver/plan';
import { type CandidateSet } from '../solver/tsp';
import { sequenceSatisfies } from '../solver/precedence';
import { RouteLine } from './RouteLine';

interface CandidatePickerProps {
  plan: CalibrationPlan;
  /** 当前已生效计划对应的候选集（由求解层一次算出） */
  candidateSet: CandidateSet;
  /** 当前选中的全局名次（1 起），默认首名 1 */
  selectedRank: number;
  onSelect: (rank: number) => void;
}

/**
 * 校准路线候选集：一次给出按总耗时升序、同费按完整姿态序列字典序升序排列的
 * 前三条互异精确路线（不足三条时只有实际数量）。默认选择首名，工程师可改选，
 * 所选路线将作为执行台的原计划及增量基线。
 *
 * 计划带“先于”关系时，候选只在前置姿态均已访问的状态上扩展——每条候选都满足依赖；
 * 依赖使可行路线少于三条时只展示实际数量；没有可行路线时明确提示（旧有效计划保留）。
 */
export function CandidatePicker({
  plan,
  candidateSet,
  selectedRank,
  onSelect,
}: CandidatePickerProps) {
  const dim = plan.n + 1;
  const edgeAt = (a: number, b: number) => plan.matrixFlat[a * dim + b]!;
  const pairs = plan.precedences ?? [];

  if (candidateSet.candidates.length === 0) {
    return (
      <div className="panel">
        <h2>校准路线候选集（精确解）</h2>
        <div className="alert error" role="alert">
          当前“先于”约束下不存在可行路线（约束形成依赖环或前置姿态无法访问）。
          请在下方“先于”关系草稿中解除相互约束后重新校验并应用；上次有效计划未被修改。
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>
        校准路线候选集（精确解 · 前 {candidateSet.candidates.length} 条互异路线）
        {pairs.length > 0 && (
          <span className="badge good" data-testid="precedence-badge">
            已应用“先于”关系 {pairs.length} 条：仅在前置姿态已访问时扩展
          </span>
        )}
      </h2>
      <div className="hint" style={{ marginBottom: 10 }}>
        一次求解同时保留每名状态的固定三个不同后缀及子排名（扩展 Held–Karp，非贪心、非全排列、
        非反复禁用边重算）。排序：总耗时升序；同费时按完整姿态序列字典序升序。
        默认选择首名，可改选后点上方“开始执行”进入执行台。求解耗时
        {candidateSet.solveMs.toFixed(1)} ms。
      </div>
      {pairs.length > 0 && (
        <div className="hint" style={{ marginBottom: 10 }} data-testid="precedence-list">
          先于关系：
          {pairs.map(([a, b]) => (
            <span key={`${a}-${b}`} className="prec-chip">
              {a} → {b}
            </span>
          ))}
          ；每条候选都满足全部关系，执行中确认下一站时同样强制检查前置。
        </div>
      )}

      <div className="candidate-list">
        {candidateSet.candidates.map((c) => {
          const checked = c.rank === selectedRank;
          // 防御性自检：展示的路线必须满足全部已应用“先于”关系
          const satisfies = sequenceSatisfies(c.sequence, pairs);
          return (
            <label
              key={c.rank}
              data-testid={`candidate-row-${c.rank}`}
              className={['candidate-row', checked ? 'selected' : ''].join(' ')}
            >
              <input
                type="radio"
                name="candidate-rank"
                value={c.rank}
                checked={checked}
                onChange={() => onSelect(c.rank)}
                aria-label={`选择候选路线第 ${c.rank} 名`}
              />
              <div className="candidate-body">
                <div className="row spread">
                  <span className="candidate-rank">
                    第 {c.rank} 名
                    {c.rank === 1 && <span className="badge good">默认首名 · 精确最优</span>}
                    {!satisfies && <span className="badge warn">违反先于关系（不应出现）</span>}
                  </span>
                  <span className="candidate-cost">总耗时 {c.cost}</span>
                </div>
                <RouteLine tour={c.tour} edgeAt={edgeAt} hideEdgeCost />
                <div className="hint">
                  从 0 出发，恰访姿态 1…{plan.n} 各一次并回到 0
                  {pairs.length > 0 ? '（并满足全部“先于”关系）' : ''}
                  ；总耗时可由当前非对称矩阵逐边复算。
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
