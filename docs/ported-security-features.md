# 已移植安全特性

来源：MasuRii pi-permission-system v0.8.0
目标：pi-permissions (forked from gotgenes v18.1.1)
移植日期：2026-07-10

---

## 1. ReDoS 防护（通配符模式长度限制）✅

### 修改文件

- `src/wildcard-matcher.ts`

### 实现

- 添加 `MAX_WILDCARD_PATTERN_LENGTH = 500` 常量
- `compileWildcardPattern()` 在编译前检查模式长度
- 超过 500 字符的模式返回永不匹配的正则 `/$^/`

### 安全价值

- 防止恶意配置中的超长模式消耗 CPU
- 500 字符限制合理（正常模式通常 < 100 字符）
- 永不匹配的正则（`/$^/`）是安全的降级策略

---

## 2. 超时控制（forwardedPromptTimeoutSeconds）✅

### 修改文件

- `src/extension-config.ts` — 添加配置字段和默认值
- `src/forwarded-permissions/permission-forwarder.ts` — 读取配置并传递超时参数
- `src/index.ts` — 注入 extensionConfig 到 ForwardingManager

### 实现

- `PermissionSystemExtensionConfig` 新增 `forwardedPromptTimeoutSeconds?: number | null` 字段
- 默认值 30 秒，`null` 表示禁用超时
- `processSingleForwardedRequest()` 从配置读取超时值，转换为 `timeoutMs` 传给 `requestPermissionDecisionFromUi`
- 超时触发时返回 `timeoutDenialReason` 提示信息

### 安全价值

- fail-safe 设计：超时即拒绝，符合最小权限原则
- 防止子代理永久挂起
- 用户可配置超时时长

### 配置示例

```jsonc
{
  "forwardedPromptTimeoutSeconds": 30,  // 默认值
  // 或设置为 null 禁用超时
  "forwardedPromptTimeoutSeconds": null
}
```

---

## 3. nonce 安全绑定（防止响应伪造）✅

### 修改文件

- `src/permission-forwarding.ts` — 类型扩展 + 密码学工具函数
- `src/forwarded-permissions/permission-forwarder.ts` — nonce 生成、嵌入、验证

### 实现

#### 类型扩展

- `ForwardedPermissionRequest` 新增 `responseNonce?: string`
- `ForwardedPermissionResponse` 新增 `responseNonce?: string`

#### 密码学工具函数

- `createPermissionForwardingNonce()` — `crypto.randomBytes(32).toString("base64url")`
- `safeEqualString()` — `crypto.timingSafeEqual` 常量时间比较
- `isForwardedPermissionResponseBoundToRequest()` — 验证 nonce + session ID 绑定

#### 转发流程修改

1. **请求创建** (`buildForwardedRequest`) — 生成 nonce，嵌入请求 JSON
2. **响应写入** (`processSingleForwardedRequest`) — 将请求的 nonce 回传到响应
3. **响应验证** (`pollForForwardedResponse`) — 收到响应后验证 nonce 绑定

### 安全价值

- 有效防止响应伪造攻击（攻击者无法预测 32 字节随机 nonce）
- timing-safe 比较防止时间侧信道推断
- session ID 验证防止跨会话攻击
- 版本兼容：旧版子代理（无 nonce）仍可工作，但会记录警告

### 攻击场景防护

```
攻击前：
1. 子代理发出请求 → requests/{id}.json
2. 攻击者写入伪造响应 → responses/{id}.json: { approved: true }
3. 子代理读到伪造响应 → 认为已批准 ❌

攻击后：
1. 子代理发出请求 → requests/{id}.json (含 responseNonce)
2. 攻击者写入伪造响应 → responses/{id}.json: { approved: true } (无 nonce 或错误 nonce)
3. 子代理验证 nonce → 不匹配 → 拒绝响应 ✅
```

---

## 版本兼容性

所有三个特性都保持了向后兼容：

- **ReDoS 防护**：透明降级，不影响正常模式
- **超时控制**：默认启用（30 秒），可通过配置禁用（`null`）
- **nonce 绑定**：字段可选（`responseNonce?`），旧版子代理/父代理仍可工作
