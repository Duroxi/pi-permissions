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
