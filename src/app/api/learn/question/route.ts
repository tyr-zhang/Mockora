import { NextRequest } from "next/server";
import { streamLearningQuestion } from "@/agents/interviewAgents";
import { createSseResponse } from "@/lib/sse";
import type { TopicRecord } from "@/types/interview";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { resumeText, targetRole, history } = body as {
    resumeText: string;
    targetRole: string;
    history: TopicRecord[];
  };

  if (!resumeText || !targetRole) {
    return new Response(JSON.stringify({ error: "缺少简历内容或求职方向" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  return createSseResponse(async (emit) => {
    const { question, answer } = await streamLearningQuestion(
      resumeText,
      targetRole,
      history || [],
      (chunk) => emit({ type: "question_delta", chunk }),
      (chunk) => emit({ type: "answer_delta", chunk })
    );
    emit({ type: "done", question, answer });
  });
}
