import ChannelTypeIcon from './ChannelTypeIcon.jsx';

// Custom icon-grid replacement for the old native <select> channel-type
// pickers. A native <option> can only ever render plain text, so VOICE and
// STAGE were permanently stuck showing emoji there even after every other
// icon spot in the app moved to the Icons8 pack — this component is a
// clickable button grid instead, so every type (including VOICE/STAGE) can
// show its real image icon via ChannelTypeIcon.
const TYPE_LABELS = {
  TEXT: 'Texto',
  VOICE: 'Voz',
  ANNOUNCEMENT: 'Anúncios',
  FORUM: 'Fórum',
  STAGE: 'Palco',
  RULES: 'Regras',
  TICKETS: 'Tickets',
};

export default function ChannelTypePicker({ types, value, onChange }) {
  return (
    <div className="channel-type-picker">
      {types.map((t) => (
        <button
          type="button"
          key={t}
          className={`channel-type-option ${value === t ? 'selected' : ''}`}
          onClick={() => onChange(t)}
        >
          <ChannelTypeIcon type={t} className="channel-type-option-icon" />
          <span>{TYPE_LABELS[t]}</span>
        </button>
      ))}
    </div>
  );
}
