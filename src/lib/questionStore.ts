import { randomUUID } from "crypto";
import type { AlgorithmQuestion, StoredAlgorithmQuestion } from "@/types/interview";

/**
 * 算法题的服务端内存存储。
 *
 * 背景：此前完整测试用例（含隐藏用例的输入与期望输出）会随 generate 响应下发给浏览器，
 * 判题时再由客户端回传 testCases，候选人打开开发者工具即可看到隐藏用例答案，甚至篡改判题入参。
 *
 * 现在：generate 生成题目后以随机 questionId 存入本表，只把脱敏视图（隐藏用例不含
 * input/expectedOutput）下发给客户端；run 接口凭 questionId 取回完整用例判题，
 * 判题结果中的隐藏用例同样脱敏。应用本身无服务端持久化，这里使用带 TTL 的内存 Map 即可。
 */

const TTL_MS = 6 * 60 * 60 * 1000; // 一场面试通常不超过数小时，6 小时后自动过期

interface StoreEntry {
  question: StoredAlgorithmQuestion;
  expiresAt: number;
}

/**
 * 必须挂在 globalThis 上：Next.js（无论 dev 还是生产）会把每个 API 路由打成独立 bundle，
 * 模块级变量在 generate 与 run 两个路由之间不共享，会导致 run 永远查不到题目。
 * globalThis 是整个 Node 进程共享的，可保证两个路由访问同一份存储。
 */
const globalStore = globalThis as typeof globalThis & {
  __mockoraQuestionStore?: Map<string, StoreEntry>;
};

const store = (globalStore.__mockoraQuestionStore ??= new Map<string, StoreEntry>());

function cleanup() {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (entry.expiresAt <= now) store.delete(id);
  }
}

export function saveAlgorithmQuestion(question: StoredAlgorithmQuestion): string {
  cleanup();
  const id = randomUUID();
  store.set(id, { question, expiresAt: Date.now() + TTL_MS });
  return id;
}

export function getAlgorithmQuestion(id: string): StoredAlgorithmQuestion | null {
  const entry = store.get(id);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(id);
    return null;
  }
  return entry.question;
}

/** 将完整题目转换为可下发给客户端的脱敏视图：隐藏用例仅保留 hidden 标记 */
export function toClientView(questionId: string, question: StoredAlgorithmQuestion): AlgorithmQuestion {
  return {
    questionId,
    title: question.title,
    description: question.description,
    functionName: question.functionName,
    paramNames: question.paramNames,
    approachExplanation: question.approachExplanation,
    testCases: question.testCases.map((tc) =>
      tc.hidden
        ? { hidden: true }
        : { hidden: false, input: tc.input, expectedOutput: tc.expectedOutput }
    ),
  };
}
