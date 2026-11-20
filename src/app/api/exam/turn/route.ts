import { NextRequest } from "next/server";
import { streamNextExamTurn } from "@/agents/interviewAgents";
import { createSseResponse } from "@/lib/sse";
import type { TopicRecord } from "@/types/interview";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { resumeText, targetRole, jobRequirements, history } = body as {
    resumeText: string;
    targetRole: string;
    jobRequirements?: string;
    history: TopicRecord[];
  };

  if (!resumeText || !targetRole) {
    return new Response(JSON.stringify({ error: "缺少简历内容或求职方向" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  return createSseResponse(async (emit) => {
    const { action, message } = await streamNextExamTurn(
      resumeText,
      targetRole,
      jobRequirements,
      history || [],
      (chunk) => emit({ type: "message_delta", chunk })
    );
    emit({ type: "done", action, message });
  });
}
