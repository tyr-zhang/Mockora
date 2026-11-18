import * as cheerio from "cheerio";
import fs from "node:fs";
import path from "node:path";

let workerConfigured = false;

/**
 * pdf-parse 底层基于 pdfjs-dist，默认会尝试加载一个独立的 worker 脚本。
 * 经 Next.js/Turbopack 打包后，worker 文件的相对/require.resolve 路径都会被打包器拦截分析导致构建失败，
 * 所以这里完全避开 require.resolve，直接基于 node_modules 的物理落盘位置拼路径（不经过模块解析算法）。
 */
function resolvePdfWorkerPath(): string {
  const candidates = [
    path.join(process.cwd(), "node_modules", "pdf-parse", "dist", "worker", "pdf.worker.mjs"),
    path.join(process.cwd(), "..", "node_modules", "pdf-parse", "dist", "worker", "pdf.worker.mjs"),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error("未能定位 pdf-parse 的 worker 文件，请确认依赖已正确安装");
  }
  return found;
}

async function ensurePdfWorkerConfigured() {
  if (workerConfigured) return;
  const { PDFParse } = await import("pdf-parse");
  const workerPath = resolvePdfWorkerPath();
  PDFParse.setWorker(`file://${workerPath}`);
  workerConfigured = true;
}

/** 从 PDF Buffer 中提取文本 */
export async function parseResumePdf(buffer: Buffer): Promise<string> {
  await ensurePdfWorkerConfigured();
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    const text = result.text.trim();
    if (!text) {
      throw new Error("未能从 PDF 中提取到文本内容，请确认文件内容为文字而非纯图片扫描件");
    }
    return text;
  } finally {
    await parser.destroy();
  }
}

/** 从公开网页链接中抓取正文文本（简单 HTML 转文本，不执行 JS，不支持需要登录的页面） */
export async function fetchResumeFromUrl(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("简历链接格式不正确");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("仅支持 http/https 链接");
  }

  const res = await fetch(parsed.toString(), {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; MockoraBot/1.0; +interview-practice-tool)",
    },
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`抓取链接失败，状态码 ${res.status}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, footer, header").remove();
  const text = $("body").text().replace(/\n{2,}/g, "\n").replace(/[ \t]{2,}/g, " ").trim();

  if (!text || text.length < 20) {
    throw new Error("未能从该链接中提取到有效的简历文本内容");
  }
  return text;
}
