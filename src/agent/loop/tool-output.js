function wrapUntrusted(name, body) {
  const safe = body.replace(/<(\/?)\s*tool_output/gi, '<$1 tool_output');
  return `<tool_output name="${name}" trust="untrusted">\n${safe}\n</tool_output>`;
}

function formatToolResult(tool, name, result) {
  const { imageBase64, imageMimeType, images, text, ...meta } = result || {};
  const imageCount = Array.isArray(images) ? images.length : 0;
  let body = JSON.stringify(meta);
  if (text) body += `\n\n${text}`;
  if (imageBase64) body += '\n(gambar terlampir pada pesan berikutnya)';
  if (imageCount) body += `\n(${imageCount} gambar terlampir pada pesan berikutnya, urut sesuai nomor file)`;
  return tool && tool.untrusted ? wrapUntrusted(name, body) : body;
}

module.exports = { wrapUntrusted, formatToolResult };
