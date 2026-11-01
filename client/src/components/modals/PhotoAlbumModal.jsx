import { useEffect, useRef, useState } from 'react';
import Modal from '../Modal.jsx';
import UserAvatar from '../UserAvatar.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { proxyImage } from '../../utils/imageProxy';
import { listPhotosByOwner, uploadPhoto, deletePhoto, getPhoto, commentOnPhoto, deletePhotoComment } from '../../api/endpoints';
import { useStore } from '../../store/useStore';

const isVideo = (url) => /\.(mp4|webm|mov|mkv)$/i.test(url);

// Item pedido: álbum de fotos com comentários — galeria completa
// (grid paginado), com upload (só o dono) e um "lightbox" que mostra
// uma foto/vídeo específico junto dos comentários dela.
export default function PhotoAlbumModal({ ownerId, ownerName, isMe, onClose }) {
  const [photos, setPhotos] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [openPhotoId, setOpenPhotoId] = useState(null);
  const fileInputRef = useRef(null);

  const load = (p = page) => {
    listPhotosByOwner(ownerId, p).then((d) => { setPhotos(d.photos); setTotalPages(d.totalPages); });
  };
  useEffect(() => { load(page); }, [page]);

  const handleUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      useStore.getState().pushNotice('Arquivo muito grande — o máximo é 20MB.');
      e.target.value = '';
      return;
    }
    setUploading(true);
    uploadPhoto(file)
      .then(() => load(1))
      .catch((err) => useStore.getState().pushNotice(err?.response?.data?.error || 'Não foi possível enviar.'))
      .finally(() => { setUploading(false); e.target.value = ''; });
  };

  const removePhoto = (id) => {
    if (!confirm('Apagar essa foto?')) return;
    deletePhoto(id).then(() => { setOpenPhotoId(null); load(); }).catch(() => {});
  };

  return (
    <Modal title={`Álbum de fotos de ${ownerName}`} onClose={onClose} width="560px">
      {!openPhotoId && (
        <div className="photo-album">
          {isMe && (
            <>
              <button className="btn-secondary" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                {uploading ? 'Enviando...' : '+ Adicionar foto ou vídeo'}
              </button>
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,video/quicktime,video/x-matroska" hidden onChange={handleUpload} />
            </>
          )}
          {photos.length === 0 && <div className="dim photo-album-empty">Nenhuma foto ainda.</div>}
          <div className="photo-album-grid">
            {photos.map((p) => (
              <button key={p.id} className="photo-album-grid-item" onClick={() => setOpenPhotoId(p.id)}>
                {isVideo(p.url) ? <video src={p.url} muted /> : <img src={proxyImage(p.url)} alt="" />}
                {p._count?.comments > 0 && <span className="photo-album-comment-count">💬 {p._count.comments}</span>}
              </button>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="paginated-list-pager">
              <button className="btn-secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>‹</button>
              <span className="dim">{page} / {totalPages}</span>
              <button className="btn-secondary" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>›</button>
            </div>
          )}
        </div>
      )}

      {openPhotoId && (
        <PhotoLightbox
          photoId={openPhotoId}
          isMe={isMe}
          onBack={() => setOpenPhotoId(null)}
          onDeletedPhoto={() => removePhoto(openPhotoId)}
        />
      )}
    </Modal>
  );
}

function PhotoLightbox({ photoId, isMe, onBack, onDeletedPhoto }) {
  const { user: me } = useAuth();
  const [photo, setPhoto] = useState(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [sending, setSending] = useState(false);

  const load = () => getPhoto(photoId).then((d) => setPhoto(d.photo)).catch(() => {});
  useEffect(() => { load(); }, [photoId]);

  const submitComment = () => {
    if (!commentDraft.trim() || sending) return;
    setSending(true);
    commentOnPhoto(photoId, commentDraft.trim())
      .then(() => { setCommentDraft(''); load(); })
      .finally(() => setSending(false));
  };

  const removeComment = (commentId) => {
    deletePhotoComment(commentId).then(load).catch(() => {});
  };

  if (!photo) return <div className="dim photo-album-empty">Carregando...</div>;

  return (
    <div className="photo-lightbox">
      <button className="profile-see-more-link photo-lightbox-back" onClick={onBack}>‹ Voltar pro álbum</button>
      <div className="photo-lightbox-media">
        {isVideo(photo.url) ? <video src={photo.url} controls /> : <img src={proxyImage(photo.url)} alt="" />}
      </div>
      {photo.caption && <div className="photo-lightbox-caption">{photo.caption}</div>}
      {isMe && (
        <button className="profile-relationship-end" onClick={onDeletedPhoto}>Apagar foto</button>
      )}

      <div className="profile-section-label photo-lightbox-comments-label">COMENTÁRIOS — {photo.comments.length}</div>
      <div className="profile-scrap-composer">
        <input value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitComment()} placeholder="Comente essa foto..." maxLength={500} />
        <button className="btn-secondary" disabled={!commentDraft.trim() || sending} onClick={submitComment}>Enviar</button>
      </div>
      <div className="profile-scrap-list">
        {photo.comments.map((c) => (
          <div key={c.id} className="profile-scrap-item">
            <UserAvatar user={c.author} size={28} />
            <div className="profile-scrap-item-body">
              <span className="profile-scrap-item-author">{c.author.displayName}</span>
              <span className="profile-scrap-item-text">{c.text}</span>
            </div>
            {(c.authorId === me.id || isMe) && (
              <button className="profile-scrap-item-remove" title="Apagar comentário" onClick={() => removeComment(c.id)}>✕</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
