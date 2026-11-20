# Mockora · AI 模拟面试智能体

基于 [OpenAI Agents SDK](https://openai.github.io/openai-agents-js/)（TypeScript 版）和 Next.js 构建的模拟面试 Web 应用。

## 功能

- 上传 PDF 简历或填写公开网页链接，填写求职方向，由 AI 根据简历内容动态生成面试题；可选填岗位要求/JD，出题与评估将优先覆盖其中的关键能力项（考试模式追问、学习模式出题、算法题难度、最终报告的岗位匹配度评估均会结合 JD）
- **学习模式**：依次出题，自行思考后查看参考答案，可随时追问加深理解
- **考试模式**：文字作答，AI 面试官像真人一样根据回答质量自主决定追问或推进下一题（3~8 个主题），
  面试结束后统一生成评估报告（总体评分、分维度评价、逐题点评、改进建议）
- **算法题（技术类面试）**：AI 自动判断目标岗位是否为技术类岗位，若是则在学习/考试流程中插入 1 道算法编程题，
  支持 JavaScript / Python / Java 三种语言在线编写代码并实际运行测试用例校验结果；考试模式下代码与测试通过情况会计入最终评估报告；
  考试模式下还支持"跳过本题"，跳过后面试官会直接推进到下一题（或结束面试），不会原地反复追问
- 考试模式彩蛋指令：在文本回答框输入 `whosyourdaddy` 并提交，可查看当前题目的参考答案（仅本地展示，不计入面试记录与评估报告，供自检学习用）
- 无账号系统、无服务端持久化，所有状态仅保存在当前浏览器会话中

## 本地开发

1. 安装依赖：

   ```bash
   npm install
   ```

2. 复制环境变量配置并填入真实的 API Key：

   ```bash
   cp .env.example .env
   ```

   ```env
   OPENAI_API_KEY=你的 OpenAI API Key
   OPENAI_BASE_URL=   # 如需走中转/代理，填入自定义 base url，否则留空
   OPENAI_MODEL=gpt-4o-mini        # 出题/对话使用的模型
   OPENAI_REPORT_MODEL=gpt-4o      # 生成最终面试报告使用的模型
   ```

3. 启动开发服务器：

   ```bash
   npm run dev
   ```

   打开 http://localhost:3000

## 生产构建

```bash
npm run build
npm run start
```

## 部署到个人服务器（Docker）

项目已配置 Next.js `output: "standalone"`，并提供 `Dockerfile` / `docker-compose.yml`，可直接容器化部署到任意装有 Docker 的服务器。

### 1. 准备环境变量

在服务器上创建 `.env` 文件（与 `docker-compose.yml` 同目录），内容参考 `.env.example`：

```env
OPENAI_API_KEY=你的 OpenAI API Key
OPENAI_BASE_URL=
OPENAI_MODEL=gpt-4o-mini
OPENAI_REPORT_MODEL=gpt-4o
```

### 2. 构建并启动（使用 docker compose，推荐）

将项目代码上传到服务器后，在项目根目录执行：

```bash
docker compose up -d --build
```

默认监听 `3000` 端口，访问 `http://服务器IP:3000` 即可。

### 3. 不使用 compose，手动构建/运行

```bash
docker build -t mockora:latest .
docker run -d --name mockora --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  mockora:latest
```

### 4. 查看日志 / 更新 / 停止

```bash
# 日志
docker compose logs -f

# 代码更新后重新构建部署
docker compose up -d --build

# 停止
docker compose down
```

### 5. 反向代理与 HTTPS（可选，推荐）

生产环境建议在前面加一层 Nginx/Caddy 做反向代理和 HTTPS 终止，例如 Nginx 配置片段：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

再配合 `certbot` 申请 HTTPS 证书即可。

## 更新算法题库

算法题库存放在项目根目录 `questions/`，一题一个 JSON 文件（文件名必须与题目的 `id` 一致），运行时由 `/api/algorithm/generate` 路由动态加载：

- **本地开发**：在 `questions/` 下新增或修改 JSON 文件后立即生效（每次生成题目时重新扫描目录），无需重启。
- **Docker 部署**：`docker-compose.yml` 已将宿主机 `./questions` 挂载到容器 `/app/questions`，在宿主机目录增删文件即可免重建更新。

### 题目文件格式

```json
{
  "id": "is-palindrome",
  "difficulty": "easy",
  "title": "回文日志串判定",
  "descriptionLines": ["题面按行书写，加载时按换行拼接", "", "要求：..."],
  "functionName": "isPalindrome",
  "paramNames": ["s"],
  "approachExplanation": "参考解法思路（学习模式展示）",
  "referenceSolutionLines": ["function isPalindrome(s) {", "  ...", "}"],
  "expectedOutputs": [true, false, true, true, false, true],
  "testInputs": [
    { "input": ["A man, a plan, a canal: Panama"], "hidden": false },
    { "input": ["race a car"], "hidden": false },
    { "input": [""], "hidden": true }
  ]
}
```

约定：

- `descriptionLines` / `referenceSolutionLines` 按行书写（JSON 不支持多行字符串），加载时用换行拼接。
- 前 2 个 `testInputs` 必须是可见用例（`hidden: false`），其余为隐藏用例；输入输出需为可 JSON 序列化的简单值（兼容 JS/Python/Java 判题）。
- `expectedOutputs` 是人工核对的标准答案，仅用于校验；运行期期望输出实际由参考实现实跑得出。
- 题面答案必须确定性唯一（回避"最长回文子串"这类多解返回值的题，可改考长度）。

### 更新后务必校验

```bash
npm run bank:check
```

该脚本会严格校验所有题库文件：结构合法性、参考实现可执行、实跑结果与 `expectedOutputs` 一致，任何错误以非零码退出。运行期对单个非法文件只会跳过并打告警（不中断面试流程），请以本脚本作为加题安全网。

> ⚠️ 安全提示：`referenceSolutionLines` 会在服务端作为 JavaScript 执行，`questions/` 目录的写权限等同于服务器代码执行权限，只应由可信人员维护。

## 注意事项

- `OPENAI_API_KEY` 等敏感信息务必通过 `.env` 配置，不要提交到代码仓库（`.gitignore` 已默认忽略 `.env*`，仅保留 `.env.example`）。
- 简历解析仅支持 PDF 文件以及无需登录即可公开访问的网页链接。
- 当前应用不含账号系统和服务端持久化，刷新/关闭浏览器标签页会丢失当前这场面试的进度。

### ⚠️ 算法题代码执行的安全边界

算法题功能会在服务端通过子进程直接调用 `node`/`python3`/`javac`+`java` 执行候选人提交的代码（`src/lib/codeRunner.ts`），
仅做了**执行超时（JS/Python 5s，Java 编译+运行共 10s）+ 输出大小限制**等基础防护，**不是强隔离的安全沙箱**（不限制文件系统/网络访问）。

因此：
- 必须将本应用整体部署在独立的容器（本项目默认的 Docker 部署方式即满足）或虚拟机中，不要直接在裸机/合用主机上以 `npm run start` 方式对公网暴露。
- 不要在运行本应用的容器/主机上保存任何敏感凭据、密钥或可被同容器内进程访问到的内部网络资源。
- 该功能仅适用于本人自用的模拟面试练习场景，不要将其开放给不受信任的公开用户使用。
- Docker 镜像已在运行阶段安装 `python3` 和 `default-jdk-headless`（支持 Python / Java 代码执行）；若自行调整 Dockerfile 请保留该依赖。
- Java 代码要求候选人定义名为 `Solution` 的类，参数/返回类型会根据题目样例自动推断（int/double/boolean/String 及其任意维度数组），
  类型推断覆盖范围有限，复杂自定义类型（如泛型容器）不受支持。
