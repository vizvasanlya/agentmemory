export function estimateTokens(text: string): number {
  if (!text.trim()) {
    return 0;
  }

  const codeBlocks: number[] = [];
  const withoutCode = text.replace(/```[\s\S]*?```/g, (block) => {
    const words = block.split(/\s+/).filter(Boolean).length;
    const placeholder = `__CODE_BLOCK_${codeBlocks.push(words) - 1}__`;
    return placeholder;
  });

  const words = withoutCode.match(/[\p{L}\p{N}_]+|[{}()[\].,:;+=\-/*<>|&]/gu) ?? [];
  const wordTokens = Math.ceil(words.length * 0.75);
  const codeTokens = codeBlocks.reduce((sum, wordsInBlock) => sum + Math.ceil(wordsInBlock * 0.6), 0);

  return Math.max(1, wordTokens + codeTokens);
}
