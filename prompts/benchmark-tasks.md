# 任务提示词（原文）

这里是从 `workflows/benchmark.js` 里直接抄出来的提示词原文，方便单独复用或改任务。

设计约束有两条，都来自实测：
1. **每段提示词必须自包含**——子代理看不到父对话，任何隐含前提都得写进去。
2. **必须显式要求回报失败**——否则子代理倾向于给你一个体面的、编造的答案。

---

## 公共头部

```
你是被派去做独立调查的子代理，处于隔离上下文，看不到父对话。只做只读调查，不要创建、修改或删除任何文件。

计时要求（硬性）：
- 开始前用 pwsh 工具执行一次 Get-Date -Format o，记为 started_at
- 全部结束后再执行一次，记为 finished_at
- seconds = 两者之差，保留一位小数
- 失败就把 status 设为 "failed"、value 填 "FAILED: 原因"，禁止编造答案、禁止用记忆里的旧版本号充数
```

---

## T1 · GitHub API（web）

```
任务：查 GitHub 仓库 microsoft/vscode 当前最新「正式发布」（latest release）的版本标签和发布时间。

方法：用 web_fetch 直接访问 https://api.github.com/repos/microsoft/vscode/releases/latest
- value 填 tag_name
- evidence 填原文里的 tag_name / prerelease / published_at 三个字段
- 必须来自这次 API 返回，不要用搜索摘要或记忆替代
```

## T2 · nodejs.org（web，大 JSON）

```
任务：查 Node.js 当前最新 LTS 版本号（形如 24.11.0，不要带前导 v）。

方法：用 web_fetch 访问 https://nodejs.org/dist/index.json
- 该数组按版本从新到旧排列；取 lts 字段不为 false 的第一条
- value 填去掉前导 v 的版本号
- evidence 填该条的 version 与 lts 字段原文
```

## T3 · npm registry（web）

```
任务：查 npm 包 typescript 当前的 latest 版本号。

方法：用 web_fetch 访问 https://registry.npmjs.org/typescript/latest
- value 填 version 字段
- evidence 填该 JSON 里的 name 与 version
```

## T4 · 本机（无网络，且要绕开两条沙箱限制）

```
任务（本机，不联网，不要用 WMI）：
1. 环境变量 PROCESSOR_IDENTIFIER 的值
2. 环境变量 NUMBER_OF_PROCESSORS 的值
3. C: 盘可用空间，单位 GB，保留一位小数

方法（本机两条限制，务必绕开）：
- WMI/CIM 被沙箱拒绝访问（Get-CimInstance / Get-Volume 会报"拒绝访问"）
- Get-PSDrive 的 Free/Used 在本环境返回空或 0，不可用
- 1、2 用 $env:PROCESSOR_IDENTIFIER / $env:NUMBER_OF_PROCESSORS
- 3 用 [System.IO.DriveInfo]::new('C:\').AvailableFreeSpace / 1GB
- value 写成一行：CPU_IDENT | NPROC | FREE_GB
```

---

## 串行组（一个代理做完全部 4 项）

```
你是串行组的唯一子代理，要**依次**完成下面 4 个任务（做完一个再做下一个，不要并行、不要跳步）。

T1 GitHub：microsoft/vscode 最新正式发布的 tag_name 与 published_at（web_fetch https://api.github.com/repos/microsoft/vscode/releases/latest）
T2 Node.js：最新 LTS 版本号，去掉前导 v（web_fetch https://nodejs.org/dist/index.json，取 lts 不为 false 的第一条）
T3 npm：typescript 的 latest 版本号（web_fetch https://registry.npmjs.org/typescript/latest 的 version 字段）
T4 本机：$env:PROCESSOR_IDENTIFIER、$env:NUMBER_OF_PROCESSORS、C: 可用 GB（用 [System.IO.DriveInfo]::new('C:\').AvailableFreeSpace；不要用 WMI，也不要用 Get-PSDrive，本环境二者都会失败或返回 0）

输出要求：
- items 数组按 T1..T4 顺序，每项含 id / value / status / started_at / finished_at / seconds / method / evidence
- 每项单独记自己的起止时间
- total_seconds = 从 T1 开始到 T4 结束
- 任何一项失败：该项 status=failed、value 写 "FAILED: 原因"，其余项照常继续，禁止编造
```
