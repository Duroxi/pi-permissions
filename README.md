# pi-permissions

适用于 [Pi coding agent](https://pi.mariozechner.at/) 的统一权限管理扩展。

## 这是什么

pi-permissions 是一个 Pi 扩展，它拦截 agent 的所有操作——工具调用、bash 命令、MCP 请求、技能加载——并根据可配置的策略决定放行、询问用户、还是拒绝。

核心能力：

- **权限模式**：`default`（全部确认）、`allowEdits`（写操作自动批准）、`yolo`（全部自动批准）
- **策略表面**：path / bash / external_directory / mcp / skill 等，支持通配符模式匹配
- **安全机制**：nonce 绑定的子代理 IPC、可配置超时拒绝、ReDoS 防护、fail-closed 设计
- **快速命令**：`/allow`、`/block`、`/ask`、`/policy` 交互式管理策略
- **跨平台**：完整支持 Windows 和 POSIX 系统

## 快速开始

在 `~/.pi/agent/extensions/pi-permission-system/config.json` 中创建配置：

```jsonc
{
  "permission": {
    "*": "allow",
    "path": {
      "*": "allow",
      "*.env": "deny"
    },
    "bash": {
      "*": "ask",
      "rm -rf *": "deny"
    },
    "external_directory": "ask"
  }
}
```

启动 Pi，扩展自动加载。

## 权限模式

| 模式 | 说明 |
|------|------|
| `"default"` | 所有 `ask` 策略都需要用户确认 |
| `"allowEdits"` | `write` 和 `edit` 操作在 CWD 内自动批准，外部队列提示确认 |
| `"yolo"` | 所有 `ask` 策略自动批准 |

在配置中设置：

```jsonc
{ "mode": "allowEdits" }
```

兼容旧的 `yoloMode: true` 写法。

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

在 Pi 对话中直接输入：

| 命令 | 作用 |
|------|------|
| `/allow bash gh api *` | 添加允许规则 |
| `/block rm -rf *` | 添加拒绝规则 |
| `/ask write /etc/*` | 添加询问规则 |
| `/policy` | 查看当前策略文件路径与规则摘要 |
| `/policy-reload` | 重载配置 |

用 `--global` 写入全局而非项目配置。

## 安全设计

- **Nonce 绑定**：子代理转发使用 32 字节 `crypto.randomBytes` nonce，`timingSafeEqual` 验证，防止 IPC 响应伪造
- **超时拒绝**：转发提示默认 30 秒超时，超时自动 deny（fail-safe）
- **ReDoS 防护**：通配符模式超过 500 字符时使用 `/[^\s\S]/` 永不匹配正则
- **Fail-closed**：内部错误、解析失败、未处理边界默认 deny 或 ask
- **请求 ID**：使用 `crypto.randomUUID()` 生成不可预测的 IPC 文件名

## 开发

```bash
npm run check       # 类型检查
npm run test        # 运行测试（2322 个）
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

选择 gotgenes v18.1.1 作为基底，在此基础上集成了 MasuRii 的安全特性和 pi-quick-perms 的 UX 改进。两轮对抗性安全审查已执行并修复了所有发现的问题。全部 2322 个测试跨平台通过。

## 许可

[MIT](LICENSE)

Copyright © 2026 Duroxi
