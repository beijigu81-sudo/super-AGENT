// DSH workflow · 串行 vs 并行对照实验（n = 4，3 轮交替）
//
// 用法：把本文件整段作为 DSH `workflow` 工具的 script 提交。
// 返回：{ rounds: [...], notes: [...] }
//
// 设计要点
// - 串行组 = 1 个子代理顺序做完 T1→T4；并改组 = 4 个子代理各做一件，同一时刻派发
// - 每轮记录两种时间：脚本侧墙钟（墙钟 = 派发到最后一组返回）+ 子代理自报起止时间戳
//   前者是"用户体感"，后者用来核验重叠是否真的发生，两者必须对得上
// - 3 轮交替 P,S,P,S,P,S，避免时段性网络波动单向污染某一组
// - 4 个任务工具链不同：GitHub API / nodejs.org / npm registry / 本机 PowerShell

const SCHEMA_TASK = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    value: { type: 'string' },
    method: { type: 'string' },
    evidence: { type: 'string' },
    status: { type: 'string', enum: ['ok', 'failed'] },
    started_at: { type: 'string' },
    finished_at: { type: 'string' },
    seconds: { type: 'number' },
  },
  required: ['id', 'value', 'status', 'seconds', 'started_at', 'finished_at'],
  additionalProperties: false,
}

const SCHEMA_SERIAL = {
  type: 'object',
  properties: {
    items: { type: 'array', items: SCHEMA_TASK },
    total_seconds: { type: 'number' },
    note: { type: 'string' },
  },
  required: ['items', 'total_seconds'],
  additionalProperties: false,
}

const HEAD = `你是被派去做独立调查的子代理，处于隔离上下文，看不到父对话。只做只读调查，不要创建、修改或删除任何文件。

计时要求（硬性）：
- 开始前用 pwsh 工具执行一次 Get-Date -Format o，记为 started_at
- 全部结束后再执行一次，记为 finished_at
- seconds = 两者之差，保留一位小数
- 失败就把 status 设为 "failed"、value 填 "FAILED: 原因"，禁止编造答案、禁止用记忆里的旧版本号充数
`

const TASKS = [
  {
    id: 'T1',
    prompt: `${HEAD}
任务：查 GitHub 仓库 microsoft/vscode 当前最新「正式发布」（latest release）的版本标签和发布时间。

方法：用 web_fetch 直接访问 https://api.github.com/repos/microsoft/vscode/releases/latest
- value 填 tag_name
- evidence 填原文里的 tag_name / prerelease / published_at 三个字段
- 必须来自这次 API 返回，不要用搜索摘要或记忆替代`,
  },
  {
    id: 'T2',
    prompt: `${HEAD}
任务：查 Node.js 当前最新 LTS 版本号（形如 24.11.0，不要带前导 v）。

方法：用 web_fetch 访问 https://nodejs.org/dist/index.json
- 该数组按版本从新到旧排列；取 lts 字段不为 false 的第一条
- value 填去掉前导 v 的版本号
- evidence 填该条的 version 与 lts 字段原文`,
  },
  {
    id: 'T3',
    prompt: `${HEAD}
任务：查 npm 包 typescript 当前的 latest 版本号。

方法：用 web_fetch 访问 https://registry.npmjs.org/typescript/latest
- value 填 version 字段
- evidence 填该 JSON 里的 name 与 version`,
  },
  {
    id: 'T4',
    prompt: `${HEAD}
任务（本机，不联网，不要用 WMI）：
1. 环境变量 PROCESSOR_IDENTIFIER 的值
2. 环境变量 NUMBER_OF_PROCESSORS 的值
3. C: 盘可用空间，单位 GB，保留一位小数

方法（本机两条限制，务必绕开）：
- WMI/CIM 被沙箱拒绝访问（Get-CimInstance / Get-Volume 会报"拒绝访问"）
- Get-PSDrive 的 Free/Used 在本环境返回空或 0，不可用
- 1、2 用 $env:PROCESSOR_IDENTIFIER / $env:NUMBER_OF_PROCESSORS
- 3 用 [System.IO.DriveInfo]::new('C:\\').AvailableFreeSpace / 1GB
- value 写成一行：CPU_IDENT | NPROC | FREE_GB`,
  },
]

const SERIAL_PROMPT = `${HEAD}
你是串行组的唯一子代理，要**依次**完成下面 4 个任务（做完一个再做下一个，不要并行、不要跳步）。

T1 GitHub：microsoft/vscode 最新正式发布的 tag_name 与 published_at（web_fetch https://api.github.com/repos/microsoft/vscode/releases/latest）
T2 Node.js：最新 LTS 版本号，去掉前导 v（web_fetch https://nodejs.org/dist/index.json，取 lts 不为 false 的第一条）
T3 npm：typescript 的 latest 版本号（web_fetch https://registry.npmjs.org/typescript/latest 的 version 字段）
T4 本机：$env:PROCESSOR_IDENTIFIER、$env:NUMBER_OF_PROCESSORS、C: 可用 GB（用 [System.IO.DriveInfo]::new('C:\\').AvailableFreeSpace；不要用 WMI，也不要用 Get-PSDrive，本环境二者都会失败或返回 0）

输出要求：
- items 数组按 T1..T4 顺序，每项含 id / value / status / started_at / finished_at / seconds / method / evidence
- 每项单独记自己的起止时间
- total_seconds = 从 T1 开始到 T4 结束
- 任何一项失败：该项 status=failed、value 写 "FAILED: 原因"，其余项照常继续，禁止编造`

const nowMs = () => {
  try {
    return Date.now()
  } catch (e) {
    return null
  }
}

async function runParallel(round) {
  const t0 = nowMs()
  const raw = await parallel(
    TASKS.map((t) => () =>
      agent(t.prompt, { label: `${t.id} · 并行 R${round}`, phase: `并行 R${round}`, schema: SCHEMA_TASK }),
    ),
  )
  const t1 = nowMs()
  const items = raw.filter(Boolean).map((r) => ({ ...r, reported: true }))
  const failed = raw.filter((r) => !r).length
  return { arm: 'parallel', round, start_ms: t0, end_ms: t1, wall_ms: t1 - t0, items, failed }
}

async function runSerial(round) {
  const t0 = nowMs()
  const res = await agent(SERIAL_PROMPT, {
    label: `串行 R${round}`,
    phase: `串行 R${round}`,
    schema: SCHEMA_SERIAL,
  })
  const t1 = nowMs()
  return {
    arm: 'serial',
    round,
    start_ms: t0,
    end_ms: t1,
    wall_ms: t1 - t0,
    items: res ? res.items : [],
    total_seconds_reported: res ? res.total_seconds : null,
    failed: res ? 0 : 1,
  }
}

const rounds = []
for (let r = 1; r <= 3; r++) {
  phase(`第 ${r} 轮 · 并行`)
  log(`R${r} parallel start`)
  rounds.push(await runParallel(r))

  phase(`第 ${r} 轮 · 串行`)
  log(`R${r} serial start`)
  rounds.push(await runSerial(r))
}

return {
  rounds,
  notes: [
    'wall_ms 由脚本侧 Date.now() 记录，覆盖派发到最后一个子代理返回的完整区间',
    'items[].started_at / finished_at 是子代理自己用 Get-Date 记的，用于核验重叠',
    `共 ${rounds.length} 次运行，${rounds.reduce((a, x) => a + x.items.length, 0)} 条子代理结果`,
  ],
}
