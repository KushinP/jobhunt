/** Board APIs return job descriptions as HTML. The scorer and the tailoring step both
 * want plain text, and an un-stripped tag soup inflates keyword hits. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  // Greenhouse's content field is HTML whose markup is itself entity-escaped ("&lt;li&gt;").
  // Stripping tags before decoding left every Greenhouse JD full of raw tags, so escaped
  // markup is unescaped first.
  const src = /&lt;\/?[a-z]/i.test(html)
    ? html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    : html;
  return src
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&mdash;|&ndash;/g, '-')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
