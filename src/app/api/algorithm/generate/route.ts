import { NextRequest, NextResponse } from "next/server";
import { generateAlgorithmQuestion } from "@/agents/interviewAgents";
import { saveAlgorithmQuestion, toClientView } from "@/lib/questionStore";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { resumeText, targetRole, jobRequirements } = body as {
      resumeText: string;
      targetRole: string;
      jobRequirements?: string;
    };
    if (!resumeText || !targetRole) {
      return NextResponse.json({ error: "缺少简历内容或求职方向" }, { status: 400 });
    }
    const question = await generateAlgorithmQuestion(resumeText, targetRole, jobRequirements);
    // 完整题目只存在服务端（含隐藏用例与期望输出），客户端只拿到脱敏视图，
    // 防止通过浏览器开发者工具直接看到隐藏用例答案。
    const questionId = saveAlgorithmQuestion(question);
    return NextResponse.json(toClientView(questionId, question));
  } catch (err) {
    const message = err instanceof Error ? err.message : "生成算法题失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
