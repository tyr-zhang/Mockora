import { Agent, run } from "@openai/agents";
import { z } from "zod";
import { configureOpenAI } from "@/lib/openaiClient";
import { env } from "@/lib/env";
import { runAlgorithmSubmission } from "@/lib/codeRunner";
import { pickBankQuestion } from "@/lib/bankLoader";
import type { InterviewReport, StoredAlgorithmQuestion, TopicRecord } from "@/types/interview";

/** 统一的模型参数：推理强度由 OPENAI_REASONING_EFFORT 配置，避免默认 high 导致响应过慢 */
const modelSettings = {
  reasoning: { effort: env.reasoningEffort as "low" | "medium" | "high" | "none" },
};

function transcriptToText(
  resumeText: string,
  targetRole: string,
  jobRequirements: string | undefined,
  history: TopicRecord[]
) {
  const historyText = history
    .map((topic) => {
      const lines = topic.messages
        .map((m) => `[${m.role === "interviewer" ? "面试官" : "候选人"}] ${m.content}`)
        .join("\n");
      const label = topic.isAlgorithm ? `主题 ${topic.topicIndex + 1}（算法编程题）` : `主题 ${topic.topicIndex + 1}`;
      return `--- ${label} ---\n${lines}`;
    })
    .join("\n\n");

  return `【候选人简历】\n${resumeText}\n\n【目标岗位/方向】\n${targetRole}\n\n${jobRequirements ? `【岗位要求】\n${jobRequirements}\n\n` : ""}【已完成的面试记录】\n${
    historyText || "（暂无，这是第一个问题）"
  }`;
}

/**
 * 以纯文本形式流式运行一个 Agent，边生成边把文本片段吐给 onDelta。
 * 用结构化 outputType（json_schema）会导致客户端在收到完整 JSON 前什么都看不到，
 * 因此所有需要流式展示给用户的内容都用纯文本 Agent + toTextStream()。
 */
async function runTextStream(agent: Agent, input: string, onDelta: (chunk: string) => void) {
  configureOpenAI();
  const result = await run(agent, input, { stream: true });
  const stream = result.toTextStream();
  let full = "";
  for await (const chunk of stream) {
    full += chunk;
    onDelta(chunk);
  }
  await result.completed;
  return full.trim();
}

/* ---------------- 学习模式：出题 Agent（纯文本，分题目/答案两次流式调用） ---------------- */

const learningQuestionAgent = Agent.create({
  name: "LearningModeQuestioner",
  model: env.openaiModel,
  modelSettings,
  instructions: `你是一名资深技术面试官，正在为候选人准备"学习模式"的模拟面试训练。
规则：
1. 根据候选人的简历内容、目标求职方向和岗位要求（若提供，通常来自招聘 JD），结合已经问过的题目记录，生成下一道有针对性的面试题目（避免和历史题目重复或过于相似）。出题应优先覆盖岗位要求中强调的能力项。
2. 题目难度应循序渐进，并尽量覆盖候选人简历中提到的不同技能点/项目经历。
3. 只输出题目本身，不要输出参考答案，不要输出"题目："之类的前缀，不要输出其他解释性文字。`,
});

const learningAnswerAgent = Agent.create({
  name: "LearningModeAnswerer",
  model: env.openaiModel,
  modelSettings,
  instructions: `你是一名资深技术面试官，需要为刚出的一道面试题撰写详尽、准确的参考答案/要点讲解，帮助候选人学习。
只输出参考答案正文，不要重复题目，不要输出"参考答案："之类的前缀。`,
});

export async function streamLearningQuestion(
  resumeText: string,
  targetRole: string,
  jobRequirements: string | undefined,
  history: TopicRecord[],
  onQuestionDelta: (chunk: string) => void,
  onAnswerDelta: (chunk: string) => void
) {
  const baseInput = transcriptToText(resumeText, targetRole, jobRequirements, history);

  const question = await runTextStream(
    learningQuestionAgent,
    baseInput + "\n\n请生成下一道学习模式的面试题目。",
    onQuestionDelta
  );
  if (!question) {
    throw new Error("模型未能生成题目内容，请重试");
  }

  const answer = await runTextStream(
    learningAnswerAgent,
    baseInput + `\n\n【本题题目】${question}\n\n请给出这道题的参考答案。`,
    onAnswerDelta
  );
  if (!answer) {
    throw new Error("模型未能生成参考答案，请重试");
  }

  return { question, answer };
}

/* ---------------- 学习模式：追问 Agent ---------------- */

const learningFollowUpAgent = Agent.create({
  name: "LearningModeFollowUpExplainer",
  model: env.openaiModel,
  modelSettings,
  instructions: `你是一名资深技术面试官，正在"学习模式"中针对候选人对某道题目参考答案的追问进行解答。
请基于原题目、参考答案和候选人的追问，给出清晰、有针对性的补充讲解。语气耐心、有帮助。`,
});

export async function streamLearningFollowUp(
  question: string,
  answer: string,
  followUpQuestion: string,
  onDelta: (chunk: string) => void
) {
  const input = `【原题目】${question}\n\n【参考答案】${answer}\n\n【候选人追问】${followUpQuestion}\n\n请解答候选人的追问。`;
  return runTextStream(learningFollowUpAgent, input, onDelta);
}

/* ---------------- 参考答案按需生成（考试模式作弊指令 whosyourdaddy） ---------------- */

/**
 * 考试模式的题目由面试官 Agent 现场生成，没有预存参考答案；
 * 作弊指令触发时按需生成一份。答案只流式展示给候选人本地，
 * 不写入面试记录（history），因此不影响面试官的追问决策与最终评估报告。
 */
export async function streamReferenceAnswer(
  resumeText: string,
  targetRole: string,
  jobRequirements: string | undefined,
  question: string,
  onDelta: (chunk: string) => void
) {
  const input =
    `【候选人简历】\n${resumeText}\n\n【目标岗位/方向】\n${targetRole}\n\n${jobRequirements ? `【岗位要求】\n${jobRequirements}\n\n` : ""}【本题题目】${question}\n\n请给出这道题的参考答案。`;
  return runTextStream(learningAnswerAgent, input, onDelta);
}

/* ---------------- 简历清洗 Agent：剔除网页/PDF 抽取文本中的模板噪音 ---------------- */

/**
 * 500d.me 等在线简历页面的 HTML 抽取结果中往往一半以上是模板噪音（导航、按钮、
 * 广告、推荐模板等），全量塞进后续每轮面试的 prompt 既浪费 token 也干扰出题质量。
 * 这里用一次模型调用把原始文本清洗成结构化的干净简历；失败时由调用方回退原始文本。
 */
const resumeCleanerAgent = Agent.create({
  name: "ResumeCleaner",
  model: env.openaiModel,
  modelSettings,
  instructions: [
    "你是一名简历解析助手。输入是从网页或 PDF 中抽取的原始文本，其中往往混杂大量模板噪音（导航、按钮文字、广告、推荐模板等）。",
    "请从中提取真正的简历内容，输出一份干净的纯文本简历，按如下结构组织：",
    "【基本信息】【求职意向】【技能特长】【工作经历】【项目经历】【教育背景】",
    "规则：",
    "1. 只保留与候选人本人简历相关的事实信息，删除所有模板、导航、广告、交互提示文字。",
    "2. 保留全部事实与量化数据（时间、公司、职责、技术栈、业务结果），不要编造、改写或翻译事实。",
    "3. 尽量紧凑，合并重复内容。",
    "4. 如果输入里根本找不到简历内容，只输出 NO_RESUME_FOUND。",
    "只输出清洗后的简历正文，不要任何解释或前后缀。",
  ].join("\n"),
});

export async function cleanResumeText(rawText: string): Promise<string> {
  configureOpenAI();
  const result = await run(resumeCleanerAgent, "【待清洗的原始文本】\n" + rawText);
  const cleaned = result.finalOutput!.trim();
  if (!cleaned || cleaned === "NO_RESUME_FOUND") {
    throw new Error("未能从输入中识别出有效的简历内容");
  }
  return cleaned;
}

/* ---------------- 考试模式：面试官 Agent（先快速决策，再流式生成要说的话） ---------------- */

const MIN_TOPICS = 3;
const MAX_TOPICS = 8;

const ExamDecisionSchema = z.object({
  action: z
    .enum(["follow_up", "next_topic", "end_interview"])
    .describe(
      "follow_up=针对候选人刚才的回答继续追问；next_topic=进入下一个新主题的问题；end_interview=结束整场面试（已达到足够的主题数量判断依据）"
    ),
});

const examDecisionAgent = Agent.create({
  name: "ExamModeDecider",
  model: env.openaiModel,
  modelSettings,
  outputType: ExamDecisionSchema,
  instructions: `你是一名资深技术面试官，正在主持一场"考试模式"的模拟面试。
根据候选人的简历、目标岗位方向、岗位要求（若提供），以及已经进行的问答记录（包含若干"主题"，每个主题下可能有多轮追问），只需要决定下一步动作：
- follow_up：如果候选人刚才的回答不够完整/有疑点/值得深挖，针对该回答继续追问（同一主题内）。
- next_topic：如果当前主题已经问得足够清楚，提出一个新的主题方向的问题。
- end_interview：如果已完成的主题数量达到 ${MIN_TOPICS} 个及以上，且你认为已经充分评估候选人能力，可以结束面试。已完成的主题数量达到 ${MAX_TOPICS} 个时必须结束面试。
主题数量少于 ${MIN_TOPICS} 个时，不允许选择 end_interview。只输出决策，不要输出任何题目内容。`,
});

const examMessageAgent = Agent.create({
  name: "ExamModeMessenger",
  model: env.openaiModel,
  modelSettings,
  instructions: `你是一名资深技术面试官，正在主持一场"考试模式"的模拟面试，风格严谨、专业，像真实面试官一样。
全程不要对候选人的回答做出评分或好坏评价，保持中立、专业的提问语气。

根据给定的【下一步动作】生成你接下来要对候选人说的话：
- follow_up：针对候选人刚才的回答继续追问，可以先用一两句话呼应候选人上一轮的回答，但不要评价对错。
- next_topic：提出一个新的主题方向的问题，优先考察岗位要求（若提供）中尚未覆盖的关键能力，其次覆盖简历中不同的技能点/项目经历，循序渐进，避免重复。
- end_interview：写一句简短的面试结束语（如感谢候选人参加面试），不要透露任何评分信息。

只输出这段话本身，不要输出"面试官："之类的前缀，不要输出其他解释性文字。`,
});

export interface ExamTurnResult {
  action: "follow_up" | "next_topic" | "end_interview";
  message: string;
}

export async function streamNextExamTurn(
  resumeText: string,
  targetRole: string,
  jobRequirements: string | undefined,
  history: TopicRecord[],
  onMessageDelta: (chunk: string) => void
): Promise<ExamTurnResult> {
  configureOpenAI();
  const completedTopics = history.length;
  const baseInput =
    transcriptToText(resumeText, targetRole, jobRequirements, history) +
    `\n\n【当前已完成的主题数量】${completedTopics}`;

  const decisionResult = await run(examDecisionAgent, baseInput + "\n请决定下一步动作。");
  const action = decisionResult.finalOutput!.action;

  const message = await runTextStream(
    examMessageAgent,
    baseInput + `\n\n【下一步动作】${action}\n请生成你接下来要说的话。`,
    onMessageDelta
  );

  return { action, message };
}


/* ---------------- 技术类面试判定 + 算法题 Agent ---------------- */

const TechnicalCheckSchema = z.object({
  isTechnical: z
    .boolean()
    .describe("候选人目标岗位是否为需要编写代码/算法能力的技术类岗位（如开发、算法、测试开发等）"),
});

const technicalCheckAgent = Agent.create({
  name: "TechnicalRoleClassifier",
  model: env.openaiModel,
  modelSettings,
  outputType: TechnicalCheckSchema,
  instructions: "根据候选人的简历内容和目标求职方向，判断该岗位是否属于技术类岗位（需要具备编程/算法能力，例如前端、后端、算法工程师、测试开发、数据开发等）。产品经理、运营、销售、HR、设计等非编码岗位应判定为 false。",
});

export async function isTechnicalInterview(
  resumeText: string,
  targetRole: string,
  jobRequirements: string | undefined
): Promise<boolean> {
  configureOpenAI();
  const input =
    `【候选人简历】\n${resumeText}\n\n【目标岗位/方向】\n${targetRole}\n\n${
      jobRequirements ? `【岗位要求】\n${jobRequirements}\n\n` : ""
    }请判断该岗位是否为技术类岗位。`;
  const result = await run(technicalCheckAgent, input);
  return result.finalOutput!.isTechnical;
}

/* ---------------- 算法题：本地题库选题 + 试跑参考实现计算期望输出 ---------------- */

/**
 * 从内置题库抽题并构建完整题目（含全部测试用例与期望输出）。
 * 此前由大模型现场出题（结构化输出 + 参考实现校验），单次经常超过 5 分钟；
 * 改为题库后本函数只有一次本地子进程试跑，耗时毫秒级。
 * 期望输出不手写，而是实际运行参考实现得到，保证用例与参考解严格一致。
 */
export async function generateAlgorithmQuestion(
  resumeText: string,
  targetRole: string,
  jobRequirements: string | undefined
): Promise<StoredAlgorithmQuestion> {
  const q = await pickBankQuestion(resumeText, targetRole, jobRequirements);

  const probe = await runAlgorithmSubmission(
    "javascript",
    q.referenceSolutionJs,
    q.functionName,
    q.testInputs.map((tc) => ({ input: tc.input, expectedOutput: null, hidden: tc.hidden }))
  );
  if (probe.runtimeError) {
    throw new Error("算法题参考实现执行失败（" + probe.runtimeError + "，题目 " + q.id + "）");
  }
  if (probe.results.some((r) => r.error)) {
    throw new Error("算法题参考实现在部分用例上报错（题目 " + q.id + "）");
  }

  return {
    title: q.title,
    description: q.description,
    functionName: q.functionName,
    paramNames: q.paramNames,
    approachExplanation: q.approachExplanation,
    testCases: q.testInputs.map((tc, i) => ({
      input: tc.input,
      expectedOutput: probe.results[i].actual,
      hidden: tc.hidden,
    })),
  };
}

/* ---------------- 考试模式：最终评估报告 Agent ---------------- */

const ReportSchema = z.object({
  overallScore: z.number().min(0).max(100),
  summary: z.string().describe("对整场面试表现的总体评价，2-4句话"),
  dimensions: z
    .array(
      z.object({
        name: z.string().describe("评价维度名称，例如：专业知识深度、逻辑表达能力、项目经验匹配度、沟通应变能力等"),
        score: z.number().min(0).max(100),
        comment: z.string(),
      })
    )
    .min(3)
    .max(6),
  topicReviews: z
    .array(
      z.object({
        topicIndex: z.number(),
        question: z.string().describe("该主题的核心问题（简述）"),
        comment: z.string().describe("候选人在该主题下回答的简要点评，包括答得好的地方和不足之处"),
      })
    ),
  improvementSuggestions: z
    .array(z.string())
    .min(3)
    .describe("具体、可执行的改进建议列表"),
});

const reportAgent = Agent.create({
  name: "InterviewReportGenerator",
  model: env.openaiReportModel,
  modelSettings,
  outputType: ReportSchema,
  instructions: `你是一名资深技术面试官和职业发展顾问，现在需要基于一场已经结束的模拟面试全程记录，生成一份专业、客观、有建设性的面试评估报告。
要求：
1. 总体评分和各维度评分需要有依据，不要无脑打高分，也不要过于严苛，要客观反映候选人在这场面试中的真实表现。
2. 各维度评价需结合候选人的实际回答内容，给出具体依据，不要空泛。
3. 逐题点评需要指出具体的优点和不足。
4. 改进建议要具体、可执行，针对候选人在这场面试中暴露出的真实短板给建议，不要给泛泛而谈的通用建议。
5. 若记录中出现标注为"算法编程题"的主题，其中会包含候选人提交的代码以及测试用例通过情况（通过/失败数量），请单独按"算法与编码能力"维度评价，重点关注代码正确性（测试用例通过率）、边界处理和代码质量，不要仅凭代码长短判断。
6. 若记录中提供了【岗位要求】，需对照其中列出的关键能力项评估匹配度，在总体评价与改进建议中明确指出哪些能力已充分考察、哪些尚未覆盖。`,
});

export async function generateInterviewReport(
  resumeText: string,
  targetRole: string,
  jobRequirements: string | undefined,
  history: TopicRecord[]
): Promise<InterviewReport> {
  configureOpenAI();
  const input =
    transcriptToText(resumeText, targetRole, jobRequirements, history) +
    "\n\n面试已结束，请基于以上完整记录生成面试评估报告。";
  const result = await run(reportAgent, input);
  return result.finalOutput!;
}
