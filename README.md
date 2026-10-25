# 阅读器 (eReader)

一个 Windows 桌面电子阅读器，原生支持 EPUB / MOBI / AZW3 / FB2 / PDF / TXT，特性包括：

- **超大字体**：滑条 12–200 px，数字输入无上限，Ctrl+滚轮 实时调整
- **多种翻页方式**
  - 键盘：空格 / ← / → / PgUp / PgDn / J / K（可自定义）
  - 鼠标点击：左 1/3 上一页，右 2/3 下一页
  - 鼠标滚轮：向下滚翻下页
  - 自动翻页：F9 启停，间隔 5–120 秒可调
  - 自定义按键：可为任一动作绑定多个键 / 组合键
- **基础功能**
  - 自动保存阅读进度（按文件指纹存储，与文件移动解耦）
  - 7 套背景主题：白底 / 米黄 / 护眼绿 / 深灰 / 夜间 / 纯黑 / 自定义
  - 行间距、页边距、字体族独立可调
  - 拖放打开、最近阅读列表、目录跳转
  - PDF 三种模式：连续滚动 / 单页 / 重排文本（适配大字体）

## 开发

```bash
npm install
npm run dev      # 启动 Electron + Vite HMR
```

## 预览生产构建

```bash
npm run build    # 仅构建
npm start        # 用 Electron 启动构建好的产物
```

## 打包成 .exe（NSIS 安装包）

```bash
npm run package
```

首次执行会下载 Electron 运行时（约 150 MB），耐心等待。
输出位于 `release/` 目录，例如 `release/阅读器-0.1.0-x64.exe`。

## 自定义图标

将一张 256×256（或更大）的 PNG 放到 `build/icon.png` 即可被 electron-builder 自动采用。
Windows ICO 文件可放 `build/icon.ico`。

## 技术栈

- Electron + electron-vite + TypeScript
- React 18 + Tailwind CSS + Zustand
- foliate-js (EPUB / MOBI / AZW3 / FB2)
- pdfjs-dist (PDF)
- electron-store (设置 + 进度持久化)

## 默认快捷键

| 动作 | 快捷键 |
|---|---|
| 下一页 | 空格 / → / PgDn / J |
| 上一页 | ← / PgUp / K |
| 自动翻页 | F9 |
| 打开文件 | Ctrl+O |
| 设置 | F10 |
| 目录 | F11 |
| 字号 +2 | Ctrl+= |
| 字号 −2 | Ctrl+− |
| 字号实时调 | Ctrl+滚轮 |

均可在 设置 → 按键 中自定义。

## 数据存储

所有设置和阅读进度位于：

```
%APPDATA%\阅读器\ereader.json
```

删除此文件即可重置所有设置。
