export type InterviewMode = "learn" | "exam";

/** 一次问答（含追问）记录中的单条消息 */
export interface TurnMessage {
  role: "interviewer" | "candidate";
  content: string;
}

/** 一个"主题"下的完整问答记录（主问题 + 若干轮追问） */
export interface TopicRecord {
  topicIndex: number;
  messages: TurnMessage[];
  /** 标记该主题是否为算法编程题（用于报告生成时提示 AI 按代码题维度评价） */
  isAlgorithm?: boolean;
}

export interface InterviewSetup {
  resumeText: string;
  targetRole: string;
  /** 岗位要求/JD（可选），出题与评估会结合其关键能力项 */
  jobRequirements?: string;
}

export interface ReportDimension {
  name: string;
  score: number; // 0-100
  comment: string;
}

export interface InterviewReport {
  overallScore: number; // 0-100
  summary: string;
  dimensions: ReportDimension[];
  topicReviews: {
    topicIndex: number;
    question: string;
    comment: string;
  }[];
  improvementSuggestions: string[];
}
/* ---------------- 算法题（技术类面试专项） ---------------- */

export type AlgoLanguage = "javascript" | "python" | "java";

/** 完整测试用例（仅存在于服务端，含期望输出） */
export interface AlgorithmTestCase {
  /** 按 paramNames 顺序传入的参数值 */
  input: unknown[];
  expectedOutput: unknown;
  /** 隐藏用例：不直接展示给候选人，仅用于判定正确性 */
  hidden: boolean;
}

/** 下发给客户端的测试用例视图：隐藏用例不携带 input/expectedOutput，防止通过浏览器开发者工具作弊 */
export interface AlgorithmTestCaseView {
  hidden: boolean;
  input?: unknown[];
  expectedOutput?: unknown;
}

/** 服务端保存的完整题目（含全部测试用例与期望输出） */
export interface StoredAlgorithmQuestion {
  title: string;
  description: string;
  functionName: string;
  paramNames: string[];
  approachExplanation: string;
  testCases: AlgorithmTestCase[];
}

/** 下发给客户端的题目视图：隐藏用例已脱敏 */
export interface AlgorithmQuestion {
  /** 题目在服务端的标识，判题时凭此取回完整用例 */
  questionId: string;
  title: string;
  description: string;
  functionName: string;
  paramNames: string[];
  /** 学习模式查看答案时展示的参考解法思路 */
  approachExplanation: string;
  testCases: AlgorithmTestCaseView[];
}

export interface AlgorithmTestResult {
  passed: boolean;
  /** 隐藏用例不回传 actual/expectedOutput */
  actual?: unknown;
  expectedOutput?: unknown;
  hidden: boolean;
  error: string | null;
}

export interface AlgorithmRunResult {
  results: AlgorithmTestResult[];
  allPassed: boolean;
  runtimeError: string | null;
}
