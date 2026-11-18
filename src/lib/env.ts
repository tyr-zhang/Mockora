/**
 * 集中读取和校验环境变量配置。
 * 所有 OpenAI 相关配置（模型、API Key、Base URL）均从 .env 读取，不写死在代码中。
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`缺少必要的环境变量: ${name}，请检查 .env 文件（可参考 .env.example）`);
  }
  return value;
}

/** 推理强度。部分模型（如混元 hy4）默认 high，会显著拖慢响应，可通过配置调低。 */
const reasoningEffort = process.env.OPENAI_REASONING_EFFORT?.trim() || "medium";

export const env = {
  get openaiApiKey() {
    return required("OPENAI_API_KEY", process.env.OPENAI_API_KEY);
  },
  openaiBaseUrl: process.env.OPENAI_BASE_URL || undefined,
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  openaiReportModel: process.env.OPENAI_REPORT_MODEL || process.env.OPENAI_MODEL || "gpt-4o",
  reasoningEffort,
};
