# 个人声音朗读验证记录

日期：2026-11-16。开发电脑 CPU 推理；采用 ZipVoice-Distill INT8，未进行云端训练。用户最新评价为「音色尚可，但是太慢了」，功能测试通过不代表生成速度满足用户要求。

## 当前结果

| 项目 | 结果及范围 |
| --- | --- |
| 已生成内容点读 | 最新五次测量约 0.096～0.104 秒出现音频输出信号；不是实体鼠标到空气声音的测量 |
| 实际阅读器生成速度 | 11 句、57.56 秒音频，用时 45.03 秒；约 46.94 秒生成一分钟音频，包含冷启动 |
| Windows TTS 对比 | 同样文字，康康三次测试中位数约 0.23 秒生成一分钟音频；生成到内存，不含扬声器延迟 |
| 声音相似度 | 用户评价音色尚可，但生成速度太慢；没有把程序测试分数当作相似度结论 |
| 已完成部分先播放 | 实际暂停生成后可点读；点击后部未生成句子会优先处理该位置 |
| 重启及本地缓存 | 故意把合成程序路径设为不存在，重启后仍能播放已生成片段 |
| 暂停、继续、变速 | 界面实测 0.8×、1.5×，保留音高；播放端变速不重新生成 |
| 音色及内容隔离 | 切换音色播放各自任务；同路径同大小书籍改过内容后拒绝误播旧版音频 |
| 删除音色 | 原录音保留；应用管理的录音副本清理；已生成音频仍可播放；不能为已删除音色生成新内容 |
| 故障恢复 | 模型错误重试、损坏 WAV 修复、模拟磁盘满后暂停恢复均通过；没有实际填满用户磁盘 |
| TXT / EPUB / PDF / FB2 | 已实际生成、点读；EPUB 和 FB2 验证跨章节连续朗读；PDF 无文字页明确提示 |
| MOBI / AZW3 | 使用共同提取路径，未完成实际个人声音端到端测试；本机没有转换器及测试文件 |
| 原有功能 | 翻页、语音控制互斥、全屏、鼠标隐藏、PDF 加载恢复和切书取消均通过回归检查 |
| 类型及构建 | TypeScript 检查、生产构建通过 |
| 30 分钟连续播放 | 已通过：1800.02 秒音频、995 个片段全部按顺序播放并正确结束；最大额外调度间隔 48.77 毫秒，95% 间隔不超过 19.57 毫秒 |

新内容生成尚未达到 Windows TTS 的速度。预生成之后的快速点读和即时生成是两项不同指标。

## 连续播放检查的边界

使用真实生成的 WAV 组成不少于 30 分钟的测试书，按正常速度逐句播放，并最小化测试窗口。测试输出静音以免长时间打扰，检查片段顺序、遗漏、重复、完成状态与软件调度造成的衔接间隔；不将其当作 30 分钟的声学听感鉴定。

前一次测试发现隐藏窗口被限速，出现大于一秒的句间调度延迟。修复为仅在个人声音朗读时关闭该窗口的后台限速，暂停或停止时恢复。点读速度通过另一次实际输出回环测量验证。

最终连续播放记录：`work/narration-ui-1794841072306/continuity-results.json` 及同目录 `continuity-rows.json`。最终界面操作记录：`work/narration-ui-1794841760827/controls-results.json`。测试未对用户自己的整本书批量生成；验证书籍均为测试资料。

FB2 测试记录了一条 Chromium 的 `ResizeObserver loop completed with undelivered notifications` 布局提示；功能断言通过，无其他运行错误。

## 可复现检查

先运行 `npm run build`，再运行相应脚本。界面检查使用自建测试书和独立资料目录；需要本机已有的声音环境和授权录音。原录音保持只读。

真实声音测试需要设置 `NARRATION_REFERENCE_AUDIO`（录音的绝对路径）、`NARRATION_REFERENCE_TEXT_FILE`（UTF-8 转录文件）与 `NARRATION_PYTHON`（Python 路径）。输出回环计时还需 Python 的 soundcard、NumPy 和 pywin32。测试材料和原始结果留在被忽略的 `work` 目录，不提交个人录音或转录。

公开的汇总数据见 [测速与验收摘要](reports/voice-benchmarks-2026-11-16.json)。文中的 `work` 路径只指开发机器上的本地原始记录，仓库不包含这些资料。

- `scripts/verify-narration-core.cjs`：任务、恢复、内容指纹、音色隔离、磁盘错误及清理。
- `scripts/verify-narration-player.cjs`：异步加载取消、暂停继续、快速变速、过期结果及缓存上限。
- `scripts/verify-narration-ui.cjs`：真实模型生成、优先级、点读输出响应和合成环境不可用时的缓存播放。
- `scripts/verify-narration-controls.cjs <上一步输出目录>`：变速、音色切换、同大小内容改动和删除音色后的界面行为。
- `scripts/verify-narration-formats.cjs`：EPUB / PDF。
- `scripts/verify-narration-extra-formats.cjs <实际生成测试输出目录>`：FB2。
- `scripts/verify-narration-throughput.cjs`、`scripts/verify-windows-tts.ps1`：使用同一固定文字测速。
- `scripts/verify-narration-continuity.cjs <实际生成测试输出目录>`：30 分钟连续播放；设置 `NARRATION_BACKGROUND=1` 检查最小化窗口。
- `scripts/verify-voice-ui.cjs`：原有阅读操作和语音控制回归。

所有计时只代表这台电脑及本次测试，不保证每本书、每段文字都有相同耗时。
