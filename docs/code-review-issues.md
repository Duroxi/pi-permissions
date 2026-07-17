# 代码审查问题记录

> 审查日期：2026-07-15
> 更新日期：2026-07-16
> 审查范围：pi-permissions 完整源码

---

## 🔴 问题 4：expandHomePath 缺少 $HOME 环境变量支持（✅ 已修复）

**文件**: `src/expand-home.ts`

**改动**: 新增 `resolveHomeDir()`，优先读取 `process.env.HOME`，再 fallback 到 `os.homedir()`。支持 Docker、CI、sudo 等环境变量与 OS 用户目录不一致的场景。

**修复 commit**: 见 rename + issue 清理提交。

---

## 🟠 问题 6：空 catch 块掩盖错误（✅ 已修复）

**文件**: `src/forwarded-permissions/permission-forwarder.ts`（`getSessionId`）

**改动**: `getSessionId()` 增加 `logger` 参数，异常时记录日志。调用点 `processInbox` 和 `waitForForwardedApproval` 已传入 `this.logger`。

---

## 🟡 问题 7：JSON Schema 中 propertyNames 使用了非标准字段（✅ 已修复）

**文件**: `schemas/permissions.schema.json`

**改动**: 删除 `propertyNames` 的 `description` 字段（JSON Schema 规范不识别该字段）。

---

## 🟡 问题 8：注释引用外部 issue 编号（✅ 已清理）

**范围**: 全部 `src/` 和 `test/` 下的 TypeScript 文件

**改动**: 删除所有非本仓库的 issue 编号引用（如 `#418`、`#509`、`#393` 等）。保留引用上游项目名（MasuRii、gotgenes）的注释。

---

## 🔴 问题 1：工具注册检查前置（⏳ 已评估，无需修改）

经过分析，工具注册检查在权限策略之前是合理设计——未注册的工具在 Pi 运行时中不存在，即使策略说 `allow` 也无法调用。不做修改。

---

## 🔴 问题 2：文件 IPC 竞态条件（⏳ 已知限制）

代码注释已引用 issue `#398`，当前通过防御性目录创建缓解。完全解决需要文件锁机制，超出当前范围。

---

## 🟠 问题 3：权限作用域合并的 origin 追踪粒度（ℹ️ 有意设计）

当前 origin 追踪的粒度满足所有已有需求（debug 日志显示最终 origin）。增加完整覆盖链会增加内存开销和复杂性，在需要时再实现。

---

## 🟠 问题 5：MCP source 推导逻辑不够直观（ℹ️ 已知设计）

`deriveSource` 函数的分支逻辑已有 TSDoc 说明。"default" vs "tool" 的区别在于是否匹配到配置规则，文档已在 `PermissionCheckResult.source` 中说明。

---

## 🟢 问题 9-11：代码组织文档问题（ℹ️ 已知）

- **构造函数参数过多**（问题 9）：已使用 Options Object 模式，点评合理但非阻塞
- **评估函数功能重叠**（问题 10）：`evaluateMostRestrictive` 和 `evaluateAnyValue` 用途不同，TSDoc 已说明
- **Windows `~` 语义**（问题 11）：代码已支持 `~\\` Windows 格式

---

## 处理汇总

| 优先级 | 问题 | 状态 |
|--------|------|------|
| 🔴 高 | 工具注册检查前置 | ⏳ 评估后保留 |
| 🔴 高 | 文件 IPC 竞态条件 | ℹ️ 已知限制 |
| 🟠 中 | expandHomePath 环境变量支持 | ✅ 已修复 |
| 🟠 中 | MCP source 推导 | ℹ️ 已知设计 |
| 🟠 中 | 空 catch 掩盖错误 | ✅ 已修复 |
| 🟠 中 | 作用域 origin 追踪 | ℹ️ 有意设计 |
| 🟡 低 | JSON Schema 非标字段 | ✅ 已修复 |
| 🟡 低 | 外部 issue 引用 | ✅ 已清理 |
| 🟢 低 | 构造函数参数过多 | ℹ️ 已评估 |
| 🟢 低 | 评估函数功能重叠 | ℹ️ 已知 |
| 🟢 低 | Windows `~` 语义 | ℹ️ 已支持 |

---

# 对抗性安全审查

> 审查日期：2026-07-16
> 审查类型：对抗性安全审查（Adversarial Security Review）
> 审查范围：pi-permissions 完整源码

---

## 🔴 严重 (Critical)

### C-1：Agent 名称路径遍历 → 任意文件读取 / 权限注入（✅ 已修复）

**文件**: `src/policy-loader.ts`（`loadScopeConfigFrom`）

```ts
const filePath = join(dir, `${agentName}.md`);
```

`agentName` 来自 `session.resolveAgentName(ctx)`，它从系统提示中的 `<active_agent>` 标签解析。如果 agent 的系统提示被篡改，设置 `<active_agent>../../etc/passwd</active_agent>`，则 `join(dir, "../../etc/passwd.md")` 可能指向目录外文件。虽然不存在的文件会静默返回 `{}`，但攻击者可以通过 `write` 工具在项目目录中创建恶意 agent 定义文件（含 YAML frontmatter 权限注入），然后通过系统提示指向它来注入权限配置。

**建议**: 对 `agentName` 做路径清洗，拒绝包含 `/`、`\`、`..` 的名称。

---

### C-2：Session ID 路径遍历 → IPC 目录穿越（✅ 已修复）

**文件**: `src/permission-forwarding.ts`（`createPermissionForwardingLocation`）

```ts
function encodeSessionIdForPath(sessionId: string): string {
  return encodeURIComponent(sessionId);
}
```

`encodeURIComponent` 不编码 `..`。如果某个子代理扩展返回包含 `..` 的 session ID，且路径中出现了真实的 `/`（非 `%2F` 编码），可能构成路径穿越。

**建议**: 添加 `normalizedSessionId.includes("..")` 拒绝检查，或使用安全路径验证。

---

## 🔴 高危 (High)

### H-1：Windows `isSafeSystemPath` 后缀匹配过于宽松（✅ 已修复）

**文件**: `src/safe-system-paths.ts`

```ts
if (process.platform === "win32") {
  const lower = normalizedPath.toLowerCase();
  for (const unixPath of SAFE_SYSTEM_PATHS) {
    const winTail = unixPath.replace(/\//g, "\\");
    if (lower.endsWith(winTail)) {
      return true;  // ← 只要路径以 \dev\null 结尾就返回安全
    }
  }
}
```

**攻击场景**: 攻击者在项目内创建路径 `C:\Users\xxx\project\dev\null\secret.json`，然后通过 `read` 读取它。`isSafeSystemPath` 返回 `true`，路径被错误标记为"安全"，绕过外部目录检查。

**建议**: 改用精确匹配而非后缀匹配，或要求路径恰好等于 `/dev/null` 的 Windows 映射。

---

### H-2：YAML Frontmatter 解析无结构验证（✅ 已修复）

**文件**: `src/yaml-frontmatter.ts`（`parseSimpleYamlMap`）

前端 YAML frontmatter 用作代理级权限配置（per-agent 策略）。解析器问题：

1. **无类型校验**——值始终是字符串，但 `normalizeUnifiedConfig` 期望 `mode` 是字符串、`yoloMode` 是布尔值等。类型不匹配导致配置静默被忽略。
2. **无键名校验**——任意 YAML 键都会被放进结果对象。
3. **无大小限制**——超大 YAML frontmatter 会消耗内存。

**建议**: 增加 frontmatter 大小限制（如 10KB），增加已解析键的白名单校验。

---

## 🟠 中危 (Medium)

### M-1：RPC 事件总线无认证——同进程任意扩展可触发权限提示

**文件**: `src/permission-event-rpc.ts`（`handlePromptRpc`）

```ts
events.on(PERMISSIONS_RPC_PROMPT_CHANNEL, (raw) => {
  void handlePromptRpc(raw, events, deps);
});
```

任何同进程注册的 Pi 扩展都可以向 `permissions:rpc:prompt` 通道发送伪造的权限提示请求，附带任意 `message`、`surface`、`value`。虽然不能伪造决策结果，但可以对用户进行社会工程学攻击（伪造看起来来自可信工具的对话框），或发送大量请求进行 DoS。

**建议**: 在关键通道上增加来源标识或速率限制。

---

### M-2：Quick Commands Surface 默认降级

**文件**: `src/quick-commands.ts`（`parseRuleCommand`）

```ts
if (!explicitSurfaces.has(normalizedTool)) {
  return { tool: "bash", pattern: parts.join(" ") };
}
```

不认识的 surface 默认降级为 `bash`。用户输入 `/allow nonexistent_tool rm -rf /` 会默默变成 `bash: "rm -rf /"`，可能导致非预期授权。

**建议**: 对不认识的 surface 给出警告，或在解析时列出可能的 surface。

---

### M-3：子代理环境变量可被伪造

**文件**: `src/subagent-context.ts`（`isSubagentExecutionContext`）

```ts
for (const key of SUBAGENT_ENV_HINT_KEYS) {
  const value = process.env[key];
  if (typeof value === "string" && value.trim()) {
    return true;  // ← 任一 env var 匹配即视为子代理
  }
}
```

攻击者在启动 Pi 前设置 `PI_IS_SUBAGENT=1` 等环境变量，当前会话会被错误检测为子代理，影响权限转发行为和服务发布决策。

**建议**: 增加需要多个信号同时成立才判定为子代理的要求（env + filesystem 都匹配）。

---

## 🟡 低危 (Low)

### L-1：配置保存的临时文件残留（✅ 已修复）

**文件**: `src/config-store.ts`（`save`）

```ts
writeFileSync(tmpPath, ...);
renameSync(tmpPath, globalPath);
```

成功路径上不清理临时文件。如果进程在两个操作之间崩溃，留下 `config.json.tmp` 文件。

**建议**: 在 try/finally 中清理临时文件。

---

### L-2：警告去重匹配过于精确（✅ 已修复）

**文件**: `src/config-store.ts`（`refresh`）

```ts
if (warning && warning !== this.lastConfigWarning) {
```

相同警告只通知用户一次。但如果警告因时间戳或路径变化而内容微变，用户会反复收到通知。

**建议**: 使用前缀匹配或 hash 去重而非全量字符串比较。

---

### L-3：`stripJsonComments` 对正则/模板字符串的处理

**文件**: `src/config-loader.ts`（`stripJsonComments`）

JSON 标准不支持正则或模板字符串，现有字符串解析逻辑（含转义处理）已正确覆盖 JSON 规范内的所有情况。

**建议**: 无需修改，当前实现正确。

---

## 📊 对抗性审查汇总

| 编号 | 严重度 | 问题 | 影响 |
|------|--------|------|------|
| **C-1** | 🔴 严重 | AgentName 路径遍历 | ✅ 已修复 |
| **C-2** | 🔴 严重 | Session ID 路径遍历 | ✅ 已修复 |
| **H-1** | 🔴 高危 | Windows safe path 后缀误匹配 | ✅ 已修复 |
| **H-2** | 🔴 高危 | YAML frontmatter 无验证 | ✅ 已修复 |
| **M-1** | 🟠 中危 | RPC 无认证 | 同进程伪造权限提示 |
| **M-2** | 🟠 中危 | Quick Command surface 默认降级 | 用户意图误解 |
| **M-3** | 🟠 中危 | 子代理 env var 可伪造 | 子代理检测被误导 |
| **L-1** | 🟡 低危 | 临时文件残留 | ✅ 已修复 |
| **L-2** | 🟡 低危 | 警告去重过于精确 | ✅ 已修复 |
| **L-3** | 🟡 低危 | JSON 注释剥离器 | 理论探索，已验证安全 |
