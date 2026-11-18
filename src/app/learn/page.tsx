"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loadSetup } from "@/lib/clientSession";
import { apiPath } from "@/lib/basePath";
import { consumeSse } from "@/lib/clientSse";
import AlgorithmPanel from "@/components/AlgorithmPanel";
import type { AlgorithmQuestion, TopicRecord } from "@/types/interview";

interface LearningItem {
  topicIndex: number;
  kind: "qa" | "algorithm";
  question: string;
  answer: string;
  questionStreaming: boolean;
  answerStreaming: boolean;
  revealed: boolean;
  collapsed: boolean;
  followUps: { question: string; reply: string }[];
  algorithm?: AlgorithmQuestion;
}

export default function LearnPage() {
  const router = useRouter();
  const [setup, setSetup] = useState<{ resumeText: string; targetRole: string } | null>(null);
  const [items, setItems] = useState<LearningItem[]>([]);
  const [loadingNext, setLoadingNext] = useState(false);
  const [followUpDraft, setFollowUpDraft] = useState("");
  const [followUpReply, setFollowUpReply] = useState("");
  const [followUpStreaming, setFollowUpStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isTechnical, setIsTechnical] = useState(false);
  const [algorithmUsed, setAlgorithmUsed] = useState(false);
  const bootstrapped = useRef(false);

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
      void fetchNextQuestion(setup, []);
      fetch(apiPath("/api/interview/classify-technical"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText: setup.resumeText, targetRole: setup.targetRole }),
      })
        .then((res) => res.json())
        .then((data) => setIsTechnical(Boolean(data.isTechnical)))
        .catch(() => setIsTechnical(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup]);

  function toHistory(list: LearningItem[]): TopicRecord[] {
    return list
      .filter((i) => i.revealed)
      .map((i) =>
        i.kind === "algorithm"
          ? {
              topicIndex: i.topicIndex,
              isAlgorithm: true,
              messages: [
                { role: "interviewer" as const, content: `[算法编程题] ${i.algorithm?.title ?? ""}` },
              ],
            }
          : {
              topicIndex: i.topicIndex,
              messages: [
                { role: "interviewer" as const, content: i.question },
                { role: "interviewer" as const, content: `参考答案: ${i.answer}` },
              ],
            }
      );
  }

  function updateLast(updater: (item: LearningItem) => LearningItem) {
    setItems((prev) => prev.map((it, i) => (i === prev.length - 1 ? updater(it) : it)));
  }

  function exitToHome() {
    if (window.confirm("确定要结束本次学习并返回首页吗？当前进度不会被保存。")) {
      router.push("/");
    }
  }

  async function fetchNextQuestion(
    s: { resumeText: string; targetRole: string },
    currentItems: LearningItem[]
  ) {
    setLoadingNext(true);
    setError(null);

    // 开始下一题时，把之前所有题目的答案折叠起来，保持界面聚焦在新题目上
    setItems((prev) => prev.map((it) => ({ ...it, collapsed: true })));

    const topicIndex = currentItems.length;
    setItems((prev) => [
      ...prev,
      {
        topicIndex,
        kind: "qa",
        question: "",
        answer: "",
        questionStreaming: true,
        answerStreaming: false,
        revealed: false,
        collapsed: false,
        followUps: [],
      },
    ]);

    try {
      const res = await fetch(apiPath("/api/learn/question"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resumeText: s.resumeText,
          targetRole: s.targetRole,
          history: toHistory(currentItems),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "生成题目失败");
      }

      await consumeSse(res, (event) => {
        if (event.type === "question_delta") {
          updateLast((it) => ({ ...it, question: it.question + (event.chunk as string) }));
        } else if (event.type === "answer_delta") {
          updateLast((it) => ({
            ...it,
            questionStreaming: false,
            answerStreaming: true,
            answer: it.answer + (event.chunk as string),
          }));
        } else if (event.type === "done") {
          updateLast((it) => ({
            ...it,
            question: (event.question as string) ?? it.question,
            answer: (event.answer as string) ?? it.answer,
            questionStreaming: false,
            answerStreaming: false,
          }));
        } else if (event.type === "error") {
          throw new Error(event.error as string);
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成题目失败");
      setItems((prev) => prev.slice(0, -1));
    } finally {
      setLoadingNext(false);
    }
  }


  async function fetchAlgorithmQuestion(s: { resumeText: string; targetRole: string }, currentItems: LearningItem[]) {
    setLoadingNext(true);
    setError(null);
    setAlgorithmUsed(true);

    setItems((prev) => prev.map((it) => ({ ...it, collapsed: true })));

    const topicIndex = currentItems.length;
    setItems((prev) => [
      ...prev,
      {
        topicIndex,
        kind: "algorithm",
        question: "",
        answer: "",
        questionStreaming: true,
        answerStreaming: false,
        revealed: false,
        collapsed: false,
        followUps: [],
      },
    ]);

    try {
      const res = await fetch(apiPath("/api/algorithm/generate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeText: s.resumeText, targetRole: s.targetRole }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成算法题失败");
      updateLast((it) => ({ ...it, algorithm: data, questionStreaming: false, revealed: true }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成算法题失败");
      setItems((prev) => prev.slice(0, -1));
      setAlgorithmUsed(false);
    } finally {
      setLoadingNext(false);
    }
  }

  function goToNextQuestion() {
    if (!setup) return;
    if (isTechnical && !algorithmUsed && items.length > 0) {
      void fetchAlgorithmQuestion(setup, items);
    } else {
      void fetchNextQuestion(setup, items);
    }
  }

  function reveal(index: number) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, revealed: true } : it)));
  }

  function toggleCollapsed(index: number) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, collapsed: !it.collapsed } : it)));
  }

  async function submitFollowUp(index: number) {
    if (!followUpDraft.trim()) return;
    const item = items[index];
    const question = followUpDraft;
    setFollowUpStreaming(true);
    setFollowUpReply("");
    setError(null);
    try {
      const res = await fetch(apiPath("/api/learn/follow-up"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: item.question,
          answer: item.answer,
          followUpQuestion: question,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "追问失败");
      }

      let reply = "";
      await consumeSse(res, (event) => {
        if (event.type === "reply_delta") {
          reply += event.chunk as string;
          setFollowUpReply(reply);
        } else if (event.type === "done") {
          reply = (event.reply as string) ?? reply;
        } else if (event.type === "error") {
          throw new Error(event.error as string);
        }
      });

      setItems((prev) =>
        prev.map((it, i) =>
          i === index ? { ...it, followUps: [...it.followUps, { question, reply }] } : it
        )
      );
      setFollowUpDraft("");
      setFollowUpReply("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "追问失败");
    } finally {
      setFollowUpStreaming(false);
    }
  }

  if (!setup) return null;

  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 className="title">学习模式</h1>
        <button className="secondary" onClick={exitToHome}>
          结束学习，返回首页
        </button>
      </div>
      <p className="subtitle">求职方向：{setup.targetRole}</p>

      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        const showBody = !item.collapsed;

        if (item.kind === "algorithm") {
          const ready = Boolean(item.algorithm) && !item.questionStreaming;
          return (
            <div className="card" key={idx}>
              <div
                className="topic-divider"
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                onClick={() => ready && toggleCollapsed(idx)}
              >
                <span>主题 {idx + 1}（算法编程题）</span>
                {ready && <span>{item.collapsed ? "展开 ▾" : "折叠 ▴"}</span>}
              </div>

              {!ready ? (
                <div className="loading-dots">正在生成算法题</div>
              ) : (
                showBody && (
                  <>
                    <AlgorithmPanel question={item.algorithm!} allowReveal />
                    {isLast && (
                      <div style={{ marginTop: 12 }}>
                        <button onClick={goToNextQuestion} disabled={loadingNext}>
                          {loadingNext ? "生成下一题..." : "下一题"}
                        </button>
                      </div>
                    )}
                  </>
                )
              )}
            </div>
          );
        }

        return (
          <div className="card" key={idx}>
            <div
              className="topic-divider"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
              onClick={() => item.question && !item.questionStreaming && toggleCollapsed(idx)}
            >
              <span>主题 {idx + 1}</span>
              {item.question && !item.questionStreaming && (
                <span>{item.collapsed ? "展开 ▾" : "折叠 ▴"}</span>
              )}
            </div>

            <div className="chat-bubble interviewer">
              <span className="role-tag">面试官</span>
              {item.question}
              {item.questionStreaming && <span className="loading-dots" />}
            </div>

            {showBody && (
              <>
                {!item.revealed ? (
                  <button onClick={() => reveal(idx)} disabled={!item.question || item.questionStreaming}>
                    查看参考答案
                  </button>
                ) : (
                  <>
                    <div className="chat-bubble answer">
                      <span className="role-tag">参考答案</span>
                      {item.answer}
                      {item.answerStreaming && <span className="loading-dots" />}
                    </div>

                    {item.followUps.map((f, fi) => (
                      <div key={fi}>
                        <div className="chat-bubble candidate">
                          <span className="role-tag">我的追问</span>
                          {f.question}
                        </div>
                        <div className="chat-bubble answer">
                          <span className="role-tag">解答</span>
                          {f.reply}
                        </div>
                      </div>
                    ))}

                    {isLast && followUpStreaming && (
                      <div className="chat-bubble answer">
                        <span className="role-tag">解答</span>
                        {followUpReply}
                        <span className="loading-dots" />
                      </div>
                    )}

                    {isLast && (
                      <div style={{ marginTop: 12 }}>
                        <textarea
                          placeholder="对这道题的答案有疑问？在这里追问..."
                          value={followUpDraft}
                          onChange={(e) => setFollowUpDraft(e.target.value)}
                        />
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            className="secondary"
                            onClick={() => submitFollowUp(idx)}
                            disabled={followUpStreaming || !followUpDraft.trim()}
                          >
                            {followUpStreaming ? "追问中..." : "提交追问"}
                          </button>
                          <button onClick={goToNextQuestion} disabled={loadingNext || item.answerStreaming}>
                            {loadingNext ? "生成下一题..." : "下一题"}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        );
      })}

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
