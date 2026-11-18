import { NextRequest, NextResponse } from "next/server";
import { parseResumePdf, fetchResumeFromUrl } from "@/lib/resume";

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
      return NextResponse.json({ resumeText: text });
    }

    const body = await req.json();
    const url = body?.url;
    if (typeof url !== "string" || !url.trim()) {
      return NextResponse.json({ error: "请提供简历链接" }, { status: 400 });
    }
    const text = await fetchResumeFromUrl(url.trim());
    return NextResponse.json({ resumeText: text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "简历解析失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}