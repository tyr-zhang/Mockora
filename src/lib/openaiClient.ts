import OpenAI from "openai";
import { setDefaultOpenAIClient, setTracingDisabled } from "@openai/agents";
import { env } from "./env";

let configured = false;

/**
 * 全局配置 OpenAI 客户端（支持自定义 base URL，用于中转/代理），
 * 并关闭默认的 tracing 上报（面试内容不对外上报）。
 * 只需要在进程启动时调用一次。
 */
export function configureOpenAI() {
  if (configured) return;
  const client = new OpenAI({
    apiKey: env.openaiApiKey,
    baseURL: env.openaiBaseUrl,
  });
  setDefaultOpenAIClient(client);
  setTracingDisabled(true);
  configured = true;
}
