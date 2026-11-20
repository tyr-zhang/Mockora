import { NextRequest } from "next/server";
import { streamReferenceAnswer } from "@/agents/interviewAgents";
import { createSseResponse } from "@/lib/sse";

/**
 * 考试模式作弊指令的应答接口：对当前题目按需生成参考答案（SSE 流式）。
 * 该答案仅展示在候选人本地，调用方不应将其写入面试记录。
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { resumeText, targetRole, jobRequirements, question } = body as {
    resumeText: string;
    targetRole: string;
    jobRequirements?: string;
    question: string;
  };

  if (!resumeText || !targetRole || !question) {
    return new Response(JSON.stringify({ error: "缺少简历内容、求职方向或题目" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  return createSseResponse(async (emit) => {
    const answer = await streamReferenceAnswer(resumeText, targetRole, jobRequirements, question, (chunk) =>
      emit({ type: "answer_delta", chunk })
    );
    emit({ type: "done", answer });
  });
}
