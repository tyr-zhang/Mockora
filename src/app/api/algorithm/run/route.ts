import { NextRequest, NextResponse } from "next/server";
import { runAlgorithmSubmission } from "@/lib/codeRunner";
import type { AlgoLanguage, AlgorithmTestCase } from "@/types/interview";

const SUPPORTED_LANGUAGES: AlgoLanguage[] = ["javascript", "python", "java"];
const MAX_CODE_LENGTH = 20000;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { language, code, functionName, testCases } = body as {
      language: AlgoLanguage;
      code: string;
      functionName: string;
      testCases: AlgorithmTestCase[];
    };

    if (!SUPPORTED_LANGUAGES.includes(language)) {
      return NextResponse.json({ error: "不支持的语言" }, { status: 400 });
    }
    if (!code || !code.trim()) {
      return NextResponse.json({ error: "请先编写代码" }, { status: 400 });
    }
    if (code.length > MAX_CODE_LENGTH) {
      return NextResponse.json({ error: "代码长度超出限制" }, { status: 400 });
    }
    if (!functionName || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(functionName)) {
      return NextResponse.json({ error: "函数名非法" }, { status: 400 });
    }
    if (!Array.isArray(testCases) || testCases.length === 0) {
      return NextResponse.json({ error: "缺少测试用例" }, { status: 400 });
    }

    const result = await runAlgorithmSubmission(language, code, functionName, testCases);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "代码执行失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
