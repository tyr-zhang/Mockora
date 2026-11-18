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

export interface AlgorithmTestCase {
  /** 按 paramNames 顺序传入的参数值 */
  input: unknown[];
  expectedOutput: unknown;
  /** 隐藏用例：不直接展示给候选人，仅用于判定正确性 */
  hidden: boolean;
}

export interface AlgorithmQuestion {
  title: string;
  description: string;
  functionName: string;
  paramNames: string[];
  /** 学习模式查看答案时展示的参考解法思路 */
  approachExplanation: string;
  testCases: AlgorithmTestCase[];
}

export interface AlgorithmTestResult {
  passed: boolean;
  actual: unknown;
  expectedOutput: unknown;
  hidden: boolean;
  error: string | null;
}

export interface AlgorithmRunResult {
  results: AlgorithmTestResult[];
  allPassed: boolean;
  runtimeError: string | null;
}
