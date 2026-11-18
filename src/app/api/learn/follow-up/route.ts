import { NextRequest } from "next/server";
import { streamLearningFollowUp } from "@/agents/interviewAgents";
import { createSseResponse } from "@/lib/sse";

export async function POST(req: NextRequest) {
  const { question, answer, followUpQuestion } = await req.json();
  if (!question || !answer || !followUpQuestion) {
    return new Response(JSON.stringify({ error: "参数不完整" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  return createSseResponse(async (emit) => {
    const reply = await streamLearningFollowUp(question, answer, followUpQuestion, (chunk) =>
      emit({ type: "reply_delta", chunk })
    );
    emit({ type: "done", reply });
  });
}
