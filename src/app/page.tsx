"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveSetup } from "@/lib/clientSession";
import { apiPath } from "@/lib/basePath";
import type { InterviewMode } from "@/types/interview";

export default function HomePage() {
  const router = useRouter();
  const [mode, setMode] = useState<InterviewMode>("learn");
  const [resumeSource, setResumeSource] = useState<"file" | "url">("file");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [targetRole, setTargetRole] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    setError(null);

    if (!targetRole.trim()) {
      setError("请填写求职方向/目标岗位");
      return;
    }
    if (resumeSource === "file" && !file) {
      setError("请上传 PDF 简历文件");
      return;
    }
    if (resumeSource === "url" && !url.trim()) {
      setError("请填写简历链接");
      return;
    }

    setLoading(true);
    try {
      let res: Response;
      if (resumeSource === "file" && file) {
        const formData = new FormData();
        formData.append("file", file);
        res = await fetch(apiPath("/api/resume"), { method: "POST", body: formData });
      } else {
        res = await fetch(apiPath("/api/resume"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "简历解析失败");
      }

      saveSetup({ resumeText: data.resumeText, targetRole: targetRole.trim() });
      router.push(mode === "learn" ? "/learn" : "/exam");
    } catch (err) {
      setError(err instanceof Error ? err.message : "发生未知错误");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <h1 className="title">Mockora · AI 模拟面试</h1>
      <p className="subtitle">上传简历，选择模式，开始一场由 AI 面试官主持的模拟面试训练</p>

      <div className="card">
        <label>选择模式</label>
        <div className="mode-grid">
          <div
            className={`mode-card ${mode === "learn" ? "selected" : ""}`}
            onClick={() => setMode("learn")}
          >
            <h3>📘 学习模式</h3>
            <p>AI 依次出题，你先自行思考，再查看参考答案，可随时追问加深理解。不打分、不评估，适合刷题学习。</p>
          </div>
          <div
            className={`mode-card ${mode === "exam" ? "selected" : ""}`}
            onClick={() => setMode("exam")}
          >
            <h3>📝 考试模式</h3>
            <p>像真实面试一样作答，AI 面试官会追问细节，全程不打分，结束后生成完整评估报告与改进建议。</p>
          </div>
        </div>

        <label>求职方向 / 目标岗位</label>
        <input
          type="text"
          placeholder="例如：前端开发工程师 / 后端 Java 开发 / 产品经理"
          value={targetRole}
          onChange={(e) => setTargetRole(e.target.value)}
        />

        <label>简历来源</label>
        <div className="tabs">
          <div
            className={`tab ${resumeSource === "file" ? "active" : ""}`}
            onClick={() => setResumeSource("file")}
          >
            上传 PDF 文件
          </div>
          <div
            className={`tab ${resumeSource === "url" ? "active" : ""}`}
            onClick={() => setResumeSource("url")}
          >
            填写公开网页链接
          </div>
        </div>

        {resumeSource === "file" ? (
          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        ) : (
          <input
            type="url"
            placeholder="https://example.com/your-resume"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        )}

        {error && <p className="error-text">{error}</p>}

        <button onClick={handleStart} disabled={loading}>
          {loading ? "正在解析简历..." : "开始面试"}
        </button>
      </div>
    </div>
  );
}
