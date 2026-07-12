# 已移植 UX 特性

来源：pi-quick-perms v1.0.3
目标：pi-permissions (forked from gotgenes v18.1.1)
移植日期：2026-07-10

---

## 1. PermissionMode 三态模式 ✅

### 修改文件

- `src/extension-config.ts` — 添加 PermissionMode 类型和 resolveModeFromRecord
- `src/config-loader.ts` — 添加 mode 字段支持
- `src/config-modal.ts` — 更新 UI 为模式选择器
- `src/config-store.ts` — 更新调试日志
- `src/yolo-mode.ts` — 适配新模式系统

### 实现

- 新增 `PermissionMode` 类型：`"default" | "allowEdits" | "yolo"`
- `PermissionSystemExtensionConfig.mode` 替代布尔 `yoloMode`
- `resolveModeFromRecord()` 处理向后兼容：`yoloMode: true` → `"yolo"`
- 配置 UI 从 on/off 开关改为三态选择器

### 模式说明

| 模式 | 行为 | 适用场景 |
|------|------|---------|
| `"default"` | 所有 ask 状态都弹窗确认 | 安全优先 |
| `"allowEdits"` | write/edit 自动批准，其他弹窗 | 日常开发首选 |
| `"yolo"` | 所有 ask 状态自动批准 | 信任环境 |

### 配置示例

```jsonc
{
  "mode": "allowEdits"
}
```

---

## 2. allowEdits 自动批准模式 ✅

### 新增文件

- `src/allow-edits-mode.ts`

### 实现

- `isAllowEditsModeEnabled()` — 检查是否启用 allowEdits 模式
- `shouldAutoApproveForAllowEdits()` — 判断是否自动批准

### 自动批准条件

全部满足时自动批准：
1. `mode === "allowEdits"`
2. `state === "ask"`
3. `surface === "write"` 或 `surface === "edit"`
4. 路径在 CWD 内（非外部路径）

### 安全价值

- 消除日常开发中最频繁的权限弹窗（编辑项目文件）
- 保持对危险操作的确认（bash、外部路径、MCP、skills）
- 外部路径仍需确认，防止意外修改系统文件

---

## 3. 快速命令系统 ✅

### 新增文件

- `src/quick-commands.ts`

### 修改文件

- `src/index.ts` — 注册快速命令

### 命令列表

| 命令 | 功能 | 示例 |
|------|------|------|
| `/allow` | 添加允许规则 | `/allow bash git push` |
| `/block` | 添加拒绝规则 | `/block sudo *` |
| `/ask` | 添加询问规则 | `/ask read *` |
| `/policy` | 查看当前策略文件 | `/policy` |
| `/policy-reload` | 重新加载策略 | `/policy-reload` |

### 特性

- 支持 `--global` 标志切换全局/项目级配置
- 自动解析 surface 类型（bash/path/mcp 等）
- 命令写入后自动重载，立即生效
- 省略 surface 时默认为 bash

### 使用示例

```bash
# 添加 bash 规则
/allow bash git push
/block sudo *

# 添加 path 规则
/allow path src/*
/block path *.env

# 全局配置
/allow --global bash gh api *

# 查看策略
/policy

# 重载策略
/policy-reload
```

---

## 向后兼容性

所有特性保持向后兼容：

- `yoloMode: true` 自动映射为 `mode: "yolo"`
- 旧配置文件无需修改
- 配置 UI 自动显示新模式选择器

---

## 配置优先级

```
mode 字段 > yoloMode 字段 > 默认值 "default"
```

示例：
```jsonc
{
  "mode": "allowEdits",        // 生效
  "yoloMode": true             // 被 mode 覆盖
}
```

```jsonc
{
  "yoloMode": true             // 生效，映射为 mode: "yolo"
}
```
