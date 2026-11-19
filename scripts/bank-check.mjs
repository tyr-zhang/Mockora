#!/usr/bin/env node
/**
 * 题库严格校验：npm run bank:check
 *
 * 运行期加载器对单个非法文件是跳过 + 告警（保证面试流程不被一道坏题中断），
 * 本脚本则作为更新题库后的安全网，严格报告所有问题并在有错误时以非零码退出：
 *   1. 结构校验（与 src/lib/bankLoader.ts 的 zod schema 保持一致，改 schema 时请同步这里）
 *   2. 参考实现逐用例实跑，确认无运行时错误
 *   3. 实跑结果与 expectedOutputs（人工核对的标准答案）逐一比对
 */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const dir = path.join(process.cwd(), "questions");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));

let errors = 0;
const seenIds = new Set();
const err = (file, msg) => {
  errors++;
  console.error("[FAIL] " + file + ": " + msg);
};

for (const file of files) {
  const full = path.join(dir, file);
  let q;
  try {
    q = JSON.parse(fs.readFileSync(full, "utf-8"));
  } catch (e) {
    err(file, "JSON 解析失败: " + e.message);
    continue;
  }

  // 结构校验
  const stringFields = ["id", "title", "approachExplanation"];
  for (const f of stringFields) {
    if (typeof q[f] !== "string" || q[f].length === 0) err(file, "字段 " + f + " 必须是非空字符串");
  }
  if (!["easy", "medium"].includes(q.difficulty)) err(file, "difficulty 必须是 easy/medium");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(q.functionName))) err(file, "functionName 非法: " + q.functionName);
  for (const [f, min] of [["descriptionLines", 1], ["referenceSolutionLines", 1], ["paramNames", 1], ["expectedOutputs", 3], ["testInputs", 3]]) {
    if (!Array.isArray(q[f]) || q[f].length < min) err(file, "字段 " + f + " 必须是长度 >= " + min + " 的数组");
  }
  if (q.id + ".json" !== file) err(file, "文件名必须与 id 一致（期望 " + q.id + ".json）");
  if (seenIds.has(q.id)) err(file, "id 重复: " + q.id);
  seenIds.add(q.id);
  if (Array.isArray(q.testInputs)) {
    if (!q.testInputs.slice(0, 2).every((t) => t && t.hidden === false)) {
      err(file, "前 2 个用例必须是可见用例（hidden=false）");
    }
    for (const t of q.testInputs) {
      if (!t || !Array.isArray(t.input) || typeof t.hidden !== "boolean") {
        err(file, "testInputs 每项必须是 { input: 数组, hidden: 布尔 }");
        break;
      }
    }
  }
  if (Array.isArray(q.expectedOutputs) && Array.isArray(q.testInputs) && q.expectedOutputs.length !== q.testInputs.length) {
    err(file, "expectedOutputs（" + q.expectedOutputs.length + "）与 testInputs（" + q.testInputs.length + "）数量不一致");
  }

  // 参考实现实跑 + 期望值比对
  const code = Array.isArray(q.referenceSolutionLines) ? q.referenceSolutionLines.join("\n") : "";
  if (code) {
    const sandbox = {};
    try {
      vm.createContext(sandbox);
      vm.runInContext(code, sandbox);
      const fn = sandbox[q.functionName];
      if (typeof fn !== "function") {
        err(file, "参考实现未定义函数 " + q.functionName);
      } else if (Array.isArray(q.testInputs)) {
        q.testInputs.forEach((tc, i) => {
          let actual;
          try {
            actual = fn(...JSON.parse(JSON.stringify(tc.input)));
          } catch (e) {
            err(file, "用例 " + i + " 运行报错: " + e.message);
            return;
          }
          const expected = q.expectedOutputs[i];
          if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            err(file, "用例 " + i + " 实跑结果 " + JSON.stringify(actual) + " 与 expectedOutputs 不符（" + JSON.stringify(expected) + "）");
          }
        });
      }
    } catch (e) {
      err(file, "参考实现无法执行: " + e.message);
    }
  }
}

console.log("共检查 " + files.length + " 个题库文件，" + (errors === 0 ? "全部通过" : errors + " 处错误"));
process.exit(errors === 0 ? 0 : 1);
