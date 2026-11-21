import { TYPE_ICON } from '../utils/channelIcons';
import hashtagIcon from '../assets/icons/hashtag.png';
import announcementIcon from '../assets/icons/announcement.png';
import rulesIcon from '../assets/icons/rules.png';
import ticketIcon from '../assets/icons/ticket.png';
import chatIcon from '../assets/icons/chat.png';
import volumeHighIcon from '../assets/icons/volume-high.png';
import micIcon from '../assets/icons/mic.png';

// Image counterpart of utils/channelIcons.js's TYPE_ICON. That map has to
// stay plain-text emoji because it's also interpolated into <option> labels
// in the OLD native <select> channel-type pickers — but CreateChannelModal
// and EditChannelModal now use a custom icon-button grid instead of a native
// <select> specifically so every type (including VOICE/STAGE) can show a
// real image icon instead of falling back to emoji.
const TYPE_ICON_IMAGE = {
  TEXT: hashtagIcon,
  ANNOUNCEMENT: announcementIcon,
  RULES: rulesIcon,
  TICKETS: ticketIcon,
  FORUM: chatIcon,
  VOICE: volumeHighIcon,
  STAGE: micIcon,
};

export default function ChannelTypeIcon({ type, className = 'channel-hash' }) {
  const img = TYPE_ICON_IMAGE[type];
  if (img) return <img className={`ui-icon ${className}`} src={img} alt="" />;
  return <span className={className}>{TYPE_ICON[type] || '#'}</span>;
}
