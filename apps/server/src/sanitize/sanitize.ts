// Allow-list HTML sanitizer, run on every page after repair and before the banner (R11.3).
// Repair already strips known-bad things (deny-list). This is the second, stricter fence:
// anything not listed here is dropped.
import sanitizeHtml from 'sanitize-html';

/** Tags old personal and fan sites actually used. No script, iframe, object, embed, base, form actions. */
const TAGS = [
  'html', 'head', 'body', 'title', 'meta', 'link', 'style',
  'a', 'abbr', 'acronym', 'address', 'area', 'b', 'basefont', 'bdo', 'big', 'blink', 'blockquote', 'br',
  'button', 'caption', 'center', 'cite', 'code', 'col', 'colgroup', 'dd', 'del', 'dfn', 'dir', 'div', 'dl', 'dt',
  'em', 'fieldset', 'font', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'input', 'ins', 'kbd',
  'label', 'legend', 'li', 'map', 'marquee', 'menu', 'nobr', 'ol', 'optgroup', 'option', 'p', 'pre', 'q', 's',
  'samp', 'select', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'textarea', 'tfoot',
  'th', 'thead', 'tr', 'tt', 'u', 'ul', 'var', 'wbr',
  'article', 'aside', 'figure', 'figcaption', 'footer', 'header', 'main', 'mark', 'nav', 'section', 'time',
  'picture', 'source', 'audio', 'video', 'noscript',
];

/** Attributes allowed on any tag. No on* handlers, no formaction, no srcdoc, no xlink. */
const ATTRS = [
  'id', 'class', 'style', 'title', 'lang', 'dir', 'role', 'aria-*', 'data-seance-*',
  'align', 'valign', 'bgcolor', 'color', 'background', 'width', 'height', 'border', 'cellpadding', 'cellspacing',
  'face', 'size', 'alt', 'href', 'src', 'lowsrc', 'name', 'type', 'value', 'colspan', 'rowspan', 'nowrap',
  'rel', 'disabled', 'checked', 'selected', 'readonly', 'placeholder', 'for', 'label', 'start', 'charset',
  'http-equiv', 'content', 'media', 'poster', 'controls', 'loop', 'behavior', 'direction', 'scrollamount',
  'scrolldelay', 'text', 'link', 'vlink', 'alink', 'hspace', 'vspace', 'clear', 'noshade', 'coords', 'shape',
  'usemap', 'ismap', 'summary', 'abbr', 'headers', 'scope', 'span', 'compact', 'marginwidth', 'marginheight',
  'leftmargin', 'topmargin', 'rows', 'cols', 'maxlength', 'multiple', 'datetime', 'cite', 'target',
];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: TAGS,
  allowedAttributes: { '*': ATTRS },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowedSchemesAppliedToAttributes: ['href', 'src', 'lowsrc', 'cite', 'background', 'poster', 'action'],
  allowProtocolRelative: false,
  // CSS cannot run script in current browsers; old sites need their <style>.
  allowVulnerableTags: true,
  // Drop the content of these, not just the tags.
  nonTextTags: ['script', 'noscript', 'iframe', 'object', 'embed', 'applet', 'frameset', 'template', 'svg', 'math'],
  // data: is allowed for images, but only in img src. Found by the property test (img href="data:...").
  transformTags: {
    img: (tagName, attribs) => {
      const out: sanitizeHtml.Attributes = {};
      for (const [k, v] of Object.entries(attribs)) {
        if (k === 'href') continue;
        if (k !== 'src' && /^\s*data:/i.test(v)) continue;
        if (k === 'src' && /^\s*data:/i.test(v) && !/^\s*data:image\/(gif|png|jpe?g|webp|bmp);/i.test(v)) continue;
        out[k] = v;
      }
      return { tagName, attribs: out };
    },
  },
  exclusiveFilter: (frame) => {
    const a = frame.attribs;
    // No meta refresh (redirects), no link except stylesheets and icons.
    if (frame.tag === 'meta' && /refresh/i.test(a['http-equiv'] ?? '')) return true;
    if (frame.tag === 'link' && !/(^|\s)(stylesheet|icon|shortcut)(\s|$)/i.test(a.rel ?? '')) return true;
    return false;
  },
  parser: { lowerCaseTags: true, lowerCaseAttributeNames: true },
};

export function sanitize(html: string): string {
  return sanitizeHtml(html, OPTIONS);
}
