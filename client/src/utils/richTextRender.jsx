// Turns plain message text (and, since this is reused for bios too — see
// UserProfileModal.jsx — plain profile text) into React nodes with:
//
//  1. A Discord-style markdown subset: **bold**, *italic*/_italic_,
//     __underline__, ~~strikethrough~~, `inline code`, ```code blocks```,
//     # / ## / ### headings, and > blockquotes. Deliberately not a general
//     markdown parser (no lists/links/tables) — just the inline+block
//     constructs Discord itself supports in messages.
//  2. Custom emoji shortcodes (:name:) become <img> tags when `name`
//     matches something in `emojiMap` (built from this server's emojis +
//     every other server's emojis the user is allowed to use — see
//     EmojiPicker.jsx / userController.listUsableEmojis).
//  3. "@everyone", "@here", "@DisplayName" and "@RoleName" (exact match
//     against the channel's member list / this server's mentionable roles)
//     get a highlighted mention chip: a yellow box for @everyone/@here/a
//     person, with a tiny avatar for a person specifically, or the role's
//     own color (weak box fill + full-strength text, gradient roles
//     included) for a role. There's no structured mention syntax in this
//     app (messages are just text), so this is a best-effort text match,
//     not a guaranteed-correct parse — e.g. it won't catch a display name
//     that happens to contain a space followed by more text that looks
//     like part of the name. The real notification/unread-badge logic
//     doesn't rely on this — it uses MessageMention rows resolved
//     server-side at send time (see server/src/services/mentions.js), this
//     is purely the visual highlight.
//
// NOTE: lives in a .jsx file (not .js) purely so Vite's default esbuild
// loader parses the JSX below — a sibling richText.js with the same logic
// was abandoned mid-edit and is unused/dead; this file is the real one.
import { Fragment } from 'react';
import { useStore } from '../store/useStore';
import { roleTextStyle, roleWeakBackground, gradientStops } from './roleColor';
import PenguinAvatar, { isPenguinAvatarUrl, penguinColorFromUrl } from '../components/PenguinAvatar.jsx';

// BUG CORRIGIDO: <img src={u.avatarUrl}> quebrava (bloqueado pela CSP
// img-src) quando a pessoa mencionada (@fulano) tem avatar de pinguim
// (pseudo-URL "penguin:<cor>", não uma URL de rede de verdade) — ver
// PenguinAvatar.jsx.
function MentionAvatarImg({ url }) {
  if (isPenguinAvatarUrl(url)) return <PenguinAvatar color={penguinColorFromUrl(url)} size={16} />;
  return <img src={url} alt="" />;
}

const CODE_BLOCK_RE = /```([\s\S]+?)```/g;

export function renderRichContent(content, { emojiMap = {}, memberNames = [], roleNames = [], memberInfoByName = {}, roleInfoByName = {} } = {}) {
  if (!content) return null;

  // Sort longer names first so "Ana Clara" matches before "Ana", and roles
  // before members so a role named the same prefix as a member doesn't
  // swallow part of it either.
  const names = [...roleNames, ...memberNames].sort((a, b) => b.length - a.length);
  const mentionRegex = names.length > 0
    ? new RegExp(`@(everyone|here|${names.map(escapeRegExp).join('|')})`)
    : /@(everyone|here)/;
  const ctx = { emojiMap, mentionRegex, memberInfoByName, roleInfoByName };

  // Step 1: split off fenced code blocks (```...```) first — they can span
  // multiple lines and, unlike everything else here, their content is never
  // parsed further (no bold/headings/mentions inside — matches Discord).
  const segments = [];
  let lastIndex = 0;
  let match;
  CODE_BLOCK_RE.lastIndex = 0;
  while ((match = CODE_BLOCK_RE.exec(content)) !== null) {
    if (match.index > lastIndex) segments.push({ type: 'text', value: content.slice(lastIndex, match.index) });
    segments.push({ type: 'codeblock', value: match[1].replace(/^\n/, '') });
    lastIndex = CODE_BLOCK_RE.lastIndex;
  }
  if (lastIndex < content.length) segments.push({ type: 'text', value: content.slice(lastIndex) });

  const nodes = [];
  segments.forEach((seg, si) => {
    if (seg.type === 'codeblock') {
      nodes.push(<pre key={`cb${si}`} className="md-codeblock"><code>{seg.value}</code></pre>);
      return;
    }
    // Step 2: line-by-line block detection (headings, blockquotes) — only
    // meaningful at the start of a line, so this happens before the inline
    // pass, one line at a time. Everything else in the line (and the text
    // after a heading/quote marker) goes through the inline tokenizer.
    const lines = seg.value.split('\n');
    lines.forEach((line, li) => {
      const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
      const quoteMatch = !headingMatch && line.match(/^>\s?(.*)$/);
      const lineKey = `s${si}-l${li}`;
      if (headingMatch) {
        const level = headingMatch[1].length;
        const Tag = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';
        nodes.push(<Tag key={lineKey} className={`md-heading md-h${level}`}>{renderInline(headingMatch[2], ctx, lineKey)}</Tag>);
      } else if (quoteMatch) {
        nodes.push(<blockquote key={lineKey} className="md-blockquote">{renderInline(quoteMatch[1], ctx, lineKey)}</blockquote>);
      } else {
        nodes.push(<Fragment key={lineKey}>{renderInline(line, ctx, lineKey)}</Fragment>);
      }
      if (li < lines.length - 1) nodes.push(<br key={`${lineKey}-br`} />);
    });
  });

  return nodes;
}

// Inline tokenizer: at every position, finds the EARLIEST match among all
// pattern types below (code span, bold, underline, strikethrough, italic,
// custom emoji, mention) and recurses into the matched span's own content
// so formatting can nest (e.g. "**mentioning @Ana is bold**"). Inline code
// is the one exception — its content is rendered verbatim, never re-scanned
// — matches Discord's own behavior (no formatting inside code).
function renderInline(text, ctx, keyPrefix) {
  if (!text) return [];
  const { emojiMap, mentionRegex } = ctx;

  const patterns = [
    { name: 'code', re: /`([^`\n]+)`/ },
    { name: 'bold', re: /\*\*([^\n]+?)\*\*/ },
    { name: 'underline', re: /__([^\n]+?)__/ },
    { name: 'strike', re: /~~([^\n]+?)~~/ },
    { name: 'italicStar', re: /\*([^\n*]+?)\*/ },
    { name: 'italicUnderscore', re: /(?:^|(?<=\s))_([^\n_]+?)_(?=\s|$)/ },
    { name: 'emoji', re: /:([a-zA-Z0-9_]{2,32}):/ },
    { name: 'mention', re: mentionRegex },
    // Plain http(s) links — deliberately not re-scanned for nested formatting
    // (same as inline code), and rendered as a click-to-confirm link (see
    // LinkConfirmModal.jsx) rather than navigating straight away. Trailing
    // punctuation right after the URL (a period ending the sentence, a
    // closing paren, a comma) is excluded from the match so "check ```
    // out https://x.com." doesn't swallow the sentence's own final dot.
    { name: 'link', re: /https?:\/\/[^\s<]+[^\s<.,!?)\]]/ },
  ];

  let best = null;
  for (const p of patterns) {
    const m = text.match(p.re);
    if (m && m.index !== undefined && (!best || m.index < best.match.index)) best = { pattern: p, match: m };
  }
  if (!best) return [<Fragment key={keyPrefix}>{text}</Fragment>];

  const { pattern, match } = best;
  const nodes = [];
  if (match.index > 0) nodes.push(...renderInline(text.slice(0, match.index), ctx, `${keyPrefix}-pre`));

  const key = `${keyPrefix}-${pattern.name}-${match.index}`;
  switch (pattern.name) {
    case 'code':
      nodes.push(<code key={key} className="md-inline-code">{match[1]}</code>);
      break;
    case 'bold':
      nodes.push(<strong key={key}>{renderInline(match[1], ctx, key)}</strong>);
      break;
    case 'underline':
      nodes.push(<u key={key}>{renderInline(match[1], ctx, key)}</u>);
      break;
    case 'strike':
      nodes.push(<s key={key}>{renderInline(match[1], ctx, key)}</s>);
      break;
    case 'italicStar':
    case 'italicUnderscore':
      nodes.push(<em key={key}>{renderInline(match[1], ctx, key)}</em>);
      break;
    case 'emoji': {
      const url = emojiMap[match[1]];
      if (url) nodes.push(<img key={key} src={url} alt={`:${match[1]}:`} title={`:${match[1]}:`} className="inline-emoji" />);
      else nodes.push(<Fragment key={key}>{match[0]}</Fragment>);
      break;
    }
    case 'mention': {
      const name = match[1];
      if (name === 'everyone' || name === 'here') {
        nodes.push(<span key={key} className="mention-chip">@{name}</span>);
      } else if (ctx.roleInfoByName[name]) {
        const role = ctx.roleInfoByName[name];
        nodes.push(
          <span
            key={key}
            className="mention-chip mention-chip-role"
            style={{ background: roleWeakBackground(role.color), borderColor: gradientStops(role.color)[0] }}
          >
            <span style={roleTextStyle(role.color)}>@{name}</span>
          </span>,
        );
      } else if (ctx.memberInfoByName[name]) {
        const u = ctx.memberInfoByName[name];
        nodes.push(
          <span key={key} className="mention-chip mention-chip-user">
            <span className="mention-chip-avatar" style={{ background: u.profileColor }}>
              {u.avatarUrl ? <MentionAvatarImg url={u.avatarUrl} /> : name[0]?.toUpperCase()}
            </span>
            @{name}
          </span>,
        );
      } else {
        nodes.push(<span key={key} className="mention-chip">@{name}</span>);
      }
      break;
    }
    case 'link': {
      const url = match[0];
      nodes.push(
        <a
          key={key}
          href={url}
          className="chat-link"
          onClick={(e) => { e.preventDefault(); useStore.getState().openLinkConfirm(url); }}
        >
          {url}
        </a>,
      );
      break;
    }
    default:
      nodes.push(<Fragment key={key}>{match[0]}</Fragment>);
  }

  const restStart = match.index + match[0].length;
  if (restStart < text.length) nodes.push(...renderInline(text.slice(restStart), ctx, `${keyPrefix}-post`));
  return nodes;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A message that's *only* emoji (custom :shortcode:s and/or native unicode
// emoji, nothing else — no words, no punctuation) gets rendered 3x bigger to
// stand out, same idea as Discord's "jumbo emoji" behaviour. This walks the
// trimmed content token-by-token from the start, consuming either a known
// custom-emoji shortcode or one native emoji grapheme cluster at a time; if
// anything else is found (plain text, an unknown shortcode, punctuation…)
// it's not emoji-only. Capped at 27 so a giant wall of emoji doesn't jumbo
// itself into an unreadable mess.
const LEADING_CUSTOM_EMOJI_RE = /^:([a-zA-Z0-9_]{2,32}):/;
// One emoji "grapheme": a pictographic char, optional variation selector,
// optionally chained with more via zero-width-joiner (for combined emoji
// like 👨‍👩‍👧‍👦), optional trailing skin-tone modifier — or a flag (two
// regional-indicator letters).
const LEADING_UNICODE_EMOJI_RE = /^(?:\p{Regional_Indicator}\p{Regional_Indicator}|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*)/u;
const MAX_JUMBO_EMOJI = 27;

export function isEmojiOnlyMessage(content, emojiMap = {}) {
  if (!content) return false;
  let rest = content.trim();
  if (!rest) return false;

  let count = 0;
  while (rest.length > 0) {
    const shortcodeMatch = rest.match(LEADING_CUSTOM_EMOJI_RE);
    if (shortcodeMatch && emojiMap[shortcodeMatch[1]]) {
      rest = rest.slice(shortcodeMatch[0].length).replace(/^\s+/, '');
      count++;
      continue;
    }
    const unicodeMatch = rest.match(LEADING_UNICODE_EMOJI_RE);
    if (unicodeMatch && unicodeMatch[0].length > 0) {
      rest = rest.slice(unicodeMatch[0].length).replace(/^\s+/, '');
      count++;
      continue;
    }
    return false;
  }
  return count > 0 && count <= MAX_JUMBO_EMOJI;
}
