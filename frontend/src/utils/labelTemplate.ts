/** Имя пользовательской копии при форке стандартного шаблона. */
export function deriveCopyName(originalName: string): string {
  return `${originalName} (копия)`;
}
