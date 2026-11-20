import { NextRequest, NextResponse } from "next/server";
import { isTechnicalInterview } from "@/agents/interviewAgents";

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
    const isTechnical = await isTechnicalInterview(resumeText, targetRole, jobRequirements);
    return NextResponse.json({ isTechnical });
  } catch (err) {
    const message = err instanceof Error ? err.message : "判断面试类型失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
