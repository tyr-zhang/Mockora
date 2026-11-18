import { NextRequest, NextResponse } from "next/server";
import { generateAlgorithmQuestion } from "@/agents/interviewAgents";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { resumeText, targetRole } = body as { resumeText: string; targetRole: string };
    if (!resumeText || !targetRole) {
      return NextResponse.json({ error: "缺少简历内容或求职方向" }, { status: 400 });
    }
    const question = await generateAlgorithmQuestion(resumeText, targetRole);
    return NextResponse.json(question);
  } catch (err) {
    const message = err instanceof Error ? err.message : "生成算法题失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
