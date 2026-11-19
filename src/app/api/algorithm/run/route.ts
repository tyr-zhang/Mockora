import { NextRequest, NextResponse } from "next/server";
import { runAlgorithmSubmission } from "@/lib/codeRunner";
import { getAlgorithmQuestion } from "@/lib/questionStore";
import type { AlgoLanguage, AlgorithmTestResult } from "@/types/interview";

const SUPPORTED_LANGUAGES: AlgoLanguage[] = ["javascript", "python", "java"];
const MAX_CODE_LENGTH = 20000;

/**
 * 隐藏用例的判题结果不回传 actual/expectedOutput，防止泄露答案。
 * 此前本接口直接接收客户端回传的 testCases 与 functionName，候选人可篡改判题入参作弊；
 * 现在凭 questionId 从服务端存储取回完整用例与函数名。
 */
function maskHiddenCases(results: AlgorithmTestResult[]): AlgorithmTestResult[] {
  return results.map((r) =>
    r.hidden ? { passed: r.passed, hidden: true, error: r.error } : r
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { questionId, language, code } = body as {
      questionId?: string;
      language?: AlgoLanguage;
      code?: string;
    };

    if (!questionId) {
      return NextResponse.json({ error: "缺少题目标识" }, { status: 400 });
    }
    const question = getAlgorithmQuestion(questionId);
    if (!question) {
      return NextResponse.json({ error: "题目不存在或已过期，请重新生成" }, { status: 404 });
    }
    if (!language || !SUPPORTED_LANGUAGES.includes(language)) {
      return NextResponse.json({ error: "不支持的语言" }, { status: 400 });
    }
    if (!code || !code.trim()) {
      return NextResponse.json({ error: "请先编写代码" }, { status: 400 });
    }
    if (code.length > MAX_CODE_LENGTH) {
      return NextResponse.json({ error: "代码长度超出限制" }, { status: 400 });
    }

    const result = await runAlgorithmSubmission(
      language,
      code,
      question.functionName,
      question.testCases
    );
    return NextResponse.json({ ...result, results: maskHiddenCases(result.results) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "代码执行失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
