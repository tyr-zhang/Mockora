import { NextRequest, NextResponse } from "next/server";
import { parseResumePdf, fetchResumeFromUrl } from "@/lib/resume";
import { cleanResumeText } from "@/agents/interviewAgents";

/**
 * 对抽取出的原始文本做一次 LLM 清洗：在线简历页面（如 500d.me）的 HTML 抽取结果里
 * 往往一半以上是模板噪音（导航、按钮、广告、推荐模板），全量进入后续每轮面试的
 * prompt 既浪费 token 也干扰出题。清洗失败时回退原始文本，保证功能可用。
 */
async function parseAndClean(text: string): Promise<string> {
  try {
    return await cleanResumeText(text);
  } catch {
    return text;
  }
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "未找到上传的文件" }, { status: 400 });
      }
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        return NextResponse.json({ error: "仅支持 PDF 文件" }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const text = await parseResumePdf(buffer);
      return NextResponse.json({ resumeText: await parseAndClean(text) });
    }

    const body = await req.json();
    const url = body?.url;
    if (typeof url !== "string" || !url.trim()) {
      return NextResponse.json({ error: "请提供简历链接" }, { status: 400 });
    }
    const text = await fetchResumeFromUrl(url.trim());
    return NextResponse.json({ resumeText: await parseAndClean(text) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "简历解析失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
