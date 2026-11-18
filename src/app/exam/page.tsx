"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loadSetup } from "@/lib/clientSession";
import { consumeSse } from "@/lib/clientSse";
import AlgorithmPanel from "@/components/AlgorithmPanel";
import type { AlgoLanguage, AlgorithmQuestion, AlgorithmRunResult, InterviewReport, TopicRecord } from "@/types/interview";

type Phase = "waiting_ai" | "waiting_user" | "generating_report" | "report_failed" | "ended";

export default function ExamPage() {
  const router = useRouter();
  const [setup, setSetup] = useState<{ resumeText: string; targetRole: string } | null>(null);
  const [closedTopics, setClosedTopics] = useState<TopicRecord[]>([]);
  const [currentTopic, setCurrentTopic] = useState<TopicRecord | null>(null);
  const [streamingMessage, setStreamingMessage] = useState("");
  const [phase, setPhase] = useState<Phase>("waiting_ai");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<InterviewReport | null>(null);
  const [algorithmQuestion, setAlgorithmQuestion] = useState<AlgorithmQuestion | null>(null);
  const [algorithmSubmitting, setAlgorithmSubmitting] = useState(false);
  const bootstrapped = useRef(false);
  const reqSeq = useRef(0);
  const pendingReportHistory = useRef<TopicRecord[] | null>(null);
  const isTechnicalRef = useRef(false);
  const algorithmUsedRef = useRef(false);

  useEffect(() => {
    const s = loadSetup();
    if (!s) {
      router.replace("/");
      return;
    }
    setSetup(s);
  }, [router]);

  useEffect(() => {
    if (setup && !bootstrapped.current) {
      bootstrapped.current = true;
      void requestNextTurn(setup, [], null);
      fetch("/api/interview/classify-technical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText: setup.resumeText, targetRole: setup.targetRole }),
      })
        .then((res) => res.json())
        .then((data) => {
          isTechnicalRef.current = Boolean(data.isTechnical);
        })
        .catch(() => {
          isTechnicalRef.current = false;
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup]);

  async function requestNextTurn(
    s: { resumeText: string; targetRole: string },
    history: TopicRecord[],
    openTopic: TopicRecord | null
  ) {
    const mySeq = ++reqSeq.current;
    setPhase("waiting_ai");
    setStreamingMessage("");
    setError(null);
    const fullHistory = openTopic ? [...history, openTopic] : history;
    try {
      const res = await fetch("/api/exam/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText: s.resumeText, targetRole: s.targetRole, history: fullHistory }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "生成面试内容失败");
      }

      let action: "follow_up" | "next_topic" | "end_interview" | null = null;
      let message = "";
      await consumeSse(res, (event) => {
        if (reqSeq.current !== mySeq) return;
        if (event.type === "message_delta") {
          message += event.chunk as string;
          setStreamingMessage(message);
        } else if (event.type === "done") {
          action = event.action as typeof action;
          message = (event.message as string) ?? message;
        } else if (event.type === "error") {
          throw new Error(event.error as string);
        }
      });

      // 若此请求已被“提前结束”或新一轮请求取代，丢弃本次结果，避免覆盖已经进入的报告/新状态
      if (reqSeq.current !== mySeq) return;

      if (!action) throw new Error("未能获取面试官的决策");

      if (action === "end_interview") {
        const finalHistory = openTopic ? [...history, openTopic] : history;
        setClosedTopics(finalHistory);
        setCurrentTopic(null);
        setStreamingMessage("");
        await generateReport(s, finalHistory, mySeq);
        return;
      }

      if (action === "follow_up" && openTopic) {
        const updated: TopicRecord = {
          ...openTopic,
          messages: [...openTopic.messages, { role: "interviewer", content: message }],
        };
        setCurrentTopic(updated);
        setStreamingMessage("");
        setPhase("waiting_user");
        return;
      }

      // next_topic
      const newClosed = openTopic ? [...history, openTopic] : history;
      setClosedTopics(newClosed);

      if (isTechnicalRef.current && !algorithmUsedRef.current) {
        algorithmUsedRef.current = true;
        await startAlgorithmTopic(s, newClosed, mySeq);
        return;
      }

      const newTopic: TopicRecord = {
        topicIndex: newClosed.length,
        messages: [{ role: "interviewer", content: message }],
      };
      setCurrentTopic(newTopic);
      setStreamingMessage("");
      setPhase("waiting_user");
    } catch (err) {
      if (reqSeq.current !== mySeq) return;
      setError(err instanceof Error ? err.message : "生成面试内容失败");
    }
  }

  async function startAlgorithmTopic(
    s: { resumeText: string; targetRole: string },
    newClosed: TopicRecord[],
    mySeq: number
  ) {
    setStreamingMessage("");
    setPhase("waiting_ai");
    try {
      const res = await fetch("/api/algorithm/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText: s.resumeText, targetRole: s.targetRole }),
      });
      const data = await res.json();
      if (reqSeq.current !== mySeq) return;
      if (!res.ok) throw new Error(data.error || "生成算法题失败");

      const question: AlgorithmQuestion = data;
      setAlgorithmQuestion(question);
      const newTopic: TopicRecord = {
        topicIndex: newClosed.length,
        isAlgorithm: true,
        messages: [{ role: "interviewer", content: `[算法编程题] ${question.title}\n\n${question.description}` }],
      };
      setCurrentTopic(newTopic);
      setPhase("waiting_user");
    } catch (err) {
      if (reqSeq.current !== mySeq) return;
      // 不重置 algorithmUsedRef：本次已经尝试过算法题（无论成功失败都算"用过"），
      // 避免回退到常规主题后在 next_topic 时再次触发算法题生成，防止反复失败时的递归重试风暴。
      setError(err instanceof Error ? err.message : "生成算法题失败，已跳过本次算法题");
      setClosedTopics(newClosed);
      setCurrentTopic(null);
      // 算法题生成失败时不能让用户卡死在无任何可操作入口的空白状态，
      // 直接回退为生成一道常规主题继续面试。
      await requestNextTurn(s, newClosed, null);
    }
  }

  async function submitAlgorithmAnswer(payload: {
    language: AlgoLanguage;
    code: string;
    lastRun: AlgorithmRunResult | null;
  }) {
    if (!setup || !currentTopic) return;
    setAlgorithmSubmitting(true);
    try {
      const languageLabel: Record<string, string> = { javascript: "JavaScript", python: "Python", java: "Java" };
      const summary = payload.lastRun
        ? `候选人提交的 ${languageLabel[payload.language]} 代码：\n\`\`\`\n${payload.code}\n\`\`\`\n测试结果：${payload.lastRun.results.filter((r) => r.passed).length}/${payload.lastRun.results.length} 通过${payload.lastRun.allPassed ? "（全部通过）" : ""}`
        : `候选人提交的 ${languageLabel[payload.language]} 代码（未运行测试）：\n\`\`\`\n${payload.code}\n\`\`\``;
      const updated: TopicRecord = {
        ...currentTopic,
        messages: [...currentTopic.messages, { role: "candidate", content: summary }],
      };
      setCurrentTopic(updated);
      setAlgorithmQuestion(null);
      void requestNextTurn(setup, closedTopics, updated);
    } finally {
      setAlgorithmSubmitting(false);
    }
  }

  async function generateReport(
    s: { resumeText: string; targetRole: string },
    history: TopicRecord[],
    seq?: number
  ) {
    const mySeq = seq ?? ++reqSeq.current;
    pendingReportHistory.current = history;
    setPhase("generating_report");
    setError(null);
    try {
      const res = await fetch("/api/exam/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText: s.resumeText, targetRole: s.targetRole, history }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成报告失败");
      if (reqSeq.current !== mySeq) return;
      setReport(data);
      setPhase("ended");
    } catch (err) {
      if (reqSeq.current !== mySeq) return;
      setError(err instanceof Error ? err.message : "生成报告失败");
      // 生成失败时保留已完成的题目内容，停在可重试状态，不进入无法恢复的 "ended"
      setPhase("report_failed");
    }
  }

  function retryGenerateReport() {
    if (!setup || !pendingReportHistory.current) return;
    void generateReport(setup, pendingReportHistory.current);
  }

  function submitAnswer() {
    if (!setup || !currentTopic || !draft.trim()) return;
    const updated: TopicRecord = {
      ...currentTopic,
      messages: [...currentTopic.messages, { role: "candidate", content: draft.trim() }],
    };
    setCurrentTopic(updated);
    setDraft("");
    void requestNextTurn(setup, closedTopics, updated);
  }

  function exitToHome() {
    if (window.confirm("确定要结束本次考试并返回首页吗？当前进度和报告都不会被保存。")) {
      router.push("/");
    }
  }

  function skipTopic() {
    if (!setup || !currentTopic) return;
    // 跳过本题：直接把当前主题标记为"候选人选择跳过"并归档，不经过面试官的 follow_up/next_topic 决策，
    // 保证点击后一定会推进到下一题（或结束面试），不会被 AI 判定为继续追问同一题。
    const updated: TopicRecord = {
      ...currentTopic,
      messages: [...currentTopic.messages, { role: "candidate", content: "（候选人选择跳过本题）" }],
    };
    const newClosed = [...closedTopics, updated];
    setClosedTopics(newClosed);
    setCurrentTopic(null);
    setAlgorithmQuestion(null);
    setDraft("");
    void requestNextTurn(setup, newClosed, null);
  }

  function finishEarly() {
    if (!setup) return;
    const hasAnyTopic = closedTopics.length > 0 || !!currentTopic;
    if (!hasAnyTopic) return;
    if (!window.confirm("确定要提前结束面试吗？将基于目前已完成的内容生成评估报告。")) {
      return;
    }
    // 递增序号，使仍在进行中的 requestNextTurn（若存在）后续 resolve 时被判定为过期而忽略，
    // 避免其 setState 覆盖掉即将进入的报告生成流程。
    const mySeq = ++reqSeq.current;
    const finalHistory = currentTopic ? [...closedTopics, currentTopic] : closedTopics;
    setClosedTopics(finalHistory);
    setCurrentTopic(null);
    setAlgorithmQuestion(null);
    setStreamingMessage("");
    void generateReport(setup, finalHistory, mySeq);
  }

  if (!setup) return null;

  if (phase === "ended" && report) {
    return (
      <div className="page">
        <h1 className="title">面试评估报告</h1>
        <p className="subtitle">求职方向：{setup.targetRole}</p>

        <div className="card" style={{ display: "flex", gap: 20, alignItems: "center" }}>
          <div className="score-badge">{report.overallScore}</div>
          <p style={{ margin: 0, flex: 1 }}>{report.summary}</p>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>分维度评价</h3>
          {report.dimensions.map((d, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div className="dimension-row">
                <span className="name">{d.name}</span>
                <span>{d.score} 分</span>
              </div>
              <p style={{ margin: 0, color: "var(--text-dim)", fontSize: 13 }}>{d.comment}</p>
            </div>
          ))}
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>逐题点评</h3>
          {report.topicReviews.map((t, i) => (
            <div key={i} style={{ marginBottom: 14 }}>
              <p style={{ margin: "0 0 4px", fontWeight: 600 }}>
                主题 {t.topicIndex + 1}：{t.question}
              </p>
              <p style={{ margin: 0, color: "var(--text-dim)", fontSize: 13 }}>{t.comment}</p>
            </div>
          ))}
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>改进建议</h3>
          <ul>
            {report.improvementSuggestions.map((s, i) => (
              <li key={i} style={{ marginBottom: 6 }}>
                {s}
              </li>
            ))}
          </ul>
        </div>

        <button onClick={() => router.push("/")}>返回首页，重新开始</button>
      </div>
    );
  }

  const allTopics = currentTopic ? [...closedTopics, currentTopic] : closedTopics;

  const canFinishEarly =
    (phase === "waiting_user" || phase === "waiting_ai") && (closedTopics.length > 0 || !!currentTopic);

  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <h1 className="title">考试模式</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {canFinishEarly && (
            <button className="secondary" onClick={finishEarly}>
              提前结束，生成报告
            </button>
          )}
          <button className="secondary" onClick={exitToHome}>
            结束面试，返回首页
          </button>
        </div>
      </div>
      <p className="subtitle">求职方向：{setup.targetRole}</p>

      {allTopics.map((topic, idx) => (
        <div className="card" key={idx}>
          <div className="topic-divider">主题 {idx + 1}</div>
          {topic.messages.map((m, mi) => (
            <div key={mi} className={`chat-bubble ${m.role === "interviewer" ? "interviewer" : "candidate"}`}>
              <span className="role-tag">{m.role === "interviewer" ? "面试官" : "我"}</span>
              {m.content}
            </div>
          ))}
        </div>
      ))}

      {phase === "waiting_ai" && (
        <div className="card">
          {streamingMessage ? (
            <div className="chat-bubble interviewer">
              <span className="role-tag">面试官</span>
              {streamingMessage}
              <span className="loading-dots" />
            </div>
          ) : (
            <span className="loading-dots">面试官正在思考</span>
          )}
        </div>
      )}
      {phase === "generating_report" && <div className="card loading-dots">面试结束，正在生成评估报告</div>}

      {phase === "report_failed" && (
        <div className="card">
          <p className="error-text">{error || "评估报告生成失败"}，已完成的题目内容已保留，可以重试。</p>
          <button onClick={retryGenerateReport}>重新生成报告</button>
        </div>
      )}

      {phase === "waiting_user" && currentTopic?.isAlgorithm && algorithmQuestion && (
        <div className="card">
          <AlgorithmPanel
            question={algorithmQuestion}
            submitLabel="提交并继续面试"
            submitting={algorithmSubmitting}
            onSubmit={submitAlgorithmAnswer}
          />
          <div style={{ marginTop: 8 }}>
            <button className="secondary" onClick={skipTopic} disabled={algorithmSubmitting}>
              跳过本题
            </button>
          </div>
        </div>
      )}

      {phase === "waiting_user" && !(currentTopic?.isAlgorithm && algorithmQuestion) && (
        <div className="card">
          <textarea
            placeholder="在此输入你的回答..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={submitAnswer} disabled={!draft.trim()}>
              提交回答
            </button>
            <button className="secondary" onClick={skipTopic}>
              跳过本题
            </button>
          </div>
        </div>
      )}

      {error && phase !== "report_failed" && <p className="error-text">{error}</p>}
    </div>
  );
}