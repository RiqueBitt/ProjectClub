// Single source of truth for the little glyph shown next to a channel's
// name (sidebar list, chat header title, anywhere else a channel is
// referenced).
//
// Bug fix: these used to be obscure codepoints from a rarely-implemented
// Unicode block (U+1F56A, U+1F56C, U+1F5EB) — most fonts, especially on
// Android and many mobile browsers, have no glyph for them at all, so they
// rendered as a broken "tofu" box (an empty rectangle, sometimes with an X
// or hex code inside) instead of an icon. Standard, universally-supported
// emoji fix that without losing the "one glyph per channel type" idea.
export const TYPE_ICON = {
  TEXT: '#',
  VOICE: '\u{1F50A}',        // 🔊
  ANNOUNCEMENT: '\u{1F4E2}', // 📢
  FORUM: '\u{1F4AC}',        // 💬
  STAGE: '\u{1F3A4}',        // 🎤
  RULES: '\u{1F4DC}',        // 📜
  TICKETS: '\u{1F3AB}',      // 🎫
};
