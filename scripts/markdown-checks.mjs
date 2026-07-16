/** Return structural problems in fenced Mermaid blocks. */
export function mermaidFenceProblems(markdown) {
  const problems = [];
  let active = null;
  const lines = markdown.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    if (active === null) {
      const opening = /^\s{0,3}(`{3,}|~{3,})\s*mermaid\s*$/i.exec(line);
      if (opening !== null) {
        active = {
          character: opening[1][0],
          length: opening[1].length,
          line: index + 1,
          hasContent: false,
        };
      }
      continue;
    }

    const closing = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(line);
    if (
      closing !== null &&
      closing[1][0] === active.character &&
      closing[1].length >= active.length
    ) {
      if (!active.hasContent) {
        problems.push(`empty Mermaid fence opened on line ${active.line}`);
      }
      active = null;
      continue;
    }
    if (line.trim() !== "") active.hasContent = true;
  }

  if (active !== null) {
    problems.push(`unterminated Mermaid fence opened on line ${active.line}`);
  }
  return problems;
}
