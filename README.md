# 大型仪器原理解读系列 01：荧光信号显影台

这是一个纯前端的互动科普页面，用“上传或选择一张图像 -> 灰度信号 -> 伪彩通道”的方式，解释共聚焦/荧光成像里“激发光照射样本、探测器接收发射光、根据信号强弱做伪彩显示”的基本图景。

项目暂定仓库名：`instrument-principles-lab`。当前页面是这个系列的第一件作品，后续可以继续扩展到大型仪器原理解读的其他主题。

## 当前内容

- 城市灯光、细胞结构、叶片叶脉、神经网络四个内置样本。
- 本地图像上传，本地缓存最近 3 张处理结果，图片不离开浏览器。
- 明场找焦、灰度信号、伪彩显影、多通道合成四个观察阶段。
- 模拟采集、点扫描、伪彩叠加三个触屏友好的操作入口。
- Threshold、Gain、PSF、Offset 四组参数，用科普语言解释信号筛选、探测放大、点扩散和黑场扣除。
- DAPI、FITC、TRITC、Cy5 四个荧光通道，标注常见激发光与发射光关系。
- 示例入口缩略图使用本地小图，来源与授权记录在 `docs/IMAGE_CREDITS.md`。

## 本地预览

直接打开 `index.html` 就能运行。需要用本地服务器预览时：

```bash
python3 -m http.server 8765
```

然后访问 `http://127.0.0.1:8765/index.html`。

## 部署

仓库包含 GitHub Pages Actions workflow：`.github/workflows/pages.yml`。

推送到 `main` 后，GitHub Actions 会把仓库根目录作为静态站点发布。第一次发布时，如果 GitHub 没有自动启用 Pages，需要到仓库的 `Settings -> Pages` 里把部署来源设为 `GitHub Actions`。

说明：如果仓库保持私有，GitHub Pages 是否可用会受当前 GitHub 账号/组织套餐影响。若私有仓 Pages 失败，可以先把仓库临时改公开，或改用 Netlify/Vercel 这类静态托管。

## 文件结构

```text
index.html                 页面结构与科普文案
styles.css                 仪器面板视觉、响应式布局、触屏控件
app.js                     图像生成、扫描动画、参数与通道逻辑
assets/                    示例入口的本地缩略图资源
docs/ITERATION_NOTES.md    这次迭代里确认过的体验原则与坑点
docs/FIELD_TEST_CHECKLIST.md 明天现场刷新与试玩的记录表
docs/IMAGE_CREDITS.md      外部图片来源与授权记录
```

## 验证记录

- `node --check app.js`
- 桌面宽屏、平板横屏、平板竖屏、手机窄屏截图检查
- 浏览器控制台错误检查
- 移动端导出采用系统分享/预览页兜底，避免 `a.download` 被拦截后无反馈
