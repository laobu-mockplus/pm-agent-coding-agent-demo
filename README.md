# 小五 PM Agent 工作台 Demo

这个仓库当前用于验证 **小五** 作为 PM Agent 管理 **CC** 作为 Coding Agent 的可视化流程。

当前重点不是提前交付 SmallCalc 计算器程序，而是验证：

1. 小五先创建 PRD。
2. 小五再向 CC 发出 TaskSpec。
3. CC 只有收到小五指令后，才开始实现。
4. 小五根据报告进行验收。
5. 小五可以判定不通过并列出不合格项。
6. CC 根据验收结果修复。
7. 小五最终验收通过。

## 当前状态

- SmallCalc 程序实现不应提前存在。
- 页面打开后处于 `0 / 7` 的等待状态。
- 点击“开始：小五创建 PRD”后，UI 才开始模拟流程推进。
- 第二步会在“通信通道”里显示 `小五 -> CC` 的 `TaskSpec` 消息包。
- 当前 UI 是可重放 demo，不会直接触发真实 GitHub PR 或真实 Codex/Qoder 执行。

## 本地运行

```bash
npm install
npm run dev
```

打开：

```text
http://127.0.0.1:5173/
```

## 验证

```bash
npm test
npm run lint
npm run build
npm run test:e2e
```

## 后续真实接入

后续如果要接入真实 GitHub 和真实 Coding Agent，必须把“小五发出 TaskSpec”作为 CC 启动的前置门禁。CC 不应在小五发令前创建实现分支、提交 PR 或生成 SmallCalc 程序代码。
