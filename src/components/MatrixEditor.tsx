import { useEffect, useMemo, useRef, useState } from 'react';
import {
  COST_MAX,
  COST_MIN,
  N_MAX,
  N_MIN,
  type CalibrationPlan,
  validatePlan,
} from '../solver/plan';
import {
  formatPrecedenceText,
  parsePrecedenceText,
} from '../solver/precedence';

interface MatrixEditorProps {
  /** 已生效的计划（导入/应用失败时始终保留它） */
  plan: CalibrationPlan;
  onApply: (plan: CalibrationPlan) => void;
}

/**
 * 编辑台：可改 N、可逐格编辑费用、可粘贴/导入 JSON、可导出。
 * 草稿与“已生效计划”分离：只有整批校验通过（矩阵 + 可选“先于”关系）才调用 onApply；
 * 任一缺项、越界或非法依赖（姿态不存在/自指/有环）都就地显示错误并保留旧计划。
 */
export function MatrixEditor({ plan, onApply }: MatrixEditorProps) {
  const [n, setN] = useState<number>(plan.n);
  const [cells, setCells] = useState<number[]>(plan.matrixFlat);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string>('');
  const [jsonText, setJsonText] = useState<string>('');
  // “先于”关系草稿：未点“校验并应用”前绝不影响已生效计划与候选集。
  const [precedenceText, setPrecedenceText] = useState<string>(() =>
    formatPrecedenceText(plan.precedences ?? []),
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const dim = n + 1;

  // 切换 N：在合法范围内重建网格，沿用能复用的旧费用，新位置给默认值 1
  function changeN(nextN: number) {
    if (!Number.isInteger(nextN) || nextN < N_MIN || nextN > N_MAX) return;
    const nextDim = nextN + 1;
    const next = new Array<number>(nextDim * nextDim);
    const oldDim = dim;
    for (let i = 0; i < nextDim; i++) {
      for (let j = 0; j < nextDim; j++) {
        if (i === j) {
          next[i * nextDim + j] = 0;
        } else if (i < oldDim && j < oldDim) {
          next[i * nextDim + j] = cells[i * oldDim + j] ?? 1;
        } else {
          next[i * nextDim + j] = 1;
        }
      }
    }
    setN(nextN);
    setCells(next);
    setErrors([]);
    setNotice('');
  }

  function editCell(i: number, j: number, raw: string) {
    const idx = i * dim + j;
    const next = cells.slice();
    if (i === j) {
      next[idx] = 0; // 对角线锁定为 0
    } else if (raw.trim() === '') {
      // 用 NaN 标记“缺项”：界面标红，应用时整批拒绝（不会污染已生效计划）
      next[idx] = Number.NaN;
    } else {
      const v = Number(raw);
      next[idx] = v;
    }
    setCells(next);
    setErrors([]);
    setNotice('');
  }

  /** 逐格即时合法性（只影响标红，不阻断输入） */
  function cellInvalid(i: number, j: number, v: number): boolean {
    if (i === j) return v !== 0;
    return !Number.isInteger(v) || v < COST_MIN || v > COST_MAX;
  }

  function commit() {
    const nested: number[][] = [];
    for (let i = 0; i < dim; i++) nested.push(cells.slice(i * dim, (i + 1) * dim));

    // 先解析“先于”草稿（逐行语法错误在此暴露），再连同矩阵一起整批校验。
    const draft = parsePrecedenceText(precedenceText);
    if (draft.errors.length > 0) {
      setErrors([...draft.errors, '整批拒绝：当前已生效计划（含其依赖）保持不变。']);
      setNotice('');
      return;
    }

    const result = validatePlan({ n, matrix: nested, precedences: draft.pairs });
    if (!result.ok || !result.plan) {
      setErrors([...result.errors, '整批拒绝：当前已生效计划（含其依赖）保持不变。']);
      setNotice('');
      return;
    }
    setErrors([]);
    const pairCount = result.plan.precedences?.length ?? 0;
    setNotice(
      `计划已生效：N=${result.plan.n}，费用矩阵 (${dim}×${dim}) 全部合法，“先于”关系 ${pairCount} 条。`,
    );
    onApply(result.plan);
    // 已生效关系规范化回写草稿（去重、排序），与“已应用计划”保持单一真源
    setPrecedenceText(formatPrecedenceText(result.plan.precedences ?? []));
  }

  function applyJson(text: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setErrors([`JSON 语法错误：${(e as Error).message}；旧计划已保留`]);
      setNotice('');
      return;
    }
    const result = validatePlan(parsed);
    if (!result.ok || !result.plan) {
      setErrors([...result.errors, '整批拒绝：当前已生效计划保持不变。']);
      setNotice('');
      return;
    }
    setN(result.plan.n);
    setCells(result.plan.matrixFlat);
    setPrecedenceText(formatPrecedenceText(result.plan.precedences ?? []));
    setErrors([]);
    setNotice(
      `导入成功：N=${result.plan.n}，“先于”关系 ${result.plan.precedences?.length ?? 0} 条。点击“校验并应用”后才会替换当前计划。`,
    );
  }

  function importJson() {
    const text = jsonText.trim();
    if (!text) {
      setErrors(['JSON 内容为空，未导入任何数据']);
      setNotice('');
      return;
    }
    applyJson(text);
  }

  function onFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      setJsonText(text);
      applyJson(text);
    };
    reader.onerror = () => {
      setErrors([`读取文件失败：${file.name}`]);
    };
    reader.readAsText(file);
  }

  function exportJson() {
    const nested: number[][] = [];
    for (let i = 0; i < dim; i++) nested.push(cells.slice(i * dim, (i + 1) * dim));
    const draft = parsePrecedenceText(precedenceText);
    // 导出当前网格与当前依赖草稿（无关系时不带字段，与旧 JSON 形态一致）
    const payload: Record<string, unknown> = { n, matrix: nested };
    if (draft.pairs.length > 0) payload.precedences = draft.pairs;
    setJsonText(JSON.stringify(payload, null, 2));
    setNotice('已把当前网格与依赖草稿序列化为 JSON（仍以已生效计划为准，除非再应用）。');
  }

  const columnHeaders = useMemo(() => Array.from({ length: dim }, (_, k) => k), [dim]);

  useEffect(() => {
    // 外部（如“恢复默认”）更换计划时同步草稿：矩阵与“先于”关系都以已生效计划为准
    setN(plan.n);
    setCells(plan.matrixFlat);
    setPrecedenceText(formatPrecedenceText(plan.precedences ?? []));
  }, [plan]);

  const invalidCount = cells.filter((v, idx) => {
    const i = Math.floor(idx / dim);
    const j = idx % dim;
    return cellInvalid(i, j, v);
  }).length;

  return (
    <div>
      <div className="panel">
        <h2>姿态与费用矩阵</h2>
        <div className="row spread">
          <div className="row">
            <label>
              姿态数 N（8—18）：
              <select
                value={n}
                onChange={(e) => changeN(Number(e.target.value))}
                style={{ marginLeft: 8 }}
              >
                {Array.from({ length: N_MAX - N_MIN + 1 }, (_, k) => N_MIN + k).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <span className="muted">
              矩阵 {dim}×{dim}（含停放位 0）；C[i→j]，转动有方向性
            </span>
            {invalidCount > 0 && <span className="badge warn">{invalidCount} 项待修正</span>}
          </div>
          <div className="row">
            <button className="btn" onClick={exportJson}>
              导出为 JSON
            </button>
            <label className="file-label btn">
              导入 JSON 文件
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                  e.target.value = '';
                }}
              />
            </label>
            <button className="btn primary" onClick={commit}>
              校验并应用
            </button>
          </div>
        </div>

        <div className="matrix-scroll" style={{ marginTop: 12 }}>
          <table className="matrix">
            <thead>
              <tr>
                <th className="corner">行 i ↓ / 列 j →</th>
                {columnHeaders.map((j) => (
                  <th key={j}>{j}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: dim }, (_, i) => (
                <tr key={i}>
                  <th>{i}</th>
                  {Array.from({ length: dim }, (_, j) => {
                    const v = cells[i * dim + j]!;
                    const diag = i === j;
                    return (
                      <td key={j}>
                        <input
                          className={[
                            diag ? 'diag' : '',
                            cellInvalid(i, j, v) ? 'invalid' : '',
                          ].join(' ')}
                          value={Number.isNaN(v) ? '' : v}
                          disabled={diag}
                          inputMode="numeric"
                          aria-label={`matrix[${i}][${j}]`}
                          onChange={(e) => editCell(i, j, e.target.value)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="hint">
          对角线锁定为 0；其余项必须为 {COST_MIN}—{COST_MAX} 的整数。清空一格即视为“缺项”，
          应用时整批拒绝，已生效计划不会被破坏。
        </div>

        {errors.length > 0 && (
          <div className="alert error" role="alert">
            数据被整批拒绝，旧计划保留：
            <ul>
              {errors.map((msg, idx) => (
                <li key={idx}>{msg}</li>
              ))}
            </ul>
          </div>
        )}
        {notice && (
          <div className="alert ok" role="status">
            {notice}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>
          “先于”关系草稿（可选）
          <span className="muted" style={{ fontWeight: 400, fontSize: 12, marginLeft: 10 }}>
            已生效 {(plan.precedences ?? []).length} 条 · 草稿与已应用计划分离，应用前不影响路线
          </span>
        </h2>
        <div className="hint" style={{ marginBottom: 8 }}>
          每行一条 “前置, 后置”（也支持 <code>a -&gt; b</code> / <code>a→b</code> /
          “a 先于 b”）。含义：前置姿态必须先于后置姿态完成测量。提交时校验姿态存在
          （1—{n}）、不可自指、依赖图无环；非法依赖整批拒绝，上次有效计划与候选路线不被污染。
          清空并应用即移除全部关系。
        </div>
        <textarea
          spellCheck={false}
          data-testid="precedence-editor"
          value={precedenceText}
          placeholder={'# 例如：\n1, 3\n2 -> 3\n1 先于 5'}
          onChange={(e) => {
            setPrecedenceText(e.target.value);
            setErrors([]);
            setNotice('');
          }}
          style={{ minHeight: 110 }}
        />
        <div className="row" style={{ marginTop: 8 }}>
          <span className="muted">
            当前草稿 {parsePrecedenceText(precedenceText).pairs.length} 条（含传递/重复时提交会去重）
          </span>
        </div>
      </div>

      <div className="panel">
        <h2>JSON 编辑 / 导入</h2>
        <textarea
          spellCheck={false}
          value={jsonText}
          placeholder={'{\n  "n": 8,\n  "matrix": [\n    [0, 12, 7, ...],\n    ...\n  ]\n}'}
          onChange={(e) => setJsonText(e.target.value)}
        />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" onClick={importJson}>
            解析并载入草稿
          </button>
          <span className="muted">
            支持 {'{ "n": 8, "matrix": [[...]], "precedences": [[1, 3]] }'} 或裸二维数组；校验通过才进入网格。
          </span>
        </div>
      </div>
    </div>
  );
}
