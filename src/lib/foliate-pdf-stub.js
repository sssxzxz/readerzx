// PDF 文件由我们自己的 PdfRenderer (基于 pdfjs-dist) 处理，
// 不会经过 foliate-js 的 pdf 路径。这里返回 stub 防止 Vite 解析 vendor 路径。
export const makePDF = async () => {
  throw new Error('PDF should be handled by PdfRenderer, not foliate-js');
};
