import { NextRequest, NextResponse } from "next/server";
import { generateInterviewReport } from "@/agents/interviewAgents";
import type { TopicRecord } from "@/types/interview";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { resumeText, targetRole, history } = body as {
      resumeText: string;
      targetRole: string;
      history: TopicRecord[];
    };
    if (!resumeText || !targetRole || !history?.length) {
      return NextResponse.json({ error: "缺少必要的面试记录数据" }, { status: 400 });
    }
    const report = await generateInterviewReport(resumeText, targetRole, history);
    return NextResponse.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : "生成面试报告失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}