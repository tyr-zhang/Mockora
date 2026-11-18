"use client";

import { useState } from "react";
import type { AlgoLanguage, AlgorithmQuestion, AlgorithmRunResult } from "@/types/interview";
import { apiPath } from "@/lib/basePath";

/** 根据样例测试用例的实际值，推断出一个足够贴合题目的 Java 静态类型（仅覆盖常见题型）。 */
function inferJavaType(value: unknown): string {
  if (typeof value === "number") return Number.isInteger(value) ? "int" : "double";
  if (typeof value === "string") return "String";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) {
    if (value.length === 0) return "int[]";
    return `${inferJavaType(value[0])}[]`;
  }
  return "Object";
}

function javaDefaultValue(type: string): string {
  if (type === "int" || type === "double") return "0";
  if (type === "boolean") return "false";
  return "null";
}

function starterCode(language: AlgoLanguage, q: AlgorithmQuestion): string {
  const params = q.paramNames.join(", ");
  if (language === "javascript") {
    return `function ${q.functionName}(${params}) {\n  // TODO: 在此实现\n}`;
  }
  if (language === "java") {
    const sample = q.testCases[0];
    const paramTypes = q.paramNames.map((p, i) => `${inferJavaType(sample?.input[i])} ${p}`).join(", ");
    const returnType = inferJavaType(sample?.expectedOutput);
    return `class Solution {\n  public static ${returnType} ${q.functionName}(${paramTypes}) {\n    // TODO: 在此实现\n    return ${javaDefaultValue(returnType)};\n  }\n}`;
  }
  return `def ${q.functionName}(${params}):\n    # TODO: 在此实现\n    pass`;
}

interface AlgorithmPanelProps {
  question: AlgorithmQuestion;
  /** 展示参考思路按钮（学习模式用），考试模式应为 false */
  allowReveal?: boolean;
  submitLabel?: string;
  submitting?: boolean;
  onSubmit?: (payload: { language: AlgoLanguage; code: string; lastRun: AlgorithmRunResult | null }) => void;
}

export default function AlgorithmPanel({
  question,
  allowReveal = false,
  submitLabel,
  submitting = false,
  onSubmit,
}: AlgorithmPanelProps) {
  const [language, setLanguage] = useState<AlgoLanguage>("javascript");
  const [code, setCode] = useState(() => starterCode("javascript", question));
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<AlgorithmRunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  function switchLanguage(next: AlgoLanguage) {
    setLanguage(next);
    setCode(starterCode(next, question));
    setLastRun(null);
  }

  const visibleTestCases = question.testCases.filter((tc) => !tc.hidden);

  async function runTests() {
    setRunning(true);
    setRunError(null);
    try {
      const res = await fetch(apiPath("/api/algorithm/run"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language,
          code,
          functionName: question.functionName,
          testCases: question.testCases,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "代码执行失败");
      setLastRun(data as AlgorithmRunResult);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "代码执行失败");
    } finally {
      setRunning(false);
    }
  }

  const passedCount = lastRun?.results.filter((r) => r.passed).length ?? 0;
  const totalCount = lastRun?.results.length ?? 0;

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>{question.title}</h3>
      <p style={{ whiteSpace: "pre-wrap" }}>{question.description}</p>

      {visibleTestCases.length > 0 && (
        <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 12 }}>
          <strong>示例：</strong>
          {visibleTestCases.map((tc, i) => (
            <div key={i}>
              输入: {JSON.stringify(tc.input)} → 输出: {JSON.stringify(tc.expectedOutput)}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <select value={language} onChange={(e) => switchLanguage(e.target.value as AlgoLanguage)}>
          <option value="javascript">JavaScript</option>
          <option value="python">Python</option>
          <option value="java">Java</option>
        </select>
      </div>

      <textarea
        value={code}
        onChange={(e) => setCode(e.target.value)}
        rows={12}
        style={{ fontFamily: "monospace", width: "100%" }}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="secondary" onClick={runTests} disabled={running}>
          {running ? "运行中..." : "运行测试"}
        </button>
        {onSubmit && (
          <button
            onClick={() => onSubmit({ language, code, lastRun })}
            disabled={submitting}
          >
            {submitting ? "提交中..." : submitLabel || "提交"}
          </button>
        )}
        {allowReveal && (
          <button className="secondary" onClick={() => setRevealed((v) => !v)}>
            {revealed ? "收起参考思路" : "查看参考思路"}
          </button>
        )}
      </div>

      {runError && <p className="error-text">{runError}</p>}

      {lastRun && (
        <div className="card" style={{ marginTop: 12 }}>
          <p style={{ margin: "0 0 8px" }}>
            测试结果：{passedCount}/{totalCount} 通过{lastRun.allPassed ? "（全部通过）" : ""}
          </p>
          {lastRun.results.map((r, i) => (
            <div key={i} style={{ fontSize: 13, marginBottom: 6 }}>
              <span style={{ color: r.passed ? "var(--success, #2a9d5c)" : "var(--error, #d14343)" }}>
                {r.passed ? "✓ 通过" : "✗ 未通过"}
              </span>
              {r.hidden ? "（隐藏用例）" : ""}
              {!r.hidden && (
                <span style={{ color: "var(--text-dim)" }}>
                  {" "}
                  期望: {JSON.stringify(r.expectedOutput)}，实际: {JSON.stringify(r.actual)}
                </span>
              )}
              {r.error && <span style={{ color: "var(--error, #d14343)" }}> 错误: {r.error}</span>}
            </div>
          ))}
        </div>
      )}

      {revealed && (
        <div className="card" style={{ marginTop: 12 }}>
          <strong>参考思路：</strong>
          <p style={{ whiteSpace: "pre-wrap", margin: "8px 0 0" }}>{question.approachExplanation}</p>
        </div>
      )}
    </div>
  );
}
