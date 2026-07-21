# pi-permissions

适用于 [Pi coding agent](https://pi.mariozechner.at/) 的统一权限管理扩展。

## 这是什么

pi-permissions 是一个 Pi 扩展，拦截 agent 的所有操作——工具调用、bash 命令、MCP 请求、技能加载——并根据可配置的策略决定放行、询问用户、还是拒绝。

核心能力：

- **三种权限模式**：`default`（全部询问）、`allowEdits`（写操作自动放行）、`yolo`（全部自动放行）
- **策略表面**：path / bash / external_directory / mcp / skill / read / write / edit / grep / find / ls，支持通配符模式匹配
- **分层配置**：全局 + 项目 + Agent YAML 前言的策略自动合并，`/permission show` 分层展示
- **交互命令**：统一的 `/permission` 斜杠命令管理策略、模式、日志
- **快捷键**：`alt+m` 快速循环切换权限模式
- **安全机制**：nonce 绑定的子代理 IPC、可配置超时拒绝、ReDoS 防护、fail-closed 设计
- **跨平台**：完整支持 Windows 和 POSIX 系统

## 安装

在 `~/.pi/agent/settings.json` 的 `packages` 字段中添加：

```jsonc
{
  "packages": [
    // ... 其他包 ...
    "git:git@github.com:Duroxi/pi-permissions.git"
  ]
}
```

然后运行 `pi`，扩展会自动克隆并加载。

### 配置

扩展自动读取 `~/.pi/agent/extensions/pi-permissions/config.json` 和项目级 `.pi-permissions.json` 文件。基础配置示例：

```jsonc
{
  "mode": "default",
  "permissionReviewLog": true,
  "debugLog": false,
  "permission": {
    "*": "allow",
    "path": {
      "*": "allow",
      "*.env": "deny"
    },
    "bash": {
      "*": "ask",
      "rm -rf *": "deny",
      "sudo *": "deny",
      "git push --force": "deny"
    },
    "external_directory": "ask",
    "read": "allow",
    "ls": "allow",
    "write": "ask",
    "skill": {
      "librarian": "ask"
    }
  }
}
```

## 权限模式

| 模式 | 说明 |
|------|------|
| `default` | 所有 `ask` 策略都需要用户确认 |
| `allowEdits` | `write` 和 `edit` 操作在 CWD 内自动批准，外部队列提示确认 |
| `yolo` | 所有 `ask` 策略自动批准 |

快速切换：**`alt+m`** 或 `/permission mode`（不指定参数时循环切换）。

## 策略参考

权限状态：

| 状态 | 行为 |
|------|------|
| `allow` | 放行 |
| `deny` | 阻止并报错 |
| `ask` | 弹出确认对话框 |

策略表面：

| 表面 | 作用范围 | 示例 |
|------|---------|------|
| `path` | 跨所有工具的文件路径控制 | `"*.env": "deny"` |
| `bash` | bash 命令匹配 | `"rm -rf *": "deny"` |
| `external_directory` | CWD 外路径访问 | `"*": "ask"` |
| `read` / `write` / `edit` | 逐工具路径规则 | `"/etc/*": "deny"` |
| `grep` / `find` / `ls` | 搜索工具路径规则 | `"/secrets/*": "deny"` |
| `mcp` | MCP 服务器/工具控制 | `"server:*": "ask"` |
| `skill` | 技能加载控制 | `"librarian": "ask"` |

## 交互命令

所有命令统一在 `/permission` 下：

| 子命令 | 作用 | 示例 |
|--------|------|------|
| `allow <surface> <pattern>` | 添加允许规则 | `/permission allow bash gh api *` |
| `block <surface> <pattern>` | 添加拒绝规则 | `/permission block bash rm -rf *` |
| `ask <surface> <pattern>` | 添加询问规则 | `/permission ask write /etc/*` |
| `show` | 分层展示当前配置（全局/项目/Agent 作用域） | `/permission show` |
| `mode [default\|allowEdits\|yolo]` | 设置或循环切换权限模式 | `/permission mode allowEdits` |
| `reset` | 重置模式、日志设置到默认值 | `/permission reset` |
| `review-log <on\|off>` | 切换权限审查日志 | `/permission review-log on` |
| `debug-log <on\|off>` | 切换调试日志 | `/permission debug-log on` |
| `help` | 显示帮助信息 | `/permission help` |

命令默认写入全局配置（`~/.pi/agent/extensions/pi-permissions/config.json`），影响所有项目。
添加 `--project` 标志可写入项目配置文件。

### 快捷键

| 快捷键 | 作用 |
|--------|------|
| `alt+m` | 循环切换权限模式：`default → allowEdits → yolo → default` |

## `/permission show` 分层展示

`/permission show` 以分层方式展示当前生效的完整配置：

```
  mode: allowEdits  |  review-log: on  |  debug-log: off
  global config: .../pi-permissions/config.json

═══ 全局 ═══
  ✓ read
  ✓ ls
  ✗ bash : rm -rf *

═══ 项目 ═══
  ? write : /etc/*

═══ Agent 作用域 ═══
  ✓ bash : gh api *
```

每一层的规则按来源标注，清晰区分全局、项目、Agent 级别的配置。

## 安全设计

- **Nonce 绑定**：子代理转发使用 32 字节 `crypto.randomBytes` nonce，`timingSafeEqual` 验证，防止 IPC 响应伪造
- **超时拒绝**：转发提示默认 30 秒超时，超时自动 deny（fail-safe）
- **ReDoS 防护**：通配符模式超过 500 字符时使用 `/[^\s\S]/` 永不匹配正则
- **Fail-closed**：内部错误、解析失败、未处理边界默认 deny 或 ask
- **请求 ID**：使用 `crypto.randomUUID()` 生成不可预测的 IPC 文件名

## 开发

```bash
npm run check       # 类型检查
npm run test        # 运行测试（2276 个）
npm run test:watch  # 监听模式
```

## 项目来源

本仓库是三个开源项目的集成产物。

| 来源 | 版本 | 贡献 |
|------|------|------|
| [gotgenes/pi-packages][gotgenes] — `pi-permission-system` 包 | v18.1.1 | 核心架构：gate pipeline、权限管理器、策略加载、bash 路径解析、子代理转发、2000+ 测试 |
| [MasuRii/pi-permission-system][masurii] | v0.8.0 | 安全增强：nonce 绑定 IPC、超时拒绝、ReDoS 防护 |
| [pi-quick-perms][quick-perms] | — | 用户体验：`allowEdits` 模式、快速命令、紧凑提示格式、三种权限模式 |

[gotgenes]: https://github.com/gotgenes/pi-packages
[masurii]: https://github.com/MasuRii/pi-permission-system
[quick-perms]: https://github.com/Duroxi/pi-quick-perms

选择 gotgenes v18.1.1 作为基底，在此基础上集成了 MasuRii 的安全特性和 pi-quick-perms 的 UX 改进。两轮对抗性安全审查已执行并修复了所有发现的问题。全部 2276 个测试跨平台通过。

## 许可

[MIT](LICENSE)

Copyright © 2026 Duroxi
