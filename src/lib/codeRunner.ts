import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";
import type { AlgoLanguage, AlgorithmRunResult, AlgorithmTestCase, AlgorithmTestResult } from "@/types/interview";

const execFileAsync = promisify(execFile);

const RUN_TIMEOUT_MS = 5000;
const JAVA_TIMEOUT_MS = 10000; // JVM 启动 + 编译耗时更长
const MAX_BUFFER_BYTES = 1024 * 1024; // 1MB

/**
 * 代码执行沙箱说明：
 * 本函数直接在服务端进程所在的操作系统上通过子进程调用 node/python3 执行用户提交的代码，
 * 仅做了超时 + 输出大小限制等基础防护，并不是强隔离的安全沙箱。
 * 因此必须将本应用整体部署在独立的容器/虚拟机中（见部署文档），不要在未隔离的主机上直接运行，
 * 也不要在同一容器内保存任何敏感凭据。
 */
export async function runAlgorithmSubmission(
  language: AlgoLanguage,
  code: string,
  functionName: string,
  testCases: AlgorithmTestCase[]
): Promise<AlgorithmRunResult> {
  if (language === "javascript") {
    return runJavaScript(code, functionName, testCases);
  }
  if (language === "python") {
    return runPython(code, functionName, testCases);
  }
  if (language === "java") {
    return runJava(code, functionName, testCases);
  }
  throw new Error(`不支持的语言: ${language}`);
}

function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mockora-run-"));
  return fn(dir).finally(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

async function runJavaScript(
  code: string,
  functionName: string,
  testCases: AlgorithmTestCase[]
): Promise<AlgorithmRunResult> {
  return withTempDir(async (dir) => {
    const file = path.join(dir, "submission.js");
    const testCasesJson = JSON.stringify(testCases);
    const harness = [
      "'use strict';",
      code,
      `\nconst __testCases = ${testCasesJson};`,
      "const __results = [];",
      "for (const tc of __testCases) {",
      "  let actual = null;",
      "  let error = null;",
      "  try {",
      `    actual = ${functionName}(...tc.input);`,
      "  } catch (e) {",
      "    error = e && e.message ? String(e.message) : String(e);",
      "  }",
      "  let passed = false;",
      "  if (error === null) {",
      "    try { passed = JSON.stringify(actual) === JSON.stringify(tc.expectedOutput); } catch { passed = false; }",
      "  }",
      "  __results.push({ passed, actual, expectedOutput: tc.expectedOutput, hidden: tc.hidden, error });",
      "}",
      "process.stdout.write(JSON.stringify(__results));",
    ].join("\n");
    fs.writeFileSync(file, harness, "utf-8");

    try {
      const { stdout } = await execFileAsync("node", [file], {
        timeout: RUN_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: MAX_BUFFER_BYTES,
        cwd: dir,
      });
      const results = JSON.parse(stdout) as AlgorithmTestResult[];
      return { results, allPassed: results.every((r) => r.passed), runtimeError: null };
    } catch (err) {
      return toRunFailure(err, testCases);
    }
  });
}

async function runPython(
  code: string,
  functionName: string,
  testCases: AlgorithmTestCase[]
): Promise<AlgorithmRunResult> {
  return withTempDir(async (dir) => {
    const file = path.join(dir, "submission.py");
    const dataFile = path.join(dir, "testcases.json");
    fs.writeFileSync(dataFile, JSON.stringify(testCases), "utf-8");

    const harness = [
      "import json",
      "",
      code,
      "",
      "with open('testcases.json', 'r', encoding='utf-8') as __f:",
      "    __test_cases = json.load(__f)",
      "__results = []",
      "for __tc in __test_cases:",
      "    __actual = None",
      "    __error = None",
      "    try:",
      `        __actual = ${functionName}(*__tc["input"])`,
      "        try:",
      "            __actual = json.loads(json.dumps(__actual))",
      "        except Exception:",
      "            pass",
      "    except Exception as __e:",
      "        __error = str(__e)",
      "    __passed = False",
      "    if __error is None:",
      "        try:",
      "            __passed = __actual == __tc[\"expectedOutput\"]",
      "        except Exception:",
      "            __passed = False",
      "    __results.append({\"passed\": __passed, \"actual\": __actual, \"expectedOutput\": __tc[\"expectedOutput\"], \"hidden\": __tc[\"hidden\"], \"error\": __error})",
      "print(json.dumps(__results))",
    ].join("\n");
    fs.writeFileSync(file, harness, "utf-8");

    try {
      const { stdout } = await execFileAsync("python3", [file], {
        timeout: RUN_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: MAX_BUFFER_BYTES,
        cwd: dir,
      });
      const results = JSON.parse(stdout) as AlgorithmTestResult[];
      return { results, allPassed: results.every((r) => r.passed), runtimeError: null };
    } catch (err) {
      return toRunFailure(err, testCases);
    }
  });
}

async function runJava(
  code: string,
  functionName: string,
  testCases: AlgorithmTestCase[]
): Promise<AlgorithmRunResult> {
  if (!/\bclass\s+Solution\b/.test(code)) {
    return toRunFailure(new Error('Java 代码必须定义名为 "Solution" 的类'), testCases);
  }

  return withTempDir(async (dir) => {
    const solutionFile = path.join(dir, "Solution.java");
    const mainFile = path.join(dir, "Main.java");
    fs.writeFileSync(solutionFile, code, "utf-8");
    fs.writeFileSync(mainFile, buildJavaHarness(functionName, testCases), "utf-8");

    try {
      await execFileAsync("javac", ["-encoding", "UTF-8", "Solution.java", "Main.java"], {
        timeout: JAVA_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: MAX_BUFFER_BYTES,
        cwd: dir,
      });
    } catch (err) {
      return toRunFailure(err, testCases, "编译失败：", JAVA_TIMEOUT_MS);
    }

    try {
      const { stdout } = await execFileAsync("java", ["-cp", dir, "-Dfile.encoding=UTF-8", "Main"], {
        timeout: JAVA_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: MAX_BUFFER_BYTES,
        cwd: dir,
      });
      const results = JSON.parse(stdout) as AlgorithmTestResult[];
      return { results, allPassed: results.every((r) => r.passed), runtimeError: null };
    } catch (err) {
      return toRunFailure(err, testCases, "", JAVA_TIMEOUT_MS);
    }
  });
}

/**
 * 生成 Java 执行入口：内嵌一个极简 JSON 解析/序列化器 + 基于反射的参数类型转换，
 * 通过反射调用 Solution.<functionName>，再把结果序列化为与 JS/Python 一致的结果数组。
 * 仅支持常见题型所需的类型：基础类型及其包装类、String、任意维度数组、List<基础类型/String/List<...>>。
 */
function buildJavaHarness(functionName: string, testCases: AlgorithmTestCase[]): string {
  const escaped = JSON.stringify(testCases)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  return `import java.lang.reflect.*;
import java.util.*;

public class Main {
  public static void main(String[] args) throws Exception {
    List<Object> testCases = (List<Object>) Json.parse("${escaped}");
    Method method = findMethod();
    List<Object> results = new ArrayList<>();
    for (Object tcObj : testCases) {
      Map<String, Object> tc = (Map<String, Object>) tcObj;
      List<Object> input = (List<Object>) tc.get("input");
      Object expected = tc.get("expectedOutput");
      boolean hidden = Boolean.TRUE.equals(tc.get("hidden"));
      Object actual = null;
      String error = null;
      try {
        Type[] paramTypes = method.getGenericParameterTypes();
        Object[] callArgs = new Object[input.size()];
        for (int k = 0; k < input.size(); k++) {
          callArgs[k] = Json.convert(input.get(k), paramTypes[k]);
        }
        actual = method.invoke(null, callArgs);
      } catch (InvocationTargetException ite) {
        Throwable cause = ite.getCause();
        error = cause != null ? cause.toString() : ite.toString();
      } catch (Exception e) {
        error = e.toString();
      }
      boolean passed = false;
      if (error == null) {
        try {
          passed = Json.stringify(actual).equals(Json.stringify(expected));
        } catch (Exception e) {
          passed = false;
        }
      }
      Map<String, Object> r = new LinkedHashMap<>();
      r.put("passed", passed);
      r.put("actual", actual);
      r.put("expectedOutput", expected);
      r.put("hidden", hidden);
      r.put("error", error);
      results.add(r);
    }
    System.out.println(Json.stringify(results));
  }

  static Method findMethod() throws Exception {
    Class<?> cls = Class.forName("Solution");
    for (Method m : cls.getDeclaredMethods()) {
      if (m.getName().equals("${functionName}")) {
        m.setAccessible(true);
        return m;
      }
    }
    throw new RuntimeException("未在 Solution 类中找到方法: ${functionName}");
  }
}

class Json {
  private final String s;
  private int i = 0;

  private Json(String s) {
    this.s = s;
  }

  static Object parse(String s) {
    Json j = new Json(s);
    j.skipWs();
    return j.parseValue();
  }

  private void skipWs() {
    while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++;
  }

  private Object parseValue() {
    skipWs();
    char c = s.charAt(i);
    if (c == '{') return parseObject();
    if (c == '[') return parseArray();
    if (c == '"') return parseString();
    if (c == 't') { i += 4; return Boolean.TRUE; }
    if (c == 'f') { i += 5; return Boolean.FALSE; }
    if (c == 'n') { i += 4; return null; }
    return parseNumber();
  }

  private Map<String, Object> parseObject() {
    Map<String, Object> m = new LinkedHashMap<>();
    i++;
    skipWs();
    if (s.charAt(i) == '}') { i++; return m; }
    while (true) {
      skipWs();
      String key = parseString();
      skipWs();
      i++; // ':'
      Object val = parseValue();
      m.put(key, val);
      skipWs();
      if (s.charAt(i) == ',') { i++; continue; }
      i++; // '}'
      break;
    }
    return m;
  }

  private List<Object> parseArray() {
    List<Object> l = new ArrayList<>();
    i++;
    skipWs();
    if (s.charAt(i) == ']') { i++; return l; }
    while (true) {
      Object val = parseValue();
      l.add(val);
      skipWs();
      if (s.charAt(i) == ',') { i++; skipWs(); continue; }
      i++; // ']'
      break;
    }
    return l;
  }

  private String parseString() {
    StringBuilder sb = new StringBuilder();
    i++;
    while (s.charAt(i) != '"') {
      char c = s.charAt(i);
      if (c == '\\\\') {
        i++;
        char e = s.charAt(i);
        switch (e) {
          case 'n': sb.append('\\n'); break;
          case 't': sb.append('\\t'); break;
          case 'r': sb.append('\\r'); break;
          case '"': sb.append('"'); break;
          case '\\\\': sb.append('\\\\'); break;
          case '/': sb.append('/'); break;
          case 'b': sb.append('\\b'); break;
          case 'f': sb.append('\\f'); break;
          case 'u':
            sb.append((char) Integer.parseInt(s.substring(i + 1, i + 5), 16));
            i += 4;
            break;
          default: sb.append(e);
        }
        i++;
      } else {
        sb.append(c);
        i++;
      }
    }
    i++;
    return sb.toString();
  }

  private Object parseNumber() {
    int start = i;
    while (i < s.length() && "-+.eE0123456789".indexOf(s.charAt(i)) >= 0) i++;
    return Double.parseDouble(s.substring(start, i));
  }

  static Object convert(Object value, Type type) {
    if (value == null) return null;
    if (type instanceof ParameterizedType) {
      ParameterizedType pt = (ParameterizedType) type;
      Class<?> raw = (Class<?>) pt.getRawType();
      if (List.class.isAssignableFrom(raw)) {
        Type elemType = pt.getActualTypeArguments()[0];
        List<Object> result = new ArrayList<>();
        for (Object v : (List<?>) value) {
          result.add(convert(v, elemType));
        }
        return result;
      }
    }
    if (type instanceof Class) {
      return convertClass(value, (Class<?>) type);
    }
    return value;
  }

  private static Object convertClass(Object value, Class<?> type) {
    if (type == int.class || type == Integer.class) return ((Double) value).intValue();
    if (type == long.class || type == Long.class) return ((Double) value).longValue();
    if (type == double.class || type == Double.class) return (Double) value;
    if (type == float.class || type == Float.class) return ((Double) value).floatValue();
    if (type == boolean.class || type == Boolean.class) return (Boolean) value;
    if (type == String.class) return (String) value;
    if (type == char.class || type == Character.class) return ((String) value).charAt(0);
    if (type.isArray()) {
      List<?> list = (List<?>) value;
      Class<?> comp = type.getComponentType();
      Object arr = Array.newInstance(comp, list.size());
      for (int k = 0; k < list.size(); k++) {
        Array.set(arr, k, convertClass(list.get(k), comp));
      }
      return arr;
    }
    if (List.class.isAssignableFrom(type)) return value;
    return value;
  }

  static String stringify(Object o) {
    StringBuilder sb = new StringBuilder();
    stringify(o, sb);
    return sb.toString();
  }

  private static void stringify(Object o, StringBuilder sb) {
    if (o == null) { sb.append("null"); return; }
    if (o instanceof String) {
      sb.append('"');
      for (char c : ((String) o).toCharArray()) {
        switch (c) {
          case '"': sb.append("\\\\\\\""); break;
          case '\\\\': sb.append("\\\\\\\\"); break;
          case '\\n': sb.append("\\\\n"); break;
          case '\\r': sb.append("\\\\r"); break;
          case '\\t': sb.append("\\\\t"); break;
          default:
            if (c < 0x20) sb.append(String.format("\\\\u%04x", (int) c));
            else sb.append(c);
        }
      }
      sb.append('"');
      return;
    }
    if (o instanceof Boolean) { sb.append(o.toString()); return; }
    if (o instanceof Double) {
      double d = (Double) o;
      if (d == Math.floor(d) && !Double.isInfinite(d) && Math.abs(d) < 1e15) {
        sb.append((long) d);
      } else {
        sb.append(d);
      }
      return;
    }
    if (o instanceof Integer || o instanceof Long || o instanceof Float) { sb.append(o.toString()); return; }
    if (o instanceof Character) { sb.append('"').append(o.toString()).append('"'); return; }
    if (o instanceof Map) {
      sb.append('{');
      boolean first = true;
      for (Map.Entry<?, ?> e : ((Map<?, ?>) o).entrySet()) {
        if (!first) sb.append(',');
        first = false;
        stringify(e.getKey().toString(), sb);
        sb.append(':');
        stringify(e.getValue(), sb);
      }
      sb.append('}');
      return;
    }
    if (o instanceof List) {
      sb.append('[');
      boolean first = true;
      for (Object v : (List<?>) o) {
        if (!first) sb.append(',');
        first = false;
        stringify(v, sb);
      }
      sb.append(']');
      return;
    }
    if (o.getClass().isArray()) {
      sb.append('[');
      int len = Array.getLength(o);
      for (int k = 0; k < len; k++) {
        if (k > 0) sb.append(',');
        stringify(Array.get(o, k), sb);
      }
      sb.append(']');
      return;
    }
    sb.append('"').append(o.toString()).append('"');
  }
}
`;
}

function toRunFailure(
  err: unknown,
  testCases: AlgorithmTestCase[],
  prefix = "",
  timeoutMs: number = RUN_TIMEOUT_MS
): AlgorithmRunResult {
  const e = err as { killed?: boolean; signal?: string; stderr?: string; message?: string };
  let message: string;
  if (e.killed || e.signal === "SIGKILL") {
    message = `代码执行超时（超过 ${timeoutMs / 1000}s），请检查是否存在死循环`;
  } else {
    message = prefix + ((e.stderr && e.stderr.trim()) || e.message || "代码执行失败");
  }
  const results: AlgorithmTestResult[] = testCases.map((tc) => ({
    passed: false,
    actual: null,
    expectedOutput: tc.expectedOutput,
    hidden: tc.hidden,
    error: message,
  }));
  return { results, allPassed: false, runtimeError: message };
}