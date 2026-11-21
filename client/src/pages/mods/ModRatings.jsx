import { useEffect, useId, useState } from 'react';
import { getModRatings, rateMod, removeMyModRating, deleteModRating } from '../../api/endpoints';
import { Icon, Section } from './shared.jsx';
import {
  REVIEW_MAX, STAR_LABELS, formatAverage, formatRatingCount, starFills, reviewLength, reviewTooLong, distributionBars,
} from './ratings.js';

// Avaliações de mods (Fase 7): estrelas de 1 a 5 + texto curto opcional.
// Uma por pessoa por mod; dá pra trocar a nota ou remover. Os textos
// aparecem na página do mod, logo acima dos comentários.

// Estrelas só de leitura (média), com meia estrela.
export function StarRow({ average, size = 15, label }) {
  const fills = starFills(average);
  return (
    <span className="mdx-stars" role="img" aria-label={label || `${formatAverage(average, 1) || '0'} de 5 estrelas`}>
      {fills.map((f, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <span key={i} className="mdx-star" style={{ width: size, height: size }}>
          <Icon name="star" size={size} />
          {f > 0 && <span className="mdx-star-fill" style={{ width: `${f * 100}%` }}><Icon name="star" size={size} filled /></span>}
        </span>
      ))}
    </span>
  );
}

// Seletor de nota (botões de rádio com prévia ao passar o mouse e setas
// do teclado).
function StarPicker({ value, onChange, disabled }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value || 0;
  const onKey = (e) => {
    if (disabled) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(5, (value || 0) + 1)); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.max(1, (value || 1) - 1)); }
  };
  return (
    <div className="mdx-star-picker" role="radiogroup" aria-label="Sua nota" onMouseLeave={() => setHover(0)} onKeyDown={onKey}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} ${n === 1 ? 'estrela' : 'estrelas'} — ${STAR_LABELS[n]}`}
          tabIndex={(value || 1) === n ? 0 : -1}
          className={`mdx-star-btn ${n <= shown ? 'on' : ''}`}
          disabled={disabled}
          onMouseEnter={() => setHover(n)}
          onFocus={() => setHover(0)}
          onClick={() => onChange(n)}
        >
          <Icon name="star" size={24} filled={n <= shown} strokeWidth={1.6} />
        </button>
      ))}
      <span className="mdx-star-label" aria-live="polite">{shown ? STAR_LABELS[shown] : 'Toque nas estrelas'}</span>
    </div>
  );
}

export function ModRatingSection({ modioGameId, modioModId, user, onSummaryChange }) {
  const [data, setData] = useState(null); // { summary, mine, reviews }
  const [stars, setStars] = useState(0);
  const [review, setReview] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const textId = useId();

  const load = () => getModRatings(modioModId)
    .then((d) => {
      setData(d);
      setStars(d.mine?.stars || 0);
      setReview(d.mine?.review || '');
      onSummaryChange?.(d.summary);
    })
    .catch(() => setData({ summary: { average: null, count: 0, distribution: {} }, mine: null, reviews: [], error: true }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setData(null); setEditing(false); load(); }, [modioModId]);

  const flash = (msg) => { setSaved(msg); setTimeout(() => setSaved(''), 2500); };
  const tooLong = reviewTooLong(review);

  const save = async () => {
    if (!stars || tooLong) return;
    setBusy(true); setError('');
    try {
      await rateMod(modioGameId, modioModId, { stars, review: review.trim() || null });
      setEditing(false);
      await load();
      flash('Avaliação salva!');
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível salvar sua avaliação agora.');
    } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError('');
    try {
      await removeMyModRating(modioModId);
      setEditing(false);
      await load();
      flash('Avaliação removida.');
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível remover agora.');
    } finally { setBusy(false); }
  };
  const removeOther = async (id) => {
    try { await deleteModRating(id); await load(); } catch (err) { setError(err.response?.data?.error || 'Não foi possível apagar.'); }
  };

  const summary = data?.summary;
  const avgText = formatAverage(summary?.average, summary?.count);
  const mine = data?.mine;
  const showForm = !mine || editing;

  return (
    <Section title="Avaliações" icon="star">
      {!data ? <div className="mdx-skel mdx-skel-line" /> : (
        <>
          <div className="mdx-rating-summary">
            <div className="mdx-rating-big">
              <strong>{avgText || '—'}</strong>
              <StarRow average={summary?.average || 0} size={16} label={avgText ? `Média ${avgText} de 5` : 'Sem avaliações'} />
              <span className="mdx-muted">{summary?.count ? formatRatingCount(summary.count) : 'Ninguém avaliou ainda'}</span>
            </div>
            {summary?.count > 0 && (
              <ul className="mdx-rating-bars" aria-label="Distribuição das notas">
                {distributionBars(summary.distribution, summary.count).map((b) => (
                  <li key={b.stars}>
                    <span className="mdx-rating-bar-label">{b.stars}<Icon name="star" size={11} filled /></span>
                    <span className="mdx-rating-bar"><span style={{ width: `${b.percent}%` }} /></span>
                    <span className="mdx-rating-bar-count">{b.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {showForm ? (
            <div className="mdx-rating-form">
              <StarPicker value={stars} onChange={setStars} disabled={busy} />
              <label htmlFor={textId} className="mdx-muted mdx-small">Conte o que achou (opcional)</label>
              <textarea
                id={textId}
                placeholder="Funcionou bem? Deu algum problema? Ajude quem vai instalar..."
                value={review}
                maxLength={REVIEW_MAX * 2}
                onChange={(e) => setReview(e.target.value)}
                disabled={busy}
              />
              <div className="mdx-rating-form-foot">
                <span className={`mdx-small ${tooLong ? 'mdx-error-text' : 'mdx-muted'}`}>{reviewLength(review)}/{REVIEW_MAX}</span>
                <div className="mdx-row-end" style={{ marginTop: 0 }}>
                  {mine && <button type="button" className="mdx-btn ghost sm" disabled={busy} onClick={() => { setEditing(false); setStars(mine.stars); setReview(mine.review || ''); }}>Cancelar</button>}
                  <button type="button" className="mdx-btn primary sm" disabled={busy || !stars || tooLong} onClick={save}>
                    {busy ? 'Salvando...' : mine ? 'Salvar alterações' : 'Avaliar'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="mdx-rating-mine">
              <div>
                <span className="mdx-muted mdx-small">Sua avaliação</span>
                <div className="mdx-rating-mine-stars"><StarRow average={mine.stars} size={15} /> <strong>{STAR_LABELS[mine.stars]}</strong></div>
                {mine.review && <p>{mine.review}</p>}
              </div>
              <div className="mdx-row-actions">
                <button type="button" className="mdx-btn ghost sm" disabled={busy} onClick={() => setEditing(true)}>Alterar</button>
                <button type="button" className="mdx-btn ghost danger sm" disabled={busy} onClick={remove}>Remover</button>
              </div>
            </div>
          )}
          {error && <p className="mdx-error">{error}</p>}
          {saved && <p className="mdx-note ok"><Icon name="check" size={15} /> {saved}</p>}

          {data.reviews?.length > 0 && (
            <div className="mdx-comments mdx-reviews">
              {data.reviews.map((rv) => (
                <div key={rv.id} className="mdx-comment">
                  <div className="mdx-review-head">
                    <span><strong>{rv.user?.displayName}</strong> <span className="mdx-muted">@{rv.user?.username}</span></span>
                    <StarRow average={rv.stars} size={13} />
                  </div>
                  <p>{rv.review}</p>
                  {user && user.platformRole === 'ADMIN' && rv.user?.id !== user.id && (
                    <button type="button" className="mdx-link-btn" onClick={() => removeOther(rv.id)}>Apagar avaliação</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Section>
  );
}
