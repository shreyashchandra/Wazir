export function wrapToWidth(text: string, width: number) {
  const tokens = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const tok of tokens) {
    if (!line) line = tok;
    else if (line.length + 1 + tok.length <= width) line += " " + tok;
    else {
      lines.push(line);
      line = tok;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}
