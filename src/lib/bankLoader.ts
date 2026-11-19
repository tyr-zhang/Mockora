import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/**
 * 外置 JSON 题库加载器。
 *
 * 题目存放在项目根目录 questions/*.json，一题一文件，文件名即题目 id。
 * 相比写死在 TS 代码里，外置后更新题库只需增删 JSON 文件：
 * - 开发环境：热生效（每次生成题目时重新扫描目录）；
 * - Docker 部署：将宿主机 questions 目录挂载到容器的 /app/questions（见 README）即可免重建更新。
 *
 * 安全边界：referenceSolutionLines 会在服务端作为 JavaScript 执行（用于计算期望输出），
 * 因此 questions 目录的写权限等同于服务器代码执行权限，只应由可信人员维护。
 */

export type BankDifficulty = "easy" | "medium";

export interface BankQuestion {
  id: string;
  difficulty: BankDifficulty;
  title: string;
  description: string;
  functionName: string;
  paramNames: string[];
  approachExplanation: string;
  referenceSolutionJs: string;
  testInputs: { input: unknown[]; hidden: boolean }[];
}

/** questions/*.json 的文件格式（descriptionLines/referenceSolutionLines 会在加载时按行拼接） */
const QuestionFileSchema = z.object({
  id: z.string().min(1),
  difficulty: z.enum(["easy", "medium"]),
  title: z.string().min(1),
  descriptionLines: z.array(z.string()).min(1),
  functionName: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  paramNames: z.array(z.string().min(1)).min(1).max(4),
  approachExplanation: z.string().min(1),
  referenceSolutionLines: z.array(z.string()).min(1),
  /** 人工核对的标准答案，仅用于 npm run bank:check 校验参考实现，运行期不使用 */
  expectedOutputs: z.array(z.unknown()).min(3),
  testInputs: z
    .array(
      z.object({
        input: z.array(z.unknown()),
        hidden: z.boolean(),
      })
    )
    .min(3),
});

function questionsDir(): string {
  // 开发环境 cwd 为项目根；standalone 部署时 cwd 为 .next/standalone 根，
  // questions 目录通过 next.config.ts 的 outputFileTracingIncludes 带进产物。
  return path.join(process.cwd(), "questions");
}

/**
 * 扫描并加载全部题目。单个文件格式非法时跳过并打告警（不让一道坏题废掉整个面试流程）；
 * 严格校验请运行 npm run bank:check。
 */
async function loadQuestionBank(): Promise<BankQuestion[]> {
  let files: string[];
  try {
    files = (await fs.readdir(questionsDir())).filter((f) => f.endsWith(".json"));
  } catch {
    console.warn("[bankLoader] 读取题库目录失败：", questionsDir());
    return [];
  }

  const bank: BankQuestion[] = [];
  for (const file of files) {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(questionsDir(), file), "utf-8"));
      const q = QuestionFileSchema.parse(raw);

      if (q.expectedOutputs.length !== q.testInputs.length) {
        throw new Error("expectedOutputs 与 testInputs 数量不一致");
      }
      if (!q.testInputs.slice(0, 2).every((tc) => !tc.hidden)) {
        throw new Error("前 2 个用例必须是可见用例（hidden=false）");
      }
      if (q.id + ".json" !== file) {
        throw new Error("文件名必须与 id 一致");
      }

      bank.push({
        id: q.id,
        difficulty: q.difficulty,
        title: q.title,
        description: q.descriptionLines.join("\n"),
        functionName: q.functionName,
        paramNames: q.paramNames,
        approachExplanation: q.approachExplanation,
        referenceSolutionJs: q.referenceSolutionLines.join("\n"),
        testInputs: q.testInputs,
      });
    } catch (err) {
      console.warn("[bankLoader] 跳过非法题库文件 " + file + "：", err instanceof Error ? err.message : err);
    }
  }
  return bank;
}

/** 最近使用过的题目 id，避免连续几场面试抽到同一道题 */
const recentIds: string[] = [];
const RECENT_WINDOW = 5;

/**
 * 从题库随机抽一道题。目标岗位/简历里出现资深/架构类信号时优先中等难度题。
 */
export async function pickBankQuestion(resumeText: string, targetRole: string): Promise<BankQuestion> {
  const bank = await loadQuestionBank();
  if (bank.length === 0) {
    throw new Error("题库为空或全部非法，请检查 questions 目录（可用 npm run bank:check 校验）");
  }

  const seniorSignal =
    /架构师|架构|资深|专家|高级|architect|senior|staff|principal/i.test(targetRole) ||
    (resumeText ? resumeText.length > 5000 : false);

  let pool = bank.filter((q) => !recentIds.includes(q.id));
  if (pool.length === 0) pool = bank;

  let candidates = pool;
  if (seniorSignal) {
    const medium = pool.filter((q) => q.difficulty === "medium");
    if (medium.length > 0) candidates = medium;
  }

  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  recentIds.push(picked.id);
  while (recentIds.length > RECENT_WINDOW) recentIds.shift();
  return picked;
}
